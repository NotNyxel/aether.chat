/**
 * Chat view shared by server text channels and DMs / group DMs.
 * History with grouping and a "new messages" divider, jump-to-message (from replies, links,
 * pins and search), jump to present, auto mark-as-read, pins and search panels, drag-and-drop
 * uploads, typing indicator and the composer.
 */
import { ArrowDownIcon, LockIcon, MegaphoneIcon, PinIcon } from './icons';
import { ask } from './ConfirmDialog';
import { messageRenderKey, useServerMembers, useServers } from '../hooks/useChatData';
import { NotificationBell } from './NotificationMenu';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  useDeleteMessage,
  useEditMessage,
  useMessages,
  useProfile,
  useReactions,
  useServerPermissions,
  useToggleReaction,
} from '../hooks/useChatData';
import { useMarkRead, usePollVotes, useTogglePin, useUnreadSummary, useVotePoll } from '../hooks/useMessageExtras';
import { useMemberStyles, useMyMembership, useServerRoles } from '../hooks/useServerAdmin';
import { useTyping } from '../hooks/useTyping';
import { useChannelById, useChannelPermissions } from '../hooks/useThreads';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Message, MessageScope, PollVote } from '../types/db';
import { Composer } from './Composer';
import { DisplayName, MessageItem } from './MessageItem';
import { PinsPanel, SearchPanel } from './MessagePanels';
import { MobileBack } from './MobileNav';

const GROUP_WINDOW_MS = 5 * 60_000;

function TypingLine({ typers }: { typers: string[] }) {
  if (typers.length === 0) return <div className="h-5" />;
  const names = typers.slice(0, 3).map((id, i) => (
    <span key={id}>
      {i > 0 && (i === typers.length - 1 ? ' and ' : ', ')}
      <strong>
        <DisplayName userId={id} />
      </strong>
    </span>
  ));
  return (
    <div className="flex h-5 items-center gap-1 px-5 text-xs text-ae-muted">
      <span className="ae-typing" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {typers.length > 3 ? 'Several people are typing…' : <span>{names} {typers.length === 1 ? 'is' : 'are'} typing…</span>}
    </div>
  );
}

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

interface MessagePaneProps {
  scope: MessageScope;
  userId: string;
  /** Server id for channels (permissions, links, search); null for DMs. */
  serverId: string | null;
  /** Header content (channel name, DM name, call buttons…). Pins/search buttons are appended. */
  header: ReactNode;
  placeholder: string;
  emptyState: ReactNode;
  /** Ids available for @mention autocomplete. */
  memberIds: string[];
  /** Server channels (for #channel autocomplete and server-wide search). */
  channels?: Channel[];
  /** Content above the history, e.g. an in-progress call panel. */
  top?: ReactNode;
  /** Right-hand panel when neither pins nor search is open, e.g. the member list. */
  aside?: ReactNode;
  /** Phones: what the back arrow does (default: back to the list). */
  onBack?: () => void;
}

export function MessagePane({ scope, userId, serverId, header, placeholder, emptyState, memberIds, channels = [], top, aside, onBack }: MessagePaneProps) {
  const qc = useQueryClient();
  const messages = useMessages(scope);
  const reactionsQ = useReactions(scope);
  const votesQ = usePollVotes(scope);
  const edit = useEditMessage(scope);
  const del = useDeleteMessage(scope);
  const react = useToggleReaction(scope, userId);
  const pin = useTogglePin(scope);
  const vote = useVotePoll(scope, userId);
  const markRead = useMarkRead();
  const { data: unread } = useUnreadSummary();
  const { data: me } = useProfile(userId);
  const { data: perms = 0n } = useServerPermissions(serverId);
  const { data: myServers = [] } = useServers(userId);
  const botOn = !!serverId && scope.kind === 'channel' && !!myServers.find((s) => s.id === serverId)?.bot_enabled;
  const { typers, notifyTyping, notifyStopped } = useTyping(scope.id, userId);
  const jumpTarget = useUiStore((s) => s.jumpTarget);
  const clearJump = useUiStore((s) => s.clearJump);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'pins' | 'search' | null>(null);
  const [searchSeed, setSearchSeed] = useState('');
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const styles = useMemberStyles(serverId);
  const { data: serverMembers = [] } = useServerMembers(serverId);
  const memberById = useMemo(() => new Map(serverMembers.map((m) => [m.user_id, m])), [serverMembers]);
  const { data: roles = [] } = useServerRoles(serverId);
  const { data: membership } = useMyMembership(serverId, userId);
  const myRoleIds = useMemo(() => new Set(styles.get(userId)?.roleIds ?? []), [styles, userId]);
  const timedOutUntil = membership?.timed_out_until && new Date(membership.timed_out_until) > new Date() ? membership.timed_out_until : null;
  const slowmode = channels.find((c) => c.id === scope.id)?.rate_limit_seconds ?? 0;
  // Channel-level permissions (overwrites, thread and announcement rules), for server channels.
  const { data: channel } = useChannelById(scope.kind === 'channel' ? scope.id : null);
  const { data: chPerms } = useChannelPermissions(scope.kind === 'channel' ? scope.id : null);
  const isThread = !!channel?.thread_parent_id;
  const canManageMessages = serverId ? hasPermission(chPerms ?? perms, Permission.MANAGE_MESSAGES) : false;
  const canThread =
    !!channel && !isThread && channel.type === 'text' && channel.subtype !== 'forum' && channel.subtype !== 'media' &&
    hasPermission(chPerms ?? 0n, Permission.CREATE_PUBLIC_THREADS);
  const isAnnouncement = channel?.subtype === 'announcement';
  const canSend = scope.kind !== 'channel' || chPerms === undefined || hasPermission(chPerms, Permission.SEND_MESSAGES);
  const canPin = serverId ? canManageMessages : true;
  const canMentionEveryone = !!serverId && hasPermission(perms, Permission.MENTION_EVERYONE);

  // Newest-first list, rendered inside flex-col-reverse so the view stays pinned to the bottom.
  const list = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data]);
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    for (const r of reactionsQ.data ?? []) {
      const perMsg = map.get(r.message_id) ?? new Map<string, string[]>();
      perMsg.set(r.emoji, [...(perMsg.get(r.emoji) ?? []), r.user_id]);
      map.set(r.message_id, perMsg);
    }
    return map;
  }, [reactionsQ.data]);
  const votesByMessage = useMemo(() => {
    const map = new Map<string, PollVote[]>();
    for (const v of votesQ.data ?? []) map.set(v.message_id, [...(map.get(v.message_id) ?? []), v]);
    return map;
  }, [votesQ.data]);

  // ── "New messages" divider: remember where you'd read up to when the chat opened ─────────────
  const [lastReadAtOpen, setLastReadAtOpen] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastReadAtOpen !== undefined || !unread) return;
    const row = unread.find((r) => r.scope_id === scope.id);
    setLastReadAtOpen(row && row.last_message_at && row.last_read_at && row.last_message_at > row.last_read_at ? row.last_read_at : null);
  }, [unread, scope.id, lastReadAtOpen]);
  const dividerBeforeId = useMemo(() => {
    if (!lastReadAtOpen) return null;
    const t = new Date(lastReadAtOpen).getTime();
    let candidate: string | null = null;
    for (const m of list) {
      if (new Date(m.created_at).getTime() <= t) break;
      if (m.author_id !== userId) candidate = m.id;
    }
    return candidate;
  }, [list, lastReadAtOpen, userId]);

  // ── Mark read when viewing (and again when new messages arrive or the window regains focus) ──
  const newestId = list[0]?.id;
  useEffect(() => {
    const mark = () => {
      if (document.hasFocus()) markRead(scope);
    };
    mark();
    window.addEventListener('focus', mark);
    return () => window.removeEventListener('focus', mark);
  }, [scope, newestId, markRead]);

  // ── Jump to a message (loads older pages until it's found) ──────────────────────────────────
  const { fetchNextPage } = messages;
  useEffect(() => {
    if (!jumpTarget || jumpTarget.scopeId !== scope.id) return;
    let cancelled = false;
    const find = () => document.getElementById(`msg-${jumpTarget.messageId}`);
    const flash = (el: HTMLElement) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('ae-flash');
      void el.offsetWidth; // restart the animation
      el.classList.add('ae-flash');
    };
    void (async () => {
      for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
        const el = find();
        if (el) {
          flash(el);
          break;
        }
        const loaded = qc.getQueryData<{ pages: Message[][] }>(['messages', scope.id]);
        if (loaded?.pages.flat().some((m) => m.id === jumpTarget.messageId)) {
          await new Promise((r) => setTimeout(r, 60)); // rendered next frame
          continue;
        }
        const res = await fetchNextPage();
        if (!res.hasNextPage && !res.data?.pages.flat().some((m) => m.id === jumpTarget.messageId)) break;
      }
      if (!cancelled) clearJump();
    })();
    return () => {
      cancelled = true;
    };
  }, [jumpTarget, scope.id, fetchNextPage, clearJump, qc]);

  // Pinned to the newest message while you're at the bottom: whatever changes size (new messages,
  // images loading, the typing line, the message box growing) keeps you there.
  const pinned = useRef(true);
  const scrollToBottom = useCallback(() => {
    pinned.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0; // column-reverse: 0 is the bottom
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stick = () => {
      if (pinned.current && el.scrollTop !== 0) el.scrollTop = 0;
    };
    const ro = new ResizeObserver(stick);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // Stable callbacks so memoized rows don't re-render on every keystroke.
  const onReply = useCallback((m: Message) => setReplyTo(m), []);
  const onStartEdit = useCallback((id: string) => setEditingId(id), []);
  const onCancelEdit = useCallback(() => setEditingId(null), []);
  const editMutate = edit.mutate;
  const onSaveEdit = useCallback((id: string, content: string) => editMutate({ id, content }, { onSuccess: () => setEditingId(null) }), [editMutate]);
  const delMutate = del.mutate;
  const onDelete = useCallback(
    async (id: string) => {
      if ((await ask('Delete this message? This cannot be undone.'))) delMutate(id);
    },
    [delMutate],
  );
  const reactMutate = react.mutate;
  const onReact = useCallback((id: string, emoji: string, active: boolean) => reactMutate({ messageId: id, emoji, active }), [reactMutate]);
  const pinMutate = pin.mutate;
  const onTogglePin = useCallback((id: string, pinned: boolean) => pinMutate({ id, pinned }), [pinMutate]);
  const voteMutate = vote.mutate;
  const onVote = useCallback((id: string, optionIds: number[]) => voteMutate({ messageId: id, optionIds }), [voteMutate]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) setDropped(Array.from(e.dataTransfer.files));
  };

  const rightPanel =
    panel === 'pins' ? (
      <PinsPanel scope={scope} serverId={serverId} canPin={canPin} onUnpin={(id) => pin.mutate({ id, pinned: false })} onClose={() => setPanel(null)} />
    ) : panel === 'search' ? (
      <SearchPanel key={searchSeed} scope={scope} serverId={serverId} channels={channels} initial={searchSeed} onClose={() => setPanel(null)} />
    ) : (
      aside
    );

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ae-border px-4 ae-chat-header">
        <MobileBack onClick={onBack} />
        {header}
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <NotificationBell scope={scope} />
          <button
            type="button"
            title="Pinned messages"
            className={`text-lg leading-none ${panel === 'pins' ? '' : 'opacity-60 hover:opacity-100'}`}
            onClick={() => setPanel(panel === 'pins' ? null : 'pins')}
          >
            <PinIcon size={15} className="ae-ico" />
          </button>
          <form
            className="ae-desktop-only"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('q')?.toString().trim() ?? '';
              setSearchSeed(value);
              setPanel('search');
            }}
          >
            <input
              name="q"
              placeholder="Search"
              className="w-36 ae-input text-xs "
            />
          </form>
        </div>
      </header>
      {top}

      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-ae border-2 border-dashed border-ae-accent bg-ae-bg/80 text-lg font-semibold">
              Drop to upload
            </div>
          )}

          <div
            ref={scrollRef}
            className="ae-scroll flex flex-1 flex-col-reverse overflow-y-auto pb-6"
            onScroll={(e) => {
              const top = e.currentTarget.scrollTop ?? 0;
              pinned.current = top > -60;
              setAwayFromBottom(top < -500);
            }}
          >
            <ul className="flex flex-col-reverse">
              {list.map((m, i) => {
                const older = list[i + 1];
                const newDay = !older || dayKey(older.created_at) !== dayKey(m.created_at);
                const grouped =
                  !!older &&
                  !newDay &&
                  older.author_id === m.author_id &&
                  !m.forwarded_from &&
                  new Date(m.created_at).getTime() - new Date(older.created_at).getTime() < GROUP_WINDOW_MS;
                return (
                  <Fragment key={messageRenderKey(m)}>
                    <MessageItem
                      message={m}
                      serverId={serverId}
                      grouped={grouped && dividerBeforeId !== m.id}
                      me={userId}
                      myUsername={me?.username ?? null}
                      replyTarget={m.reply_to_id ? byId.get(m.reply_to_id) : null}
                      reactions={reactionsByMessage.get(m.id)}
                      votes={votesByMessage.get(m.id)}
                      editing={editingId === m.id}
                      canPin={canPin}
                      canThread={canThread}
                      authorNickname={m.author_id ? memberById.get(m.author_id)?.nickname : null}
                      authorAvatar={m.author_id ? memberById.get(m.author_id)?.avatar_url : null}
                      canPublish={isAnnouncement && !m.published_at && (m.author_id === userId || canManageMessages)}
                      authorColor={m.author_id ? styles.get(m.author_id)?.color : null}
                      myRoleIds={myRoleIds}
                      onReply={onReply}
                      onStartEdit={onStartEdit}
                      onSaveEdit={onSaveEdit}
                      onCancelEdit={onCancelEdit}
                      onDelete={onDelete}
                      onReact={onReact}
                      onTogglePin={onTogglePin}
                      onVote={onVote}
                    />
                    {dividerBeforeId === m.id && (
                      <li className="mx-4 my-2 flex items-center gap-2 text-[11px] font-bold text-ae-danger uppercase" aria-label="New messages">
                        <span className="h-px flex-1 bg-ae-danger" />
                        New
                      </li>
                    )}
                    {newDay && (
                      <li className="mx-4 my-3 flex items-center gap-3 text-xs font-semibold text-ae-muted">
                        <span className="h-px flex-1 bg-ae-border" />
                        {new Date(m.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}
                        <span className="h-px flex-1 bg-ae-border" />
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ul>
            <div className="px-4 py-6">
              {messages.hasNextPage ? (
                <button
                  type="button"
                  className="text-sm text-ae-accent hover:underline disabled:opacity-50"
                  disabled={messages.isFetchingNextPage}
                  onClick={() => void messages.fetchNextPage()}
                >
                  {messages.isFetchingNextPage ? 'Loading…' : 'Load older messages'}
                </button>
              ) : messages.isLoading ? (
                <div className="space-y-5 py-2" aria-label="Loading messages">
                  {[0.9, 0.6, 0.75, 0.4, 0.8].map((w, i) => (
                    <div key={i} className="flex gap-3" style={{ opacity: 1 - i * 0.15 }}>
                      <div className="ae-skeleton h-10 w-10 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="ae-skeleton h-3 w-32" />
                        <div className="ae-skeleton h-3" style={{ width: `${w * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : messages.isError ? (
                <p className="text-sm text-ae-danger">{messages.error.message}</p>
              ) : (
                emptyState
              )}
            </div>
          </div>

          {awayFromBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="ae-pop ae-press absolute right-6 bottom-28 z-20 flex items-center gap-1.5 rounded-full bg-ae-accent px-4 py-1.5 text-xs font-semibold text-ae-on-accent shadow-lg"
            >
              Jump to present <ArrowDownIcon size={13} />
            </button>
          )}

          {!canSend ? (
            <p className="ae-enter mx-4 mb-4 rounded-ae border border-ae-border bg-ae-sunken px-4 py-3 text-sm text-ae-muted">
              {channel?.thread_locked
                ? <><LockIcon size={15} className="ae-ico" /> This thread is locked. Only moderators can reply.</>
                : isAnnouncement
                  ? <><MegaphoneIcon size={15} className="ae-ico" /> This is an announcement channel. Only moderators post here, and other servers can follow it.</>
                  : "You don't have permission to send messages here."}
            </p>
          ) : (
          <Composer
            botCommands={botOn}
            scope={scope}
            placeholder={placeholder}
            memberIds={memberIds}
            channels={channels}
            canMentionEveryone={canMentionEveryone}
            roles={roles}
            timedOutUntil={timedOutUntil}
            slowmodeSeconds={serverId && !hasPermission(perms, Permission.MANAGE_MESSAGES) ? slowmode : 0}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onEditLast={() => {
              const last = list.find((m) => m.author_id === userId && !m.poll);
              if (last) setEditingId(last.id);
            }}
            onSent={scrollToBottom}
            onTyping={notifyTyping}
            onStopTyping={notifyStopped}
            droppedFiles={dropped}
            onDroppedHandled={() => setDropped(null)}
          />
          )}
          <TypingLine typers={typers} />
        </div>
        {rightPanel}
      </div>
    </section>
  );
}
