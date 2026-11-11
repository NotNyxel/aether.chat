# Changelog

All notable changes to aether.chat. Versions follow [semver](https://semver.org); every version is published on the
GitHub Releases page, and installs from 0.3.0 onward update themselves.

## [0.3.0] - 2026-11-11

**Renamed to aether.chat · zero-setup · auto-updates**

- **New name:** AetherChat is now **aether.chat**. Installing 0.3.0 automatically removes the old "AetherChat" copy.
  You stay signed in, and your settings carry over.
- **No setup screen:** the app connects to the official aether.chat backend out of the box. Install, sign up, chat.
- **Automatic updates:** the app checks for new versions on launch and every 6 hours. One click downloads, verifies
  and installs the update, then restarts. Every update is signed, and the app refuses any file that isn't.
- New sign-in screen branding.

## [0.2.0] - 2026-11-11

**Friends, DMs, group DMs and calls**

- **Friends:** add by username, accept or ignore requests, remove, block and unblock. Tabs for Online, All, Pending
  and Blocked.
- **Direct messages** with friends and with people you share a server with, plus unread markers.
- **Group DMs** of up to 10 people: rename, add friends, leave (ownership passes to the next member).
- **1:1 and group calls** with ringing, Accept and Decline, a "Join call" banner, camera video and screen share.
- **Camera video** in server voice channels.
- **Messages:** replies, inline editing (↑ edits your last message), reactions, file uploads (button, paste or
  drag-and-drop, up to 25 MB), typing indicators, and highlighted @mentions.
- **Presence:** Online, Idle, Do Not Disturb or Invisible, with status dots everywhere.
- **Servers:** member list (online and offline), category creation, leave or delete server.
- Database: `supabase/migrations/002_social.sql` (friends, blocks, conversations, calls, reactions, Realtime topic auth).

## [0.1.0] - 2026-11-11

**First release**

- Servers, channels (text, voice, stream, categories), invites, and live text chat with Markdown.
- Peer-to-peer mesh voice over WebRTC (PeerJS + Google STUN) with a Web Audio pipeline: high-pass filter, compressor,
  noise gate, per-user volume, mute and deafen.
- Screen share at 720p or 1080p and 15, 30 or 60 FPS, with bandwidth profiles.
- Theme engine with four presets (OLED Dark, Cyberpunk, Nord, aetherOS Glass), accent colors and sandboxed custom CSS.
- Rich profiles: banner, animated avatar frames, Markdown bio, badges, audio status clip and profile CSS.
- Settings: profile editor, appearance, audio devices and mic test, keybinds and push-to-talk, bandwidth.
- Windows installer (Tauri + WebView2, about 1.3 MB).
