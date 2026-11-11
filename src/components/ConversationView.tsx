/** A DM or group DM: header with call buttons, the in-call panel, chat history and (for groups) members. */
import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { PresenceDot, usePresenceOf } from '../hooks/usePresence';
import { useActiveCalls, useConversationActions } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { useCall } from './CallContext';
import { ConversationAvatar, otherMemberIds, useConversationTitle } from './ConversationBits';
import { GroupDialog } from './GroupDialog';
import { CameraIcon, PhoneIcon, UserPlusIcon, UsersIcon } from './icons';
import { MessagePane } from './MessagePane';
import { Avatar } from './ProfileCard';
import { VoiceRoom } from './VoiceRoom';

function MemberRow({ userId, owner }: { userId: string; owner: boolean }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  return (
    <li>
      <button
        type="button"
        onClick={() => showProfile(userId)}
        className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover ${status === 'offline' ? 'opacity-50' : ''}`}
      >
        <span className="relative">
          <Avatar profile={p} size={32} showFrame={false} />
          <PresenceDot status={status} size={11} className="absolute -right-0.5 -bottom-0.5 z-10" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{p?.display_name || p?.username || '…'}</span>
        {owner && <span title="Group owner">👑</span>}
      </button>
    </li>
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

  const inThisCall = room?.kind === 'conversation' && room.id === conv.id && voice.status !== 'idle';
  const callActive = activeCalls.some((c) => c.conversation_id === conv.id);

  // Mark the conversation read when it is opened and whenever new messages arrive while it is open.
  const { markRead } = actions;
  useEffect(() => {
    markRead.mutate(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, conv.last_message_at]);

  const header = (
    <>
      <ConversationAvatar conv={conv} me={userId} size={24} />
      <h1
        className="truncate font-semibold"
        title={conv.type === 'group' ? 'Double-click to rename' : undefined}
        onDoubleClick={() => {
          if (conv.type !== 'group') return;
          const name = window.prompt('Group name', conv.name ?? '');
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

  const top = inThisCall ? (
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
  ) : null;

  const aside =
    conv.type === 'group' && showMembers ? (
      <aside className="ae-scroll w-60 shrink-0 overflow-y-auto border-l border-ae-border p-3">
        <p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Members — {conv.conversation_members.length}</p>
        <ul className="space-y-0.5">
          {conv.conversation_members.map((m) => (
            <MemberRow key={m.user_id} userId={m.user_id} owner={m.user_id === conv.owner_id} />
          ))}
        </ul>
      </aside>
    ) : undefined;

  return (
    <>
      <MessagePane
        key={conv.id}
        scope={{ kind: 'conversation', id: conv.id }}
        userId={userId}
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
