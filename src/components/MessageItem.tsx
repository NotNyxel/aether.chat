/** One chat message: header, reply/forward context, Markdown, attachments, poll, embeds, reactions, hover toolbar. */
import { inviteCodesIn } from '../lib/invites';
import { InviteEmbed } from './Invites';
import { AudioPlayer, VideoPlayer } from './MediaPlayer';
import { openExternal } from '../lib/platform';
import { closeContextMenu, openContextMenu } from './ContextMenu';
import { openReport } from './ReportDialog';
import { toast } from './Toaster';
import { isArchived, useAnnouncementActions, useThreads } from '../hooks/useThreads';
import { memo, useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { buildMessageLink, extractEmbedUrls } from '../lib/messageLinks';
import { Markdown } from '../lib/markdown';
import { Emoji, EmojiText, emojiSize } from '../lib/twemoji';
import { getRecentEmoji, pushRecentEmoji } from '../lib/emoji';
import { useUiStore } from '../stores/uiStore';
import type { Attachment, Message, PollVote } from '../types/db';
import { EmojiPicker } from './EmojiPicker';
import { BotIcon, CheckIcon, EditIcon, FileIcon, FlagIcon, ForwardIcon, LinkIcon, LockIcon, MegaphoneIcon, PinIcon, PinOffIcon, ReactIcon, ThreadIcon, TrashIcon, ReplyIcon, CopyIcon } from './icons';
import { LinkEmbed } from './LinkEmbed';
import { PollCard } from './PollCard';
import { Avatar, StyledName } from './ProfileCard';
import { BOT_NAME } from '../lib/botCommands';

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
    <VideoPlayer src={a.url} label={a.alt ?? a.name} />
  ) : a.content_type.startsWith('audio/') ? (
    <AudioPlayer src={a.url} name={a.name} />
  ) : (
    <a
      href={a.url}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(a.url);
      }}
      className="flex max-w-sm items-center gap-3 rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm hover:border-ae-accent"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ae-surface text-ae-accent"><FileIcon size={20} /></span>
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
      className={`ae-press grid h-8 min-w-8 place-items-center rounded-md px-1 text-[15px] text-ae-muted transition-colors hover:bg-ae-hover hover:text-ae-text ${danger ? 'hover:!text-ae-danger' : ''}`}
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
  /** Can start a thread from this message (text channels with Create Public Threads). */
  canThread?: boolean;
  /** Announcement message the viewer may publish to following servers. */
  canPublish?: boolean;
  /** Server nickname and server avatar of the author, if they set them. */
  authorNickname?: string | null;
  authorAvatar?: string | null;
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

/** "🧵 Thread name · 12 messages · 3h ago" under a message that started a thread. */
function ThreadChip({ parentId, threadId, onOpen }: { parentId: string; threadId: string; onOpen: () => void }) {
  const { data: threads = [] } = useThreads(parentId);
  const t = threads.find((x) => x.id === threadId);
  if (!t) return null;
  const archived = isArchived(t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ae-enter ae-lift mt-1.5 flex max-w-md items-center gap-2 rounded-ae border border-ae-border bg-ae-surface/60 px-3 py-1.5 text-left text-sm hover:border-ae-accent"
    >
      {t.thread_locked ? <LockIcon size={15} /> : <ThreadIcon size={15} />}
      <span className="truncate font-semibold">{t.name}</span>
      <span className="shrink-0 text-xs text-ae-accent">
        {t.thread_message_count} {t.thread_message_count === 1 ? 'message' : 'messages'}
      </span>
      {archived && <span className="shrink-0 text-[10px] text-ae-muted uppercase">archived</span>}
    </button>
  );
}

function MessageItemImpl(props: MessageItemProps) {
  const { message, grouped, me, editing } = props;
  const { data: author } = useProfile(message.author_id);
  const peekProfile = useUiStore((s) => s.peekProfile);
  const goTo = useUiStore((s) => s.goTo);
  const openForward = useUiStore((s) => s.openForward);
  const openThread = useUiStore((s) => s.openThread);
  const openThreadDraft = useUiStore((s) => s.openThreadDraft);
  const announcements = useAnnouncementActions();
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const bot = !!message.is_bot;
  const name = bot ? (message.bot_name || BOT_NAME) : props.authorNickname || author?.display_name || author?.username || 'Deleted user';
  const avatarProfile = author && props.authorAvatar ? { ...author, avatar_url: props.authorAvatar } : author;
  const mine = message.author_id === me;
  const mentioned =
    message.mentions?.includes(me) || message.mention_everyone || !!message.mention_roles?.some((id) => props.myRoleIds?.has(id));
  const showHeader = !grouped || bot || !!message.reply_to_id || !!message.forwarded_from;
  const scopeId = message.channel_id ?? message.conversation_id!;
  const embeds = editing ? [] : extractEmbedUrls(message.content);
  const inviteCodes = editing ? [] : inviteCodesIn(message.content);

  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const reply = () => props.onReply(message);
    el.addEventListener('aether-swipe-reply', reply);
    return () => el.removeEventListener('aether-swipe-reply', reply);
  });

  return (
    <li
      ref={rowRef}
      id={`msg-${message.id}`}
      className={`ae-msg group relative flex gap-4 pr-12 pl-4 transition-colors duration-100 hover:bg-ae-hover/30 ${showHeader ? 'mt-4 pt-0.5 pb-px' : 'py-px'} ${mentioned && !mine ? 'ae-mentioned' : ''} ${(message as { pending?: boolean }).pending ? 'ae-msg-pending pointer-events-none' : ''}`}
      onMouseLeave={() => setPicker(false)}
      onContextMenu={(e) => {
        if (editing) return;
        openContextMenu(e, [
          { label: 'Add reaction', icon: <ReactIcon size={15} />, onClick: () => setPicker(true) },
          { label: 'Reply', icon: <ReplyIcon size={15} />, onClick: () => props.onReply(message) },
          { label: 'Forward', icon: <ForwardIcon size={15} />, onClick: () => openForward(message.id) },
          props.canThread && message.channel_id
            ? {
                label: message.thread_id ? 'Open thread' : 'Create thread',
                icon: <ThreadIcon size={15} />,
                onClick: () => (message.thread_id ? openThread(message.thread_id) : openThreadDraft({ parentId: message.channel_id!, messageId: message.id })),
              }
            : null,
          mine && !message.poll && {
            label: 'Edit message',
            icon: <EditIcon size={15} />,
            onClick: () => {
              setDraft(message.content);
              props.onStartEdit(message.id);
            },
          },
          props.canPin && { label: message.pinned ? 'Unpin message' : 'Pin message', icon: <PinIcon size={15} />, onClick: () => props.onTogglePin(message.id, !message.pinned) },
          props.canPublish && { label: 'Publish', icon: <MegaphoneIcon size={15} />, onClick: () => announcements.publish.mutate(message.id) },
          'divider',
          message.content && {
            label: 'Copy text',
            icon: <CopyIcon size={15} />,
            onClick: () => void navigator.clipboard.writeText(message.content).then(() => toast('Copied text', <CopyIcon size={14} />)),
          },
          {
            label: 'Copy message link',
            icon: <LinkIcon size={15} />,
            onClick: () => void navigator.clipboard.writeText(buildMessageLink(message, props.serverId)).then(() => toast('Link copied', <LinkIcon size={14} />)),
          },
          'divider',
          !mine && message.author_id && {
            label: 'Report message',
            icon: <FlagIcon size={15} />,
            danger: true,
            onClick: () => openReport({ messageId: message.id, userId: message.author_id, preview: message.content.slice(0, 280) }),
          },
          mine && { label: 'Delete message', icon: <TrashIcon size={15} />, danger: true, onClick: () => props.onDelete(message.id) },
        ], (
          // Phones: one-tap reactions and reply at the top of the sheet (the hover bar's job on desktop).
          <div className="flex items-center gap-1.5">
            {getRecentEmoji()
              .slice(0, 5)
              .map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  className="grid h-11 w-11 place-items-center rounded-full bg-ae-surface text-2xl active:scale-90"
                  onClick={() => {
                    closeContextMenu();
                    const active = props.reactions?.get(emoji)?.includes(me) ?? false;
                    props.onReact(message.id, emoji, active);
                    pushRecentEmoji(emoji);
                  }}
                >
                  <Emoji emoji={emoji} className="!m-0" />
                </button>
              ))}
            <button
              type="button"
              aria-label="More reactions"
              className="grid h-11 w-11 place-items-center rounded-full bg-ae-surface text-ae-muted"
              onClick={() => {
                closeContextMenu();
                setPicker(true);
              }}
            >
              <ReactIcon size={20} />
            </button>
            <button
              type="button"
              className="ml-auto flex h-11 items-center gap-1.5 rounded-full bg-ae-accent px-4 text-sm font-bold text-ae-on-accent"
              onClick={() => {
                closeContextMenu();
                props.onReply(message);
              }}
            >
              <ReplyIcon size={16} /> Reply
            </button>
          </div>
        ));
      }}
    >
      <div className="w-10 shrink-0">
        {showHeader && bot && message.bot_avatar ? (
          <img src={message.bot_avatar} alt="" className="h-10 w-10 rounded-full object-cover" draggable={false} />
        ) : showHeader && bot ? (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-ae-accent to-[#00d4ff] text-white shadow-md">
            <BotIcon size={20} />
          </span>
        ) : showHeader ? (
          <button type="button" onClick={(e) => message.author_id && peekProfile(message.author_id, e.currentTarget)} className={message.reply_to_id ? 'mt-5' : ''}>
            <Avatar profile={avatarProfile} size={40} showFrame={false} />
          </button>
        ) : (
          <time className="invisible block h-[22px] text-right text-[10px] leading-[22px] text-ae-muted tabular-nums group-hover:visible" dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.reply_to_id && (
          <button
            type="button"
            className="relative mb-1 flex max-w-full items-center gap-1.5 truncate text-left text-[13px] text-ae-muted before:absolute before:top-1/2 before:-left-[38px] before:h-3 before:w-8 before:rounded-tl-md before:border-t-2 before:border-l-2 before:border-ae-border before:content-[''] hover:text-ae-text"
            onClick={() => goTo({ serverId: props.serverId, scopeId, messageId: message.reply_to_id! })}
            title="Jump to the original message"
          >
            {props.replyTarget ? (
              <>
                <strong>
                  <DisplayName userId={props.replyTarget.author_id} />
                </strong>{' '}
                {props.replyTarget.content.slice(0, 120) || (props.replyTarget.poll ? 'Poll' : 'Attachment')}
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
              className="text-[15px] leading-[22px] font-semibold hover:underline"
              onClick={(e) => message.author_id && peekProfile(message.author_id, e.currentTarget)}
            >
              {bot ? <span className="text-ae-accent">{name}</span> : <StyledName profile={author} text={name} color={props.authorColor ?? author?.accent_color ?? undefined} />}
            </button>
            {bot && <span className="rounded bg-ae-accent px-1 py-px text-[10px] leading-none font-bold text-ae-on-accent">{message.bot_command === 'webhook' ? 'APP' : 'BOT'}</span>}
            <time className="text-[11px] text-ae-muted" dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>
              {formatTime(message.created_at)}
            </time>
            {message.pinned && <span className="text-xs text-ae-muted" title="Pinned"><PinIcon size={15} className="ae-ico" /></span>}
          </div>
        )}

        {bot && message.bot_invoker_id && message.bot_command && message.bot_command !== 'welcome' && message.bot_command !== 'webhook' && (
          <p className="text-xs text-ae-muted">
            <DisplayName userId={message.bot_invoker_id} /> used <span className="font-mono text-ae-accent">/{message.bot_command}</span>
          </p>
        )}
        {message.crossposted_from && (
          <p className="mt-0.5 text-xs text-ae-muted">
            <MegaphoneIcon size={15} className="ae-ico" /> From <strong className="text-ae-text">{message.crossposted_from.server_name}</strong> · #{message.crossposted_from.channel_name}
          </p>
        )}
        {message.forwarded_from && (
          <p className="mt-0.5 text-xs text-ae-muted italic">
            <ForwardIcon size={12} className="ae-ico" /> Forwarded from <DisplayName userId={message.forwarded_from.author_id} /> · {formatTime(message.forwarded_from.created_at)}
          </p>
        )}

        <div className={message.forwarded_from ? 'mt-1 border-l-2 border-ae-border pl-3' : ''}>
          {editing ? (
            <div className="space-y-1">
              <textarea
                autoFocus
                className="ae-input w-full resize-none text-sm"
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
            message.content && <Markdown source={message.content} jumbo={emojiSize(message.content)} className="text-[15px] leading-[1.375rem] text-ae-text/95" />
          )}

          {message.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <AttachmentView key={a.url} a={a} />
              ))}
            </div>
          )}
        </div>
        {message.edited_at && !editing && <span className="text-[10px] text-ae-muted" data-tip={`Edited ${new Date(message.edited_at).toLocaleString()}`}>(edited)</span>}

        {message.poll && <PollCard message={message} votes={props.votes ?? []} me={me} onVote={(ids) => props.onVote(message.id, ids)} />}
        {embeds
          .filter((url) => !inviteCodes.length || !/aether\.chat\/inv\/|aether\.chat-releases\/inv\//.test(url))
          .map((url) => (
            <LinkEmbed key={url} url={url} />
          ))}
        {inviteCodes.map((c) => (
          <InviteEmbed key={c} code={c} me={me} />
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
                  className={`ae-press flex h-6 items-center gap-1.5 rounded-lg border px-1.5 text-xs font-semibold tabular-nums transition-colors ${
                    active ? 'border-ae-accent/70 bg-ae-accent/15 text-ae-accent' : 'border-transparent bg-ae-surface/70 text-ae-muted hover:border-ae-border'
                  }`}
                >
                  <span className="text-[16px] leading-none"><EmojiText text={emoji} /></span>
                  <span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}
        {message.thread_id && message.channel_id && <ThreadChip parentId={message.channel_id} threadId={message.thread_id} onOpen={() => openThread(message.thread_id)} />}
        {message.published_at && <p className="mt-0.5 text-[11px] text-ae-muted"><MegaphoneIcon size={15} className="ae-ico" /> Published to following servers</p>}
        {announcements.publish.error && <p className="mt-0.5 text-xs text-ae-danger">{announcements.publish.error.message}</p>}
      </div>

      {!editing && (
        <div className="ae-pop absolute -top-4 right-4 z-10 hidden items-center gap-0.5 rounded-lg border border-ae-border bg-ae-elevated p-0.5 shadow-lg group-hover:flex">
          {QUICK.map((e) => (
            <ToolbarButton key={e} title={`React ${e}`} onClick={() => props.onReact(message.id, e, props.reactions?.get(e)?.includes(me) ?? false)}>
              {e}
            </ToolbarButton>
          ))}
          <ToolbarButton title="Add reaction" onClick={() => setPicker((p) => !p)}>
            <ReactIcon size={15} className="ae-ico" />
          </ToolbarButton>
          <span className="mx-0.5 h-5 w-px bg-ae-border" />
          <ToolbarButton title="Reply" onClick={() => props.onReply(message)}>
            <ReplyIcon size={16} />
          </ToolbarButton>
          <ToolbarButton title="Forward" onClick={() => openForward(message.id)}>
            <ForwardIcon size={15} className="ae-ico" />
          </ToolbarButton>
          {props.canThread && message.channel_id && (
            <ToolbarButton
              title={message.thread_id ? 'Open thread' : 'Create thread'}
              onClick={() =>
                message.thread_id ? openThread(message.thread_id) : openThreadDraft({ parentId: message.channel_id!, messageId: message.id })
              }
            >
              <ThreadIcon size={15} className="ae-ico" />
            </ToolbarButton>
          )}
          {props.canPublish && (
            <ToolbarButton title="Publish to following servers" onClick={() => announcements.publish.mutate(message.id)}>
              <MegaphoneIcon size={15} className="ae-ico" />
            </ToolbarButton>
          )}
          {mine && !message.poll && (
            <ToolbarButton
              title="Edit"
              onClick={() => {
                setDraft(message.content);
                props.onStartEdit(message.id);
              }}
            >
              <EditIcon size={15} className="ae-ico" />
            </ToolbarButton>
          )}
          {props.canPin && (
            <ToolbarButton title={message.pinned ? 'Unpin' : 'Pin'} onClick={() => props.onTogglePin(message.id, !message.pinned)}>
              {message.pinned ? <PinOffIcon size={15} /> : <PinIcon size={15} />}
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
            {copied ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
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
