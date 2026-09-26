mod audio;
mod auth;
mod client;
mod codec;
mod config;
mod deep_link;
mod device_link;
mod live_link;
mod local_llm;
#[cfg(target_os = "macos")]
mod macos_location;
mod pkce;
mod session;
mod session_store;
mod sync_client;
mod system_stats;
mod task_store;
mod terminal;
mod types;

use auth::AuthManager;
use deep_link::{filter_vox_urls, handle_oauth_callback_urls};
use session::SessionManager;
use system_stats::SystemStatsState;
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

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
            let urls = filter_vox_urls(argv.iter().filter_map(|arg| url::Url::parse(arg).ok()));
            if !urls.is_empty() {
                handle_oauth_callback_urls(app, &urls);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(auth)
        .manage(SessionManager::new())
        .manage(task_store::TaskManager::new())
        .manage(device_link::DeviceLinkState::default())
        .manage(device_link::RemoteControl::load())
        .manage(device_link::LocalModelReady::load())
        .manage(device_link::EventLog::default())
        .manage(SystemStatsState::new())
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("deep link registration warning: {err}");
                }
            }

            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let vox_urls = filter_vox_urls(urls);
                if !vox_urls.is_empty() {
                    handle_oauth_callback_urls(&handle, &vox_urls);
                }
            }

            app.deep_link().on_open_url(move |event| {
                handle_oauth_callback_urls(&handle, &event.urls());
            });

            tauri::async_runtime::spawn(device_link::run_supervisor(app.handle().clone()));
            tauri::async_runtime::spawn(live_link::run_supervisor(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::get_auth_state,
            auth::sign_in_with_google,
            auth::sign_out,
            auth::link_phone,
            center_window,
            session::start_call,
            session::end_call,
            session::call_status,
            set_window_size,
            sync_client::get_tasks,
            sync_client::create_task,
            sync_client::update_task,
            sync_client::get_collections,
            sync_client::get_timeline,
            sync_client::create_collection,
            sync_client::archive_collection,
            device_link::get_device_link_status,
            device_link::get_remote_control,
            device_link::set_remote_control,
            device_link::get_local_events,
            device_link::is_local_model_ready,
            system_stats::get_system_stats,
            local_llm::is_local_llm_downloaded,
            local_llm::download_local_llm,
            #[cfg(any(target_os = "macos", windows))]
            local_llm::test_local_llm,
            #[cfg(target_os = "macos")]
            macos_location::get_native_location
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let vox_urls =
                    filter_vox_urls(urls.iter().filter_map(|u| url::Url::parse(u.as_ref()).ok()));
                if !vox_urls.is_empty() {
                    eprintln!("RunEvent::Opened vox urls: {vox_urls:?}");
                    handle_oauth_callback_urls(app, &vox_urls);
                }
            }

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let vox_urls = filter_vox_urls(urls);
                    if !vox_urls.is_empty() {
                        eprintln!("Reopen get_current vox urls: {vox_urls:?}");
                        handle_oauth_callback_urls(app, &vox_urls);
                    }
                }
            }
        });
}
