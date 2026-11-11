/**
 * Call controller shared across the app. Owns the single voice engine instance and knows which
 * room it is in: a server voice channel or a DM / group DM call. DM calls are backed by a row
 * in public.calls (that row is what makes the other side ring). When the last person leaves,
 * the call is ended.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCallActions } from '../hooks/useSocialData';
import { useVoiceEngine, type VoiceEngine } from '../hooks/useVoiceEngine';
import { useSupabase } from '../lib/supabase';
import { useSettingsStore } from '../stores/settingsStore';

export interface VoiceRoomRef {
  kind: 'channel' | 'conversation';
  id: string;
  name: string;
}

interface CallController {
  voice: VoiceEngine;
  room: VoiceRoomRef | null;
  joinChannel: (id: string, name: string) => void;
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
  const wantCameraRef = useRef(false);

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
    (id: string, name: string) => {
      setRoom({ kind: 'channel', id, name });
      void join(id);
    },
    [join],
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
    leaveEngine();
    setRoom(null);
  }, [calls.end, leaveEngine, room]);

  const toggleScreenShare = useCallback(() => {
    if (voice.isSharingScreen) stopScreenShare();
    else void startScreenShare(screenDefaults).catch(() => undefined); // the user cancelled the picker
  }, [voice.isSharingScreen, stopScreenShare, startScreenShare, screenDefaults]);

  const toggleCamera = useCallback(() => {
    if (voice.isCameraOn) stopCamera();
    else void startCamera().catch(() => undefined);
  }, [voice.isCameraOn, stopCamera, startCamera]);

  const value = useMemo(
    () => ({ voice, room, joinChannel, callConversation, leave, toggleScreenShare, toggleCamera }),
    [voice, room, joinChannel, callConversation, leave, toggleScreenShare, toggleCamera],
  );
  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}

export function useCall(): CallController {
  const ctx = useContext(CallCtx);
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>');
  return ctx;
}
