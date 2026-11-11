/**
 * Keybind combos are stored as strings such as "Ctrl+Shift+KeyM". They use physical key codes
 * (KeyboardEvent.code), so a binding survives keyboard-layout switches.
 */

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Builds a combo from a keydown event, or null if only a modifier key is held. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code);
  return parts.join('+');
}

export function comboHasModifier(combo: string): boolean {
  return /^(Ctrl|Alt|Shift|Meta)\+/.test(combo);
}

/** True if the event's main key and modifiers match the combo exactly. */
export function matchesCombo(e: KeyboardEvent, combo: string | null): boolean {
  return !!combo && comboFromEvent(e) === combo;
}

/** For push-to-talk release: compares only the main key, because modifiers may lift first. */
export function matchesMainKey(e: KeyboardEvent, combo: string | null): boolean {
  if (!combo) return false;
  const main = combo.split('+').pop();
  return e.code === main;
}

/** Human-readable label, e.g. "Ctrl+Shift+KeyM" → "Ctrl + Shift + M". */
export function formatCombo(combo: string | null): string {
  if (!combo) return 'Not set';
  return combo
    .split('+')
    .map((part) =>
      part
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Numpad/, 'Num ')
        .replace(/^Arrow/, '')
        .replace('Backquote', '`')
        .replace('Space', 'Space'),
    )
    .join(' + ');
}

/** True when keyboard focus is in a text field, where unmodified keys must reach the field. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
