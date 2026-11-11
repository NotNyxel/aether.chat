/**
 * Threads UI: the side panel that shows a thread or forum post, the "Create thread" dialog, and
 * the 🧵 thread browser in a channel header (active and archived threads).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useServerMembers } from '../hooks/useChatData';
import { isArchived, useChannelById, useChannelPermissions, useMyThreadMemberships, useThreadActions, useThreads } from '../hooks/useThreads';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { Dialog } from './Dialog';
import { CloseIcon } from './icons';
import { MessagePane } from './MessagePane';
import { inputCls, Toggle } from './SettingsPanel';

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function TagPill({ tag, active, onClick }: { tag: { id: string; name: string; emoji?: string | null }; active?: boolean; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
    active ? 'border-ae-accent bg-ae-accent/15 text-ae-text' : 'border-ae-border bg-ae-surface/60 text-ae-muted'
  }`;
  return onClick ? (
    <button type="button" className={`ae-press ${cls} hover:border-ae-accent`} onClick={onClick}>
      {tag.emoji} {tag.name}
    </button>
  ) : (
    <span className={cls}>
      {tag.emoji} {tag.name}
    </span>
  );
}

const ARCHIVE_OPTIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '1 week' },
];

/** Thread / forum post side panel. */
export function ThreadPanel({ threadId, server, userId, channels, wide = false }: {
  threadId: string;
  server: Server;
  userId: string;
  channels: Channel[];
  wide?: boolean;
}) {
  const openThread = useUiStore((s) => s.openThread);
  const { data: thread, isLoading } = useChannelById(threadId);
  const { data: parentPerms = 0n } = useChannelPermissions(thread?.thread_parent_id ?? null);
  const { data: memberships } = useMyThreadMemberships(userId);
  const { data: members = [] } = useServerMembers(server.id);
  const actions = useThreadActions(thread?.thread_parent_id ?? null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const parent = channels.find((c) => c.id === thread?.thread_parent_id);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter((id) => id !== userId), [members, userId]);

  if (!thread) {
    return (
      <aside className={`flex shrink-0 items-center justify-center border-l border-ae-border text-sm text-ae-muted ${wide ? 'w-[min(640px,55%)]' : 'w-[440px]'}`}>
        {isLoading ? 'Loading…' : "This thread doesn't exist anymore, or you can't see it."}
      </aside>
    );
  }

  const manage = server.owner_id === userId || hasPermission(parentPerms, Permission.MANAGE_THREADS);
  const owner = thread.thread_owner_id === userId;
  const joined = memberships?.has(thread.id) ?? false;
  const archived = isArchived(thread);
  const forum = parent?.subtype === 'forum' || parent?.subtype === 'media';
  const tags = (parent?.forum_tags ?? []).filter((t) => thread.thread_tags.includes(t.id));
  const err = actions.update.error ?? actions.remove.error ?? actions.join.error;
  const item = 'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover';

  return (
    <aside className={`ae-enter flex min-w-0 shrink-0 flex-col border-l border-ae-border ${wide ? 'w-[min(640px,55%)]' : 'w-[440px]'}`}>
      <MessagePane
        key={thread.id}
        scope={{ kind: 'channel', id: thread.id }}
        userId={userId}
        serverId={server.id}
        memberIds={memberIds}
        channels={channels}
        placeholder={thread.thread_locked ? 'This thread is locked' : `Message ${forum ? '' : '🧵 '}${thread.name}`}
        header={
          <div className="relative flex min-w-0 flex-1 items-center gap-2">
            <span>{thread.thread_locked ? '🔒' : thread.thread_private ? '🔐' : forum ? '💬' : '🧵'}</span>
            {renaming ? (
              <form
                className="flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  actions.update.mutate({ id: thread.id, name }, { onSuccess: () => setRenaming(false) });
                }}
              >
                <input className={`${inputCls} py-1`} autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
              </form>
            ) : (
              <h2 className="truncate font-semibold" title={thread.name}>
                {thread.name}
              </h2>
            )}
            {archived && <span className="shrink-0 rounded bg-ae-surface px-1.5 text-[10px] text-ae-muted uppercase">archived</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={`ae-press rounded-ae px-2 py-1 text-xs ${joined ? 'bg-ae-surface text-ae-muted' : 'bg-ae-accent text-ae-on-accent'}`}
                title={joined ? 'Stop following: no unread badges for this thread' : 'Follow: get unread badges for new replies'}
                onClick={() => actions.join.mutate({ id: thread.id, join: !joined })}
              >
                {joined ? 'Following' : 'Follow'}
              </button>
              {(manage || owner) && (
                <button type="button" title="Thread options" className="rounded px-1.5 text-ae-muted hover:text-ae-text" onClick={() => setMenu((v) => !v)}>
                  ⋯
                </button>
              )}
              <button type="button" title="Close" className="text-ae-muted hover:text-ae-text" onClick={() => openThread(null)}>
                <CloseIcon size={16} />
              </button>
            </span>
            {menu && (
              <ThreadMenu onClose={() => setMenu(false)}>
                {(!thread.thread_locked || manage) && (
                  <button
                    type="button"
                    className={item}
                    onClick={() => {
                      setName(thread.name);
                      setRenaming(true);
                      setMenu(false);
                    }}
                  >
                    ✎ Rename
                  </button>
                )}
                <button type="button" className={item} onClick={() => actions.update.mutate({ id: thread.id, archived: !archived })}>
                  {archived ? '📂 Reopen' : '🗄 Archive'}
                </button>
                {manage && (
                  <button type="button" className={item} onClick={() => actions.update.mutate({ id: thread.id, locked: !thread.thread_locked })}>
                    {thread.thread_locked ? '🔓 Unlock' : '🔒 Lock (only moderators can reply)'}
                  </button>
                )}
                <p className="px-2 pt-1 text-[10px] font-bold tracking-wide text-ae-muted uppercase">Auto-archive after inactivity</p>
                {ARCHIVE_OPTIONS.map((o) => (
                  <button
                    key={o.minutes}
                    type="button"
                    className={`${item} ${thread.thread_auto_archive === o.minutes ? 'text-ae-accent' : ''}`}
                    onClick={() => actions.update.mutate({ id: thread.id, autoArchive: o.minutes })}
                  >
                    {thread.thread_auto_archive === o.minutes ? '● ' : '○ '}
                    {o.label}
                  </button>
                ))}
                <div className="my-1 h-px bg-ae-border" />
                <button
                  type="button"
                  className={`${item} text-ae-danger`}
                  onClick={() => {
                    if (!window.confirm(`Delete “${thread.name}” and all of its messages?`)) return;
                    actions.remove.mutate(thread.id, { onSuccess: () => openThread(null) });
                  }}
                >
                  🗑 Delete {forum ? 'post' : 'thread'}
                </button>
              </ThreadMenu>
            )}
          </div>
        }
        top={
          tags.length > 0 || err ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-ae-border px-4 py-1.5">
              {tags.map((t) => (
                <TagPill key={t.id} tag={t} />
              ))}
              {err && <span className="text-xs text-ae-danger">{err.message}</span>}
            </div>
          ) : undefined
        }
        emptyState={
          <div>
            <h2 className="text-xl font-bold">{thread.name}</h2>
            <p className="text-sm text-ae-muted">
              {forum ? 'Be the first to reply.' : `Started in #${parent?.name ?? 'channel'}${thread.thread_private ? ' (private: only people added can see it)' : ''}.`}
            </p>
          </div>
        }
      />
    </aside>
  );
}

function ThreadMenu({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  return (
    <div ref={ref} className="ae-pop absolute top-full right-0 z-40 mt-2 w-60 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
      {children}
    </div>
  );
}

/** "Create thread" dialog, driven by uiStore.threadDraft. */
export function CreateThreadDialog() {
  const draft = useUiStore((s) => s.threadDraft);
  const close = useUiStore((s) => s.openThreadDraft);
  const openThread = useUiStore((s) => s.openThread);
  const { data: perms = 0n } = useChannelPermissions(draft?.parentId ?? null);
  const actions = useThreadActions(draft?.parentId ?? null);
  const [name, setName] = useState('');
  const [priv, setPriv] = useState(false);
  const [archive, setArchive] = useState(1440);
  useEffect(() => {
    setName('');
    setPriv(false);
  }, [draft?.parentId, draft?.messageId]);
  if (!draft) return null;
  const canPrivate = !draft.messageId && hasPermission(perms, Permission.CREATE_PRIVATE_THREADS);

  return (
    <Dialog title={draft.messageId ? 'Create thread from message' : 'Create thread'} onClose={() => close(null)}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          actions.create.mutate(
            { parentId: draft.parentId, name, messageId: draft.messageId, private: priv && canPrivate, autoArchive: archive },
            {
              onSuccess: (t) => {
                close(null);
                openThread(t.id);
              },
            },
          );
        }}
      >
        <label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Thread name</span>
          <input
            className={inputCls}
            autoFocus
            maxLength={100}
            placeholder={draft.messageId ? 'Leave empty to use the message text' : 'What’s it about?'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {canPrivate && (
          <Toggle label="Private thread" hint="Only people you add (and moderators) can see it." checked={priv} onChange={setPriv} />
        )}
        <label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Archive after inactivity</span>
          <select className={inputCls} value={archive} onChange={(e) => setArchive(Number(e.target.value))}>
            {ARCHIVE_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {actions.create.error && <p className="text-xs text-ae-danger">{actions.create.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={() => close(null)}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={actions.create.isPending || (!draft.messageId && !name.trim())}
            className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
          >
            Create thread
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** 🧵 button in a text channel header: lists active and archived threads. */
export function ThreadsButton({ channel, userId }: { channel: Channel; userId: string }) {
  const [open, setOpen] = useState(false);
  const { data: threads = [] } = useThreads(channel.id);
  const { data: perms = 0n } = useChannelPermissions(channel.id);
  const { data: memberships } = useMyThreadMemberships(userId);
  const openThread = useUiStore((s) => s.openThread);
  const openThreadDraft = useUiStore((s) => s.openThreadDraft);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const active = threads.filter((t) => !isArchived(t));
  const archived = threads.filter((t) => isArchived(t));
  const canCreate = hasPermission(perms, Permission.CREATE_PUBLIC_THREADS) || hasPermission(perms, Permission.CREATE_PRIVATE_THREADS);

  const row = (t: Channel) => (
    <li key={t.id}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover"
        onClick={() => {
          openThread(t.id);
          setOpen(false);
        }}
      >
        <span>{t.thread_locked ? '🔒' : t.thread_private ? '🔐' : '🧵'}</span>
        <span className="min-w-0 flex-1 truncate">{t.name}</span>
        {memberships?.has(t.id) && <span className="text-[10px] text-ae-accent">following</span>}
        <span className="shrink-0 text-xs text-ae-muted">
          {t.thread_message_count} · {timeAgo(t.last_message_at)}
        </span>
      </button>
    </li>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Threads"
        className={`relative grid h-7 w-7 place-items-center rounded-ae text-base ${open ? 'bg-ae-hover' : 'opacity-70 hover:opacity-100'}`}
        onClick={() => setOpen((v) => !v)}
      >
        🧵
        {active.length > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-ae-accent px-1 text-[9px] font-bold text-ae-on-accent">{active.length}</span>}
      </button>
      {open && (
        <div className="ae-pop absolute top-full right-0 z-40 mt-2 w-80 rounded-ae border border-ae-border bg-ae-elevated p-2 shadow-2xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <p className="text-xs font-bold tracking-wide text-ae-muted uppercase">Threads</p>
            {canCreate && (
              <button
                type="button"
                className="ae-press rounded-ae bg-ae-accent px-2 py-1 text-xs font-semibold text-ae-on-accent"
                onClick={() => {
                  openThreadDraft({ parentId: channel.id, messageId: null });
                  setOpen(false);
                }}
              >
                + New
              </button>
            )}
          </div>
          {threads.length === 0 && <p className="px-2 py-4 text-center text-sm text-ae-muted">No threads yet. Hover a message and click 🧵 to start one.</p>}
          <ul className="ae-scroll max-h-80 overflow-y-auto">
            {active.map(row)}
            {archived.length > 0 && <li className="px-2 pt-2 text-[10px] font-bold tracking-wide text-ae-muted uppercase">Archived — {archived.length}</li>}
            {archived.slice(0, 30).map(row)}
          </ul>
        </div>
      )}
    </div>
  );
}
