/** Signed-in shell: presence + call providers, server rail, Home or server view, settings, profile popover, ringing. */
import { AddServerDialog } from './Invites';
import { InboxButton } from './Inbox';
import { QuickSwitcher, QuickSwitcherButton } from './QuickSwitcher';
import { TitleBar, WindowFrame } from './TitleBar';
import { NoteFields, ProfileActionButtons, useMutualTabs } from './ProfileParts';
import { ProfilePeekLayer, useServerProfile } from './ProfilePeek';
import { ReportDialog } from './ReportDialog';
import { MeContext } from '../hooks/useMe';
import { useEffect, useMemo } from 'react';
import { useChannels, useProfile, useServerMembers, useServers } from '../hooks/useChatData';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { useEventReminders } from '../hooks/useEvents';
import { useChannelById } from '../hooks/useThreads';
import { useAutoIdle, useCustomStatusExpiry, useGameActivity, useSpotifyListening, useTaskbarBadge, useTraySync } from '../hooks/useDesktop';
import { useNotifyResolver } from '../hooks/useNotifications';
import { useKeybinds } from '../hooks/useKeybinds';
import { useUnreadSummary } from '../hooks/useMessageExtras';
import { PresenceProvider } from '../hooks/usePresence';
import { useConversations, useFriendships } from '../hooks/useSocialData';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { CallProvider, useCall } from './CallContext';
import { ChannelSidebar } from './ChannelSidebar';
import { isUnread } from './ConversationBits';
import { ConversationView } from './ConversationView';
import { ForwardDialog } from './ForwardDialog';
import { FriendsView, MessageRequestsView } from './FriendsView';
import { HomeSidebar } from './HomeSidebar';
import { IncomingCall } from './IncomingCall';
import { Lightbox } from './Lightbox';
import { FullProfileModal } from './FullProfile';
import { ServerRail } from './ServerRail';
import { ChannelSettings } from './ChannelSettings';
import { MemberModeration, ServerSettings, useRank } from './ServerSettings';
import { ServerView } from './ServerView';
import { SettingsPanel } from './SettingsPanel';
import { ProfileStudioLayer } from './ProfileStudio';
import { AnnouncementBar } from './AdminPanel';
import { EventsDialog } from './Events';
import { CreateThreadDialog } from './Threads';
import { ArrowLeftIcon as BackIcon } from './icons';
import { ThemeStudio } from './ThemeStudio';
import { ThemeEffectLayer } from './ThemeEffectLayer';

/** Moderation tools for a member, shown in their profile card while you're viewing the server. */
function ServerMemberTools({ server, me, userId }: { server: Server; me: string; userId: string }) {
  const { data: members = [] } = useServerMembers(server.id);
  const rank = useRank(server, me);
  const member = members.find((m) => m.user_id === userId);
  if (!member) return null;
  return (
    <div className="rounded-ae bg-ae-sunken/60 p-3">
      <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">In {server.name}</p>
      {member.nickname && <p className="mb-1 text-sm">Nickname: {member.nickname}</p>}
      <MemberModeration server={server} member={member} rank={rank} compact />
    </div>
  );
}

function PopoverForUser({ me, userId, server, onClose }: { me: string; userId: string; server: Server | null; onClose: () => void }) {
  const profile = useServerProfile(userId, server?.id ?? null);
  const { tabs } = useMutualTabs(me, userId);
  if (!profile) return null;
  return (
    <FullProfileModal
      profile={profile}
      onClose={onClose}
      actions={<ProfileActionButtons me={me} userId={userId} onDone={onClose} />}
      extraTabs={tabs}
      aboutExtra={
        me !== userId ? (
          <>
            {server && <ServerMemberTools server={server} me={me} userId={userId} />}
            <NoteFields me={me} userId={userId} />
          </>
        ) : undefined
      }
    />
  );
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
  const mobilePane = useUiStore((s) => s.mobilePane);
  const setMobilePane = useUiStore((s) => s.setMobilePane);

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
  const loudDms = conversations.filter(
    (c) =>
      c.id !== conversation?.id &&
      !resolve({ kind: 'conversation', id: c.id }).muted &&
      !c.conversation_members.find((m) => m.user_id === userId)?.request_pending,
  );
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
    <WindowFrame
      bar={
        <TitleBar
          title={server ? server.name : conversation ? 'Direct messages' : homeTarget === 'requests' ? 'Message requests' : 'Friends'}
          lead={
            mobilePane === 'main' && (
              <button type="button" aria-label="Back" className="ae-mobile-only -ml-1 grid h-9 w-9 place-items-center rounded-full text-ae-muted hover:bg-ae-hover" onClick={() => setMobilePane('nav')}>
                <BackIcon size={20} />
              </button>
            )
          }
        >
          <QuickSwitcherButton />
          <InboxButton userId={userId} servers={servers.data ?? []} />
        </TitleBar>
      }
    >
    <div className="flex h-full flex-col text-ae-text">
    <AnnouncementBar />
    <div className="ae-shell flex min-h-0 flex-1" data-pane={mobilePane}>
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
        ) : homeTarget === 'requests' ? (
          <MessageRequestsView userId={userId} />
        ) : (
          <FriendsView userId={userId} />
        )}
      </main>

    </div>
      <SettingsPanel userId={userId} onSignOut={onSignOut} />
      <ProfileStudioLayer userId={userId} />
      <IncomingCall userId={userId} silent={me?.presence_status === 'dnd'} />
      <ForwardDialog me={userId} />
      <Lightbox />
      <ProfilePeekLayer me={userId} server={server} />
      <ThemeStudio />
      <ThemeEffectLayer />
      {popoverUserId && <PopoverForUser me={userId} userId={popoverUserId} server={server} onClose={() => showProfile(null)} />}
      <ServerSettings servers={servers.data ?? []} userId={userId} />
      <CreateThreadDialog />
      <ReportDialog me={userId} />
      <EventsDialog servers={servers.data ?? []} channels={channels.data ?? []} userId={userId} />
      <ChannelSettings servers={servers.data ?? []} channels={channels.data ?? []} userId={userId} />
      <QuickSwitcher userId={userId} servers={servers.data ?? []} />
      <AddServerDialog userId={userId} />
    </div>
    </WindowFrame>
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
  const listening = useSpotifyListening();

  return (
    <MeContext.Provider value={userId}>
    <PresenceProvider userId={userId} status={status} activity={activity} listening={listening}>
      <CallProvider userId={userId}>
        <Shell userId={userId} onSignOut={onSignOut} />
      </CallProvider>
    </PresenceProvider>
    </MeContext.Provider>
  );
}
