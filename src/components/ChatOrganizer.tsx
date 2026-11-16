/**
 * Folders, pinning and archive for the chat list (2.0), shared by the desktop sidebar and the
 * phone/tablet Messages screen: the filter chips above the list and the menu items on each chat.
 */
import { organizeChats, useChatFilter, useChatFolders, useChatPrefs, useFolderActions, useSetChatPref } from '../hooks/useChatPrefs';
import type { ButtonHTMLAttributes } from 'react';
import type { Conversation } from '../types/db';
import { ask, promptText } from './ConfirmDialog';
import { openContextMenu, type MenuEntry } from './ContextMenu';
import { ArchiveIcon, CheckIcon, EditIcon, FolderIcon, PinIcon, PinOffIcon, PlusIcon, TrashIcon, UnarchiveIcon } from './icons';
import { toast } from './Toaster';

/** The chats to show right now (current folder / archive, pinned first) and the archive size. */
export function useOrganizedChats(convs: Conversation[]) {
  const prefs = useChatPrefs();
  const folders = useChatFolders();
  let filter = useChatFilter((s) => s.filter);
  // A folder deleted on another device: fall back to everything.
  if (filter !== 'all' && filter !== 'archived' && !folders.some((f) => f.id === filter)) filter = 'all';
  const archivedCount = convs.filter((c) => prefs.get(c.id)?.archived).length;
  return { chats: organizeChats(convs, prefs, filter), filter, archivedCount, prefs };
}

async function newFolder(create: ReturnType<typeof useFolderActions>['create']): Promise<string | null> {
  const name = (await promptText('Name the new folder', { title: 'New folder', placeholder: 'Family, School, Gaming…', maxLength: 32, confirmLabel: 'Create' }))?.trim();
  if (!name) return null;
  try {
    return await create.mutateAsync({ name });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not create the folder.');
    return null;
  }
}

/** Pin / Archive / Move to folder items for a chat's menu. */
export function useChatOrgItems(conv: Conversation) {
  const prefs = useChatPrefs();
  const folders = useChatFolders();
  const setPref = useSetChatPref();
  const { create } = useFolderActions();
  const p = prefs.get(conv.id);
  return (at: { x: number; y: number }): MenuEntry[] => [
    p?.pinned_at
      ? { label: 'Unpin', icon: <PinOffIcon size={15} />, onClick: () => setPref.mutate({ scopeId: conv.id, patch: { pinned_at: null } }) }
      : { label: 'Pin to top', icon: <PinIcon size={15} />, onClick: () => setPref.mutate({ scopeId: conv.id, patch: { pinned_at: new Date().toISOString(), archived: false } }) },
    p?.archived
      ? { label: 'Unarchive', icon: <UnarchiveIcon size={15} />, onClick: () => setPref.mutate({ scopeId: conv.id, patch: { archived: false } }) }
      : {
          label: 'Archive',
          icon: <ArchiveIcon size={15} />,
          onClick: () => {
            setPref.mutate({ scopeId: conv.id, patch: { archived: true, pinned_at: null } });
            toast.success('Chat archived. New messages will still notify you.');
          },
        },
    {
      label: 'Move to folder…',
      icon: <FolderIcon size={15} />,
      hint: folders.find((f) => f.id === p?.folder_id)?.name,
      onClick: () =>
        // Reopen at the same spot with the folder list (the menu has no submenus).
        openContextMenu(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y }), [
          ...folders.map((f) => ({
            label: `${f.emoji ? `${f.emoji} ` : ''}${f.name}`,
            icon: p?.folder_id === f.id ? <CheckIcon size={15} /> : <FolderIcon size={15} />,
            onClick: () => setPref.mutate({ scopeId: conv.id, patch: { folder_id: p?.folder_id === f.id ? null : f.id } }),
          })),
          p?.folder_id && { label: 'Remove from folder', onClick: () => setPref.mutate({ scopeId: conv.id, patch: { folder_id: null } }) },
          folders.length > 0 && 'divider',
          {
            label: 'New folder…',
            icon: <PlusIcon size={15} />,
            onClick: async () => {
              const id = await newFolder(create);
              if (id) setPref.mutate({ scopeId: conv.id, patch: { folder_id: id } });
            },
          },
        ]),
    },
  ];
}

/** All · each folder · Archived. Right-click (long-press) a folder to rename or delete it. */
export function FolderChips({ archivedCount, compact }: { archivedCount: number; compact?: boolean }) {
  const folders = useChatFolders();
  const { filter, setFilter } = useChatFilter();
  const { create, rename, remove } = useFolderActions();
  if (folders.length === 0 && archivedCount === 0) return null;
  const active = filter !== 'all' && filter !== 'archived' && !folders.some((f) => f.id === filter) ? 'all' : filter;
  const chip = (id: string, label: string, extra?: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      key={id}
      type="button"
      aria-pressed={active === id}
      onClick={() => setFilter(id)}
      className={`ae-press shrink-0 rounded-full font-semibold whitespace-nowrap transition-colors ${compact ? 'px-2.5 py-0.5 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'} ${
        active === id ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface text-ae-muted hover:text-ae-text'
      }`}
      {...extra}
    >
      {label}
    </button>
  );
  return (
    <div role="toolbar" aria-label="Chat folders" className={compact ? "flex flex-wrap gap-1" : "ae-scroll flex gap-1.5 overflow-x-auto [scrollbar-width:none]"}>
      {chip('all', 'All')}
      {folders.map((f) =>
        chip(f.id, `${f.emoji ? `${f.emoji} ` : ''}${f.name}`, {
          onContextMenu: (e) =>
            openContextMenu(e, [
              {
                label: 'Rename folder',
                icon: <EditIcon size={15} />,
                onClick: async () => {
                  const name = (await promptText('Folder name', { initial: f.name, maxLength: 32, confirmLabel: 'Save' }))?.trim();
                  if (name && name !== f.name) rename.mutate({ id: f.id, name });
                },
              },
              {
                label: 'Delete folder',
                icon: <TrashIcon size={15} />,
                danger: true,
                onClick: async () => {
                  if (!(await ask(`Delete the folder “${f.name}”? The chats in it stay in All.`, { danger: true, confirmLabel: 'Delete' }))) return;
                  if (active === f.id) setFilter('all');
                  remove.mutate(f.id);
                },
              },
            ]),
        }),
      )}
      {archivedCount > 0 && chip('archived', `Archived · ${archivedCount}`)}
      <button
        type="button"
        aria-label="New folder"
        title="New folder"
        onClick={async () => {
          const id = await newFolder(create);
          if (id) setFilter(id);
        }}
        className={`ae-press grid shrink-0 place-items-center rounded-full bg-ae-surface text-ae-muted hover:text-ae-text ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}
      >
        <PlusIcon size={compact ? 12 : 14} />
      </button>
    </div>
  );
}
