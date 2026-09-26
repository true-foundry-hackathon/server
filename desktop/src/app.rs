#![allow(non_snake_case)]

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

#[derive(Serialize, Deserialize)]
struct EmailArgs<'a> {
    email: &'a str,
}

#[derive(Serialize, Deserialize)]
struct VerifyArgs<'a> {
    email: &'a str,
    code: &'a str,
}

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
    let mut email = use_signal(String::new);
    let mut otp_code = use_signal(String::new);
    let mut otp_sent = use_signal(|| false);
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

    let send_code = move |_| async move {
        auth_busy.set(true);
        auth_error.set(String::new());
        let args = serde_wasm_bindgen::to_value(&EmailArgs {
            email: &email.read(),
        })
        .unwrap_or(JsValue::NULL);
        match invoke("request_email_otp", args).await {
            Ok(_) => {
                otp_sent.set(true);
                auth_busy.set(false);
            }
            Err(err) => {
                auth_error.set(invoke_error_message(&err));
                auth_busy.set(false);
            }
        }
    };

    let verify_code = move |_| async move {
        auth_busy.set(true);
        auth_error.set(String::new());
        let args = serde_wasm_bindgen::to_value(&VerifyArgs {
            email: &email.read(),
            code: &otp_code.read(),
        })
        .unwrap_or(JsValue::NULL);
        match invoke("verify_email_otp", args).await {
            Ok(res) => {
                auth.set(parse_auth_state(&res));
                auth_busy.set(false);
                otp_sent.set(false);
                otp_code.set(String::new());
            }
            Err(err) => {
                auth_error.set(invoke_error_message(&err));
                auth_busy.set(false);
            }
        }
    };

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
    let state_now = call_state();
    let active_now = is_active();
    let busy_now = is_busy();
    let err_now = call_error();
    let label = status_label(&state_now, &err_now);
    let stage_class = if active_now {
        "stage stage-live"
    } else if state_now == "connecting" || busy_now {
        "stage stage-connecting"
    } else if !err_now.is_empty() {
        "stage stage-error"
    } else {
        "stage"
    };
    let account_label = auth()
        .email
        .clone()
        .or_else(|| auth().user_id.clone())
        .unwrap_or_else(|| "Signed in".to_string());

    rsx! {
        link { rel: "stylesheet", href: CSS }
        main {
            class: "shell",
            header {
                class: "brand",
                h1 { "Vox" }
                p { class: "brand-sub", "Voice" }
            }

            if !signed_in {
                section {
                    class: "auth",
                    h2 { "Sign in" }
                    p { class: "auth-copy", "Use your Vox account to talk to your agent." }

                    button {
                        class: "btn btn-secondary",
                        onclick: google_sign_in,
                        disabled: auth_busy(),
                        "Continue with Google"
                    }

                    div { class: "auth-divider", span { "or" } }

                    div {
                        class: "field",
                        label { r#for: "email", "Email" }
                        input {
                            id: "email",
                            r#type: "email",
                            value: "{email}",
                            disabled: auth_busy(),
                            oninput: move |e| email.set(e.value()),
                            placeholder: "you@example.com",
                            autocomplete: "username",
                        }
                    }

                    if otp_sent() {
                        div {
                            class: "field",
                            label { r#for: "otp", "Code" }
                            input {
                                id: "otp",
                                value: "{otp_code}",
                                disabled: auth_busy(),
                                oninput: move |e| otp_code.set(e.value()),
                                placeholder: "6-digit code",
                                autocomplete: "one-time-code",
                            }
                        }
                        button {
                            class: "btn btn-start",
                            onclick: verify_code,
                            disabled: auth_busy(),
                            "Verify and continue"
                        }
                    } else {
                        button {
                            class: "btn btn-start",
                            onclick: send_code,
                            disabled: auth_busy(),
                            "Send sign-in code"
                        }
                    }

                    if !auth_error().is_empty() {
                        p { class: "error-text", "{auth_error}" }
                    }
                }
            } else {
                section {
                    class: "account",
                    p { class: "account-label", "{account_label}" }
                    button {
                        class: "text-btn",
                        onclick: sign_out,
                        "Sign out"
                    }
                }

                section {
                    class: "{stage_class}",
                    aria_live: "polite",
                    div {
                        class: "presence",
                        span { class: "presence-dot" }
                    }
                    p { class: "status-label", "{label}" }
                    div {
                        class: "call-actions",
                        if active_now || state_now == "connecting" {
                            button {
                                class: "btn btn-end",
                                onclick: end_call,
                                "End Call"
                            }
                        } else {
                            button {
                                class: "btn btn-start",
                                onclick: start_call,
                                disabled: busy_now,
                                "Start Call"
                            }
                        }
                    }
                }
            }
        }
    }
}
