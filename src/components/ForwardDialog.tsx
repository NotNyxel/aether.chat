/** Forward a message to any DM, group DM or text channel you can post in, with an optional comment. */
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { unwrap } from '../hooks/useChatData';
import { useForwardMessage } from '../hooks/useMessageExtras';
import { useConversations } from '../hooks/useSocialData';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Conversation, Message, MessageScope, Server } from '../types/db';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { Dialog } from './Dialog';
import { HashIcon } from './icons';

function ConversationOption({ conv, me, checked, onPick }: { conv: Conversation; me: string; checked: boolean; onPick: () => void }) {
  const title = useConversationTitle(conv, me);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-ae px-2 py-1.5 hover:bg-ae-hover">
      <ConversationAvatar conv={conv} me={me} size={28} />
      <span className="flex-1 truncate text-sm">{title}</span>
      <input type="radio" name="fwd" checked={checked} onChange={onPick} />
    </label>
  );
}

export function ForwardDialog({ me }: { me: string }) {
  const messageId = useUiStore((s) => s.forwardMessageId);
  const close = useUiStore((s) => s.openForward);
  const sb = useSupabase();
  const qc = useQueryClient();
  const forward = useForwardMessage();
  const { data: conversations = [] } = useConversations();
  const servers = qc.getQueryData<Server[]>(['servers', me]) ?? [];
  const { data: channels = [] } = useQuery({
    queryKey: ['all-text-channels'],
    enabled: !!messageId,
    queryFn: async () => unwrap(await sb.from('channels').select('*').eq('type', 'text').order('position')) as Channel[],
  });
  const [target, setTarget] = useState<MessageScope | null>(null);
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('');

  // The message is in some cached page; find it.
  const message = useMemo(() => {
    if (!messageId) return null;
    for (const [, data] of qc.getQueriesData<InfiniteData<Message[]>>({ queryKey: ['messages'] })) {
      const hit = data?.pages.flat().find((m) => m.id === messageId);
      if (hit) return hit;
    }
    return null;
  }, [messageId, qc]);

  if (!messageId) return null;
  const q = filter.trim().toLowerCase();
  const visibleConvs = conversations.filter((c) => !c.conversation_members.find((m) => m.user_id === me)?.hidden);
  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? 'Server';

  return (
    <Dialog title="Forward to" onClose={() => close(null)}>
      {message && (
        <p className="line-clamp-2 rounded-ae border-l-2 border-ae-border bg-ae-sunken px-3 py-2 text-xs text-ae-muted">
          {message.content || (message.poll ? `📊 ${message.poll.question}` : `${message.attachments.length} attachment(s)`)}
        </p>
      )}
      <input
        autoFocus
        className="w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm outline-none focus:border-ae-accent"
        placeholder="Search channels and DMs"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ae-scroll max-h-72 space-y-0.5 overflow-y-auto">
        {visibleConvs.map((c) => (
          <ConversationOption key={c.id} conv={c} me={me} checked={target?.id === c.id} onPick={() => setTarget({ kind: 'conversation', id: c.id })} />
        ))}
        {channels
          .filter((c) => !q || c.name.includes(q) || serverName(c.server_id).toLowerCase().includes(q))
          .map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-ae px-2 py-1.5 hover:bg-ae-hover">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ae-surface">
                <HashIcon size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {c.name} <span className="text-xs text-ae-muted">· {serverName(c.server_id)}</span>
              </span>
              <input type="radio" name="fwd" checked={target?.id === c.id} onChange={() => setTarget({ kind: 'channel', id: c.id })} />
            </label>
          ))}
      </div>
      <input
        className="w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm outline-none focus:border-ae-accent"
        placeholder="Add an optional message"
        maxLength={2000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {forward.isError && <p className="text-sm text-ae-danger">{forward.error.message}</p>}
      {!message && <p className="text-sm text-ae-danger">That message is no longer loaded. Scroll back to it and try again.</p>}
      <button
        type="button"
        disabled={!target || !message || forward.isPending}
        className="w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
        onClick={() =>
          message &&
          target &&
          forward.mutate(
            { message, target, comment },
            {
              onSuccess: () => {
                close(null);
                setComment('');
                setTarget(null);
              },
            },
          )
        }
      >
        {forward.isPending ? 'Sending…' : 'Send'}
      </button>
    </Dialog>
  );
}
