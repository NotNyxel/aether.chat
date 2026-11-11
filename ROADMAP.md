# aether.chat Roadmap

aether.chat is built **batch by batch**. Each batch is a themed set of features that ships as one minor version
(0.4.0, 0.5.0, …), with its own database migration, a signed release and an automatic update for everyone.

Legend: ✅ shipped · 🚧 in progress · ⬜ planned · 💤 deferred (needs paid infrastructure or doesn't fit the $0 model)

---

## Shipped

| Version | Highlights |
|---|---|
| **0.1.0** | Servers, channels, live chat, P2P mesh voice, screen share, theme engine, rich profiles, settings |
| **0.2.0** | Friends, blocks, DMs, group DMs, 1:1 and group calls, camera, replies, edits, reactions, uploads, typing, presence |
| **0.3.0** | Renamed to aether.chat, built-in backend (no setup), signed auto-updates via GitHub Releases |
| **0.5.0** | Batch 2: server settings, roles editor, channel permission overrides, timeouts, kick/ban, invites, audit log, drag-reorder, `@role` mentions |
| **0.4.0** | Batch 1: emoji picker, autocomplete, unreads and mentions, pins, search, link previews, polls, forwarding, message links, lightbox, sound effects |

---

## Batch 1: Messaging power-ups → 0.4.0 ✅
- ✅ Full emoji picker (search, categories, recents) and `:shortcode:` autocomplete
- ⬜ Emoji skin-tone selector (moved to Batch 7, together with custom emoji)
- ✅ Mention autocomplete: `@user`, `@everyone` / `@here`, `#channel` (`@role` lands with the roles editor in Batch 2)
- ✅ Pinned messages panel (pin and unpin from the message menu)
- ✅ Message search (Postgres full-text): from:, has:link/file/image/video/poll, pinned:, before:, after:
- ✅ Link embeds and previews (Open Graph via a Supabase Edge Function) and YouTube inline player
- ✅ Unread markers per server channel, a "new messages" divider and jump-to-present
- ✅ Jump to replied message, message links (copy and open)
- ✅ Forward messages to another channel or DM
- ✅ Polls (multiple choice, duration, live results)
- ✅ Image lightbox, spoiler-tagged attachments, attachment alt text
- ✅ Markdown additions: subtext (`-#`), timestamps (`<t:…>`), syntax-highlighted code blocks
- ✅ **Bonus:** sound effects for messages, mentions, voice and calls, with per-sound settings

## Batch 2: Server management → 0.5.0 ✅
- ✅ Server settings: name, icon, banner, description
- ✅ Roles editor: create, reorder (drag), colors, hoist, mentionable, every permission toggle
- ✅ Per-channel permission overrides UI (roles and members, allow/deny/inherit)
- ✅ Channel settings: rename, topic, slow mode, NSFW flag, user limit, delete
- ⬜ "Sync permissions with category" (moved to Batch 8 polish)
- ✅ Drag-and-drop channel and category reordering
- ✅ Member management: assign roles, nicknames, kick, ban (with reason), timeout
- ✅ Invite management: list, revoke, max uses, expiry, vanity code
- ✅ Audit log (who changed what, when)
- ✅ **Bonus:** `@role` mentions, role-colored names, hoisted member-list groups, moderation from profile cards
- ⬜ Server templates, welcome screen and rules screening (moved to Batch 7: Community)

## Batch 3: Notifications & presence → 0.6.0
- ⬜ Native desktop notifications (Tauri notification plugin) for DMs, mentions and calls
- ⬜ Notification settings per server, channel and DM: all, mentions only, nothing; mute for a duration
- ⬜ Inbox: mentions and unread overview
- ⬜ Taskbar unread badge and flashing on incoming calls
- ⬜ Auto-idle after inactivity, custom status with expiry
- ⬜ Activity status ("Playing …" via opt-in process detection)
- ⬜ System tray: minimise to tray, start on boot, global shortcuts (mute and deafen work while unfocused)

## Batch 4: Voice & video upgrades → 0.7.0
- ⬜ See who is in a voice channel before joining (live occupancy)
- ⬜ Moderator voice tools: server mute or deafen, move, disconnect
- ⬜ Stage channels: speakers and audience, raise hand, invite to speak
- ⬜ Soundboard (per-server sounds, played through the P2P mesh)
- ⬜ ML noise suppression (RNNoise WASM) as an alternative to the browser's
- ⬜ Video layouts: grid, speaker focus, pop-out and picture-in-picture
- ⬜ Go Live from a server text channel ("watch stream")
- ⬜ Per-user connection stats (ping, packet loss, bitrate)
- ⬜ Optional TURN relay for networks that block P2P (bring-your-own TURN, default off to keep $0)

## Batch 5: Threads, forums & channel types → 0.8.0
- ⬜ Threads from any message (public and private), auto-archive
- ⬜ Forum channels: posts, tags, sort and filter, guidelines
- ⬜ Announcement channels with "follow into my server"
- ⬜ Media channels (gallery layout)
- ⬜ Scheduled events (voice and stage) with RSVP and reminders

## Batch 6: Accounts, privacy & safety → 0.9.0
- ⬜ Password reset, change email, change password
- ⬜ Two-factor authentication (Supabase MFA, TOTP)
- ⬜ Privacy settings: who can DM you, who can send friend requests, message requests inbox
- ⬜ Per-server profiles (nickname, avatar, bio per server)
- ⬜ Friend notes and nicknames, mutual servers and friends on profiles
- ⬜ AutoMod: keyword and link filters, spam detection, mention-spam limits
- ⬜ Report a message or user and a moderator queue
- ⬜ Data export and account deletion

## Batch 7: Community & integrations → 0.10.0
- ⬜ Server discovery (opt-in public directory, categories, search)
- ⬜ Server templates, welcome screen, rules screening
- ⬜ Incoming webhooks (Edge Function endpoint per channel)
- ⬜ Bot accounts and a slash-command framework
- ⬜ Custom server emoji and stickers (upload, manage, use anywhere you're a member), emoji skin tones
- ⬜ GIF picker (Tenor or GIPHY free tier, needs an API key)
- ⬜ Connections on profiles (GitHub, Twitch, Spotify via OAuth)

## Batch 8: Polish, performance & reach → 1.0.0
- ⬜ Quick switcher (Ctrl+K), full keyboard navigation, accessibility pass
- ⬜ Virtualized message lists, offline cache, faster cold start
- ⬜ Compact mode, font scaling, chat density, more themes, theme sharing
- ⬜ Localization (i18n)
- ⬜ macOS and Linux builds; responsive layout for small windows
- ⬜ Web build hosted for free (GitHub Pages or Cloudflare Pages)

---

## 💤 Deferred / out of scope
- **Nitro-style paid perks and server boosts**: aether.chat stays $0, so the useful perks (bigger uploads,
  HD streaming, animated avatars) are free where the free tier allows.
- **Large voice rooms (25+)** would need an SFU media server, which costs money.
- **Mobile apps** come after 1.0.
