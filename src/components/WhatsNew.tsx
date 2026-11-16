/**
 * "What's new" after an update, and the first-run tour for new accounts (2.0).
 * Both are per device: the last version you saw is kept in local storage. A brand-new account gets
 * the tour; an existing one that just updated gets the highlights of the new version. Either can
 * be opened again from Settings (the version number) or the You tab.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useProfile } from '../hooks/useChatData';
import { useEscape } from '../lib/escape';
import { isPhoneLayout } from '../lib/phone';
import { useUiStore } from '../stores/uiStore';
import {
  ClockIcon,
  CompassIcon,
  FolderIcon,
  ImageIcon,
  LockIcon,
  MessageIcon,
  MicIcon,
  MoonIcon,
  PaletteIcon,
  RocketIcon,
  ServerIcon,
  ShieldOutlineIcon,
  SparklesIcon,
  TimerIcon,
  UsersIcon,
} from './icons';

const KEY = 'aether.lastSeenVersion';

interface Highlight {
  icon: ReactNode;
  title: string;
  text: string;
}

/** Highlights per release, newest first. Only the current version's list is shown after updating. */
export const RELEASE_NOTES: Record<string, { title: string; items: Highlight[] }> = {
  '2.0.0': {
    title: 'Aether 2.0: out of beta',
    items: [
      { icon: <FolderIcon size={18} />, title: 'Folders, pins and archive', text: 'Pin chats to the top, archive old ones, and sort the rest into folders. Right-click or press and hold a chat.' },
      { icon: <ClockIcon size={18} />, title: 'Reminders', text: 'Remind me… on any message brings it back later. Find them in Inbox → Reminders.' },
      { icon: <TimerIcon size={18} />, title: 'Disappearing messages', text: 'Turn them on in any DM or group with the timer in the header.' },
      { icon: <ImageIcon size={18} />, title: 'Media & files', text: 'Every photo, video and file shared in a chat, in one place.' },
      { icon: <MoonIcon size={18} />, title: 'Quiet hours and chat sounds', text: 'Silence notifications overnight, and give each chat its own sound.' },
      { icon: <MicIcon size={18} />, title: 'New voice messages', text: 'Hold to record, release to send, slide left to lock.' },
      { icon: <ShieldOutlineIcon size={18} />, title: 'Safer accounts', text: 'Passkeys, backup codes, a list of your signed-in devices, and a warning for leaked passwords.' },
      { icon: <SparklesIcon size={18} />, title: 'Hundreds of fixes', text: 'Found a bug? Settings → Report a bug sends it straight to us.' },
    ],
  },
};

const useWhatsNew = create<{ mode: 'news' | 'tour' | null; set: (m: 'news' | 'tour' | null) => void }>()((set) => ({ mode: null, set: (mode) => set({ mode }) }));
export const openWhatsNew = () => useWhatsNew.getState().set('news');
export const openTour = () => useWhatsNew.getState().set('tour');

const major = (v: string) => v.split('.').slice(0, 2).join('.');
function notesFor(version: string) {
  return RELEASE_NOTES[version] ?? Object.entries(RELEASE_NOTES).find(([v]) => major(v) === major(version))?.[1] ?? null;
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return __APP_VERSION__; // storage blocked: never nag
  }
}
function markSeen() {
  try {
    localStorage.setItem(KEY, __APP_VERSION__);
  } catch {
    /* ignore */
  }
}

function Shell({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  useEscape(onClose);
  return (
    <div className="ae-backdrop fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="ae-panel ae-dialog ae-zoom-in ae-scroll max-h-[calc(100dvh-32px)] w-full max-w-md overflow-y-auto rounded-[calc(var(--ae-radius)+8px)] border border-ae-border shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function News({ onClose }: { onClose: () => void }) {
  const notes = notesFor(__APP_VERSION__);
  if (!notes) return null;
  return (
    <Shell onClose={onClose} label="What's new">
      <div className="bg-gradient-to-br from-ae-accent/30 to-transparent px-6 pt-6 pb-4">
        <p className="text-xs font-bold tracking-wide text-ae-accent uppercase">What&apos;s new · v{__APP_VERSION__}</p>
        <h2 className="mt-1 text-xl font-extrabold">{notes.title}</h2>
      </div>
      <ul className="space-y-3 px-6 py-4">
        {notes.items.map((h, i) => (
          <li key={h.title} className="ae-enter flex gap-3" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ae-accent/15 text-ae-accent">{h.icon}</span>
            <span>
              <span className="block text-sm font-semibold">{h.title}</span>
              <span className="block text-[13px] text-ae-muted">{h.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="px-6 pb-6">
        <button type="button" autoFocus className="ae-press w-full rounded-ae bg-ae-accent py-2.5 text-sm font-semibold text-ae-on-accent" onClick={onClose}>
          Got it
        </button>
      </div>
    </Shell>
  );
}

function tourSteps(phone: boolean): Highlight[] {
  return [
    { icon: <RocketIcon size={28} />, title: 'Welcome to Aether', text: 'Chat, call and hang out with your friends. Here’s a 30-second look around.' },
    {
      icon: <MessageIcon size={28} />,
      title: 'Messages',
      text: phone
        ? 'The Messages tab has your DMs and group chats. Tap + to start one, and press and hold a chat to pin, archive or file it in a folder.'
        : 'Your DMs and group chats live under Home (top left). Right-click a chat to pin, archive or file it in a folder.',
    },
    { icon: <UsersIcon size={28} />, title: 'Add friends', text: 'Open Friends and send a request with their username. Friends can call you, add you to groups and see when you’re online.' },
    {
      icon: <ServerIcon size={28} />,
      title: 'Servers',
      text: phone ? 'The Servers tab has your communities. Make your own or explore public ones.' : 'Servers are in the bar on the left. Use + to make your own, or the compass to explore public ones.',
    },
    { icon: <CompassIcon size={28} />, title: 'Calls and voice', text: 'Start a voice or video call from any chat’s header, or hop into a server’s voice channel. Calls are end-to-end encrypted.' },
    { icon: <PaletteIcon size={28} />, title: 'Make it yours', text: 'Edit your profile (decorations, effects, banner) and pick a theme. Everything in Aether can be recoloured.' },
    { icon: <LockIcon size={28} />, title: 'Private by default', text: 'DMs encrypt themselves. Settings → Privacy & Safety controls who can message you, add you to groups and find you.' },
  ];
}

function Tour({ onClose }: { onClose: () => void }) {
  const steps = tourSteps(isPhoneLayout());
  const [i, setI] = useState(0);
  const s = steps[i]!;
  const last = i === steps.length - 1;
  return (
    <Shell onClose={onClose} label="Welcome tour">
      <div key={i} className="ae-enter px-6 pt-8 pb-5 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ae-accent/15 text-ae-accent">{s.icon}</span>
        <h2 className="mt-4 text-xl font-extrabold">{s.title}</h2>
        <p className="mt-2 text-sm text-ae-muted">{s.text}</p>
      </div>
      <div className="flex justify-center gap-1.5 pb-4" aria-hidden>
        {steps.map((_, n) => (
          <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-ae-accent' : 'w-1.5 bg-ae-border'}`} />
        ))}
      </div>
      <div className="flex items-center gap-2 px-6 pb-6">
        {!last && (
          <button type="button" className="rounded-ae px-3 py-2 text-sm text-ae-muted hover:text-ae-text" onClick={onClose}>
            Skip
          </button>
        )}
        <span className="flex-1 text-xs text-ae-muted">
          {i + 1} of {steps.length}
        </span>
        {i > 0 && (
          <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={() => setI(i - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          autoFocus
          className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent"
          onClick={() => {
            if (!last) return setI(i + 1);
            onClose();
            useUiStore.getState().openHome('friends');
          }}
        >
          {last ? 'Let’s go' : 'Next'}
        </button>
      </div>
    </Shell>
  );
}

/** Mounted once in the main layout: decides what to show on start, and shows it when asked. */
export function WhatsNewLayer({ userId }: { userId: string }) {
  const { mode, set } = useWhatsNew();
  const { data: me } = useProfile(userId);
  const created = me?.created_at;
  useEffect(() => {
    if (!created) return;
    const seen = readSeen();
    if (seen === __APP_VERSION__) return;
    // New accounts (made in the last week) get the tour. Everyone else sees what changed when the
    // version moves to a new x.y (patch updates stay quiet). Before 2.0 nothing was stored, so an
    // older account with no stored version is someone updating from 1.x.
    const isNew = Date.now() - Date.parse(created) < 7 * 86_400_000;
    const t = setTimeout(() => {
      if (!seen && isNew) set('tour');
      else if ((!seen || major(seen) !== major(__APP_VERSION__)) && notesFor(__APP_VERSION__)) set('news');
      markSeen();
    }, 1500);
    return () => clearTimeout(t);
  }, [created, set]);
  const close = () => {
    markSeen();
    set(null);
  };
  if (mode === 'news') return <News onClose={close} />;
  if (mode === 'tour') return <Tour onClose={close} />;
  return null;
}
