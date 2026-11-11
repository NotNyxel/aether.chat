/** Signed-in shell: presence + call providers, server rail, Home or server view, settings, profile popover, ringing. */
import { useEffect, useMemo } from 'react';
import { useChannels, useProfile, useServerMembers, useServers } from '../hooks/useChatData';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { useEventReminders } from '../hooks/useEvents';
import { useChannelById } from '../hooks/useThreads';
import { useAutoIdle, useCustomStatusExpiry, useGameActivity, useTaskbarBadge, useTraySync } from '../hooks/useDesktop';
import { useNotifyResolver } from '../hooks/useNotifications';
import { useKeybinds } from '../hooks/useKeybinds';
import { useUnreadSummary } from '../hooks/useMessageExtras';
import { PresenceProvider } from '../hooks/usePresence';
import { useBlocks, useConversationActions, useConversations, useFriendActions, useFriendships } from '../hooks/useSocialData';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { CallProvider, useCall } from './CallContext';
import { ChannelSidebar } from './ChannelSidebar';
import { isUnread } from './ConversationBits';
import { ConversationView } from './ConversationView';
import { ForwardDialog } from './ForwardDialog';
import { FriendsView } from './FriendsView';
import { HomeSidebar } from './HomeSidebar';
import { IncomingCall } from './IncomingCall';
import { Lightbox } from './Lightbox';
import { ProfilePopover } from './ProfileCard';
import { ServerRail } from './ServerRail';
import { ChannelSettings } from './ChannelSettings';
import { MemberModeration, ServerSettings, useRank } from './ServerSettings';
import { ServerView } from './ServerView';
import { SettingsPanel } from './SettingsPanel';
import { EventsDialog } from './Events';
import { CreateThreadDialog } from './Threads';

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

/** Moderation tools for a member, shown in their profile card while you're viewing the server. */
function ServerMemberTools({ server, me, userId }: { server: Server; me: string; userId: string }) {
  const { data: members = [] } = useServerMembers(server.id);
  const rank = useRank(server, me);
  const member = members.find((m) => m.user_id === userId);
  if (!member) return null;
  return (
    <div className="w-[340px] rounded-ae border border-ae-border bg-ae-elevated p-3">
      <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">In {server.name}</p>
      {member.nickname && <p className="mb-1 text-sm">Nickname: {member.nickname}</p>}
      <MemberModeration server={server} member={member} rank={rank} compact />
    </div>
  );
}

function PopoverForUser({ me, userId, server, onClose }: { me: string; userId: string; server: Server | null; onClose: () => void }) {
  const { data } = useProfile(userId);
  return data ? (
    <ProfilePopover
      profile={data}
      onClose={onClose}
      footer={
        <>
          {server && <ServerMemberTools server={server} me={me} userId={userId} />}
          <ProfileActions me={me} userId={userId} onDone={onClose} />
        </>
      }
    />
  ) : null;
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

  // A link or inbox entry may point at a thread: open its parent channel with the thread beside it.
  const rememberedId = server ? channelByServer[server.id] : undefined;
  const missing = !!server && !!rememberedId && !!channels.data && !channels.data.some((c) => c.id === rememberedId);
  const { data: linked } = useChannelById(missing ? rememberedId! : null);
  const selectChannel = useUiStore((s) => s.selectChannel);
  const openThread = useUiStore((s) => s.openThread);
  useEffect(() => {
    if (!server || !linked?.thread_parent_id || linked.server_id !== server.id) return;
    selectChannel(server.id, linked.thread_parent_id);
    openThread(linked.id);
  }, [linked, openThread, selectChannel, server]);

  const conversation = homeTarget === 'friends' ? null : (conversations.find((c) => c.id === homeTarget) ?? null);
  const { data: unread = [] } = useUnreadSummary();
  const { resolve } = useNotifyResolver();
  const loudDms = conversations.filter((c) => c.id !== conversation?.id && !resolve({ kind: 'conversation', id: c.id }).muted);
  const loudDmIds = new Set(loudDms.map((c) => c.id));
  const homeBadge =
    unread.filter((r) => loudDmIds.has(r.scope_id)).reduce((n, r) => n + r.mention_count, 0) +
    loudDms.filter((c) => isUnread(c, userId) && !unread.some((r) => r.scope_id === c.id && r.mention_count > 0)).length +
    friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  // Taskbar badge: everything that would show a red badge somewhere in the app.
  const serverMentions = unread.filter((r) => r.server_id && r.scope_id !== channel?.id).reduce((n, r) => n + r.mention_count, 0);
  useTaskbarBadge(homeBadge + serverMentions);

  // What the user is looking at right now (drives mark-as-read and notification sounds).
  const viewingScopeId = server ? (channel?.type === 'text' ? channel.id : null) : (conversation?.id ?? null);
  useActivityFeed(userId, viewingScopeId, me?.presence_status);
  useEventReminders(userId, me?.presence_status === 'dnd');

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
          <ServerView server={server} channel={channel} channels={channels.data ?? []} userId={userId} />
        ) : conversation ? (
          <ConversationView key={conversation.id} conv={conversation} userId={userId} />
        ) : (
          <FriendsView userId={userId} />
        )}
      </main>

      <SettingsPanel userId={userId} onSignOut={onSignOut} />
      <IncomingCall userId={userId} silent={me?.presence_status === 'dnd'} />
      <ForwardDialog me={userId} />
      <Lightbox />
      {popoverUserId && <PopoverForUser me={userId} userId={popoverUserId} server={server} onClose={() => showProfile(null)} />}
      <ServerSettings servers={servers.data ?? []} userId={userId} />
      <CreateThreadDialog />
      <EventsDialog servers={servers.data ?? []} channels={channels.data ?? []} userId={userId} />
      <ChannelSettings servers={servers.data ?? []} channels={channels.data ?? []} userId={userId} />
    </div>
  );
}

export function MainLayout({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const { data: me } = useProfile(userId);
  const setProfileAccent = useSettingsStore((s) => s.setProfileAccent);
  useEffect(() => setProfileAccent(me?.accent_color ?? null), [me?.accent_color, setProfileAccent]);
  useTraySync();
  useCustomStatusExpiry(userId, me);
  // Until the profile loads, stay untracked so an "invisible" user never flashes online.
  const status = useAutoIdle(me?.presence_status ?? 'invisible');
  const activity = useGameActivity();

  return (
    <PresenceProvider userId={userId} status={status} activity={activity}>
      <CallProvider userId={userId}>
        <Shell userId={userId} onSignOut={onSignOut} />
      </CallProvider>
    </PresenceProvider>
  );
}
