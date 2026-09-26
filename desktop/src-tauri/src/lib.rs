mod audio;
mod auth;
mod client;
mod codec;
mod config;

use auth::{AuthManager, AuthState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::oneshot;

const PHASE_IDLE: u8 = 0;
const PHASE_CONNECTING: u8 = 1;
const PHASE_ACTIVE: u8 = 2;

struct ActiveSession {
    stop_tx: oneshot::Sender<()>,
    is_running: Arc<AtomicBool>,
    phase: Arc<AtomicU8>,
}

pub struct SessionManager(Mutex<Option<ActiveSession>>);

#[derive(Clone, Debug, Serialize)]
pub struct CallStatus {
    pub active: bool,
    pub state: String,
}

fn status_from_phase(phase: u8, is_running: bool) -> CallStatus {
    let state = match phase {
        PHASE_CONNECTING => "connecting",
        PHASE_ACTIVE if is_running => "active",
        PHASE_ACTIVE => "ended",
        _ => "idle",
    };
    CallStatus {
        active: is_running && phase == PHASE_ACTIVE,
        state: state.to_string(),
    }
}

#[tauri::command]
fn get_auth_state(auth: State<'_, AuthManager>) -> AuthState {
    auth.state()
}

#[tauri::command]
async fn request_email_otp(email: String, auth: State<'_, AuthManager>) -> Result<(), String> {
    auth.request_email_otp(email).await
}

#[tauri::command]
async fn verify_email_otp(
    email: String,
    code: String,
    auth: State<'_, AuthManager>,
) -> Result<AuthState, String> {
    auth.verify_email_otp(email, code).await
}

#[tauri::command]
async fn sign_in_with_google(
    app: AppHandle,
    auth: State<'_, AuthManager>,
) -> Result<AuthState, String> {
    auth.sign_in_with_google(app).await
}

#[tauri::command]
fn sign_out(auth: State<'_, AuthManager>) -> Result<AuthState, String> {
    auth.sign_out()
}

#[tauri::command]
async fn start_call(
    auth: State<'_, AuthManager>,
    state: State<'_, SessionManager>,
) -> Result<CallStatus, String> {
    let session = auth
        .current_session()
        .ok_or_else(|| "Sign in before starting a call".to_string())?;
    let bridge_url = auth.state().bridge_url;

    {
        let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = session_guard.take() {
            let _ = existing.stop_tx.send(());
            existing.phase.store(PHASE_IDLE, Ordering::SeqCst);
            existing.is_running.store(false, Ordering::SeqCst);
        }
    }

    let (stop_tx, stop_rx) = oneshot::channel();
    let (ready_tx, ready_rx) = oneshot::channel();
    let is_running = Arc::new(AtomicBool::new(false));
    let phase = Arc::new(AtomicU8::new(PHASE_CONNECTING));
    let is_running_clone = Arc::clone(&is_running);
    let phase_clone = Arc::clone(&phase);

    {
        let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
        *session_guard = Some(ActiveSession {
            stop_tx,
            is_running,
            phase: Arc::clone(&phase),
        });
    }

    tokio::spawn(async move {
        let result = client::run_session_loop(
            bridge_url,
            session,
            is_running_clone.clone(),
            ready_tx,
            stop_rx,
        )
        .await;
        is_running_clone.store(false, Ordering::SeqCst);
        phase_clone.store(PHASE_IDLE, Ordering::SeqCst);
        if let Err(err) = result {
            eprintln!("Voice session ended with error: {err}");
        }
    });

    match ready_rx.await {
        Ok(Ok(())) => {
            phase.store(PHASE_ACTIVE, Ordering::SeqCst);
            Ok(status_from_phase(PHASE_ACTIVE, true))
        }
        Ok(Err(err)) => {
            let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
            let _ = session_guard.take();
            phase.store(PHASE_IDLE, Ordering::SeqCst);
            Err(err)
        }
        Err(_) => {
            let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
            let _ = session_guard.take();
            phase.store(PHASE_IDLE, Ordering::SeqCst);
            Err("Call failed to start".to_string())
        }
    }
}

#[tauri::command]
fn end_call(state: State<'_, SessionManager>) -> Result<CallStatus, String> {
    let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = session_guard.take() {
        session.phase.store(PHASE_IDLE, Ordering::SeqCst);
        session.is_running.store(false, Ordering::SeqCst);
        let _ = session.stop_tx.send(());
    }
    Ok(status_from_phase(PHASE_IDLE, false))
}

#[tauri::command]
fn call_status(state: State<'_, SessionManager>) -> Result<CallStatus, String> {
    let session_guard = state.0.lock().map_err(|e| e.to_string())?;
    match session_guard.as_ref() {
        Some(session) => {
            let phase = session.phase.load(Ordering::SeqCst);
            let running = session.is_running.load(Ordering::SeqCst);
            if phase == PHASE_ACTIVE && !running {
                Ok(status_from_phase(PHASE_IDLE, false))
            } else {
                Ok(status_from_phase(
                    phase,
                    running || phase == PHASE_CONNECTING,
                ))
            }
        }
        None => Ok(status_from_phase(PHASE_IDLE, false)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::from_filename("../.env").ok();
    dotenvy::dotenv().ok();

    let auth = match AuthManager::new() {
        Ok(auth) => auth,
        Err(err) => {
            eprintln!("Auth configuration error: {err}");
            panic!("{err}");
        }
    };

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let urls: Vec<url::Url> = argv
                .iter()
                .filter_map(|arg| url::Url::parse(arg).ok())
                .filter(|url| url.scheme() == "vox")
                .collect();
            if !urls.is_empty() {
                if let Some(auth) = app.try_state::<AuthManager>() {
                    auth.handle_oauth_callback_urls(&urls);
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(auth)
        .manage(SessionManager(Mutex::new(None)))
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(auth) = handle.try_state::<AuthManager>() {
                    auth.handle_oauth_callback_urls(&event.urls());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_state,
            request_email_otp,
            verify_email_otp,
            sign_in_with_google,
            sign_out,
            start_call,
            end_call,
            call_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
