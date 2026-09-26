mod audio;
mod auth;
mod client;
mod codec;
mod config;

use auth::{AuthManager, AuthState};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopTask {
    pub id: String,
    pub title: String,
    pub instruction: String,
    pub status: String,
    pub execution_type: String,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub feasibility_reasoning: Option<String>,
    #[serde(default)]
    pub execution_result: Option<serde_json::Value>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateTaskPayload {
    pub title: String,
    pub instruction: Option<String>,
    pub execution_type: Option<String>,
    pub project_name: Option<String>,
    pub due_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdateTaskPayload {
    pub task_id: String,
    pub status: Option<String>,
    pub feasibility_reasoning: Option<String>,
    pub execution_result: Option<serde_json::Value>,
}

pub struct TaskManager(Mutex<Vec<DesktopTask>>);

impl TaskManager {
    pub fn new() -> Self {
        let initial_tasks = vec![
            DesktopTask {
                id: "tsk-001".to_string(),
                title: "Summarize Q3 voice pipeline benchmarks".to_string(),
                instruction: "Analyze voice session logs, measure P95 latency and packet loss metrics across desktop channels.".to_string(),
                status: "completed".to_string(),
                execution_type: "autonomous".to_string(),
                project_name: Some("Vox Core".to_string()),
                feasibility_reasoning: Some("Completed autonomously using internal audio telemetry buffers.".to_string()),
                execution_result: Some(serde_json::json!({ "p95_latency_ms": 174, "opus_frame_loss_pct": 0.02 })),
                due_at: Some("Today".to_string()),
                created_at: Some("2026-09-23T08:30:00Z".to_string()),
                completed_at: Some("2026-09-23T10:15:00Z".to_string()),
            },
            DesktopTask {
                id: "tsk-002".to_string(),
                title: "Verify webhook signatures and TLS certs".to_string(),
                instruction: "Check incoming Twilio and WhatsApp webhook signatures, ensuring rotation keys are synchronized.".to_string(),
                status: "executing".to_string(),
                execution_type: "autonomous".to_string(),
                project_name: Some("Bridge Infrastructure".to_string()),
                feasibility_reasoning: Some("Worker currently polling bridge health endpoints and TLS certificate expiries.".to_string()),
                execution_result: None,
                due_at: Some("In 2h".to_string()),
                created_at: Some("2026-09-23T09:00:00Z".to_string()),
                completed_at: None,
            },
            DesktopTask {
                id: "tsk-003".to_string(),
                title: "Calibrate desktop audio buffer for Opus 48kHz".to_string(),
                instruction: "Tune CPAL ring buffer size for Apple Silicon low-latency microphone capture (< 180ms roundtrip).".to_string(),
                status: "pending".to_string(),
                execution_type: "interactive".to_string(),
                project_name: Some("Vox Desktop".to_string()),
                feasibility_reasoning: None,
                execution_result: None,
                due_at: Some("Tomorrow".to_string()),
                created_at: Some("2026-09-23T11:00:00Z".to_string()),
                completed_at: None,
            },
            DesktopTask {
                id: "tsk-004".to_string(),
                title: "Draft release notes for desktop v0.2.0".to_string(),
                instruction: "Summarize native 1200x800 layout, left icon rail, and expanded task manager drawer.".to_string(),
                status: "pending".to_string(),
                execution_type: "manual_human".to_string(),
                project_name: Some("Releases".to_string()),
                feasibility_reasoning: None,
                execution_result: None,
                due_at: Some("Friday".to_string()),
                created_at: Some("2026-09-23T11:30:00Z".to_string()),
                completed_at: None,
            },
        ];
        Self(Mutex::new(initial_tasks))
    }
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

fn handle_oauth_callback_urls(app: &AppHandle, urls: &[url::Url]) {
    for callback in urls.iter().cloned() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let auth = app.state::<AuthManager>();
            match auth.finish_oauth_from_url(&callback).await {
                Ok(state) => {
                    let _ = app.emit("auth-state", &state);
                }
                Err(err) => {
                    eprintln!("oauth callback failed ({callback}): {err}");
                    let _ = app.emit("auth-error", err);
                }
            }
        });
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
async fn set_window_size(
    app: AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        let _ = window.center();
    }
    Ok(())
}

#[tauri::command]
async fn get_tasks(
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<Vec<DesktopTask>, String> {
    let session = auth.current_session();
    let api_url = auth.state().api_url;

    if let Some(session) = session {
        let client = reqwest::Client::new();
        let url = format!("{}/v1/tasks?limit=50", api_url.trim_end_matches('/'));
        if let Ok(resp) = client
            .get(&url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(core_tasks) = resp.json::<Vec<serde_json::Value>>().await {
                    let mut mapped = Vec::new();
                    for val in core_tasks {
                        if let Ok(task) = serde_json::from_value::<DesktopTask>(val) {
                            mapped.push(task);
                        }
                    }
                    if !mapped.is_empty() {
                        let mut guard = tasks.0.lock().map_err(|e| e.to_string())?;
                        *guard = mapped.clone();
                        return Ok(mapped);
                    }
                }
            }
        }
    }

    let guard = tasks.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
async fn create_task(
    payload: CreateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let api_url = auth.state().api_url;

    let new_task = DesktopTask {
        id: uuid::Uuid::new_v4().to_string(),
        title: payload.title.clone(),
        instruction: payload.instruction.clone().unwrap_or_else(|| payload.title.clone()),
        status: "pending".to_string(),
        execution_type: payload.execution_type.clone().unwrap_or_else(|| "autonomous".to_string()),
        project_name: payload.project_name.clone(),
        feasibility_reasoning: None,
        execution_result: None,
        due_at: payload.due_at.clone(),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        completed_at: None,
    };

    if let Some(session) = session {
        let client = reqwest::Client::new();
        let url = format!("{}/v1/tasks", api_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "title": new_task.title,
            "instruction": new_task.instruction,
            "priority": 0,
            "due_at": new_task.due_at,
        });
        let _ = client
            .post(&url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .json(&body)
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await;
    }

    let mut guard = tasks.0.lock().map_err(|e| e.to_string())?;
    guard.insert(0, new_task.clone());
    Ok(new_task)
}

#[tauri::command]
async fn update_task(
    payload: UpdateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let api_url = auth.state().api_url;

    if let Some(session) = session {
        let client = reqwest::Client::new();
        let url = format!("{}/v1/tasks/{}", api_url.trim_end_matches('/'), payload.task_id);
        let mut body = serde_json::Map::new();
        if let Some(ref st) = payload.status {
            body.insert("status".to_string(), serde_json::Value::String(st.clone()));
        }
        if let Some(ref fr) = payload.feasibility_reasoning {
            body.insert("feasibility_reasoning".to_string(), serde_json::Value::String(fr.clone()));
        }
        if let Some(ref er) = payload.execution_result {
            body.insert("execution_result".to_string(), er.clone());
        }
        let _ = client
            .patch(&url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .json(&serde_json::Value::Object(body))
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await;
    }

    let mut guard = tasks.0.lock().map_err(|e| e.to_string())?;
    if let Some(task) = guard.iter_mut().find(|t| t.id == payload.task_id) {
        if let Some(st) = payload.status {
            if st == "completed" && task.status != "completed" {
                task.completed_at = Some(chrono::Utc::now().to_rfc3339());
            } else if st != "completed" {
                task.completed_at = None;
            }
            task.status = st;
        }
        if let Some(fr) = payload.feasibility_reasoning {
            task.feasibility_reasoning = Some(fr);
        }
        if let Some(er) = payload.execution_result {
            task.execution_result = Some(er);
        }
        return Ok(task.clone());
    }

    Err(format!("Task {} not found", payload.task_id))
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
                handle_oauth_callback_urls(app, &urls);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(auth)
        .manage(SessionManager(Mutex::new(None)))
        .manage(TaskManager::new())
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("deep link registration warning: {err}");
                }
            }

            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let vox_urls: Vec<_> = urls
                    .into_iter()
                    .filter(|url| url.scheme() == "vox")
                    .collect();
                if !vox_urls.is_empty() {
                    handle_oauth_callback_urls(&handle, &vox_urls);
                }
            }

            app.deep_link().on_open_url(move |event| {
                handle_oauth_callback_urls(&handle, &event.urls());
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
            call_status,
            set_window_size,
            get_tasks,
            create_task,
            update_task
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let vox_urls: Vec<url::Url> = urls
                    .iter()
                    .filter_map(|u| url::Url::parse(&u.to_string()).ok())
                    .filter(|u| u.scheme() == "vox")
                    .collect();
                if !vox_urls.is_empty() {
                    eprintln!("RunEvent::Opened vox urls: {vox_urls:?}");
                    handle_oauth_callback_urls(app, &vox_urls);
                }
            }

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let vox_urls: Vec<_> = urls
                        .into_iter()
                        .filter(|url| url.scheme() == "vox")
                        .collect();
                    if !vox_urls.is_empty() {
                        eprintln!("Reopen get_current vox urls: {vox_urls:?}");
                        handle_oauth_callback_urls(app, &vox_urls);
                    }
                }
            }
        });
}
