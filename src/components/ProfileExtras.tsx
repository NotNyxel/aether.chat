/**
 * Under someone's profile card: mutual servers and friends, your private note and friend
 * nickname for them, and a report shortcut.
 */
import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { useMutuals, useNotes, useSaveNote } from '../hooks/useAccount';
import { useFriendships } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import { Avatar } from './ProfileCard';
import { openReport } from './ReportDialog';
import { toast } from './Toaster';

function MutualFriend({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  return (
    <button type="button" data-tip={p?.display_name || p?.username} onClick={() => showProfile(userId)} className="rounded-full ring-2 ring-ae-elevated">
      <Avatar profile={p} size={26} showFrame={false} />
    </button>
  );
}

export function ProfileExtras({ me, userId, serverId }: { me: string; userId: string; serverId: string | null }) {
  const self = me === userId;
  const { servers, friends } = useMutuals(userId, !self);
  const { data: notes = [] } = useNotes();
  const { data: friendships = [] } = useFriendships();
  const save = useSaveNote();
  const selectServer = useUiStore((s) => s.selectServer);
  const showProfile = useUiStore((s) => s.showProfile);
  const existing = notes.find((n) => n.target_id === userId);
  const [note, setNote] = useState(existing?.note ?? '');
  const [nick, setNick] = useState(existing?.nickname ?? '');
  useEffect(() => {
    setNote(existing?.note ?? '');
    setNick(existing?.nickname ?? '');
  }, [existing?.note, existing?.nickname]);
  if (self) return null;
  const isFriend = friendships.some((f) => f.status === 'accepted' && (f.requester_id === userId || f.addressee_id === userId));

  return (
    <div className="w-[340px] space-y-3 rounded-ae border border-ae-border bg-ae-elevated p-3">
      {(servers.length > 0 || friends.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ae-muted">
          {servers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span>
                {servers.length} mutual server{servers.length === 1 ? '' : 's'}
              </span>
              <span className="flex -space-x-1.5">
                {servers.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-tip={s.name}
                    onClick={() => {
                      selectServer(s.id);
                      showProfile(null);
                    }}
                    className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-ae-surface text-[9px] font-bold text-ae-text ring-2 ring-ae-elevated"
                  >
                    {s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2)}
                  </button>
                ))}
              </span>
            </div>
          )}
          {friends.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span>
                {friends.length} mutual friend{friends.length === 1 ? '' : 's'}
              </span>
              <span className="flex -space-x-1.5">
                {friends.slice(0, 5).map((id) => (
                  <MutualFriend key={id} userId={id} />
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      <label className="block">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Note (only you can see it)</span>
        <textarea
          className="mt-1 w-full resize-none rounded-ae border border-transparent bg-ae-sunken px-2 py-1.5 text-sm outline-none focus:border-ae-accent"
          rows={2}
          maxLength={256}
          placeholder="Click to add a note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() =>
            note !== (existing?.note ?? '') &&
            save.mutate({ targetId: userId, note }, { onSuccess: () => toast('Note saved', '📝'), onError: (e) => toast.error(e.message) })
          }
        />
      </label>
      {isFriend && (
        <label className="block">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Friend nickname (only you see it)</span>
          <input
            className="mt-1 w-full rounded-ae border border-transparent bg-ae-sunken px-2 py-1.5 text-sm outline-none focus:border-ae-accent"
            maxLength={32}
            placeholder="Shown in your friends list and DMs"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() =>
              nick !== (existing?.nickname ?? '') &&
              save.mutate({ targetId: userId, nickname: nick }, { onSuccess: () => toast('Nickname saved', '🏷️'), onError: (e) => toast.error(e.message) })
            }
          />
        </label>
      )}
      <button type="button" className="text-xs text-ae-muted hover:text-ae-danger" onClick={() => openReport({ userId, serverId })}>
        ⚑ Report user
      </button>
    </div>
  );
}
