/**
* Device self-registration and the persistent real-time connection to Vox
* Core, used to receive live terminal commands during a phone call.
*\n* Remote control is opt-in: it stays off until the user turns it on in the
* app, and while off this Mac never opens the socket, so the agent cannot
* reach it. Every command received is appended to a local log.
*/
use crate::auth::AuthManager;
use crate::terminal::TerminalManager;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

const RETRY_DELAY: Duration = Duration::from_secs(5);

const LINK_DISCONNECTED: u8 = 0;
const LINK_CONNECTING: u8 = 1;
const LINK_CONNECTED: u8 = 2;
const LINK_DISABLED: u8 = 3;

/// Live status of the desktop's socket to Vox Core — whether the Vox agent
/// running on the server currently has a channel to control this machine.
#[derive(Default)]
pub struct DeviceLinkState(AtomicU8);

#[derive(Debug, Serialize)]
pub struct DeviceLinkStatus {
    status: &'static str,
}

fn link_status_str(phase: u8) -> &'static str {
    match phase {
        LINK_CONNECTING => "connecting",
        LINK_CONNECTED => "connected",
        LINK_DISABLED => "disabled",
        _ => "disconnected",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalEvent {
    pub id: String,
    pub timestamp: String,
    pub kind: String, // "system" | "command" | "output" | "status" | "success" | "error"
    pub text: String,
}

#[derive(Default, Clone)]
pub struct EventLog(pub std::sync::Arc<std::sync::Mutex<Vec<LocalEvent>>>);

pub fn emit_local_event(app: &AppHandle, kind: &str, text: &str) {
    let now = chrono::Local::now().format("%H:%M:%S").to_string();
    let event = LocalEvent {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: now,
        kind: kind.to_string(),
        text: text.to_string(),
    };
    if let Some(state) = app.try_state::<EventLog>() {
        if let Ok(mut buf) = state.0.lock() {
            buf.push(event.clone());
            if buf.len() > 300 {
                buf.remove(0);
            }
        }
    }
    let _ = app.emit("local-agent-event", &event);
}

#[tauri::command]
pub fn get_local_events(state: State<'_, EventLog>) -> Vec<LocalEvent> {
    let mut events = state.0.lock().map(|g| g.clone()).unwrap_or_default();
    if events.is_empty() {
        let log_path = vox_config_dir().join("remote-commands.log");
        if let Ok(content) = std::fs::read_to_string(&log_path) {
            for line in content.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    events.push(LocalEvent {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                        kind: "command".to_string(),
                        text: trimmed.to_string(),
                    });
                }
            }
        }
    }
    events
}

#[tauri::command]
pub fn get_device_link_status(state: State<'_, DeviceLinkState>) -> DeviceLinkStatus {
    DeviceLinkStatus {
        status: link_status_str(state.0.load(Ordering::SeqCst)),
    }
}

/// The user's consent for the agent to run commands on this Mac. Off by
/// default; persisted as a marker file next to the device identifier.
pub struct RemoteControl(watch::Sender<bool>);

impl RemoteControl {
    pub fn load() -> Self {
        Self(watch::Sender::new(remote_control_path().exists()))
    }
}

fn remote_control_path() -> PathBuf {
    vox_config_dir().join("remote_control_enabled")
}

/// Whether the local Gemma model has been downloaded — the capability signal
/// is "has the model," not a hardware guess. Set once by a successful
/// download; there's no separate on/off toggle for v1, since a multi-GB
/// model the user just fetched should just work.
pub struct LocalModelReady(pub(crate) watch::Sender<bool>);

impl LocalModelReady {
    pub fn load() -> Self {
        Self(watch::Sender::new(crate::local_llm::is_model_downloaded()))
    }
}

#[tauri::command]
pub fn is_local_model_ready(state: State<'_, LocalModelReady>) -> bool {
    *state.0.borrow()
}

/// Combines remote-control consent and local-model readiness into one
/// signal: the device socket should be open whenever either capability
/// needs it, even though they're independent consents.
fn combined_link_enabled(app: &AppHandle) -> watch::Receiver<bool> {
    let mut remote = app.state::<RemoteControl>().0.subscribe();
    let mut local = app.state::<LocalModelReady>().0.subscribe();
    let (tx, rx) = watch::channel(*remote.borrow() || *local.borrow());
    tokio::spawn(async move {
        loop {
            if tx.send(*remote.borrow() || *local.borrow()).is_err() {
                break;
            }
            tokio::select! {
                res = remote.changed() => if res.is_err() { break },
                res = local.changed() => if res.is_err() { break },
            }
        }
    });
    rx
}

#[tauri::command]
pub fn get_remote_control(state: State<'_, RemoteControl>) -> bool {
    *state.0.borrow()
}

#[tauri::command]
pub fn set_remote_control(state: State<'_, RemoteControl>, enabled: bool) -> Result<bool, String> {
    let path = remote_control_path();
    if enabled {
        std::fs::write(&path, b"").map_err(|e| e.to_string())?;
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    state.0.send_replace(enabled);
    Ok(enabled)
}

/// Appends one line per remote command so the user can see what ran here.
fn log_remote_command(command: &str, outcome: &str) {
    use std::io::Write;
    let line = format!(
        "{} {outcome}: {}\n",
        chrono::Utc::now().to_rfc3339(),
        command.replace('\n', " ")
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(vox_config_dir().join("remote-commands.log"))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[derive(Debug, Deserialize)]
struct RegisterDeviceResponse {
    id: String,
}

pub(crate) fn vox_config_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".config").join("vox");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn device_identifier_path() -> PathBuf {
    vox_config_dir().join("device_identifier")
}

/// A stable id for this install, persisted locally (mirrors how tasks are
/// cached under the same `~/.config/vox` directory).
fn local_device_identifier() -> String {
    let path = device_identifier_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&path, &id);
    id
}

fn device_label() -> String {
    std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .and_then(|out| {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        })
        .unwrap_or_else(|| "Mac".to_string())
}

async fn register_device(
    api_url: &str,
    vox_token: &str,
    device_identifier: &str,
    execution_consent: bool,
    local_llm_ready: bool,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/devices", api_url.trim_end_matches('/'));
    let body = json!({
        "device_identifier": device_identifier,
        "platform": format!("macos-{}", std::env::consts::ARCH),
        "label": device_label(),
        "execution_consent": execution_consent,
        "capabilities": { "local_llm": local_llm_ready, "local_llm_model": "gemma-2b" },
    });
    let resp = client
        .post(&url)
        .header("authorization", format!("Bearer {vox_token}"))
        .json(&body)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("device registration failed: {}", resp.status()));
    }
    resp.json::<RegisterDeviceResponse>()
        .await
        .map(|r| r.id)
        .map_err(|e| e.to_string())
}

fn socket_url(api_url: &str, device_id: &str) -> String {
    let clean = api_url.trim_end_matches('/');
    let base = if let Some(rest) = clean.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = clean.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{clean}")
    };
    format!("{base}/v1/devices/{device_id}/socket")
}

async fn handle_frame(app: &AppHandle, terminal: &TerminalManager, frame: Value) -> Value {
    let id = frame.get("id").cloned().unwrap_or(Value::Null);
    let kind = frame.get("type").and_then(Value::as_str).unwrap_or("");

    match kind {
        "open_shell" => {
            emit_local_event(app, "system", "Vox requested interactive terminal shell");
            let terminal = terminal.clone();
            let result = tokio::task::spawn_blocking(move || terminal.open_shell()).await;
            match result {
                Ok(Ok(())) => {
                    emit_local_event(app, "status", "Terminal session ready on MacBook");
                    json!({ "id": id, "ok": true })
                }
                Ok(Err(err)) => {
                    emit_local_event(app, "error", &format!("Failed to open shell: {err}"));
                    json!({ "id": id, "ok": false, "error": err })
                }
                Err(err) => {
                    emit_local_event(app, "error", &format!("Shell spawn error: {err}"));
                    json!({ "id": id, "ok": false, "error": err.to_string() })
                }
            }
        }
        "run_command" => {
            let command = frame
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            emit_local_event(app, "command", &format!("$ {command}"));
            emit_local_event(app, "system", "Executing on MacBook...");
            let terminal = terminal.clone();
            let logged = command.clone();
            let app_clone = app.clone();
            let result = tokio::task::spawn_blocking(move || terminal.run_command(&command)).await;
            let response = match result {
                Ok(Ok((output, exit_code))) => {
                    for line in output.lines() {
                        let trimmed = line.trim_end();
                        if !trimmed.is_empty() {
                            emit_local_event(&app_clone, "output", trimmed);
                        }
                    }
                    emit_local_event(&app_clone, "success", "Vox reading command output");
                    json!({ "id": id, "ok": true, "output": output, "exit_code": exit_code })
                }
                Ok(Err(err)) => {
                    emit_local_event(&app_clone, "error", &format!("Command failed: {err}"));
                    json!({ "id": id, "ok": false, "error": err })
                }
                Err(err) => {
                    emit_local_event(&app_clone, "error", &format!("Execution error: {err}"));
                    json!({ "id": id, "ok": false, "error": err.to_string() })
                }
            };
            let outcome = if response["ok"] == true { "ran" } else { "failed" };
            log_remote_command(&logged, outcome);
            response
        }
        "classify_sms" => classify_sms_frame(id, &frame).await,
        _ => json!({ "id": id, "ok": false, "error": "unknown command" }),
    }
}

#[cfg(any(target_os = "macos", windows))]
async fn classify_sms_frame(id: Value, frame: &Value) -> Value {
    let sender = frame
        .get("sender")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let body = frame
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let result =
        tokio::task::spawn_blocking(move || crate::local_llm::classify_sms_cached(&sender, &body))
            .await;
    match result {
        Ok(Ok(event)) => json!({
            "id": id,
            "relevant": event.relevant,
            "category": event.category,
            "title": event.title,
        }),
        Ok(Err(err)) => json!({ "id": id, "ok": false, "error": err }),
        Err(err) => json!({ "id": id, "ok": false, "error": err.to_string() }),
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn classify_sms_frame(id: Value, _frame: &Value) -> Value {
    json!({ "id": id, "ok": false, "error": "local model not supported on this platform" })
}

async fn connect_and_serve(
    app: &AppHandle,
    api_url: &str,
    vox_token: &str,
    device_id: &str,
    terminal: &TerminalManager,
    link: &DeviceLinkState,
    consent: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    emit_local_event(app, "system", "Connecting to Vox Core bridge...");
    let url = socket_url(api_url, device_id);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid device socket url: {e}"))?;
    let header_value = HeaderValue::from_str(&format!("Bearer {vox_token}"))
        .map_err(|e| format!("invalid auth header: {e}"))?;
    request.headers_mut().insert("authorization", header_value);

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("device socket connect failed: {e}"))?;
    link.0.store(LINK_CONNECTED, Ordering::SeqCst);
    emit_local_event(app, "status", "Device bridge connected — remote control ready");
    let (mut sender, mut receiver) = ws_stream.split();

    loop {
        let message = tokio::select! {
            message = receiver.next() => message,
            // Turning remote control off closes the link immediately.
            _ = async { consent.wait_for(|enabled| !enabled).await.map(drop) } => {
                let _ = sender.close().await;
                emit_local_event(app, "status", "Remote control disabled by user");
                return Ok(());
            }
        };
        let Some(message) = message else { break };
        let message = message.map_err(|e| e.to_string())?;
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(frame) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let response = handle_frame(app, terminal, frame).await;
        if sender
            .send(Message::Text(response.to_string().into()))
            .await
            .is_err()
        {
            break;
        }
    }

    emit_local_event(app, "status", "Device bridge socket disconnected");
    Ok(())
}

/// Runs forever: while signed in with remote control enabled, registers this
/// device (an idempotent upsert, so a different signed-in account or a
/// consent change is picked up) and keeps a live socket to Core open so it
/// can receive terminal commands. Reconnects on any drop.
// ponytail: fixed retry delay, no exponential backoff — add if reconnect
// storms against a struggling Core ever become a real problem.
pub async fn run_supervisor(app: AppHandle) {
    let terminal = TerminalManager::default();
    let device_identifier = local_device_identifier();
    let mut remote_control = app.state::<RemoteControl>().0.subscribe();
    let mut link_enabled = combined_link_enabled(&app);

    loop {
        let link = app.state::<DeviceLinkState>();
        let auth = app.state::<AuthManager>();
        if let Err(err) = auth.refresh_if_expiring().await {
            eprintln!("Vox session refresh failed: {err}");
        }
        let Some(session) = auth.current_session() else {
            link.0.store(LINK_DISCONNECTED, Ordering::SeqCst);
            tokio::time::sleep(RETRY_DELAY).await;
            continue;
        };
        let api_url = auth.config().api_url.clone();

        let remote_enabled = *remote_control.borrow_and_update();
        let local_ready = *app.state::<LocalModelReady>().0.borrow();
        let enabled = remote_enabled || local_ready;
        if !enabled {
            link.0.store(LINK_DISABLED, Ordering::SeqCst);
            // Tell Core consent is withdrawn, then wait for either capability.
            let _ =
                register_device(&api_url, &session.vox_token, &device_identifier, false, false)
                    .await;
            emit_local_event(&app, "status", "Device bridge currently disabled");
            let _ = link_enabled.wait_for(|enabled| *enabled).await;
            continue;
        }

        link.0.store(LINK_CONNECTING, Ordering::SeqCst);
        let device_id = match register_device(
            &api_url,
            &session.vox_token,
            &device_identifier,
            remote_enabled,
            local_ready,
        )
        .await
        {
            Ok(id) => id,
            Err(err) => {
                eprintln!("Vox device registration failed: {err}");
                link.0.store(LINK_DISCONNECTED, Ordering::SeqCst);
                tokio::time::sleep(RETRY_DELAY).await;
                continue;
            }
        };

        if let Err(err) = connect_and_serve(
            &app,
            &api_url,
            &session.vox_token,
            &device_id,
            &terminal,
            link.inner(),
            &mut link_enabled,
        )
        .await
        {
            eprintln!("Vox device socket disconnected: {err}");
        }
        link.0.store(LINK_DISCONNECTED, Ordering::SeqCst);
        let still_enabled = *link_enabled.borrow();
        if still_enabled {
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }
}
