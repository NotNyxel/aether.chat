//! Native screen sharing (Windows): our own source picker and capture, instead of WebView2's
//! built-in "Choose what to share with http://tauri.localhost" dialog.
//!
//! - `capture_sources` lists screens and windows, with small JPEG thumbnails grabbed through
//!   Windows Graphics Capture (one frame each, in parallel).
//! - `capture_start` captures one source with Windows Graphics Capture at the requested size and
//!   frame rate. Frames are scaled (SIMD), JPEG-encoded on a worker thread (only the newest frame
//!   is kept, so a slow consumer never builds a backlog) and streamed to the page over a Tauri
//!   channel as raw bytes, where they become a canvas-backed video track for WebRTC.
//! - With audio on, WASAPI process loopback captures sound too: for a screen, everything except
//!   aether.chat itself (so people don't hear themselves back); for a window, only that app.
//!   Audio goes to the page as 48 kHz stereo f32 chunks on a second channel.
//! - An empty message on the video channel means "the source went away" (window closed).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings, SecondaryWindowSettings,
    Settings,
};
use windows_capture::window::Window;

type BoxErr = Box<dyn std::error::Error + Send + Sync>;

#[derive(Serialize, Clone)]
pub struct CaptureSource {
    id: String,
    kind: &'static str,
    name: String,
    app: Option<String>,
    width: u32,
    height: u32,
    thumbnail: Option<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

/// Fits (w, h) inside (max_w, max_h), keeping the aspect ratio, never upscaling, even sizes.
fn fit(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
    let ow = ((w as f64 * scale).round() as u32).max(2) & !1;
    let oh = ((h as f64 * scale).round() as u32).max(2) & !1;
    (ow, oh)
}

/// Scales a BGRA image and encodes it as JPEG.
fn encode_jpeg(resizer: &mut Resizer, bgra: Vec<u8>, w: u32, h: u32, max_w: u32, max_h: u32, quality: u8) -> Result<Vec<u8>, BoxErr> {
    let (ow, oh) = fit(w, h, max_w, max_h);
    let pixels = if (ow, oh) == (w, h) {
        bgra
    } else {
        let src = Image::from_vec_u8(w, h, bgra, PixelType::U8x4)?;
        let mut dst = Image::new(ow, oh, PixelType::U8x4);
        let mut opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear));
        opts.mul_div_alpha = false;
        resizer.resize(&src, &mut dst, &opts)?;
        dst.into_vec()
    };
    let mut out = Vec::with_capacity((ow * oh / 6) as usize);
    jpeg_encoder::Encoder::new(&mut out, quality).encode(&pixels, ow as u16, oh as u16, jpeg_encoder::ColorType::Bgra)?;
    Ok(out)
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

fn frame_bgra(frame: &mut Frame) -> Result<(Vec<u8>, u32, u32), BoxErr> {
    let buffer = frame.buffer()?;
    let (w, h) = (buffer.width(), buffer.height());
    let mut tmp = Vec::new();
    let raw = buffer.as_nopadding_buffer(&mut tmp).to_vec();
    Ok((raw, w, h))
}

enum Target {
    Screen(Monitor),
    Window(Window),
}

fn resolve(id: &str) -> Result<Target, String> {
    if let Some(i) = id.strip_prefix("screen:") {
        let index: usize = i.parse().map_err(|_| "Bad screen id".to_string())?;
        return Monitor::from_index(index).map(Target::Screen).map_err(|e| format!("That screen isn't available: {e}"));
    }
    if let Some(h) = id.strip_prefix("window:") {
        let hwnd: usize = h.parse().map_err(|_| "Bad window id".to_string())?;
        let w = Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void);
        return if w.is_valid() { Ok(Target::Window(w)) } else { Err("That window was closed.".into()) };
    }
    Err("Unknown source".into())
}

// ── Thumbnails ──────────────────────────────────────────────────────────────────────────────

type Slot = Arc<Mutex<Option<(Vec<u8>, u32, u32)>>>;

struct OneShot {
    slot: Slot,
}

impl GraphicsCaptureApiHandler for OneShot {
    type Flags = Slot;
    type Error = BoxErr;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { slot: ctx.flags })
    }
    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        let data = frame_bgra(frame)?;
        *self.slot.lock().unwrap() = Some(data);
        control.stop();
        Ok(())
    }
}

fn thumbnail(target: Target) -> Option<String> {
    let slot: Slot = Arc::new(Mutex::new(None));
    let settings = |flags: Slot| (CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder, flags);
    let control = match target {
        Target::Screen(m) => {
            let (c, b, f) = settings(slot.clone());
            OneShot::start_free_threaded(Settings::new(m, c, b, SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Default, DirtyRegionSettings::Default, ColorFormat::Bgra8, f))
        }
        Target::Window(w) => {
            let (c, b, f) = settings(slot.clone());
            OneShot::start_free_threaded(Settings::new(w, c, b, SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Default, DirtyRegionSettings::Default, ColorFormat::Bgra8, f))
        }
    }
    .ok()?;
    let started = Instant::now();
    while slot.lock().unwrap().is_none() && started.elapsed() < Duration::from_millis(700) && !control.is_finished() {
        std::thread::sleep(Duration::from_millis(15));
    }
    let _ = control.stop();
    let (bgra, w, h) = slot.lock().unwrap().take()?;
    let jpeg = encode_jpeg(&mut Resizer::new(), bgra, w, h, 400, 225, 72).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64(&jpeg)))
}

/// Screens and windows that can be shared, optionally with thumbnails.
#[tauri::command]
pub async fn capture_sources(thumbnails: bool) -> Result<Vec<CaptureSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let me = std::process::id();
        let mut out = Vec::new();
        for (i, m) in Monitor::enumerate().map_err(|e| e.to_string())?.into_iter().enumerate() {
            let index = m.index().unwrap_or(i + 1);
            out.push(CaptureSource {
                id: format!("screen:{index}"),
                kind: "screen",
                name: format!("Screen {index}"),
                app: m.device_string().ok().filter(|s| !s.is_empty()),
                width: m.width().unwrap_or(0),
                height: m.height().unwrap_or(0),
                thumbnail: None,
            });
        }
        for w in Window::enumerate().map_err(|e| e.to_string())? {
            let Ok(title) = w.title() else { continue };
            let title = title.trim().to_string();
            if title.is_empty() || w.process_id().map(|p| p == me).unwrap_or(false) {
                continue;
            }
            let (ww, wh) = (w.width().unwrap_or(0), w.height().unwrap_or(0));
            if ww < 80 || wh < 60 {
                continue;
            }
            let app = w.process_name().ok().map(|n| n.trim_end_matches(".exe").to_string());
            if matches!(app.as_deref(), Some("TextInputHost") | Some("ApplicationFrameHost") | Some("SystemSettings") | Some("ShellExperienceHost")) {
                continue;
            }
            out.push(CaptureSource {
                id: format!("window:{}", w.as_raw_hwnd() as usize),
                kind: "window",
                name: title,
                app,
                width: ww as u32,
                height: wh as u32,
                thumbnail: None,
            });
        }
        if thumbnails {
            let handles: Vec<_> = out
                .iter()
                .map(|s| {
                    let id = s.id.clone();
                    std::thread::spawn(move || resolve(&id).ok().and_then(thumbnail))
                })
                .collect();
            for (s, h) in out.iter_mut().zip(handles) {
                s.thumbnail = h.join().ok().flatten();
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Live capture ────────────────────────────────────────────────────────────────────────────

/// The newest captured frame, waiting for the encoder.
type Mailbox = Arc<(Mutex<Option<(Vec<u8>, u32, u32)>>, Condvar)>;

struct Live {
    mailbox: Mailbox,
    every: Duration,
    last: Option<Instant>,
    stopped: Arc<AtomicBool>,
    video: Channel<InvokeResponseBody>,
}

impl GraphicsCaptureApiHandler for Live {
    type Flags = (Mailbox, Duration, Arc<AtomicBool>, Channel<InvokeResponseBody>);
    type Error = BoxErr;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let (mailbox, every, stopped, video) = ctx.flags;
        Ok(Self { mailbox, every, last: None, stopped, video })
    }
    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        if self.stopped.load(Ordering::Relaxed) {
            control.stop();
            return Ok(());
        }
        let now = Instant::now();
        if self.last.is_some_and(|t| now.duration_since(t) < self.every) {
            return Ok(());
        }
        self.last = Some(now);
        let data = frame_bgra(frame)?;
        let (lock, cv) = &*self.mailbox;
        *lock.lock().unwrap() = Some(data);
        cv.notify_one();
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // The window was closed: tell the page the share is over.
        self.stopped.store(true, Ordering::Relaxed);
        self.mailbox.1.notify_all();
        let _ = self.video.send(InvokeResponseBody::Raw(Vec::new()));
        Ok(())
    }
}

struct Session {
    stopped: Arc<AtomicBool>,
    mailbox: Mailbox,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn stop_session() {
    if let Some(s) = SESSION.lock().unwrap().take() {
        s.stopped.store(true, Ordering::Relaxed);
        s.mailbox.1.notify_all();
    }
}

#[derive(Serialize)]
pub struct Started {
    width: u32,
    height: u32,
    audio: bool,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn capture_start(
    source: String,
    max_width: u32,
    max_height: u32,
    fps: u32,
    cursor: bool,
    audio: bool,
    video: Channel<InvokeResponseBody>,
    sound: Channel<InvokeResponseBody>,
) -> Result<Started, String> {
    stop_session();
    let target = resolve(&source)?;
    let (src_w, src_h, audio_pid) = match &target {
        Target::Screen(m) => (m.width().unwrap_or(1920), m.height().unwrap_or(1080), None),
        Target::Window(w) => (w.width().unwrap_or(1280) as u32, w.height().unwrap_or(720) as u32, w.process_id().ok()),
    };
    let (out_w, out_h) = fit(src_w.max(2), src_h.max(2), max_width.clamp(320, 3840), max_height.clamp(180, 2160));
    let fps = fps.clamp(5, 120);
    let every = Duration::from_micros(1_000_000 / fps as u64);

    let stopped = Arc::new(AtomicBool::new(false));
    let mailbox: Mailbox = Arc::new((Mutex::new(None), Condvar::new()));
    *SESSION.lock().unwrap() = Some(Session { stopped: stopped.clone(), mailbox: mailbox.clone() });

    // Encoder thread: newest frame → scale → JPEG → page.
    {
        let (stopped, mailbox, video) = (stopped.clone(), mailbox.clone(), video.clone());
        std::thread::spawn(move || {
            let mut resizer = Resizer::new();
            loop {
                let next = {
                    let (lock, cv) = &*mailbox;
                    let mut slot = lock.lock().unwrap();
                    while slot.is_none() && !stopped.load(Ordering::Relaxed) {
                        slot = cv.wait_timeout(slot, Duration::from_millis(500)).unwrap().0;
                    }
                    slot.take()
                };
                if stopped.load(Ordering::Relaxed) {
                    break;
                }
                let Some((bgra, w, h)) = next else { continue };
                let quality = if out_w * out_h > 2_100_000 { 78 } else { 84 };
                if let Ok(jpeg) = encode_jpeg(&mut resizer, bgra, w, h, out_w, out_h, quality) {
                    if video.send(InvokeResponseBody::Raw(jpeg)).is_err() {
                        stopped.store(true, Ordering::Relaxed);
                        break;
                    }
                }
            }
        });
    }

    // Capture thread.
    let cursor = if cursor { CursorCaptureSettings::WithCursor } else { CursorCaptureSettings::WithoutCursor };
    let flags = (mailbox.clone(), every, stopped.clone(), video.clone());
    let interval = MinimumUpdateIntervalSettings::Custom(every);
    let started = match target {
        Target::Screen(m) => Live::start_free_threaded(Settings::new(m, cursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, flags)).map(|_| ()),
        Target::Window(w) => Live::start_free_threaded(Settings::new(w, cursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Include, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, flags)).map(|_| ()),
    };
    if let Err(e) = started {
        stop_session();
        return Err(format!("Couldn't start capturing: {e}"));
    }

    // Audio thread (optional).
    let mut audio_on = false;
    if audio {
        let me = std::process::id();
        // Screen: everything except us. Window: just that app (unless it's us).
        let (pid, include) = match audio_pid {
            Some(p) if p != me => (p, true),
            Some(_) => (0, false),
            None => (me, false),
        };
        if pid != 0 {
            audio_on = true;
            let stopped = stopped.clone();
            std::thread::spawn(move || {
                let _ = audio_loop(pid, include, &stopped, &sound);
            });
        }
    }
    Ok(Started { width: out_w, height: out_h, audio: audio_on })
}

fn audio_loop(pid: u32, include: bool, stopped: &AtomicBool, sound: &Channel<InvokeResponseBody>) -> Result<(), BoxErr> {
    use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat};
    let _ = initialize_mta();
    let format = WaveFormat::new(32, 32, SampleType::Float, 48_000, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, include)?;
    client.initialize_client(&format, Direction::Capture, StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }, None)?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    client.start_stream()?;
    let mut queue = std::collections::VecDeque::<u8>::new();
    const CHUNK: usize = 960 * 8; // 20 ms of 48 kHz stereo f32
    while !stopped.load(Ordering::Relaxed) {
        if capture.get_next_packet_size()?.unwrap_or(0) > 0 {
            capture.read_from_device_to_deque(&mut queue)?;
        }
        while queue.len() >= CHUNK {
            let chunk: Vec<u8> = queue.drain(..CHUNK).collect();
            if sound.send(InvokeResponseBody::Raw(chunk)).is_err() {
                return Ok(());
            }
        }
        // Silence produces no packets; the wait just times out and we check `stopped` again.
        let _ = event.wait_for_event(200);
    }
    let _ = client.stop_stream();
    Ok(())
}

#[tauri::command]
pub fn capture_stop() {
    stop_session();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    // Needs a desktop session (screens, windows, audio): run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn lists_sources_and_captures_frames() {
        let sources = tauri::async_runtime::block_on(capture_sources(true)).expect("sources");
        let screens = sources.iter().filter(|s| s.kind == "screen").count();
        let thumbs = sources.iter().filter(|s| s.thumbnail.is_some()).count();
        println!("{} sources ({} screens), {} thumbnails", sources.len(), screens, thumbs);
        assert!(screens >= 1);
        assert!(thumbs >= 1);

        let frames = Arc::new(AtomicUsize::new(0));
        let bytes = Arc::new(AtomicUsize::new(0));
        let (f, b) = (frames.clone(), bytes.clone());
        let video = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(v) = body {
                if !v.is_empty() {
                    f.fetch_add(1, Ordering::Relaxed);
                    b.fetch_add(v.len(), Ordering::Relaxed);
                }
            }
            Ok(())
        });
        let audio_chunks = Arc::new(AtomicUsize::new(0));
        let a = audio_chunks.clone();
        let sound = Channel::new(move |_| {
            a.fetch_add(1, Ordering::Relaxed);
            Ok(())
        });
        let started = tauri::async_runtime::block_on(capture_start(sources[0].id.clone(), 1920, 1080, 30, true, true, video, sound)).expect("start");
        std::thread::sleep(Duration::from_secs(2));
        capture_stop();
        let n = frames.load(Ordering::Relaxed);
        println!("{}x{}: {} frames in 2 s, avg {} KB, audio chunks {}", started.width, started.height, n, bytes.load(Ordering::Relaxed) / n.max(1) / 1024, audio_chunks.load(Ordering::Relaxed));
        assert!(n >= 1);
    }
}
