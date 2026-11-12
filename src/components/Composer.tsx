/**
 * Message composer: autocomplete for @members (+ @everyone/@here), #channels and :emoji,
 * automatic :shortcode: conversion, emoji picker, polls, file uploads (button, paste,
 * drag-and-drop) with spoiler and alt text, replies, typing indicator, Enter to send.
 */
import { toast } from './Toaster';
import { promptText } from './ConfirmDialog';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useSendMessage, useUploadAttachment } from '../hooks/useChatData';
import { searchEmoji, useEmojiData } from '../lib/emoji';
import { playSound } from '../lib/sounds';
import type { Attachment, Channel, Message, MessageScope, ServerRole } from '../types/db';
import { useProfiles } from './ConversationBits';
import { EmojiPicker } from './EmojiPicker';
import { DisplayName } from './MessageItem';
import { AttachIcon, BotIcon, ClockIcon, CloseIcon, EyeOffIcon, FileIcon, HashIcon, PlusIcon, PollIcon, ReplyIcon, SendIcon, SmileIcon, TimeoutIcon, TrashIcon, UploadIcon } from './icons';
import { PollDialog } from './PollDialog';
import { Avatar } from './ProfileCard';
import { BOT_COMMANDS, parseBotCommand } from '../lib/botCommands';
import { useSupabase } from '../lib/supabase';
import { useMeId } from '../hooks/useMe';
import { useServers } from '../hooks/useChatData';
import { customEmojiToken, useServerEmojis } from '../lib/customEmoji';

interface Suggestion {
  key: string;
  insert: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
}

export interface ComposerProps {
  scope: MessageScope;
  placeholder: string;
  memberIds: string[];
  channels: Channel[];
  canMentionEveryone: boolean;
  /** Server roles (for @role autocomplete). */
  roles?: ServerRole[];
  /** When set, the user is timed out and cannot send. */
  timedOutUntil?: string | null;
  /** Slow-mode delay that applies to this user (0 = none). */
  slowmodeSeconds?: number;
  replyTo: Message | null;
  onCancelReply: () => void;
  onEditLast: () => void;
  onSent: () => void;
  onTyping: () => void;
  onStopTyping: () => void;
  /** The server's built-in bot is on: "/command" runs a bot command. */
  botCommands?: boolean;
  /** Files dropped onto the chat area, forwarded by the parent. */
  droppedFiles: File[] | null;
  onDroppedHandled: () => void;
}

const TRIGGER = /(^|\s)([@#:])([\w.+-]*)$/;

export function Composer(props: ComposerProps) {
  const { scope } = props;
  const send = useSendMessage(scope);
  const meId = useMeId();
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());
  const { data: myServers = [] } = useServers(meId);
  const { data: customEmojis = [] } = useServerEmojis(myServers.map((x) => x.id));
  const sb = useSupabase();
  const upload = useUploadAttachment(scope);
  const emoji = useEmojiData();
  const profiles = useProfiles(props.memberIds);

  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, tick] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Focus the box when a reply is started.
  useEffect(() => {
    if (props.replyTo) textRef.current?.focus();
  }, [props.replyTo]);

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files).slice(0, 10)) {
      setUploading((n) => n + 1);
      upload.mutate(file, {
        onSuccess: (a) => setPending((p) => [...p, a].slice(0, 10)),
        onSettled: () => setUploading((n) => n - 1),
      });
    }
  };

  const { droppedFiles, onDroppedHandled } = props;
  useEffect(() => {
    if (droppedFiles?.length) {
      addFiles(droppedFiles);
      onDroppedHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  // ── Autocomplete ──────────────────────────────────────────────────────────────────────────
  const trigger = useMemo(() => {
    if (dismissed) return null;
    const slash = props.botCommands ? /^\/([a-z0-9]*)$/i.exec(draft.slice(0, caret)) : null;
    if (slash) return { kind: '/', query: slash[1]!.toLowerCase(), start: 0 };
    const m = TRIGGER.exec(draft.slice(0, caret));
    if (!m) return null;
    const [, , kind, query] = m;
    if (kind === ':' && query.length < 2) return null;
    return { kind, query: query.toLowerCase(), start: caret - query.length - 1 };
  }, [draft, caret, dismissed, props.botCommands]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return [];
    const q = trigger.query;
    if (trigger.kind === '/') {
      return BOT_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
        key: c.name,
        insert: `/${c.name} `,
        label: `/${c.name}${c.args ? ` ${c.args}` : ''}`,
        sub: `${c.description}${c.mod ? ' · moderators' : ''}`,
        icon: <BotIcon size={18} className="text-ae-accent" />,
      }));
    }
    if (trigger.kind === '@') {
      const people: Suggestion[] = [];
      props.memberIds.forEach((id, i) => {
        const p = profiles[i];
        if (!p) return;
        const hay = `${p.username} ${p.display_name ?? ''}`.toLowerCase();
        if (q && !hay.includes(q)) return;
        people.push({
          key: id,
          insert: `@${p.username} `,
          label: p.display_name || p.username,
          sub: `@${p.username}`,
          icon: <Avatar profile={p} size={22} showFrame={false} />,
        });
      });
      people.sort((a, b) => Number(!a.sub!.slice(1).toLowerCase().startsWith(q)) - Number(!b.sub!.slice(1).toLowerCase().startsWith(q)));
      const extra: Suggestion[] = props.canMentionEveryone
        ? ['everyone', 'here']
            .filter((w) => w.startsWith(q))
            .map((w) => ({
              key: w,
              insert: `@${w} `,
              label: `@${w}`,
              sub: w === 'everyone' ? 'Notify everyone in this channel' : 'Notify everyone online',
              icon: <span className="text-ae-warning">@</span>,
            }))
        : [];
      const roleHits: Suggestion[] = (props.roles ?? [])
        .filter((r) => !r.is_default && (r.mentionable || props.canMentionEveryone) && r.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map((r) => ({
          key: r.id,
          insert: `<@&${r.id}> `,
          label: `@${r.name}`,
          sub: 'Role',
          icon: <span className="h-3 w-3 rounded-full" style={{ background: r.color ?? 'var(--ae-text-muted)' }} />,
        }));
      return [...people.slice(0, 8), ...roleHits, ...extra];
    }
    if (trigger.kind === '#') {
      return props.channels
        .filter((c) => c.type === 'text' && c.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, insert: `<#${c.id}> `, label: c.name, icon: <HashIcon size={16} className="text-ae-muted" /> }));
    }
    const customHits: Suggestion[] = customEmojis
      .filter((e) => e.name.includes(q))
      .slice(0, 6)
      .map((e) => ({ key: e.id, insert: `${customEmojiToken(e)} `, label: `:${e.name}:`, sub: 'Server emoji', icon: <img src={e.url} alt="" className="h-6 w-6 object-contain" /> }));
    if (!emoji) return customHits;
    return [...customHits, ...searchEmoji(emoji, q, 8 - Math.min(customHits.length, 4)).map((e) => ({
      key: e.emoji,
      insert: `${e.emoji} `,
      label: e.shortcodes[0] ? `:${e.shortcodes[0]}:` : e.label,
      sub: e.label,
      icon: <span className="text-xl leading-none">{e.emoji}</span>,
    }))];
  }, [trigger, props.memberIds, props.channels, props.canMentionEveryone, props.roles, profiles, emoji, customEmojis]);

  useEffect(() => setSelected(0), [trigger?.kind, trigger?.query]);

  const applySuggestion = (s: Suggestion) => {
    if (!trigger) return;
    const next = draft.slice(0, trigger.start) + s.insert + draft.slice(caret);
    const pos = trigger.start + s.insert.length;
    setDraft(next);
    requestAnimationFrame(() => {
      textRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const insertAtCaret = (text: string) => {
    const el = textRef.current;
    const at = el?.selectionStart ?? draft.length;
    const next = draft.slice(0, at) + text + draft.slice(el?.selectionEnd ?? at);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
      setCaret(at + text.length);
    });
  };

  // ── Sending ───────────────────────────────────────────────────────────────────────────────
  const submit = () => {
    const content = draft.trim();
    if ((!content && pending.length === 0) || uploading > 0 || cooldownLeft > 0 || props.timedOutUntil) return;
    const command = props.botCommands && scope.kind === 'channel' && pending.length === 0 ? parseBotCommand(content) : null;
    if (command) {
      setDraft('');
      void sb.rpc('bot_command', { p_channel_id: scope.id, p_command: command.name, p_args: command.args }).then(({ error }) => {
        if (error) {
          toast.error(error.message);
          setDraft(content);
        } else props.onSent();
      });
      return;
    }
    // Instant: clear the box and show the message now; sends go out one after another in order,
    // so fast typing is never blocked or wiped while the server answers.
    const vars = { content, replyToId: props.replyTo?.id ?? null, attachments: pending, tempId: `local-${crypto.randomUUID()}`, authorId: meId };
    setDraft('');
    setPending([]);
    props.onCancelReply();
    props.onStopTyping();
    props.onSent();
    playSound('messageSent');
    if (props.slowmodeSeconds) setCooldownUntil(Date.now() + props.slowmodeSeconds * 1000);
    sendQueue.current = sendQueue.current.then(() =>
      send.mutateAsync(vars).catch((e: Error) => {
        toast.error(e.message);
        // Give the text back, unless they've already started typing something new.
        setDraft((cur) => (cur.trim() ? cur : content));
      }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selected]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      props.onCancelReply();
    } else if (e.key === 'ArrowUp' && !draft) {
      e.preventDefault();
      props.onEditLast();
    }
  };

  const onChange = (value: string, pos: number) => {
    // Convert a completed :shortcode: right before the caret into its emoji.
    const before = value.slice(0, pos);
    const sc = /:([a-z0-9_+-]{2,}):$/.exec(before);
    const hit = sc && emoji?.byShortcode.get(sc[1]);
    if (hit) {
      const replaced = before.slice(0, sc!.index) + hit.emoji + value.slice(pos);
      const newPos = sc!.index + hit.emoji.length;
      setDraft(replaced);
      setCaret(newPos);
      requestAnimationFrame(() => textRef.current?.setSelectionRange(newPos, newPos));
    } else {
      setDraft(value);
      setCaret(pos);
    }
    setDismissed(false);
    if (value) props.onTyping();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  if (props.timedOutUntil) {
    return (
      <div className="px-4 pb-1">
        <div className="rounded-ae border border-ae-warning/50 bg-ae-warning/10 px-4 py-3 text-sm">
          <TimeoutIcon size={15} className="ae-ico" /> You&apos;re timed out until <strong>{new Date(props.timedOutUntil).toLocaleString()}</strong>. You can read, but not send,
          react or join voice.
        </div>
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-1">
      {suggestions.length > 0 && (
        <ul className="absolute right-4 bottom-full left-4 z-30 mb-1 overflow-hidden rounded-ae border border-ae-border bg-ae-elevated py-1 shadow-2xl" role="listbox">
          <li className="px-3 pb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
            {trigger?.kind === '/' ? 'Bot commands' : trigger?.kind === '@' ? 'Members' : trigger?.kind === '#' ? 'Text channels' : 'Emoji matching'} {trigger?.query && `"${trigger.query}"`}
          </li>
          {suggestions.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === selected}>
              <button
                type="button"
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(s);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === selected ? 'bg-ae-hover' : ''}`}
              >
                <span className="grid w-6 place-items-center">{s.icon}</span>
                <span className="truncate">{s.label}</span>
                {s.sub && <span className="ml-auto truncate text-xs text-ae-muted">{s.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ae-composer overflow-visible rounded-xl border border-transparent bg-ae-surface/90 shadow-[0_1px_0_rgba(0,0,0,0.15)] transition-[border-color,box-shadow] focus-within:border-ae-accent/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ae-accent)_18%,transparent)]">
        {props.replyTo && (
          <div className="ae-enter flex items-center gap-2 border-b border-ae-border/60 px-3 py-2 text-xs text-ae-muted">
            <ReplyIcon size={14} className="shrink-0 text-ae-accent" />
            <span className="min-w-0 flex-1 truncate">
              Replying to <strong className="text-ae-text"><DisplayName userId={props.replyTo.author_id} /></strong>
              {props.replyTo.content && <span className="ml-1.5 opacity-80">{props.replyTo.content.slice(0, 120)}</span>}
            </span>
            <button type="button" className="grid h-5 w-5 place-items-center rounded-full hover:bg-ae-hover hover:text-ae-text" onClick={props.onCancelReply} aria-label="Cancel reply">
              <CloseIcon size={13} />
            </button>
          </div>
        )}

        {(pending.length > 0 || uploading > 0) && (
          <div className="ae-scroll flex gap-2.5 overflow-x-auto border-b border-ae-border/60 p-3">
            {pending.map((a, i) => (
              <div key={a.url} className="ae-pop group relative w-36 shrink-0 overflow-hidden rounded-lg border border-ae-border bg-ae-sunken">
                {a.content_type.startsWith('image/') ? (
                  <img src={a.url} alt={a.alt ?? ''} className={`h-24 w-full object-cover ${a.spoiler ? 'blur-md' : ''}`} />
                ) : (
                  <span className="grid h-24 place-items-center text-ae-muted">
                    <FileIcon size={28} />
                  </span>
                )}
                <p className="truncate px-2 py-1.5 text-xs">{a.name}</p>
                <div className="absolute top-1.5 right-1.5 flex gap-1 rounded-md bg-ae-elevated/95 p-0.5 opacity-0 shadow transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    data-tip={a.spoiler ? 'Remove spoiler' : 'Mark as spoiler'}
                    className={`grid h-6 w-6 place-items-center rounded ${a.spoiler ? 'text-ae-accent' : 'text-ae-muted hover:text-ae-text'}`}
                    onClick={() => setPending((p) => p.map((x, j) => (j === i ? { ...x, spoiler: !x.spoiler } : x)))}
                  >
                    <EyeOffIcon size={14} />
                  </button>
                  <button
                    type="button"
                    data-tip="Alt text"
                    className={`grid h-6 w-6 place-items-center rounded text-[10px] font-bold ${a.alt ? 'text-ae-accent' : 'text-ae-muted hover:text-ae-text'}`}
                    onClick={async () => {
                      const alt = await promptText('Describe this file for people using screen readers.', { title: 'Alt text', initial: a.alt ?? '', maxLength: 1024, multiline: true });
                      if (alt !== null) setPending((p) => p.map((x, j) => (j === i ? { ...x, alt: alt.slice(0, 1024) || undefined } : x)));
                    }}
                  >
                    ALT
                  </button>
                  <button
                    type="button"
                    data-tip="Remove"
                    className="grid h-6 w-6 place-items-center rounded text-ae-danger hover:bg-ae-danger/15"
                    onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                    aria-label={`Remove ${a.name}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
                {a.spoiler && <span className="absolute bottom-8 left-1.5 rounded bg-black/70 px-1.5 text-[10px] font-bold text-white uppercase">Spoiler</span>}
              </div>
            ))}
            {uploading > 0 && (
              <div className="grid h-[124px] w-36 shrink-0 place-items-center rounded-lg border border-dashed border-ae-border text-xs text-ae-muted">
                <span className="text-center">
                  <span className="ae-skeleton mx-auto mb-2 block h-1.5 w-16 rounded-full" />
                  Uploading {uploading}…
                </span>
              </div>
            )}
          </div>
        )}

        <div className="relative flex items-end gap-1 px-2 py-1.5">
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
          <div className="relative">
            <button
              type="button"
              data-tip="Upload or create"
              aria-label="Upload a file or create a poll"
              className={`ae-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-ae-muted transition-[transform,color,background] hover:bg-ae-hover hover:text-ae-text ${menuOpen ? 'rotate-45 text-ae-text' : ''}`}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <PlusIcon size={20} />
            </button>
            {menuOpen && (
              <div className="ae-pop absolute bottom-full left-0 z-30 mb-2 w-52 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-ae-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  <UploadIcon size={16} className="text-ae-muted" /> Upload a file
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-ae-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    setPollOpen(true);
                  }}
                >
                  <PollIcon size={16} className="text-ae-muted" /> Create a poll
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={textRef}
            rows={Math.min(10, Math.max(1, draft.split('\n').length))}
            className="ae-scroll block max-h-64 min-h-[32px] w-full resize-none bg-transparent px-1 py-[6px] text-[15px] leading-5 !shadow-none !outline-none placeholder:text-ae-muted/80"
            placeholder={props.placeholder}
            maxLength={4000}
            value={draft}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setTimeout(() => setDismissed(true), 120)}
            onFocus={() => setDismissed(false)}
          />
          {draft.length > 3600 && <span className={`mb-2 text-[11px] tabular-nums ${draft.length >= 4000 ? 'text-ae-danger' : 'text-ae-muted'}`}>{4000 - draft.length}</span>}
          <div className="flex items-center">
            <button type="button" data-tip="Attach" aria-label="Attach a file" className="ae-press grid h-8 w-8 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => fileRef.current?.click()}>
              <AttachIcon size={18} />
            </button>
            <button
              type="button"
              data-tip="Emoji"
              aria-label="Emoji"
              className={`ae-press group grid h-8 w-8 place-items-center rounded-full hover:bg-ae-hover ${pickerOpen ? 'text-ae-accent' : 'text-ae-muted hover:text-ae-text'}`}
              onClick={() => setPickerOpen((o) => !o)}
            >
              <SmileIcon size={19} className="transition-transform group-hover:scale-110 group-hover:rotate-12" />
            </button>
            {(draft.trim() || pending.length > 0) && (
              <button
                type="button"
                data-tip="Send (Enter)"
                aria-label="Send"
                className="ae-pop ae-press ml-0.5 grid h-8 w-8 place-items-center rounded-full bg-ae-accent text-ae-on-accent"
                onClick={submit}
              >
                <SendIcon size={16} />
              </button>
            )}
          </div>
          {pickerOpen && (
            <EmojiPicker
              allowCustom
              onClose={() => setPickerOpen(false)}
              onPick={(e) => {
                insertAtCaret(e);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      </div>
      {cooldownLeft > 0 && <p className="mt-1 flex items-center gap-1 px-1 text-xs text-ae-warning"><ClockIcon size={12} /> Slow mode is on: you can send again in {cooldownLeft}s.</p>}
      {!cooldownLeft && !!props.slowmodeSeconds && <p className="mt-1 flex items-center gap-1 px-1 text-[11px] text-ae-muted"><ClockIcon size={12} /> Slow mode: one message every {props.slowmodeSeconds}s.</p>}
      {(send.isError || upload.isError) && <p className="text-xs text-ae-danger">{(send.error ?? upload.error)?.message}</p>}

      {pollOpen && (
        <PollDialog
          onClose={() => setPollOpen(false)}
          pending={send.isPending}
          error={send.error?.message ?? null}
          onSubmit={(poll) =>
            send.mutate(
              { content: '', poll },
              {
                onSuccess: () => {
                  setPollOpen(false);
                  props.onSent();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
