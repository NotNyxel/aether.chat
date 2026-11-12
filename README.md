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

1. Download **[aether.chat-Setup.exe](https://github.com/NotNyxel/aether.chat-releases/releases/latest/download/aether.chat-Setup.exe)**.
2. Run it. It installs in one click, for your Windows user only (no admin prompt), and opens aether.chat.
3. Sign up with a username, email and password.

That's it. There's nothing to configure. The app keeps itself up to date: every time it starts, it checks for a
new version and installs it before opening.

**No install?** Use the web app at **[aether-chat-beta.vercel.app](https://aether-chat-beta.vercel.app)** in any browser,
on PC or phone.

> Requires Windows 10/11 with the Microsoft Edge WebView2 runtime (preinstalled on Windows 11 and up-to-date Windows 10).

---

## Features

### 💬 Chat
| | |
|---|---|
| **Servers & channels** | Text, announcement, forum, media, voice and stage channels grouped into categories. Invite codes that expire after 7 days. |
| **Threads** | Public or private threads from any message, in a side panel. Archive, auto-archive, lock, follow. |
| **Forums & media** | Posts with titles, tags, guidelines, search, sort, and list or gallery layouts. Media channels need an image or video. |
| **Announcements** | Moderator-only channels other servers can follow. Published posts are copied to followers. |
| **Events** | Schedule voice, stage or in-person events. RSVP, reminders, start/end, LIVE badge. |
| **Live messaging** | Messages, edits, deletes and reactions appear instantly for everyone (Supabase Realtime). |
| **Markdown** | `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, code blocks, quotes, lists, headings, `||spoilers||` and links. |
| **Replies & edits** | Reply to any message. Edit your own inline, or press **↑** to edit your last message. |
| **Reactions** | Full emoji picker (search, categories, recents) plus quick reactions, with live counts. |
| **Attachments** | Upload via the **+** button, paste or drag-and-drop (up to 25 MB). Mark as spoiler, add alt text, click an image for a full-screen viewer. |
| **Invites** | `aether.chat/inv/CODE` links or just the code, case-insensitive, with a live server preview before joining and invite cards in chat. |
| **Message requests** | Search for anyone and send up to 3 messages; they land in Message requests with Accept, Ignore, Block and Block & report. |
| **Autocomplete** | `@member`, `@everyone` / `@here`, `#channel` and `:emoji`. Completed `:shortcodes:` turn into emoji. |
| **Mentions & unreads** | Mention badges on servers, channels and DMs. Unread dots, a "NEW" divider and *Jump to present*. |
| **Pins & search** | Pinned-messages panel. Full-text search with `from:`, `has:`, `pinned:`, `before:` and `after:` filters, plus jump-to-result. |
| **Link previews** | Title, description and image for any link, plus click-to-play YouTube. `<link>` hides a preview. |
| **Polls** | 2–10 answers with emoji, single or multiple choice, 1 hour to 1 week, live results. |
| **Forward & message links** | Forward any message to a DM or channel. Copy a link to a message; clicking it jumps there in-app. |
| **Markdown extras** | Syntax-highlighted code blocks, `-# subtext`, `<t:unix:R>` timestamps, day separators. |
| **Typing indicators** | "Alex is typing…" in every channel and DM. |

### 👥 Social
| | |
|---|---|
| **Friends** | Add by username, accept or ignore requests, remove and block. Online / All / Pending / Blocked tabs. |
| **Direct messages** | 1:1 DMs with friends or anyone you share a server with. Unread dots and a badge on the Home button. |
| **Group DMs** | Up to 10 people. Rename (double-click the name), add friends, leave (ownership passes on). |
| **Presence** | Online, Idle, Do Not Disturb or Invisible, shown as status dots on avatars everywhere. |
| **Member list** | Per-server online and offline lists with crowns for owners. |

### 🛡️ Server management
| | |
|---|---|
| **Server settings** | Name, description, icon, banner. |
| **Roles** | Drag-to-reorder hierarchy, colours, *display separately*, mentionable, 22 permissions. You can't edit roles above your own or grant what you don't have. |
| **Channel settings** | Rename, topic, slow mode, user limit, 18+ age gate, delete. Per-role and per-member permission overrides (allow / inherit / deny). |
| **Moderation** | Assign roles, set nicknames, timeouts (60 s–1 week, enforced for messages, reactions and voice), kick and ban with reasons, unban. Also available from any member's profile card. |
| **Invites** | Expiry, max uses, custom vanity codes, revoke. |
| **Audit log** | Database-written, read-only history of every administrative change, filterable by user and action. |
| **Organisation** | Drag-and-drop channels and categories. Role-coloured names. Member list grouped by roles set to *display separately*. `@role` mentions. |

### 🎙️ Voice, video & calls
| | |
|---|---|
| **Voice channels** | Join any voice channel. Everyone connects directly to everyone (P2P mesh). See who's inside before joining. |
| **Stage channels** | Speakers and an audience. Raise your hand to speak; stage moderators invite speakers. |
| **Moderation** | Server mute and deafen, move, disconnect. Audited, and enforced by every participant's app. |
| **Soundboard** | 8 built-in sounds plus up to 48 per server, played to everyone in the call. |
| **Layouts** | Grid, focus, speaker. Pop-out (picture-in-picture) and fullscreen. "Watch stream" banner in text channels. |
| **Connection stats** | Ping, packet loss, bitrate and direct or relay on every tile. Optional bring-your-own TURN relay. |
| **DM & group calls** | Call from a DM header (voice or video). The others get a ringing card with Accept or Decline. |
| **Camera** | Turn your camera on in any call. Quality follows your bandwidth profile (360p to 720p). |
| **Screen share** | 720p or 1080p at 15, 30 or 60 FPS, with optional system or tab audio. |
| **Audio pipeline** | RNNoise AI noise suppression (optional), high-pass filter, compressor, noise gate with a live meter, per-user volume (0–200%), mute and deafen. No mic or camera permission prompts. |
| **Push-to-talk & keybinds** | Rebindable mute, deafen and PTT shortcuts. |

### 🎨 Customization
| | |
|---|---|
| **Themes** | 24 themes, including Dracula, Catppuccin, Tokyo Night, Rosé Pine, Synthwave, Vaporwave and Matrix, and four light themes. Plus a custom accent or your profile accent, and an optional ambient aurora background. |
| **Motion** | Springy menus and dialogs, sliding messages, pressable buttons, pulsing speakers. Full, Subtle, Off or Follow Windows. |
| **Custom CSS** | App-wide CSS that is sanitized and sandboxed (it can't escape the app or load scripts). |
| **Profiles** | Banner, 13 animated avatar frames, avatar shapes, name fonts and effects (gradient, rainbow, shimmer, glow, neon), card styles (gradient, glass, animated aurora), profile effects (snow, sparkles, confetti and more), pronouns, links, Markdown bio, badges, an audio status clip, profile colors and sandboxed profile CSS. |

### 🛡️ Accounts, privacy & safety
| | |
|---|---|
| **Account security** | Two-factor authentication (authenticator app), change email or password, password reset, sign out everywhere. |
| **Privacy** | Choose who can DM you and who can send friend requests. DMs from strangers wait in Message requests. |
| **Profiles per server** | A different nickname, avatar, banner and bio in each server. Private notes and friend nicknames. |
| **AutoMod** | Blocked words (wildcards, allow list), link filter, mention spam, flood and repeat detection. Block, time out or flag. |
| **Reports** | Report any message or user. Moderators get a queue with one-click actions. |
| **Your data** | Download everything as JSON, or delete your account. |

### 🔔 Notifications & presence
| | |
|---|---|
| **Desktop notifications** | DMs, mentions and calls while the app is in the background. Optional message text. |
| **Per-chat settings** | 🔔 in any header: mute for a duration, all messages / only @mentions / nothing, suppress @everyone per server. |
| **Inbox** | Recent mentions (direct, role, @everyone) and every unread chat, with mark-as-read. |
| **Taskbar** | Unread badge on the taskbar icon, flashing on incoming calls. |
| **Presence** | Auto-idle after inactivity, custom status with emoji and expiry, animated status icons, opt-in "Playing …" with real game art and "Listening to Spotify" with album art and progress. |
| **Profiles** | Profile Studio with a live full-size preview, nameplates, profile frames, effects, themes, name styles and a profile board of widgets. Switch between several accounts. |
| **System tray** | Close to tray, start with Windows, tray menu with mute and deafen, single instance. |
| **Background shortcuts** | Mute, deafen and push-to-talk work while you're in another app. |

### 🔊 Sounds
Synthesized sound effects for DMs, mentions, joining and leaving voice, others joining or leaving, mute and
deafen, streams starting and stopping, incoming and outgoing calls, and calls ending. Volume, per-sound toggles
and previews live in **Settings → Notifications & Sounds**. Do Not Disturb silences messages and ringing.

### ⚙️ App
- **Automatic, signed updates** from GitHub Releases, installed at startup before the app opens.
- **One-click installer** (aether.chat Setup) and a **web app** with a phone layout.
- **No default browser UI:** custom title bar, menus, pickers, media players and dialogs; Twemoji for emoji.
- **40 themes.**
- **Admin panel** for app admins: stats, users, badges, app settings, report review, warnings with danger
  levels, timed and permanent bans with appeals, account editing and deletion, and an audit log.
- **Tiny footprint:** about a 1.3 MB installer, using the system WebView2 instead of bundling Chromium.
- **Settings:** profile editor, appearance, audio and video devices, notifications, keybinds, bandwidth, activity
  privacy, Windows (tray, startup, idle).

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
- **Activity status is opt-in.** Game detection runs on your PC; only a matched game's name is shared, only in
  presence (never stored), and only while you're online.

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
| `migrations/008_privacy_safety.sql` | Privacy settings and message requests, per-server profiles, notes, mutuals, AutoMod rules and events, reports, ownership transfer, data export, account deletion |
| `migrations/007_threads_forums_events.sql` | Threads (channels with a parent), thread members, forum/media/announcement subtypes, channel follows and publishing, scheduled events and RSVPs, 5 new permissions, channel-creation policy fix |
| `migrations/006_voice_and_profiles.sql` | Voice states (occupancy), voice moderation and stage RPCs, soundboard table and bucket, 3 new permissions, profile customization columns, any theme id |
| `migrations/005_notifications.sql` | Notification settings (levels, mute, @everyone suppression) honoured by unread counts, custom status expiry, `recent_mentions` for the inbox |
| `migrations/004_server_management.sql` | New permissions, timeouts, `@role` mentions, NSFW channels, channel and role reordering, kick and nickname RPCs, custom invite codes, audit log |
| `migrations/009_final.sql` | App admins and `app_config`, people search, DMs to anyone as limited message requests, nameplates, profile frames and widgets, admin RPCs |
| `migrations/010_invites.sql` | Case-insensitive invite codes, friendly join errors, `invite_details()` previews |
| `migrations/011_moderation.sql` | Platform bans (enforced on every table) and appeals, warnings and danger levels, admin account editing and deletion, admin audit log |
| `migrations/003_messaging.sql` | Polls and votes, pins, full-text search index, mentions and `@everyone`, forwards, per-channel unread state, `unread_summary()` |

Edge Functions live in `supabase/functions/`: `link-preview` (SSRF-safe Open Graph fetcher), `game-art` (Steam artwork lookup) and `admin-user` (admins change another account's email or password; uses the service role, which never leaves the server). All are for signed-in users only.

**Making someone an admin:** the first admin is set in Supabase (`update public.users set is_admin = true where username = '…';`). After that, admins can grant or remove admin from Settings → Admin Panel.

**Workflow for schema changes:**
1. Add `supabase/migrations/NNN_name.sql`.
2. Run `npm run test:db`. It applies every migration to an in-memory Postgres and runs the RLS test suite.
3. Apply it to production with `node scripts/migrate.mjs supabase/migrations/NNN_name.sql`. This uses the
   Supabase Management API and needs a personal access token in `.secrets/supabase.token`.

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

The script builds and signs the installer, builds **aether.chat Setup** (`installer/`, a small Tauri app that
embeds the signed installer and runs it silently), writes `latest.json`, tags the commit, publishes to both repos
and deploys the web app (`npm run deploy:web`, Vercel; sign in once with `npx vercel login`). Only `dist/` is
uploaded to Vercel. The
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
  by default, to keep the cost at $0. You can add your own under Settings → Voice & Audio.
- **Account emails** (password reset, confirmations) use Supabase's built-in sender on the free plan, which only
  delivers to the project's team members and a few emails an hour. Add a custom SMTP provider in the Supabase
  dashboard (Authentication → SMTP) to email everyone.
- **Voice moderation is enforced by the participants' apps.** A peer-to-peer mesh has no server to cut anyone off,
  so a modified client could ignore a server mute. Everyone else's app still won't play that member's audio.
- **Clicking a desktop notification doesn't jump to the message** in the desktop app yet (the notification plugin
  has no click events on Windows). Open the Inbox to jump to it.
- **Spotify status reads Windows' media controls,** so it needs the Spotify desktop app (not the web player).
- **Switch Accounts remembers accounts on this device only.** Signing out of an account removes it from the list.
- **Windows only** for now.

## Credits
- Emoji: [Twemoji](https://github.com/twitter/twemoji) by Twitter (graphics CC-BY 4.0), via the
  [twemoji-colr font](https://github.com/mozilla/twemoji-colr) (OFL 1.1).
- Icons: [Lucide](https://lucide.dev) (ISC). Brand marks: [Simple Icons](https://simpleicons.org) (CC0).
- Game artwork comes from Steam's public store search; album art from Apple's public iTunes Search API.
