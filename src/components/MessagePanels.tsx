/** Right-hand panels for a chat: pinned messages and search results (with jump-to). */
import { useState } from 'react';
import { HAS_KINDS, parseSearch, useMessageSearch, usePinnedMessages, useScopeMedia, type MediaItem, type SearchQuery } from '../hooks/useMessageExtras';
import { decryptText } from '../lib/e2e';
import { promptText } from './ConfirmDialog';
import { Markdown } from '../lib/markdown';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Message, MessageScope } from '../types/db';
import { AudioFileIcon, CloseIcon, FileIcon, ImageIcon, PinIcon, VideoFileIcon } from './icons';
import { DisplayName, formatTime } from './MessageItem';
import { previewText, useE2e } from './E2eChat';

function ResultCard({ m, serverId, channelName, onUnpin }: {
  m: Message;
  serverId: string | null;
  channelName?: string;
  onUnpin?: () => void;
}) {
  const goTo = useUiStore((s) => s.goTo);
  return (
    <li className="group rounded-ae border border-ae-border bg-ae-sunken p-2.5">
      <div className="mb-1 flex items-baseline gap-2 text-xs">
        <strong className="text-sm">
          <DisplayName userId={m.author_id} />
        </strong>
        <span className="text-ae-muted">{formatTime(m.created_at)}</span>
        {channelName && <span className="ml-auto truncate text-ae-muted">#{channelName}</span>}
      </div>
      {m.content ? (
        <Markdown source={previewText(m.content).length > 400 ? `${previewText(m.content).slice(0, 400)}…` : previewText(m.content)} className="text-sm" />
      ) : (
        <p className="text-sm text-ae-muted italic">{m.poll ? `Poll: ${m.poll.question}` : `${m.attachments.length} attachment(s)`}</p>
      )}
      <div className="mt-1.5 flex gap-3 text-xs opacity-0 group-hover:opacity-100">
        <button
          type="button"
          className="text-ae-accent hover:underline"
          onClick={() => goTo({ serverId, scopeId: (m.channel_id ?? m.conversation_id)!, messageId: m.id })}
        >
          Jump
        </button>
        {onUnpin && (
          <button type="button" className="text-ae-muted hover:text-ae-danger" onClick={onUnpin}>
            Unpin
          </button>
        )}
      </div>
    </li>
  );
}

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-ae-border bg-ae-elevated/60">
      <header className="flex h-11 items-center justify-between border-b border-ae-border px-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" aria-label="Close" className="text-ae-muted hover:text-ae-text" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="ae-scroll flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

export function PinsPanel({ scope, serverId, canPin, onUnpin, onClose }: {
  scope: MessageScope;
  serverId: string | null;
  canPin: boolean;
  onUnpin: (id: string) => void;
  onClose: () => void;
}) {
  const { data = [], isLoading } = usePinnedMessages(scope, true);
  return (
    <PanelShell title="Pinned messages" onClose={onClose}>
      {isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {!isLoading && data.length === 0 && (
        <div className="py-10 text-center text-sm text-ae-muted">
          <p className="text-3xl"><PinIcon size={15} className="ae-ico" /></p>
          <p className="mt-2">No pinned messages yet.</p>
          <p className="text-xs">Hover a message and click <PinIcon size={15} className="ae-ico" /> to pin it.</p>
        </div>
      )}
      <ul className="space-y-2">
        {data.map((m) => (
          <ResultCard key={m.id} m={m} serverId={serverId} onUnpin={canPin ? () => onUnpin(m.id) : undefined} />
        ))}
      </ul>
    </PanelShell>
  );
}

const isVisual = (a: MediaItem['a']) => !a.voice && (a.content_type.startsWith('image/') || a.content_type.startsWith('video/'));
const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Media & files (2.0): a grid of every photo and video in the chat, and a list of files and voice messages. */
export function MediaPanel({ scope, serverId, onClose }: { scope: MessageScope; serverId: string | null; onClose: () => void }) {
  const { data = [], isLoading } = useScopeMedia(scope, true);
  const [tab, setTab] = useState<'media' | 'files'>('media');
  const openLightbox = useUiStore((s) => s.openLightbox);
  const goTo = useUiStore((s) => s.goTo);
  const media = data.filter((i) => isVisual(i.a) && !i.a.spoiler);
  const files = data.filter((i) => !isVisual(i.a) || i.a.spoiler);
  const jump = (i: MediaItem) => goTo({ serverId, scopeId: scope.id, messageId: i.messageId });
  const empty = !isLoading && (tab === 'media' ? media : files).length === 0;
  return (
    <PanelShell title="Media & files" onClose={onClose}>
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-ae-sunken p-1 text-xs font-semibold">
        {(['media', 'files'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full py-1.5 transition-colors ${tab === t ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:text-ae-text'}`}
          >
            {t === 'media' ? `Photos & videos · ${media.length}` : `Files · ${files.length}`}
          </button>
        ))}
      </div>
      {isLoading && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="ae-skeleton aspect-square rounded" />
          ))}
        </div>
      )}
      {empty && (
        <div className="py-10 text-center text-sm text-ae-muted">
          {tab === 'media' ? <ImageIcon size={28} className="mx-auto opacity-60" /> : <FileIcon size={28} className="mx-auto opacity-60" />}
          <p className="mt-2">{tab === 'media' ? 'No photos or videos yet.' : 'No files yet.'}</p>
        </div>
      )}
      {tab === 'media' ? (
        <ul className="grid grid-cols-3 gap-1">
          {media.map((i, n) => (
            <li key={`${i.messageId}${n}`} className="ae-pop relative aspect-square overflow-hidden rounded bg-ae-sunken" style={{ animationDelay: `${Math.min(n, 18) * 15}ms` }}>
              <button
                type="button"
                title={i.a.alt || i.a.name}
                className="block h-full w-full"
                onClick={() =>
                  i.a.content_type.startsWith('video/')
                    ? jump(i)
                    : openLightbox({ url: i.a.url, alt: i.a.alt, name: i.a.name, messageId: i.messageId, scopeId: scope.id, contentType: i.a.content_type, width: i.a.width, height: i.a.height })
                }
              >
                {i.a.content_type.startsWith('video/') ? (
                  <>
                    <video src={`${i.a.url}#t=0.1`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full object-cover" />
                    <VideoFileIcon size={16} className="absolute right-1 bottom-1 text-white drop-shadow" />
                  </>
                ) : (
                  <img src={i.a.url} alt={i.a.alt ?? ''} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform hover:scale-105" draggable={false} />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1">
          {files.map((i, n) => (
            <li key={`${i.messageId}${n}`}>
              <button type="button" onClick={() => jump(i)} className="flex w-full items-center gap-2.5 rounded-ae p-2 text-left hover:bg-ae-hover">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ae bg-ae-surface text-ae-muted">
                  {i.a.voice || i.a.content_type.startsWith('audio/') ? <AudioFileIcon size={17} /> : <FileIcon size={17} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{i.a.voice ? 'Voice message' : i.a.name}</span>
                  <span className="block truncate text-xs text-ae-muted">
                    {i.authorId && <><DisplayName userId={i.authorId} /> · </>}{formatTime(i.createdAt)}
                    {i.a.voice && i.a.duration ? ` · ${Math.round(i.a.duration)}s` : ` · ${sizeText(i.a.size)}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

/** Adds, replaces or removes a `key:value` filter in the search text. With `multi`, only that exact value is touched. */
function withToken(raw: string, key: string, value: string | null, multi = false): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)${key}:${multi && value ? esc(value) : '\\S+'}(?=\\s|$)`, 'gi');
  const had = re.test(raw);
  re.lastIndex = 0;
  let out = raw.replace(re, ' ');
  if (value && !(multi && had)) out = `${out.trim()} ${key}:${value}`;
  return out.replace(/\s+/g, ' ').trim();
}

const HAS_LABEL: Record<string, string> = { link: 'Links', image: 'Images', video: 'Videos', file: 'Files', voice: 'Voice messages', sticker: 'Stickers', poll: 'Polls' };

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ae-accent/15 py-0.5 pr-1 pl-2.5 text-xs font-semibold text-ae-accent">
      {label}
      <button type="button" aria-label={`Remove ${label}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-ae-accent/25" onClick={onRemove}>
        <CloseIcon size={10} />
      </button>
    </span>
  );
}

export function SearchPanel({ scope, serverId, channels, initial, onClose }: {
  scope: MessageScope;
  serverId: string | null;
  channels: Channel[];
  initial: string;
  onClose: () => void;
}) {
  const e2e = useE2e();
  const [raw, setRaw] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [pages, setPages] = useState(1);
  const [menu, setMenu] = useState<'has' | 'date' | 'in' | null>(null);
  const textChannels = channels.filter((c) => c.type === 'text');
  const encrypted = scope.kind === 'conversation' && e2e.on;
  const key = e2e.key;
  const query: SearchQuery | null = submitted
    ? {
        raw: submitted,
        decrypt: encrypted && key ? (c) => decryptText(key, c) : undefined,
        scope:
          scope.kind === 'conversation'
            ? { kind: 'conversation', id: scope.id }
            : { kind: 'channels', ids: textChannels.map((c) => c.id), names: Object.fromEntries(textChannels.map((c) => [c.id, c.name])) },
      }
    : null;
  const { data, isFetching, isError, error } = useMessageSearch(query, pages);
  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.name;
  const { filters } = parseSearch(raw);

  /** Change the filters and search straight away. */
  const apply = (next: string) => {
    setRaw(next);
    setSubmitted(next.trim());
    setPages(1);
    setMenu(null);
  };
  const askUser = async (label: string, k: 'from' | 'mentions') => {
    const v = await promptText(`${label}: which username?`, { title: label, placeholder: 'username', initial: filters[k] ?? '' });
    if (v !== null) apply(withToken(raw, k, v.trim().replace(/^@/, '') || null));
  };
  const chipBtn = 'rounded-full border border-ae-border px-2.5 py-1 text-xs font-semibold hover:bg-ae-hover';
  const any = filters.from || filters.mentions || filters.in || filters.has.length > 0 || filters.before || filters.after || filters.during || filters.pinned || filters.oldest;

  return (
    <PanelShell title="Search" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(raw);
        }}
      >
        <input
          autoFocus
          className="ae-input w-full text-sm"
          placeholder={scope.kind === 'channel' ? 'Search this server' : 'Search this conversation'}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </form>

      <div className="relative mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={chipBtn} onClick={() => void askUser('From', 'from')}>
          From
        </button>
        <button type="button" className={chipBtn} onClick={() => void askUser('Mentions', 'mentions')}>
          Mentions
        </button>
        {scope.kind === 'channel' && (
          <button type="button" className={chipBtn} onClick={() => setMenu(menu === 'in' ? null : 'in')}>
            In channel
          </button>
        )}
        <button type="button" className={chipBtn} onClick={() => setMenu(menu === 'has' ? null : 'has')}>
          Has
        </button>
        <button type="button" className={chipBtn} onClick={() => setMenu(menu === 'date' ? null : 'date')}>
          Date
        </button>
        <button type="button" className={chipBtn} onClick={() => apply(withToken(raw, 'pinned', filters.pinned ? null : 'true'))}>
          Pinned
        </button>
        {menu === 'has' && (
          <div className="ae-pop absolute top-full left-0 z-10 mt-1 w-48 rounded-ae border border-ae-border bg-ae-elevated p-1 shadow-xl">
            {HAS_KINDS.map((k) => (
              <button key={k} type="button" className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover" onClick={() => apply(withToken(raw, 'has', k, true))}>
                {HAS_LABEL[k]} {filters.has.includes(k) && <span className="text-ae-accent">✓</span>}
              </button>
            ))}
          </div>
        )}
        {menu === 'in' && (
          <div className="ae-pop ae-scroll absolute top-full left-0 z-10 mt-1 max-h-60 w-56 overflow-y-auto rounded-ae border border-ae-border bg-ae-elevated p-1 shadow-xl">
            {textChannels.map((c) => (
              <button key={c.id} type="button" className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover" onClick={() => apply(withToken(raw, 'in', c.name))}>
                # {c.name}
              </button>
            ))}
          </div>
        )}
        {menu === 'date' && (
          <div className="ae-pop absolute top-full left-0 z-10 mt-1 w-60 space-y-2 rounded-ae border border-ae-border bg-ae-elevated p-3 text-xs shadow-xl">
            {(['during', 'after', 'before'] as const).map((k) => (
              <label key={k} className="flex items-center justify-between gap-2">
                <span className="font-semibold">{k === 'during' ? 'On' : k === 'after' ? 'After' : 'Before'}</span>
                <input type="date" className="ae-input w-36 text-xs" value={filters[k] ?? ''} onChange={(e) => apply(withToken(raw, k, e.target.value || null))} />
              </label>
            ))}
          </div>
        )}
      </div>

      {any && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {filters.from && <Chip label={`From @${filters.from}`} onRemove={() => apply(withToken(raw, 'from', null))} />}
          {filters.mentions && <Chip label={`Mentions @${filters.mentions}`} onRemove={() => apply(withToken(raw, 'mentions', null))} />}
          {filters.in && <Chip label={`In #${filters.in}`} onRemove={() => apply(withToken(raw, 'in', null))} />}
          {filters.has.map((h) => (
            <Chip key={h} label={HAS_LABEL[h] ?? h} onRemove={() => apply(withToken(raw, 'has', h, true))} />
          ))}
          {filters.during && <Chip label={`On ${filters.during}`} onRemove={() => apply(withToken(raw, 'during', null))} />}
          {filters.after && <Chip label={`After ${filters.after}`} onRemove={() => apply(withToken(raw, 'after', null))} />}
          {filters.before && <Chip label={`Before ${filters.before}`} onRemove={() => apply(withToken(raw, 'before', null))} />}
          {filters.pinned && <Chip label="Pinned" onRemove={() => apply(withToken(raw, 'pinned', null))} />}
          {filters.oldest && <Chip label="Oldest first" onRemove={() => apply(withToken(raw, 'order', null))} />}
        </div>
      )}

      {encrypted && <p className="mt-2 text-[11px] text-ae-muted">🔒 Encrypted chat: searched on this device (the latest 1,500 messages).</p>}

      {data && (
        <div className="mt-3 mb-2 flex items-center justify-between text-xs font-semibold text-ae-muted">
          <span>{data.more ? `${data.rows.length}+ results` : `${data.rows.length} result${data.rows.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="hover:text-ae-text" onClick={() => apply(withToken(raw, 'order', filters.oldest ? null : 'oldest'))}>
            {filters.oldest ? 'Oldest first' : 'Newest first'} ⇅
          </button>
        </div>
      )}
      {isFetching && <p className="text-sm text-ae-muted">Searching…</p>}
      {isError && <p className="text-sm text-ae-danger">{(error as Error).message}</p>}
      <ul className="space-y-2">
        {data?.rows.map((m) => (
          <ResultCard key={m.id} m={m} serverId={serverId} channelName={scope.kind === 'channel' ? channelName(m.channel_id) : undefined} />
        ))}
      </ul>
      {data?.more && !isFetching && (
        <button type="button" className="mt-3 w-full rounded-ae border border-ae-border py-2 text-sm font-semibold hover:bg-ae-hover" onClick={() => setPages((p) => p + 1)}>
          Load more
        </button>
      )}
    </PanelShell>
  );
}
