/**
 * The Orbit layout's home (2.1): "Now". Who's around, what your friends are playing or listening
 * to, calls you can join, what you missed, and reminders coming up — instead of a friends list.
 * Everything links straight to the chat, call or person.
 */
import { useMemo } from 'react';
import { useProfile } from '../hooks/useChatData';
import { isRowUnread, useUnreadSummary } from '../hooks/useMessageExtras';
import { useNotifyResolver } from '../hooks/useNotifications';
import { MODE_LABEL, playedFor, useActivityOf, useGameOf, useListeningOf, usePresenceOf, PresenceDot } from '../hooks/usePresence';
import { useAskToJoin } from './ActivityCards';
import { useReminders, whenText } from '../hooks/useReminders';
import { useActiveCalls, useConversations, useFriendships } from '../hooks/useSocialData';
import { AlbumArt, GameArtIcon } from '../lib/activityArt';
import { t } from '../lib/i18n';
import { useUiStore } from '../stores/uiStore';
import type { Conversation, UnreadRow } from '../types/db';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { previewText } from './E2eChat';
import { ClockIcon, HashIcon, PhoneIcon, UsersIcon } from './icons';
import { useChannelNames } from './Inbox';
import { Avatar } from './ProfileCard';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? t('Up late') : h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
}

const card = 'rounded-[18px] border border-ae-border bg-ae-elevated';
const label = 'text-[11px] font-bold tracking-[0.08em] text-ae-muted uppercase';

/** A friend in the top row: their avatar ringed when they're online. */
function FriendBubble({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const peek = useUiStore((s) => s.peekProfile);
  const online = status !== 'offline';
  return (
    <button type="button" className="ae-press flex w-[72px] shrink-0 flex-col items-center gap-2" onClick={(e) => peek(userId, e.currentTarget)}>
      <span className="relative rounded-full" style={{ boxShadow: online ? '0 0 0 3px var(--ae-bg), 0 0 0 5px var(--ae-accent)' : '0 0 0 3px var(--ae-bg), 0 0 0 5px var(--ae-border)' }}>
        <Avatar profile={p} size={56} showFrame={false} />
        <PresenceDot status={status} size={14} className="absolute right-0 bottom-0 ring-[3px] ring-ae-bg" />
      </span>
      <span className={`w-full truncate text-center text-xs ${online ? '' : 'text-ae-muted'}`}>{p?.display_name || p?.username}</span>
    </button>
  );
}

/** One "Active now" card, or nothing when this friend isn't playing or listening. */
export function ActiveCard({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const game = useActivityOf(userId);
  const track = useListeningOf(userId);
  const openDm = useUiStore((s) => s.peekProfile);
  const askToJoin = useAskToJoin();
  const played = useGameOf(userId);
  const name = p?.display_name || p?.username || '';
  if (!game && !track) return null;
  return (
    <article className={`${card} ae-enter flex flex-col gap-3 p-4`}>
      <span className={label}>{game ? t('Playing') : t('Listening')}</span>
      <div className="flex items-center gap-3">
        {game ? <GameArtIcon name={game} size={52} rounded="rounded-[14px]" /> : <AlbumArt title={track!.title} artist={track!.artist} size={52} />}
        <span className="min-w-0">
          <span className="block truncate font-bold">{game ?? track!.title}</span>
          <span className="block truncate text-[13px] text-ae-muted">
            {game ? [name, played && MODE_LABEL[played.mode], played && playedFor(played.since)].filter(Boolean).join(' · ') : `${name} · ${track!.artist}`}
          </span>
        </span>
      </div>
      {game ? (
        <button type="button" className="ae-press self-start rounded-full bg-ae-accent px-3.5 py-1.5 text-xs font-bold text-ae-on-accent" onClick={() => askToJoin(userId, game)}>
          {t('Ask to join')}
        </button>
      ) : (
        <button type="button" className="ae-press self-start rounded-full bg-ae-surface px-3.5 py-1.5 text-xs font-semibold hover:bg-ae-hover" onClick={(e) => openDm(userId, e.currentTarget)}>
          {t('Say hi')}
        </button>
      )}
    </article>
  );
}

/** A call happening in one of your chats. */
export function CallCard({ conv, me }: { conv: Conversation; me: string }) {
  const title = useConversationTitle(conv, me);
  const openHome = useUiStore((s) => s.openHome);
  return (
    <article className={`${card} ae-enter flex flex-col gap-3 p-4`}>
      <span className={label}>{t('In a call')}</span>
      <div className="flex items-center gap-3">
        <ConversationAvatar conv={conv} me={me} size={52} />
        <span className="min-w-0"><span className="block truncate font-bold">{title}</span><span className="block text-[13px] text-ae-success">{t('Call in progress')}</span></span>
      </div>
      <button type="button" className="ae-press flex items-center gap-1.5 self-start rounded-full bg-ae-success px-3.5 py-1.5 text-xs font-bold text-black" onClick={() => openHome(conv.id)}>
        <PhoneIcon size={13} /> {t('Hop in')}
      </button>
    </article>
  );
}

/** A chat with unread messages. */
export function CatchUpRow({ row, conv, me, channelName }: { row: UnreadRow; conv?: Conversation; me: string; channelName?: string }) {
  const goTo = useUiStore((s) => s.goTo);
  const title = useConversationTitle(conv ?? ({ id: row.scope_id, type: 'dm', name: null, conversation_members: [] } as unknown as Conversation), me);
  const when = row.last_message_at ? new Date(row.last_message_at) : null;
  const ago = when ? Math.max(1, Math.round((Date.now() - when.getTime()) / 60_000)) : null;
  return (
    <button
      type="button"
      onClick={() => goTo({ serverId: row.server_id, scopeId: row.scope_id })}
      className="flex w-full items-center gap-3 rounded-[14px] p-2.5 text-left hover:bg-ae-hover"
    >
      {conv ? (
        <ConversationAvatar conv={conv} me={me} size={40} />
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-ae-surface text-ae-muted"><HashIcon size={18} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{conv ? title : `# ${channelName ?? t('channel')}`}</span>
        <span className="block text-[13px] text-ae-muted">
          {row.mention_count > 0 ? t('{n} mentions', { n: row.mention_count }) : t('New messages')}
        </span>
      </span>
      {ago !== null && <span className="text-xs text-ae-muted">{ago < 60 ? `${ago}m` : ago < 1440 ? `${Math.round(ago / 60)}h` : `${Math.round(ago / 1440)}d`}</span>}
    </button>
  );
}

export function OrbitHome({ userId }: { userId: string }) {
  const { data: me } = useProfile(userId);
  const { data: friendships = [] } = useFriendships();
  const { data: conversations = [] } = useConversations();
  const { data: calls = [] } = useActiveCalls();
  const { data: unread = [] } = useUnreadSummary();
  const { data: reminders = [] } = useReminders();
  const { resolve } = useNotifyResolver();
  const openHome = useUiStore((s) => s.openHome);

  const friends = friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const callConvs = calls.map((c) => convById.get(c.conversation_id)).filter(Boolean) as Conversation[];
  const missed = unread
    .filter((r) => isRowUnread(r) && !resolve(r.server_id ? { kind: 'channel', id: r.scope_id, serverId: r.server_id } : { kind: 'conversation', id: r.scope_id }).muted)
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    .slice(0, 6);
  const { data: channelInfo = [] } = useChannelNames(missed.filter((r) => r.server_id).map((r) => r.scope_id));
  const channelName = new Map(channelInfo.map((c) => [c.id, c.name]));
  const upcoming = reminders.filter((r) => !r.done_at).slice(0, 3);

  return (
    <div className="ae-scroll ae-view-in flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <section className={`${card} p-6`}>
        <p className="text-sm text-ae-muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="mt-1 mb-5 text-[30px] leading-tight font-extrabold tracking-tight">
          {greeting()}, {me?.display_name || me?.username}
        </h1>
        {friends.length ? (
          <div className="ae-scroll flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label={t('Friends')}>
            {friends.map((id) => (
              <FriendBubble key={id} userId={id} />
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => openHome('friends')} className="ae-press flex items-center gap-2 rounded-full bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent">
            <UsersIcon size={16} /> {t('Add your first friend')}
          </button>
        )}
      </section>

      <section aria-label={t('Active now')} className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))] empty:hidden">
        {callConvs.map((c) => (
          <CallCard key={c.id} conv={c} me={userId} />
        ))}
        {friends.map((id) => (
          <ActiveCard key={id} userId={id} />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${card} flex flex-col gap-1 p-4`}>
          <div className="flex items-center px-2 pb-2">
            <h2 className="flex-1 text-[17px] font-bold">{t('Catch up')}</h2>
            <button type="button" className="text-[13px] text-ae-accent hover:underline" onClick={() => openHome('friends')}>
              {t('Friends')}
            </button>
          </div>
          {missed.length === 0 && <p className="px-2 pb-3 text-sm text-ae-muted">{t('You’re all caught up.')}</p>}
          {missed.map((r) => (
            <CatchUpRow key={r.scope_id} row={r} conv={convById.get(r.scope_id)} me={userId} channelName={channelName.get(r.scope_id)} />
          ))}
        </section>

        <section className={`${card} flex flex-col gap-2 p-4`}>
          <h2 className="px-2 pb-1 text-[17px] font-bold">{t('Coming up')}</h2>
          {upcoming.length === 0 && <p className="px-2 pb-2 text-sm text-ae-muted">{t('No reminders. Choose “Remind me…” on any message.')}</p>}
          {upcoming.map((r) => (
            <div key={r.id} className="flex gap-3 rounded-[14px] p-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-ae-surface text-ae-accent"><ClockIcon size={17} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{whenText(r.remind_at)}</span>
                <span className="block truncate text-[13px] text-ae-muted">{r.note || previewText(r.messages?.content) || t('A message')}</span>
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
