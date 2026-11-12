# Changelog

All notable changes to aether.chat. Versions follow [semver](https://semver.org); every version is published on the
GitHub Releases page, and installs from 0.3.0 onward update themselves.

## [1.5.0] - 2026-11-12

**Avatar decorations and illustrated frames; one entry per style**

- **35 expressive avatar decorations:**
  - **Ears and horns:** cat, fox, bunny, bear, devil horns, unicorn horn, antlers.
  - **Headwear:** halo, crown, flower crown, Santa hat, witch hat, party hat, beanie, maid headband, big bow,
    headphones, snow cap, fire crown.
  - **Anime-style marks:** anger mark, sweat drop, crying, blush, sleepy Zzz, confused, shocked, in love, fuming,
    dizzy, idea, rain cloud, butterflies.
  - **Outfits:** maid outfit, bow tie, scarf.
  - Many are animated (the anger mark pulses, tears fall, Zzz float), and each takes two colours from the
    colour pickers.
- **24 illustrated profile frames:** clouds, spray paint, ink splatter, lace, washi tape, Polaroid, film strip,
  sakura branch, sparkles, bubbles, snowdrift, drips, thorns, chains, pixel hearts, stickers, sketchbook,
  candy cane, crystals, ribbons, comic dots, autumn leaves, and moon & stars. Each takes two colours.
- **No more colour copies:** nameplates, rings and frames now have one entry per style. Pick its colours with
  the colour picker instead.
  - **Profile effects:** one entry per particle type, with a Motion option (fall, drift, rise, twinkle,
    wander).
  - **Profile themes:** one entry per pattern, with an Intensity slider.
  - **Name effects:** a fill plus a Finish option (glow, outline, 3D…).
  - **Shapes and banner colours:** trimmed to distinct options.
  - Choices you made in 1.4.0 keep working.
- **Fixed:** on iPhone and iPad, a profile's online/offline dot could float away from the avatar.

## [1.4.0] - 2026-11-12

**Hundreds of new cosmetics, instant messages, push notifications, Android, and more**

- **Messages send instantly.** Your message shows up the moment you press Enter and the box clears straight
  away. Fast typing is never wiped or blocked while the server answers, and quick messages still arrive in
  order. If one fails, it's put back in the box for you.
- **Hundreds of new profile cosmetics**, all searchable and sorted into categories:
  - 100 new nameplates, 100 avatar decorations, 100 avatar shapes and 100 banner colour presets;
  - 100 profile effects, 100 profile frames and 100 profile themes;
  - 100 name fonts and 100 name effects.
- **Your own colours everywhere:** pick nameplate, decoration, frame, effect and theme colours with a colour
  picker. **White and Crimson Roses are now one Roses frame in any colour.**
- **Rain fixed:** drops fall in parallel lines at one angle, which you can set for every falling effect.
- **A new colour picker everywhere in the app:** a bigger colour square and hue slider, an **eyedropper** that
  picks any colour on screen, HEX or RGB entry, swatches, recent colours, keyboard control and a before/after
  preview.
- **Crop & zoom for avatars and banners:** after uploading (or with **Adjust**), drag to frame it and zoom up to
  4×. **GIF avatars and banners keep animating**, because the file itself is never re-encoded.
- **Status emoji picker:** choose your status emoji from the emoji picker instead of typing it.
- **Push notifications (web app):** get DMs and @mentions on your phone or in your browser even when
  aether.chat is closed. Turn it on in Settings → Notifications. On iPhone and iPad, add aether.chat to your
  Home Screen first.
- **Explore public servers:** server owners can list their server (Server Settings → Safety & Welcome → Server
  discovery, with a category). Anyone can find and join it from **Add a server → Explore public servers**,
  without an invite.
- **Webhooks:** let GitHub, CI tools and bots post into a channel (Server Settings → Bot → Webhooks). They
  accept the same JSON as Discord webhooks.
- **Custom server emoji:** upload up to 100 per server (PNG, GIF, WebP; GIFs animate) in Server Settings →
  Emoji. Use them from the emoji picker or by typing `:name`. They show for everyone, everywhere.
- **Android app:** download `aether.chat_<version>_android.apk` from the Releases page and install it.
- Database: `supabase/migrations/013_platform.sql`. New Edge Functions: `push` and `webhook`.

## [1.3.0] - 2026-11-12

**Our own screen sharing, live sync everywhere, and a profile fix**

- **Screen sharing without the Windows chooser (desktop app):** "Share your screen" now shows every screen and
  app window with live thumbnails, right inside aether.chat. The old "Choose what to share with
  tauri.localhost" box is gone for good. aether.chat captures natively through Windows Graphics Capture, with:
  - your resolution and frame rate (24, 30, 60 or custom);
  - an optional mouse pointer;
  - **audio:** when sharing a screen, your computer's sound without aether.chat's own (so nobody hears
    themselves); when sharing an app, only that app's sound.

  If the shared window closes, the share ends by itself.
- **Live sync between devices:** chats, DMs, reactions, polls, voice channels and server changes now reconnect
  by themselves and catch up after a gap, whenever your iPad, phone or laptop wakes, regains focus or comes back
  online. Before, a connection dropped by sleep or backgrounding stayed quiet until you reloaded.
- **Fixed: other people's profiles showing your colours.** If someone hadn't picked their own profile colours,
  their name effect, card and decorations used *your* theme on your screen. Profiles now look the same to
  everyone.
- Phones and browsers that can't share a screen now say so instead of failing.

## [1.2.0] - 2026-11-12

**Server bot, better screen sharing, server settings and layout fixes**

- **The Aether bot:** a built-in bot each server can switch on (Server Settings → Bot). Type `/` in a channel to
  see its commands: `/help`, `/ping`, `/roll 2d6`, `/coinflip`, `/8ball`, `/choose a | b`, `/serverinfo`,
  `/userinfo` and `/rules`. Moderators also get `/say`, `/purge 10` and `/slowmode 10`. It can also welcome new
  members.
- **New server settings (Safety & Welcome):**
  - a verification level: None, Low (verified email), Medium (also an account older than 5 minutes), or High
    (also, new members without a role wait 10 minutes before talking);
  - a welcome channel and welcome message;
  - server rules.
- **Cleaner roles:** each role has Display, Permissions and Members tabs. You can search permissions and clear
  them all at once, and the role list shows how many members have each role.
- **Screen sharing, redone:** a new "Share your screen" window with:
  - Entire screen or Application (and Browser tab on the web);
  - 720p, 1080p, 1440p or Source resolution;
  - 24, 30 or 60 FPS, or a custom rate from 5 to 120;
  - Auto, Text & detail, or Motion & games;
  - a Share audio toggle.

  Your choices are remembered. After Go Live, the system's own chooser asks which screen or window to share.
- **Admin Panel:**
  - **Create user:** pick the username, display name, email and password, and choose whether the email starts
    out verified. Unverified emails can be verified later from the user's file.
  - **Group DM size** is now a setting, from 2 to 10,000.
- **Message requests** moved into the left sidebar, under Friends.
- **Layout fixes:**
  - Settings, Server Settings, Channel Settings and Edit Profile no longer slide under the title bar;
  - messages have even spacing, and there's more room above the message box.
- **Web app on phones:** no glass blur over the top bar on iOS, no page bounce, and lists scroll smoothly on their
  own.
- Database: `supabase/migrations/012_servers_bot.sql`.

## [1.1.0] - 2026-11-12

**Updates on launch, a new installer, moderation tools and the web app**

- **Updates before the app opens:** aether.chat now starts with a small startup window that checks for an
  update, downloads and installs it silently, and restarts into the new version. No more update cards or clicks.
  If you're offline it opens straight away. Long sessions still download updates in the background and offer a
  one-click restart.
- **New installer: aether.chat Setup.** One click, no wizard pages and no admin prompt. It shows its own
  animated window while it installs, then opens aether.chat. Download `aether.chat-Setup.exe`.
- **aether.chat on the web:** use it in any browser at **aether-chat-beta.vercel.app**, on PC or phone. On phones it
  shows one screen at a time with a back button, and you can add it to your home screen.
  Invite links now open there (`aether-chat-beta.vercel.app/inv/CODE`), so they work for people without the app.
  Older GitHub Pages invite links keep working.
- **Text boxes fixed everywhere:**
  - icons no longer overlap what you type (Search for someone, the admin search and others);
  - fields keep their intended size and padding;
  - no stray focus outlines.
- **Escape closes only the window on top**, not the settings page or dialog underneath it.
- **In the browser, normal shortcuts work** (reload, new tab, find).
- **Admin Panel, rebuilt:** Overview, Users, Appeals, Reports, App settings and Audit log tabs. Each user has a
  moderation file:
  - **Warnings and danger levels:** warn for a rule (spam, harassment, hate, scams and more) with a severity.
    Points add up to a danger level (Good, Low, Medium, High, Critical). Warnings expire after a set time.
    Edit, revoke, restore or delete any warning, or pin a level by hand with a private note.
  - **Bans:** for 1 hour, 1 day, 3 days, 1 week, 30 days, any number of days, or permanently, with a reason.
    Banned accounts can still sign in, but only see their ban and an appeal form. Admins accept (pardon) or deny
    appeals, and can lift any ban.
  - **Edit account data:** username, display name, bio, remove avatar or banner, change email or password, and
    sign out everywhere.
  - **Delete accounts.**
  - **History:** every admin action is in the audit log.
- **Account Standing** (Settings): see your danger level and active warnings. New warnings show a one-time
  notice.
- Database: `supabase/migrations/011_moderation.sql`. New Edge Function: `admin-user`.

## [1.0.0] - 2026-11-12

**The Final Batch: aether.chat 1.0**

- **Zero default UI:**
  - a custom title bar (minimise, maximise, close) instead of the Windows frame;
  - custom right-click menus everywhere: Cut, Copy, Paste and Emoji in text boxes, plus menus for links and
    images;
  - custom dropdowns, colour pickers, date and time pickers, checkboxes, radios, sliders and scrollbars;
  - custom audio and video players;
  - in-app prompts replace every browser pop-up;
  - browser shortcuts (print, find, view source and others) are blocked.
- **Real icons instead of emoji:**
  - every UI icon is now from one consistent icon set;
  - emoji in messages, names and statuses use the bundled **Twemoji** set on every PC, not the Windows emoji;
  - badges are proper icon badges, and five new badges were added.
- **New status icons:** online, idle (moon), do not disturb (bar) and offline (ring), with a morph animation.
  Toggle it in Appearance → "Animate status icons".
- **Invites, reworked:**
  - every invite is an `aether.chat/inv/CODE` link, or you can type just the code (for example `aether`);
  - codes work in any case;
  - the new **Join a server** dialog shows a live preview of the server before you join;
  - invite links in chat render as cards with a Join button;
  - a web link (`notnyxel.github.io/aether.chat-releases/inv/#CODE`) opens the app straight to the invite.
- **Add a server** button and a separate **Join** (compass) button on the server rail.
- **Invite people** dialog: send invites to friends in one click, copy the link, choose an expiry.
- **Inbox moved** to the title bar, next to a new **Search** button (Ctrl+K quick switcher). The search covers
  friends, DMs, servers, channels and people.
- **Server header redesign:** the banner fades behind the server name, so they no longer overlap.
- **Message requests and people search:**
  - **Search for someone** (next to Add Friend) finds anyone by name;
  - you can message a stranger up to 3 times (admins can change the limit);
  - they get it under **Message requests** with Accept, Ignore, Block and **Block & report spam**;
  - Privacy now has "Everyone" for DMs and "Let people find me in search".
- **"Find or start a conversation"** bar at the top of your DM list.
- **Spotify:** share what you're listening to (Settings → Activity Privacy). It shows the album art, song, artist,
  album and a live progress bar on your profile, and "Listening to …" in member lists. It reads Windows' media
  controls, so no Spotify login is needed.
- **Real game art:** "Playing" shows the game's artwork from Steam, or its logo for games like VALORANT, League of
  Legends and Fortnite.
- **User popout** (click yourself at the bottom left):
  - your banner, avatar and a status thought bubble;
  - name, username and pronouns, badges and bio;
  - Edit Profile;
  - a status submenu;
  - **Switch Accounts**: stay signed in to several accounts and hop between them;
  - Copy User ID.
- **Profile Studio:** a full-screen Edit Profile.
  - Left: decoration tiles, each opening a picker with a live preview.
  - Center: your full profile.
  - Right: your **profile board**, with widgets for Favorite game, Games I like (with artwork), On repeat,
    Card and Quote.
- **Full profiles:** clicking anyone opens their full profile with their board.
- **Nameplates:** 15 animated plates behind your name in member lists, DMs, friends and the user panel.
- **Profile frames:** 11 ornate frames, including White Roses, Crimson Roses, Gilded, Prism, Starfall, Circuit
  and Vines.
- **More customization:**
  - 6 new profile themes;
  - 6 new name effects (Fire, Ice, Chrome, Pastel, Toxic, Glitch);
  - 4 new profile effects (Embers, Autumn, Music, Lightning).
- **16 new app themes (40 in total):** Everforest, Kanagawa, One Dark, Ayu Mirage, Material Ocean, Lavender
  Haze, Coffee, Amethyst, Aurora Borealis, Blood Moon, Retro Terminal, Nightfall, Mint, Arctic, Cotton Candy
  and Clean Light.
- **Cleaner chat:**
  - a redesigned composer: a rounded box with upload, attach, emoji and send buttons, a reply bar that shows
    the message, and attachment cards with spoiler, alt-text and remove actions;
  - roomier messages with reply connector lines, tidier reactions and a lighter hover toolbar;
  - one consistent style for every text box.
- **Admin panel** (Settings → Admin Panel, only for admin accounts):
  - live stats;
  - user search with email and activity;
  - grant or remove admin;
  - award badges;
  - app settings (message request limit, people search, an app-wide announcement banner);
  - review reports from DMs and message requests.
  - Admins can also be set in Supabase (`users.is_admin`).
- Database: `supabase/migrations/009_final.sql` and `010_invites.sql`. New Edge Function: `game-art`.

## [0.9.0] - 2026-11-12

**Batch 6: accounts, privacy and safety, plus a redesigned profile editor and a polish pass**

- **Account** (Settings → My Account):
  - change your email or password;
  - **two-factor authentication** with an authenticator app (scan a QR code and confirm a code; sign-in then
    asks for it);
  - sign out everywhere;
  - **download your data** (JSON);
  - **delete your account**.
- **Forgot password** on the sign-in screen. Email links (reset, sign-up confirmation, email change) now open
  aether.chat directly via `aetherchat://` links and finish there.
- **Privacy & Safety:**
  - choose who can DM you (friends and server members, or friends only);
  - choose who can send friend requests (everyone, mutuals only, or no one);
  - **message requests**: DMs from non-friends wait in their own list with Accept, Ignore and Block, and don't
    notify or badge;
  - manage blocked users.
- **Per-server profiles:** a different nickname, avatar, banner and bio in each server. Chat and the member list
  use them.
- **Notes and friend nicknames:** private to you, on every profile card. Friend nicknames show in your friends list
  and DMs.
- **Mutual servers and friends** on profile cards.
- **AutoMod** (Server Settings → AutoMod):
  - rule types: blocked words (with wildcards and allowed words), links outside an allow list, mention spam,
    message floods and repeats;
  - each rule can block, block and time out, or just flag;
  - roles can be exempt;
  - blocked senders are told which rule stopped them.
- **Reports:** right-click any message or person → Report. Server moderators get a **Moderation queue** with jump
  to message, delete, timeout, kick, ban, resolve and dismiss, plus an AutoMod activity log.
- **Transfer server ownership** (Server Settings → Overview).
- **Redesigned profile editor:**
  - a compact page with identity, pictures, and one row per decoration;
  - each decoration (avatar decoration, shape, profile effect, card style, name style, colours) opens a picker
    with a live preview of every option;
  - hover an option to try it on your card, then Apply;
  - an unsaved-changes bar.
- **Polish:**
  - right-click menus on messages, people, servers, channels and DMs;
  - consistent instant tooltips everywhere;
  - toasts for confirmations and errors;
  - in-app confirmation dialogs instead of browser pop-ups;
  - a grouped settings sidebar;
  - skeleton loading for messages;
  - bouncing typing dots;
  - colourful default avatars;
  - close buttons on every dialog;
  - a new sign-in screen;
  - a splash screen;
  - Esc closes the thread panel;
  - the app version in Settings.
- Database: `supabase/migrations/008_privacy_safety.sql`.

## [0.8.0] - 2026-11-12

**Batch 5: threads, forums, channel types and events**

- **Threads:**
  - start one from any message (🧵 in the hover toolbar) or from the 🧵 button in the channel header;
  - public or **private** (invite-only), and they open in a side panel next to the channel;
  - rename, archive or reopen, and **lock** (Manage Threads);
  - auto-archive after 1 hour, 24 hours, 3 days or 1 week without activity, and posting in an archived thread
    reopens it;
  - *Follow* a thread to get unread badges for it. You follow automatically when you post or create one;
  - the starting message shows "🧵 name · N messages".
- **Forum channels:**
  - every post is its own conversation, with a title, up to 5 tags, a first message and attachments;
  - filter by tag, search titles, sort by recent activity or newest, and switch between list and gallery
    layouts;
  - post guidelines (📜), required tags, and archived posts on demand.
- **Media channels:** forums in gallery layout, where every post needs an image or video.
- **Announcement channels:**
  - only moderators (Manage Messages) post;
  - other servers can **📢 Follow** a channel into one of their own text channels;
  - **publish** a message (📢 in the toolbar) to copy it to every follower, marked "From <server> · #channel",
    without pinging anyone there.
- **Scheduled events** (📅 at the top of the channel list):
  - schedule an event in a voice or stage channel, or anywhere else with a location, with start and end times
    and a description;
  - mark yourself **Interested** to get a desktop reminder 15 minutes before it starts and when it goes live;
  - moderators can start, end, edit and cancel events, and a LIVE event shows in the channel list with a
    *Join* button.
- **Five new permissions:** Create Public Threads, Create Private Threads, Send Messages in Threads, Manage
  Threads, Manage Events.
- **The message box now follows channel permissions.** Read-only channels, locked threads and announcement
  channels say why you can't post, instead of failing when you send.
- **Fixed:** *Create channel* failed with a security-policy error. The database couldn't see the new channel
  while checking whether you're allowed to see it.
- Database: `supabase/migrations/007_threads_forums_events.sql`.

## [0.7.0] - 2026-11-11

**Batch 4: voice & video upgrades, themes, profiles and motion**

- **No more microphone or camera prompts.** aether.chat answers WebView2's permission prompt itself, like Discord
  does. Windows' own privacy switches (Settings → Privacy → Microphone and Camera) still apply.
- **See who's in voice before joining.** Every voice and stage channel lists who's inside, with mute, deafen,
  camera and **LIVE** icons, plus a `2/5` counter on channels with a user limit.
- **Moderator voice tools** (right-click or ⋯ on someone in a voice channel):
  - server mute and server deafen, which follow the member between channels in the server;
  - move to another channel;
  - disconnect.

  All of them are audited. Everyone else's app also stops playing a server-muted or disconnected member's audio.
- **Stage channels:** speakers and an audience. Listeners raise a hand ✋. Stage moderators (Mute Members) see the
  requests and can *Invite to speak* or move people back to the audience.
- **Soundboard** (🎵 in calls):
  - 8 built-in sounds, plus up to 48 custom sounds per server (Server Settings → Soundboard, up to 5 seconds and
    1 MB);
  - sounds play to everyone in the call through the peer-to-peer mesh;
  - new permissions: *Use Soundboard* and *Manage Expressions*.
- **AI noise suppression:** RNNoise runs locally on your PC (Settings → Voice & Audio).
- **Video layouts:**
  - Grid, Focus (double-click any tile) and Speaker (follows whoever is talking);
  - **pop-out** picture-in-picture and fullscreen for any stream or camera.
- **Go Live banner:** text channels show "Alex is streaming in 🔊 Gaming" with a *Watch stream* button, and
  streaming channels get a LIVE badge.
- **Connection stats:** signal bars on every call tile. Hover for ping, packet loss, bitrate, and whether the
  connection is direct or relayed.
- **Optional TURN relay:** bring your own server for networks that block peer-to-peer (Settings → Voice &
  Audio).
- **20 new themes**, 24 in total, including 4 light ones:
  - dark: Midnight, Dracula, Catppuccin Mocha, Tokyo Night, Rosé Pine, Gruvbox, Solarized Dark, Monokai,
    Synthwave, Vaporwave, Forest, Ocean, Sunset, Crimson, Matrix, High Contrast;
  - light: Daylight, Catppuccin Latte, Sakura, Paper.
- **Profile customization:**
  - name fonts: Rounded, Serif, Display, Handwritten, Mono, Pixel;
  - name effects: Gradient, Rainbow, Shimmer, Glow, Neon, with your own colours;
  - card styles: Gradient, Glass, Aurora (animated);
  - profile effects: Sparkles, Stars, Snow, Hearts, Petals, Confetti, Fireflies, Bubbles, Rain;
  - avatar shapes: Squircle, Hexagon;
  - 7 new avatar frames: Rainbow, Fire, Ice, Hearts, Sparkle, Halo, Radar;
  - pronouns, and up to 5 profile links.
- **Motion everywhere:**
  - menus, dialogs and settings spring in;
  - messages slide up as they arrive;
  - buttons press down when clicked;
  - speaking rings pulse and badges pop;
  - an optional ambient aurora background.

  Choose Full, Subtle, Off or Follow Windows in Settings → Appearance.
- Database: `supabase/migrations/006_voice_and_profiles.sql`.

## [0.6.0] - 2026-11-11

**Batch 3: notifications and presence**

- **Desktop notifications** for DMs, mentions and incoming calls while aether.chat is in the background, with an
  option to hide the message text. Test them from Settings → Notifications & Sounds.
- **Per-chat notification settings** (🔔 in any channel or DM header, or *Notification settings* in the server
  menu):
  - mute for 15 minutes, 1, 3, 8 or 24 hours, or until you turn it back on;
  - notify about all messages, only @mentions, or nothing;
  - suppress @everyone and @here for a whole server.
  Muted servers, channels and DMs are dimmed and don't show unread dots. "Nothing" also removes their mention
  badges.
- **Inbox** (tray icon under Home): every recent message that mentions you or your roles, plus every chat with
  unread messages, with *Mark as read* and *Mark all as read*.
- **Taskbar badge:** a red unread count on the taskbar icon and in the window title. The taskbar button flashes on
  incoming calls.
- **Auto-idle:** you show as Idle after 10 minutes without keyboard or mouse input anywhere on your PC (adjustable,
  or off). Your chosen status isn't changed.
- **Custom status with expiry:** set a status and emoji from the user menu and clear it after 30 minutes, 1 hour,
  4 hours, today or this week.
- **Activity status (opt-in):** "Playing VALORANT" in the member list, friends list and profile. About 70 games are
  recognised and you can add your own. Detection runs on your PC and only the game's name is shared. Turn it on in
  Settings → Activity Privacy.
- **System tray:** closing the window keeps aether.chat running in the tray, which has Open, Toggle mute, Toggle
  deafen and Quit. Launching it again brings the running copy to the front.
- **Start with Windows** (Settings → Windows Settings): opens quietly in the tray when you sign in.
- **Background shortcuts:** mute, deafen and push-to-talk work while you're in a game or another app. Keys you type
  with, such as a bare letter, stay inside aether.chat so they don't break typing elsewhere.
- Database: `supabase/migrations/005_notifications.sql`.

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
