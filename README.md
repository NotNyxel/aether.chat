<p align="center">
  <img src="public/icon.svg" width="96" alt="aether.chat logo" />
</p>

<h1 align="center">aether.chat</h1>

<p align="center">
  A lightweight Discord-style chat app with peer-to-peer voice and video, built to run at <b>$0</b>.<br/>
  Tauri + React 19 + Supabase + WebRTC · ~1.3 MB installer · automatic signed updates
</p>

---

## Contents
- [Install](#install)
- [Features](#features)
- [How it works](#how-it-works)
- [Privacy & security](#privacy--security)
- [Development](#development)
- [Database](#database)
- [Releasing & auto-updates](#releasing--auto-updates)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [Known limitations](#known-limitations)

---

## Install

1. Download the latest `aether.chat_<version>_x64-setup.exe` from the
   [Releases page](https://github.com/notnyxel/aether.chat-releases/releases/latest).
2. Run it. It installs for your Windows user only, so no admin prompt.
3. Sign up with a username, email and password.

That's it. There's nothing to configure. The app keeps itself up to date: when a new version is out you'll see an
**Update available** card in the bottom-right corner. One click installs it and restarts.

> Requires Windows 10/11 with the Microsoft Edge WebView2 runtime (preinstalled on Windows 11 and up-to-date Windows 10).

---

## Features

### 💬 Chat
| | |
|---|---|
| **Servers & channels** | Text, voice and stream channels grouped into categories. Invite codes that expire after 7 days. |
| **Live messaging** | Messages, edits, deletes and reactions appear instantly for everyone (Supabase Realtime). |
| **Markdown** | `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, code blocks, quotes, lists, headings, `||spoilers||` and links. |
| **Replies & edits** | Reply to any message. Edit your own inline, or press **↑** to edit your last message. |
| **Reactions** | 12 quick reactions, with live counts. |
| **Attachments** | Upload via the **+** button, paste or drag-and-drop (up to 25 MB). Images, video and audio preview inline. |
| **Mentions** | `@username` is highlighted, and messages that mention you are marked. |
| **Typing indicators** | "Alex is typing…" in every channel and DM. |

### 👥 Social
| | |
|---|---|
| **Friends** | Add by username, accept or ignore requests, remove and block. Online / All / Pending / Blocked tabs. |
| **Direct messages** | 1:1 DMs with friends or anyone you share a server with. Unread dots and a badge on the Home button. |
| **Group DMs** | Up to 10 people. Rename (double-click the name), add friends, leave (ownership passes on). |
| **Presence** | Online, Idle, Do Not Disturb or Invisible, shown as status dots on avatars everywhere. |
| **Member list** | Per-server online and offline lists with crowns for owners. |

### 🎙️ Voice, video & calls
| | |
|---|---|
| **Voice channels** | Join any voice or stream channel. Everyone connects directly to everyone (P2P mesh). |
| **DM & group calls** | Call from a DM header (voice or video). The others get a ringing card with Accept or Decline. |
| **Camera** | Turn your camera on in any call. Quality follows your bandwidth profile (360p to 720p). |
| **Screen share** | 720p or 1080p at 15, 30 or 60 FPS, with optional system or tab audio. |
| **Audio pipeline** | High-pass filter, compressor, noise gate with a live meter, per-user volume (0–200%), mute and deafen. |
| **Push-to-talk & keybinds** | Rebindable mute, deafen and PTT shortcuts. |

### 🎨 Customization
| | |
|---|---|
| **Themes** | OLED Dark, Cyberpunk, Nord and aetherOS Glass, plus a custom accent color or your profile accent. |
| **Custom CSS** | App-wide CSS that is sanitized and sandboxed (it can't escape the app or load scripts). |
| **Profiles** | Banner, animated avatar frames (pulse, aurora, neon, orbit, glitch), Markdown bio, badges, an audio status clip, profile colors and sandboxed profile CSS. |

### ⚙️ App
- **Automatic, signed updates** from GitHub Releases.
- **Tiny footprint:** about a 1.3 MB installer, using the system WebView2 instead of bundling Chromium.
- **Settings:** profile editor, appearance, audio and video devices, keybinds, bandwidth.

---

## How it works

```
 aether.chat (Tauri + WebView2)          Supabase (free tier)                 Other users
┌──────────────────────────────┐  HTTPS ┌───────────────────────────┐
│ React 19 · Zustand · TanStack├───────►│ Postgres + Row-Level Sec. │
│ ThemeEngine · VoiceEngine    │  WSS   │ Realtime (changes, presence, typing)
│                              ├───────►│ Auth · Storage            │
└──────────┬───────────────────┘        └───────────────────────────┘
           │  WebRTC (DTLS-SRTP), direct peer-to-peer: audio, camera, screen
           └──────────────────────────────────────────────────────────────►  peers
             Signaling: Supabase presence + PeerJS broker · NAT traversal: Google STUN
```

- **Text, profiles, friends and DMs** live in Supabase Postgres. Every table is protected by Row-Level Security, so the
  database itself enforces who can read or write what.
- **Voice and video never touch a server.** Each call is a full mesh of direct WebRTC connections. Supabase presence
  works out who is in the room; only the peer with the smaller ID dials, which avoids glare. Camera and screen share
  ride on separate one-way connections, so they never interrupt audio.
- **Calls ring** through a row in `public.calls`. Realtime pushes the insert to every member of the conversation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and the join sequence.

---

## Privacy & security

- **Row-Level Security everywhere.** The security tests (`supabase/tests`) cover these rules:
  - outsiders can't read DMs
  - blocks stop messages, calls and friend requests
  - only authors can edit their messages
  - only conversation members can join a call's voice room
- **The publishable key is public by design.** It ships in the app and only grants what RLS allows a signed-in user.
  Secret keys are never in this repo.
- **Custom CSS is sandboxed.** It's parsed by the browser, stripped of script vectors and wrapped in `@scope`. Profile
  CSS can't load any remote URL, so viewing a profile can't leak your IP address to a tracker.
- **Updates are signed** (minisign/Ed25519). The app refuses an update whose signature doesn't match the public key
  built into it.
- **Online presence** is shared on one global channel, so any signed-in user can see who's online. Choose
  **Invisible** to hide.

---

## Development

**Prerequisites:** Node 20+, Rust (stable, MSVC toolchain), Visual Studio C++ build tools, WebView2.

```bash
npm install
npm run dev            # web build at http://localhost:1420
npm run tauri dev      # desktop app with hot reload
npm run typecheck
```

To work against a different Supabase project, create `.env.local`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

---

## Database

Migrations live in `supabase/`. Run them in order in the Supabase SQL editor:

| File | Adds |
|---|---|
| `schema.sql` | Users, servers, channels, roles and permission bitmasks, messages, invites, bans, storage buckets |
| `migrations/002_social.sql` | Friends, blocks, DMs, group DMs, calls, reactions, presence status, Realtime topic authorization |

Permissions use a Discord-style 64-bit mask (`src/lib/permissions.ts` mirrors `public.permission_bit()`).

---

## Releasing & auto-updates

aether.chat uses two GitHub repos:

| Repo | Visibility | Holds |
|---|---|---|
| `aether.chat` | private | Source code, tags and releases with every installer |
| `aether.chat-releases` | public | Signed installers and `latest.json`, the update feed the app polls |

The update feed has to be public: an installed app can't authenticate to a private repo without shipping a secret.

To release:
1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Add a section to `CHANGELOG.md`. It becomes the release notes and the text in the in-app update card.
3. Commit, then run `node scripts/release.mjs`.

The script builds and signs the installer, writes `latest.json`, tags the commit and publishes to both repos. The
signing key lives in `.secrets/` (git-ignored). **Back it up.** If it's lost, existing installs can never update again.

---

## Project structure

```
src/
  components/      UI: layout, chat, DMs, friends, calls, settings, ThemeEngine, ProfileCard, UpdateBanner
  hooks/           useVoiceEngine (WebRTC mesh), useChatData / useSocialData (TanStack Query),
                   usePresence, useTyping, useKeybinds
  lib/             supabase client, markdown renderer, permissions, keybinds, platform helpers
  stores/          Zustand: settings (persisted) and UI state
  theme/           theme presets and avatar frames
  config.ts        app name and built-in backend
src-tauri/         Rust shell, updater, NSIS installer hooks, icons
supabase/          schema and migrations
scripts/           release tooling
docs/              architecture
```

---

## Roadmap

Features ship in themed batches, one minor version each. See **[ROADMAP.md](ROADMAP.md)** for the full plan and
**[CHANGELOG.md](CHANGELOG.md)** for what each version contains.

## Known limitations
- **Voice rooms work best with up to about 8–10 people** (full mesh, no media server).
- **Some strict networks can't connect peer-to-peer** (symmetric NAT, some corporate networks). There's no TURN relay
  by default, to keep the cost at $0.
- **Shortcuts only work while the window is focused** until global shortcuts land in Batch 3.
- **Windows only** for now.
