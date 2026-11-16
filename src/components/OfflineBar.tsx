/**
 * Offline mode (2.0): a small notice while the device has no connection. Saved chats stay
 * readable, and messages you send wait on this device and go out when the connection is back.
 */
import { useEffect, useState } from 'react';
import { onOutboxChange, readOutbox } from '../lib/outbox';
import { WifiOffIcon } from './icons';

export function OfflineBar({ userId }: { userId: string }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState(() => readOutbox(userId).length);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const stop = onOutboxChange(() => setWaiting(readOutbox(userId).length));
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      stop();
    };
  }, [userId]);
  if (online && !waiting) return null;
  return (
    <div role="status" className="ae-enter pointer-events-none fixed top-[max(48px,calc(env(safe-area-inset-top)+8px))] left-1/2 z-[90] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-ae-border bg-ae-elevated/95 px-3.5 py-1.5 text-xs shadow-xl backdrop-blur">
        <WifiOffIcon size={14} className={online ? 'text-ae-accent' : 'text-ae-warning'} />
        {online ? (
          <span>Sending {waiting} message{waiting === 1 ? '' : 's'} you wrote offline…</span>
        ) : (
          <span>
            You’re offline. {waiting ? `${waiting} message${waiting === 1 ? '' : 's'} will send when you’re back.` : 'Saved chats still work; messages send when you’re back.'}
          </span>
        )}
      </div>
    </div>
  );
}
