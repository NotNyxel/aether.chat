# AetherChat — Architecture

AetherChat is a zero-install, web-first messaging + P2P voice/stream client that renders
inside **velox** / **aetherOS**. Everything runs on free tiers: Supabase (Postgres, Auth,
Realtime, Storage) for state and signaling, the public PeerJS broker for SDP exchange, and
Google's public STUN servers for NAT traversal. **No media ever touches a server.**

```
┌──────────────────────────────────────── velox / aetherOS ─────────────────────────────────────────┐
│                                                                                                    │
│  ┌──────────────────────────── AetherChat (React 19 + TS + Vite + Tailwind v4) ────────────────┐   │
│  │                                                                                              │   │
│  │   UI layer                 State layer                     Engines                           │   │
│  │  ┌──────────────┐        ┌──────────────────┐        ┌─────────────────────────────────┐    │   │
│  │  │ ServerRail   │◄──────►│ Zustand (UI)     │        │ ThemeEngine.tsx                 │    │   │
│  │  │ ChannelList  │        │  · active server │        │  · CSS-variable token injection │    │   │
│  │  │ MessageView  │        │  · voice prefs   │        │  · scoped custom-CSS sandbox    │    │   │
│  │  │ VoiceDock    │        │  · theme preset  │        │  · OLED / Cyberpunk / Nord /    │    │   │
│  │  │ ProfileCard  │        └──────────────────┘        │    aetherOS Glass presets       │    │   │
│  │  │ Settings     │        ┌──────────────────┐        └─────────────────────────────────┘    │   │
│  │  └──────┬───────┘◄──────►│ TanStack Query v5│        ┌─────────────────────────────────┐    │   │
│  │         │                │  · messages      │        │ useVoiceEngine.ts               │    │   │
│  │         │                │  · members/roles │        │  · PeerJS mesh (1 call / peer)  │    │   │
│  │         │                │  · profiles      │        │  · Web Audio graph (HPF, comp,  │    │   │
│  │         │                └────────┬─────────┘        │    gate, per-peer gain)         │    │   │
│  │         │                         │                  │  · screen share side-calls      │    │   │
│  │         │                         │                  └──────┬───────────────┬──────────┘    │   │
│  └─────────┼─────────────────────────┼─────────────────────────┼───────────────┼───────────────┘   │
└────────────┼─────────────────────────┼─────────────────────────┼───────────────┼───────────────────┘
             │ HTTPS (PostgREST/RPC)   │ WSS (postgres_changes)  │ WSS presence  │ WSS (SDP/ICE only)
             ▼                         ▼                         ▼               ▼
┌─────────────────────────── Supabase (free tier) ────────────────────────┐  ┌──────────────────────┐
│  Auth (JWT)──► RLS: users · servers · server_members · server_roles     │  │ PeerJS cloud broker  │
│                     member_roles · channels · channel_overwrites        │  │ (0.peerjs.com, free) │
│                     messages · server_invites · server_bans             │  │  relays offers/      │
│  Realtime:  postgres_changes(messages)  +  private topic "voice:<id>"   │  │  answers/candidates  │
│             (realtime.messages RLS → requires CONNECT on that channel)  │  └──────────────────────┘
│  Storage:   attachments/<channel_id>/…   profile-media/<user_id>/…      │
└─────────────────────────────────────────────────────────────────────────┘

                        P2P media plane (DTLS-SRTP, never via a server)
         ┌────────┐  audio call (Opus, DTX+FEC)   ┌────────┐
         │ Peer A │◄─────────────────────────────►│ Peer B │      Full mesh: N·(N-1)/2 audio calls.
         └───┬────┘◄──── screen call (A→B) ──────►└───┬────┘      Screen share = extra one-way call
             │  ▲                                     │  ▲        per viewer, so the audio mesh is
             ▼  │         ┌────────┐                  ▼  │        never renegotiated or dropped.
             └──┴────────►│ Peer C │◄─────────────────┴──┘
                          └────────┘
                 NAT traversal: stun:stun.l.google.com:19302 (no TURN → $0)
```

## Voice join sequence

```
Client                         Supabase Realtime (voice:<channel>)        PeerJS broker        Remote peer
  │ getUserMedia → Web Audio graph   │                                       │                    │
  │ new Peer("ae-<uid>-<nonce>") ────┼──────────────────────────────────────►│ open               │
  │ subscribe (private, RLS checks CONNECT)                                  │                    │
  │ presence.track({peerId,muted…})─►│ sync ─────────────────────────────────┼───────────────────►│
  │◄─────────────────────────────────│ sync (everyone sees everyone)         │                    │
  │ for each peer: if myId < theirId → peer.call()  ──── offer ─────────────►│──────────────────►│
  │                                  │                                       │◄──── answer ───────│
  │◄═══════════════════════ DTLS-SRTP audio (direct) ═══════════════════════════════════════════►│
```

* **Glare-free dialing**: only the lexicographically smaller peer ID dials, so two peers never
  call each other at the same time.
* **Admission control**: incoming PeerJS calls are only answered if the caller's peer ID is in the
  Supabase presence set, and that topic is protected by RLS. A stranger who guesses a peer ID gets
  dropped.
* **Mic device swap / settings**: the outgoing track is a `MediaStreamAudioDestinationNode`, so
  changing the microphone only rewires the graph. No renegotiation is needed.

## Cost and limits

| Concern        | Choice                                    | Note                                               |
|----------------|-------------------------------------------|----------------------------------------------------|
| Media relay    | none (mesh)                               | Practical ceiling is about 8–10 voice peers / room |
| NAT traversal  | Google STUN only                          | ~10–15% of users behind symmetric NAT cannot connect without TURN |
| Signaling      | Supabase presence + PeerJS public broker  | `peerServer` option lets you self-host PeerServer  |
| Storage        | Supabase Storage (1 GB free)              | 25 MB attachment cap enforced by bucket            |
