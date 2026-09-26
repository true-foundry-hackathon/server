fn main() {
    for key in [
        "VOX_SUPABASE_URL",
        "VOX_SUPABASE_ANON_KEY",
        "VOX_API_URL",
        "VOX_BRIDGE_URL",
        "VOX_OAUTH_REDIRECT_URI",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                println!("cargo:rustc-env={key}={value}");
            }
        }
        println!("cargo:rerun-if-env-changed={key}");
    }
    tauri_build::build()
}
