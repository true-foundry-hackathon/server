# Vox Desktop

Native voice client for talking to your Vox agent over the Bridge desktop channel.

## Auth model

Production Google sign-in uses the **app deep link** `vox://auth/callback` (not a localhost HTTP server).

Flow:

1. App opens the system browser to Supabase Google OAuth with **PKCE**.
2. After Google approves, the browser redirects to `vox://auth/callback?code=…&state=…`.
3. The OS delivers that URL to the Vox app (no public port, no `127.0.0.1` listener).
4. App verifies `state`, exchanges `code` + `code_verifier` for tokens, then calls Core `/v1/auth/exchange`.
5. Session is stored in the OS keychain.

Email OTP never uses a redirect URL.

In Supabase Auth → URL configuration, allow:

```text
vox://auth/callback
```

## Local development

1. Copy `.env.example` to `.env` and fill public values.
2. Allow `vox://auth/callback` in Supabase.
3. Ensure Core has `SUPABASE_JWT_SECRET` set.
4. Run:

```sh
cp .env.example .env
# edit .env
cd src-tauri && cargo tauri dev
```

On macOS, deep links for a custom scheme are most reliable with an installed/bundled app under `/Applications`. Linux/Windows register the scheme at runtime in debug builds.

Nothing secret to Vox servers (service tokens, host secrets, JWT signing keys) is shipped in the app.

## Release pipeline

GitHub Actions workflow `.github/workflows/release.yml` builds installers when you push a `v*` tag or run the workflow manually.

Configure these **environment variables** on the `production` environment in `vox-desktop`:

| Name | Purpose |
| --- | --- |
| `VOX_SUPABASE_URL` | Public Supabase project URL |
| `VOX_SUPABASE_ANON_KEY` | Public Supabase anon / publishable key |
| `VOX_API_URL` | Core API origin (`https://api.voxagent.in`) |
| `VOX_BRIDGE_URL` | Bridge origin (usually same as API) |
| `VOX_OAUTH_REDIRECT_URI` | Optional; defaults to `vox://auth/callback` |

Keep Apple/Tauri signing material in **secrets**, not variables.

Public config is injected at **build time** via `src-tauri/build.rs`. End users never set env vars.

## Production backend checklist

- Deploy Bridge + Core with desktop channel + Caddy `/v1/*` → Core.
- Core: `SUPABASE_JWT_SECRET` matches the Supabase project.
- Optional private-beta fallback on Bridge: `DESKTOP_AUTH_TOKEN` (not used by this app).
