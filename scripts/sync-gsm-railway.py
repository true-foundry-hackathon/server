#!/usr/bin/env python3
"""
Sync secrets from Google Secret Manager (GSM) to Railway Shared Variables.
Requires:
  - gcloud CLI authenticated (via google-github-actions/auth or local gcloud auth)
  - Environment variables:
      GCP_PROJECT_ID
      RAILWAY_TOKEN
      RAILWAY_PROJECT_ID
      RAILWAY_ENVIRONMENT_ID (optional; auto-detected if omitted)
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

# List of secrets to sync: (GSM secret name, Railway shared variable name)
# If GSM secret name is the same as Railway variable name, you can just map it 1:1.
DEFAULT_SECRET_KEYS = [
    "VOX_AUTH_TOKEN",
    "DATABASE_URL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "EXA_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "ASSEMBLYAI_API_KEY",
    "SARVAM_API_KEY",
    "VOX_STT_PROVIDER",
    "VOX_TTS_PROVIDER",
]

RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2"


def run_graphql(token: str, query: str, variables: dict) -> dict:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    
    # Railway accepts two authentication header styles:
    # 1. 'Authorization: Bearer <token>' for Account/Workspace tokens
    # 2. 'Project-Access-Token: <token>' for Project tokens
    header_candidates = [
        {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "vox-gsm-railway-sync/1.0",
        },
        {
            "Project-Access-Token": token,
            "Content-Type": "application/json",
            "User-Agent": "vox-gsm-railway-sync/1.0",
        },
    ]

    last_error = None
    for headers in header_candidates:
        req = urllib.request.Request(RAILWAY_GRAPHQL_URL, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if "errors" in data:
                    err_msg = json.dumps(data["errors"])
                    if "Not Authorized" in err_msg or "unauthorized" in err_msg.lower():
                        last_error = RuntimeError(
                            f"Railway API returned Not Authorized. "
                            f"Ensure RAILWAY_TOKEN is an Account/Personal API token from "
                            f"https://railway.com/account/tokens with write access to the project.\n"
                            f"Raw error: {err_msg}"
                        )
                        continue
                    raise RuntimeError(f"GraphQL Errors: {err_msg}")
                return data.get("data", {})
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                last_error = e
                continue
            error_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} Error: {error_body}") from e

    if last_error:
        raise last_error
    return {}


def get_default_environment_id(token: str, project_id: str) -> str:
    query = """
    query GetProject($id: String!) {
      project(id: $id) {
        environments {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
    """
    data = run_graphql(token, query, {"id": project_id})
    environments = [
        edge["node"] for edge in data.get("project", {}).get("environments", {}).get("edges", [])
    ]
    if not environments:
        raise RuntimeError(f"No environments found for Railway project {project_id}")

    # Prefer 'production', otherwise pick the first environment
    for env in environments:
        if env["name"].lower() == "production":
            return env["id"]
    return environments[0]["id"]


def fetch_gsm_secret(gcp_project: str, secret_name: str) -> str | None:
    try:
        cmd = [
            "gcloud",
            "secrets",
            "versions",
            "access",
            "latest",
            f"--secret={secret_name}",
            f"--project={gcp_project}",
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        # If secret does not exist or access denied
        return None


def upsert_railway_shared_variables(token: str, project_id: str, environment_id: str, variables: dict):
    # Railway variableCollectionUpsert allows setting multiple variables at once
    # Omitting serviceId sets them as Environment/Shared variables
    mutation = """
    mutation UpsertSharedVariables($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
    """
    payload = {
        "input": {
            "projectId": project_id,
            "environmentId": environment_id,
            "variables": variables,
            "replace": False,
        }
    }
    run_graphql(token, mutation, payload)


def main():
    gcp_project = os.environ.get("GCP_PROJECT_ID")
    railway_token = os.environ.get("RAILWAY_TOKEN")
    railway_project_id = os.environ.get("RAILWAY_PROJECT_ID")
    railway_env_id = os.environ.get("RAILWAY_ENVIRONMENT_ID")

    if not gcp_project:
        sys.exit("Error: GCP_PROJECT_ID environment variable is missing.")
    if not railway_token:
        sys.exit("Error: RAILWAY_TOKEN environment variable is missing.")
    if not railway_project_id:
        sys.exit("Error: RAILWAY_PROJECT_ID environment variable is missing.")

    if not railway_env_id:
        print("RAILWAY_ENVIRONMENT_ID not provided. Auto-detecting production environment...")
        railway_env_id = get_default_environment_id(railway_token, railway_project_id)
        print(f"Target Environment ID: {railway_env_id}")

    # Check for custom comma-separated secret keys from env or fallback to defaults
    custom_keys_env = os.environ.get("SECRET_KEYS")
    keys_to_fetch = [k.strip() for k in custom_keys_env.split(",") if k.strip()] if custom_keys_env else DEFAULT_SECRET_KEYS

    collected_secrets = {}
    print(f"Fetching secrets from Google Secret Manager (Project: {gcp_project})...")
    for key in keys_to_fetch:
        val = fetch_gsm_secret(gcp_project, key)
        if val is not None:
            collected_secrets[key] = val
            print(f"  ✓ Fetched {key}")
        else:
            # Check lowercase / kebab-case variant if uppercase not found (e.g. vox-auth-token)
            kebab_key = key.lower().replace("_", "-")
            val = fetch_gsm_secret(gcp_project, kebab_key)
            if val is not None:
                collected_secrets[key] = val
                print(f"  ✓ Fetched {kebab_key} -> {key}")
            else:
                print(f"  - Skipped {key} (not found in GSM)")

    if not collected_secrets:
        print("No secrets found to sync.")
        return

    print(f"\nPushing {len(collected_secrets)} shared variable(s) to Railway project {railway_project_id}...")
    upsert_railway_shared_variables(railway_token, railway_project_id, railway_env_id, collected_secrets)
    print("✓ Successfully populated Railway shared variables!")


if __name__ == "__main__":
    main()
