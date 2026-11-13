/**
 * Touch controls for phones and tablets (web app and Android).
 *   - Press and hold anything that has a right-click menu (messages, people, channels, servers):
 *     opens the same menu, with a little vibration. iOS Safari never fires "contextmenu" on a long
 *     press, so we synthesise one; on Android we swallow the browser's own so it doesn't double up.
 *   - Swipe a message left to reply to it.
 *   - Swipe in from the left edge to go back (channel → list).
 */
import { useUiStore } from '../stores/uiStore';

const HOLD_MS = 450;
const MOVE_TOLERANCE = 10;

let synthesizedAt = 0;

function fireContextMenu(target: EventTarget, x: number, y: number) {
  synthesizedAt = Date.now();
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  (ev as MouseEvent & { aetherTouch?: boolean }).aetherTouch = true;
  target.dispatchEvent(ev);
  navigator.vibrate?.(12);
}

export function installTouchControls(): void {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) return;

  // Safari ignores user-scalable=no: stop pinch zoom ourselves (double-tap zoom is off via touch-action in CSS).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
  // Long-press on images and links: the browser's own menu never shows (ours does).
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as Element;
    if (t.closest('img, a, video') && !(e as MouseEvent & { aetherTouch?: boolean }).aetherTouch && !t.closest('[data-allow-native-menu]')) e.preventDefault();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; t: number; el: Element } | null = null;
  let held = false;
  // Swipe-to-reply state.
  let swipeMsg: HTMLElement | null = null;
  let swiping = false;

  const reset = () => {
    clearTimeout(timer);
    start = null;
    if (swipeMsg) {
      swipeMsg.style.transition = 'transform 160ms ease';
      swipeMsg.style.transform = '';
      const m = swipeMsg;
      setTimeout(() => (m.style.transition = ''), 180);
    }
    swipeMsg = null;
    swiping = false;
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return reset();
      const t = e.touches[0]!;
      const el = e.target as Element;
      // Text fields keep the system's own long-press (select, paste).
      if (el.closest('input, textarea, [contenteditable="true"]')) return;
      held = false;
      start = { x: t.clientX, y: t.clientY, t: Date.now(), el };
      swipeMsg = el.closest('.ae-msg') as HTMLElement | null;
      timer = setTimeout(() => {
        if (!start || swiping) return;
        held = true;
        fireContextMenu(start.el, start.x, start.y);
      }, HOLD_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const t = e.touches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) clearTimeout(timer);
      // Horizontal drag on a message: slide it left to reply.
      if (swipeMsg && !held && (swiping || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5 && dx < 0))) {
        swiping = true;
        swipeMsg.style.transform = `translateX(${Math.max(-90, Math.min(0, dx))}px)`;
      }
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (!start) return;
      const t = e.changedTouches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const fast = Date.now() - start.t < 600;
      // Reply when a message is pulled far enough.
      if (swiping && swipeMsg && dx < -64) {
        swipeMsg.dispatchEvent(new CustomEvent('aether-swipe-reply', { bubbles: true }));
        navigator.vibrate?.(8);
      }
      // Edge swipe back: from the left 24px, rightwards, mostly horizontal.
      if (start.x < 24 && dx > 70 && Math.abs(dy) < 60 && fast) {
        const ui = useUiStore.getState();
        if (ui.mobilePane === 'main') ui.setMobilePane('nav');
      }
      // A long press shouldn't also count as a tap.
      if (held) e.preventDefault();
      reset();
    },
    { passive: false },
  );
  document.addEventListener('touchcancel', reset, { passive: true });

  // Android/Chrome also fire their own contextmenu after a long press: keep only ours.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if ((e as MouseEvent & { aetherTouch?: boolean }).aetherTouch) return;
      if (Date.now() - synthesizedAt < 1000) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  // Swallow the click that follows a long press.
  document.addEventListener(
    'click',
    (e) => {
      if (Date.now() - synthesizedAt < 600) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}
