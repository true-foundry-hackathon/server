# Vox Railway Deployment

Deployment configuration and GitHub Actions workflow for deploying Vox backend services to Railway.

## Architecture on Railway

1. **`core-api`**:
   - Source: `core/Dockerfile`
   - Command: `/usr/local/bin/vox-core-api`
   - Exposes HTTP REST and WebSocket internal API. Railway provides the public/private URL.

2. **`core-worker`**:
   - Source: `core/Dockerfile.worker`
   - Command: `/usr/local/bin/vox-core-worker`
   - Background job processor, scheduler, and task executor.

3. **`bridge`**:
   - Source: `bridge/Dockerfile`
   - Exposes public port for Twilio WebSockets and WhatsApp webhooks.

4. **`redis`**:
   - Provisioned directly through Railway via "New -> Database -> Add Redis".

## Setup Instructions

### 1. Create Railway Project and Services

1. In Railway, create an empty project.
2. Add a **Redis** service from Railway Database templates.
3. Create three empty services in the project:
   - `core-api`
   - `core-worker`
   - `bridge`

### 2. Configure Environment Variables in Railway

#### Common Variables
- `DATABASE_URL`: PostgreSQL connection string (Supabase or managed PostgreSQL).
- `REDIS_URL`: Reference Railway Redis connection string (`${{Redis.REDIS_URL}}`).
- `VOX_AUTH_TOKEN`: Shared secret token for inter-service authentication.

#### Core API & Worker
- `TRUEFOUNDRY_API_KEY`: API key for TrueFoundry LLM Gateway.
- `TRUEFOUNDRY_GATEWAY_URL`: `https://llm-gateway.truefoundry.cloud/api/inference/openai/v1`
- `TRUEFOUNDRY_MODEL`: Target model (e.g., `gemini-2.5-flash`).
- `EXA_API_KEY`: Exa search API key.
- `GOOGLE_MAPS_API_KEY`: Google Maps API key (optional).
- `VOX_BRIDGE_URL`: Private networking URL to Bridge (e.g., `http://bridge.railway.internal:3000`).

#### Bridge
- `VOX_CORE_URL`: Private networking URL to Core API (e.g., `http://core-api.railway.internal:3001`).
- `TWILIO_ACCOUNT_SID`: Twilio account SID.
- `TWILIO_AUTH_TOKEN`: Twilio auth token.
- `TWILIO_FROM_NUMBER`: Twilio phone number.
- `ASSEMBLYAI_API_KEY`: AssemblyAI API key.
- `SARVAM_API_KEY`: Sarvam API key.
- `VOX_STT_PROVIDER`: `assemblyai`
- `VOX_TTS_PROVIDER`: `sarvam` or `elevenlabs`

### 3. Configure GitHub Secrets

In the GitHub repository settings (`Settings -> Secrets and variables -> Actions`), add:

- `RAILWAY_TOKEN`: Railway Project Token or Account API token (generate in Railway Settings -> Tokens).
- `RAILWAY_SERVICE_CORE_API`: (Optional, defaults to `core-api`)
- `RAILWAY_SERVICE_CORE_WORKER`: (Optional, defaults to `core-worker`)
- `RAILWAY_SERVICE_BRIDGE`: (Optional, defaults to `bridge`)

### 4. Deployment Trigger

Pushing commits to the `main` branch or triggering `workflow_dispatch` executes `.github/workflows/deploy-railway.yml`, deploying the updated services to Railway.
