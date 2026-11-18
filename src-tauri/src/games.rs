//! Game detection (2.1, Windows). Finds where launchers install games (Steam libraries, Epic, GOG,
//! Ubisoft, Xbox / Game Pass) and reports a running program that lives inside one of those folders,
//! named the way the launcher names it. Only that game's name ever leaves this module: no process
//! list, no paths.

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    /// Install folder (lower-case, with a trailing separator) → game name.
    type Library = Vec<(String, String)>;

    static LIBRARY: Mutex<Option<(Instant, Library)>> = Mutex::new(None);
    const REFRESH: Duration = Duration::from_secs(300);

    /// Programs inside game folders that aren't the game itself.
    const NOT_GAMES: &[&str] = &[
        "unitycrashhandler64.exe", "unitycrashhandler32.exe", "crashreportclient.exe", "crashpad_handler.exe",
        "easyanticheat.exe", "easyanticheat_eos.exe", "beservice.exe", "beservice_x64.exe", "vc_redist.x64.exe",
        "vc_redist.x86.exe", "dxsetup.exe", "uninstall.exe", "unins000.exe", "steamwebhelper.exe", "steam.exe",
        "epicgameslauncher.exe", "epicwebhelper.exe", "galaxyclient.exe", "upc.exe", "ubisoftconnect.exe",
        "cefprocess.exe", "launcher.exe", "updater.exe", "crashhandler.exe", "errorreporter.exe",
    ];

    fn norm(p: &Path) -> String {
        let mut s = p.to_string_lossy().replace('/', "\\").to_lowercase();
        if !s.ends_with('\\') {
            s.push('\\');
        }
        s
    }

    /// Pulls `"key"  "value"` pairs out of Valve's KeyValues text (good enough for these files).
    fn vdf_values<'a>(text: &'a str, key: &str) -> Vec<&'a str> {
        let needle = format!("\"{key}\"");
        text.lines()
            .filter_map(|l| {
                let l = l.trim();
                let rest = l.strip_prefix(&needle)?.trim();
                rest.strip_prefix('"')?.strip_suffix('"')
            })
            .collect()
    }

    fn steam(lib: &mut Library) {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") else { return };
        let Ok(root) = key.get_value::<String, _>("SteamPath") else { return };
        let root = PathBuf::from(root.replace('/', "\\"));
        let mut libraries = vec![root.clone()];
        if let Ok(text) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
            for p in vdf_values(&text, "path") {
                libraries.push(PathBuf::from(p.replace("\\\\", "\\")));
            }
        }
        for libdir in libraries {
            let apps = libdir.join("steamapps");
            let Ok(entries) = std::fs::read_dir(&apps) else { continue };
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
                let (Some(title), Some(dir)) = (vdf_values(&text, "name").first().copied(), vdf_values(&text, "installdir").first().copied()) else { continue };
                // Steam's own runtimes and redistributables aren't games.
                if title.starts_with("Steamworks") || title.starts_with("Proton") || title.starts_with("Steam Linux") || title == "SteamVR" || title == "Spacewar" {
                    continue;
                }
                lib.push((norm(&apps.join("common").join(dir)), title.to_string()));
            }
        }
    }

    fn epic(lib: &mut Library) {
        let dir = PathBuf::from("C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests");
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("item") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            let (Some(name), Some(path)) = (v["DisplayName"].as_str(), v["InstallLocation"].as_str()) else { continue };
            lib.push((norm(Path::new(path)), name.to_string()));
        }
    }

    /// GOG and Ubisoft both list their installs in the registry.
    fn registry_installs(lib: &mut Library) {
        use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(games) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") {
            for id in games.enum_keys().flatten() {
                let Ok(g) = games.open_subkey(&id) else { continue };
                if let (Ok(name), Ok(path)) = (g.get_value::<String, _>("gameName"), g.get_value::<String, _>("path")) {
                    lib.push((norm(Path::new(&path)), name));
                }
            }
        }
        if let Ok(installs) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs") {
            for id in installs.enum_keys().flatten() {
                let Ok(g) = installs.open_subkey(&id) else { continue };
                if let Ok(path) = g.get_value::<String, _>("InstallDir") {
                    let p = PathBuf::from(path.replace('/', "\\"));
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    if !name.is_empty() {
                        lib.push((norm(&p), name));
                    }
                }
            }
        }
    }

    /// Xbox app / Game Pass: C:\XboxGames\<Game>\Content (and the same folder on other drives).
    fn xbox(lib: &mut Library) {
        for drive in b'C'..=b'H' {
            let root = PathBuf::from(format!("{}:\\XboxGames", drive as char));
            let Ok(entries) = std::fs::read_dir(&root) else { continue };
            for e in entries.flatten() {
                if e.path().is_dir() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name != "GameSave" {
                        lib.push((norm(&e.path()), name));
                    }
                }
            }
        }
    }

    fn library() -> Library {
        let mut cache = LIBRARY.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, lib)) = cache.as_ref() {
            if at.elapsed() < REFRESH {
                return lib.clone();
            }
        }
        let mut lib = Library::new();
        steam(&mut lib);
        epic(&mut lib);
        registry_installs(&mut lib);
        xbox(&mut lib);
        // Longest folders first, so a game inside another's folder still wins.
        lib.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        lib.retain(|(dir, _)| dir.len() > 4);
        *cache = Some((Instant::now(), lib.clone()));
        lib
    }

    /// Full paths of running programs.
    fn running_paths() -> Vec<String> {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
        use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
        let mut out = Vec::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
            let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID) {
                        let mut buf = [0u16; 1024];
                        let mut len = buf.len() as u32;
                        if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
                            out.push(String::from_utf16_lossy(&buf[..len as usize]).to_lowercase());
                        }
                        let _ = CloseHandle(h);
                    }
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(HANDLE(snap.0));
        }
        out
    }

    #[cfg(test)]
    pub fn library_for_test() -> Library {
        library()
    }

    /// The game's name and its program file (e.g. "game.exe"), for game-only clip capture.
    pub fn running_game() -> Option<(String, String)> {
        let lib = library();
        if lib.is_empty() {
            return None;
        }
        for path in running_paths() {
            let file = path.rsplit('\\').next().unwrap_or("");
            if !file.ends_with(".exe") || NOT_GAMES.contains(&file) {
                continue;
            }
            if let Some((_, name)) = lib.iter().find(|(dir, _)| path.starts_with(dir.as_str())) {
                return Some((name.clone(), file.to_string()));
            }
        }
        None
    }
}

#[derive(serde::Serialize)]
pub struct RunningGame {
    name: String,
    exe: String,
}

/// The game you're playing, if it was installed by a launcher Aether knows. Windows only.
#[tauri::command]
pub async fn running_game() -> Option<RunningGame> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(imp::running_game).await.ok().flatten().map(|(name, exe)| RunningGame { name, exe })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn finds_installed_games() {
        let started = std::time::Instant::now();
        let lib = super::imp::library_for_test();
        println!("library: {} folders in {:?}", lib.len(), started.elapsed());
        for (dir, name) in lib.iter().take(15) {
            println!("  {name}  <=  {}", dir.split('\\').rev().nth(1).unwrap_or(""));
        }
        let started = std::time::Instant::now();
        println!("running now: {:?} ({:?})", super::imp::running_game(), started.elapsed());
    }
}
