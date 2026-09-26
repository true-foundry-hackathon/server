use serde::Serialize;
use starship_battery::units::ratio::percent;
use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

pub struct SystemStatsState(Mutex<System>);

impl SystemStatsState {
    pub fn new() -> Self {
        Self(Mutex::new(System::new_all()))
    }
}

#[derive(Debug, Serialize)]
pub struct SystemStats {
    cpu_percent: f32,
    ram_percent: f32,
    battery_percent: Option<f32>,
}

fn read_battery_percent() -> Option<f32> {
    let manager = starship_battery::Manager::new().ok()?;
    let battery = manager.batteries().ok()?.next()?.ok()?;
    Some(battery.state_of_charge().get::<percent>())
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SystemStatsState>) -> SystemStats {
    let mut sys = state.0.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let ram_percent = if sys.total_memory() == 0 {
        0.0
    } else {
        (sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0) as f32
    };

    SystemStats {
        cpu_percent,
        ram_percent,
        battery_percent: read_battery_percent(),
    }
}
