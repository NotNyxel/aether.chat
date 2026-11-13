/**
 * Phones: while you're in a call and looking at something else, a small bubble floats over the app
 * with the call's name and time, mute and hang up. Drag it out of the way; tap it to go back to
 * the call. Also keeps the screen from turning off during a call.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useUiStore } from '../stores/uiStore';
import { useCall } from './CallContext';
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from './icons';

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () =>
      document.visibilityState === 'visible' &&
      void navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

export function CallBubble() {
  const { voice, room, leave } = useCall();
  const mobilePane = useUiStore((s) => s.mobilePane);
  const view = useUiStore((s) => s.view);
  const homeTarget = useUiStore((s) => s.homeTarget);
  const serverId = useUiStore((s) => s.serverId);
  const channelByServer = useUiStore((s) => s.channelByServer);
  const goTo = useUiStore((s) => s.goTo);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({ x: window.innerWidth - 236, y: 72 }));
  const [started] = useState(() => Date.now());
  const [, tick] = useState(0);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const inCall = voice.status !== 'idle' && !!room;
  useWakeLock(inCall);

  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [inCall]);

  if (!inCall || !room) return null;
  const watching =
    mobilePane === 'main' &&
    (room.kind === 'conversation' ? view === 'home' && homeTarget === room.id : view === 'server' && serverId === room.serverId && channelByServer[room.serverId ?? ''] === room.id);
  if (watching) return null;

  const secs = Math.floor((Date.now() - started) / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const open = () => goTo({ serverId: room.kind === 'channel' ? (room.serverId ?? null) : null, scopeId: room.id });

  const down = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(6, Math.min(window.innerWidth - 226, e.clientX - d.dx));
    const y = Math.max(6, Math.min(window.innerHeight - 70, e.clientY - d.dy));
    if (Math.abs(x - pos.x) + Math.abs(y - pos.y) > 3) d.moved = true;
    setPos({ x, y });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) open();
    // Snap to the nearest side.
    else setPos((p) => ({ x: p.x + 110 < window.innerWidth / 2 ? 8 : window.innerWidth - 228, y: p.y }));
  };

  return (
    <div
      className="ae-mobile-only ae-pop fixed z-[70] w-[220px] touch-none items-center gap-2 rounded-full border border-ae-border bg-ae-elevated py-1.5 pr-1.5 pl-2 shadow-2xl select-none"
      style={{ left: pos.x, top: pos.y, transition: drag.current ? 'none' : 'left 180ms ease' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      role="button"
      aria-label={`Back to the call in ${room.name}`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${voice.status === 'connected' ? 'bg-ae-success/20 text-ae-success' : 'bg-ae-warning/20 text-ae-warning'}`}>
        <PhoneIcon size={15} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-semibold">{room.name}</span>
        <span className="block text-[11px] text-ae-muted tabular-nums">{voice.status === 'connected' ? time : 'Connecting…'}</span>
      </span>
      <button
        type="button"
        data-no-drag
        aria-label={voice.isMuted ? 'Unmute' : 'Mute'}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${voice.isMuted ? 'bg-ae-danger/20 text-ae-danger' : 'bg-ae-surface text-ae-text'}`}
        onClick={() => voice.toggleMute()}
      >
        {voice.isMuted ? <MicOffIcon size={15} /> : <MicIcon size={15} />}
      </button>
      <button type="button" data-no-drag aria-label="Hang up" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ae-danger text-white" onClick={leave}>
        <PhoneOffIcon size={15} />
      </button>
    </div>
  );
}
