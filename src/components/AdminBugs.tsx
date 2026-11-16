/** Admin → Bug reports and Admin → Errors (2.0): what people reported, and what the app caught. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSupabase } from '../lib/supabase';
import { DisplayName } from './MessageItem';
import { toast } from './Toaster';

interface BugRow {
  id: string;
  user_id: string | null;
  description: string;
  screenshot_path: string | null;
  app_version: string | null;
  platform: string | null;
  page: string | null;
  status: 'open' | 'fixed' | 'closed';
  created_at: string;
}

interface ErrorRow {
  id: number;
  fingerprint: string;
  message: string;
  stack: string | null;
  app_version: string | null;
  platform: string | null;
  page: string | null;
  count: number;
  users: string[];
  first_seen: string;
  last_seen: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Screenshot({ path }: { path: string }) {
  const sb = useSupabase();
  const { data: url } = useQuery({
    queryKey: ['bug-shot', path],
    staleTime: 50 * 60_000,
    queryFn: async () => (await sb.storage.from('bug-reports').createSignedUrl(path, 3600)).data?.signedUrl ?? null,
  });
  if (!url) return <div className="ae-skeleton h-24 w-40 rounded-ae" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Screenshot from the report" className="max-h-48 rounded-ae border border-ae-border hover:opacity-90" />
    </a>
  );
}

export function BugReportsAdmin() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const q = useQuery({
    queryKey: ['admin-bugs', filter],
    queryFn: async () => {
      let query = sb.from('bug_reports').select('id, user_id, description, screenshot_path, app_version, platform, page, status, created_at').order('created_at', { ascending: false }).limit(100);
      if (filter === 'open') query = query.eq('status', 'open');
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as BugRow[];
    },
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BugRow['status'] }) => {
      const { error } = await sb.from('bug_reports').update({ status }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-bugs'] }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-sm">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-ae px-3 py-1 ${filter === f ? 'bg-ae-surface font-semibold' : 'text-ae-muted hover:text-ae-text'}`}>
            {f === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>
      {q.isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {q.data?.length === 0 && <p className="text-sm text-ae-muted">{filter === 'open' ? 'No open bug reports.' : 'No bug reports yet.'}</p>}
      <ul className="space-y-2">
        {q.data?.map((b) => (
          <li key={b.id} className="space-y-2 rounded-ae border border-ae-border bg-ae-sunken p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ae-muted">
              <strong className="text-sm text-ae-text">{b.user_id ? <DisplayName userId={b.user_id} /> : 'Deleted user'}</strong>
              <span>{when(b.created_at)}</span>
              <span className="rounded bg-ae-surface px-1.5">v{b.app_version}</span>
              <span className="rounded bg-ae-surface px-1.5">{b.platform}</span>
              {b.page && <span className="rounded bg-ae-surface px-1.5">{b.page}</span>}
              <span className={`ml-auto rounded px-1.5 font-bold uppercase ${b.status === 'open' ? 'bg-ae-warning/20 text-ae-warning' : b.status === 'fixed' ? 'bg-ae-success/20 text-ae-success' : 'bg-ae-surface'}`}>{b.status}</span>
            </div>
            <p className="ae-selectable text-sm whitespace-pre-wrap">{b.description}</p>
            {b.screenshot_path && <Screenshot path={b.screenshot_path} />}
            <div className="flex gap-2 text-xs">
              {b.status !== 'fixed' && (
                <button type="button" className="rounded-ae bg-ae-success/15 px-2.5 py-1 text-ae-success hover:bg-ae-success/25" onClick={() => setStatus.mutate({ id: b.id, status: 'fixed' })}>
                  Mark fixed
                </button>
              )}
              {b.status !== 'closed' && (
                <button type="button" className="rounded-ae px-2.5 py-1 text-ae-muted hover:bg-ae-hover" onClick={() => setStatus.mutate({ id: b.id, status: 'closed' })}>
                  Close
                </button>
              )}
              {b.status !== 'open' && (
                <button type="button" className="rounded-ae px-2.5 py-1 text-ae-muted hover:bg-ae-hover" onClick={() => setStatus.mutate({ id: b.id, status: 'open' })}>
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ErrorsAdmin() {
  const sb = useSupabase();
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['admin-errors'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('client_errors').select('*').order('last_seen', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data as ErrorRow[];
    },
  });
  return (
    <div className="space-y-2">
      {q.isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {q.data?.length === 0 && <p className="text-sm text-ae-muted">No errors caught. Nice.</p>}
      <ul className="space-y-1.5">
        {q.data?.map((e) => (
          <li key={e.id} className="rounded-ae border border-ae-border bg-ae-sunken">
            <button type="button" className="flex w-full items-start gap-3 p-2.5 text-left" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              <span className="grid min-w-12 shrink-0 place-items-center rounded bg-ae-danger/15 px-1.5 py-0.5 text-xs font-bold text-ae-danger" title="Times seen">
                ×{e.count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{e.message}</span>
                <span className="block text-xs text-ae-muted">
                  v{e.app_version} · {e.platform} · {e.page} · {e.users.length} {e.users.length === 1 ? 'person' : 'people'} · last {when(e.last_seen)}
                </span>
              </span>
            </button>
            {open === e.id && (
              <pre className="ae-selectable ae-scroll max-h-64 overflow-auto border-t border-ae-border p-2.5 font-mono text-[11px] whitespace-pre-wrap text-ae-muted">
                {e.stack || 'No stack trace.'}
                {`\n\nFirst seen ${when(e.first_seen)}`}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
