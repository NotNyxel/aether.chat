//! aether.chat desktop shell. The whole app is the web frontend in ../dist rendered by the
//! system WebView2. Rust hosts the window, opens external links in the default browser, and
//! installs signed updates published to GitHub Releases.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running aether.chat");
}
