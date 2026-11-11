/** Right-click menu for a person (member lists, friends, voice occupants, DM rows). */
import { ask } from '../components/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type MouseEvent } from 'react';
import { openContextMenu, type MenuEntry } from '../components/ContextMenu';
import { openReport } from '../components/ReportDialog';
import { toast } from '../components/Toaster';
import { useUiStore } from '../stores/uiStore';
import type { Friendship, UserBlock, UserProfile } from '../types/db';
import { useConversationActions, useFriendActions } from './useSocialData';

export function useUserMenu(me: string) {
  const qc = useQueryClient();
  const friend = useFriendActions();
  const convo = useConversationActions();
  const showProfile = useUiStore((s) => s.showProfile);
  const openHome = useUiStore((s) => s.openHome);

  return useCallback(
    (e: MouseEvent, userId: string, extra: MenuEntry[] = [], serverId: string | null = null) => {
      const profile = qc.getQueryData<UserProfile | null>(['profile', userId]);
      const rel = qc.getQueryData<Friendship[]>(['friendships'])?.find((f) => f.requester_id === userId || f.addressee_id === userId);
      const blocked = !!qc.getQueryData<UserBlock[]>(['blocks'])?.some((b) => b.blocked_id === userId);
      const self = userId === me;
      const err = (x: Error) => toast.error(x.message);
      openContextMenu(e, [
        { label: 'Profile', icon: '👤', onClick: () => showProfile(userId) },
        !self && !blocked && {
          label: 'Message',
          icon: '💬',
          onClick: () => convo.openDm.mutate(userId, { onSuccess: (id) => openHome(id), onError: err }),
        },
        ...extra,
        'divider',
        !self && !blocked && !rel && profile && {
          label: 'Add friend',
          icon: '➕',
          onClick: () => friend.send.mutate(profile.username, { onSuccess: () => toast.success('Friend request sent.'), onError: err }),
        },
        !self && rel?.status === 'pending' && rel.addressee_id === me && {
          label: 'Accept friend request',
          icon: '✓',
          onClick: () => friend.accept.mutate(userId, { onError: err }),
        },
        !self && rel?.status === 'accepted' && {
          label: 'Remove friend',
          icon: '➖',
          danger: true,
          onClick: async () => (await ask('Remove this friend?')) && friend.remove.mutate(userId, { onError: err }),
        },
        'divider',
        profile && {
          label: 'Copy username',
          icon: '@',
          onClick: () => void navigator.clipboard.writeText(profile.username).then(() => toast('Username copied', '@')),
        },
        { label: 'Copy user ID', icon: '#', onClick: () => void navigator.clipboard.writeText(userId).then(() => toast('ID copied', '#')) },
        'divider',
        !self && { label: 'Report', icon: '⚑', danger: true, onClick: () => openReport({ userId, serverId }) },
        !self && {
          label: blocked ? 'Unblock' : 'Block',
          icon: '⛔',
          danger: !blocked,
          onClick: async () =>
            blocked
              ? friend.unblock.mutate(userId, { onError: err })
              : (await ask('Block this user? They won’t be able to message or call you.')) && friend.block.mutate(userId, { onError: err }),
        },
      ]);
    },
    [convo.openDm, friend, me, openHome, qc, showProfile],
  );
}
