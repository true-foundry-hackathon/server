use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::config::PublicConfig;

const SERVICE: &str = "com.voxagent.desktop";
const ACCOUNT: &str = "auth-session";
const OAUTH_SCHEME: &str = "vox";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredSession {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub email: Option<String>,
    pub vox_token: String,
    pub expires_at: Option<String>,
}

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
    expected_state: String,
    tx: oneshot::Sender<Result<String, String>>,
}

pub struct AuthManager {
    config: PublicConfig,
    session: Mutex<Option<StoredSession>>,
    oauth_in_progress: AtomicBool,
    pending_oauth: Mutex<Option<PendingOauth>>,
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
        })
    }

    pub fn state(&self) -> AuthState {
        let session = self.session.lock().ok().and_then(|guard| guard.clone());
        AuthState {
            signed_in: session.is_some(),
            user_id: session.as_ref().map(|s| s.user_id.clone()),
            email: session.as_ref().and_then(|s| s.email.clone()),
            bridge_url: self.config.bridge_url.clone(),
            api_url: self.config.api_url.clone(),
        }
    }

    pub fn current_session(&self) -> Option<StoredSession> {
        self.session.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn handle_oauth_callback_urls(&self, urls: &[url::Url]) {
        for callback in urls {
            if let Err(err) = self.complete_oauth_callback(callback) {
                if let Ok(mut pending) = self.pending_oauth.lock() {
                    if let Some(pending) = pending.take() {
                        let _ = pending.tx.send(Err(err));
                    }
                }
            }
        }
    }

    pub async fn request_email_otp(&self, email: String) -> Result<(), String> {
        let email = email.trim().to_string();
        if email.is_empty() || !email.contains('@') {
            return Err("Enter a valid email address".to_string());
        }

        let url = format!("{}/auth/v1/otp", self.config.supabase_url);
        let body = serde_json::json!({
            "email": email,
            "create_user": true,
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
            .map_err(|e| format!("Failed to contact Supabase: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Could not send sign-in code ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn verify_email_otp(&self, email: String, token: String) -> Result<AuthState, String> {
        let email = email.trim().to_string();
        let token = token.trim().to_string();
        if email.is_empty() || token.is_empty() {
            return Err("Email and code are required".to_string());
        }

        let url = format!("{}/auth/v1/verify", self.config.supabase_url);
        let body = serde_json::json!({
            "email": email,
            "token": token,
            "type": "email",
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
            .map_err(|e| format!("Failed to verify code: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Invalid or expired code ({status}): {text}"));
        }

        let tokens = response
            .json::<SupabaseTokenResponse>()
            .await
            .map_err(|e| format!("Invalid Supabase verify response: {e}"))?;
        self.establish_session(tokens).await
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
        let redirect_uri = self.config.oauth_redirect_uri.clone();

        if !is_allowed_oauth_redirect(&redirect_uri) {
            return Err(
                "OAuth redirect must use the vox:// app scheme (vox://auth/callback)".to_string(),
            );
        }

        let mut authorize = url::Url::parse(&format!(
            "{}/auth/v1/authorize",
            self.config.supabase_url
        ))
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

        let (tx, rx) = oneshot::channel::<Result<String, String>>();
        {
            let mut pending = self
                .pending_oauth
                .lock()
                .map_err(|_| "Sign-in lock unavailable".to_string())?;
            *pending = Some(PendingOauth {
                expected_state: state.clone(),
                tx,
            });
        }

        app.opener()
            .open_url(authorize.as_str(), None::<&str>)
            .map_err(|e| format!("Could not open browser: {e}"))?;

        let code = tokio::time::timeout(Duration::from_secs(180), rx)
            .await
            .map_err(|_| "Sign-in timed out".to_string())?
            .map_err(|_| "Sign-in was cancelled".to_string())??;

        let tokens = self.exchange_auth_code(&code, &verifier).await?;
        self.establish_session(tokens).await
    }

    pub fn sign_out(&self) -> Result<AuthState, String> {
        if let Ok(mut guard) = self.session.lock() {
            *guard = None;
        }
        let _ = clear_session();
        Ok(self.state())
    }

    fn complete_oauth_callback(&self, callback: &url::Url) -> Result<(), String> {
        if callback.scheme() != OAUTH_SCHEME {
            return Err("Unexpected OAuth callback scheme".to_string());
        }

        let params: HashMap<_, _> = callback.query_pairs().into_owned().collect();
        let mut pending = self
            .pending_oauth
            .lock()
            .map_err(|_| "Sign-in lock unavailable".to_string())?;
        let Some(pending) = pending.take() else {
            return Err("No sign-in is waiting for a callback".to_string());
        };

        if let Some(error) = params.get("error") {
            let description = params
                .get("error_description")
                .cloned()
                .unwrap_or_default();
            let _ = pending.tx.send(Err(format!(
                "Google sign-in failed: {error} {description}"
            )));
            return Ok(());
        }

        let state = params
            .get("state")
            .ok_or_else(|| "Missing OAuth state".to_string())?;
        if state != &pending.expected_state {
            let _ = pending.tx.send(Err("OAuth state mismatch".to_string()));
            return Ok(());
        }

        let code = params
            .get("code")
            .cloned()
            .ok_or_else(|| "Missing OAuth authorization code".to_string())?;
        let _ = pending.tx.send(Ok(code));
        Ok(())
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

    async fn establish_session(
        &self,
        tokens: SupabaseTokenResponse,
    ) -> Result<AuthState, String> {
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

fn is_allowed_oauth_redirect(redirect_uri: &str) -> bool {
    url::Url::parse(redirect_uri)
        .ok()
        .is_some_and(|parsed| {
            parsed.scheme() == OAUTH_SCHEME
                && parsed.host_str().unwrap_or("auth") == "auth"
                && parsed.path() == "/callback"
        })
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
        return Err(format!(
            "Could not create a Vox session ({exchange_status}): {exchange_body}"
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

fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn save_session(session: &StoredSession) -> Result<(), String> {
    let payload = serde_json::to_string(session).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&payload)
        .map_err(|e| format!("Could not store session securely: {e}"))
}

fn load_session() -> Result<Option<StoredSession>, String> {
    match entry()?.get_password() {
        Ok(payload) => {
            let session = serde_json::from_str(&payload)
                .map_err(|e| format!("Stored session is corrupt: {e}"))?;
            Ok(Some(session))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read stored session: {e}")),
    }
}

fn clear_session() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not clear stored session: {e}")),
    }
}
