/**
* Persistent read-only WebSocket to Vox Core that signals when the user's
* data (e.g. tasks) changed elsewhere — a phone call, another device — so
* the desktop UI can refetch immediately instead of waiting on its poll
* interval. Always on while signed in; unlike the device-control socket in
* `device_link`, this carries no commands and needs no remote-control
* consent.
*/
use crate::auth::AuthManager;
use futures_util::StreamExt;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

const RETRY_DELAY: Duration = Duration::from_secs(5);

fn socket_url(api_url: &str) -> String {
    let clean = api_url.trim_end_matches('/');
    let base = if let Some(rest) = clean.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = clean.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{clean}")
    };
    format!("{base}/v1/me/events/socket")
}

async fn connect_and_listen(app: &AppHandle, api_url: &str, vox_token: &str) -> Result<(), String> {
    let url = socket_url(api_url);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid live socket url: {e}"))?;
    let header_value = HeaderValue::from_str(&format!("Bearer {vox_token}"))
        .map_err(|e| format!("invalid auth header: {e}"))?;
    request.headers_mut().insert("authorization", header_value);

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("live socket connect failed: {e}"))?;
    let (_sender, mut receiver) = ws_stream.split();

    while let Some(message) = receiver.next().await {
        let Ok(message) = message else { break };
        let Message::Text(text) = message else { continue };
        let _ = app.emit("vox-live-update", text.to_string());
    }
    Ok(())
}

/// Runs forever: while signed in, keeps a live socket to Core open so a task
/// created or updated anywhere (a call, another device, the app itself)
/// pushes into this UI instead of waiting on the next poll. Reconnects on
/// any drop.
// ponytail: fixed retry delay, no exponential backoff — same tradeoff as
// device_link's supervisor, add if reconnect storms ever matter.
pub async fn run_supervisor(app: AppHandle) {
    loop {
        let auth = app.state::<AuthManager>();
        if let Err(err) = auth.refresh_if_expiring().await {
            eprintln!("Vox session refresh failed: {err}");
        }
        let Some(session) = auth.current_session() else {
            tokio::time::sleep(RETRY_DELAY).await;
            continue;
        };
        let api_url = auth.config().api_url.clone();

        if let Err(err) = connect_and_listen(&app, &api_url, &session.vox_token).await {
            eprintln!("Vox live socket disconnected: {err}");
        }
        tokio::time::sleep(RETRY_DELAY).await;
    }
}
