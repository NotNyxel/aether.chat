/** Shared lists panel (2.1): checklists that live in a chat, edited together live. */
import { useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { useMeId } from '../hooks/useMe';
import { useListActions, useSharedLists, type SharedList, type SharedListItem } from '../hooks/useSharedLists';
import { t } from '../lib/i18n';
import { ask } from './ConfirmDialog';
import { ChevronLeftIcon, ListIcon, PlusIcon, TrashIcon } from './icons';
import { PanelShell } from './MessagePanels';
import { toast } from './Toaster';

const fail = (e: Error) => toast.error(e.message);

export function ListsPanel({ scopeId, onClose }: { scopeId: string; onClose: () => void }) {
  const { lists, items, loading } = useSharedLists(scopeId);
  const act = useListActions(scopeId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const open = lists.find((l) => l.id === openId) ?? null;

  if (open) return <ListView list={open} items={items.filter((i) => i.list_id === open.id)} scopeId={scopeId} onBack={() => setOpenId(null)} onClose={onClose} />;

  const create = () => {
    const v = title.trim();
    if (!v) return;
    act.createList.mutate(v, {
      onSuccess: (l) => {
        setTitle('');
        setOpenId(l.id);
      },
      onError: fail,
    });
  };
  return (
    <PanelShell title={t('Lists')} onClose={onClose}>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={t('New list, e.g. Groceries')} className="ae-input min-w-0 flex-1 text-sm" />
        <button type="submit" disabled={!title.trim() || act.createList.isPending} className="rounded-ae bg-ae-accent px-3 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
          {t('Create')}
        </button>
      </form>
      {loading && <p className="text-sm text-ae-muted">{t('Loading…')}</p>}
      {!loading && lists.length === 0 && (
        <div className="py-10 text-center text-sm text-ae-muted">
          <ListIcon size={28} className="ae-ico mx-auto" />
          <p className="mt-2">{t('No lists yet.')}</p>
          <p className="text-xs">{t('Shopping, packing, plans: make a list everyone here can tick off.')}</p>
        </div>
      )}
      <ul className="space-y-1.5">
        {lists.map((l) => {
          const mine = items.filter((i) => i.list_id === l.id);
          const done = mine.filter((i) => i.done).length;
          return (
            <li key={l.id}>
              <button type="button" onClick={() => setOpenId(l.id)} className="ae-press flex w-full items-center gap-3 rounded-ae border border-ae-border bg-ae-surface px-3 py-2.5 text-left hover:border-ae-muted">
                <ListIcon size={16} className="ae-ico shrink-0 text-ae-muted" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.title}</span>
                <span className="text-xs text-ae-muted tabular-nums">
                  {done}/{mine.length}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] text-ae-muted">{t('Lists are not end-to-end encrypted.')}</p>
    </PanelShell>
  );
}

function ListView({ list, items, scopeId, onBack, onClose }: { list: SharedList; items: SharedListItem[]; scopeId: string; onBack: () => void; onClose: () => void }) {
  const act = useListActions(scopeId);
  const me = useMeId();
  const [body, setBody] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const add = () => {
    const v = body.trim();
    if (!v) return;
    setBody('');
    act.addItem.mutate({ listId: list.id, body: v }, { onError: fail });
  };
  const remove = async () => {
    if (await ask(t('Everyone in this chat loses it.'), { title: t('Delete “{name}”?', { name: list.title }), confirmLabel: t('Delete'), danger: true })) {
      act.deleteList.mutate(list.id, { onSuccess: onBack, onError: fail });
    }
  };
  const saveTitle = () => {
    const v = title?.trim();
    setTitle(null);
    if (v && v !== list.title) act.renameList.mutate({ id: list.id, title: v }, { onError: fail });
  };
  return (
    <PanelShell title={t('Lists')} onClose={onClose}>
      <div className="mb-3 flex items-center gap-1">
        <button type="button" aria-label={t('All lists')} onClick={onBack} className="grid h-8 w-8 shrink-0 place-items-center rounded-ae hover:bg-ae-hover">
          <ChevronLeftIcon size={16} />
        </button>
        {title !== null ? (
          <input
            autoFocus
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setTitle(null);
            }}
            className="ae-input min-w-0 flex-1 text-sm font-semibold"
          />
        ) : (
          <button type="button" title={t('Rename')} onClick={() => setTitle(list.title)} className="min-w-0 flex-1 truncate text-left font-semibold">
            {list.title}
          </button>
        )}
        {list.created_by === me && (
          <button type="button" aria-label={t('Delete list')} onClick={() => void remove()} className="grid h-8 w-8 shrink-0 place-items-center rounded-ae text-ae-muted hover:bg-ae-hover hover:text-ae-danger">
            <TrashIcon size={15} />
          </button>
        )}
      </div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={200} placeholder={t('Add an item')} aria-label={t('Add an item')} className="ae-input min-w-0 flex-1 text-sm" />
        <button type="submit" aria-label={t('Add')} disabled={!body.trim()} className="grid w-9 place-items-center rounded-ae bg-ae-accent text-ae-on-accent disabled:opacity-50">
          <PlusIcon size={16} />
        </button>
      </form>
      {items.length === 0 && <p className="py-6 text-center text-sm text-ae-muted">{t('Nothing on this list yet.')}</p>}
      <ul className="space-y-0.5">
        {todo.map((i) => (
          <ItemRow key={i.id} item={i} scopeId={scopeId} />
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <div className="mt-4 mb-1 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">
              {t('Done')} · {done.length}
            </span>
            <button type="button" onClick={() => act.clearDone.mutate(list.id, { onError: fail })} className="text-xs text-ae-muted hover:text-ae-text hover:underline">
              {t('Clear done')}
            </button>
          </div>
          <ul className="space-y-0.5">
            {done.map((i) => (
              <ItemRow key={i.id} item={i} scopeId={scopeId} />
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

function ItemRow({ item, scopeId }: { item: SharedListItem; scopeId: string }) {
  const act = useListActions(scopeId);
  const { data: by } = useProfile(item.done ? item.done_by : null);
  const [edit, setEdit] = useState<string | null>(null);
  const save = () => {
    const v = edit?.trim();
    setEdit(null);
    if (v && v !== item.body) act.editItem.mutate({ id: item.id, body: v }, { onError: fail });
  };
  return (
    <li className="group flex items-center gap-2 rounded-ae px-1.5 py-1 hover:bg-ae-hover">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => act.toggleItem.mutate({ id: item.id, done: e.target.checked }, { onError: fail })}
        aria-label={item.body}
        className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--ae-accent)]"
      />
      {edit !== null ? (
        <input
          autoFocus
          value={edit}
          maxLength={200}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEdit(null);
          }}
          className="ae-input min-w-0 flex-1 py-0.5 text-sm"
        />
      ) : (
        <span
          onDoubleClick={() => setEdit(item.body)}
          title={item.done && by ? t('Ticked by {name}', { name: by.display_name || by.username }) : t('Double-click to edit')}
          className={`min-w-0 flex-1 text-sm break-words ${item.done ? 'text-ae-muted line-through' : ''}`}
        >
          {item.body}
        </span>
      )}
      <button
        type="button"
        aria-label={t('Remove {item}', { item: item.body })}
        onClick={() => act.deleteItem.mutate(item.id, { onError: fail })}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-ae-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ae-danger [@media(hover:none)]:opacity-60"
      >
        <TrashIcon size={13} />
      </button>
    </li>
  );
}
