/**
 * Search everything: Ctrl+K (or the search button in the title bar) jumps to a friend, DM, server
 * or channel, and finds people across aether.chat to message.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { unwrap, useProfile } from '../hooks/useChatData';
import { useConversationActions, useConversations, useFriendships } from '../hooks/useSocialData';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { ChannelIcon } from './ChannelSidebar';
import { useConversationTitle, ConversationAvatar } from './ConversationBits';
import { SearchIcon, UserPlusIcon } from './icons';
import { Avatar } from './ProfileCard';
import { toast } from './Toaster';

const useSwitcher = create<{ open: boolean; set: (o: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));
export const openQuickSwitcher = () => useSwitcher.getState().set(true);

export function QuickSwitcherButton() {
  return (
    <button
      type="button"
      onClick={openQuickSwitcher}
      className="flex h-6 w-56 items-center gap-2 rounded-md bg-ae-bg/60 px-2 text-[11px] text-ae-muted transition-colors hover:bg-ae-hover hover:text-ae-text"
    >
      <SearchIcon size={13} />
      <span className="flex-1 text-left">Find or start a conversation</span>
      <kbd className="rounded bg-ae-surface px-1 font-sans text-[10px]">Ctrl K</kbd>
    </button>
  );
}

interface Item {
  key: string;
  kind: 'friend' | 'dm' | 'server' | 'channel' | 'person';
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

function FriendLabel({ id }: { id: string }) {
  const { data: p } = useProfile(id);
  return <>{p?.display_name || p?.username || '…'}</>;
}

function ConvTitle({ conv, me }: { conv: Parameters<typeof useConversationTitle>[0]; me: string }) {
  return <>{useConversationTitle(conv, me)}</>;
}

interface PersonHit {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_frame: string | null;
  accent_color: string | null;
  is_friend: boolean;
  mutual_servers: number;
}

export function QuickSwitcher({ userId, servers }: { userId: string; servers: Server[] }) {
  const open = useSwitcher((s) => s.open);
  const setOpen = useSwitcher((s) => s.set);
  const sb = useSupabase();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: conversations = [] } = useConversations();
  const { data: friendships = [] } = useFriendships();
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const selectServer = useUiStore((s) => s.selectServer);
  const selectChannel = useUiStore((s) => s.selectChannel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useSwitcher.getState().open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const term = q.trim().toLowerCase();
  const people = useQuery({
    queryKey: ['search-users', term],
    enabled: open && term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => unwrap(await sb.rpc('search_users', { p_query: term, p_limit: 8 })) as PersonHit[],
  });

  const items: Item[] = useMemo(() => {
    const close = () => setOpen(false);
    const match = (s: string | null | undefined) => !term || (s ?? '').toLowerCase().includes(term);
    const out: Item[] = [];
    const friendIds = friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
    for (const id of friendIds) {
      const p = qc.getQueryData<{ username: string; display_name: string | null }>(['profile', id]);
      if (!match(p?.username) && !match(p?.display_name)) continue;
      out.push({
        key: `f${id}`,
        kind: 'friend',
        label: p?.display_name || p?.username || 'Friend',
        hint: 'Friend',
        icon: <FriendAvatar id={id} />,
        run: () => convo.openDm.mutate(id, { onSuccess: (cid) => (openHome(cid), close()), onError: (e) => toast.error(e.message) }),
      });
    }
    for (const c of conversations.slice(0, 40)) {
      if (c.type !== 'group') continue;
      if (!match(c.name)) continue;
      out.push({ key: `c${c.id}`, kind: 'dm', label: c.name ?? 'Group', hint: 'Group', icon: <ConversationAvatar conv={c} me={userId} size={24} />, run: () => (openHome(c.id), close()) });
    }
    for (const s of servers) {
      if (!match(s.name)) continue;
      out.push({
        key: `s${s.id}`,
        kind: 'server',
        label: s.name,
        hint: 'Server',
        icon: <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-md bg-ae-surface text-[10px] font-bold">{s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2)}</span>,
        run: () => (selectServer(s.id), close()),
      });
      const chans = qc.getQueryData<Channel[]>(['channels', s.id]) ?? [];
      for (const ch of chans) {
        if (ch.type === 'category' || !term || !match(ch.name)) continue;
        out.push({ key: `ch${ch.id}`, kind: 'channel', label: ch.name, hint: s.name, icon: <ChannelIcon channel={ch} size={16} />, run: () => (selectServer(s.id), selectChannel(s.id, ch.id), close()) });
      }
    }
    for (const h of people.data ?? []) {
      if (friendIds.includes(h.id)) continue;
      out.push({
        key: `p${h.id}`,
        kind: 'person',
        label: h.display_name || h.username,
        hint: `@${h.username}${h.mutual_servers ? ` · ${h.mutual_servers} mutual server${h.mutual_servers === 1 ? '' : 's'}` : ''}`,
        icon: <Avatar profile={{ username: h.username, display_name: h.display_name, avatar_url: h.avatar_url, avatar_frame: null, accent_color: h.accent_color }} size={24} showFrame={false} />,
        run: () =>
          convo.openDm.mutate(h.id, {
            onSuccess: (cid) => {
              openHome(cid);
              close();
            },
            onError: (e) => toast.error(e.message),
          }),
      });
    }
    return out.slice(0, 30);
  }, [conversations, convo.openDm, friendships, openHome, people.data, qc, selectChannel, selectServer, servers, setOpen, term, userId]);

  useEffect(() => setSel(0), [term]);
  if (!open) return null;

  const groups: { title: string; kinds: Item['kind'][] }[] = [
    { title: 'Friends', kinds: ['friend'] },
    { title: 'Groups', kinds: ['dm'] },
    { title: 'Servers', kinds: ['server'] },
    { title: 'Channels', kinds: ['channel'] },
    { title: 'People on aether.chat', kinds: ['person'] },
  ];
  let idx = -1;

  return (
    <div className="ae-backdrop fixed inset-0 z-[80] flex justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div className="ae-dialog flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-elevated shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-ae-border px-4">
          <SearchIcon size={18} className="text-ae-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
              if (e.key === 'Enter') items[sel]?.run();
            }}
            placeholder="Where would you like to go? Friends, servers, channels, people…"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-ae-muted"
            style={{ boxShadow: 'none' }}
          />
        </div>
        <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ae-muted">
              {term.length < 2 ? 'Type to search your friends, servers and channels, or anyone on aether.chat.' : people.isFetching ? 'Searching…' : 'No results.'}
            </p>
          )}
          {groups.map((g) => {
            const list = items.filter((i) => g.kinds.includes(i.kind));
            if (!list.length) return null;
            return (
              <div key={g.title} className="mb-1">
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-wide text-ae-muted uppercase">{g.title}</p>
                {list.map((it) => {
                  idx = items.indexOf(it);
                  const active = idx === sel;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onMouseEnter={() => setSel(items.indexOf(it))}
                      onClick={it.run}
                      className={`flex w-full items-center gap-3 rounded-ae px-3 py-2 text-left ${active ? 'bg-ae-accent/15 text-ae-text' : 'text-ae-text'}`}
                    >
                      <span className="grid w-6 place-items-center text-ae-muted">{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {it.kind === 'friend' ? <FriendLabel id={it.key.slice(1)} /> : it.label}
                      </span>
                      {it.hint && <span className="truncate text-xs text-ae-muted">{it.hint}</span>}
                      {it.kind === 'person' && <UserPlusIcon size={14} className="text-ae-muted" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <footer className="flex gap-4 border-t border-ae-border px-4 py-2 text-[11px] text-ae-muted">
          <span>↑↓ to navigate</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </footer>
      </div>
    </div>
  );
}

function FriendAvatar({ id }: { id: string }) {
  const { data: p } = useProfile(id);
  return <Avatar profile={p} size={24} showFrame={false} />;
}

export { ConvTitle };
