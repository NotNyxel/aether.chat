/** Signed-in shell: presence + call providers, server rail, Home or server view, settings, profile popover, ringing. */
import { useEffect, useMemo } from 'react';
import { useChannels, useProfile, useServers } from '../hooks/useChatData';
import { useKeybinds } from '../hooks/useKeybinds';
import { PresenceProvider } from '../hooks/usePresence';
import { useBlocks, useConversationActions, useConversations, useFriendActions, useFriendships } from '../hooks/useSocialData';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { Channel } from '../types/db';
import { CallProvider, useCall } from './CallContext';
import { ChannelSidebar } from './ChannelSidebar';
import { isUnread } from './ConversationBits';
import { ConversationView } from './ConversationView';
import { FriendsView } from './FriendsView';
import { HomeSidebar } from './HomeSidebar';
import { IncomingCall } from './IncomingCall';
import { ProfilePopover } from './ProfileCard';
import { ServerRail } from './ServerRail';
import { ServerView } from './ServerView';
import { SettingsPanel } from './SettingsPanel';

function ProfileActions({ me, userId, onDone }: { me: string; userId: string; onDone: () => void }) {
  const { data: friendships = [] } = useFriendships();
  const { data: blocks = [] } = useBlocks();
  const friend = useFriendActions();
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const { data: target } = useProfile(userId);
  if (userId === me) return null;

  const rel = friendships.find((f) => f.requester_id === userId || f.addressee_id === userId);
  const blocked = blocks.some((b) => b.blocked_id === userId);
  const error = friend.send.error ?? friend.accept.error ?? friend.block.error ?? convo.openDm.error;
  const btn = 'flex-1 rounded-ae px-3 py-2 text-sm font-semibold';

  return (
    <div className="w-[340px] space-y-2 rounded-ae border border-ae-border bg-ae-elevated p-2">
      <div className="flex gap-2">
        {!blocked && (
          <button
            type="button"
            className={`${btn} bg-ae-accent text-ae-on-accent`}
            onClick={() =>
              convo.openDm.mutate(userId, {
                onSuccess: (id) => {
                  openHome(id);
                  onDone();
                },
              })
            }
          >
            Message
          </button>
        )}
        {!blocked && !rel && target && (
          <button type="button" className={`${btn} bg-ae-success text-black`} onClick={() => friend.send.mutate(target.username)}>
            Add Friend
          </button>
        )}
        {rel?.status === 'pending' && rel.addressee_id === me && (
          <button type="button" className={`${btn} bg-ae-success text-black`} onClick={() => friend.accept.mutate(userId)}>
            Accept request
          </button>
        )}
        {rel?.status === 'pending' && rel.requester_id === me && <span className={`${btn} bg-ae-surface text-center text-ae-muted`}>Request sent</span>}
        <button
          type="button"
          className={`${btn} flex-none bg-ae-surface ${blocked ? 'text-ae-text' : 'text-ae-danger'}`}
          onClick={() => (blocked ? friend.unblock.mutate(userId) : window.confirm('Block this user?') && friend.block.mutate(userId))}
        >
          {blocked ? 'Unblock' : 'Block'}
        </button>
      </div>
      {error && <p className="px-1 text-xs text-ae-danger">{error.message}</p>}
    </div>
  );
}

function PopoverForUser({ me, userId, onClose }: { me: string; userId: string; onClose: () => void }) {
  const { data } = useProfile(userId);
  return data ? <ProfilePopover profile={data} onClose={onClose} footer={<ProfileActions me={me} userId={userId} onDone={onClose} />} /> : null;
}

function Shell({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const { voice } = useCall();
  useKeybinds(voice);

  const { data: me } = useProfile(userId);
  const view = useUiStore((s) => s.view);
  const homeTarget = useUiStore((s) => s.homeTarget);
  const storedServerId = useUiStore((s) => s.serverId);
  const channelByServer = useUiStore((s) => s.channelByServer);
  const popoverUserId = useUiStore((s) => s.profilePopoverUserId);
  const showProfile = useUiStore((s) => s.showProfile);

  const servers = useServers(userId);
  const { data: conversations = [] } = useConversations();
  const { data: friendships = [] } = useFriendships();

  const server = useMemo(() => {
    if (view !== 'server') return null;
    return (servers.data ?? []).find((s) => s.id === storedServerId) ?? null;
  }, [servers.data, storedServerId, view]);

  const channels = useChannels(server?.id ?? null);
  const channel: Channel | null = useMemo(() => {
    const list = channels.data ?? [];
    const remembered = server ? channelByServer[server.id] : undefined;
    return list.find((c) => c.id === remembered && c.type !== 'category') ?? list.find((c) => c.type === 'text') ?? null;
  }, [channels.data, channelByServer, server]);

  const conversation = homeTarget === 'friends' ? null : (conversations.find((c) => c.id === homeTarget) ?? null);
  const homeBadge =
    conversations.filter((c) => c.id !== conversation?.id && isUnread(c, userId)).length +
    friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;

  return (
    <div className="flex h-full text-ae-text">
      <ServerRail userId={userId} servers={servers.data ?? []} activeId={server?.id ?? null} homeBadge={homeBadge} />

      {server ? (
        <ChannelSidebar userId={userId} server={server} channels={channels.data ?? []} activeChannelId={channel?.id ?? null} />
      ) : (
        <HomeSidebar userId={userId} />
      )}

      <main className="flex min-w-0 flex-1 bg-ae-bg">
        {servers.isError ? (
          <div className="m-auto max-w-md space-y-2 text-center">
            <h2 className="text-lg font-bold">Can't load your data</h2>
            <p className="text-sm text-ae-muted">{servers.error.message}</p>
            <p className="text-sm text-ae-muted">Have supabase/schema.sql and supabase/migrations/002_social.sql been run on this project?</p>
          </div>
        ) : server ? (
          <ServerView server={server} channel={channel} userId={userId} />
        ) : conversation ? (
          <ConversationView key={conversation.id} conv={conversation} userId={userId} />
        ) : (
          <FriendsView userId={userId} />
        )}
      </main>

      <SettingsPanel userId={userId} onSignOut={onSignOut} />
      <IncomingCall userId={userId} silent={me?.presence_status === 'dnd'} />
      {popoverUserId && <PopoverForUser me={userId} userId={popoverUserId} onClose={() => showProfile(null)} />}
    </div>
  );
}

export function MainLayout({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const { data: me } = useProfile(userId);
  const setProfileAccent = useSettingsStore((s) => s.setProfileAccent);
  useEffect(() => setProfileAccent(me?.accent_color ?? null), [me?.accent_color, setProfileAccent]);

  // Until the profile loads, stay untracked so an "invisible" user never flashes online.
  return (
    <PresenceProvider userId={userId} status={me?.presence_status ?? 'invisible'}>
      <CallProvider userId={userId}>
        <Shell userId={userId} onSignOut={onSignOut} />
      </CallProvider>
    </PresenceProvider>
  );
}
