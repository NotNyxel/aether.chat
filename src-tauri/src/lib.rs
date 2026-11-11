//! aether.chat desktop shell. The whole app is the web frontend in ../dist rendered by the
//! system WebView2. Rust hosts the window and the system tray, opens external links in the
//! default browser, installs signed updates published to GitHub Releases, and exposes a few
//! small OS helpers the web layer can't reach (idle time, running games).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// When true, closing the main window hides it to the tray instead of quitting.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// Seconds since the last keyboard or mouse input anywhere on the system.
#[tauri::command]
fn idle_seconds() -> u64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            dw_time: u32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTickCount() -> u32;
        }
        let mut info = LastInputInfo { cb_size: std::mem::size_of::<LastInputInfo>() as u32, dw_time: 0 };
        // SAFETY: plain Win32 calls with a correctly sized, initialised struct.
        unsafe {
            if GetLastInputInfo(&mut info) != 0 {
                return (GetTickCount().wrapping_sub(info.dw_time) / 1000) as u64;
            }
        }
        0
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Lower-cased executable names of running processes (for the opt-in "Playing …" status).
/// Only names leave this function; nothing is sent anywhere unless a name matches a game.
#[tauri::command]
fn running_processes() -> Vec<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("tasklist")
            .args(["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let Ok(out) = out else { return Vec::new() };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut names: Vec<String> = text
            .lines()
            .filter_map(|l| l.strip_prefix('"').and_then(|l| l.split('"').next()))
            .map(|n| n.to_ascii_lowercase())
            .collect();
        names.sort();
        names.dedup();
        names
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Saves a data export. The save dialog runs here (not in the web page), so the page can only
/// write a file to the place the user picks.
#[tauri::command]
async fn save_export(app: AppHandle, file_name: String, contents: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch focuses the running copy instead of opening another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // Answer the browser's "allow microphone / camera?" prompts ourselves, the way Discord's
        // Electron shell does: aether.chat's own pages get them silently, anything else gets the
        // normal prompt. Windows' own privacy switch (Settings → Privacy → Microphone) still applies.
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            let own_page = webview
                .url()
                .map(|u| matches!(u.host_str(), Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")))
                .unwrap_or(false);
            match kind {
                PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::Notifications | PermissionKind::Autoplay
                    if own_page =>
                {
                    PermissionResponse::Allow
                }
                _ => PermissionResponse::Default,
            }
        })
        .invoke_handler(tauri::generate_handler![set_close_to_tray, idle_seconds, running_processes, save_export])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open aether.chat", true, None::<&str>)?;
            let mute = MenuItem::with_id(app, "mute", "Toggle mute", true, None::<&str>)?;
            let deafen = MenuItem::with_id(app, "deafen", "Toggle deafen", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit aether.chat", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &mute, &deafen, &sep, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("aether.chat")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "mute" => {
                        let _ = app.emit("tray-action", "mute");
                    }
                    "deafen" => {
                        let _ = app.emit("tray-action", "deafen");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // aetherchat:// links (password reset, email confirmation). The installer registers the
            // scheme too; registering at runtime keeps it pointing at this copy.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Launched at sign-in by autostart: start quietly in the tray.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running aether.chat");
}
