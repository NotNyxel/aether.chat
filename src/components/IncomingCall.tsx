/**
 * Incoming DM / group call: a ringing card with Accept and Decline. Driven by Realtime INSERTs on
 * public.calls. The ringtone comes from the sound engine (toggle it under Notifications & Sounds)
 * and stays silent in Do Not Disturb.
 */
import { useCallback, useEffect, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { useActiveCalls, useConversations, useSocialRealtime } from '../hooks/useSocialData';
import { flashTaskbar, notify } from '../lib/desktop';
import { loopSound } from '../lib/sounds';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { Call, Conversation } from '../types/db';
import { useCall } from './CallContext';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { PhoneIcon, PhoneOffIcon } from './icons';

const RING_TIMEOUT_MS = 30_000;

function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return loopSound('callIncoming', 2_000, 30_000);
  }, [active]);
}

function RingCard({ call, conv, me, onAccept, onDecline, silent }: {
  call: Call;
  conv: Conversation;
  me: string;
  onAccept: (title: string) => void;
  onDecline: () => void;
  silent: boolean;
}) {
  const title = useConversationTitle(conv, me);
  const { data: caller } = useProfile(call.started_by);
  useRingtone(!silent);
  // Flash the taskbar and show a desktop notification when the app is in the background.
  const callerName = caller?.display_name || caller?.username;
  useEffect(() => {
    if (silent || !callerName) return;
    const prefs = useSettingsStore.getState().notifications;
    if (prefs.flashOnCall) void flashTaskbar();
    if (prefs.desktop && !document.hasFocus()) {
      void notify(conv.type === 'group' ? `Group call in ${title}` : `${callerName} is calling you`, 'Open aether.chat to answer.');
    }
  }, [call.id, callerName, conv.type, silent, title]);

  return (
    <div className="fixed top-6 left-1/2 z-50 w-80 -translate-x-1/2 rounded-ae border border-ae-border bg-ae-elevated p-5 text-center shadow-2xl ae-glow" role="alertdialog" aria-label="Incoming call">
      <div className="mx-auto mb-3 w-fit animate-pulse">
        <ConversationAvatar conv={conv} me={me} size={72} />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mb-4 text-sm text-ae-muted">
        {conv.type === 'group' ? `${caller?.display_name || caller?.username || 'Someone'} started a group call` : 'Incoming call…'}
      </p>
      <div className="flex justify-center gap-6">
        <button type="button" onClick={onDecline} title="Decline" className="grid h-12 w-12 place-items-center rounded-full bg-ae-danger text-white">
          <PhoneOffIcon />
        </button>
        <button type="button" onClick={() => onAccept(title)} title="Accept" className="grid h-12 w-12 place-items-center rounded-full bg-ae-success text-black">
          <PhoneIcon />
        </button>
      </div>
    </div>
  );
}

export function IncomingCall({ userId, silent }: { userId: string; silent: boolean }) {
  const [ringing, setRinging] = useState<Call | null>(null);
  const { room, voice, callConversation } = useCall();
  const { data: conversations = [] } = useConversations();
  const { data: activeCalls = [] } = useActiveCalls();
  const openHome = useUiStore((s) => s.openHome);

  const onIncoming = useCallback(
    (call: Call) => {
      // Already in that call (e.g. we joined first)? Then don't ring.
      if (room?.kind === 'conversation' && room.id === call.conversation_id && voice.status !== 'idle') return;
      setRinging(call);
    },
    [room, voice.status],
  );
  useSocialRealtime(userId, onIncoming);

  // Stop ringing when the call ends, or after 30 s.
  useEffect(() => {
    if (!ringing) return;
    const t = setTimeout(() => setRinging(null), RING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ringing]);
  useEffect(() => {
    if (ringing && activeCalls.length > 0 && !activeCalls.some((c) => c.id === ringing.id)) setRinging(null);
  }, [activeCalls, ringing]);

  if (!ringing) return null;
  const conv = conversations.find((c) => c.id === ringing.conversation_id);
  if (!conv) return null;

  return (
    <RingCard
      call={ringing}
      conv={conv}
      me={userId}
      silent={silent}
      onDecline={() => setRinging(null)}
      onAccept={(title) => {
        setRinging(null);
        openHome(conv.id);
        callConversation(conv.id, title);
      }}
    />
  );
}
