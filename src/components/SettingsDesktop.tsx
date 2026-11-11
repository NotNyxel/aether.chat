/**
 * Settings for desktop integration (Batch 3): desktop notifications, the Windows tab (tray, start
 * on boot, auto-idle) and Activity Privacy (opt-in game detection).
 */
import { useEffect, useState } from 'react';
import { isSafeGlobal, useFailedGlobalShortcuts } from '../hooks/useKeybinds';
import { useActivityOf } from '../hooks/usePresence';
import { getAutostart, notify, runningProcesses, setAutostart } from '../lib/desktop';
import { detectGame, KNOWN_GAMES } from '../lib/games';
import { formatCombo } from '../lib/keybinds';
import { isTauri } from '../lib/platform';
import { useSettingsStore } from '../stores/settingsStore';
import { CloseIcon } from './icons';
import { inputCls, Section, Toggle } from './SettingsPanel';

export function DesktopNotificationsSection() {
  const prefs = useSettingsStore((s) => s.notifications);
  const set = useSettingsStore((s) => s.setNotifications);
  const [permission, setPermission] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri && 'Notification' in window) setPermission(Notification.permission);
  }, []);
  return (
    <Section
      title="Desktop notifications"
      description="Shown while aether.chat is in the background, for DMs, mentions and calls. Muted chats and Do Not Disturb never notify. Choose per server, channel or DM with the 🔔 in its header."
    >
      <Toggle label="Enable desktop notifications" checked={prefs.desktop} onChange={(v) => set({ desktop: v })} />
      <Toggle
        label="Show message text"
        hint="Turn off to only show who messaged you, e.g. while screen sharing."
        checked={prefs.showPreview}
        onChange={(v) => set({ showPreview: v })}
      />
      <Toggle
        label="Unread badge on the taskbar"
        hint="A red count on the taskbar icon and in the window title."
        checked={prefs.taskbarBadge}
        onChange={(v) => set({ taskbarBadge: v })}
      />
      <Toggle label="Flash the taskbar on incoming calls" checked={prefs.flashOnCall} onChange={(v) => set({ flashOnCall: v })} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-ae bg-ae-surface px-3 py-1.5 text-sm hover:bg-ae-hover"
          onClick={() => void notify('aether.chat', 'Notifications are working. 🎉').then(() => !isTauri && 'Notification' in window && setPermission(Notification.permission))}
        >
          Send a test notification
        </button>
        {permission === 'denied' && <span className="text-xs text-ae-danger">Blocked by your browser. Allow notifications for this site.</span>}
      </div>
    </Section>
  );
}

/** Extra section on the Keybinds tab. */
export function BackgroundShortcutsSection() {
  const system = useSettingsStore((s) => s.system);
  const setSystem = useSettingsStore((s) => s.setSystem);
  const keybinds = useSettingsStore((s) => s.keybinds);
  const failed = useFailedGlobalShortcuts();
  if (!isTauri) {
    return (
      <Section title="Work in the background">
        <p className="text-sm text-ae-muted">Shortcuts that work while another app is focused are available in the desktop app.</p>
      </Section>
    );
  }
  const combos = [keybinds.toggleMute, keybinds.toggleDeafen, keybinds.pushToTalkEnabled ? keybinds.pushToTalk : null].filter(Boolean) as string[];
  const unsafe = combos.filter((c) => !isSafeGlobal(c));
  return (
    <Section title="Work in the background">
      <Toggle
        label="Shortcuts work while aether.chat isn't focused"
        hint="Mute, deafen and push-to-talk keep working while you're in a game or another app."
        checked={system.globalShortcuts}
        onChange={(v) => setSystem({ globalShortcuts: v })}
      />
      {system.globalShortcuts && unsafe.length > 0 && (
        <p className="text-xs text-ae-warning">
          {unsafe.map(formatCombo).join(', ')} only work{unsafe.length === 1 ? 's' : ''} inside aether.chat: a background shortcut on a key you type
          with would stop that key working in other apps. Add Ctrl, Alt or Shift, or use an F-key.
        </p>
      )}
      {system.globalShortcuts && failed.length > 0 && (
        <p className="text-xs text-ae-danger">
          {failed.map(formatCombo).join(', ')} {failed.length === 1 ? 'is' : 'are'} already taken by another app, so {failed.length === 1 ? 'it only works' : 'they only work'} inside
          aether.chat.
        </p>
      )}
    </Section>
  );
}

export function WindowsTab() {
  const system = useSettingsStore((s) => s.system);
  const setSystem = useSettingsStore((s) => s.setSystem);
  const [boot, setBoot] = useState<boolean | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  useEffect(() => {
    void getAutostart()
      .then(setBoot)
      .catch(() => setBoot(false));
  }, []);

  return (
    <div className="space-y-6">
      {isTauri ? (
        <Section title="System tray">
          <Toggle
            label="Close button minimises to the tray"
            hint="aether.chat keeps running so you still get calls and notifications. Quit from the tray icon's menu."
            checked={system.closeToTray}
            onChange={(v) => setSystem({ closeToTray: v })}
          />
          <Toggle
            label="Open aether.chat when you sign in to Windows"
            hint="Starts quietly in the tray."
            checked={!!boot}
            onChange={(v) => {
              setBootError(null);
              void setAutostart(v)
                .then(() => getAutostart())
                .then(setBoot)
                .catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
            }}
          />
          {bootError && <p className="text-xs text-ae-danger">{bootError}</p>}
        </Section>
      ) : (
        <Section title="System tray">
          <p className="text-sm text-ae-muted">Tray, start on boot and background shortcuts are available in the desktop app.</p>
        </Section>
      )}
      <Section title="Idle" description="While your status is Online, others see you as Idle after this long without keyboard or mouse input.">
        <select className={inputCls} value={system.autoIdleMinutes} onChange={(e) => setSystem({ autoIdleMinutes: Number(e.target.value) })}>
          {[0, 1, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Never go idle automatically' : `After ${m} minute${m === 1 ? '' : 's'}`}
            </option>
          ))}
        </select>
      </Section>
    </div>
  );
}

export function ActivityTab({ userId }: { userId: string }) {
  const activity = useSettingsStore((s) => s.activity);
  const setActivity = useSettingsStore((s) => s.setActivity);
  const current = useActivityOf(userId);
  const [exe, setExe] = useState('');
  const [name, setName] = useState('');
  const [running, setRunning] = useState<string[] | null>(null);

  const add = (e: string, n: string) => {
    const key = e.trim().toLowerCase();
    if (!key) return;
    setActivity({ customGames: [...activity.customGames.filter((g) => g.exe !== key), { exe: key, name: n.trim() || key.replace(/\.exe$/, '') }] });
    setExe('');
    setName('');
  };

  return (
    <div className="space-y-6">
      <Section
        title="Activity status"
        description="Shows the game you're playing to friends and server members, e.g. “Playing VALORANT”. Detection runs on your computer every 30 seconds; only the game's name is shared, and only while you're online."
      >
        {isTauri ? (
          <>
            <Toggle label="Share my activity" checked={activity.shareActivity} onChange={(v) => setActivity({ shareActivity: v })} />
            {activity.shareActivity && (
              <p className="text-sm">
                {current ? (
                  <>
                    🎮 Now playing <b>{current}</b>
                  </>
                ) : (
                  <span className="text-ae-muted">No game detected right now.</span>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ae-muted">Game detection is available in the desktop app.</p>
        )}
      </Section>

      {isTauri && (
        <Section title="Your games" description={`${Object.keys(KNOWN_GAMES).length} popular games are recognised automatically. Add anything else by its .exe name.`}>
          {activity.customGames.length > 0 && (
            <ul className="space-y-1">
              {activity.customGames.map((g) => (
                <li key={g.exe} className="flex items-center gap-2 rounded-ae bg-ae-surface px-3 py-2 text-sm">
                  <span className="font-semibold">{g.name}</span>
                  <span className="font-mono text-xs text-ae-muted">{g.exe}</span>
                  <button
                    type="button"
                    title="Remove"
                    className="ml-auto text-ae-muted hover:text-ae-danger"
                    onClick={() => setActivity({ customGames: activity.customGames.filter((x) => x.exe !== g.exe) })}
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add(exe, name);
            }}
          >
            <input className={inputCls} placeholder="game.exe" value={exe} onChange={(e) => setExe(e.target.value)} />
            <input className={inputCls} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="shrink-0 rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent">
              Add
            </button>
          </form>
          <div>
            <button
              type="button"
              className="rounded-ae bg-ae-surface px-3 py-1.5 text-sm hover:bg-ae-hover"
              onClick={() => void runningProcesses().then((p) => setRunning(p.filter((x) => x.endsWith('.exe'))))}
            >
              {running ? 'Refresh running programs' : 'Pick from running programs'}
            </button>
            {running && (
              <ul className="ae-scroll mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-ae border border-ae-border p-1">
                {running.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs hover:bg-ae-hover"
                      onClick={() => add(p, '')}
                    >
                      {p}
                      {detectGame([p], activity.customGames) && <span className="font-sans text-ae-success">recognised</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
