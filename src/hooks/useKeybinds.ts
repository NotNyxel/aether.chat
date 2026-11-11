/**
 * Keyboard shortcuts for mute, deafen and push-to-talk.
 *
 * On desktop, with "Work in the background" on (Settings → Keybinds), they're registered as
 * system-wide shortcuts so they work while you're in a game or another app. Any combo that can't
 * be registered (another app owns it) falls back to working only while aether.chat is focused.
 * The tray menu's Toggle mute / Toggle deafen are handled here too.
 */
import { useEffect, useRef, useState } from 'react';
import { onTrayAction, registerGlobalShortcuts } from '../lib/desktop';
import { comboHasModifier, isEditableTarget, matchesCombo, matchesMainKey } from '../lib/keybinds';
import { isTauri } from '../lib/platform';
import { useSettingsStore } from '../stores/settingsStore';
import type { VoiceEngine } from './useVoiceEngine';

/** Combos that failed to register globally (shown in Settings). Module-level so Settings can read it. */
let failedGlobal: string[] = [];
const listeners = new Set<() => void>();
export function useFailedGlobalShortcuts(): string[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return failedGlobal;
}

/** True for combos that are safe to grab system-wide: anything with a modifier, or a key nobody types with. */
export function isSafeGlobal(combo: string): boolean {
  return comboHasModifier(combo) || /^(F\d{1,2}|ScrollLock|Pause|Insert|NumpadMultiply|NumpadDivide|NumpadSubtract|NumpadAdd)$/.test(combo);
}

export function useKeybinds(voice: Pick<VoiceEngine, 'status' | 'toggleMute' | 'toggleDeafen' | 'setMuted'>): void {
  const keybinds = useSettingsStore((s) => s.keybinds);
  const globalOn = useSettingsStore((s) => s.system.globalShortcuts) && isTauri;
  const { status, toggleMute, toggleDeafen, setMuted } = voice;
  // Latest callbacks for the long-lived global handlers.
  const actions = useRef({ toggleMute, toggleDeafen, setMuted });
  actions.current = { toggleMute, toggleDeafen, setMuted };
  const [globalCombos, setGlobalCombos] = useState<Set<string>>(new Set());

  const ptt = keybinds.pushToTalkEnabled ? keybinds.pushToTalk : null;

  // System-wide shortcuts.
  useEffect(() => {
    if (!globalOn) {
      setGlobalCombos(new Set());
      return;
    }
    let disposed = false;
    let dispose: (() => Promise<void>) | null = null;
    const bindings = [
      keybinds.toggleMute && { combo: keybinds.toggleMute, onPress: () => actions.current.toggleMute() },
      keybinds.toggleDeafen && { combo: keybinds.toggleDeafen, onPress: () => actions.current.toggleDeafen() },
      ptt && { combo: ptt, onPress: () => actions.current.setMuted(false), onRelease: () => actions.current.setMuted(true) },
    ].filter((b): b is { combo: string; onPress: () => void; onRelease?: () => void } => !!b);
    // Unique combos only (the same combo bound twice would fail the second registration), and only
    // combos that can't swallow normal typing: a global shortcut on a bare letter would stop that
    // letter working in every other app.
    const unique = bindings.filter((b, i) => bindings.findIndex((x) => x.combo === b.combo) === i && isSafeGlobal(b.combo));

    void registerGlobalShortcuts(unique).then((r) => {
      failedGlobal = r.failed;
      listeners.forEach((fn) => fn());
      if (disposed) void r.dispose();
      else {
        dispose = r.dispose;
        setGlobalCombos(new Set(r.registered));
      }
    });
    return () => {
      disposed = true;
      setGlobalCombos(new Set());
      void dispose?.();
    };
  }, [globalOn, keybinds.toggleMute, keybinds.toggleDeafen, ptt]);

  // In-window shortcuts (skipping combos already handled globally, so they don't fire twice).
  useEffect(() => {
    const allowed = (e: KeyboardEvent, combo: string) => !isEditableTarget(e.target) || comboHasModifier(combo);
    const local = (combo: string | null) => (combo && !globalCombos.has(combo) ? combo : null);
    const lPtt = local(ptt);
    const lMute = local(keybinds.toggleMute);
    const lDeafen = local(keybinds.toggleDeafen);

    const onDown = (e: KeyboardEvent) => {
      if (lPtt && matchesCombo(e, lPtt) && allowed(e, lPtt)) {
        e.preventDefault();
        if (!e.repeat) setMuted(false);
        return;
      }
      if (e.repeat) return;
      if (lMute && matchesCombo(e, lMute) && allowed(e, lMute)) {
        e.preventDefault();
        toggleMute();
      } else if (lDeafen && matchesCombo(e, lDeafen) && allowed(e, lDeafen)) {
        e.preventDefault();
        toggleDeafen();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (lPtt && matchesMainKey(e, lPtt)) setMuted(true);
    };
    // Releasing the key in another window never reaches us, so close the mic when focus leaves
    // (unless push-to-talk is global, in which case the release is still delivered).
    const onBlur = () => {
      if (lPtt) setMuted(true);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [keybinds, ptt, globalCombos, setMuted, toggleDeafen, toggleMute]);

  // Tray menu.
  useEffect(() => onTrayAction((a) => (a === 'mute' ? actions.current.toggleMute() : actions.current.toggleDeafen())), []);

  // With push-to-talk enabled, start every voice session muted.
  useEffect(() => {
    if (keybinds.pushToTalkEnabled && keybinds.pushToTalk && status === 'connected') setMuted(true);
  }, [keybinds.pushToTalkEnabled, keybinds.pushToTalk, status, setMuted]);
}
