//! The clip key (2.4.4), on Windows: a low-level keyboard hook that watches for the key without
//! taking it away from anything (the way game clippers do it). Unlike a registered hotkey it
//! works for any key, in any game, and can't be "already in use" by another app.
//! The hook only compares each key press with the chosen combo and passes a match on to the app
//! as a `clip-hotkey` event; nothing is recorded or stored.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::WindowsAndMessaging::{CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP};

#[derive(Clone, Copy, PartialEq, Debug)]
enum Key {
    /// Physical key: scan code and whether it's an "extended" key (arrows, Home, numpad Enter…).
    Scan(u32, bool),
    /// Keys whose scan codes are odd: matched by virtual-key code.
    Vk(u32),
}

#[derive(Clone, Copy, PartialEq, Debug)]
struct Combo {
    key: Key,
    ctrl: bool,
    alt: bool,
    shift: bool,
    win: bool,
}

/// A browser key code (`KeyboardEvent.code`, what the keybind setting stores) as a physical key.
fn key_for(code: &str) -> Option<Key> {
    use Key::{Scan, Vk};
    let sc = |c| Some(Scan(c, false));
    let ext = |c| Some(Scan(c, true));
    if let Some(l) = code.strip_prefix("Key").filter(|l| l.len() == 1) {
        const ROW: &[(char, u32)] = &[
            ('Q', 0x10), ('W', 0x11), ('E', 0x12), ('R', 0x13), ('T', 0x14), ('Y', 0x15), ('U', 0x16), ('I', 0x17), ('O', 0x18), ('P', 0x19),
            ('A', 0x1E), ('S', 0x1F), ('D', 0x20), ('F', 0x21), ('G', 0x22), ('H', 0x23), ('J', 0x24), ('K', 0x25), ('L', 0x26),
            ('Z', 0x2C), ('X', 0x2D), ('C', 0x2E), ('V', 0x2F), ('B', 0x30), ('N', 0x31), ('M', 0x32),
        ];
        let ch = l.chars().next()?;
        return ROW.iter().find(|(c, _)| *c == ch).and_then(|(_, s)| sc(*s));
    }
    if let Some(d) = code.strip_prefix("Digit").and_then(|d| d.parse::<u32>().ok()) {
        return sc(if d == 0 { 0x0B } else { 0x01 + d });
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
        return match n {
            1..=10 => sc(0x3A + n),
            11 => sc(0x57),
            12 => sc(0x58),
            13..=24 => Some(Vk(0x70 + n - 1)),
            _ => None,
        };
    }
    if let Some(d) = code.strip_prefix("Numpad").and_then(|d| d.parse::<u32>().ok()) {
        const PAD: [u32; 10] = [0x52, 0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47, 0x48, 0x49];
        return PAD.get(d as usize).and_then(|s| sc(*s));
    }
    match code {
        "Escape" => sc(0x01),
        "Minus" => sc(0x0C),
        "Equal" => sc(0x0D),
        "Backspace" => sc(0x0E),
        "Tab" => sc(0x0F),
        "BracketLeft" => sc(0x1A),
        "BracketRight" => sc(0x1B),
        "Enter" => sc(0x1C),
        "Semicolon" => sc(0x27),
        "Quote" => sc(0x28),
        "Backquote" => sc(0x29),
        "Backslash" => sc(0x2B),
        "Comma" => sc(0x33),
        "Period" => sc(0x34),
        "Slash" => sc(0x35),
        "Space" => sc(0x39),
        "CapsLock" => sc(0x3A),
        "ScrollLock" => sc(0x46),
        "IntlBackslash" => sc(0x56),
        "NumpadMultiply" => sc(0x37),
        "NumpadSubtract" => sc(0x4A),
        "NumpadAdd" => sc(0x4E),
        "NumpadDecimal" => sc(0x53),
        "NumpadEnter" => ext(0x1C),
        "NumpadDivide" => ext(0x35),
        "Home" => ext(0x47),
        "ArrowUp" => ext(0x48),
        "PageUp" => ext(0x49),
        "ArrowLeft" => ext(0x4B),
        "ArrowRight" => ext(0x4D),
        "End" => ext(0x4F),
        "ArrowDown" => ext(0x50),
        "PageDown" => ext(0x51),
        "Insert" => ext(0x52),
        "Delete" => ext(0x53),
        "ContextMenu" => ext(0x5D),
        "Pause" => Some(Vk(0x13)),
        "PrintScreen" => Some(Vk(0x2C)),
        "NumLock" => Some(Vk(0x90)),
        _ => None,
    }
}

/// "Ctrl+Shift+KeyC" → the combo, or None if the key isn't one we know.
fn parse(combo: &str) -> Option<Combo> {
    let mut c = Combo { key: Key::Vk(0), ctrl: false, alt: false, shift: false, win: false };
    let parts: Vec<&str> = combo.split('+').collect();
    let (main, mods) = parts.split_last()?;
    for m in mods {
        match *m {
            "Ctrl" | "Control" => c.ctrl = true,
            "Alt" => c.alt = true,
            "Shift" => c.shift = true,
            "Meta" | "Super" => c.win = true,
            _ => return None,
        }
    }
    c.key = key_for(main)?;
    Some(c)
}

static COMBO: Mutex<Option<Combo>> = Mutex::new(None);
static HELD: AtomicBool = AtomicBool::new(false);
static TX: OnceLock<Mutex<Sender<()>>> = OnceLock::new();

fn down(vk: i32) -> bool {
    unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 }
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let msg = wparam.0 as u32;
        if let Some(c) = *COMBO.lock().unwrap_or_else(|p| p.into_inner()) {
            let hit = match c.key {
                Key::Scan(s, e) => k.scanCode == s && ((k.flags.0 & LLKHF_EXTENDED.0) != 0) == e,
                Key::Vk(v) => k.vkCode == v,
            };
            if hit {
                if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                    // Once per press (holding a key repeats key-downs), with exactly these modifiers.
                    let mods = down(0x11) == c.ctrl && down(0x12) == c.alt && down(0x10) == c.shift && (down(0x5B) || down(0x5C)) == c.win;
                    if mods && !HELD.swap(true, Ordering::Relaxed) {
                        if let Some(tx) = TX.get() {
                            let _ = tx.lock().map(|t| t.send(()));
                        }
                    }
                } else if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                    HELD.store(false, Ordering::Relaxed);
                }
            }
        }
    }
    // Never swallow the key: the game (or whatever is focused) still gets it.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn ensure_hook(app: &AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let (tx, rx) = channel::<()>();
        let _ = TX.set(Mutex::new(tx));
        let app = app.clone();
        std::thread::spawn(move || {
            for () in rx {
                let _ = app.emit("clip-hotkey", ());
            }
        });
        start_hook_thread();
    });
}

/// The hook lives on its own thread with a message loop (Windows calls it from there).
fn start_hook_thread() {
    std::thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None).ok().map(|m| m.into());
        if SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module, 0).is_err() {
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

/// Sets the clip key (None turns it off). Returns false if that key can't be watched.
#[tauri::command]
pub fn clips_set_hotkey(app: AppHandle, combo: Option<String>) -> bool {
    let parsed = combo.as_deref().and_then(parse);
    *COMBO.lock().unwrap_or_else(|p| p.into_inner()) = parsed;
    HELD.store(false, Ordering::Relaxed);
    if parsed.is_some() {
        ensure_hook(&app);
    }
    parsed.is_some() || combo.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_keybinds() {
        assert_eq!(parse("Ctrl+Shift+KeyC"), Some(Combo { key: Key::Scan(0x2E, false), ctrl: true, alt: false, shift: true, win: false }));
        assert_eq!(parse("F8").map(|c| c.key), Some(Key::Scan(0x42, false)));
        assert_eq!(parse("F12").map(|c| c.key), Some(Key::Scan(0x58, false)));
        assert_eq!(parse("F13").map(|c| c.key), Some(Key::Vk(0x7C)));
        assert_eq!(parse("Digit1").map(|c| c.key), Some(Key::Scan(0x02, false)));
        assert_eq!(parse("Digit0").map(|c| c.key), Some(Key::Scan(0x0B, false)));
        assert_eq!(parse("Alt+PageDown").map(|c| (c.key, c.alt)), Some((Key::Scan(0x51, true), true)));
        assert_eq!(parse("Numpad0").map(|c| c.key), Some(Key::Scan(0x52, false)));
        assert_eq!(parse("Backquote").map(|c| c.key), Some(Key::Scan(0x29, false)));
        assert_eq!(parse("Meta+KeyX").map(|c| c.win), Some(true));
        assert_eq!(parse("Ctrl+Mystery"), None);
        assert_eq!(parse(""), None);
    }

    /// Presses F24 (a key no keyboard has) through Windows and checks the hook sees it, once per
    /// press, and not when a modifier is held that the combo doesn't have.
    #[test]
    #[ignore]
    fn hook_sees_key_presses() {
        use std::time::Duration;
        use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY};
        let (tx, rx) = channel();
        TX.set(Mutex::new(tx)).unwrap();
        start_hook_thread();
        std::thread::sleep(Duration::from_millis(300));
        *COMBO.lock().unwrap() = parse("F24");
        let key = |vk: u16, up: bool| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, ..Default::default() } } };
        let send = |keys: &[INPUT]| unsafe { SendInput(keys, std::mem::size_of::<INPUT>() as i32) };
        // Held down (two key-downs, like auto-repeat), then released: one clip.
        send(&[key(0x87, false), key(0x87, false), key(0x87, true)]);
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_ok(), "F24 not seen");
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "fired twice for one press");
        // Shift+F24 isn't F24.
        send(&[key(0x10, false), key(0x87, false), key(0x87, true), key(0x10, true)]);
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err(), "fired with an extra modifier");
        // A changed key takes effect straight away.
        *COMBO.lock().unwrap() = parse("Shift+F24");
        send(&[key(0x10, false), key(0x87, false), key(0x87, true), key(0x10, true)]);
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_ok(), "Shift+F24 not seen after changing the key");
    }
}
