use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::config::PublicConfig;
use crate::pkce::{code_challenge, generate_code_verifier, oauth_params};
use crate::session_store::{
    clear_pending_oauth, clear_session, load_pending_oauth, load_session, save_pending_oauth,
    save_session, PersistedOauth, StoredSession,
};

const OAUTH_SCHEME: &str = "vox";
const OAUTH_PENDING_TTL_SECS: i64 = 600;
/// Fixed loopback used by `cargo tauri dev` — macOS will not deliver `vox://` to the
/// debug binary when `/Applications/Vox.app` owns the scheme.
#[cfg(debug_assertions)]
const DEV_OAUTH_LOOPBACK: &str = "http://127.0.0.1:17843/auth/callback";
#[cfg(debug_assertions)]
const DEV_OAUTH_PORT: u16 = 17843;

#[derive(Clone, Debug, Serialize)]
pub struct AuthState {
    pub signed_in: bool,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub bridge_url: String,
    pub api_url: String,
}

#[derive(Deserialize)]
struct SupabaseTokenResponse {
    access_token: String,
    refresh_token: String,
    #[allow(dead_code)]
    expires_in: Option<i64>,
    user: Option<SupabaseUser>,
}

#[derive(Deserialize)]
struct SupabaseUser {
    id: String,
    email: Option<String>,
}

#[derive(Deserialize)]
struct AuthExchangeResponse {
    token: String,
    user_id: Uuid,
    expires_at: String,
}

#[derive(Deserialize)]
struct CoreMeResponse {
    user_id: Uuid,
}

struct PendingOauth {
    tx: oneshot::Sender<Result<AuthState, String>>,
}

pub struct AuthManager {
    config: PublicConfig,
    session: Mutex<Option<StoredSession>>,
    oauth_in_progress: AtomicBool,
    pending_oauth: Mutex<Option<PendingOauth>>,
    /// Serializes callback handling so duplicate macOS Opened/on_open_url events
    /// cannot clear pending mid-flight and race the waiting Google sign-in.
    oauth_finish: tokio::sync::Mutex<()>,
}

impl AuthManager {
    pub fn new() -> Result<Self, String> {
        let config = PublicConfig::load()?;
        let session = load_session().ok().flatten();
        Ok(Self {
            config,
            session: Mutex::new(session),
            oauth_in_progress: AtomicBool::new(false),
            pending_oauth: Mutex::new(None),
            oauth_finish: tokio::sync::Mutex::new(()),
        })
    }

    pub fn state(&self) -> AuthState {
        self.pull_session_from_store();
        let session = self.session.lock().ok().and_then(|guard| guard.clone());
        AuthState {
            signed_in: session.is_some(),
            user_id: session.as_ref().map(|s| s.user_id.clone()),
            email: session.as_ref().and_then(|s| s.email.clone()),
            bridge_url: self.config.bridge_url.clone(),
            api_url: self.config.api_url.clone(),
        }
    }

    pub fn config(&self) -> &PublicConfig {
        &self.config
    }

    pub fn current_session(&self) -> Option<StoredSession> {
        self.pull_session_from_store();
        self.session.lock().ok().and_then(|guard| guard.clone())
    }

    fn pull_session_from_store(&self) {
        let Ok(mut guard) = self.session.lock() else {
            return;
        };
        if guard.is_some() {
            return;
        }
        if let Ok(Some(session)) = load_session() {
            *guard = Some(session);
        }
    }

    /// Completes Google OAuth from a deep link in whatever process macOS opened.
    pub async fn finish_oauth_from_url(&self, callback: &url::Url) -> Result<AuthState, String> {
        let _guard = self.oauth_finish.lock().await;
        let result = self.finish_oauth_inner(callback).await;
        // Always wake the waiting sign_in_with_google command, whether success or failure.
        match &result {
            Ok(state) => {
                if let Ok(mut pending) = self.pending_oauth.lock() {
                    if let Some(p) = pending.take() {
                        let _ = p.tx.send(Ok(state.clone()));
                    }
                }
            }
            Err(err) => {
                // Duplicate callbacks after a successful finish should not poison the waiter.
                self.pull_session_from_store();
                if self.current_session().is_some() {
                    if let Ok(mut pending) = self.pending_oauth.lock() {
                        if let Some(p) = pending.take() {
                            let _ = p.tx.send(Ok(self.state()));
                        }
                    }
                } else {
                    self.fail_pending(err.clone());
                }
            }
        }
        result
    }

    async fn finish_oauth_inner(&self, callback: &url::Url) -> Result<AuthState, String> {
        if !is_allowed_oauth_callback(callback) {
            return Err(format!(
                "Unexpected OAuth callback scheme ({})",
                callback.scheme()
            ));
        }

        let params = oauth_params(callback);
        if let Some(error) = params.get("error") {
            let description = params
                .get("error_description")
                .cloned()
                .unwrap_or_default()
                .replace('+', " ");
            let message = format!("Google sign-in failed: {error} {description}");
            let _ = clear_pending_oauth();
            return Err(message.trim().to_string());
        }

        let persisted = match load_pending_oauth()? {
            Some(pending) => pending,
            None => {
                // Another delivery path (or another Vox process) may have already finished.
                self.pull_session_from_store();
                if self.current_session().is_some() {
                    return Ok(self.state());
                }
                return Err(
                    "No sign-in is in progress. Click Continue with Google again in this app."
                        .to_string(),
                );
            }
        };
        if now_unix() - persisted.created_at_unix > OAUTH_PENDING_TTL_SECS {
            let _ = clear_pending_oauth();
            return Err("Sign-in expired. Click Continue with Google again.".to_string());
        }

        if let Some(state) = params.get("state") {
            if state != &persisted.state {
                return Err("OAuth state mismatch — try signing in again".to_string());
            }
        }

        let callback_tokens = if let Some(code) = params.get("code").filter(|v| !v.is_empty()) {
            self.exchange_auth_code(code, &persisted.verifier).await?
        } else if let (Some(access_token), Some(refresh_token)) = (
            params
                .get("access_token")
                .filter(|v| !v.is_empty())
                .cloned(),
            params
                .get("refresh_token")
                .filter(|v| !v.is_empty())
                .cloned(),
        ) {
            SupabaseTokenResponse {
                access_token,
                refresh_token,
                expires_in: None,
                user: None,
            }
        } else {
            return Err("OAuth callback was missing credentials. Confirm vox://auth/callback is allow-listed in Supabase Auth redirect URLs.".to_string());
        };

        let _ = clear_pending_oauth();
        self.establish_session(callback_tokens).await
    }

    pub async fn sign_in_with_google(&self, app: AppHandle) -> Result<AuthState, String> {
        if self
            .oauth_in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("Sign-in already in progress".to_string());
        }

        let result = self.sign_in_with_google_inner(app).await;
        self.oauth_in_progress.store(false, Ordering::SeqCst);
        if let Ok(mut pending) = self.pending_oauth.lock() {
            *pending = None;
        }
        result
    }

    async fn sign_in_with_google_inner(&self, app: AppHandle) -> Result<AuthState, String> {
        let verifier = generate_code_verifier();
        let challenge = code_challenge(&verifier);
        let state = Uuid::new_v4().to_string();
        let redirect_uri = oauth_redirect_for_runtime(&self.config.oauth_redirect_uri);

        if !is_allowed_oauth_redirect(&redirect_uri) {
            return Err(
                "OAuth redirect must be vox://auth/callback (release) or http://127.0.0.1:17843/auth/callback (dev)"
                    .to_string(),
            );
        }

        let mut authorize =
            url::Url::parse(&format!("{}/auth/v1/authorize", self.config.supabase_url))
                .map_err(|e| format!("Invalid Supabase URL: {e}"))?;
        {
            let mut query = authorize.query_pairs_mut();
            query.append_pair("provider", "google");
            query.append_pair("redirect_to", &redirect_uri);
            query.append_pair("response_type", "code");
            query.append_pair("code_challenge", &challenge);
            query.append_pair("code_challenge_method", "S256");
            query.append_pair("state", &state);
        }

        let (tx, rx) = oneshot::channel::<Result<AuthState, String>>();
        {
            let mut pending = self
                .pending_oauth
                .lock()
                .map_err(|_| "Sign-in lock unavailable".to_string())?;
            *pending = Some(PendingOauth { tx });
        }
        save_pending_oauth(&PersistedOauth {
            state: state.clone(),
            verifier: verifier.clone(),
            created_at_unix: now_unix(),
        })?;

        // Debug: listen on loopback before opening the browser so the redirect cannot race us.
        #[cfg(debug_assertions)]
        let loopback_rx = if redirect_uri.starts_with("http://127.0.0.1:")
            || redirect_uri.starts_with("http://localhost:")
        {
            Some(spawn_oauth_loopback_listener()?)
        } else {
            None
        };

        app.opener()
            .open_url(authorize.as_str(), None::<&str>)
            .map_err(|e| format!("Could not open browser: {e}"))?;

        #[cfg(debug_assertions)]
        if let Some(loopback_rx) = loopback_rx {
            let callback = match tokio::time::timeout(Duration::from_secs(180), loopback_rx).await {
                Ok(Ok(Ok(url))) => url,
                Ok(Ok(Err(err))) => return Err(err),
                Ok(Err(_)) => {
                    return Err("OAuth loopback listener failed unexpectedly".to_string());
                }
                Err(_) => {
                    return Err(
                        "Timed out waiting for Google in the browser. Add http://127.0.0.1:17843/auth/callback to Supabase Auth redirect URLs, then try again."
                            .to_string(),
                    );
                }
            };
            return self.finish_oauth_from_url(&callback).await;
        }

        match tokio::time::timeout(Duration::from_secs(180), rx).await {
            Ok(Ok(Ok(state))) => Ok(state),
            Ok(Ok(Err(err))) => Err(err),
            Ok(Err(_)) | Err(_) => {
                // Do NOT clear persisted PKCE here — macOS often delivers vox:// late.
                // Keep polling keychain so a late callback can still finish sign-in.
                for _ in 0..60 {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    self.pull_session_from_store();
                    if self.current_session().is_some() {
                        return Ok(self.state());
                    }
                }
                Err(
                    "Waiting for Google… Quit Vox (Cmd+Q), then click “Open Vox” in the browser. Or click Continue with Google again from this app."
                        .to_string(),
                )
            }
        }
    }

    pub fn sign_out(&self) -> Result<AuthState, String> {
        if let Ok(mut guard) = self.session.lock() {
            *guard = None;
        }
        let _ = clear_session();
        let _ = clear_pending_oauth();
        Ok(self.state())
    }

    fn fail_pending(&self, err: String) {
        if let Ok(mut pending) = self.pending_oauth.lock() {
            if let Some(pending) = pending.take() {
                let _ = pending.tx.send(Err(err));
            }
        }
    }

    async fn exchange_auth_code(
        &self,
        code: &str,
        verifier: &str,
    ) -> Result<SupabaseTokenResponse, String> {
        let url = format!("{}/auth/v1/token?grant_type=pkce", self.config.supabase_url);
        let body = serde_json::json!({
            "auth_code": code,
            "code_verifier": verifier,
        });

        let response = reqwest::Client::new()
            .post(&url)
            .header("apikey", &self.config.supabase_anon_key)
            .header(
                "authorization",
                format!("Bearer {}", self.config.supabase_anon_key),
            )
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to finish Google sign-in: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Google sign-in failed ({status}): {text}"));
        }

        response
            .json::<SupabaseTokenResponse>()
            .await
            .map_err(|e| format!("Invalid Google sign-in response: {e}"))
    }

    async fn establish_session(&self, tokens: SupabaseTokenResponse) -> Result<AuthState, String> {
        let (user_id, email) = match tokens.user {
            Some(user) => (user.id, user.email),
            None => {
                let me = fetch_supabase_user(&self.config, &tokens.access_token).await?;
                (me.id, me.email)
            }
        };

        let exchange = exchange_with_core(&self.config, &tokens.access_token).await?;

        let session = StoredSession {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            user_id: exchange.user_id.to_string(),
            email: email.or(Some(user_id)),
            vox_token: exchange.token,
            expires_at: Some(exchange.expires_at),
        };

        save_session(&session)?;
        if let Ok(mut guard) = self.session.lock() {
            *guard = Some(session);
        }
        Ok(self.state())
    }
}

#[tauri::command]
pub fn get_auth_state(auth: State<'_, AuthManager>) -> AuthState {
    auth.state()
}

#[tauri::command]
pub async fn sign_in_with_google(
    app: AppHandle,
    auth: State<'_, AuthManager>,
) -> Result<AuthState, String> {
    auth.sign_in_with_google(app).await
}

#[tauri::command]
pub fn sign_out(auth: State<'_, AuthManager>) -> Result<AuthState, String> {
    auth.sign_out()
}

fn oauth_redirect_for_runtime(configured: &str) -> String {
    #[cfg(debug_assertions)]
    {
        let trimmed = configured.trim();
        if trimmed.starts_with("http://127.0.0.1:") || trimmed.starts_with("http://localhost:") {
            return trimmed.to_string();
        }
        // Ignore production vox:// while developing — Launch Services owns that scheme.
        DEV_OAUTH_LOOPBACK.to_string()
    }
    #[cfg(not(debug_assertions))]
    {
        configured.trim().to_string()
    }
}

fn is_allowed_oauth_redirect(redirect_uri: &str) -> bool {
    url::Url::parse(redirect_uri)
        .ok()
        .is_some_and(|parsed| is_allowed_oauth_callback(&parsed))
}

fn is_allowed_oauth_callback(callback: &url::Url) -> bool {
    if callback.scheme() == OAUTH_SCHEME {
        return callback.host_str().unwrap_or("auth") == "auth" && callback.path() == "/callback";
    }
    if callback.scheme() == "http" {
        let host = callback.host_str().unwrap_or("");
        return (host == "127.0.0.1" || host == "localhost") && callback.path() == "/auth/callback";
    }
    // Browsers can't render a page at a vox:// URL, so release builds redirect
    // through this public HTTPS bridge page first (vox-bridge/src/auth_bridge.rs),
    // which then forwards to vox://auth/callback itself.
    if callback.scheme() == "https" {
        return callback.host_str().unwrap_or("") == "api.voxagent.in"
            && callback.path() == "/auth/bridge";
    }
    false
}

#[cfg(debug_assertions)]
fn spawn_oauth_loopback_listener() -> Result<oneshot::Receiver<Result<url::Url, String>>, String> {
    let (tx, rx) = oneshot::channel();
    tauri::async_runtime::spawn(async move {
        let result = accept_oauth_loopback_once().await;
        let _ = tx.send(result);
    });
    Ok(rx)
}

#[cfg(debug_assertions)]
const DEV_OAUTH_SUCCESS_HTML: &str = include_str!("../assets/oauth_success.html");

#[cfg(debug_assertions)]
async fn accept_oauth_loopback_once() -> Result<url::Url, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", DEV_OAUTH_PORT))
        .await
        .map_err(|e| {
            format!(
                "Could not bind http://127.0.0.1:{DEV_OAUTH_PORT} for Google sign-in: {e}. Quit other Vox/dev instances and try again."
            )
        })?;

    let (mut socket, _) = listener
        .accept()
        .await
        .map_err(|e| format!("OAuth callback accept failed: {e}"))?;

    let mut buf = vec![0u8; 8192];
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| format!("OAuth callback read failed: {e}"))?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let request_line = request.lines().next().unwrap_or("");
    let path_and_query = request_line.split_whitespace().nth(1).unwrap_or("/");
    let callback = url::Url::parse(&format!(
        "http://127.0.0.1:{DEV_OAUTH_PORT}{path_and_query}"
    ))
    .map_err(|e| format!("Invalid OAuth callback path: {e}"))?;

    let body = DEV_OAUTH_SUCCESS_HTML;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
    Ok(callback)
}

async fn exchange_with_core(
    config: &PublicConfig,
    access_token: &str,
) -> Result<AuthExchangeResponse, String> {
    let url = format!("{}/v1/auth/exchange", config.api_url);
    let body = serde_json::json!({ "id_token": access_token });

    let response = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Vox API: {e}"))?;

    if response.status().is_success() {
        return response
            .json::<AuthExchangeResponse>()
            .await
            .map_err(|e| format!("Invalid auth exchange response: {e}"));
    }

    let exchange_status = response.status();
    let exchange_body = response.text().await.unwrap_or_default();

    let me_url = format!("{}/v1/me", config.api_url);
    let me_response = reqwest::Client::new()
        .get(&me_url)
        .header("authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| format!("Failed to verify session with Vox API: {e}"))?;

    if !me_response.status().is_success() {
        let detail = if exchange_body.trim().is_empty() {
            "Core rejected the Supabase access token (often missing SUPABASE_URL / ES256 JWKS support on the API)."
                .to_string()
        } else {
            exchange_body
        };
        return Err(format!(
            "Could not create a Vox session ({exchange_status}): {detail}"
        ));
    }

    let me = me_response
        .json::<CoreMeResponse>()
        .await
        .map_err(|e| format!("Invalid /v1/me response: {e}"))?;

    Ok(AuthExchangeResponse {
        token: access_token.to_string(),
        user_id: me.user_id,
        expires_at: String::new(),
    })
}

async fn fetch_supabase_user(
    config: &PublicConfig,
    access_token: &str,
) -> Result<SupabaseUser, String> {
    let url = format!("{}/auth/v1/user", config.supabase_url);
    let response = reqwest::Client::new()
        .get(&url)
        .header("apikey", &config.supabase_anon_key)
        .header("authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| format!("Failed to load user profile: {e}"))?;

    if !response.status().is_success() {
        return Err("Signed in, but user profile could not be loaded".to_string());
    }

    response
        .json::<SupabaseUser>()
        .await
        .map_err(|e| format!("Invalid user profile: {e}"))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
