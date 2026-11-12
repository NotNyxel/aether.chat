/** Pick friends to start a group DM, or to add to an existing group. */
import { useMemo, useState } from 'react';
import { friendIds, useConversationActions, useFriendships } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import { useProfiles } from './ConversationBits';
import { Dialog } from './Dialog';
import { Avatar } from './ProfileCard';
import { useAppSetting } from '../hooks/useAppSetting';

export function GroupDialog({ me, onClose, existing }: {
  me: string;
  onClose: () => void;
  /** When set, adds to this group instead of creating a new one. */
  existing?: { conversationId: string; memberIds: string[] };
}) {
  const { data: friendships } = useFriendships();
  const actions = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const ids = useMemo(
    () => friendIds(friendships, me).filter((id) => !existing?.memberIds.includes(id)),
    [friendships, me, existing],
  );
  const profiles = useProfiles(ids);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const groupLimit = useAppSetting<number>('group_dm_limit', 10);
  const room = groupLimit - (existing ? existing.memberIds.length : 1);

  const rows = ids
    .map((id, i) => ({ id, p: profiles[i] }))
    .filter(({ p }) => {
      const q = filter.trim().toLowerCase();
      return !q || p?.username.toLowerCase().includes(q) || p?.display_name?.toLowerCase().includes(q);
    });

  const pending = actions.createGroup.isPending || actions.addMember.isPending;
  const error = actions.createGroup.error ?? actions.addMember.error;

  const submit = async () => {
    if (existing) {
      for (const userId of picked) await actions.addMember.mutateAsync({ conversationId: existing.conversationId, userId });
      onClose();
      return;
    }
    // A single pick opens the regular 1:1 DM, like Discord.
    const id =
      picked.length === 1 && !name.trim()
        ? await actions.openDm.mutateAsync(picked[0])
        : await actions.createGroup.mutateAsync({ userIds: picked, name: name.trim() || undefined });
    openHome(id);
    onClose();
  };

  return (
    <Dialog title={existing ? 'Add friends to group' : 'Select friends'} onClose={onClose}>
      <p className="text-xs text-ae-muted">You can add {Math.max(0, room - picked.length)} more friend{room - picked.length === 1 ? '' : 's'}.</p>
      <input
        autoFocus
        className="ae-input w-full text-sm"
        placeholder="Type a friend's username"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="ae-scroll max-h-64 space-y-0.5 overflow-y-auto">
        {rows.length === 0 && <li className="py-4 text-center text-sm text-ae-muted">No friends to add.</li>}
        {rows.map(({ id, p }) => {
          const checked = picked.includes(id);
          return (
            <li key={id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-ae px-2 py-1.5 hover:bg-ae-hover">
                <Avatar profile={p} size={32} showFrame={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p?.display_name || p?.username}</span>
                  <span className="block truncate text-xs text-ae-muted">@{p?.username}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  disabled={!checked && picked.length >= room}
                  onChange={() => setPicked((s) => (checked ? s.filter((x) => x !== id) : [...s, id]))}
                />
              </label>
            </li>
          );
        })}
      </ul>
      {!existing && picked.length > 1 && (
        <input
          className="ae-input w-full text-sm"
          placeholder="Group name (optional)"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      {error && <p className="text-sm text-ae-danger">{error.message}</p>}
      <button
        type="button"
        disabled={picked.length === 0 || pending}
        onClick={() => void submit().catch(() => undefined)}
        className="w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
      >
        {pending ? 'Working…' : existing ? 'Add to group' : picked.length > 1 ? 'Create group DM' : 'Create DM'}
      </button>
    </Dialog>
  );
}
