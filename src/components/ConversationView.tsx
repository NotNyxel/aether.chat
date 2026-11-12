/** A DM or group DM: header with call buttons, the in-call panel, chat history and (for groups) members. */
import { ask, promptText } from './ConfirmDialog';
import { useMemo, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { PresenceDot, usePresenceOf } from '../hooks/usePresence';
import { useActiveCalls, useConversationActions, useFriendActions, useRespondRequest } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { useCall } from './CallContext';
import { ConversationAvatar, otherMemberIds, useConversationTitle } from './ConversationBits';
import { GroupDialog } from './GroupDialog';
import { CameraIcon, CrownIcon, LogOutIcon, PhoneIcon, UserPlusIcon, UsersIcon, UserXIcon } from './icons';
import { MessagePane } from './MessagePane';
import { Avatar } from './ProfileCard';
import { VoiceRoom } from './VoiceRoom';
import { useUserMenu } from '../hooks/useUserMenu';
import { useSupabase } from '../lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from './Toaster';

function MemberRow({ userId, owner, conv, me }: { userId: string; owner: boolean; conv: Conversation; me: string }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  const openHome = useUiStore((s) => s.openHome);
  const userMenu = useUserMenu(me);
  const sb = useSupabase();
  const qc = useQueryClient();
  const iOwn = conv.owner_id === me;
  const name = p?.display_name || p?.username || 'them';
  const run = async (fn: string, args: Record<string, string>, ok: string) => {
    const { error } = await sb.rpc(fn, args);
    if (error) return toast.error(error.message);
    toast.success(ok);
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  };
  const menu = (e: React.MouseEvent) =>
    userMenu(e, userId, [
      iOwn && userId !== me && {
        label: 'Make group owner',
        icon: <CrownIcon size={15} />,
        onClick: async () => {
          if (await ask(`Make ${name} the owner of this group? You'll stay in it as a member.`, { confirmLabel: 'Transfer' }))
            await run('transfer_group_owner', { p_conversation_id: conv.id, p_user_id: userId }, `${name} now owns the group.`);
        },
      },
      iOwn && userId !== me && {
        label: 'Remove from group',
        icon: <UserXIcon size={15} />,
        danger: true,
        onClick: async () => {
          if (await ask(`Remove ${name} from the group?`, { danger: true, confirmLabel: 'Remove' }))
            await run('remove_group_member', { p_conversation_id: conv.id, p_user_id: userId }, `${name} was removed.`);
        },
      },
      userId === me && {
        label: 'Leave group',
        icon: <LogOutIcon size={15} />,
        danger: true,
        onClick: async () => {
          if (!(await ask('Leave this group? You can only come back if someone adds you again.', { danger: true, confirmLabel: 'Leave' }))) return;
          const { error } = await sb.rpc('leave_conversation', { p_conversation_id: conv.id });
          if (error) return toast.error(error.message);
          void qc.invalidateQueries({ queryKey: ['conversations'] });
          openHome('friends');
        },
      },
    ]);
  return (
    <li>
      <button
        type="button"
        onContextMenu={menu}
        onClick={() => showProfile(userId)}
        className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover ${status === 'offline' ? 'opacity-50' : ''}`}
      >
        <span className="relative inline-block shrink-0 leading-none">
          <Avatar profile={p} size={32} showFrame={false} />
          <PresenceDot status={status} size={11} className="absolute -right-0.5 -bottom-0.5 z-10" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{p?.display_name || p?.username || '…'}</span>
        {owner && <span title="Group owner"><CrownIcon size={15} className="ae-ico" /></span>}
      </button>
    </li>
  );
}

/** Shown at the top of a DM that's still a message request. */
function RequestBanner({ conv, me, title }: { conv: Conversation; me: string; title: string }) {
  const respond = useRespondRequest();
  const friend = useFriendActions();
  const openHome = useUiStore((s) => s.openHome);
  const other = otherMemberIds(conv, me)[0];
  return (
    <div className="ae-enter flex flex-wrap items-center gap-3 border-b border-ae-border bg-ae-accent/10 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        <b>{title}</b> isn&apos;t your friend yet and wants to message you. Accept to move this into your DMs.
      </span>
      <button type="button" className="ae-press rounded-ae bg-ae-accent px-3 py-1.5 font-semibold text-ae-on-accent" onClick={() => respond.mutate({ id: conv.id, accept: true })}>
        Accept
      </button>
      <button
        type="button"
        className="ae-press rounded-ae bg-ae-surface px-3 py-1.5 hover:bg-ae-hover"
        onClick={() => respond.mutate({ id: conv.id, accept: false }, { onSuccess: () => openHome('friends') })}
      >
        Ignore
      </button>
      {other && (
        <button
          type="button"
          className="ae-press rounded-ae px-3 py-1.5 text-ae-danger hover:bg-ae-hover"
          onClick={async () => {
            if (!(await ask(`Block ${title}? They won't be able to message you.`))) return;
            friend.block.mutate(other, { onSuccess: () => respond.mutate({ id: conv.id, accept: false }, { onSuccess: () => openHome('friends') }) });
          }}
        >
          Block
        </button>
      )}
    </div>
  );
}

export function ConversationView({ conv, userId }: { conv: Conversation; userId: string }) {
  const title = useConversationTitle(conv, userId);
  const { voice, room, callConversation, leave, toggleScreenShare, toggleCamera } = useCall();
  const { data: activeCalls = [] } = useActiveCalls();
  const actions = useConversationActions();
  const [showMembers, setShowMembers] = useState(conv.type === 'group');
  const [adding, setAdding] = useState(false);
  const others = otherMemberIds(conv, userId);
  const dmPartner = usePresenceOf(conv.type === 'dm' ? others[0] : null);

  const scope = useMemo(() => ({ kind: 'conversation' as const, id: conv.id }), [conv.id]);
  const memberIds = useMemo(() => conv.conversation_members.map((m) => m.user_id).filter((id) => id !== userId), [conv.conversation_members, userId]);

  const inThisCall = room?.kind === 'conversation' && room.id === conv.id && voice.status !== 'idle';
  const callActive = activeCalls.some((c) => c.conversation_id === conv.id);

  const header = (
    <>
      <ConversationAvatar conv={conv} me={userId} size={24} />
      <h1
        className="truncate font-semibold"
        title={conv.type === 'group' ? 'Double-click to rename' : undefined}
        onDoubleClick={async () => {
          if (conv.type !== 'group') return;
          const name = await promptText('Group name', { initial: conv.name ?? '', maxLength: 100, placeholder: 'Leave empty to use member names' });
          if (name !== null) actions.rename.mutate({ conversationId: conv.id, name: name.trim() || null });
        }}
      >
        {title}
      </h1>
      {conv.type === 'dm' && <PresenceDot status={dmPartner} size={10} />}
      <div className="ml-auto flex items-center gap-3 text-ae-muted">
        <button type="button" title="Start voice call" className="hover:text-ae-text" onClick={() => callConversation(conv.id, title)}>
          <PhoneIcon size={18} />
        </button>
        <button type="button" title="Start video call" className="hover:text-ae-text" onClick={() => callConversation(conv.id, title, true)}>
          <CameraIcon size={20} />
        </button>
        {conv.type === 'group' && (
          <>
            <button type="button" title="Add friends to group" className="hover:text-ae-text" onClick={() => setAdding(true)}>
              <UserPlusIcon size={18} />
            </button>
            <button
              type="button"
              title="Show member list"
              className={showMembers ? 'text-ae-text' : 'hover:text-ae-text'}
              onClick={() => setShowMembers((s) => !s)}
            >
              <UsersIcon size={18} />
            </button>
          </>
        )}
      </div>
    </>
  );

  const myRow = conv.conversation_members.find((m) => m.user_id === userId);
  const requestBanner = myRow?.request_pending ? (
    <RequestBanner conv={conv} me={userId} title={title} />
  ) : null;

  const top = requestBanner ?? (inThisCall ? (
    <VoiceRoom userId={userId} voice={voice} compact onShareScreen={toggleScreenShare} onToggleCamera={toggleCamera} onLeave={leave} />
  ) : callActive ? (
    <div className="flex items-center justify-between border-b border-ae-border bg-ae-success/10 px-4 py-2 text-sm">
      <span className="flex items-center gap-2">
        <PhoneIcon size={16} className="text-ae-success" /> A call is in progress.
      </span>
      <button type="button" className="rounded-ae bg-ae-success px-3 py-1 text-sm font-semibold text-black" onClick={() => callConversation(conv.id, title)}>
        Join call
      </button>
    </div>
  ) : null);

  const aside =
    conv.type === 'group' && showMembers ? (
      <aside className="ae-memberlist ae-scroll w-60 shrink-0 overflow-y-auto border-l border-ae-border p-3">
        <p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Members — {conv.conversation_members.length}</p>
        <ul className="space-y-0.5">
          {conv.conversation_members.map((m) => (
            <MemberRow key={m.user_id} userId={m.user_id} owner={m.user_id === conv.owner_id} conv={conv} me={userId} />
          ))}
        </ul>
      </aside>
    ) : undefined;

  return (
    <>
      <MessagePane
        key={conv.id}
        scope={scope}
        userId={userId}
        serverId={null}
        memberIds={memberIds}
        header={header}
        top={top}
        aside={aside}
        placeholder={`Message ${conv.type === 'dm' ? '@' : ''}${title}`}
        emptyState={
          <div className="space-y-2">
            <ConversationAvatar conv={conv} me={userId} size={72} />
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-sm text-ae-muted">
              {conv.type === 'dm' ? 'This is the beginning of your direct message history.' : 'Welcome to the beginning of this group.'}
            </p>
          </div>
        }
      />
      {adding && (
        <GroupDialog
          me={userId}
          onClose={() => setAdding(false)}
          existing={{ conversationId: conv.id, memberIds: conv.conversation_members.map((m) => m.user_id) }}
        />
      )}
    </>
  );
}
