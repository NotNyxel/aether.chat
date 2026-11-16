/** Reminders UI (2.0): the "Remind me" message menu, the due-reminder alert, and Inbox → Reminders. */
import { useCallback } from 'react';
import { parseReminderIn, reminderPresets, useReminderActions, useReminders, useReminderWatcher, whenText, type Reminder } from '../hooks/useReminders';
import { notify } from '../lib/desktop';
import { playSound } from '../lib/sounds';
import { useUiStore } from '../stores/uiStore';
import type { Message } from '../types/db';
import { promptText } from './ConfirmDialog';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { previewText } from './E2eChat';
import { CheckIcon, ClockIcon, TrashIcon } from './icons';
import { DisplayName } from './MessageItem';
import { toast } from './Toaster';

const go = (r: Reminder) => r.scope_id && useUiStore.getState().goTo({ serverId: r.server_id, scopeId: r.scope_id, messageId: r.message_id ?? undefined });
const summary = (r: Reminder) => r.note || previewText(r.messages?.content).slice(0, 140) || (r.messages?.attachments?.length ? 'An attachment' : 'A message you wanted to come back to');

/** Shows reminders when they're due. Mounted once in the main layout. */
export function ReminderWatcher() {
  const onDue = useCallback((r: Reminder) => {
    playSound('mention', true);
    toast(`Reminder: ${summary(r)}`, <ClockIcon size={14} />);
    void notify('Reminder', summary(r), () => go(r));
  }, []);
  useReminderWatcher(onDue);
  return null;
}

/** "Remind me…" for the message menu: opens a second menu with times at the same spot. */
export function useRemindMenuItem() {
  const { add } = useReminderActions();
  return (message: Message, serverId: string | null, at: { x: number; y: number }): MenuItem => ({
    label: 'Remind me…',
    icon: <ClockIcon size={15} />,
    onClick: () => {
      const set = (when: Date) =>
        add.mutate(
          { message, serverId, at: when },
          { onSuccess: () => toast(`I'll remind you ${whenText(when.toISOString()).replace(/^./, (c) => c.toLowerCase())}.`, <ClockIcon size={14} />), onError: (e) => toast.error(e.message) },
        );
      openContextMenu(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y }), [
        ...reminderPresets().map((p) => ({ label: p.label, hint: whenText(p.at.toISOString()).replace(/^(Today|Tomorrow) at /, ''), onClick: () => set(p.at) })),
        'divider',
        {
          label: 'Custom…',
          onClick: async () => {
            const text = await promptText('Remind me in…', { title: 'Custom reminder', placeholder: '45m, 2h, 3 days, 1w', maxLength: 40, confirmLabel: 'Set reminder' });
            if (!text) return;
            const when = parseReminderIn(text);
            if (when) set(when);
            else toast.error('Try something like 45m, 2h or 3 days.');
          },
        },
      ]);
    },
  });
}

function Row({ r }: { r: Reminder }) {
  const { done, remove, snooze } = useReminderActions();
  const due = !r.done_at && new Date(r.remind_at).getTime() <= Date.now();
  return (
    <li className={`group rounded-ae border border-ae-border bg-ae-sunken p-2.5 ${r.done_at ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <ClockIcon size={13} className={due ? 'text-ae-danger' : 'text-ae-accent'} />
        <span className={`font-semibold ${due ? 'text-ae-danger' : ''}`}>{r.done_at ? `Reminded ${whenText(r.remind_at).toLowerCase()}` : whenText(r.remind_at)}</span>
        {r.messages?.author_id && (
          <span className="ml-auto truncate text-ae-muted">
            <DisplayName userId={r.messages.author_id} />
          </span>
        )}
      </div>
      <button type="button" className="block w-full text-left text-sm hover:underline" onClick={() => go(r)}>
        {r.messages ? summary(r) : <span className="text-ae-muted italic">That message was deleted.</span>}
      </button>
      <div className="mt-1.5 flex gap-3 text-xs">
        {r.messages && (
          <button type="button" className="text-ae-accent hover:underline" onClick={() => go(r)}>
            Jump
          </button>
        )}
        {r.done_at ? (
          <button type="button" className="text-ae-muted hover:text-ae-text" onClick={() => snooze.mutate({ id: r.id, at: new Date(Date.now() + 3_600_000) })}>
            Remind again in 1 hour
          </button>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 text-ae-muted hover:text-ae-text" onClick={() => done.mutate(r.id)}>
            <CheckIcon size={12} /> Done
          </button>
        )}
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-ae-muted hover:text-ae-danger" onClick={() => remove.mutate(r.id)}>
          <TrashIcon size={12} /> Delete
        </button>
      </div>
    </li>
  );
}

/** Inbox → Reminders: upcoming first, then the last week's finished ones. */
export function RemindersList() {
  const { data = [], isLoading } = useReminders();
  if (isLoading) return <p className="p-6 text-center text-sm text-ae-muted">Loading…</p>;
  const upcoming = data.filter((r) => !r.done_at);
  const past = data.filter((r) => r.done_at).sort((a, b) => b.remind_at.localeCompare(a.remind_at));
  if (!data.length)
    return (
      <div className="p-8 text-center text-sm text-ae-muted">
        <ClockIcon size={28} className="mx-auto mb-2 opacity-60" />
        No reminders. Right-click a message (or press and hold it) and choose <b>Remind me…</b>
      </div>
    );
  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <ul className="space-y-2">
          {upcoming.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <section>
          <h3 className="mb-2 px-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Earlier</h3>
          <ul className="space-y-2">
            {past.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
