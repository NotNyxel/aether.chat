# Changelog

All notable changes to aether.chat. Versions follow [semver](https://semver.org); every version is published on the
GitHub Releases page, and installs from 0.3.0 onward update themselves.

## [0.5.0] - 2026-11-11

**Batch 2: server management**

- **Server Settings** (click the server name → Server settings):
  - **Overview:** change the name, description, icon and banner. The banner shows above the channel list.
  - **Roles:** create roles and drag to reorder them. Set colour, *display separately* and *mentionable*, and
    toggle each of 22 permissions. Members holding a role are listed and can be added or removed. You can only edit
    roles below your own, and you can't grant permissions you don't have.
  - **Members:** search, add and remove roles, nickname, **timeout** (60 seconds to 1 week), **kick** and **ban**,
    each with an optional reason.
  - **Invites:** set expiry (30 minutes to never) and max uses, choose **custom codes** (Manage Server
    permission), see who invited whom, and revoke invites.
  - **Bans:** see the reason and date, and unban.
  - **Audit Log:** every change to the server, role, channel, permissions, members, bans, timeouts and invites
    is recorded by the database, with who did it and why. Filter by user or action. It can't be edited.
- **Channel Settings** (⚙ next to a channel or category):
  - rename, topic, **slow mode** (5 seconds to 6 hours), voice **user limit**, and **age-restricted (18+)**
    channels with a confirmation screen;
  - **permission overrides** per role and per member, set to Allow, Inherit or Deny;
  - delete the channel.
- **Drag-and-drop** to reorder channels (including between categories) and categories.
- **New permissions:** Manage Nicknames, Timeout Members, View Audit Log.
- **Timeouts** are enforced everywhere: timed-out members can read, but can't send, edit, react or join voice. The
  message box tells them when the timeout ends.
- **Role colours** on names in chat and the member list. Roles set to *display separately* get their own group in
  the member list. ⏳ marks timed-out members and 👑 the owner.
- **`@role` mentions:** autocomplete, coloured pills, mention badges and mention sounds for everyone holding the
  role.
- **Slow-mode countdown** in the message box.
- **Moderation from the profile card:** click a member while you're in a server to manage their roles, nickname,
  timeout, kick or ban.
- Server dropdown menu: invite people, server settings, create channel or category, leave or delete.
- Database: `supabase/migrations/004_server_management.sql`.

## [0.4.0] - 2026-11-11

**Batch 1: messaging power-ups and sound effects**

- **Emoji picker:** about 1,900 emoji with search, categories and recents, available in the composer and for
  reactions. Type `:fire` to get suggestions, and complete shortcodes like `:heart:` turn into the emoji.
- **Autocomplete** for `@members`, `@everyone` / `@here` (if you have permission) and `#channels`. Use ↑ ↓ to
  move, and Enter or Tab to pick.
- **Mentions** are tracked by the server. Messages that mention you are highlighted, and red mention badges
  appear on servers, channels and DMs.
- **Unread tracking:** a white dot on servers and channels with new messages, a "NEW" divider where you left
  off, and DM counts. "Jump to present" brings you back to the bottom.
- **Pinned messages panel** (📌). Anyone can pin in DMs; servers need Manage Messages.
- **Search** across a server or a conversation, with filters `from:`, `has:link|image|file|video|poll`,
  `pinned:true`, `before:` and `after:`. Click a result to jump to the message.
- **Link previews** for any website (title, description, image) and click-to-play YouTube embeds.
  Wrap a link in `<…>` to hide its preview.
- **Polls:** 2–10 answers with optional emoji, single or multiple choice, from 1 hour to 1 week, with live
  results.
- **Forward** a message to any DM, group or channel, with an optional comment.
- **Message links:** copy a link to any message and paste it anywhere. Clicking it jumps there inside the app.
  Reply previews jump to the original too.
- **Image viewer:** click an image to open it full-screen. Uploads can be marked as **spoilers** and given
  **alt text**.
- **Markdown:** syntax-highlighted code blocks with a copy button (```` ```ts ````), `-# subtext`,
  `<t:1700000000:R>` timestamps, and day separators in chat.
- **Sound effects** (Settings → Notifications & Sounds): DM, mention, joining and leaving voice, someone
  joining or leaving, mute, deafen, streams starting and stopping, incoming ringtone, outgoing ringback and call
  ended. There's a volume control, a per-sound toggle and a preview for each. They're silent in Do Not Disturb.
- Database: `supabase/migrations/003_messaging.sql`. New Edge Function: `link-preview`.

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
