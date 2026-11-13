/**
 * Drafts that follow you between devices, and scheduled messages.
 *   - useSyncedDraft: loads your unsent text for a chat from the server and saves it as you type.
 *   - ScheduleDialog: pick when a message should go out (the server sends it, even if you're offline).
 *   - ScheduledChip: "2 scheduled" above the message box, with a list to cancel or send now.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSupabase } from '../lib/supabase';
import type { MessageScope } from '../types/db';
import { ClockIcon, CloseIcon, SendIcon, TrashIcon } from './icons';
import { Dialog } from './Dialog';
import { toast } from './Toaster';

interface ScheduledRow {
  id: string;
  content: string;
  send_at: string;
  failed: string | null;
}

const col = (scope: MessageScope) => (scope.kind === 'channel' ? 'channel_id' : 'conversation_id');

/** Keeps the message box in sync with your saved draft for this chat. */
export function useSyncedDraft(scope: MessageScope, draft: string, setDraft: Dispatch<SetStateAction<string>>) {
  const sb = useSupabase();
  const loaded = useRef(false);
  const last = useRef('');

  useEffect(() => {
    loaded.current = false;
    let gone = false;
    void sb
      .from('message_drafts')
      .select('content')
      .eq('scope_id', scope.id)
      .maybeSingle()
      .then(({ data }) => {
        if (gone) return;
        const saved = (data as { content: string } | null)?.content ?? '';
        last.current = saved;
        loaded.current = true;
        // Don't overwrite anything typed while the draft was loading.
        if (saved) setDraft((cur) => cur || saved);
      });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.id, sb]);

  useEffect(() => {
    if (!loaded.current || draft === last.current) return;
    const t = setTimeout(() => {
      last.current = draft;
      if (draft.trim()) void sb.from('message_drafts').upsert({ scope_id: scope.id, content: draft.slice(0, 4000), updated_at: new Date().toISOString() });
      else void sb.from('message_drafts').delete().eq('scope_id', scope.id);
    }, 1200);
    return () => clearTimeout(t);
  }, [draft, scope.id, sb]);
}

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleDialog({ scope, content, replyToId, onClose, onScheduled }: { scope: MessageScope; content: string; replyToId: string | null; onClose: () => void; onScheduled: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 60 * 60_000)));
  const [busy, setBusy] = useState(false);
  const at = (h: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, 0, 0, 0);
    if (d.getTime() < Date.now() + 60_000) d.setDate(d.getDate() + 1);
    return d;
  };
  const presets: [string, Date][] = [
    ['In 30 minutes', new Date(Date.now() + 30 * 60_000)],
    ['In 1 hour', new Date(Date.now() + 60 * 60_000)],
    ['Tonight, 8 PM', at(20)],
    ['Tomorrow, 9 AM', at(9, 1)],
  ];
  const save = async () => {
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 30_000) return toast.error('Pick a time in the future.');
    setBusy(true);
    const { error } = await sb.from('scheduled_messages').insert({ [col(scope)]: scope.id, content, reply_to_id: replyToId, send_at: date.toISOString() });
    setBusy(false);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ['scheduled', scope.id] });
    toast.success(`Scheduled for ${date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`, <ClockIcon size={14} />);
    onScheduled();
  };
  return (
    <Dialog title="Schedule message" onClose={onClose}>
      <p className="line-clamp-3 rounded-ae bg-ae-sunken px-3 py-2 text-sm whitespace-pre-wrap">{content}</p>
      <div className="grid grid-cols-2 gap-2">
        {presets.map(([label, d]) => (
          <button key={label} type="button" onClick={() => setWhen(localInput(d))} className={`rounded-ae border px-3 py-2 text-left text-sm ${when === localInput(d) ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border hover:bg-ae-hover'}`}>
            <span className="block font-semibold">{label}</span>
            <span className="block text-xs text-ae-muted">{d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </button>
        ))}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-bold tracking-wide text-ae-muted uppercase">Or pick a time</span>
        <input type="datetime-local" className="ae-input w-full" value={when} min={localInput(new Date(Date.now() + 60_000))} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <p className="text-xs text-ae-muted">Aether sends it at that time even if you're offline. You can cancel it until then.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={busy} className="flex items-center gap-1.5 rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50" onClick={() => void save()}>
          <ClockIcon size={15} /> Schedule
        </button>
      </div>
    </Dialog>
  );
}

/** "N scheduled" above the message box, with the list. */
export function ScheduledChip({ scope }: { scope: MessageScope }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ['scheduled', scope.id];
  const { data: rows = [] } = useQuery({
    queryKey: key,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await sb.from('scheduled_messages').select('id, content, send_at, failed').eq(col(scope), scope.id).order('send_at');
      return (data ?? []) as ScheduledRow[];
    },
  });
  if (!rows.length) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const failed = rows.filter((r) => r.failed).length;
  return (
    <div className="relative mb-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${failed ? 'bg-ae-danger/15 text-ae-danger' : 'bg-ae-surface text-ae-muted hover:text-ae-text'}`}>
        <ClockIcon size={13} /> {rows.length} scheduled{failed ? ` · ${failed} couldn't send` : ''}
      </button>
      {open && (
        <div className="ae-pop absolute bottom-full left-0 z-30 mb-2 w-[min(380px,calc(100vw-24px))] rounded-ae border border-ae-border bg-ae-elevated p-2 shadow-2xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Scheduled messages</p>
            <button type="button" aria-label="Close" className="text-ae-muted hover:text-ae-text" onClick={() => setOpen(false)}>
              <CloseIcon size={14} />
            </button>
          </div>
          <ul className="ae-scroll max-h-72 space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md px-2 py-1.5 hover:bg-ae-hover">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold ${r.failed ? 'text-ae-danger' : 'text-ae-accent'}`}>
                      {r.failed ? "Couldn't send" : new Date(r.send_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                    <p className="line-clamp-2 text-sm">{r.content || 'Attachment'}</p>
                    {r.failed && <p className="text-xs text-ae-muted">{r.failed}</p>}
                  </div>
                  {!r.failed && (
                    <button
                      type="button"
                      data-tip="Send now"
                      aria-label="Send now"
                      className="grid h-7 w-7 place-items-center rounded text-ae-muted hover:text-ae-accent"
                      onClick={async () => {
                        await sb.from('scheduled_messages').update({ send_at: new Date().toISOString() }).eq('id', r.id);
                        toast('Sending within a minute.', <SendIcon size={14} />);
                        refresh();
                      }}
                    >
                      <SendIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    data-tip="Cancel"
                    aria-label="Cancel scheduled message"
                    className="grid h-7 w-7 place-items-center rounded text-ae-muted hover:text-ae-danger"
                    onClick={async () => {
                      await sb.from('scheduled_messages').delete().eq('id', r.id);
                      refresh();
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
