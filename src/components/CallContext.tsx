/**
 * Call controller shared across the app. Owns the single voice engine instance and knows which
 * room it is in: a server voice channel or a DM / group DM call. DM calls are backed by a row
 * in public.calls (that row is what makes the other side ring). When the last person leaves,
 * the call is ended.
 *
 * Server voice and stage channels also keep a row in public.voice_states (join/leave RPCs plus a
 * 30-second heartbeat). That row is how everyone sees occupancy, and how moderators reach us:
 * server mute/deafen and stage audience force our audio off, a move switches rooms, and a
 * disconnect (row deleted) makes us leave. Other participants also stop playing audio from anyone
 * the database says is muted, in the audience, or no longer in the channel.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../hooks/useChatData';
import { useCallActions } from '../hooks/useSocialData';
import { useVoiceStates } from '../hooks/useVoiceStates';
import { useVoiceEngine, type VoiceEngine } from '../hooks/useVoiceEngine';
import { loopSound, playSound } from '../lib/sounds';
import { useSupabase } from '../lib/supabase';
import { useSettingsStore } from '../stores/settingsStore';
import type { Channel, VoiceState } from '../types/db';

export interface VoiceRoomRef {
  kind: 'channel' | 'conversation';
  id: string;
  name: string;
  /** Server of a channel room. */
  serverId?: string;
  /** Stage channels have speakers and an audience. */
  stage?: boolean;
}

interface CallController {
  voice: VoiceEngine;
  room: VoiceRoomRef | null;
  /** Our row in voice_states while in a server channel. */
  myVoiceState: VoiceState | null;
  /** Why the last join failed or why we were removed (shown in the voice dock). */
  notice: string | null;
  joinChannel: (channel: Pick<Channel, 'id' | 'name' | 'server_id' | 'type'>) => void;
  /** Starts (or joins the existing) call in a conversation; optionally turns the camera on. */
  callConversation: (id: string, name: string, withVideo?: boolean) => void;
  leave: () => void;
  toggleScreenShare: () => void;
  toggleCamera: () => void;
}

const CallCtx = createContext<CallController | null>(null);

export function CallProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const sb = useSupabase();
  const audio = useSettingsStore((s) => s.audio);
  const screenDefaults = useSettingsStore((s) => s.screen);
  const voice = useVoiceEngine({ supabase: sb, userId, initialSettings: audio });
  const { join, leave: leaveEngine, updateSettings, startCamera, stopCamera, startScreenShare, stopScreenShare } = voice;
  const calls = useCallActions();
  const [room, setRoom] = useState<VoiceRoomRef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wantCameraRef = useRef(false);
  const qc = useQueryClient();
  const roomServerId = room?.kind === 'channel' ? (room.serverId ?? null) : null;
  const { byUser } = useVoiceStates(roomServerId);
  const myVoiceState = roomServerId ? (byUser.get(userId) ?? null) : null;
  /** True once our voice_states row exists for the current room (so a missing row means "disconnected"). */
  const stateJoinedRef = useRef(false);

  // Push settings-store changes into the live audio graph.
  useEffect(() => {
    void updateSettings(audio);
  }, [audio, updateSettings]);

  // Turn the camera on once a video call has connected.
  useEffect(() => {
    if (voice.status === 'connected' && wantCameraRef.current) {
      wantCameraRef.current = false;
      void startCamera().catch(() => undefined);
    }
    if (voice.status === 'idle' || voice.status === 'error') {
      wantCameraRef.current = false;
      if (voice.status === 'idle') setRoom(null);
    }
  }, [voice.status, startCamera]);

  const joinChannel = useCallback(
    (channel: Pick<Channel, 'id' | 'name' | 'server_id' | 'type'>) => {
      setNotice(null);
      stateJoinedRef.current = false;
      // Claim the seat first: the database checks permission, timeouts and the user limit.
      void (async () => {
        try {
          const row = unwrap(await sb.rpc('voice_join', { p_channel_id: channel.id })) as VoiceState;
          qc.setQueryData<VoiceState[]>(['voice-states', channel.server_id], (rows = []) => [...rows.filter((r) => r.user_id !== row.user_id), row]);
          stateJoinedRef.current = true;
          setRoom({ kind: 'channel', id: channel.id, name: channel.name, serverId: channel.server_id, stage: channel.type === 'stream' });
          await join(channel.id);
        } catch (e) {
          setNotice(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [join, qc, sb],
  );

  const callConversation = useCallback(
    (id: string, name: string, withVideo = false) => {
      wantCameraRef.current = withVideo;
      setRoom({ kind: 'conversation', id, name });
      calls.start.mutate(id); // creates the ringing call row (or reuses the active one)
      void join(id);
    },
    [calls.start, join],
  );

  const participantsRef = useRef(0);
  participantsRef.current = voice.participants.length;

  const leave = useCallback(() => {
    // Last one out ends the DM call so nobody keeps seeing "call in progress".
    if (room?.kind === 'conversation' && participantsRef.current === 0) calls.end.mutate(room.id);
    if (room?.kind === 'channel') {
      stateJoinedRef.current = false;
      void sb.rpc('voice_leave');
      qc.setQueryData<VoiceState[]>(['voice-states', room.serverId], (rows = []) => rows.filter((r) => r.user_id !== userId));
    }
    if (voice.status === 'connected') playSound(room?.kind === 'conversation' ? 'callEnd' : 'voiceLeave');
    leaveEngine();
    setRoom(null);
  }, [calls.end, leaveEngine, qc, room, sb, userId, voice.status]);

  // ── voice_states: heartbeat, moderation, moves ────────────────────────────────────────────
  const inChannel = room?.kind === 'channel' && voice.status === 'connected';
  const flags = `${voice.isMuted}|${voice.isDeafened}|${voice.isSharingScreen}|${voice.isCameraOn}`;
  useEffect(() => {
    if (!inChannel) return;
    const beat = () =>
      void sb.rpc('voice_update', {
        p_self_mute: voice.isMuted,
        p_self_deaf: voice.isDeafened,
        p_streaming: voice.isSharingScreen,
        p_camera: voice.isCameraOn,
      });
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `flags` captures the four booleans
  }, [inChannel, flags, sb]);

  const { setForcedMute, setForcedDeafen, setRemoteBlocked, join: engineJoin } = voice;
  useEffect(() => {
    setForcedMute(!!myVoiceState && (myVoiceState.server_mute || myVoiceState.suppressed));
    setForcedDeafen(!!myVoiceState?.server_deaf);
  }, [myVoiceState, setForcedDeafen, setForcedMute]);

  // Moved or disconnected by a moderator.
  useEffect(() => {
    if (room?.kind !== 'channel' || !stateJoinedRef.current || voice.status === 'idle') return;
    if (!myVoiceState) {
      // Give the realtime/refetch path a moment before concluding the row is really gone.
      const t = setTimeout(() => {
        const rows = qc.getQueryData<VoiceState[]>(['voice-states', room.serverId]) ?? [];
        if (stateJoinedRef.current && !rows.some((r) => r.user_id === userId)) {
          stateJoinedRef.current = false;
          leaveEngine();
          setRoom(null);
          setNotice('You were disconnected from voice.');
          playSound('voiceLeave');
        }
      }, 2_500);
      return () => clearTimeout(t);
    }
    if (myVoiceState.channel_id !== room.id) {
      let target: Channel | undefined;
      for (const [, list] of qc.getQueriesData<Channel[]>({ queryKey: ['channels'] })) target ??= list?.find((c) => c.id === myVoiceState.channel_id);
      setRoom({ kind: 'channel', id: myVoiceState.channel_id, name: target?.name ?? 'Voice', serverId: room.serverId, stage: target?.type === 'stream' });
      void engineJoin(myVoiceState.channel_id);
    }
  }, [engineJoin, leaveEngine, myVoiceState, qc, room, userId, voice.status]);

  // Refuse audio from anyone the database says shouldn't be heard here.
  const firstSeenRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (room?.kind !== 'channel') {
      setRemoteBlocked([]);
      firstSeenRef.current.clear();
      return;
    }
    const now = Date.now();
    const blocked: string[] = [];
    for (const p of voice.participants) {
      if (!firstSeenRef.current.has(p.userId)) firstSeenRef.current.set(p.userId, now);
      const row = byUser.get(p.userId);
      if (row && row.channel_id === room.id) {
        if (row.server_mute || row.suppressed) blocked.push(p.userId);
      } else if (now - (firstSeenRef.current.get(p.userId) ?? now) > 20_000) {
        blocked.push(p.userId); // not seated here (disconnected or moved) for 20 s
      }
    }
    setRemoteBlocked(blocked);
  }, [byUser, room, setRemoteBlocked, voice.participants]);

  // ── Sound effects ─────────────────────────────────────────────────────────────────────────
  const pushToTalk = useSettingsStore((s) => s.keybinds.pushToTalkEnabled);
  const prev = useRef({ status: voice.status, count: 0, muted: false, deafened: false, streams: new Set<string>() });
  useEffect(() => {
    const p = prev.current;
    const connected = voice.status === 'connected';
    if (connected && p.status !== 'connected') playSound('voiceJoin');
    if (connected && p.status === 'connected') {
      const count = voice.participants.length;
      if (count > p.count) playSound('userJoin');
      else if (count < p.count) playSound('userLeave');

      if (voice.isDeafened !== p.deafened) playSound(voice.isDeafened ? 'deafen' : 'undeafen');
      else if (voice.isMuted !== p.muted && !pushToTalk) playSound(voice.isMuted ? 'mute' : 'unmute');

      const streams = new Set(voice.participants.filter((x) => x.sharingScreen).map((x) => x.peerId));
      if ([...streams].some((id) => !p.streams.has(id))) playSound('streamStart');
      else if ([...p.streams].some((id) => !streams.has(id) && voice.participants.some((x) => x.peerId === id))) playSound('streamStop');
      p.streams = streams;
    } else {
      p.streams = new Set();
    }
    p.status = voice.status;
    p.count = connected ? voice.participants.length : 0;
    p.muted = voice.isMuted;
    p.deafened = voice.isDeafened;
  }, [voice.status, voice.participants, voice.isMuted, voice.isDeafened, pushToTalk]);

  // Outgoing ringback while you wait alone in a DM call (stops when someone joins, after 30 s, or on leave).
  const waitingForAnswer = room?.kind === 'conversation' && voice.status === 'connected' && voice.participants.length === 0;
  useEffect(() => {
    if (!waitingForAnswer) return;
    return loopSound('callOutgoing', 3_000, 30_000);
  }, [waitingForAnswer]);

  const toggleScreenShare = useCallback(() => {
    if (voice.isSharingScreen) stopScreenShare();
    else void startScreenShare(screenDefaults).catch(() => undefined); // the user cancelled the picker
  }, [voice.isSharingScreen, stopScreenShare, startScreenShare, screenDefaults]);

  const toggleCamera = useCallback(() => {
    if (voice.isCameraOn) stopCamera();
    else void startCamera().catch(() => undefined);
  }, [voice.isCameraOn, stopCamera, startCamera]);

  const value = useMemo(
    () => ({ voice, room, myVoiceState, notice, joinChannel, callConversation, leave, toggleScreenShare, toggleCamera }),
    [voice, room, myVoiceState, notice, joinChannel, callConversation, leave, toggleScreenShare, toggleCamera],
  );
  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}

export function useCall(): CallController {
  const ctx = useContext(CallCtx);
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>');
  return ctx;
}
