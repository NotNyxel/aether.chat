/**
 * Notification settings for one server, channel or conversation: mute for a duration, the
 * notification level, and @everyone suppression (servers). Used from the bell in message headers
 * and from the server dropdown.
 */
import { useEffect, useRef, useState } from 'react';
import {
  describeMute,
  isMutedRow,
  MUTE_OPTIONS,
  muteUntil,
  useNotificationSettings,
  useSetNotificationSetting,
} from '../hooks/useNotifications';
import type { NotificationLevel, NotificationSetting } from '../types/db';
import { BellIcon, BellOffIcon } from './icons';

export interface NotifyScope {
  kind: NotificationSetting['scope_kind'];
  id: string;
}

const LEVELS: { value: NotificationLevel | null; label: string; hint?: string }[] = [
  { value: null, label: 'Use default' },
  { value: 'all', label: 'All messages' },
  { value: 'mentions', label: 'Only @mentions' },
  { value: 'none', label: 'Nothing', hint: 'No notifications or mention badges' },
];

export function NotificationOptions({ scope, onDone }: { scope: NotifyScope; onDone?: () => void }) {
  const { data: rows = [] } = useNotificationSettings();
  const set = useSetNotificationSetting();
  const row = rows.find((r) => r.scope_id === scope.id);
  const muted = isMutedRow(row);
  const [showMute, setShowMute] = useState(false);
  const save = (patch: Parameters<typeof set.mutate>[0]['patch']) => set.mutate({ scopeId: scope.id, kind: scope.kind, patch });
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover';
  const noun = scope.kind === 'server' ? 'server' : scope.kind === 'channel' ? 'channel' : 'conversation';
  const levels = scope.kind === 'conversation' ? LEVELS.filter((l) => l.value !== 'mentions') : scope.kind === 'server' ? LEVELS.filter((l) => l.value !== null) : LEVELS;
  const currentLevel = row?.level ?? (scope.kind === 'server' ? 'mentions' : null);

  return (
    <div className="space-y-1">
      {muted ? (
        <button type="button" className={item} onClick={() => save({ muted_until: null })}>
          <BellIcon size={15} /> Unmute {noun}
          <span className="ml-auto text-xs text-ae-muted">{describeMute(row)?.replace('Muted', '').trim()}</span>
        </button>
      ) : (
        <>
          <button type="button" className={item} onClick={() => setShowMute((v) => !v)}>
            <BellOffIcon size={15} /> Mute {noun}
            <span className="ml-auto text-ae-muted">{showMute ? '▾' : '▸'}</span>
          </button>
          {showMute && (
            <div className="ml-6 border-l border-ae-border pl-1">
              {MUTE_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={item}
                  onClick={() => {
                    save({ muted_until: muteUntil(o.minutes) });
                    onDone?.();
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="my-1 h-px bg-ae-border" />
      <p className="px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Notify me about</p>
      {levels.map((l) => (
        <button key={String(l.value)} type="button" className={item} onClick={() => save({ level: l.value })}>
          <span
            className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${currentLevel === l.value ? 'border-ae-accent' : 'border-ae-muted'}`}
          >
            {currentLevel === l.value && <span className="h-2 w-2 rounded-full bg-ae-accent" />}
          </span>
          <span>
            {l.label}
            {l.value === null && scope.kind === 'channel' && <span className="block text-xs text-ae-muted">Follow the server setting</span>}
            {l.hint && <span className="block text-xs text-ae-muted">{l.hint}</span>}
          </span>
        </button>
      ))}
      {scope.kind === 'server' && (
        <>
          <div className="my-1 h-px bg-ae-border" />
          <label className={`${item} cursor-pointer`}>
            <input
              type="checkbox"
              className="accent-[var(--ae-accent)]"
              checked={row?.suppress_everyone ?? false}
              onChange={(e) => save({ suppress_everyone: e.target.checked })}
            />
            Suppress @everyone and @here
          </label>
        </>
      )}
      {set.error && <p className="px-2 text-xs text-ae-danger">{set.error.message}</p>}
    </div>
  );
}

/** Bell button with a dropdown; the icon shows a slash while the scope is muted. */
export function NotificationBell({ scope }: { scope: NotifyScope }) {
  const { data: rows = [] } = useNotificationSettings();
  const muted = isMutedRow(rows.find((r) => r.scope_id === scope.id));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={muted ? 'Muted: notification settings' : 'Notification settings'}
        aria-label="Notification settings"
        className={`grid h-7 w-7 place-items-center rounded-ae ${muted ? 'text-ae-danger' : 'text-ae-muted hover:text-ae-text'} ${open ? 'bg-ae-hover' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {muted ? <BellOffIcon size={17} /> : <BellIcon size={17} />}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-2 w-64 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
          <NotificationOptions scope={scope} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
