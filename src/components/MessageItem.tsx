/** One chat message: header, reply/forward context, Markdown, attachments, poll, embeds, reactions, hover toolbar. */
import { memo, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { buildMessageLink, extractEmbedUrls } from '../lib/messageLinks';
import { Markdown } from '../lib/markdown';
import { useUiStore } from '../stores/uiStore';
import type { Attachment, Message, PollVote } from '../types/db';
import { EmojiPicker } from './EmojiPicker';
import { LinkIcon, TrashIcon } from './icons';
import { LinkEmbed } from './LinkEmbed';
import { PollCard } from './PollCard';
import { Avatar, StyledName } from './ProfileCard';

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DisplayName({ userId }: { userId: string | null }) {
  const { data } = useProfile(userId);
  return <>{data?.display_name || data?.username || 'Unknown'}</>;
}

function AttachmentView({ a }: { a: Attachment }) {
  const openLightbox = useUiStore((s) => s.openLightbox);
  const [revealed, setRevealed] = useState(!a.spoiler);

  const body = a.content_type.startsWith('image/') ? (
    <button type="button" onClick={() => (revealed ? openLightbox({ url: a.url, alt: a.alt, name: a.name }) : setRevealed(true))} title={a.alt ?? a.name}>
      <img src={a.url} alt={a.alt ?? a.name} loading="lazy" className="max-h-80 max-w-sm rounded-ae border border-ae-border object-contain" />
    </button>
  ) : a.content_type.startsWith('video/') ? (
    <video src={a.url} controls className="max-h-80 max-w-md rounded-ae border border-ae-border" aria-label={a.alt ?? a.name} />
  ) : a.content_type.startsWith('audio/') ? (
    <div className="w-80 rounded-ae border border-ae-border bg-ae-sunken p-2">
      <p className="mb-1 truncate text-xs">{a.name}</p>
      <audio src={a.url} controls className="w-full" />
    </div>
  ) : (
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

  if (revealed) return <div className="relative">{body}</div>;
  return (
    <button type="button" className="relative overflow-hidden rounded-ae" onClick={() => setRevealed(true)} title="Spoiler: click to reveal">
      <div className="pointer-events-none blur-2xl brightness-50">{body}</div>
      <span className="absolute inset-0 grid place-items-center">
        <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-bold tracking-wider text-white">SPOILER</span>
      </span>
    </button>
  );
}

function ToolbarButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center rounded px-1 text-sm hover:bg-ae-hover ${danger ? 'text-ae-muted hover:text-ae-danger' : ''}`}
    >
      {children}
    </button>
  );
}

export interface MessageItemProps {
  message: Message;
  serverId: string | null;
  grouped: boolean;
  me: string;
  myUsername: string | null;
  replyTarget: Message | null | undefined;
  reactions: Map<string, string[]> | undefined;
  votes: PollVote[] | undefined;
  editing: boolean;
  canPin: boolean;
  /** Color of the author's highest colored role (servers only). */
  authorColor?: string | null;
  /** Role ids the viewer holds (for @role mention highlighting). */
  myRoleIds?: ReadonlySet<string>;
  onReply: (m: Message) => void;
  onStartEdit: (id: string) => void;
  onSaveEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string, active: boolean) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onVote: (id: string, optionIds: number[]) => void;
}

const QUICK = ['👍', '❤️', '😂', '🔥'];

function MessageItemImpl(props: MessageItemProps) {
  const { message, grouped, me, editing } = props;
  const { data: author } = useProfile(message.author_id);
  const showProfile = useUiStore((s) => s.showProfile);
  const goTo = useUiStore((s) => s.goTo);
  const openForward = useUiStore((s) => s.openForward);
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const name = author?.display_name || author?.username || 'Deleted user';
  const mine = message.author_id === me;
  const mentioned =
    message.mentions?.includes(me) || message.mention_everyone || !!message.mention_roles?.some((id) => props.myRoleIds?.has(id));
  const showHeader = !grouped || !!message.reply_to_id || !!message.forwarded_from;
  const scopeId = message.channel_id ?? message.conversation_id!;
  const embeds = editing ? [] : extractEmbedUrls(message.content);

  return (
    <li
      id={`msg-${message.id}`}
      className={`ae-msg group relative flex gap-3 px-4 hover:bg-ae-hover/40 ${showHeader ? 'mt-3 pt-1 pb-0.5' : 'py-0.5'} ${mentioned && !mine ? 'ae-mentioned' : ''}`}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="w-10 shrink-0">
        {showHeader ? (
          <button type="button" onClick={() => message.author_id && showProfile(message.author_id)} className={message.reply_to_id ? 'mt-5' : ''}>
            <Avatar profile={author} size={40} showFrame={false} />
          </button>
        ) : (
          <time className="hidden pt-1 text-[10px] text-ae-muted group-hover:block" dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.reply_to_id && (
          <button
            type="button"
            className="mb-0.5 block max-w-full truncate text-left text-xs text-ae-muted hover:text-ae-text"
            onClick={() => goTo({ serverId: props.serverId, scopeId, messageId: message.reply_to_id! })}
            title="Jump to the original message"
          >
            ↪{' '}
            {props.replyTarget ? (
              <>
                <strong>
                  <DisplayName userId={props.replyTarget.author_id} />
                </strong>{' '}
                {props.replyTarget.content.slice(0, 120) || (props.replyTarget.poll ? '📊 poll' : '[attachment]')}
              </>
            ) : (
              <em>Click to load the original message</em>
            )}
          </button>
        )}
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              className="text-sm font-semibold hover:underline"
              onClick={() => message.author_id && showProfile(message.author_id)}
            >
              <StyledName profile={author} text={name} color={props.authorColor ?? author?.accent_color ?? undefined} />
            </button>
            <time className="text-xs text-ae-muted" dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>
              {formatTime(message.created_at)}
            </time>
            {message.pinned && <span className="text-xs text-ae-muted" title="Pinned">📌</span>}
          </div>
        )}

        {message.forwarded_from && (
          <p className="mt-0.5 text-xs text-ae-muted italic">
            ↪ Forwarded from <DisplayName userId={message.forwarded_from.author_id} /> · {formatTime(message.forwarded_from.created_at)}
          </p>
        )}

        <div className={message.forwarded_from ? 'mt-1 border-l-2 border-ae-border pl-3' : ''}>
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
                    if (draft.trim()) props.onSaveEdit(message.id, draft.trim());
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
        </div>
        {message.edited_at && !editing && <span className="text-[10px] text-ae-muted" title={new Date(message.edited_at).toLocaleString()}>(edited)</span>}

        {message.poll && <PollCard message={message} votes={props.votes ?? []} me={me} onVote={(ids) => props.onVote(message.id, ids)} />}
        {embeds.map((url) => (
          <LinkEmbed key={url} url={url} />
        ))}

        {props.reactions && props.reactions.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {[...props.reactions].map(([emoji, users]) => {
              const active = users.includes(me);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => props.onReact(message.id, emoji, active)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    active ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border bg-ae-sunken hover:border-ae-muted'
                  }`}
                >
                  <span className="text-sm">{emoji}</span>
                  <span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!editing && (
        <div className="absolute -top-4 right-4 z-10 hidden items-center gap-0.5 rounded-ae border border-ae-border bg-ae-elevated p-0.5 shadow group-hover:flex">
          {QUICK.map((e) => (
            <ToolbarButton key={e} title={`React ${e}`} onClick={() => props.onReact(message.id, e, props.reactions?.get(e)?.includes(me) ?? false)}>
              {e}
            </ToolbarButton>
          ))}
          <ToolbarButton title="Add reaction" onClick={() => setPicker((p) => !p)}>
            🙂
          </ToolbarButton>
          <span className="mx-0.5 h-5 w-px bg-ae-border" />
          <ToolbarButton title="Reply" onClick={() => props.onReply(message)}>
            ↩
          </ToolbarButton>
          <ToolbarButton title="Forward" onClick={() => openForward(message.id)}>
            ➦
          </ToolbarButton>
          {mine && !message.poll && (
            <ToolbarButton
              title="Edit"
              onClick={() => {
                setDraft(message.content);
                props.onStartEdit(message.id);
              }}
            >
              ✎
            </ToolbarButton>
          )}
          {props.canPin && (
            <ToolbarButton title={message.pinned ? 'Unpin' : 'Pin'} onClick={() => props.onTogglePin(message.id, !message.pinned)}>
              {message.pinned ? '📍' : '📌'}
            </ToolbarButton>
          )}
          <ToolbarButton
            title={copied ? 'Copied!' : 'Copy message link'}
            onClick={() => {
              void navigator.clipboard.writeText(buildMessageLink(message, props.serverId)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? '✓' : <LinkIcon size={14} />}
          </ToolbarButton>
          {mine && (
            <ToolbarButton title="Delete" danger onClick={() => props.onDelete(message.id)}>
              <TrashIcon size={14} />
            </ToolbarButton>
          )}
          {picker && (
            <EmojiPicker
              className="top-8 right-0"
              onClose={() => setPicker(false)}
              onPick={(e) => {
                props.onReact(message.id, e, props.reactions?.get(e)?.includes(me) ?? false);
                setPicker(false);
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

export const MessageItem = memo(MessageItemImpl);
