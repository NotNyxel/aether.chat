/**
 * Pieces shared by the small profile card, the DM side panel and the full profile: action
 * buttons (Message, Add friend, …), your private note and nickname, and mutual friends/servers.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { useMutuals, useNotes, useSaveNote } from '../hooks/useAccount';
import { useProfile } from '../hooks/useChatData';
import { useBlocks, useConversationActions, useFriendActions, useFriendships } from '../hooks/useSocialData';
import { useUserMenu } from '../hooks/useUserMenu';
import { useUiStore } from '../stores/uiStore';
import type { ProfileTab } from './FullProfile';
import { EditIcon, MessageIcon, MoreIcon, TagIcon, UserCheckIcon, UserPlusIcon } from './icons';
import { Avatar, StyledName } from './ProfileCard';
import { toast } from './Toaster';

export function useRelationship(me: string, userId: string) {
  const { data: friendships = [] } = useFriendships();
  const { data: blocks = [] } = useBlocks();
  const rel = friendships.find((f) => f.requester_id === userId || f.addressee_id === userId);
  return {
    rel,
    friends: rel?.status === 'accepted',
    incoming: rel?.status === 'pending' && rel.addressee_id === me,
    outgoing: rel?.status === 'pending' && rel.requester_id === me,
    blocked: blocks.some((b) => b.blocked_id === userId),
  };
}

/** Message / Add friend / ⋯ buttons for someone else's profile. */
export function ProfileActionButtons({ me, userId, onDone }: { me: string; userId: string; onDone?: () => void }) {
  const { data: target } = useProfile(userId);
  const friend = useFriendActions();
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const userMenu = useUserMenu(me);
  const r = useRelationship(me, userId);
  if (userId === me) return null;
  const err = (e: Error) => toast.error(e.message);
  const pill = 'ae-press flex h-9 items-center gap-1.5 rounded-ae px-3 text-sm font-semibold';

  return (
    <>
      {!r.blocked && (
        <button
          type="button"
          className={`${pill} bg-ae-accent text-ae-on-accent hover:brightness-110`}
          onClick={() => convo.openDm.mutate(userId, { onSuccess: (id) => (openHome(id), onDone?.()), onError: err })}
        >
          <MessageIcon size={16} /> Message
        </button>
      )}
      {!r.blocked && !r.rel && target && (
        <button
          type="button"
          data-tip="Add friend"
          aria-label="Add friend"
          className={`${pill} bg-ae-surface hover:bg-ae-hover`}
          onClick={() => friend.send.mutate(target.username, { onSuccess: () => toast.success('Friend request sent.'), onError: err })}
        >
          <UserPlusIcon size={16} />
        </button>
      )}
      {r.incoming && (
        <button type="button" className={`${pill} bg-ae-success text-black`} onClick={() => friend.accept.mutate(userId, { onError: err })}>
          <UserCheckIcon size={16} /> Accept
        </button>
      )}
      {r.outgoing && <span className={`${pill} bg-ae-surface text-ae-muted`}>Request sent</span>}
      <button
        type="button"
        aria-label="More"
        data-tip="More"
        className={`${pill} bg-ae-surface px-2.5 hover:bg-ae-hover`}
        onClick={(e: MouseEvent) => userMenu(e, userId)}
      >
        <MoreIcon size={18} />
      </button>
    </>
  );
}

/** Your private note (and friend nickname) about someone. */
export function NoteFields({ me, userId }: { me: string; userId: string }) {
  const { data: notes = [] } = useNotes();
  const save = useSaveNote();
  const r = useRelationship(me, userId);
  const existing = notes.find((n) => n.target_id === userId);
  const [note, setNote] = useState(existing?.note ?? '');
  const [nick, setNick] = useState(existing?.nickname ?? '');
  useEffect(() => {
    setNote(existing?.note ?? '');
    setNick(existing?.nickname ?? '');
  }, [existing?.note, existing?.nickname]);
  if (me === userId) return null;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Note</span>
        <textarea
          className="ae-input mt-1 w-full resize-none text-sm"
          rows={2}
          maxLength={256}
          placeholder="Only you can see this"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() =>
            note !== (existing?.note ?? '') &&
            save.mutate({ targetId: userId, note }, { onSuccess: () => toast('Note saved', <EditIcon size={14} />), onError: (e) => toast.error(e.message) })
          }
        />
      </label>
      {r.friends && (
        <label className="block">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Friend nickname</span>
          <input
            className="ae-input mt-1 w-full text-sm"
            maxLength={32}
            placeholder="Only you see it"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() =>
              nick !== (existing?.nickname ?? '') &&
              save.mutate({ targetId: userId, nickname: nick }, { onSuccess: () => toast('Nickname saved', <TagIcon size={14} />), onError: (e) => toast.error(e.message) })
            }
          />
        </label>
      )}
    </div>
  );
}

function FriendRow({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const peekProfile = useUiStore((s) => s.peekProfile);
  return (
    <button type="button" onClick={() => peekProfile(userId)} className="flex w-full items-center gap-3 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover">
      <Avatar profile={p} size={32} showFrame={false} />
      <span className="min-w-0 flex-1">
        <StyledName profile={p} className="block truncate text-sm font-semibold" />
        <span className="block truncate text-xs text-ae-muted">{p?.username}</span>
      </span>
    </button>
  );
}

export function useMutualTabs(me: string, userId: string): { tabs: ProfileTab[]; servers: number; friends: string[] } {
  const self = me === userId;
  const { servers, friends } = useMutuals(userId, !self);
  const selectServer = useUiStore((s) => s.selectServer);
  const showProfile = useUiStore((s) => s.showProfile);
  if (self) return { tabs: [], servers: 0, friends: [] };
  return {
    servers: servers.length,
    friends,
    tabs: [
      {
        id: 'friends',
        label: `Mutual Friends${friends.length ? ` (${friends.length})` : ''}`,
        content: friends.length ? (
          <div className="space-y-0.5">
            {friends.map((id) => (
              <FriendRow key={id} userId={id} />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-ae-muted">No friends in common.</p>
        ),
      },
      {
        id: 'servers',
        label: `Mutual Servers${servers.length ? ` (${servers.length})` : ''}`,
        content: servers.length ? (
          <div className="space-y-0.5">
            {servers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  selectServer(s.id);
                  showProfile(null);
                }}
                className="flex w-full items-center gap-3 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-ae-surface text-[11px] font-bold">
                  {s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2)}
                </span>
                <span className="truncate text-sm font-semibold">{s.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-ae-muted">No servers in common.</p>
        ),
      },
    ],
  };
}

/** "3 Mutual Friends • 2 Mutual Servers" with a few faces. */
export function MutualSummary({ me, userId, onOpen }: { me: string; userId: string; onOpen?: (tab: 'friends' | 'servers') => void }) {
  const { servers, friends } = useMutuals(userId, me !== userId);
  if (me === userId || (!servers.length && !friends.length)) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ae-muted">
      {friends.length > 0 && (
        <button type="button" className="flex items-center gap-1.5 hover:text-ae-text hover:underline" onClick={() => onOpen?.('friends')}>
          <span className="flex -space-x-1.5">
            {friends.slice(0, 3).map((id) => (
              <MiniFace key={id} userId={id} />
            ))}
          </span>
          {friends.length} Mutual Friend{friends.length === 1 ? '' : 's'}
        </button>
      )}
      {friends.length > 0 && servers.length > 0 && <span>•</span>}
      {servers.length > 0 && (
        <button type="button" className="hover:text-ae-text hover:underline" onClick={() => onOpen?.('servers')}>
          {servers.length} Mutual Server{servers.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function MiniFace({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  return (
    <span className="rounded-full ring-2 ring-ae-elevated">
      <Avatar profile={p} size={16} showFrame={false} />
    </span>
  );
}
