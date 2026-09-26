//! Native CoreLocation bridge. tauri-plugin-geolocation is a no-op stub on
//! desktop, so macOS never saw a request and never listed Vox under
//! Location Services. Calling CLLocationManager directly shows the system
//! "Allow Vox to use your location?" prompt and registers the app.

use std::cell::OnceCell;
use std::sync::Mutex;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_core_location::{
    CLAuthorizationStatus, CLLocation, CLLocationManager, CLLocationManagerDelegate,
};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::oneshot;

#[derive(Clone, Serialize)]
pub struct Coords {
    lat: f64,
    lng: f64,
}

type Reply = oneshot::Sender<Result<Coords, String>>;
static PENDING: Mutex<Vec<Reply>> = Mutex::new(Vec::new());

fn finish(result: Result<Coords, String>) {
    for tx in PENDING.lock().unwrap().drain(..) {
        let _ = tx.send(result.clone());
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "VoxLocationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl CLLocationManagerDelegate for Delegate {
        // Fires once on creation and again after the user answers the prompt.
        #[unsafe(method(locationManagerDidChangeAuthorization:))]
        fn did_change_authorization(&self, manager: &CLLocationManager) {
            advance(manager);
        }

        #[unsafe(method(locationManager:didUpdateLocations:))]
        fn did_update_locations(
            &self,
            _manager: &CLLocationManager,
            locations: &NSArray<CLLocation>,
        ) {
            if let Some(loc) = locations.lastObject() {
                let c = unsafe { loc.coordinate() };
                finish(Ok(Coords {
                    lat: c.latitude,
                    lng: c.longitude,
                }));
            }
        }

        #[unsafe(method(locationManager:didFailWithError:))]
        fn did_fail(&self, _manager: &CLLocationManager, error: &NSError) {
            // kCLErrorDenied = 1
            if error.code() == 1 {
                finish(Err("denied".into()));
            } else {
                finish(Err(error.localizedDescription().to_string()));
            }
        }
    }
);

fn advance(manager: &CLLocationManager) {
    if PENDING.lock().unwrap().is_empty() {
        return;
    }
    match unsafe { manager.authorizationStatus() } {
        CLAuthorizationStatus::NotDetermined => unsafe { manager.requestWhenInUseAuthorization() },
        CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => unsafe {
            manager.requestLocation()
        },
        _ => finish(Err("denied".into())),
    }
}

thread_local! {
    // Main-thread only; kept alive for the app's lifetime (delegate is weak).
    static MANAGER: OnceCell<(Retained<CLLocationManager>, Retained<Delegate>)> = const { OnceCell::new() };
}

#[tauri::command]
pub async fn get_native_location(app: AppHandle) -> Result<Coords, String> {
    let (tx, rx) = oneshot::channel();
    PENDING.lock().unwrap().push(tx);

    app.run_on_main_thread(|| {
        let mtm = MainThreadMarker::new().expect("main thread");
        MANAGER.with(|cell| {
            let (manager, _) = cell.get_or_init(|| {
                let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::alloc(mtm), init] };
                let manager = unsafe { CLLocationManager::new() };
                unsafe { manager.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
                (manager, delegate)
            });
            advance(manager);
        });
    })
    .map_err(|e| e.to_string())?;

    // Generous: the system prompt stays open until the user answers.
    tokio::time::timeout(Duration::from_secs(60), rx)
        .await
        .map_err(|_| "Location timed out".to_string())?
        .map_err(|_| "Location cancelled".to_string())?
}
