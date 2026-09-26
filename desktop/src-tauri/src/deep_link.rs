use crate::auth::AuthManager;
use tauri::{AppHandle, Emitter, Manager};

/// Keeps only URLs using the `vox://` custom scheme (OAuth deep-link callbacks).
fn is_vox_scheme(url: &url::Url) -> bool {
    url.scheme() == "vox"
}

/// Shared filter used by every deep-link entry point (single-instance argv,
/// initial `setup()` check, `RunEvent::Opened`, `RunEvent::Reopen`) so the
/// `vox://` scheme check lives in exactly one place.
pub fn filter_vox_urls(urls: impl IntoIterator<Item = url::Url>) -> Vec<url::Url> {
    urls.into_iter().filter(is_vox_scheme).collect()
}

pub fn handle_oauth_callback_urls(app: &AppHandle, urls: &[url::Url]) {
    // The OS hands us the URL without bringing the app forward, so the user
    // is left staring at the browser until they manually switch — raise and
    // focus the window ourselves, the same way clicking the Dock icon would.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    // Each callback must outlive this loop iteration inside the spawned
    // `async move` task, so the clone is required despite the lint.
    #[allow(clippy::unnecessary_to_owned)]
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
