/** Server Settings → Bot → Webhooks: let outside services (GitHub, CI, bots) post into a channel. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BUILT_IN_BACKEND } from '../config';
import { useChannels } from '../hooks/useChatData';
import { useSupabase } from '../lib/supabase';
import type { Server } from '../types/db';
import { ask } from './ConfirmDialog';
import { CopyIcon, LinkIcon, PlusIcon, TrashIcon } from './icons';
import { inputCls, Section } from './SettingsPanel';
import { toast } from './Toaster';

interface Hook {
  id: string;
  channel_id: string;
  name: string;
  token: string;
  created_at: string;
  last_used_at: string | null;
}

export const webhookUrl = (h: Pick<Hook, 'id' | 'token'>) => `${BUILT_IN_BACKEND.url}/functions/v1/webhook/${h.id}/${h.token}`;

export function WebhooksSection({ server, editable }: { server: Server; editable: boolean }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data: channels = [] } = useChannels(server.id);
  const text = channels.filter((c) => c.type === 'text' && !c.thread_parent_id);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('');
  const key = ['webhooks', server.id];
  const { data: hooks = [] } = useQuery({
    queryKey: key,
    enabled: editable,
    queryFn: async () => {
      const { data, error } = await sb.from('channel_webhooks').select('id, channel_id, name, token, created_at, last_used_at').eq('server_id', server.id).order('created_at');
      if (error) throw new Error(error.message);
      return data as Hook[];
    },
  });
  if (!editable) return null;

  const create = async () => {
    const ch = channel || text[0]?.id;
    if (!ch || !name.trim()) return toast.error('Pick a name and a channel.');
    const { data, error } = await sb.from('channel_webhooks').insert({ server_id: server.id, channel_id: ch, name: name.trim() }).select('id, token').single();
    if (error) return toast.error(error.message);
    setName('');
    void qc.invalidateQueries({ queryKey: key });
    void navigator.clipboard.writeText(webhookUrl(data as Hook)).then(() => toast.success('Webhook created. Its URL is copied.'));
  };
  const remove = async (h: Hook) => {
    if (!(await ask(`Delete the webhook "${h.name}"? Anything using its URL stops working.`, { danger: true, confirmLabel: 'Delete' }))) return;
    await sb.from('channel_webhooks').delete().eq('id', h.id);
    void qc.invalidateQueries({ queryKey: key });
  };

  return (
    <Section title="Webhooks" description="A secret URL that lets other apps post into a channel. Works with tools that support Discord webhooks: send JSON with content, and optionally username and avatar_url.">
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} !w-48`} maxLength={80} placeholder="Name, e.g. GitHub" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={`${inputCls} !w-48`} value={channel || text[0]?.id || ''} onChange={(e) => setChannel(e.target.value)}>
          {text.map((c) => (
            <option key={c.id} value={c.id}>
              # {c.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void create()} className="ae-press flex items-center gap-1.5 rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent">
          <PlusIcon size={15} /> Create
        </button>
      </div>
      <ul className="space-y-1.5">
        {hooks.map((h) => (
          <li key={h.id} className="flex items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/20 px-3 py-2">
            <LinkIcon size={16} className="text-ae-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{h.name}</p>
              <p className="truncate text-xs text-ae-muted">
                #{text.find((c) => c.id === h.channel_id)?.name ?? 'deleted channel'} · {h.last_used_at ? `last used ${new Date(h.last_used_at).toLocaleString()}` : 'never used'}
              </p>
            </div>
            <button type="button" data-tip="Copy URL" className="grid h-8 w-8 place-items-center rounded-ae text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => void navigator.clipboard.writeText(webhookUrl(h)).then(() => toast.success('Webhook URL copied.'))}>
              <CopyIcon size={15} />
            </button>
            <button type="button" data-tip="Delete" className="grid h-8 w-8 place-items-center rounded-ae text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={() => void remove(h)}>
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
        {hooks.length === 0 && <li className="text-sm text-ae-muted">No webhooks yet.</li>}
      </ul>
    </Section>
  );
}
