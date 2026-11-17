//! Clips (2.4): an always-on replay buffer for games, on Windows.
//!
//! Video: FFmpeg captures the screen with Desktop Duplication (`ddagrab`) and encodes on the GPU
//! (NVENC, AMF or Quick Sync; software as a last resort) into 1-second MPEG-TS segments in a temp
//! folder. Old segments are deleted as new ones arrive, so only the last N seconds exist.
//! Audio: WASAPI captures game sound (everything except Aether, or everything when "include calls"
//! is on) and the microphone into in-memory ring buffers, with silence filled in so they stay on
//! the wall clock. Saving joins the segments that cover the last N seconds (no re-encode), cuts
//! the matching audio, and writes one MP4 with game and mic as separate tracks, a full-resolution
//! thumbnail as cover art, and the clip's details (game, Roblox experience, fps…) in its metadata.
//!
//! FFmpeg isn't bundled (it's ~120 MB): `clips_install_ffmpeg` downloads one pinned build from the
//! GyanD GitHub releases and checks its SHA-256 before using it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const FFMPEG_URL: &str = "https://github.com/GyanD/codexffmpeg/releases/download/2026-11-16-git-d35e13b9e0/ffmpeg-2026-11-16-git-d35e13b9e0-essentials_build.zip";
const FFMPEG_SHA256: &str = "21d3b7f6e8498fc4325e29a4291fa3fb23445655a98b2ea9ae1713eedee81fbb";
const NO_WINDOW: u32 = 0x0800_0000;
const RATE: u64 = 48_000;

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── FFmpeg ──────────────────────────────────────────────────────────────────────────────────

fn tools_dir(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_local_data_dir().map_err(e)?.join("ffmpeg"))
}
fn ffmpeg(app: &AppHandle) -> Res<PathBuf> {
    let p = tools_dir(app)?.join("ffmpeg.exe");
    if p.exists() {
        Ok(p)
    } else {
        Err("Clipping isn't set up yet.".into())
    }
}
fn ffprobe(app: &AppHandle) -> Res<PathBuf> {
    Ok(tools_dir(app)?.join("ffprobe.exe"))
}
fn run(bin: &Path, args: &[String]) -> Res<std::process::Output> {
    let out = Command::new(bin).args(args).creation_flags(NO_WINDOW).stdin(Stdio::null()).output().map_err(e)?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        let last = msg.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("FFmpeg failed");
        return Err(last.chars().take(300).collect());
    }
    Ok(out)
}
fn s<T: ToString>(x: T) -> String {
    x.to_string()
}

#[tauri::command]
pub fn clips_ready(app: AppHandle) -> bool {
    ffmpeg(&app).is_ok() && ffprobe(&app).map(|p| p.exists()).unwrap_or(false)
}

/// Downloads the pinned FFmpeg build (progress: "clips-setup" events), verifies it, and unpacks
/// ffmpeg.exe and ffprobe.exe.
#[tauri::command]
pub async fn clips_install_ffmpeg(app: AppHandle) -> Res<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let dir = tools_dir(&app)?;
    fs::create_dir_all(&dir).map_err(e)?;
    let zip_path = dir.join("download.zip");
    let client = reqwest::Client::builder().user_agent("AetherClips/1.0").build().map_err(e)?;
    let mut res = client.get(FFMPEG_URL).send().await.map_err(e)?.error_for_status().map_err(e)?;
    let total = res.content_length().unwrap_or(0);
    let mut file = fs::File::create(&zip_path).map_err(e)?;
    let mut hash = Sha256::new();
    let mut loaded: u64 = 0;
    let mut last_emit = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(e)? {
        hash.update(&chunk);
        file.write_all(&chunk).map_err(e)?;
        loaded += chunk.len() as u64;
        if loaded - last_emit > 1_000_000 {
            last_emit = loaded;
            let _ = app.emit("clips-setup", serde_json::json!({ "loaded": loaded, "total": total }));
        }
    }
    drop(file);
    let got = format!("{:x}", hash.finalize());
    if got != FFMPEG_SHA256 {
        let _ = fs::remove_file(&zip_path);
        return Err("The download didn't match the expected file, so it wasn't used. Try again later.".into());
    }
    let zip_for_unpack = zip_path.clone();
    let dir_for_unpack = dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Res<()> {
        let mut archive = zip::ZipArchive::new(fs::File::open(&zip_for_unpack).map_err(e)?).map_err(e)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(e)?;
            let name = entry.name().map_err(e)?.replace('\\', "/");
            let target = if name.ends_with("/bin/ffmpeg.exe") {
                "ffmpeg.exe"
            } else if name.ends_with("/bin/ffprobe.exe") {
                "ffprobe.exe"
            } else {
                continue;
            };
            let mut out = fs::File::create(dir_for_unpack.join(target)).map_err(e)?;
            std::io::copy(&mut entry, &mut out).map_err(e)?;
        }
        Ok(())
    })
    .await
    .map_err(e)??;
    let _ = fs::remove_file(&zip_path);
    if !clips_ready(app.clone()) {
        return Err("FFmpeg couldn't be unpacked.".into());
    }
    Ok(())
}

/// The first hardware encoder that works on this PC (NVIDIA, AMD, Intel), else software.
fn pick_encoder(app: &AppHandle) -> Res<&'static str> {
    pick_encoder_with(&ffmpeg(app)?)
}
fn pick_encoder_with(bin: &Path) -> Res<&'static str> {
    static CHOSEN: Mutex<Option<&'static str>> = Mutex::new(None);
    if let Some(c) = *CHOSEN.lock().unwrap() {
        return Ok(c);
    }
    let bin = bin.to_path_buf();
    for enc in ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"] {
        let args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=640x360:d=0.2", "-c:v", enc, "-f", "null", "-"].iter().map(s).collect();
        if run(&bin, &args).is_ok() {
            *CHOSEN.lock().unwrap() = Some(enc);
            return Ok(enc);
        }
    }
    Err("No video encoder works on this PC.".into())
}

fn encoder_args(enc: &str, quality: &str, fps: u32) -> Vec<String> {
    let q = match quality {
        "high" => 19,
        "low" => 28,
        _ => 23,
    };
    let mut a: Vec<String> = match enc {
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", &q.to_string(), "-b:v", "0", "-bf", "0"].iter().map(s).collect(),
        "h264_amf" => vec!["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", &q.to_string(), "-qp_p", &q.to_string(), "-bf", "0"].iter().map(s).collect(),
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-global_quality", &q.to_string(), "-bf", "0"].iter().map(s).collect(),
        _ => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", &q.to_string(), "-pix_fmt", "yuv420p", "-bf", "0"].iter().map(s).collect(),
    };
    a.extend(["-g".into(), fps.to_string(), "-keyint_min".into(), fps.to_string()]);
    a
}

// ── Audio ring buffers ──────────────────────────────────────────────────────────────────────

/// Stereo f32 at 48 kHz, stamped with wall-clock time. Gaps (silence) are filled with zeros.
struct Ring {
    start_ms: u64,
    dropped: u64,
    data: VecDeque<f32>,
    cap_frames: usize,
}
impl Ring {
    fn new(cap_secs: u64) -> Self {
        Ring { start_ms: now_ms(), dropped: 0, data: VecDeque::new(), cap_frames: (cap_secs * RATE) as usize }
    }
    fn written(&self) -> u64 {
        self.dropped + (self.data.len() / 2) as u64
    }
    /// Pad with silence up to "now" (minus a little slack for audio still in flight).
    fn catch_up(&mut self) {
        let expected = (now_ms().saturating_sub(self.start_ms)) * RATE / 1000;
        let slack = RATE / 10;
        if self.written() + slack < expected {
            let missing = (expected - slack - self.written()) as usize;
            self.data.extend(std::iter::repeat(0.0).take(missing * 2));
        }
        self.trim();
    }
    fn push(&mut self, samples: &[f32]) {
        self.data.extend(samples.iter().copied());
        self.trim();
    }
    fn trim(&mut self) {
        let over = (self.data.len() / 2).saturating_sub(self.cap_frames);
        if over > 0 {
            self.data.drain(..over * 2);
            self.dropped += over as u64;
        }
    }
    /// Samples between two wall-clock times (zeros where nothing was captured).
    fn slice(&self, from_ms: u64, to_ms: u64) -> Vec<f32> {
        let frames = ((to_ms.saturating_sub(from_ms)) * RATE / 1000) as usize;
        let first = (from_ms.saturating_sub(self.start_ms)) * RATE / 1000;
        let mut out = vec![0.0f32; frames * 2];
        for i in 0..frames {
            let f = first + i as u64;
            if f < self.dropped {
                continue;
            }
            let idx = ((f - self.dropped) as usize) * 2;
            if idx + 1 < self.data.len() {
                out[i * 2] = self.data[idx];
                out[i * 2 + 1] = self.data[idx + 1];
            }
        }
        out
    }
}

fn audio_thread(kind: &'static str, include_calls: bool, ring: Arc<Mutex<Ring>>, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let r = (|| -> Result<(), Box<dyn std::error::Error>> {
            use wasapi::{initialize_mta, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
            let _ = initialize_mta();
            let format = WaveFormat::new(32, 32, SampleType::Float, RATE as usize, 2, None);
            let mut client = if kind == "mic" {
                DeviceEnumerator::new()?.get_default_device(Direction::Capture)?.get_iaudioclient()?
            } else if include_calls {
                // Everything you hear, Aether calls included: loopback on the default output.
                DeviceEnumerator::new()?.get_default_device(Direction::Render)?.get_iaudioclient()?
            } else {
                // Everything except Aether itself (so friends in a call aren't in the clip).
                AudioClient::new_application_loopback_client(std::process::id(), false)?
            };
            client.initialize_client(&format, Direction::Capture, StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }, None)?;
            let event = client.set_get_eventhandle()?;
            let capture = client.get_audiocaptureclient()?;
            client.start_stream()?;
            let mut queue = VecDeque::<u8>::new();
            while !stop.load(Ordering::Relaxed) {
                if capture.get_next_packet_size()?.unwrap_or(0) > 0 {
                    capture.read_from_device_to_deque(&mut queue)?;
                }
                let n = queue.len() / 4 * 4;
                if n > 0 {
                    let bytes: Vec<u8> = queue.drain(..n).collect();
                    let samples: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                    let mut g = ring.lock().unwrap();
                    g.catch_up();
                    g.push(&samples);
                } else {
                    ring.lock().unwrap().catch_up();
                }
                let _ = event.wait_for_event(100);
            }
            let _ = client.stop_stream();
            Ok(())
        })();
        if let Err(err) = r {
            eprintln!("clips audio ({kind}): {err}");
            // Keep the timeline going with silence so saving still works.
            while !stop.load(Ordering::Relaxed) {
                ring.lock().unwrap().catch_up();
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    });
}

fn write_wav(path: &Path, samples: &[f32]) -> Res<()> {
    let mut f = fs::File::create(path).map_err(e)?;
    let data_len = (samples.len() * 4) as u32;
    let mut h = Vec::with_capacity(44);
    h.extend(b"RIFF");
    h.extend((36 + data_len).to_le_bytes());
    h.extend(b"WAVEfmt ");
    h.extend(16u32.to_le_bytes());
    h.extend(3u16.to_le_bytes()); // IEEE float
    h.extend(2u16.to_le_bytes());
    h.extend((RATE as u32).to_le_bytes());
    h.extend((RATE as u32 * 8).to_le_bytes());
    h.extend(8u16.to_le_bytes());
    h.extend(32u16.to_le_bytes());
    h.extend(b"data");
    h.extend(data_len.to_le_bytes());
    f.write_all(&h).map_err(e)?;
    let mut buf = Vec::with_capacity(samples.len() * 4);
    for v in samples {
        buf.extend(v.to_le_bytes());
    }
    f.write_all(&buf).map_err(e)
}

// ── Recorder ────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ClipSettings {
    pub fps: u32,
    /// "native", "2160", "1440", "1080" or "720" (height).
    pub resolution: String,
    /// "high", "medium" or "low".
    pub quality: String,
    pub seconds: u32,
    pub mic: bool,
    pub include_calls: bool,
    pub monitor: u32,
    pub cursor: bool,
    pub folder: String,
}

struct Recorder {
    child: Child,
    dir: PathBuf,
    settings: ClipSettings,
    stop: Arc<AtomicBool>,
    game: Arc<Mutex<Ring>>,
    mic: Option<Arc<Mutex<Ring>>>,
    started_ms: u64,
}

static RECORDER: Mutex<Option<Recorder>> = Mutex::new(None);

fn buffer_dir(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_local_data_dir().map_err(e)?.join("clipbuffer"))
}

#[derive(Serialize)]
pub struct RecorderStatus {
    running: bool,
    encoder: Option<String>,
    seconds: u32,
    since: u64,
}

#[tauri::command]
pub fn clips_status() -> RecorderStatus {
    let mut g = RECORDER.lock().unwrap();
    if let Some(r) = g.as_mut() {
        // FFmpeg exited on its own (e.g. the display changed): report it as stopped.
        if let Ok(Some(_)) = r.child.try_wait() {
            r.stop.store(true, Ordering::Relaxed);
            *g = None;
            return RecorderStatus { running: false, encoder: None, seconds: 0, since: 0 };
        }
        return RecorderStatus { running: true, encoder: (*ENCODER.lock().unwrap()).map(|x| x.to_string()), seconds: r.settings.seconds, since: r.started_ms };
    }
    RecorderStatus { running: false, encoder: None, seconds: 0, since: 0 }
}
static ENCODER: Mutex<Option<&'static str>> = Mutex::new(None);

#[tauri::command]
pub async fn clips_start(app: AppHandle, settings: ClipSettings) -> Res<()> {
    let bin = ffmpeg(&app)?;
    let dir = buffer_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || start_with(bin, dir, settings)).await.map_err(e)?
}

fn start_with(bin: PathBuf, dir: PathBuf, settings: ClipSettings) -> Res<()> {
    clips_stop();
    let enc = pick_encoder_with(&bin)?;
    *ENCODER.lock().unwrap() = Some(enc);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(e)?;
    let fps = settings.fps.clamp(10, 240);
    let hw = enc == "h264_nvenc" || enc == "h264_amf";
    let mut filters: Vec<String> = Vec::new();
    // GPU frames go straight to NVENC/AMF at native size; anything else is downloaded and scaled.
    if !hw || settings.resolution != "native" {
        filters.push("hwdownload".into());
        filters.push("format=bgra".into());
    }
    if settings.resolution != "native" {
        filters.push(format!("scale=-2:{}:flags=bicubic", settings.resolution.parse::<u32>().unwrap_or(1080)));
    }
    if !filters.is_empty() && enc != "h264_amf" && enc != "h264_nvenc" {
        filters.push("format=yuv420p".into());
    }
    let mut args: Vec<String> = vec!["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i"].iter().map(s).collect();
    args.push(format!("ddagrab=output_idx={}:framerate={}:draw_mouse={}", settings.monitor, fps, if settings.cursor { 1 } else { 0 }));
    if !filters.is_empty() {
        args.push("-vf".into());
        args.push(filters.join(","));
    }
    args.extend(encoder_args(enc, &settings.quality, fps));
    args.extend(["-an", "-f", "segment", "-segment_time", "1", "-reset_timestamps", "1", "-segment_format", "mpegts"].iter().map(s));
    args.push(dir.join("seg%06d.ts").to_string_lossy().to_string());
    let child = Command::new(&bin).args(&args).creation_flags(NO_WINDOW).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(e)?;

    let keep = settings.seconds as u64 + 15;
    let stop = Arc::new(AtomicBool::new(false));
    let game = Arc::new(Mutex::new(Ring::new(keep)));
    audio_thread("game", settings.include_calls, game.clone(), stop.clone());
    let mic = if settings.mic {
        let r = Arc::new(Mutex::new(Ring::new(keep)));
        audio_thread("mic", false, r.clone(), stop.clone());
        Some(r)
    } else {
        None
    };
    // Old segments go as new ones arrive.
    {
        let dir = dir.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                if let Ok(list) = segments(&dir) {
                    let cutoff = now_ms().saturating_sub(keep * 1000);
                    for s in list.iter().filter(|s| s.start_ms < cutoff) {
                        let _ = fs::remove_file(&s.path);
                    }
                }
                std::thread::sleep(Duration::from_millis(1000));
            }
        });
    }
    // If FFmpeg dies straight away (no capture possible), say so now instead of on save.
    std::thread::sleep(Duration::from_millis(1500));
    let mut rec = Recorder { child, dir, settings, stop, game, mic, started_ms: now_ms() };
    if let Ok(Some(status)) = rec.child.try_wait() {
        rec.stop.store(true, Ordering::Relaxed);
        return Err(format!("Recording couldn't start (FFmpeg exited with {status}). Try another resolution or update your graphics driver."));
    }
    *RECORDER.lock().unwrap() = Some(rec);
    Ok(())
}

#[tauri::command]
pub fn clips_stop() {
    if let Some(mut r) = RECORDER.lock().unwrap().take() {
        r.stop.store(true, Ordering::Relaxed);
        if let Some(stdin) = r.child.stdin.as_mut() {
            let _ = stdin.write_all(b"q");
        }
        std::thread::spawn(move || {
            for _ in 0..30 {
                if let Ok(Some(_)) = r.child.try_wait() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = r.child.kill();
            let _ = fs::remove_dir_all(&r.dir);
        });
    }
}

struct Seg {
    path: PathBuf,
    start_ms: u64,
}
fn segments(dir: &Path) -> Res<Vec<Seg>> {
    let mut v: Vec<Seg> = fs::read_dir(dir)
        .map_err(e)?
        .filter_map(|d| d.ok())
        .filter(|d| d.path().extension().map(|x| x == "ts").unwrap_or(false))
        .filter_map(|d| {
            let created = d.metadata().ok()?.created().ok()?;
            Some(Seg { path: d.path(), start_ms: created.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64 })
        })
        .collect();
    v.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(v)
}

fn safe_name(s: &str) -> String {
    let cleaned: String = s.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { ' ' } else { c }).collect();
    let t = cleaned.trim().chars().take(60).collect::<String>();
    if t.is_empty() {
        "Clip".into()
    } else {
        t
    }
}

fn stamp() -> String {
    // Local time as YYYY-MM-DD HH-MM-SS without pulling in a date crate.
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe { GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

#[derive(Deserialize)]
pub struct SaveInput {
    game: Option<String>,
    /// e.g. the Roblox experience.
    detail: Option<String>,
}

/// Saves the last N seconds. Returns the new clip's path. Emits "clip-saved".
#[tauri::command]
pub async fn clips_save(app: AppHandle, input: SaveInput) -> Res<String> {
    let (dir, settings, game_ring, mic_ring) = {
        let g = RECORDER.lock().unwrap();
        let r = g.as_ref().ok_or("Clipping is off.")?;
        (r.dir.clone(), r.settings.clone(), r.game.clone(), r.mic.clone())
    };
    let bin = ffmpeg(&app)?;
    let path = tauri::async_runtime::spawn_blocking(move || save_with(&bin, &dir, &settings, &game_ring, mic_ring.as_ref(), &input)).await.map_err(e)??;
    let p = path.to_string_lossy().to_string();
    let _ = app.emit("clip-saved", &p);
    Ok(p)
}

fn save_with(bin: &Path, dir: &Path, settings: &ClipSettings, game_ring: &Arc<Mutex<Ring>>, mic_ring: Option<&Arc<Mutex<Ring>>>, input: &SaveInput) -> Res<PathBuf> {
    {
        let pressed = now_ms();
        // Wait for the segment being written now to close, so the last second is included.
        let mut segs = segments(dir)?;
        for _ in 0..30 {
            if segs.last().map(|s| s.start_ms > pressed).unwrap_or(false) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
            segs = segments(dir)?;
        }
        if segs.len() < 2 {
            return Err("There's nothing recorded yet. Give it a second.".into());
        }
        let open = segs.pop().unwrap(); // still being written
        let from = pressed.saturating_sub(settings.seconds as u64 * 1000);
        let chosen: Vec<&Seg> = segs.iter().filter(|s| s.start_ms + 1000 > from).collect();
        let first = chosen.first().ok_or("There's nothing recorded yet.")?;
        let (v_start, v_end) = (first.start_ms, open.start_ms);
        let work = dir.join(format!("save-{pressed}"));
        fs::create_dir_all(&work).map_err(e)?;
        let list = work.join("list.txt");
        let mut lf = fs::File::create(&list).map_err(e)?;
        for s in &chosen {
            writeln!(lf, "file '{}'", s.path.to_string_lossy().replace('\'', "'\\''")).map_err(e)?;
        }
        drop(lf);
        let game_wav = work.join("game.wav");
        write_wav(&game_wav, &game_ring.lock().unwrap().slice(v_start, v_end))?;
        let mic_wav = work.join("mic.wav");
        if let Some(m) = mic_ring {
            write_wav(&mic_wav, &m.lock().unwrap().slice(v_start, v_end))?;
        }
        let dur = (v_end - v_start) as f64 / 1000.0;
        // Full-resolution thumbnail: the first frame of the middle segment.
        let thumb = work.join("thumb.jpg");
        let middle = chosen[chosen.len() / 2].path.to_string_lossy().to_string();
        if let Err(err) = run(bin, &["-hide_banner", "-loglevel", "error", "-y", "-i", &middle, "-frames:v", "1", "-q:v", "2", &thumb.to_string_lossy()].iter().map(s).collect::<Vec<_>>()) {
            eprintln!("clips thumbnail: {err}");
        }
        let folder = PathBuf::from(&settings.folder);
        fs::create_dir_all(&folder).map_err(e)?;
        let title = input.detail.clone().or(input.game.clone()).unwrap_or_else(|| "Clip".into());
        let mut out = folder.join(format!("{} {}.mp4", safe_name(&title), stamp()));
        let mut n = 2;
        while out.exists() {
            out = folder.join(format!("{} {} ({n}).mp4", safe_name(&title), stamp()));
            n += 1;
        }
        let meta = serde_json::json!({
            "aether": 1,
            "game": input.game,
            "detail": input.detail,
            "created": pressed,
            "fps": settings.fps,
            "duration": dur,
            "mic": mic_ring.is_some(),
        });
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"].iter().map(s).collect();
        args.push(list.to_string_lossy().into());
        args.extend(["-i".into(), game_wav.to_string_lossy().into()]);
        let mut next_input = 2;
        let mic_idx = if mic_ring.is_some() {
            args.extend(["-i".into(), mic_wav.to_string_lossy().into()]);
            next_input += 1;
            Some(next_input - 1)
        } else {
            None
        };
        let thumb_idx = if thumb.exists() {
            args.extend(["-i".into(), thumb.to_string_lossy().into()]);
            Some(next_input)
        } else {
            None
        };
        args.extend(["-map", "0:v:0", "-map", "1:a"].iter().map(s));
        if let Some(i) = mic_idx {
            args.extend(["-map".into(), format!("{i}:a")]);
        }
        if let Some(i) = thumb_idx {
            args.extend(["-map".into(), format!("{i}:v")]);
        }
        args.extend(["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"].iter().map(s));
        if thumb_idx.is_some() {
            args.extend(["-c:v:1", "mjpeg", "-disposition:v:1", "attached_pic"].iter().map(s));
        }
        args.extend(["-metadata".into(), format!("title={title}"), "-metadata".into(), format!("comment={meta}")]);
        // MP4 keeps track names as handler_name.
        args.extend(["-metadata:s:a:0".into(), "handler_name=Game audio".into()]);
        if mic_idx.is_some() {
            args.extend(["-metadata:s:a:1".into(), "handler_name=Microphone".into()]);
        }
        args.extend(["-movflags", "+faststart"].iter().map(s));
        args.push(out.to_string_lossy().into());
        let r = run(bin, &args);
        let _ = fs::remove_dir_all(&work);
        r?;
        Ok(out)
    }
}

// ── Library ─────────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct ClipInfo {
    path: String,
    file: String,
    title: String,
    /// The JSON stored in the MP4's comment tag (game, detail, created, expires…).
    meta: serde_json::Value,
    duration: f64,
    width: u32,
    height: u32,
    fps: f64,
    size: u64,
    modified: u64,
    audio_tracks: Vec<String>,
    thumb: Option<String>,
    received: bool,
}

static INFO_CACHE: Mutex<Option<HashMap<String, (u64, u64, ClipInfo)>>> = Mutex::new(None);

fn probe(app: &AppHandle, path: &Path, received: bool) -> Res<ClipInfo> {
    let md = fs::metadata(path).map_err(e)?;
    let modified = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    let key = path.to_string_lossy().to_string();
    if let Some((m, sz, info)) = INFO_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&key) {
        if *m == modified && *sz == md.len() {
            return Ok(info.clone());
        }
    }
    let out = run(&ffprobe(app)?, &["-v", "error", "-show_entries", "format=duration:format_tags=title,comment:stream=index,codec_type,width,height,avg_frame_rate:stream_disposition=attached_pic:stream_tags=title,handler_name", "-of", "json", &key].iter().map(s).collect::<Vec<_>>())?;
    let j: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(e)?;
    let streams = j["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    let fps = video
        .and_then(|v| v["avg_frame_rate"].as_str())
        .and_then(|r| {
            let (a, b) = r.split_once('/')?;
            let (a, b) = (a.parse::<f64>().ok()?, b.parse::<f64>().ok()?);
            (b > 0.0).then_some(a / b)
        })
        .unwrap_or(0.0);
    let audio_tracks = streams.iter().filter(|s| s["codec_type"] == "audio").map(|s| s["tags"]["handler_name"].as_str().or(s["tags"]["title"].as_str()).unwrap_or("Audio").to_string()).collect();
    let tags = &j["format"]["tags"];
    let meta = tags["comment"].as_str().and_then(|c| serde_json::from_str(c).ok()).unwrap_or(serde_json::json!({}));
    // Thumbnail: the embedded cover, else a frame, cached by file.
    let thumbs = app.path().app_cache_dir().map_err(e)?.join("clipthumbs");
    fs::create_dir_all(&thumbs).map_err(e)?;
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    h.update(modified.to_le_bytes());
    let thumb = thumbs.join(format!("{:x}.jpg", h.finalize()));
    if !thumb.exists() {
        let bin = ffmpeg(app)?;
        let cover = streams.iter().find(|s| s["disposition"]["attached_pic"] == 1).and_then(|s| s["index"].as_u64());
        let ok = match cover {
            Some(i) => run(&bin, &["-hide_banner", "-loglevel", "error", "-y", "-i", &key, "-map", &format!("0:{i}"), "-frames:v", "1", "-c:v", "copy", &thumb.to_string_lossy()].iter().map(s).collect::<Vec<_>>()).is_ok(),
            None => false,
        };
        if !ok {
            let _ = run(&bin, &["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", &key, "-frames:v", "1", "-q:v", "2", &thumb.to_string_lossy()].iter().map(s).collect::<Vec<_>>());
        }
    }
    let info = ClipInfo {
        file: path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        title: tags["title"].as_str().map(|s| s.to_string()).unwrap_or_else(|| path.file_stem().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()),
        path: key.clone(),
        meta,
        duration: j["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0),
        width: video.and_then(|v| v["width"].as_u64()).unwrap_or(0) as u32,
        height: video.and_then(|v| v["height"].as_u64()).unwrap_or(0) as u32,
        fps,
        size: md.len(),
        modified,
        audio_tracks,
        thumb: thumb.exists().then(|| thumb.to_string_lossy().to_string()),
        received,
    };
    INFO_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, (modified, md.len(), info.clone()));
    Ok(info)
}

fn allow(app: &AppHandle, dir: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

#[tauri::command]
pub fn clips_default_folder(app: AppHandle) -> Res<String> {
    let base = app.path().video_dir().or_else(|_| app.path().home_dir()).map_err(e)?;
    Ok(base.join("Aether Clips").to_string_lossy().to_string())
}

/// Your clips and received clips (in "<folder>/Received"), newest first.
#[tauri::command]
pub async fn clips_list(app: AppHandle, folder: String) -> Res<Vec<ClipInfo>> {
    tauri::async_runtime::spawn_blocking(move || -> Res<Vec<ClipInfo>> {
        let root = PathBuf::from(&folder);
        let received = root.join("Received");
        fs::create_dir_all(&received).map_err(e)?;
        allow(&app, &root);
        if let Ok(c) = app.path().app_cache_dir() {
            allow(&app, &c.join("clipthumbs"));
        }
        let mut out = Vec::new();
        for (dir, is_received) in [(&root, false), (&received, true)] {
            for d in fs::read_dir(dir).map_err(e)?.filter_map(|d| d.ok()) {
                let p = d.path();
                if p.extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false) {
                    if let Ok(info) = probe(&app, &p, is_received) {
                        out.push(info);
                    }
                }
            }
        }
        out.sort_by(|a, b| {
            let ca = a.meta["created"].as_u64().unwrap_or(a.modified);
            let cb = b.meta["created"].as_u64().unwrap_or(b.modified);
            cb.cmp(&ca)
        });
        Ok(out)
    })
    .await
    .map_err(e)?
}

#[tauri::command]
pub fn clips_delete(path: String) -> Res<()> {
    fs::remove_file(&path).map_err(e)
}

#[derive(Deserialize)]
pub struct ExportInput {
    path: String,
    start: f64,
    end: f64,
    game_audio: bool,
    mic: bool,
    title: Option<String>,
    /// "original", "high" (1080p) or "saver" (720p, 30 fps).
    quality: String,
    /// Replace the metadata JSON (merged into the existing one).
    meta: Option<serde_json::Value>,
    /// "replace" the file, save a "copy" next to it, or make a "temp" file for sharing.
    out: String,
}

/// Trim, choose audio tracks, rename, compress. Copies the video when nothing needs re-encoding.
#[tauri::command]
pub async fn clips_export(app: AppHandle, input: ExportInput) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || -> Res<String> {
        let src = PathBuf::from(&input.path);
        let info = probe(&app, &src, false)?;
        let bin = ffmpeg(&app)?;
        let trimmed = input.start > 0.05 || input.end < info.duration - 0.05;
        let reencode = trimmed || input.quality != "original";
        let tmp_dir = app.path().app_cache_dir().map_err(e)?.join("clipexport");
        fs::create_dir_all(&tmp_dir).map_err(e)?;
        let target = match input.out.as_str() {
            "temp" => tmp_dir.join(format!("share-{}.mp4", now_ms())),
            "copy" => {
                let stem = src.file_stem().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "Clip".into());
                let mut p = src.with_file_name(format!("{stem} (edit).mp4"));
                let mut n = 2;
                while p.exists() {
                    p = src.with_file_name(format!("{stem} (edit {n}).mp4"));
                    n += 1;
                }
                p
            }
            _ => tmp_dir.join(format!("replace-{}.mp4", now_ms())),
        };
        let mut meta = info.meta.clone();
        if let (Some(obj), Some(serde_json::Value::Object(extra))) = (meta.as_object_mut(), input.meta.clone()) {
            for (k, v) in extra {
                obj.insert(k, v);
            }
        }
        if let Some(obj) = meta.as_object_mut() {
            obj.insert("duration".into(), serde_json::json!(input.end - input.start));
            obj.insert("mic".into(), serde_json::json!(input.mic && info.audio_tracks.len() > 1));
        }
        let title = input.title.clone().unwrap_or(info.title.clone());
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y"].iter().map(s).collect();
        if trimmed {
            args.extend(["-ss".into(), format!("{:.3}", input.start), "-to".into(), format!("{:.3}", input.end)]);
        }
        args.extend(["-i".into(), input.path.clone(), "-map".into(), "0:v:0".into()]);
        let mut audio_out = 0;
        if input.game_audio && !info.audio_tracks.is_empty() {
            args.extend(["-map", "0:a:0"].iter().map(s));
            audio_out += 1;
        }
        if input.mic && info.audio_tracks.len() > 1 {
            args.extend(["-map", "0:a:1"].iter().map(s));
            audio_out += 1;
        }
        if reencode {
            let enc = pick_encoder(&app)?;
            let (h, fps) = match input.quality.as_str() {
                "high" => (Some(1080), None),
                "saver" => (Some(720), Some(30)),
                _ => (None, None),
            };
            let mut vf = Vec::new();
            if let Some(h) = h {
                if info.height > h {
                    vf.push(format!("scale=-2:{h}"));
                }
            }
            if let Some(f) = fps {
                if info.fps > f as f64 + 1.0 {
                    vf.push(format!("fps={f}"));
                }
            }
            if !vf.is_empty() {
                args.extend(["-vf".into(), vf.join(",")]);
            }
            let q = if input.quality == "saver" { "low" } else if input.quality == "high" { "medium" } else { "high" };
            args.extend(encoder_args(enc, q, fps.unwrap_or(info.fps.round().max(1.0) as u32)));
            if enc == "libx264" {
                // already yuv420p
            } else {
                args.extend(["-pix_fmt", "yuv420p"].iter().map(s));
            }
        } else {
            args.extend(["-c:v", "copy"].iter().map(s));
        }
        if audio_out > 0 {
            args.extend(["-c:a", if reencode { "aac" } else { "copy" }].iter().map(s));
            if reencode {
                args.extend(["-b:a", "160k"].iter().map(s));
            }
        } else {
            args.push("-an".into());
        }
        args.extend(["-metadata".into(), format!("title={title}"), "-metadata".into(), format!("comment={meta}")]);
        let mut a = 0;
        if input.game_audio && !info.audio_tracks.is_empty() {
            args.extend([format!("-metadata:s:a:{a}"), "handler_name=Game audio".into()]);
            a += 1;
        }
        if input.mic && info.audio_tracks.len() > 1 {
            args.extend([format!("-metadata:s:a:{a}"), "handler_name=Microphone".into()]);
        }
        args.extend(["-movflags", "+faststart"].iter().map(s));
        args.push(target.to_string_lossy().into());
        run(&bin, &args)?;
        if input.out == "replace" {
            fs::rename(&target, &src).or_else(|_| fs::copy(&target, &src).map(|_| ()).and_then(|_| fs::remove_file(&target))).map_err(e)?;
            INFO_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).remove(&input.path);
            return Ok(input.path);
        }
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(e)?
}

/// Replaces (merges) the clip's metadata JSON without touching video or audio.
#[tauri::command]
pub async fn clips_set_meta(app: AppHandle, path: String, meta: serde_json::Value, title: Option<String>) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || -> Res<()> {
        let src = PathBuf::from(&path);
        let info = probe(&app, &src, false)?;
        let mut merged = info.meta.clone();
        if let (Some(obj), serde_json::Value::Object(extra)) = (merged.as_object_mut(), meta) {
            for (k, v) in extra {
                if v.is_null() {
                    obj.remove(&k);
                } else {
                    obj.insert(k, v);
                }
            }
        }
        let tmp = src.with_extension("meta.mp4");
        let title = title.unwrap_or(info.title);
        run(&ffmpeg(&app)?, &["-hide_banner", "-loglevel", "error", "-y", "-i", &path, "-map", "0", "-c", "copy", "-metadata", &format!("title={title}"), "-metadata", &format!("comment={merged}"), "-movflags", "+faststart", &tmp.to_string_lossy()].iter().map(s).collect::<Vec<_>>())?;
        fs::rename(&tmp, &src).map_err(e)?;
        INFO_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).remove(&path);
        Ok(())
    })
    .await
    .map_err(e)?
}

/// Deletes received clips whose "expires" time has passed. Returns how many.
#[tauri::command]
pub async fn clips_sweep(app: AppHandle, folder: String) -> Res<u32> {
    let list = clips_list(app, folder).await?;
    let now = now_ms();
    let mut n = 0;
    for c in list.iter().filter(|c| c.received) {
        if let Some(exp) = c.meta["expires"].as_u64() {
            if exp < now && fs::remove_file(&c.path).is_ok() {
                n += 1;
            }
        }
    }
    Ok(n)
}

// ── Raw file access for sharing (chunks, so big clips never sit in memory) ──────────────────

#[tauri::command]
pub fn clips_file_size(path: String) -> Res<u64> {
    Ok(fs::metadata(path).map_err(e)?.len())
}

#[tauri::command]
pub fn clips_read(path: String, offset: u64, len: u64) -> Res<tauri::ipc::Response> {
    let mut f = fs::File::open(path).map_err(e)?;
    f.seek(SeekFrom::Start(offset)).map_err(e)?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf).map_err(e)?;
    Ok(tauri::ipc::Response::new(buf))
}

/// Writes a chunk: body = bytes; headers "path" and "offset". Received clips land in
/// "<folder>/Received".
#[tauri::command]
pub fn clips_write(request: tauri::ipc::Request<'_>) -> Res<()> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(|v| v.to_string());
    let path = header("path").ok_or("missing path")?;
    let path = percent_decode(&path);
    let offset: u64 = header("offset").and_then(|o| o.parse().ok()).unwrap_or(0);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(e)?;
    }
    let mut f = fs::OpenOptions::new().create(true).write(true).truncate(offset == 0).open(&path).map_err(e)?;
    f.seek(SeekFrom::Start(offset)).map_err(e)?;
    f.write_all(bytes).map_err(e)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
pub async fn clips_hash(path: String) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || -> Res<String> {
        let mut f = fs::File::open(path).map_err(e)?;
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf).map_err(e)?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
        }
        Ok(format!("{:x}", h.finalize()))
    })
    .await
    .map_err(e)?
}

// ── Roblox: which experience you're in ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RobloxPlace {
    place_id: u64,
    name: Option<String>,
}

/// Reads the newest Roblox log for the place you joined and looks up its name.
#[tauri::command]
pub async fn roblox_place() -> Option<RobloxPlace> {
    let logs = std::env::var("LOCALAPPDATA").ok().map(|d| PathBuf::from(d).join("Roblox").join("logs"))?;
    let newest = fs::read_dir(&logs)
        .ok()?
        .filter_map(|d| d.ok())
        .filter(|d| d.path().extension().map(|x| x == "log").unwrap_or(false))
        .max_by_key(|d| d.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH))?
        .path();
    let text = fs::read(&newest).ok()?;
    let text = String::from_utf8_lossy(&text);
    let mut place: Option<u64> = None;
    for line in text.lines() {
        // "! Joining game '<job>' place 920587237 at …" or "...placeId=920587237..."
        if let Some(i) = line.find("Joining game") {
            if let Some(p) = line[i..].split(" place ").nth(1).and_then(|r| r.split_whitespace().next()).and_then(|n| n.parse().ok()) {
                place = Some(p);
            }
        } else if let Some(i) = line.find("placeId=") {
            if let Some(p) = line[i + 8..].split(|c: char| !c.is_ascii_digit()).next().and_then(|n| n.parse().ok()) {
                place = Some(p);
            }
        }
    }
    let place_id = place?;
    static NAMES: Mutex<Option<HashMap<u64, String>>> = Mutex::new(None);
    if let Some(n) = NAMES.lock().unwrap().get_or_insert_with(HashMap::new).get(&place_id) {
        return Some(RobloxPlace { place_id, name: Some(n.clone()) });
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder().user_agent("AetherClips/1.0").timeout(Duration::from_secs(6)).build().ok()?;
    let name = async {
        let u: serde_json::Value = client.get(format!("https://apis.roblox.com/universes/v1/places/{place_id}/universe")).send().await.ok()?.json().await.ok()?;
        let universe = u["universeId"].as_u64()?;
        let g: serde_json::Value = client.get(format!("https://games.roblox.com/v1/games?universeIds={universe}")).send().await.ok()?.json().await.ok()?;
        g["data"][0]["name"].as_str().map(|s| s.to_string())
    }
    .await;
    if let Some(n) = &name {
        NAMES.lock().unwrap().get_or_insert_with(HashMap::new).insert(place_id, n.clone());
    }
    Some(RobloxPlace { place_id, name })
}

/// Lets you choose where clips are saved.
#[tauri::command]
pub async fn clips_pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Where should clips be saved?").pick_folder(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Records the real screen and sound for a few seconds. Needs FFmpeg:
    //   CLIPS_FFMPEG=<folder with ffmpeg.exe> cargo test clips -- --ignored --nocapture
    #[test]
    #[ignore]
    fn records_and_saves_a_clip() {
        let tools = PathBuf::from(std::env::var("CLIPS_FFMPEG").expect("CLIPS_FFMPEG"));
        let bin = tools.join("ffmpeg.exe");
        let work = std::env::temp_dir().join(format!("aether-clip-test-{}", now_ms()));
        let buf = work.join("buffer");
        let out = work.join("out");
        let settings = ClipSettings { fps: 60, resolution: "1080".into(), quality: "high".into(), seconds: 6, mic: true, include_calls: false, monitor: 0, cursor: true, folder: out.to_string_lossy().into() };
        println!("encoder: {:?}", pick_encoder_with(&bin));
        start_with(bin.clone(), buf.clone(), settings.clone()).expect("start");
        std::thread::sleep(Duration::from_secs(9));
        let (game, mic) = {
            let g = RECORDER.lock().unwrap();
            let r = g.as_ref().expect("recorder running");
            (r.game.clone(), r.mic.clone())
        };
        let started = std::time::Instant::now();
        let path = save_with(&bin, &buf, &settings, &game, mic.as_ref(), &SaveInput { game: Some("Roblox".into()), detail: Some("Test Place".into()) }).expect("save");
        println!("saved in {:?}: {}", started.elapsed(), path.display());
        clips_stop();
        let probe = run(&tools.join("ffprobe.exe"), &["-v", "error", "-show_entries", "format=duration,size:format_tags=title,comment:stream=codec_name,codec_type,width,height,avg_frame_rate:stream_disposition=attached_pic:stream_tags=handler_name", "-of", "json", &path.to_string_lossy()].iter().map(s).collect::<Vec<_>>()).expect("probe");
        let j: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
        println!("{}", serde_json::to_string_pretty(&j).unwrap());
        let streams = j["streams"].as_array().unwrap();
        assert!(streams.iter().any(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] == 0), "video track");
        assert_eq!(streams.iter().filter(|s| s["codec_type"] == "audio").count(), 2, "game + mic tracks");
        assert!(streams.iter().any(|s| s["disposition"]["attached_pic"] == 1), "cover thumbnail");
        let d: f64 = j["format"]["duration"].as_str().unwrap().parse().unwrap();
        assert!((5.0..9.5).contains(&d), "duration {d}");
        assert!(j["format"]["tags"]["comment"].as_str().unwrap().contains("Test Place"));
        std::thread::sleep(Duration::from_secs(4));
        let _ = fs::remove_dir_all(&work);
    }
}
