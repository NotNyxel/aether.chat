/**
 * Message composer: autocomplete for @members (+ @everyone/@here), #channels and :emoji,
 * automatic :shortcode: conversion, emoji picker, polls, file uploads (button, paste,
 * drag-and-drop) with spoiler and alt text, replies, typing indicator, Enter to send.
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useSendMessage, useUploadAttachment } from '../hooks/useChatData';
import { searchEmoji, useEmojiData } from '../lib/emoji';
import { playSound } from '../lib/sounds';
import type { Attachment, Channel, Message, MessageScope } from '../types/db';
import { useProfiles } from './ConversationBits';
import { EmojiPicker } from './EmojiPicker';
import { DisplayName } from './MessageItem';
import { CloseIcon, HashIcon, PlusIcon } from './icons';
import { PollDialog } from './PollDialog';
import { Avatar } from './ProfileCard';

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
  replyTo: Message | null;
  onCancelReply: () => void;
  onEditLast: () => void;
  onSent: () => void;
  onTyping: () => void;
  onStopTyping: () => void;
  /** Files dropped onto the chat area, forwarded by the parent. */
  droppedFiles: File[] | null;
  onDroppedHandled: () => void;
}

const TRIGGER = /(^|\s)([@#:])([\w.+-]*)$/;

export function Composer(props: ComposerProps) {
  const { scope } = props;
  const send = useSendMessage(scope);
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
  const textRef = useRef<HTMLTextAreaElement>(null);
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
    const m = TRIGGER.exec(draft.slice(0, caret));
    if (!m) return null;
    const [, , kind, query] = m;
    if (kind === ':' && query.length < 2) return null;
    return { kind, query: query.toLowerCase(), start: caret - query.length - 1 };
  }, [draft, caret, dismissed]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return [];
    const q = trigger.query;
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
      return [...people.slice(0, 8), ...extra];
    }
    if (trigger.kind === '#') {
      return props.channels
        .filter((c) => c.type === 'text' && c.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, insert: `<#${c.id}> `, label: c.name, icon: <HashIcon size={16} className="text-ae-muted" /> }));
    }
    if (!emoji) return [];
    return searchEmoji(emoji, q, 8).map((e) => ({
      key: e.emoji,
      insert: `${e.emoji} `,
      label: e.shortcodes[0] ? `:${e.shortcodes[0]}:` : e.label,
      sub: e.label,
      icon: <span className="text-xl leading-none">{e.emoji}</span>,
    }));
  }, [trigger, props.memberIds, props.channels, props.canMentionEveryone, profiles, emoji]);

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
    if ((!content && pending.length === 0) || send.isPending || uploading > 0) return;
    send.mutate(
      { content, replyToId: props.replyTo?.id ?? null, attachments: pending },
      {
        onSuccess: () => {
          setDraft('');
          setPending([]);
          props.onCancelReply();
          props.onStopTyping();
          props.onSent();
          playSound('messageSent');
        },
      },
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

  const hasTop = !!props.replyTo || pending.length > 0 || uploading > 0;

  return (
    <div className="relative px-4 pb-1">
      {suggestions.length > 0 && (
        <ul className="absolute right-4 bottom-full left-4 z-30 mb-1 overflow-hidden rounded-ae border border-ae-border bg-ae-elevated py-1 shadow-2xl" role="listbox">
          <li className="px-3 pb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
            {trigger?.kind === '@' ? 'Members' : trigger?.kind === '#' ? 'Text channels' : 'Emoji matching'} {trigger?.query && `"${trigger.query}"`}
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

      {props.replyTo && (
        <div className="flex items-center justify-between rounded-t-ae border border-b-0 border-ae-border bg-ae-sunken px-3 py-1.5 text-xs text-ae-muted">
          <span className="truncate">
            Replying to <strong className="text-ae-text"><DisplayName userId={props.replyTo.author_id} /></strong>
          </span>
          <button type="button" onClick={props.onCancelReply} aria-label="Cancel reply">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {(pending.length > 0 || uploading > 0) && (
        <div className={`flex flex-wrap gap-2 border border-b-0 border-ae-border bg-ae-sunken p-2 ${props.replyTo ? '' : 'rounded-t-ae'}`}>
          {pending.map((a, i) => (
            <div key={a.url} className="relative w-28 rounded-ae border border-ae-border bg-ae-surface p-2 text-xs">
              {a.content_type.startsWith('image/') ? (
                <img src={a.url} alt={a.alt ?? ''} className={`h-20 w-full rounded object-cover ${a.spoiler ? 'blur-md' : ''}`} />
              ) : (
                <span className="block h-20 truncate pt-6 text-center">📄 {a.name}</span>
              )}
              <div className="mt-1 flex justify-between gap-1">
                <button
                  type="button"
                  title="Mark as spoiler"
                  className={`rounded px-1 ${a.spoiler ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-sunken text-ae-muted hover:text-ae-text'}`}
                  onClick={() => setPending((p) => p.map((x, j) => (j === i ? { ...x, spoiler: !x.spoiler } : x)))}
                >
                  Spoiler
                </button>
                <button
                  type="button"
                  title="Alt text (describe the file for screen readers)"
                  className={`rounded px-1 ${a.alt ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-sunken text-ae-muted hover:text-ae-text'}`}
                  onClick={() => {
                    const alt = window.prompt('Describe this file (alt text)', a.alt ?? '');
                    if (alt !== null) setPending((p) => p.map((x, j) => (j === i ? { ...x, alt: alt.slice(0, 1024) || undefined } : x)));
                  }}
                >
                  ALT
                </button>
              </div>
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

      <div className={`relative flex items-end gap-2 border border-ae-border bg-ae-surface px-3 py-2 focus-within:border-ae-accent ${hasTop ? 'rounded-b-ae' : 'rounded-ae'}`}>
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
        <div className="relative mb-0.5">
          <button
            type="button"
            title="Upload a file or create a poll"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ae-muted/30 text-ae-text hover:bg-ae-accent hover:text-ae-on-accent"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <PlusIcon size={14} />
          </button>
          {menuOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-ae border border-ae-border bg-ae-elevated p-1 shadow-2xl" onMouseLeave={() => setMenuOpen(false)}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover"
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                📎 Upload a file
              </button>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover"
                onClick={() => {
                  setMenuOpen(false);
                  setPollOpen(true);
                }}
              >
                📊 Create a poll
              </button>
            </div>
          )}
        </div>
        <textarea
          ref={textRef}
          rows={Math.min(8, Math.max(1, draft.split('\n').length))}
          className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-ae-muted"
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
        <button type="button" title="Emoji" className="mb-0.5 text-xl leading-none grayscale hover:grayscale-0" onClick={() => setPickerOpen((o) => !o)}>
          😊
        </button>
        {pickerOpen && (
          <EmojiPicker
            onClose={() => setPickerOpen(false)}
            onPick={(e) => {
              insertAtCaret(e);
              setPickerOpen(false);
            }}
          />
        )}
      </div>
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
