//! Spotify mini-player (2.1, Windows): play/pause, next, previous and seek for the Spotify app, and
//! its album cover, through Windows' media controls (the same as the volume flyout's media card).
//! No Spotify account, login or Premium needed.

#[cfg(windows)]
mod imp {
    use base64::Engine;
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager};
    use windows::Storage::Streams::{DataReader, InputStreamOptions};

    fn spotify() -> Option<Session> {
        let manager = Manager::RequestAsync().ok()?.join().ok()?;
        let sessions = manager.GetSessions().ok()?;
        for i in 0..sessions.Size().ok()? {
            let s = sessions.GetAt(i).ok()?;
            if s.SourceAppUserModelId().ok()?.to_string().to_ascii_lowercase().contains("spotify") {
                return Some(s);
            }
        }
        None
    }

    pub fn action(action: &str, position_ms: Option<u64>) -> bool {
        let Some(s) = spotify() else { return false };
        let done = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            "seek" => s.TryChangePlaybackPositionAsync((position_ms.unwrap_or(0) as i64) * 10_000),
            _ => return false,
        };
        done.ok().and_then(|op| op.join().ok()).unwrap_or(false)
    }

    /// The current album cover as a data: URL (only for showing in your own player).
    pub fn cover() -> Option<String> {
        let s = spotify()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 2_000_000 {
            return None;
        }
        let input = stream.GetInputStreamAt(0).ok()?;
        let reader = DataReader::CreateDataReader(&input).ok()?;
        reader.SetInputStreamOptions(InputStreamOptions::None).ok()?;
        let loaded = reader.LoadAsync(size).ok()?.join().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
    }
}

/// toggle | next | previous | seek (with position_ms). False when Spotify isn't open.
#[tauri::command]
pub async fn media_action(action: String, position_ms: Option<u64>) -> bool {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || imp::action(&action, position_ms)).await.unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = (action, position_ms);
        false
    }
}

#[tauri::command]
pub async fn now_playing_cover() -> Option<String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(imp::cover).await.ok().flatten()
    }
    #[cfg(not(windows))]
    {
        None
    }
}
