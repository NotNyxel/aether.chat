/** Birthdays (2.1): the setting, the line on profiles, and the "coming up" card on the friends page. */
import { useState } from 'react';
import { daysUntil, formatBirthday, useBirthdayOf, useFriendBirthdays, useMyBirthday, useSaveBirthday, type Birthday } from '../hooks/useBirthdays';
import { useProfile } from '../hooks/useChatData';
import { useConversationActions } from '../hooks/useSocialData';
import { t } from '../lib/i18n';
import { useUiStore } from '../stores/uiStore';
import { CakeIcon } from './icons';
import { Avatar } from './ProfileCard';
import { prefillDraft } from './ScheduledMessages';
import { inputCls, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }));
const daysIn = (m: number) => (m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31);

export function BirthdaySettings() {
  const { data: mine } = useMyBirthday();
  const save = useSaveBirthday();
  const [month, setMonth] = useState<number>(0);
  const [day, setDay] = useState<number>(0);
  const m = month || mine?.month || 0;
  const d = day || mine?.day || 0;
  const visibility = mine?.visibility ?? 'friends';
  const commit = (next: { month?: number; day?: number; visibility?: 'friends' | 'nobody' }) => {
    const nm = next.month ?? m;
    const nd = Math.min(next.day ?? d, nm ? daysIn(nm) : 31);
    if (!nm || !nd) return;
    save.mutate({ month: nm, day: nd, visibility: next.visibility ?? visibility }, { onError: (e) => toast.error(e.message) });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('Month')}
          className={`${inputCls} w-auto`}
          value={m}
          onChange={(e) => {
            setMonth(Number(e.target.value));
            commit({ month: Number(e.target.value) });
          }}
        >
          <option value={0} disabled>
            {t('Month')}
          </option>
          {MONTHS.map((name, i) => (
            <option key={i} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('Day')}
          className={`${inputCls} w-auto`}
          value={d}
          onChange={(e) => {
            setDay(Number(e.target.value));
            commit({ day: Number(e.target.value) });
          }}
        >
          <option value={0} disabled>
            {t('Day')}
          </option>
          {Array.from({ length: m ? daysIn(m) : 31 }, (_, i) => (
            <option key={i} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        {mine && (
          <button
            type="button"
            className="rounded-ae px-3 py-2 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text"
            onClick={() => {
              setMonth(0);
              setDay(0);
              save.mutate(null);
            }}
          >
            {t('Remove')}
          </button>
        )}
      </div>
      {mine && (
        <Toggle
          label={t('Let my friends see it')}
          hint={t('They get a reminder on the day. Only the month and day are saved, never the year.')}
          checked={visibility === 'friends'}
          onChange={(v) => commit({ visibility: v ? 'friends' : 'nobody' })}
        />
      )}
    </div>
  );
}

/** "March 14" (with a cake) on a profile (only when you can see it). */
export function BirthdayLine({ userId, className = '' }: { userId: string; className?: string }) {
  const b = useBirthdayOf(userId);
  if (!b) return null;
  const n = daysUntil(b);
  return (
    <p className={`flex items-center gap-1.5 text-sm ${className}`}>
      <CakeIcon size={14} className="ae-ico text-ae-muted" /> {formatBirthday(b)}
      {n === 0 ? <span className="font-semibold text-ae-accent">· {t('Today!')}</span> : n <= 7 ? <span className="text-ae-muted">· {n === 1 ? t('tomorrow') : t('in {n} days', { n })}</span> : null}
    </p>
  );
}

/** Friends with a birthday today or in the next week. */
export function UpcomingBirthdays({ className = '' }: { className?: string }) {
  const { data } = useFriendBirthdays();
  const soon = [...(data ?? new Map<string, Birthday>()).entries()]
    .map(([userId, b]) => ({ userId, b, n: daysUntil(b) }))
    .filter((x) => x.n <= 7)
    .sort((a, b) => a.n - b.n);
  if (soon.length === 0) return null;
  return (
    <section className={`rounded-ae border border-ae-border bg-ae-surface p-3 ${className}`} aria-label={t('Birthdays')}>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
        <CakeIcon size={13} className="ae-ico" /> {t('Birthdays')}
      </h3>
      <ul className="space-y-1">
        {soon.map((x) => (
          <BirthdayRow key={x.userId} userId={x.userId} b={x.b} n={x.n} />
        ))}
      </ul>
    </section>
  );
}

function BirthdayRow({ userId, b, n }: { userId: string; b: Birthday; n: number }) {
  const { data: p } = useProfile(userId);
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const name = p?.display_name || p?.username || '';
  const wish = () =>
    convo.openDm.mutate(userId, {
      onSuccess: (id) => {
        prefillDraft(id, t('Happy birthday, {name}! 🎉', { name }));
        openHome(id);
      },
      onError: (e) => toast.error(e.message),
    });
  return (
    <li className="flex items-center gap-3 rounded-ae px-1 py-1">
      <Avatar profile={p} size={32} showFrame={false} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-xs text-ae-muted">{n === 0 ? t('Birthday today!') : `${formatBirthday(b)} · ${n === 1 ? t('tomorrow') : t('in {n} days', { n })}`}</p>
      </div>
      {n === 0 && (
        <button type="button" className="ae-press rounded-full bg-ae-accent px-3 py-1.5 text-xs font-bold text-ae-on-accent" onClick={wish}>
          {t('Say happy birthday')}
        </button>
      )}
    </li>
  );
}
