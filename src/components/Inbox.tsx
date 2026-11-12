/**
 * Inbox: recent messages that mention you (direct, role, @everyone) and every channel or
 * conversation with unread messages. Opened from the tray icon in the server rail.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { unwrap, useProfile } from '../hooks/useChatData';
import { isRowUnread, useMarkRead, useUnreadSummary } from '../hooks/useMessageExtras';
import { useNotifyResolver } from '../hooks/useNotifications';
import { useConversations } from '../hooks/useSocialData';
import { Markdown } from '../lib/markdown';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Conversation, Message, Server, UnreadRow } from '../types/db';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { CheckIcon, CloseIcon, HashIcon, InboxIcon, SparklesIcon } from './icons';
import { Avatar } from './ProfileCard';

type ChannelInfo = Pick<Channel, 'id' | 'name' | 'server_id'>;

/** Names for channels in any server (only the ones we need). */
function useChannelNames(ids: string[]) {
  const sb = useSupabase();
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['channel-names', key],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await sb.from('channels').select('id, name, server_id').in('id', ids)) as ChannelInfo[],
  });
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ConversationLabel({ conv, me }: { conv: Conversation; me: string }) {
  const title = useConversationTitle(conv, me);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ConversationAvatar conv={conv} me={me} size={20} />
      <span className="truncate">{title}</span>
    </span>
  );
}

function MentionRow({ m, where, onOpen }: { m: Message; where: React.ReactNode; onOpen: () => void }) {
  const { data: author } = useProfile(m.author_id);
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full rounded-ae border border-ae-border bg-ae-surface/40 p-2.5 text-left hover:bg-ae-hover">
        <div className="mb-1 flex items-center gap-2 text-xs text-ae-muted">
          {where}
          <span className="ml-auto shrink-0">{relTime(m.created_at)}</span>
        </div>
        <div className="flex gap-2">
          <Avatar profile={author} size={28} showFrame={false} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{author?.display_name || author?.username || '…'}</p>
            <div className="line-clamp-4 text-sm">
              <Markdown source={m.content || (m.attachments?.length ? '*Attachment*' : m.poll ? `*Poll:* ${m.poll.question}` : '')} />
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

export function InboxButton({ userId, servers }: { userId: string; servers: Server[] }) {
  const [open, setOpen] = useState(false);
  const { data: unread = [] } = useUnreadSummary();
  const mentions = unread.reduce((n, r) => n + r.mention_count, 0);
  return (
    <>
      <button
        type="button"
        data-inbox-toggle
        data-tip="Inbox"
        data-tip-side="bottom"
        aria-label="Inbox"
        onClick={() => setOpen((v) => !v)}
        className={`relative grid h-7 w-8 place-items-center rounded-md transition-colors ${open ? 'bg-ae-hover text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
      >
        <InboxIcon size={17} />
        {mentions > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-ae-danger px-1 text-center text-[10px] leading-4 font-bold text-white">
            {mentions > 99 ? '99+' : mentions}
          </span>
        )}
      </button>
      {open && <InboxPanel userId={userId} servers={servers} onClose={() => setOpen(false)} />}
    </>
  );
}

function InboxPanel({ userId, servers, onClose }: { userId: string; servers: Server[]; onClose: () => void }) {
  const sb = useSupabase();
  const [tab, setTab] = useState<'mentions' | 'unreads'>('mentions');
  const goTo = useUiStore((s) => s.goTo);
  const markRead = useMarkRead();
  const { data: unread = [] } = useUnreadSummary();
  const { data: conversations = [] } = useConversations();
  const { resolve } = useNotifyResolver();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-inbox-toggle]')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const mentionsQ = useQuery({
    queryKey: ['inbox-mentions'],
    staleTime: 0,
    queryFn: async () => unwrap(await sb.rpc('recent_mentions', { p_before: null, p_limit: 50 })) as Message[],
  });

  const unreadRows = useMemo(
    () =>
      unread
        .filter((r) => isRowUnread(r) && !resolve(r.server_id ? { kind: 'channel', id: r.scope_id, serverId: r.server_id } : { kind: 'conversation', id: r.scope_id }).muted)
        .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')),
    [unread, resolve],
  );
  const channelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of mentionsQ.data ?? []) if (m.channel_id) ids.add(m.channel_id);
    for (const r of unreadRows) if (r.server_id) ids.add(r.scope_id);
    return [...ids];
  }, [mentionsQ.data, unreadRows]);
  const { data: channelInfo = [] } = useChannelNames(channelIds);
  const channelById = useMemo(() => new Map(channelInfo.map((c) => [c.id, c])), [channelInfo]);
  const serverById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);

  const whereLabel = (scope: { channelId?: string | null; conversationId?: string | null }) => {
    if (scope.conversationId) {
      const conv = convById.get(scope.conversationId);
      return conv ? <ConversationLabel conv={conv} me={userId} /> : <span>Direct message</span>;
    }
    const ch = scope.channelId ? channelById.get(scope.channelId) : undefined;
    const server = ch ? serverById.get(ch.server_id) : undefined;
    return (
      <span className="flex min-w-0 items-center gap-1">
        <HashIcon size={13} />
        <span className="truncate font-semibold text-ae-text">{ch?.name ?? 'channel'}</span>
        {server && <span className="truncate">· {server.name}</span>}
      </span>
    );
  };

  const open = (target: { serverId: string | null; scopeId: string; messageId?: string }) => {
    goTo(target);
    onClose();
  };

  const tabBtn = (id: typeof tab, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-ae px-3 py-1 text-sm ${tab === id ? 'bg-ae-surface font-semibold text-ae-text' : 'text-ae-muted hover:text-ae-text'}`}
    >
      {label}
      {!!count && <span className="ml-1.5 rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{count > 99 ? '99+' : count}</span>}
    </button>
  );

  return (
    <div
      ref={ref}
      className="ae-pop fixed top-10 right-3 z-[75] flex max-h-[min(640px,calc(100vh-56px))] w-[440px] flex-col rounded-ae border border-ae-border bg-ae-elevated shadow-2xl"
      role="dialog"
      aria-label="Inbox"
    >
      <header className="flex items-center gap-2 border-b border-ae-border p-3">
        <InboxIcon size={18} />
        <h2 className="mr-2 font-bold">Inbox</h2>
        {tabBtn('mentions', 'Mentions')}
        {tabBtn('unreads', 'Unreads', unreadRows.length)}
        <button type="button" title="Close" className="ml-auto text-ae-muted hover:text-ae-text" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'mentions' ? (
          mentionsQ.isLoading ? (
            <p className="p-6 text-center text-sm text-ae-muted">Loading…</p>
          ) : mentionsQ.isError ? (
            <p className="p-6 text-center text-sm text-ae-danger">{mentionsQ.error.message}</p>
          ) : (mentionsQ.data ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-ae-muted">
              <p className="mb-2 text-3xl"><InboxIcon size={15} className="ae-ico" /></p>
              Nobody has mentioned you yet. When someone @mentions you or one of your roles, it shows up here.
            </div>
          ) : (
            <ul className="space-y-2">
              {mentionsQ.data!.map((m) => (
                <MentionRow
                  key={m.id}
                  m={m}
                  where={whereLabel({ channelId: m.channel_id, conversationId: m.conversation_id })}
                  onOpen={() =>
                    open({
                      serverId: m.channel_id ? (channelById.get(m.channel_id)?.server_id ?? null) : null,
                      scopeId: (m.channel_id ?? m.conversation_id)!,
                      messageId: m.id,
                    })
                  }
                />
              ))}
            </ul>
          )
        ) : unreadRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-ae-muted">
            <p className="mb-2 text-3xl"><SparklesIcon size={15} className="ae-ico" /></p>
            You&apos;re all caught up.
          </div>
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="rounded-ae bg-ae-surface px-3 py-1 text-xs hover:bg-ae-hover"
                onClick={() => unreadRows.forEach((r) => markRead({ kind: r.server_id ? 'channel' : 'conversation', id: r.scope_id }))}
              >
                Mark all as read
              </button>
            </div>
            <ul className="space-y-1">
              {unreadRows.map((r: UnreadRow) => (
                <li key={r.scope_id} className="group flex items-center gap-2 rounded-ae px-2 py-2 hover:bg-ae-hover">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    onClick={() => open({ serverId: r.server_id, scopeId: r.scope_id })}
                  >
                    {whereLabel(r.server_id ? { channelId: r.scope_id } : { conversationId: r.scope_id })}
                    {r.last_message_at && <span className="ml-auto shrink-0 text-xs text-ae-muted">{relTime(r.last_message_at)}</span>}
                  </button>
                  {r.mention_count > 0 && <span className="rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{r.mention_count}</span>}
                  <button
                    type="button"
                    title="Mark as read"
                    className="rounded px-1.5 text-xs text-ae-muted opacity-0 group-hover:opacity-100 hover:text-ae-text"
                    onClick={() => markRead({ kind: r.server_id ? 'channel' : 'conversation', id: r.scope_id })}
                  >
                    <CheckIcon size={15} className="ae-ico" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
