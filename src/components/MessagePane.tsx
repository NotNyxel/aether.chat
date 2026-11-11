/**
 * Chat view shared by server text channels and DM / group DM conversations:
 * live history with author grouping, markdown, @mentions, replies, inline editing, reactions,
 * attachments (button, paste or drag-and-drop) and typing indicators.
 */
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  useDeleteMessage,
  useEditMessage,
  useMessages,
  useProfile,
  useReactions,
  useSendMessage,
  useToggleReaction,
  useUploadAttachment,
} from '../hooks/useChatData';
import { useTyping } from '../hooks/useTyping';
import { Markdown } from '../lib/markdown';
import { useUiStore } from '../stores/uiStore';
import type { Attachment, Message, MessageScope } from '../types/db';
import { CloseIcon, PlusIcon, TrashIcon } from './icons';
import { Avatar } from './ProfileCard';

const GROUP_WINDOW_MS = 5 * 60_000;
const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '✅', '💯', '🙏', '😎'];

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} ${time}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DisplayName({ userId }: { userId: string | null }) {
  const { data } = useProfile(userId);
  return <>{data?.display_name || data?.username || 'Unknown'}</>;
}

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
    <div className="flex h-5 items-center gap-1 px-1 text-xs text-ae-muted">
      <span className="animate-pulse">●●●</span>
      {typers.length > 3 ? 'Several people are typing…' : <span>{names} {typers.length === 1 ? 'is' : 'are'} typing…</span>}
    </div>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  if (a.content_type.startsWith('image/')) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" title={a.name}>
        <img src={a.url} alt={a.name} loading="lazy" className="max-h-80 max-w-sm rounded-ae border border-ae-border object-contain" />
      </a>
    );
  }
  if (a.content_type.startsWith('video/')) {
    return <video src={a.url} controls className="max-h-80 max-w-md rounded-ae border border-ae-border" />;
  }
  if (a.content_type.startsWith('audio/')) {
    return <audio src={a.url} controls className="max-w-sm" />;
  }
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-sm items-center gap-3 rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm hover:border-ae-accent"
    >
      <span className="text-2xl">📄</span>
      <span className="min-w-0">
        <span className="block truncate text-ae-accent">{a.name}</span>
        <span className="text-xs text-ae-muted">{formatSize(a.size)}</span>
      </span>
    </a>
  );
}

interface RowProps {
  message: Message;
  grouped: boolean;
  me: string;
  myUsername: string | null;
  replyTarget: Message | null | undefined;
  reactions: Map<string, string[]> | undefined;
  editing: boolean;
  onReply: () => void;
  onStartEdit: () => void;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string, active: boolean) => void;
}

function MessageRow(props: RowProps) {
  const { message, grouped, me, editing } = props;
  const { data: author } = useProfile(message.author_id);
  const showProfile = useUiStore((s) => s.showProfile);
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const name = author?.display_name || author?.username || 'Deleted user';
  const mine = message.author_id === me;
  const mentioned = !!props.myUsername && new RegExp(`(^|[^\\w@])@${props.myUsername.replace('.', '\\.')}\\b`, 'i').test(message.content);
  const showHeader = !grouped || !!message.reply_to_id;

  return (
    <li
      className={`group relative flex gap-3 px-4 hover:bg-ae-hover/40 ${showHeader ? 'mt-3 pt-1 pb-0.5' : 'py-0.5'} ${mentioned ? 'ae-mentioned' : ''}`}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="w-10 shrink-0">
        {showHeader && (
          <button type="button" onClick={() => message.author_id && showProfile(message.author_id)} className={message.reply_to_id ? 'mt-5' : ''}>
            <Avatar profile={author} size={40} showFrame={false} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.reply_to_id && (
          <p className="mb-0.5 truncate text-xs text-ae-muted">
            ↪{' '}
            {props.replyTarget ? (
              <>
                <strong>
                  <DisplayName userId={props.replyTarget.author_id} />
                </strong>{' '}
                {props.replyTarget.content.slice(0, 120) || '[attachment]'}
              </>
            ) : (
              <em>Original message not loaded</em>
            )}
          </p>
        )}
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              className="text-sm font-semibold hover:underline"
              style={{ color: author?.accent_color ?? undefined }}
              onClick={() => message.author_id && showProfile(message.author_id)}
            >
              {name}
            </button>
            <time className="text-xs text-ae-muted" dateTime={message.created_at}>
              {formatTime(message.created_at)}
            </time>
          </div>
        )}

        {editing ? (
          <div className="space-y-1">
            <textarea
              autoFocus
              className="w-full resize-none rounded-ae border border-ae-accent bg-ae-sunken px-3 py-2 text-sm outline-none"
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              value={draft}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') props.onCancelEdit();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) props.onSaveEdit(draft.trim());
                }
              }}
            />
            <p className="text-xs text-ae-muted">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          message.content && <Markdown source={message.content} className="text-sm leading-relaxed" />
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <AttachmentView key={a.url} a={a} />
            ))}
          </div>
        )}
        {message.edited_at && !editing && <span className="text-[10px] text-ae-muted">(edited)</span>}

        {props.reactions && props.reactions.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {[...props.reactions].map(([emoji, users]) => {
              const active = users.includes(me);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => props.onReact(emoji, active)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    active ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border bg-ae-sunken hover:border-ae-muted'
                  }`}
                >
                  <span>{emoji}</span>
                  <span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!editing && (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-ae border border-ae-border bg-ae-elevated p-0.5 shadow group-hover:flex">
          <button type="button" title="Add reaction" className="rounded px-1.5 py-0.5 text-sm hover:bg-ae-hover" onClick={() => setPicker((p) => !p)}>
            🙂
          </button>
          <button type="button" title="Reply" className="rounded px-1.5 py-0.5 text-sm hover:bg-ae-hover" onClick={props.onReply}>
            ↩
          </button>
          {mine && (
            <button
              type="button"
              title="Edit"
              className="rounded px-1.5 py-0.5 text-sm hover:bg-ae-hover"
              onClick={() => {
                setDraft(message.content);
                props.onStartEdit();
              }}
            >
              ✎
            </button>
          )}
          {mine && (
            <button type="button" title="Delete" className="rounded px-1.5 py-0.5 text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={props.onDelete}>
              <TrashIcon size={14} />
            </button>
          )}
          {picker && (
            <div className="absolute top-8 right-0 z-10 grid grid-cols-6 gap-1 rounded-ae border border-ae-border bg-ae-elevated p-2 shadow-xl">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rounded p-1 text-lg hover:bg-ae-hover"
                  onClick={() => {
                    props.onReact(e, props.reactions?.get(e)?.includes(me) ?? false);
                    setPicker(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

interface MessagePaneProps {
  scope: MessageScope;
  userId: string;
  /** Header content (channel name, DM name, call buttons…). */
  header: ReactNode;
  placeholder: string;
  emptyState: ReactNode;
  /** Content above the history, e.g. an in-progress call panel. */
  top?: ReactNode;
  /** Right-hand panel, e.g. the member list. */
  aside?: ReactNode;
}

export function MessagePane({ scope, userId, header, placeholder, emptyState, top, aside }: MessagePaneProps) {
  const messages = useMessages(scope);
  const reactionsQ = useReactions(scope);
  const send = useSendMessage(scope);
  const edit = useEditMessage(scope);
  const del = useDeleteMessage(scope);
  const react = useToggleReaction(scope, userId);
  const upload = useUploadAttachment(scope);
  const { data: me } = useProfile(userId);
  const { typers, notifyTyping, notifyStopped } = useTyping(scope.id, userId);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files).slice(0, 10)) {
      setUploading((n) => n + 1);
      upload.mutate(file, {
        onSuccess: (a) => setPending((p) => [...p, a].slice(0, 10)),
        onSettled: () => setUploading((n) => n - 1),
      });
    }
  };

  const submit = () => {
    const content = draft.trim();
    if ((!content && pending.length === 0) || send.isPending || uploading > 0) return;
    send.mutate(
      { content, replyToId: replyTo?.id ?? null, attachments: pending },
      {
        onSuccess: () => {
          setDraft('');
          setPending([]);
          setReplyTo(null);
          notifyStopped();
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setReplyTo(null);
    } else if (e.key === 'ArrowUp' && !draft) {
      const last = list.find((m) => m.author_id === userId);
      if (last) setEditingId(last.id);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ae-border px-4">{header}</header>
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

          <div className="ae-scroll flex flex-1 flex-col-reverse overflow-y-auto pb-2">
            <ul className="flex flex-col-reverse">
              {list.map((m, i) => {
                const older = list[i + 1];
                const grouped =
                  !!older &&
                  older.author_id === m.author_id &&
                  new Date(m.created_at).getTime() - new Date(older.created_at).getTime() < GROUP_WINDOW_MS;
                return (
                  <MessageRow
                    key={m.id}
                    message={m}
                    grouped={grouped}
                    me={userId}
                    myUsername={me?.username ?? null}
                    replyTarget={m.reply_to_id ? byId.get(m.reply_to_id) : null}
                    reactions={reactionsByMessage.get(m.id)}
                    editing={editingId === m.id}
                    onReply={() => setReplyTo(m)}
                    onStartEdit={() => setEditingId(m.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(content) => edit.mutate({ id: m.id, content }, { onSuccess: () => setEditingId(null) })}
                    onDelete={() => del.mutate(m.id)}
                    onReact={(emoji, active) => react.mutate({ messageId: m.id, emoji, active })}
                  />
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
                <p className="text-sm text-ae-muted">Loading messages…</p>
              ) : messages.isError ? (
                <p className="text-sm text-ae-danger">{messages.error.message}</p>
              ) : (
                emptyState
              )}
            </div>
          </div>

          <div className="px-4 pb-1">
            {replyTo && (
              <div className="flex items-center justify-between rounded-t-ae border border-b-0 border-ae-border bg-ae-sunken px-3 py-1.5 text-xs text-ae-muted">
                <span className="truncate">
                  Replying to{' '}
                  <strong className="text-ae-text">
                    <DisplayName userId={replyTo.author_id} />
                  </strong>
                </span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                  <CloseIcon size={14} />
                </button>
              </div>
            )}
            {(pending.length > 0 || uploading > 0) && (
              <div className="flex flex-wrap gap-2 border border-b-0 border-ae-border bg-ae-sunken p-2">
                {pending.map((a, i) => (
                  <div key={a.url} className="relative rounded-ae border border-ae-border bg-ae-surface p-2 text-xs">
                    {a.content_type.startsWith('image/') ? (
                      <img src={a.url} alt="" className="h-16 w-16 rounded object-cover" />
                    ) : (
                      <span className="block max-w-32 truncate">📄 {a.name}</span>
                    )}
                    <button
                      type="button"
                      className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-ae-danger text-white"
                      onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove ${a.name}`}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
                {uploading > 0 && <span className="self-center text-xs text-ae-muted">Uploading {uploading}…</span>}
              </div>
            )}
            <div
              className={`flex items-end gap-2 border border-ae-border bg-ae-surface px-3 py-2 focus-within:border-ae-accent ${
                replyTo || pending.length || uploading ? 'rounded-b-ae' : 'rounded-ae'
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                title="Upload a file"
                className="mb-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ae-muted/30 text-ae-text hover:bg-ae-accent hover:text-ae-on-accent"
                onClick={() => fileRef.current?.click()}
              >
                <PlusIcon size={14} />
              </button>
              <textarea
                rows={Math.min(8, Math.max(1, draft.split('\n').length))}
                className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-ae-muted"
                placeholder={placeholder}
                maxLength={4000}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (e.target.value) notifyTyping();
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />
            </div>
            <TypingLine typers={typers} />
            {(send.isError || upload.isError) && <p className="text-xs text-ae-danger">{(send.error ?? upload.error)?.message}</p>}
          </div>
        </div>
        {aside}
      </div>
    </section>
  );
}
