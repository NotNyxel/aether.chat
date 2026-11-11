/** Window-level keyboard shortcuts for mute, deafen and push-to-talk. */
import { useEffect } from 'react';
import { comboHasModifier, isEditableTarget, matchesCombo, matchesMainKey } from '../lib/keybinds';
import { useSettingsStore } from '../stores/settingsStore';
import type { VoiceEngine } from './useVoiceEngine';

export function useKeybinds(voice: Pick<VoiceEngine, 'status' | 'toggleMute' | 'toggleDeafen' | 'setMuted'>): void {
  const keybinds = useSettingsStore((s) => s.keybinds);
  const { status, toggleMute, toggleDeafen, setMuted } = voice;

  useEffect(() => {
    const allowed = (e: KeyboardEvent, combo: string) => !isEditableTarget(e.target) || comboHasModifier(combo);
    const ptt = keybinds.pushToTalkEnabled ? keybinds.pushToTalk : null;

    const onDown = (e: KeyboardEvent) => {
      if (ptt && matchesCombo(e, ptt) && allowed(e, ptt)) {
        e.preventDefault();
        if (!e.repeat) setMuted(false);
        return;
      }
      if (e.repeat) return;
      if (keybinds.toggleMute && matchesCombo(e, keybinds.toggleMute) && allowed(e, keybinds.toggleMute)) {
        e.preventDefault();
        toggleMute();
      } else if (keybinds.toggleDeafen && matchesCombo(e, keybinds.toggleDeafen) && allowed(e, keybinds.toggleDeafen)) {
        e.preventDefault();
        toggleDeafen();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (ptt && matchesMainKey(e, ptt)) setMuted(true);
    };
    // Releasing the key in another window never reaches us, so close the mic when focus leaves.
    const onBlur = () => {
      if (ptt) setMuted(true);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [keybinds, setMuted, toggleDeafen, toggleMute]);

  // With push-to-talk enabled, start every voice session muted.
  useEffect(() => {
    if (keybinds.pushToTalkEnabled && keybinds.pushToTalk && status === 'connected') setMuted(true);
  }, [keybinds.pushToTalkEnabled, keybinds.pushToTalk, status, setMuted]);
}
