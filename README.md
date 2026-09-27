# Vox Railway Deployment

Deployment configuration and GitHub Actions workflow for deploying the Vox backend to Railway (Hobby plan).

`core/` and `bridge/` are synced copies of the [vox-core](../vox-core) and [vox-bridge](../vox-bridge) repos (see "Keeping this in sync" below) — this repo exists purely to package and deploy them, not to develop against directly.

## Architecture on Railway

One public domain, fronted by Caddy, path-routing to two private backend services:

```
                 ┌────────────┐
  internet ─────▶│   caddy    │  (only service with a public domain)
                 └─────┬──────┘
                private networking
              ┌─────────┴─────────┐
              ▼                   ▼
        ┌───────────┐       ┌───────────┐
        │ core-api  │       │  bridge   │
        └─────┬─────┘       └─────┬─────┘
              │                   │
        ┌─────┴─────┐             │
        ▼           ▼             │
   ┌────────┐  ┌─────────┐        │
   │core-   │  │ redis   │◀───────┘
   │worker  │  │(plugin) │
   └────────┘  └─────────┘
```

Postgres is external (Supabase or any managed Postgres) — `DATABASE_URL` points at it. Redis is provisioned as a Railway plugin.

1. **`caddy`**:
   - Source: `caddy/Dockerfile`
   - The *only* service with a public domain attached. Reverse-proxies by path to `core-api` and `bridge` over Railway's private network, mirroring the self-hosted Caddy setup in `vox-deploy/caddy/Caddyfile` and `vox-bridge/ops/Caddyfile`.
   - Listens on `$PORT` (Railway injects this for every service). No TLS/ACME config here — Railway's edge terminates TLS for the custom domain and forwards plain HTTP to this container.

2. **`core-api`**:
   - Source: `core/Dockerfile`
   - Command: `/usr/local/bin/vox-core-api`
   - HTTP REST + WebSocket API. Not given a public domain; reached only via `caddy` and by `core-worker`/`bridge` over private networking.

3. **`core-worker`**:
   - Source: `core/Dockerfile.worker`
   - Command: `/usr/local/bin/vox-core-worker`
   - Background job processor, scheduler, and task executor. Same source as `core-api`, different Dockerfile/entrypoint, deployed as its own Railway service.

4. **`bridge`**:
   - Source: `bridge/Dockerfile`
   - Voice/telephony gateway: Twilio WebSocket streaming, WhatsApp webhooks. Not given a public domain either — `caddy` proxies `/bridge/*`, `/auth/*`, `/twilio/*`, `/ws*`, `/health*`, and `/` (root landing) to it.

5. **`redis`**:
   - Provisioned directly through Railway via "New → Database → Add Redis".

## Setup Instructions

### 1. Create Railway Project and Services

1. In Railway, create an empty project.
2. Add a **Redis** service from Railway Database templates.
3. Create four empty services in the project, each pointed at this repo with the given root directory:
   - `core-api` → root directory `core`, builds `core/Dockerfile`
   - `core-worker` → root directory `core`, builds `core/Dockerfile.worker`
   - `bridge` → root directory `bridge`
   - `caddy` → root directory `caddy`
4. Attach your custom domain (e.g. `api.voxagent.in`) to the **`caddy`** service only — not to `core-api` or `bridge`. Railway auto-provisions TLS for it.

### 2. Configure Environment Variables in Railway

#### Common Variables
- `DATABASE_URL`: PostgreSQL connection string (Supabase or managed PostgreSQL). Set on `core-api` and `core-worker`.
- `REDIS_URL`: Reference Railway Redis's connection string (`${{Redis.REDIS_URL}}`). Set on `core-api` and `core-worker`.
- `VOX_AUTH_TOKEN`: Shared secret token for inter-service authentication. Set on `core-api`, `core-worker`, and `bridge`.

#### Core API & Worker
- `GEMINI_API_KEY`, `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite` if unset).
- `EXA_API_KEY`: Exa search API key.
- `GOOGLE_MAPS_API_KEY`: Google Maps API key (optional).
- `VOX_BRIDGE_URL`: Bridge's private networking URL — `http://bridge.railway.internal:3000`.
- `VOX_CORE_BIND_ADDRESS`: optional; falls back to `0.0.0.0:$PORT` automatically if unset, so you usually don't need this on Railway.
- `JEV_API_KEY` / `JEV_BASE_URL`: optional Jev tool-router credentials; without `JEV_API_KEY` the router falls back to running all tools every turn.
- `DB_MAX_CONNECTIONS` / `DB_ACQUIRE_TIMEOUT_SECS`: optional pool tuning, default to `10` / `5`.

#### Bridge
- `VOX_CORE_URL`: Core API's private networking URL — `http://core-api.railway.internal:3001`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- `ASSEMBLYAI_API_KEY`, `VOX_STT_PROVIDER=assemblyai`, `ASSEMBLYAI_SPEECH_MODEL=universal-3-5-pro`.
- `SARVAM_API_KEY`, `VOX_TTS_PROVIDER=sarvam` (or `elevenlabs`, with its own key).

#### Caddy
- `CORE_API_UPSTREAM`: `core-api.railway.internal:3001`
- `BRIDGE_UPSTREAM`: `bridge.railway.internal:3000`
- `PORT` is injected by Railway automatically — don't set it yourself.

Point your Twilio/WhatsApp webhook URLs at the custom domain on `caddy` (e.g. `https://api.voxagent.in/twilio/...`), not directly at the `bridge` service.

### 3. Configure GitHub Secrets

In the GitHub repository settings (`Settings → Secrets and variables → Actions`), add:

- `RAILWAY_TOKEN`: Railway Project Token or Account API token (generate in Railway Settings → Tokens).
- `RAILWAY_SERVICE_CORE_API`: (optional, defaults to `core-api`)
- `RAILWAY_SERVICE_CORE_WORKER`: (optional, defaults to `core-worker`)
- `RAILWAY_SERVICE_BRIDGE`: (optional, defaults to `bridge`)
- `RAILWAY_SERVICE_CADDY`: (optional, defaults to `caddy`)

### 4. Deployment Trigger

Pushing commits to the `main` branch or triggering `workflow_dispatch` executes `.github/workflows/deploy-railway.yml`, deploying all four services to Railway.

## Local testing

`docker compose up` builds and runs all five pieces (redis, core-api, core-worker, bridge, caddy) with Docker Compose service-name networking. Caddy listens on `localhost:8080` as the single entry point — `core-api`/`bridge` are not published to the host, matching the "only Caddy is public" shape used on Railway. Copy `.env.example` to `.env` first.

## Keeping this in sync

`core/` and `bridge/` (plus `core/vox-connections/` and `core/vox-sms-schema/`, vendored because Railway's per-service build context can't reach sibling repos) are periodically re-synced from [vox-core](../vox-core) and [vox-bridge](../vox-bridge) with:

```bash
rsync -a --delete --exclude target --exclude .git --exclude .env --exclude '.env.*' vox-core/ vox-railway/core/
rsync -a --delete --exclude target --exclude .git --exclude .env --exclude '.env.*' vox-bridge/ vox-railway/bridge/
rsync -a --exclude target --exclude .git vox-connections/ vox-railway/core/vox-connections/
rsync -a --exclude target --exclude .git vox-sms-schema/ vox-railway/core/vox-sms-schema/
```

run from the `vox/` parent directory. This intentionally excludes `.env*` (this repo's own env files, and Railway service settings, are the source of truth for secrets) and `Cargo.lock` isn't touched by the exclude pattern above being `.env.*`, so re-run `cargo generate-lockfile` (or `cargo check`) inside `core/` and `bridge/` after syncing if `Cargo.toml` changed, so the committed lock stays consistent with what `--locked` Docker builds expect. `core/Cargo.lock` in particular must be generated with **no ancestor `Cargo.toml` above `core/`** (e.g. from a copy of just `core/` outside this repo) — this repo's root `Cargo.toml` workspace is a local-dev convenience only (`cargo check --workspace` from the repo root), not what Railway/Docker actually build; `core/Cargo.lock` and `bridge/Cargo.lock` are the real, standalone locks used at deploy time, since each Railway service's build context is scoped to just that one subdirectory.
