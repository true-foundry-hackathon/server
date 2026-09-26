use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::audio::AudioEngine;
use crate::session_store::StoredSession;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateDesktopSessionRequest {
    #[serde(default)]
    pub external_conversation_id: Option<String>,
    #[serde(default)]
    pub opening_instruction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateDesktopSessionResponse {
    pub ticket: String,
    pub stream_url: String,
    pub expires_in_seconds: u64,
    #[serde(default)]
    pub host_user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DesktopInboundText {
    Start {
        #[serde(default)]
        client_version: Option<String>,
    },
    Mark {
        name: String,
    },
    Stop,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DesktopOutboundText {
    Connected {
        session_id: String,
        sample_rate: u32,
        format: String,
    },
    Mark {
        name: String,
    },
    Clear,
}

pub async fn run_session_loop(
    bridge_url: String,
    session: StoredSession,
    is_running: Arc<AtomicBool>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    mut stop_rx: oneshot::Receiver<()>,
    mic_level: Arc<AtomicU32>,
) -> Result<(), String> {
    let clean_bridge = bridge_url.trim_end_matches('/');
    let session_url = format!("{clean_bridge}/bridge/desktop/voice/session");

    let client = reqwest::Client::new();
    let resp = match client
        .post(&session_url)
        .header("authorization", format!("Bearer {}", session.vox_token))
        .json(&CreateDesktopSessionRequest {
            external_conversation_id: None,
            opening_instruction: None,
        })
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            let msg = format!("Failed to request session from Bridge: {e}");
            let _ = ready_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("Bridge session request failed with status {status}: {body}");
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }

    let session_data = match resp.json::<CreateDesktopSessionResponse>().await {
        Ok(data) => data,
        Err(e) => {
            let msg = format!("Invalid session response from Bridge: {e}");
            let _ = ready_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };

    let ws_base = if clean_bridge.starts_with("https://") {
        clean_bridge.replacen("https://", "wss://", 1)
    } else if clean_bridge.starts_with("http://") {
        clean_bridge.replacen("http://", "ws://", 1)
    } else {
        format!("ws://{clean_bridge}")
    };

    let stream_path = if session_data.stream_url.starts_with('/') {
        session_data.stream_url.clone()
    } else {
        format!("/{}", session_data.stream_url)
    };
    let full_ws_url = format!("{ws_base}{stream_path}");

    let (ws_stream, _) = match connect_async(&full_ws_url).await {
        Ok(conn) => conn,
        Err(e) => {
            let msg = format!("Failed to connect to Bridge WebSocket stream: {e}");
            let _ = ready_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    let (mic_tx, mut mic_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (mark_tx, mut mark_rx) = mpsc::unbounded_channel::<String>();

    let audio_engine = match AudioEngine::start(mic_tx, mark_tx, mic_level) {
        Ok(engine) => engine,
        Err(e) => {
            let _ = ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };

    let start_msg = DesktopInboundText::Start {
        client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
    };
    let start_json = match serde_json::to_string(&start_msg) {
        Ok(json) => json,
        Err(e) => {
            let msg = format!("Serialization error: {e}");
            let _ = ready_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };
    if let Err(e) = ws_sender.send(Message::text(start_json)).await {
        let msg = format!("Failed to send start message: {e}");
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }

    is_running.store(true, Ordering::SeqCst);
    let _ = ready_tx.send(Ok(()));

    loop {
        tokio::select! {
            _ = &mut stop_rx => {
                let stop_msg = DesktopInboundText::Stop;
                if let Ok(stop_json) = serde_json::to_string(&stop_msg) {
                    let _ = ws_sender.send(Message::text(stop_json)).await;
                }
                let _ = ws_sender.close().await;
                break;
            }
            Some(mic_bytes) = mic_rx.recv() => {
                if ws_sender.send(Message::binary(mic_bytes)).await.is_err() {
                    break;
                }
            }
            Some(mark_name) = mark_rx.recv() => {
                let mark_msg = DesktopInboundText::Mark { name: mark_name };
                if let Ok(mark_json) = serde_json::to_string(&mark_msg) {
                    if ws_sender.send(Message::text(mark_json)).await.is_err() {
                        break;
                    }
                }
            }
            inbound = ws_receiver.next() => {
                match inbound {
                    Some(Ok(Message::Binary(bytes))) => {
                        audio_engine.enqueue_audio(&bytes);
                    }
                    Some(Ok(Message::Text(raw))) => {
                        if let Ok(event) = serde_json::from_str::<DesktopOutboundText>(&raw) {
                            match event {
                                DesktopOutboundText::Clear => {
                                    audio_engine.clear_playback();
                                }
                                DesktopOutboundText::Mark { name } => {
                                    audio_engine.enqueue_mark(name);
                                }
                                DesktopOutboundText::Connected { .. } => {}
                            }
                        } else if raw.contains("\"clear\"") {
                            audio_engine.clear_playback();
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = ws_sender.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => {
                        break;
                    }
                }
            }
        }
    }

    is_running.store(false, Ordering::SeqCst);
    Ok(())
}
