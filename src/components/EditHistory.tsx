/**
 * Edit history (2.0, staff only): what a message said before each edit. App admins can see it
 * everywhere; server moderators (Manage Messages) for their own server's channels. The server's
 * RLS is the real gate; this button is only shown to people it would answer.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSupabase } from '../lib/supabase';
import { Markdown } from '../lib/markdown';
import type { Message } from '../types/db';
import { Dialog } from './Dialog';
import { useMessageText } from './E2eChat';
import { HistoryIcon } from './icons';

interface EditRow {
  id: number;
  old_content: string;
  edited_at: string;
}

function Version({ content, label, current }: { content: string; label: string; current?: boolean }) {
  const text = useMessageText(content);
  return (
    <li className={`rounded-ae border p-3 ${current ? 'border-ae-accent/50 bg-ae-accent/5' : 'border-ae-border bg-ae-sunken'}`}>
      <p className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{label}</p>
      {text ? <Markdown source={text} className="ae-selectable text-sm" /> : <p className="text-sm text-ae-muted italic">(empty)</p>}
    </li>
  );
}

function HistoryDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const sb = useSupabase();
  const q = useQuery({
    queryKey: ['message-edits', message.id, message.edited_at],
    queryFn: async () => {
      const { data, error } = await sb.from('message_edits').select('id, old_content, edited_at').eq('message_id', message.id).order('edited_at');
      if (error) throw new Error(error.message);
      return data as EditRow[];
    },
  });
  const rows = q.data ?? [];
  return (
    <Dialog title="Edit history" onClose={onClose}>
      {q.isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {q.isError && <p className="text-sm text-ae-danger">{q.error.message}</p>}
      {!q.isLoading && !q.isError && rows.length === 0 && <p className="text-sm text-ae-muted">No earlier versions were kept for this message (it was edited before 2.0).</p>}
      <ol className="ae-scroll max-h-[60vh] space-y-2 overflow-y-auto">
        {rows.map((r, i) => (
          <Version key={r.id} content={r.old_content} label={i === 0 ? `Original · replaced ${new Date(r.edited_at).toLocaleString()}` : `Version ${i + 1} · replaced ${new Date(r.edited_at).toLocaleString()}`} />
        ))}
        <Version content={message.content} label={`Now · edited ${message.edited_at ? new Date(message.edited_at).toLocaleString() : ''}`} current />
      </ol>
      <p className="mt-3 text-xs text-ae-muted">Only staff and server moderators can see this. The author isn't told.</p>
    </Dialog>
  );
}

/** The "(edited)" label; for staff it opens the history. */
export function EditedLabel({ message, canSeeHistory }: { message: Message; canSeeHistory: boolean }) {
  const [open, setOpen] = useState(false);
  if (!message.edited_at) return null;
  const when = `Edited ${new Date(message.edited_at).toLocaleString()}`;
  if (!canSeeHistory) return <span className="text-[10px] text-ae-muted" data-tip={when}>(edited)</span>;
  return (
    <>
      <button type="button" className="inline-flex items-center gap-0.5 text-[10px] text-ae-muted hover:text-ae-accent hover:underline" data-tip={`${when} · click to see edit history`} onClick={() => setOpen(true)}>
        <HistoryIcon size={10} />
        (edited)
      </button>
      {open && <HistoryDialog message={message} onClose={() => setOpen(false)} />}
    </>
  );
}
