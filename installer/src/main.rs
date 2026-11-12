//! aether.chat Setup: the one-click installer people download.
//!
//! It carries the signed NSIS installer inside it (embedded at build time), runs it silently for the
//! current user (no admin prompt, no wizard pages), shows its own animated window while it works,
//! then opens aether.chat and closes itself. The NSIS installer still does the real work (files,
//! shortcuts, uninstaller, aetherchat:// links), so installs stay identical to auto-updates.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static INSTALLER: &[u8] = include_bytes!(env!("AETHER_INSTALLER"));
const APP_EXE: &str = "aetherchat.exe";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn work_dir() -> PathBuf {
    std::env::temp_dir().join("aether.chat-setup")
}

/// Where the NSIS installer put the app (it records the folder in the registry).
fn install_dir() -> PathBuf {
    let mut cmd = Command::new("reg");
    cmd.args(["query", r"HKCU\Software\aether.chat\aether.chat", "/ve"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(out) = cmd.output() {
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(line) = text.lines().find(|l| l.contains("REG_SZ")) {
            if let Some(path) = line.split("REG_SZ").nth(1) {
                let p = PathBuf::from(path.trim());
                if p.join(APP_EXE).exists() {
                    return p;
                }
            }
        }
    }
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    local.join("aether.chat")
}

/// Unpacks and runs the real installer silently. Returns the installed app's path.
#[tauri::command]
async fn install() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = work_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't prepare the install: {e}"))?;
        let exe = dir.join(format!("aether.chat-{}-installer.exe", env!("CARGO_PKG_VERSION")));
        std::fs::write(&exe, INSTALLER).map_err(|e| format!("Couldn't unpack the installer: {e}"))?;

        // /S: silent, current-user install. /NS is not passed, so shortcuts are created.
        let status = Command::new(&exe).arg("/S").status().map_err(|e| format!("Couldn't start the installer: {e}"))?;
        let _ = std::fs::remove_file(&exe);
        if !status.success() {
            return Err(match status.code() {
                Some(1) => "The installation was cancelled.".into(),
                Some(c) => format!("The installer stopped with code {c}. Close aether.chat if it's open and try again."),
                None => "The installer stopped unexpectedly.".into(),
            });
        }
        let app = install_dir().join(APP_EXE);
        if !app.exists() {
            return Err("aether.chat was installed, but its program file wasn't found.".into());
        }
        Ok(app.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the freshly installed app and quits Setup.
#[tauri::command]
fn launch(app: AppHandle, path: String) {
    let _ = Command::new(&path).current_dir(PathBuf::from(&path).parent().unwrap_or(&work_dir())).spawn();
    app.exit(0);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install, launch, quit, version])
        .setup(|app| {
            // Keep Setup's browser data in temp so it leaves nothing behind in AppData.
            let data = work_dir().join("webview");
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title("aether.chat Setup")
                .inner_size(440.0, 300.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .background_color(tauri::window::Color(8, 8, 15, 255))
                .data_directory(data)
                .build()?;
            let _ = app.get_webview_window("setup").map(|w| w.set_focus());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running aether.chat Setup");
}
