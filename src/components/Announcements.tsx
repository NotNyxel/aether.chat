/**
 * Announcement channels: "Follow" sends published posts from this channel into a text channel of
 * another server you manage. Published messages arrive there marked "📢 From <server> · #channel".
 */
import { useState } from 'react';
import { useChannels, useServers } from '../hooks/useChatData';
import { useAnnouncementActions } from '../hooks/useThreads';
import type { Channel, Server } from '../types/db';
import { Dialog } from './Dialog';
import { inputCls } from './SettingsPanel';

export function FollowButton({ channel, server, userId }: { channel: Channel; server: Server; userId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Follow this channel in another server"
        className="ae-press rounded-ae border border-ae-border px-2 py-1 text-xs hover:border-ae-accent"
        onClick={() => setOpen(true)}
      >
        📢 Follow
      </button>
      {open && <FollowDialog channel={channel} server={server} userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowDialog({ channel, server, userId, onClose }: { channel: Channel; server: Server; userId: string; onClose: () => void }) {
  const { data: servers = [] } = useServers(userId);
  const [serverId, setServerId] = useState<string>('');
  const { data: channels = [] } = useChannels(serverId || null);
  const [targetId, setTargetId] = useState('');
  const { follow } = useAnnouncementActions();
  const targets = channels.filter((c) => c.type === 'text' && c.subtype !== 'forum' && c.subtype !== 'media' && c.id !== channel.id);

  return (
    <Dialog title={`Follow #${channel.name}`} onClose={onClose}>
      <p className="text-sm text-ae-muted">
        Messages published in <b className="text-ae-text">#{channel.name}</b> ({server.name}) will be copied into a channel you choose. You need Manage
        Channels there.
      </p>
      <label className="block space-y-1">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Server</span>
        <select
          className={inputCls}
          value={serverId}
          onChange={(e) => {
            setServerId(e.target.value);
            setTargetId('');
          }}
        >
          <option value="">Choose a server…</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {serverId && (
        <label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Channel</span>
          <select className={inputCls} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a channel…</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {follow.error && <p className="text-xs text-ae-danger">{follow.error.message}</p>}
      {follow.isSuccess && <p className="text-xs text-ae-success">Following! New published posts will appear there.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
          {follow.isSuccess ? 'Done' : 'Cancel'}
        </button>
        {!follow.isSuccess && (
          <button
            type="button"
            disabled={!targetId || follow.isPending}
            onClick={() => follow.mutate({ source: channel.id, target: targetId })}
            className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
          >
            Follow
          </button>
        )}
      </div>
    </Dialog>
  );
}
