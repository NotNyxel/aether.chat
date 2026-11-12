/** Right-hand panels for a chat: pinned messages and search results (with jump-to). */
import { useState } from 'react';
import { useMessageSearch, usePinnedMessages, type SearchQuery } from '../hooks/useMessageExtras';
import { Markdown } from '../lib/markdown';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Message, MessageScope } from '../types/db';
import { CloseIcon, PinIcon } from './icons';
import { DisplayName, formatTime } from './MessageItem';

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
        <Markdown source={m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content} className="text-sm" />
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

export function SearchPanel({ scope, serverId, channels, initial, onClose }: {
  scope: MessageScope;
  serverId: string | null;
  channels: Channel[];
  initial: string;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const query: SearchQuery | null = submitted
    ? {
        raw: submitted,
        scope:
          scope.kind === 'conversation'
            ? { kind: 'conversation', id: scope.id }
            : { kind: 'channels', ids: channels.filter((c) => c.type === 'text').map((c) => c.id) },
      }
    : null;
  const { data, isFetching, isError, error } = useMessageSearch(query);
  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.name;

  return (
    <PanelShell title="Search" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(raw.trim());
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
      <p className="mt-1.5 mb-3 text-[11px] leading-relaxed text-ae-muted">
        Filters: <code>from:username</code> <code>has:link</code> <code>has:image</code> <code>has:file</code> <code>has:poll</code>{' '}
        <code>pinned:true</code> <code>before:2026-01-31</code> <code>after:2026-01-01</code>
      </p>
      {isFetching && <p className="text-sm text-ae-muted">Searching…</p>}
      {isError && <p className="text-sm text-ae-danger">{(error as Error).message}</p>}
      {data && !isFetching && (
        <p className="mb-2 text-xs font-semibold text-ae-muted">
          {data.length === 50 ? '50+ results' : `${data.length} result${data.length === 1 ? '' : 's'}`}
        </p>
      )}
      <ul className="space-y-2">
        {data?.map((m) => (
          <ResultCard key={m.id} m={m} serverId={serverId} channelName={scope.kind === 'channel' ? channelName(m.channel_id) : undefined} />
        ))}
      </ul>
    </PanelShell>
  );
}
