mod audio;
mod auth;
mod client;
mod codec;
mod config;
#[cfg(target_os = "macos")]
mod macos_location;

use auth::{AuthManager, AuthState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
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
    mic_level: Arc<AtomicU32>,
}

pub struct SessionManager(Mutex<Option<ActiveSession>>);

#[derive(Clone, Debug, Serialize)]
pub struct CallStatus {
    pub active: bool,
    pub state: String,
    pub mic_level: f32,
    pub is_speaking: bool,
}

fn default_execution_type() -> String {
    "autonomous".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DesktopTask {
    pub id: String,
    pub title: String,
    #[serde(default, alias = "raw_instruction")]
    pub instruction: String,
    pub status: String,
    #[serde(default = "default_execution_type")]
    pub execution_type: String,
    #[serde(default, alias = "project_id", alias = "collection_id")]
    pub project_name: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_collection_kind")]
    pub kind: String,
    #[serde(default = "default_collection_status")]
    pub status: String,
}

fn default_collection_kind() -> String {
    "project".to_string()
}

fn default_collection_status() -> String {
    "active".to_string()
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateTaskPayload {
    pub title: String,
    pub instruction: Option<String>,
    pub execution_type: Option<String>,
    pub project_name: Option<String>,
    pub collection_id: Option<String>,
    pub due_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdateTaskPayload {
    pub task_id: String,
    pub status: Option<String>,
    pub feasibility_reasoning: Option<String>,
    pub execution_result: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct GetTasksArgs {
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default)]
    pub page_size: Option<usize>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct PaginatedTasks {
    pub items: Vec<DesktopTask>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
}

pub struct TaskManager {
    tasks: Mutex<Vec<DesktopTask>>,
    db_path: PathBuf,
}

impl TaskManager {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let db_dir = PathBuf::from(home).join(".config").join("vox");
        let _ = std::fs::create_dir_all(&db_dir);
        let db_path = db_dir.join("tasks_db.json");

        let mut initial_tasks = Vec::new();
        if db_path.exists() {
            if let Ok(file_content) = std::fs::read_to_string(&db_path) {
                if let Ok(saved) = serde_json::from_str::<Vec<DesktopTask>>(&file_content) {
                    initial_tasks = saved;
                }
            }
        }
        if initial_tasks.is_empty() {
            initial_tasks = vec![
                DesktopTask {
                    id: "tsk-001".to_string(),
                    title: "Summarize Q3 voice pipeline benchmarks".to_string(),
                    instruction: "Analyze voice session logs, measure P95 latency and packet loss metrics across desktop channels.".to_string(),
                    status: "completed".to_string(),
                    execution_type: "autonomous".to_string(),
                    project_name: Some("Vox Core".to_string()),
                    collection_id: None,
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
                    collection_id: None,
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
                    collection_id: None,
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
                    collection_id: None,
                    feasibility_reasoning: None,
                    execution_result: None,
                    due_at: Some("Friday".to_string()),
                    created_at: Some("2026-09-23T11:30:00Z".to_string()),
                    completed_at: None,
                },
            ];
            if let Ok(json) = serde_json::to_string_pretty(&initial_tasks) {
                let _ = std::fs::write(&db_path, json);
            }
        }

        Self {
            tasks: Mutex::new(initial_tasks),
            db_path,
        }
    }

    fn save_to_disk(&self, tasks: &[DesktopTask]) {
        if let Ok(json) = serde_json::to_string_pretty(tasks) {
            let _ = std::fs::write(&self.db_path, json);
        }
    }

    pub fn merge_tasks(&self, remote_tasks: &[DesktopTask]) {
        if let Ok(mut lock) = self.tasks.lock() {
            for remote in remote_tasks {
                if let Some(pos) = lock.iter().position(|t| t.id == remote.id) {
                    lock[pos] = remote.clone();
                } else {
                    lock.push(remote.clone());
                }
            }
            lock.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            self.save_to_disk(&lock);
        }
    }

    pub fn insert_task(&self, task: DesktopTask) {
        if let Ok(mut lock) = self.tasks.lock() {
            lock.retain(|t| t.id != task.id);
            lock.insert(0, task);
            self.save_to_disk(&lock);
        }
    }

    pub fn update_task(&self, payload: &UpdateTaskPayload) -> Result<DesktopTask, String> {
        let mut lock = self.tasks.lock().map_err(|e| e.to_string())?;
        if let Some(task) = lock.iter_mut().find(|t| t.id == payload.task_id) {
            if let Some(ref st) = payload.status {
                if st == "completed" && task.status != "completed" {
                    task.completed_at = Some(chrono::Utc::now().to_rfc3339());
                } else if st != "completed" {
                    task.completed_at = None;
                }
                task.status = st.clone();
            }
            if let Some(ref fr) = payload.feasibility_reasoning {
                task.feasibility_reasoning = Some(fr.clone());
            }
            if let Some(ref er) = payload.execution_result {
                task.execution_result = Some(er.clone());
            }
            let updated = task.clone();
            self.save_to_disk(&lock);
            Ok(updated)
        } else {
            Err(format!("Task {} not found", payload.task_id))
        }
    }

    pub fn filter_and_paginate(
        &self,
        args: &GetTasksArgs,
        page: usize,
        page_size: usize,
    ) -> PaginatedTasks {
        let lock = match self.tasks.lock() {
            Ok(l) => l.clone(),
            Err(_) => Vec::new(),
        };

        let status_filter = args.status.as_deref().unwrap_or("all");
        let search = args
            .search
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();

        let filtered: Vec<DesktopTask> = lock
            .into_iter()
            .filter(|t| {
                let matches_status = match status_filter {
                    "all" => true,
                    "pending" => {
                        t.status == "pending"
                            || t.status == "evaluating"
                            || t.status == "waiting_user"
                    }
                    "executing" => t.status == "executing" || t.status == "running",
                    "completed" => t.status == "completed",
                    _ => t.status == status_filter,
                };
                let matches_search = if search.is_empty() {
                    true
                } else {
                    t.title.to_lowercase().contains(&search)
                        || t.instruction.to_lowercase().contains(&search)
                        || t.project_name
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&search)
                };
                let matches_collection = match args.collection_id.as_deref() {
                    None => true,
                    Some(cid) if cid.is_empty() => true,
                    Some(cid) => t.collection_id.as_deref() == Some(cid),
                };
                matches_status && matches_search && matches_collection
            })
            .collect();

        let total = filtered.len();
        let total_pages = if total == 0 {
            1
        } else {
            (total + page_size - 1) / page_size
        };
        let offset = (page - 1) * page_size;
        let items = filtered.into_iter().skip(offset).take(page_size).collect();

        PaginatedTasks {
            items,
            total,
            page,
            page_size,
            total_pages,
        }
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
async fn set_window_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        let _ = window.center();
    }
    Ok(())
}

#[tauri::command]
async fn center_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.center();
    }
    Ok(())
}

#[tauri::command]
async fn get_collections(auth: State<'_, AuthManager>) -> Result<Vec<Collection>, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let url = format!("{}/v1/collections", config.api_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("authorization", format!("Bearer {}", session.vox_token))
        .timeout(std::time::Duration::from_millis(5000))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("collections request failed: {}", resp.status()));
    }
    resp.json::<Vec<Collection>>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_collection(
    name: String,
    description: Option<String>,
    kind: Option<String>,
    auth: State<'_, AuthManager>,
) -> Result<Collection, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let url = format!("{}/v1/collections", config.api_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "name": name,
        "description": description.unwrap_or_default(),
        "kind": kind.unwrap_or_else(|| "project".to_string()),
    });
    let resp = client
        .post(&url)
        .header("authorization", format!("Bearer {}", session.vox_token))
        .json(&body)
        .timeout(std::time::Duration::from_millis(5000))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("create collection failed: {}", resp.status()));
    }
    resp.json::<Collection>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn archive_collection(id: String, auth: State<'_, AuthManager>) -> Result<(), String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let url = format!(
        "{}/v1/collections/{}",
        config.api_url.trim_end_matches('/'),
        id
    );
    let resp = client
        .delete(&url)
        .header("authorization", format!("Bearer {}", session.vox_token))
        .timeout(std::time::Duration::from_millis(5000))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("archive collection failed: {}", resp.status()))
    }
}

#[tauri::command]
async fn get_tasks(
    args: Option<GetTasksArgs>,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<PaginatedTasks, String> {
    let args = args.unwrap_or_default();
    let page = args.page.unwrap_or(1).max(1);
    let page_size = args.page_size.unwrap_or(10).clamp(1, 50);
    let offset = (page - 1) * page_size;
    let limit = page_size;

    let session = auth.current_session();
    let config = auth.config();

    if let Some(session) = &session {
        let client = reqwest::Client::new();

        // 1. Direct Supabase PostgREST query to DB
        let mut sb_url = format!(
            "{}/rest/v1/tasks?select=*&order=created_at.desc&limit={}&offset={}",
            config.supabase_url.trim_end_matches('/'),
            limit,
            offset
        );
        if let Some(status) = &args.status {
            if status != "all" && !status.is_empty() {
                sb_url.push_str(&format!("&status=eq.{}", status));
            }
        }
        if let Some(search) = &args.search {
            let q = search.trim();
            if !q.is_empty() {
                sb_url.push_str(&format!("&title=ilike.*{}*", q));
            }
        }
        if let Some(cid) = &args.collection_id {
            if !cid.is_empty() {
                sb_url.push_str(&format!("&collection_id=eq.{}", cid));
            }
        }

        if let Ok(resp) = client
            .get(&sb_url)
            .header("apikey", &config.supabase_anon_key)
            .header("authorization", format!("Bearer {}", session.access_token))
            .header("prefer", "count=exact")
            .timeout(std::time::Duration::from_millis(3000))
            .send()
            .await
        {
            if resp.status().is_success() {
                let count_header = resp
                    .headers()
                    .get("content-range")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|s| s.split('/').last())
                    .and_then(|s| s.parse::<usize>().ok());

                if let Ok(db_tasks) = resp.json::<Vec<DesktopTask>>().await {
                    let total = count_header.unwrap_or(db_tasks.len());
                    let total_pages = if total == 0 {
                        1
                    } else {
                        (total + page_size - 1) / page_size
                    };
                    tasks.merge_tasks(&db_tasks);

                    return Ok(PaginatedTasks {
                        items: db_tasks,
                        total,
                        page,
                        page_size,
                        total_pages,
                    });
                }
            }
        }

        // 2. Vox Core API query to DB
        let mut core_url = format!(
            "{}/v1/tasks?limit={}&offset={}",
            config.api_url.trim_end_matches('/'),
            limit,
            offset
        );
        if let Some(cid) = &args.collection_id {
            if !cid.is_empty() {
                core_url.push_str(&format!("&collection_id={}", cid));
            }
        }
        if let Ok(resp) = client
            .get(&core_url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(core_tasks) = resp.json::<Vec<DesktopTask>>().await {
                    tasks.merge_tasks(&core_tasks);
                    return Ok(tasks.filter_and_paginate(&args, page, page_size));
                }
            }
        }
    }

    // 3. Fallback to local persistent DB cache with pagination
    Ok(tasks.filter_and_paginate(&args, page, page_size))
}

#[tauri::command]
async fn create_task(
    payload: CreateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let config = auth.config();
    let now = chrono::Utc::now().to_rfc3339();

    let new_task = DesktopTask {
        id: uuid::Uuid::new_v4().to_string(),
        title: payload.title.clone(),
        instruction: payload
            .instruction
            .clone()
            .unwrap_or_else(|| payload.title.clone()),
        status: "pending".to_string(),
        execution_type: payload
            .execution_type
            .clone()
            .unwrap_or_else(|| "autonomous".to_string()),
        project_name: payload.project_name.clone(),
        collection_id: payload.collection_id.clone(),
        feasibility_reasoning: None,
        execution_result: None,
        due_at: payload.due_at.clone(),
        created_at: Some(now.clone()),
        completed_at: None,
    };

    if let Some(session) = &session {
        let client = reqwest::Client::new();
        // Insert to Supabase DB
        let sb_url = format!(
            "{}/rest/v1/tasks",
            config.supabase_url.trim_end_matches('/')
        );
        let mut sb_body = serde_json::json!({
            "title": new_task.title,
            "raw_instruction": new_task.instruction,
            "status": new_task.status,
            "execution_type": new_task.execution_type,
            "user_id": session.user_id,
        });
        if let Some(due) = &new_task.due_at {
            sb_body["due_at"] = serde_json::json!(due);
        }
        if let Some(cid) = &new_task.collection_id {
            if !cid.is_empty() {
                sb_body["collection_id"] = serde_json::json!(cid);
            }
        }
        let _ = client
            .post(&sb_url)
            .header("apikey", &config.supabase_anon_key)
            .header("authorization", format!("Bearer {}", session.access_token))
            .header("prefer", "return=representation")
            .json(&sb_body)
            .timeout(std::time::Duration::from_millis(3000))
            .send()
            .await;

        // Also post to Vox Core API
        let core_url = format!("{}/v1/tasks", config.api_url.trim_end_matches('/'));
        let mut body = serde_json::json!({
            "title": new_task.title,
            "instruction": new_task.instruction,
            "priority": 0,
            "due_at": new_task.due_at,
        });
        if let Some(cid) = &new_task.collection_id {
            if !cid.is_empty() {
                if let Ok(parsed) = uuid::Uuid::parse_str(cid) {
                    body["collection_id"] = serde_json::json!(parsed);
                }
            }
        }
        let _ = client
            .post(&core_url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .json(&body)
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await;
    }

    tasks.insert_task(new_task.clone());
    Ok(new_task)
}

#[tauri::command]
async fn update_task(
    payload: UpdateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let config = auth.config();

    if let Some(session) = &session {
        let client = reqwest::Client::new();
        let sb_url = format!(
            "{}/rest/v1/tasks?id=eq.{}",
            config.supabase_url.trim_end_matches('/'),
            payload.task_id
        );
        let mut sb_patch = serde_json::json!({});
        if let Some(ref st) = payload.status {
            sb_patch["status"] = serde_json::json!(st);
            if st == "completed" {
                sb_patch["completed_at"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
            }
        }
        if let Some(ref er) = payload.execution_result {
            sb_patch["execution_result"] = er.clone();
        }
        let _ = client
            .patch(&sb_url)
            .header("apikey", &config.supabase_anon_key)
            .header("authorization", format!("Bearer {}", session.access_token))
            .json(&sb_patch)
            .timeout(std::time::Duration::from_millis(3000))
            .send()
            .await;

        let core_url = format!(
            "{}/v1/tasks/{}",
            config.api_url.trim_end_matches('/'),
            payload.task_id
        );
        let mut body = serde_json::Map::new();
        if let Some(ref st) = payload.status {
            body.insert("status".to_string(), serde_json::Value::String(st.clone()));
        }
        if let Some(ref fr) = payload.feasibility_reasoning {
            body.insert(
                "feasibility_reasoning".to_string(),
                serde_json::Value::String(fr.clone()),
            );
        }
        if let Some(ref er) = payload.execution_result {
            body.insert("execution_result".to_string(), er.clone());
        }
        let _ = client
            .patch(&core_url)
            .header("authorization", format!("Bearer {}", session.vox_token))
            .json(&serde_json::Value::Object(body))
            .timeout(std::time::Duration::from_millis(2000))
            .send()
            .await;
    }

    tasks.update_task(&payload)
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
            Ok(status_from_phase(PHASE_ACTIVE, true, 0.0))
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
    Ok(status_from_phase(PHASE_IDLE, false, 0.0))
}

#[tauri::command]
fn call_status(state: State<'_, SessionManager>) -> Result<CallStatus, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Wrap in catch_unwind: dotenvy 0.15.7 panics on malformed .env files.
    let _ = std::panic::catch_unwind(|| {
        dotenvy::from_filename("../.env").ok();
        dotenvy::dotenv().ok();
    });

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
            center_window,
            start_call,
            end_call,
            call_status,
            set_window_size,
            get_tasks,
            create_task,
            update_task,
            get_collections,
            create_collection,
            archive_collection,
            #[cfg(target_os = "macos")]
            macos_location::get_native_location
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
