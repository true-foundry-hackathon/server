#![allow(non_snake_case)]

use crate::icons::{CoralDiamond, GoogleIcon, Kbd, PhoneIcon, PhoneOffIcon};
use crate::orb::{OrbState, ThinkingOrbScript, VoxLogo};
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

static CSS: Asset = asset!("/assets/styles.css");

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["window", "__TAURI__", "core"], catch)]
    async fn invoke(cmd: &str, args: JsValue) -> Result<JsValue, JsValue>;
}

#[derive(Serialize, Deserialize)]
struct EmptyArgs {}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
struct AuthState {
    signed_in: bool,
    user_id: Option<String>,
    email: Option<String>,
    bridge_url: String,
    api_url: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
struct CallStatus {
    active: bool,
    state: String,
}

async fn sleep_ms(ms: i32) {
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let win = match web_sys::window() {
            Some(w) => w,
            None => return,
        };
        let _ = win.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
    });
    let _ = JsFuture::from(promise).await;
}

fn parse_auth_state(value: &JsValue) -> AuthState {
    serde_wasm_bindgen::from_value(value.clone()).unwrap_or_default()
}

fn parse_call_status(value: &JsValue) -> CallStatus {
    serde_wasm_bindgen::from_value(value.clone()).unwrap_or_default()
}

fn invoke_error_message(value: &JsValue) -> String {
    js_sys::Reflect::get(value, &JsValue::from_str("message"))
        .ok()
        .and_then(|v| v.as_string())
        .or_else(|| value.as_string())
        .unwrap_or_else(|| "Something went wrong".to_string())
}

fn status_label(state: &str, error: &str) -> String {
    if !error.is_empty() {
        return error.to_string();
    }
    match state {
        "connecting" => "Connecting…".to_string(),
        "active" => "On a call".to_string(),
        "ended" => "Call ended".to_string(),
        _ => "Ready".to_string(),
    }
}

pub fn App() -> Element {
    let mut auth = use_signal(AuthState::default);
    let mut auth_busy = use_signal(|| false);
    let mut auth_error = use_signal(String::new);
    let mut call_state = use_signal(|| "idle".to_string());
    let mut is_active = use_signal(|| false);
    let mut is_busy = use_signal(|| false);
    let mut call_error = use_signal(String::new);

    use_future(move || async move {
        loop {
            sleep_ms(1000).await;
            if auth().signed_in {
                continue;
            }
            let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
            if let Ok(res) = invoke("get_auth_state", args).await {
                let next = parse_auth_state(&res);
                if next.signed_in {
                    auth.set(next);
                    auth_busy.set(false);
                    auth_error.set(String::new());
                }
            }
        }
    });

    use_future(move || async move {
        loop {
            sleep_ms(700).await;
            if !auth().signed_in {
                continue;
            }
            let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
            let Ok(res) = invoke("call_status", args).await else {
                continue;
            };
            let status = parse_call_status(&res);
            if status.state.is_empty() {
                continue;
            }
            call_state.set(status.state.clone());
            is_active.set(status.active);
            if status.state == "idle" || status.state == "ended" {
                is_busy.set(false);
            }
        }
    });

    let google_sign_in = move |_| async move {
        auth_busy.set(true);
        auth_error.set(String::new());
        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
        match invoke("sign_in_with_google", args).await {
            Ok(res) => {
                auth.set(parse_auth_state(&res));
                auth_busy.set(false);
            }
            Err(err) => {
                auth_error.set(invoke_error_message(&err));
                auth_busy.set(false);
            }
        }
    };

    let sign_out = move |_| async move {
        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
        if let Ok(res) = invoke("sign_out", args).await {
            auth.set(parse_auth_state(&res));
        }
        is_active.set(false);
        is_busy.set(false);
        call_state.set("idle".to_string());
        call_error.set(String::new());
    };

    let start_call = move |_| async move {
        if is_busy() || is_active() || !auth().signed_in {
            return;
        }
        is_busy.set(true);
        call_error.set(String::new());
        call_state.set("connecting".to_string());
        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
        match invoke("start_call", args).await {
            Ok(res) => {
                let status = parse_call_status(&res);
                if status.state == "active" || status.active {
                    call_state.set("active".to_string());
                    is_active.set(true);
                    is_busy.set(false);
                } else {
                    call_state.set("idle".to_string());
                    is_active.set(false);
                    is_busy.set(false);
                    call_error.set(invoke_error_message(&res));
                }
            }
            Err(err) => {
                call_state.set("idle".to_string());
                is_active.set(false);
                is_busy.set(false);
                call_error.set(invoke_error_message(&err));
            }
        }
    };

    let end_call = move |_| async move {
        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
        let _ = invoke("end_call", args).await;
        call_state.set("idle".to_string());
        is_active.set(false);
        is_busy.set(false);
        call_error.set(String::new());
    };

    let signed_in = auth().signed_in;
    let active_now = is_active();
    let busy_now = is_busy();
    let state_now = call_state();
    let err_now = call_error();
    let label = status_label(&state_now, &err_now);

    let orb_state = if active_now {
        OrbState::Active
    } else if state_now == "connecting" || busy_now {
        OrbState::Connecting
    } else if !err_now.is_empty() {
        OrbState::Error
    } else {
        OrbState::Idle
    };

    let sub_label = if active_now {
        "Duplex audio channel active • Opus 48kHz"
    } else if state_now == "connecting" || busy_now {
        "Negotiating WebRTC & authentication…"
    } else if !err_now.is_empty() {
        "Connection interrupted. Check bridge status."
    } else {
        "Your voice shortcut to everything. Press Return to talk."
    };

    let account_label = auth()
        .email
        .clone()
        .or_else(|| auth().user_id.clone())
        .unwrap_or_else(|| "Signed in".to_string());

    rsx! {
        link { rel: "stylesheet", href: CSS }
        ThinkingOrbScript {}
        div {
            class: "window-drag-bar",
            "data-tauri-drag-region": true,
        }
        main {
            class: "raycast-shell",
            tabindex: "0",
            onkeydown: move |e: KeyboardEvent| {
                let key_str = e.key().to_string();
                if key_str == "Enter" && signed_in && !active_now && !busy_now {
                    spawn(async move {
                        if is_busy() || is_active() || !auth().signed_in {
                            return;
                        }
                        is_busy.set(true);
                        call_error.set(String::new());
                        call_state.set("connecting".to_string());
                        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
                        match invoke("start_call", args).await {
                            Ok(res) => {
                                let status = parse_call_status(&res);
                                if status.state == "active" || status.active {
                                    call_state.set("active".to_string());
                                    is_active.set(true);
                                    is_busy.set(false);
                                } else {
                                    call_state.set("idle".to_string());
                                    is_active.set(false);
                                    is_busy.set(false);
                                    call_error.set(invoke_error_message(&res));
                                }
                            }
                            Err(err) => {
                                call_state.set("idle".to_string());
                                is_active.set(false);
                                is_busy.set(false);
                                call_error.set(invoke_error_message(&err));
                            }
                        }
                    });
                } else if key_str == "Escape" && (active_now || state_now == "connecting") {
                    spawn(async move {
                        let args = serde_wasm_bindgen::to_value(&EmptyArgs {}).unwrap_or(JsValue::NULL);
                        let _ = invoke("end_call", args).await;
                        call_state.set("idle".to_string());
                        is_active.set(false);
                        is_busy.set(false);
                        call_error.set(String::new());
                    });
                }
            },

            if !signed_in {
                div {
                    class: "intro-layout",
                    "data-tauri-drag-region": true,
                    div {
                        class: "intro-orb-hero",
                        "data-tauri-drag-region": true,
                        VoxLogo {
                            size: 120,
                            animated: true,
                            state: if auth_busy() {
                                OrbState::Connecting
                            } else if !auth_error().is_empty() {
                                OrbState::Error
                            } else {
                                OrbState::Idle
                            },
                        }
                    }
                    div {
                        class: "intro-container",
                        "data-tauri-drag-region": true,
                        div {
                            class: "brand-lockup",
                            "data-tauri-drag-region": true,
                            CoralDiamond {},
                            h1 { class: "brand-title", "Vox" }
                            span { class: "brand-badge", "Desktop" }
                        }
                        p {
                            class: "brand-description",
                            "Use your Vox account to talk to your agent."
                        }
                        div {
                            class: "auth-panel no-drag",
                            button {
                                class: "btn-primary-mist",
                                onclick: google_sign_in,
                                disabled: auth_busy(),
                                GoogleIcon {},
                                span {
                                    if auth_busy() {
                                        "Waiting for Google…"
                                    } else {
                                        "Continue with Google"
                                    }
                                }
                            }
                            if !auth_error().is_empty() {
                                div { class: "callout-error", "{auth_error}" }
                            }
                        }
                        footer {
                            class: "footer-strip",
                            "data-tauri-drag-region": true,
                            span { "v0.1.0" }
                            span { class: "footer-sep", "|" }
                            span { "macOS 13+" }
                            span { class: "footer-sep", "|" }
                            span { "voxagent.in" }
                        }
                    }
                }
            } else {
                div {
                    class: "cockpit-view",
                    "data-tauri-drag-region": true,
                    header {
                        class: "cockpit-header",
                        "data-tauri-drag-region": true,
                        div {
                            class: "cockpit-brand",
                            CoralDiamond {},
                            VoxLogo {
                                size: 20,
                                animated: true,
                                state: orb_state,
                            }
                            span { class: "brand-label", "Vox" }
                            span { class: "brand-badge", "Desktop" }
                        }
                        div {
                            class: "account-pill",
                            span { class: "account-email", "{account_label}" }
                            button {
                                class: "btn-signout",
                                onclick: sign_out,
                                "Sign out"
                            }
                        }
                    }

                    section {
                        class: "cockpit-card",
                        div {
                            class: "orb-stage-wrapper",
                            VoxLogo {
                                size: 120,
                                animated: true,
                                state: orb_state,
                            }
                        }
                        h2 { class: "cockpit-status-title", "{label}" }
                        p { class: "cockpit-status-sub", "{sub_label}" }

                        div {
                            class: "call-action-group",
                            if active_now || state_now == "connecting" {
                                button {
                                    class: "btn-end-call",
                                    onclick: end_call,
                                    PhoneOffIcon {},
                                    span { "End Call" }
                                    Kbd { "Esc" }
                                }
                            } else {
                                button {
                                    class: "btn-start-call",
                                    onclick: start_call,
                                    disabled: busy_now,
                                    PhoneIcon {},
                                    span { "Start Call" }
                                    Kbd { "↵ Return" }
                                }
                            }
                        }
                    }

                    div {
                        class: "telemetry-grid",
                        div {
                            class: "telemetry-tile",
                            span { class: "tile-label", "Bridge" }
                            span {
                                class: "tile-value",
                                span {
                                    class: if active_now || state_now == "connecting" {
                                        "status-dot-coral"
                                    } else {
                                        "status-dot-live"
                                    }
                                }
                                if active_now { "Duplex" } else { "Online" }
                            }
                        }
                        div {
                            class: "telemetry-tile",
                            span { class: "tile-label", "Latency" }
                            span { class: "tile-value", "< 180ms" }
                        }
                        div {
                            class: "telemetry-tile",
                            span { class: "tile-label", "Engine" }
                            span { class: "tile-value", "Opus 48k" }
                        }
                    }

                    footer {
                        class: "footer-strip",
                        span { "v0.1.0" }
                        span { class: "footer-sep", "|" }
                        span { "CoreAudio" }
                        span { class: "footer-sep", "|" }
                        span { "bridge.voxagent.in" }
                    }
                }
            }
        }
    }
}
