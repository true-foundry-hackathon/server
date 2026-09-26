use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SERVICE: &str = "com.voxagent.desktop";
const ACCOUNT: &str = "auth-session";
const OAUTH_PENDING_ACCOUNT: &str = "oauth-pending";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredSession {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub email: Option<String>,
    pub vox_token: String,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PersistedOauth {
    pub state: String,
    pub verifier: String,
    pub created_at_unix: i64,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn oauth_pending_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, OAUTH_PENDING_ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn oauth_pending_file() -> PathBuf {
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Library/Application Support")
        .join(SERVICE)
        .join("oauth-pending.json")
}

pub fn save_pending_oauth(pending: &PersistedOauth) -> Result<(), String> {
    let payload = serde_json::to_string(pending).map_err(|e| e.to_string())?;
    // Dual-write: keychain + file. File survives keychain flakiness and helps
    // when the deep-link lands in a different process than the waiter.
    let path = oauth_pending_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create sign-in state dir: {e}"))?;
    }
    std::fs::write(&path, &payload)
        .map_err(|e| format!("Could not store sign-in state file: {e}"))?;
    if let Ok(entry) = oauth_pending_entry() {
        let _ = entry.set_password(&payload);
    }
    Ok(())
}

pub fn load_pending_oauth() -> Result<Option<PersistedOauth>, String> {
    if let Ok(entry) = oauth_pending_entry() {
        match entry.get_password() {
            Ok(payload) => {
                let pending = serde_json::from_str(&payload)
                    .map_err(|e| format!("Stored sign-in state is corrupt: {e}"))?;
                return Ok(Some(pending));
            }
            Err(keyring::Error::NoEntry) => {}
            Err(e) => eprintln!("keychain oauth-pending read warning: {e}"),
        }
    }
    let path = oauth_pending_file();
    match std::fs::read_to_string(&path) {
        Ok(payload) => {
            let pending = serde_json::from_str(&payload)
                .map_err(|e| format!("Stored sign-in state file is corrupt: {e}"))?;
            Ok(Some(pending))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read sign-in state file: {e}")),
    }
}

pub fn clear_pending_oauth() -> Result<(), String> {
    let _ = std::fs::remove_file(oauth_pending_file());
    match oauth_pending_entry() {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Could not clear sign-in state: {e}")),
        },
        Err(_) => Ok(()),
    }
}

pub fn save_session(session: &StoredSession) -> Result<(), String> {
    let payload = serde_json::to_string(session).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&payload)
        .map_err(|e| format!("Could not store session securely: {e}"))
}

pub fn load_session() -> Result<Option<StoredSession>, String> {
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

pub fn clear_session() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not clear stored session: {e}")),
    }
}
