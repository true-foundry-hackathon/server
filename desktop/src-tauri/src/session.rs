use crate::auth::AuthManager;
use crate::client;
use crate::types::CallStatus;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::sync::oneshot;

const PHASE_IDLE: u8 = 0;
const PHASE_CONNECTING: u8 = 1;
const PHASE_ACTIVE: u8 = 2;

struct ActiveSession {
    stop_tx: oneshot::Sender<()>,
    is_running: Arc<AtomicBool>,
    phase: Arc<AtomicU8>,
    mic_level: Arc<AtomicU32>,
}

pub struct SessionManager(Mutex<Option<ActiveSession>>);

impl SessionManager {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

fn status_from_phase(phase: u8, is_running: bool, mic_level: f32) -> CallStatus {
    let state = match phase {
        PHASE_CONNECTING => "connecting",
        PHASE_ACTIVE if is_running => "active",
        PHASE_ACTIVE => "ended",
        _ => "idle",
    };
    let is_speaking = is_running && phase == PHASE_ACTIVE && mic_level > 0.012;
    CallStatus {
        active: is_running && phase == PHASE_ACTIVE,
        state: state.to_string(),
        mic_level,
        is_speaking,
    }
}

#[tauri::command]
pub async fn start_call(
    app: tauri::AppHandle,
    auth: State<'_, AuthManager>,
    state: State<'_, SessionManager>,
) -> Result<CallStatus, String> {
    crate::device_link::emit_local_event(&app, "status", "Voice call connecting...");
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
    let mic_level = Arc::new(AtomicU32::new(0));
    let is_running_clone = Arc::clone(&is_running);
    let phase_clone = Arc::clone(&phase);
    let mic_level_clone = Arc::clone(&mic_level);

    {
        let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
        *session_guard = Some(ActiveSession {
            stop_tx,
            is_running,
            phase: Arc::clone(&phase),
            mic_level: Arc::clone(&mic_level),
        });
    }

    tokio::spawn(async move {
        let result = client::run_session_loop(
            bridge_url,
            session,
            is_running_clone.clone(),
            ready_tx,
            stop_rx,
            mic_level_clone,
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
            crate::device_link::emit_local_event(&app, "status", "Voice call active — mic listening");
            Ok(status_from_phase(PHASE_ACTIVE, true, 0.0))
        }
        Ok(Err(err)) => {
            let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
            let _ = session_guard.take();
            phase.store(PHASE_IDLE, Ordering::SeqCst);
            crate::device_link::emit_local_event(&app, "error", &format!("Call failed to start: {err}"));
            Err(err)
        }
        Err(_) => {
            let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
            let _ = session_guard.take();
            phase.store(PHASE_IDLE, Ordering::SeqCst);
            crate::device_link::emit_local_event(&app, "error", "Call failed to start");
            Err("Call failed to start".to_string())
        }
    }
}

#[tauri::command]
pub fn end_call(app: tauri::AppHandle, state: State<'_, SessionManager>) -> Result<CallStatus, String> {
    let mut session_guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = session_guard.take() {
        session.phase.store(PHASE_IDLE, Ordering::SeqCst);
        session.is_running.store(false, Ordering::SeqCst);
        let _ = session.stop_tx.send(());
        crate::device_link::emit_local_event(&app, "status", "Voice call ended");
    }
    Ok(status_from_phase(PHASE_IDLE, false, 0.0))
}

#[tauri::command]
pub fn call_status(state: State<'_, SessionManager>) -> Result<CallStatus, String> {
    let session_guard = state.0.lock().map_err(|e| e.to_string())?;
    match session_guard.as_ref() {
        Some(session) => {
            let phase = session.phase.load(Ordering::SeqCst);
            let running = session.is_running.load(Ordering::SeqCst);
            let mic_raw = session.mic_level.load(Ordering::Relaxed);
            let mic_level = f32::from_bits(mic_raw);
            if phase == PHASE_ACTIVE && !running {
                Ok(status_from_phase(PHASE_IDLE, false, 0.0))
            } else {
                Ok(status_from_phase(phase, running, mic_level))
            }
        }
        None => Ok(status_from_phase(PHASE_IDLE, false, 0.0)),
    }
}
