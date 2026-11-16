/**
 * Disappearing messages (2.0): anyone in a DM or group can turn them on. New messages then vanish
 * for everyone after the chosen time (the server hides them at once and deletes them every few
 * minutes). Messages sent before it was turned on stay.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import type { Conversation } from '../types/db';
import { openContextMenu } from './ContextMenu';
import { CheckIcon, TimerIcon } from './icons';
import { toast } from './Toaster';

export const DISAPPEAR_OPTIONS: { seconds: number | null; label: string; short: string }[] = [
  { seconds: null, label: 'Off', short: 'Off' },
  { seconds: 3600, label: '1 hour', short: '1h' },
  { seconds: 86_400, label: '24 hours', short: '24h' },
  { seconds: 7 * 86_400, label: '7 days', short: '7d' },
  { seconds: 90 * 86_400, label: '90 days', short: '90d' },
];

export const disappearLabel = (s: number | null | undefined) =>
  DISAPPEAR_OPTIONS.find((o) => o.seconds === (s ?? null))?.label ?? (s ? `${Math.round(s / 3600)} hours` : 'Off');

function useSetDisappearing(conv: Conversation) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (seconds: number | null) => {
      const { error } = await sb.rpc('set_disappearing', { p_conversation_id: conv.id, p_seconds: seconds });
      if (error) throw new Error(error.message);
    },
    onMutate: (seconds) => qc.setQueryData<Conversation[]>(['conversations'], (rows) => rows?.map((c) => (c.id === conv.id ? { ...c, disappear_after: seconds } : c))),
    onSuccess: (_d, seconds) =>
      toast(seconds ? `New messages will disappear after ${disappearLabel(seconds)}.` : 'Disappearing messages turned off.', <TimerIcon size={14} />),
    onError: (e) => {
      toast.error(e.message);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/** Header button: a timer that lights up (with the duration) while it's on. */
export function DisappearingButton({ conv }: { conv: Conversation }) {
  const set = useSetDisappearing(conv);
  const on = !!conv.disappear_after;
  const short = DISAPPEAR_OPTIONS.find((o) => o.seconds === conv.disappear_after)?.short;
  return (
    <button
      type="button"
      data-tip={on ? `Disappearing messages: ${disappearLabel(conv.disappear_after)}` : 'Disappearing messages'}
      aria-label="Disappearing messages"
      className={`flex items-center gap-1 ${on ? 'text-ae-accent' : 'hover:text-ae-text'}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openContextMenu(
          new MouseEvent('contextmenu', { clientX: r.left, clientY: r.bottom + 6 }),
          DISAPPEAR_OPTIONS.map((o) => ({
            label: o.seconds ? `After ${o.label}` : 'Off',
            icon: (conv.disappear_after ?? null) === o.seconds ? <CheckIcon size={15} /> : undefined,
            onClick: () => (conv.disappear_after ?? null) !== o.seconds && set.mutate(o.seconds),
          })),
          <p className="px-2 py-1 text-xs text-ae-muted">New messages vanish for everyone in this chat after the time you pick.</p>,
        );
      }}
    >
      <TimerIcon size={18} />
      {on && short && <span className="text-[11px] font-bold">{short}</span>}
    </button>
  );
}

/** A slim notice above the chat while it's on. */
export function DisappearingBar({ conv }: { conv: Conversation }) {
  if (!conv.disappear_after) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-ae-border bg-ae-accent/10 px-4 py-1.5 text-xs text-ae-muted">
      <TimerIcon size={13} className="text-ae-accent" />
      Disappearing messages are on. New messages vanish after {disappearLabel(conv.disappear_after)}.
    </div>
  );
}
