//! NKSE mobile shell.
//!
//! The UI is the exact site bundle inside the WebView; Rust owns the native
//! shell, offline storage hooks and (later) update checks. Keeping the web UI
//! identical is what makes the Android app feel like the site while staying
//! light and fast.

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
