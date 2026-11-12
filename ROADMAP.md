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
| **0.9.0** | Batch 6: account security (2FA, password reset), privacy and message requests, per-server profiles, notes, AutoMod, reports, data export, account deletion; profile editor redesign; polish |
| **0.8.0** | Batch 5: threads, forum and media channels, announcement follows, scheduled events |
| **0.7.0** | Batch 4: voice occupancy, moderator voice tools, stages, soundboard, RNNoise, video layouts, Go Live, connection stats, TURN; 24 themes, profile styling, animations |
| **0.6.0** | Batch 3: desktop notifications, per-chat mute and levels, inbox, taskbar badge, auto-idle, status expiry, activity status, tray, start on boot, background shortcuts |
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

## Batch 3: Notifications & presence → 0.6.0 ✅
- ✅ Native desktop notifications for DMs, mentions and calls
- ✅ Notification settings per server, channel and DM: all, mentions only, nothing; mute for a duration; suppress @everyone
- ✅ Inbox: mentions and unread overview
- ✅ Taskbar unread badge and flashing on incoming calls
- ✅ Auto-idle after inactivity (system-wide), custom status with expiry
- ✅ Activity status ("Playing …" via opt-in process detection, custom games)
- ✅ System tray: minimise to tray, start on boot, global shortcuts (mute, deafen and push-to-talk work while unfocused)
- ✅ **Bonus:** single-instance (launching again focuses the running app)

## Batch 4: Voice & video upgrades → 0.7.0 ✅
- ✅ See who is in a voice channel before joining (live occupancy)
- ✅ Moderator voice tools: server mute or deafen, move, disconnect (audited, enforced by every peer)
- ✅ Stage channels: speakers and audience, raise hand, invite to speak
- ✅ Soundboard (8 built-in sounds plus per-server uploads, played through the P2P mesh)
- ✅ ML noise suppression (RNNoise WASM) as an alternative to the browser's
- ✅ Video layouts: grid, focus, speaker, pop-out (picture-in-picture) and fullscreen
- ✅ Go Live from a server text channel ("watch stream" banner, LIVE badges)
- ✅ Per-user connection stats (ping, packet loss, bitrate, direct or relay)
- ✅ Optional TURN relay (bring your own, default off)
- ✅ **Bonus:** no mic/camera permission prompts; 20 new themes; name fonts and effects, card styles, profile
  effects, avatar shapes, pronouns and links; app-wide motion system

## Batch 5: Threads, forums & channel types → 0.8.0 ✅
- ✅ Threads from any message (public and private), auto-archive, lock, follow
- ✅ Forum channels: posts, tags, sort and filter, guidelines, list and gallery
- ✅ Announcement channels with "follow into my server" and publishing
- ✅ Media channels (gallery layout)
- ✅ Scheduled events (voice, stage or elsewhere) with RSVP and reminders
- ✅ **Fix:** creating channels (INSERT … RETURNING vs. the channel visibility policy)

## Batch 6: Accounts, privacy & safety → 0.9.0 ✅
- ✅ Password reset, change email, change password (email links open the desktop app)
- ✅ Two-factor authentication (Supabase MFA, TOTP)
- ✅ Privacy settings: who can DM you, who can send friend requests, message requests inbox
- ✅ Per-server profiles (nickname, avatar, banner, bio per server)
- ✅ Friend notes and nicknames, mutual servers and friends on profiles
- ✅ AutoMod: keyword and link filters, spam detection, mention-spam limits
- ✅ Report a message or user and a moderator queue
- ✅ Data export and account deletion (plus server ownership transfer)
- ✅ **Bonus:** profile editor redesign with live-preview pickers; app-wide polish (context menus, tooltips, toasts, confirm dialogs)

## Final Batch → 1.0.0 ✅
- ✅ Zero default UI: custom title bar, context menus, pickers, players, prompts and scrollbars
- ✅ Real icons everywhere, Twemoji for emoji, new status icons with an animation toggle
- ✅ Invite rework (`aether.chat/inv/CODE`, join by code, previews, invite cards, web link), Add/Join server buttons
- ✅ Inbox in the title bar, Ctrl+K quick switcher, server header redesign
- ✅ People search and limited message requests (Accept / Ignore / Block / Block & report)
- ✅ Spotify listening status and real game art
- ✅ User popout, Switch Accounts, Profile Studio with a profile board, full profiles
- ✅ Nameplates, profile frames, more profile themes, effects and name styles, 16 new app themes
- ✅ Cleaner composer and message layout
- ✅ Admin panel (stats, users, admins, badges, app settings, reports)

## 1.1.0 ✅
- ✅ Startup window: checks, downloads and installs updates before the app opens
- ✅ aether.chat Setup: our own one-click installer
- ✅ Web app on Vercel, with a phone layout and web invite links
- ✅ Text box fixes, a single Escape key stack, browser shortcuts on the web
- ✅ Platform moderation: warnings and danger levels, timed and permanent bans with appeals, account editing and
  deletion, Account Standing, admin audit log

## 1.2.0 ✅
- ✅ Built-in server bot with slash commands and welcome messages
- ✅ Server verification levels, welcome channel, rules; cleaner roles editor
- ✅ Screen share window: resolution, frame rate (24/30/60/custom), content hint, audio
- ✅ Admin: create users, adjustable group DM size
- ✅ Layout and mobile web fixes

## 1.3.0 ✅
- ✅ Native screen capture with our own source picker (no WebView2 chooser), per-app and system audio
- ✅ Self-healing Realtime: reconnect and catch up after sleep, background or network changes
- ✅ Profiles render with their own colours for every viewer

## 1.4.0 ✅
- ✅ ~900 generated cosmetics with custom colours, 100 bundled name fonts, rain angle
- ✅ Custom colour picker, avatar/banner crop & zoom (GIF-safe), status emoji picker
- ✅ Optimistic, ordered message sending
- ✅ Web Push notifications, server discovery, webhooks, custom server emoji
- ✅ Android APK

## Batch 7: Community & integrations → 1.5
- ⬜ Server discovery (opt-in public directory, categories, search)
- ⬜ Server templates, welcome screen, rules screening
- ⬜ Incoming webhooks (Edge Function endpoint per channel)
- 🟨 Bot accounts and a slash-command framework (built-in bot done in 1.2; third-party bots next)
- ⬜ Custom server emoji and stickers (upload, manage, use anywhere you're a member), emoji skin tones
- ⬜ GIF picker (Tenor or GIPHY free tier, needs an API key)
- ⬜ Connections on profiles (GitHub, Twitch, Spotify via OAuth)

## Batch 8: Polish, performance & reach → 1.0.0
- ⬜ Quick switcher (Ctrl+K), full keyboard navigation, accessibility pass
- ⬜ Virtualized message lists, offline cache, faster cold start
- ⬜ Compact mode, font scaling, chat density, more themes, theme sharing
- ⬜ Localization (i18n)
- ⬜ macOS and Linux builds; responsive layout for small windows
- ✅ Web build hosted for free (Vercel), with a phone layout

---

## 💤 Deferred / out of scope
- **Nitro-style paid perks and server boosts**: aether.chat stays $0, so the useful perks (bigger uploads,
  HD streaming, animated avatars) are free where the free tier allows.
- **Large voice rooms (25+)** would need an SFU media server, which costs money.
- **Mobile apps** come after 1.0.
