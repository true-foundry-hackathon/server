# Vox Desktop

Your agent command center on the desktop — voice, tasks, knowledge, personal data, and live reports in one native app.

## Purpose

Vox Desktop is the native shell for working with your Vox agent and the data it accumulates for you.

1. **Voice agent** — Access your Vox agent and talk to it live over the desktop channel.
2. **Task management** — Manage your own tasks alongside work the agent runs for you.
3. **LMS & knowledge** — Whiteboards, rich text, notes, collections, and articles.
4. **Phone control** — Drive the desktop app from a phone call.
5. **Personal process data** — Finance records, travel history, expenditure, and related history.
6. **Agent schedules** — See the scheduled tasks your agent creates for you.
7. **Chat with your data** — Ask questions across the records Vox holds for you.
8. **Reports & live dashboards** — Expenditure by category, distance travelled, device usage, and other live graphs.

Sign in with your Vox account (Google) to use the app.

## Install from GitHub Release

Download the Apple Silicon `.dmg` from the draft release, open it, and drag **Vox** to Applications.

Unsigned CI builds are quarantined by Gatekeeper and macOS may show *“Vox.app is damaged”*. Clear quarantine, then open:

```sh
xattr -cr /Applications/Vox.app
# if the old build was named vox-desktop.app:
xattr -cr /Applications/vox-desktop.app
open /Applications/Vox.app
```

Signed/notarized builds (Apple Developer cert secrets in the release workflow) will not need this.

---

## Technical details

### Map home

Signed-in home is a **stylized dark 3D city map** (MapLibre + OpenFreeMap) — extruded buildings, wireframe streets, mission-control HUD — not photorealistic satellite.

Optional place naming uses the same **`GOOGLE_MAPS_API_KEY`** as Core via **Places API (New)** `searchNearby`:

```text
GOOGLE_MAPS_API_KEY=AIza…
```

Enable **Places API (New)** on that key if you want building/place labels. The map tiles themselves do not require Google.

### Auth model

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

### Local development

1. Copy `.env.example` to `.env` and fill public values.
2. In Supabase Auth → URL configuration, allow **both**:
   ```text
   vox://auth/callback
   http://127.0.0.1:17843/auth/callback
   ```
3. Run from repo root:

```sh
cp .env.example .env
# edit .env
npm install
npm run tauri dev
```

Frontend is **React + Vite + Tailwind + shadcn**, themed with the Raycast midnight/coral system. Rust backend stays in `src-tauri/`.

Debug builds (`cargo tauri dev` / `npm run tauri dev`) use the loopback URL automatically. macOS routes `vox://` to `/Applications/Vox.app`, so deep-link login does not reach the debug binary — the localhost callback fixes that. Release builds keep `vox://auth/callback`.

Quit any other Vox window before signing in so port `17843` is free.

Nothing secret to Vox servers (service tokens, host secrets, JWT signing keys) is shipped in the app.

### Release pipeline

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

### Production backend checklist

- Deploy Bridge + Core with desktop channel + Caddy `/v1/*` → Core.
- Core: `SUPABASE_URL` points at the same Supabase project (JWKS ES256 verify). Optional `SUPABASE_JWT_SECRET` only for legacy HS256 tokens.
- Optional private-beta fallback on Bridge: `DESKTOP_AUTH_TOKEN` (not used by this app).
