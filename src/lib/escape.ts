/**
 * One Escape key for the whole app. Every window, dialog, popover and side panel registers here
 * while it's open; Escape closes only the one on top (the most recently opened), never the
 * settings page or dialog underneath it. Menus and pickers that grab Escape themselves (capture
 * listeners that stop propagation) still win, and a text field that handles Escape (and calls
 * preventDefault) keeps it.
 */
import { useEffect, useRef } from 'react';

const stack: { current: () => void }[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || stack.length === 0) return;
    e.preventDefault();
    stack[stack.length - 1]!.current();
  });
}

/** Calls `onEscape` when Escape is pressed and this is the topmost open layer. */
export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
