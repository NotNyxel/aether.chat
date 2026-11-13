/**
 * Server stickers: big images a server uploads (Server Settings → Stickers) that members send as a
 * message of their own from the sticker button in the message box. Sent stickers keep working for
 * everyone who can see the message.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useServers } from '../hooks/useChatData';
import { useMeId } from '../hooks/useMe';
import { useSupabase } from '../lib/supabase';
import type { Attachment, Server } from '../types/db';
import { promptText } from './ConfirmDialog';
import { StickerIcon } from './icons';
import { toast } from './Toaster';

export interface ServerSticker {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  url: string;
}

export interface StickerAttachment extends Attachment {
  sticker?: boolean;
  sticker_id?: string;
}

export function useServerStickers(serverIds: string[]) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-stickers', [...serverIds].sort().join(',')],
    enabled: serverIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('server_stickers').select('id, server_id, name, description, url').in('server_id', serverIds).order('created_at');
      if (error) throw new Error(error.message);
      return data as ServerSticker[];
    },
  });
}

export function stickerAttachment(s: ServerSticker): StickerAttachment {
  const ext = s.url.split('?')[0]!.split('.').pop()?.toLowerCase();
  const type = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
  return { url: s.url, name: `${s.name}.${ext ?? 'png'}`, size: 0, content_type: type, sticker: true, sticker_id: s.id, alt: s.name };
}

/** A sent sticker in chat: large, no frame. */
export function StickerView({ a }: { a: StickerAttachment }) {
  return <img src={a.url} alt={a.alt ?? a.name} title={a.alt ?? a.name} loading="lazy" draggable={false} className="h-40 w-40 object-contain" />;
}

/** The Stickers tab of the expressions menu. */
export function StickerPanel({ onPick }: { onPick: (s: ServerSticker) => void }) {
  const me = useMeId();
  const { data: servers = [] } = useServers(me);
  const { data: stickers = [], isLoading } = useServerStickers(servers.map((s) => s.id));
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? stickers.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)) : stickers;
    return servers.map((sv) => ({ server: sv, items: list.filter((s) => s.server_id === sv.id) })).filter((g) => g.items.length);
  }, [stickers, servers, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ae-border p-2">
        <input className="ae-input w-full" placeholder="Search stickers" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && <p className="p-4 text-center text-sm text-ae-muted">Loading…</p>}
        {!isLoading && groups.length === 0 && (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-ae-muted">
            <div>
              <StickerIcon size={32} className="mx-auto mb-2 opacity-60" />
              {stickers.length ? 'No stickers match.' : 'None of your servers have stickers yet. Server admins add them in Server Settings → Stickers.'}
            </div>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.server.id} className="mb-2">
            <p className="sticky top-0 bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] px-1 py-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{g.server.name}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {g.items.map((s) => (
                <button key={s.id} type="button" title={s.description || s.name} onClick={() => onPick(s)} className="ae-press grid aspect-square place-items-center rounded-ae p-1.5 hover:bg-ae-hover">
                  <img src={s.url} alt={s.name} loading="lazy" className="max-h-full max-w-full object-contain" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Server Settings → Stickers. */
export function StickerTab({ server, canManage }: { server: Server; canManage: boolean }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data: stickers = [] } = useServerStickers([server.id]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['server-stickers'] });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of [...files].slice(0, 20)) {
      if (!/^image\/(png|apng|gif|webp)$/.test(file.type)) {
        toast.error(`${file.name}: use PNG, APNG, GIF or WebP.`);
        continue;
      }
      if (file.size > 512 * 1024) {
        toast.error(`${file.name} is over 512 KB.`);
        continue;
      }
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 30) || 'Sticker';
      const ext = file.type === 'image/apng' ? 'png' : file.type.split('/')[1];
      const path = `${server.id}/stickers/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('emojis').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
      if (up.error) {
        toast.error(up.error.message);
        continue;
      }
      const url = sb.storage.from('emojis').getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from('server_stickers').insert({ server_id: server.id, name: name.length >= 2 ? name : 'Sticker', url });
      if (error) toast.error(error.message);
    }
    setBusy(false);
    refresh();
  };
  const rename = async (s: ServerSticker) => {
    const next = await promptText('Sticker name', { title: 'Rename sticker', initial: s.name, maxLength: 30 });
    if (!next || next.trim().length < 2) return;
    const { error } = await sb.from('server_stickers').update({ name: next.trim() }).eq('id', s.id);
    if (error) toast.error(error.message);
    refresh();
  };
  const remove = async (id: string) => {
    await sb.from('server_stickers').delete().eq('id', id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold">Stickers ({stickers.length}/60)</h3>
        <p className="mt-1 text-sm text-ae-muted">Members send them from the sticker button in the message box, in any chat. PNG, APNG, GIF or WebP up to 512 KB; square images around 320×320 look best.</p>
      </div>
      {canManage ? (
        <>
          <input ref={fileRef} type="file" multiple accept="image/png,image/apng,image/gif,image/webp" className="hidden" onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ''))} />
          <button type="button" disabled={busy || stickers.length >= 60} onClick={() => fileRef.current?.click()} className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            {busy ? 'Uploading…' : 'Upload stickers'}
          </button>
        </>
      ) : (
        <p className="text-sm text-ae-muted">You need Manage Expressions to add stickers.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stickers.map((s) => (
          <div key={s.id} className="group rounded-ae border border-ae-border bg-ae-surface/20 p-2">
            <img src={s.url} alt="" className="mx-auto h-24 w-24 object-contain" />
            <p className="mt-1 truncate text-center text-sm font-semibold">{s.name}</p>
            {canManage && (
              <div className="mt-1 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" className="rounded px-1.5 text-xs text-ae-muted hover:text-ae-text" onClick={() => void rename(s)}>
                  Rename
                </button>
                <button type="button" className="rounded px-1.5 text-xs text-ae-muted hover:text-ae-danger" onClick={() => void remove(s.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
