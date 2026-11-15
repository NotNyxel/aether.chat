/**
 * Encrypted chats in the app: the chat key for the open conversation (context), decrypting a
 * message for display, the lock button in the DM header, and the "unlock on this device" bar.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { chatKey, decryptText, e2eStatus, enableChatEncryption, isEncrypted, shareWithNewMembers, unlockIdentity, type E2eStatus } from '../lib/e2e';
import { useSupabase } from '../lib/supabase';
import type { Conversation } from '../types/db';
import { ask } from './ConfirmDialog';
import { E2eIcon } from './icons';
import { toast } from './Toaster';
import { useUiStore } from '../stores/uiStore';

interface E2eState {
  on: boolean;
  key: CryptoKey | null;
  status: E2eStatus;
  refresh: () => void;
}
const Ctx = createContext<E2eState>({ on: false, key: null, status: 'none', refresh: () => {} });
export const useE2e = () => useContext(Ctx);

export function E2eProvider({ conv, me, children }: { conv: Conversation; me: string; children: ReactNode }) {
  const sb = useSupabase();
  const on = !!(conv as Conversation & { e2e?: boolean }).e2e;
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [status, setStatus] = useState<E2eStatus>('none');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let gone = false;
    void e2eStatus(sb, me).then((s) => !gone && setStatus(s));
    if (on)
      void chatKey(sb, me, conv.id).then((k) => {
        if (gone) return;
        setKey(k);
        if (k && conv.type === 'group') void shareWithNewMembers(sb, me, conv.id);
      });
    else setKey(null);
    return () => {
      gone = true;
    };
  }, [sb, me, conv.id, conv.type, on, tick, conv.conversation_members.length]);
  return <Ctx.Provider value={{ on, key, status, refresh: () => setTick((t) => t + 1) }}>{children}</Ctx.Provider>;
}

const cache = new Map<string, string | null>();

/** What to show for a message's text: decrypted if it's encrypted and we can, a placeholder if not. */
export function useMessageText(content: string): string {
  const { key } = useE2e();
  const encrypted = isEncrypted(content);
  const [text, setText] = useState<string | null>(() => (encrypted ? (cache.get(content) ?? null) : content));
  useEffect(() => {
    if (!encrypted) return setText(content);
    if (cache.has(content)) return setText(cache.get(content)!);
    if (!key) return setText(null);
    let gone = false;
    void decryptText(key, content).then((t) => {
      cache.set(content, t);
      if (!gone) setText(t);
    });
    return () => {
      gone = true;
    };
  }, [content, encrypted, key]);
  if (!encrypted) return content;
  return text ?? '🔒 *Encrypted message. Unlock encrypted messages on this device to read it.*';
}

/** For previews (replies, notifications, pins): never show the scrambled text. */
export const previewText = (content: string | null | undefined) => (isEncrypted(content) ? '🔒 Encrypted message' : (content ?? ''));

/** The lock in the DM header: shows encryption is on, or turns it on. */
export function E2eButton({ conv, me }: { conv: Conversation; me: string }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { on, status, refresh } = useE2e();
  const openSettings = useUiStore((s) => s.openSettings);
  if (on)
    return (
      <span data-tip="End-to-end encrypted: only the people in this chat can read new messages" className="text-ae-success">
        <E2eIcon size={17} />
      </span>
    );
  return (
    <button
      type="button"
      data-tip="Turn on end-to-end encryption"
      aria-label="Turn on end-to-end encryption"
      className="opacity-60 hover:opacity-100"
      onClick={async () => {
        if (status !== 'ready') {
          toast(status === 'none' ? 'Set up encrypted messages first (Settings → Privacy & Safety).' : 'Unlock encrypted messages on this device first (Settings → Privacy & Safety).', <E2eIcon size={14} />);
          openSettings('privacy');
          return;
        }
        const ok = await ask(
          'Turn on end-to-end encryption for this chat? New messages can only be read by the people in it, on devices where they have unlocked encrypted messages. Message search, link previews and notification previews won’t show encrypted text. Pictures and files are not encrypted.',
          { title: 'Encrypt this chat', confirmLabel: 'Encrypt' },
        );
        if (!ok) return;
        try {
          await enableChatEncryption(sb, me, conv.id, conv.conversation_members.map((m) => m.user_id));
          void qc.invalidateQueries({ queryKey: ['conversations'] });
          refresh();
          toast.success('This chat is now end-to-end encrypted.', <E2eIcon size={14} />);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not turn on encryption.');
        }
      }}
    >
      <E2eIcon size={17} />
    </button>
  );
}

/** Shown in an encrypted chat when this device can't read it yet. */
export function E2eUnlockBar({ me }: { me: string }) {
  const sb = useSupabase();
  const { on, key, status, refresh } = useE2e();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  if (!on || key) return null;
  if (status === 'ready')
    return <div className="border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm">🔒 You don’t have this chat’s key yet. Someone in the chat who has it needs to open the chat once to share it with you.</div>;
  if (status === 'none')
    return <div className="border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm">🔒 This chat is end-to-end encrypted. Set up encrypted messages in Settings → Privacy & Safety to read and send messages here.</div>;
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await unlockIdentity(sb, me, pass);
          setPass('');
          refresh();
          toast.success('Encrypted messages unlocked on this device.');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not unlock.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="flex items-center gap-1.5">
        <E2eIcon size={15} /> Encrypted chat: enter your encryption passphrase to read it on this device.
      </span>
      <input type="password" className="ae-input min-w-0 flex-1 text-sm" placeholder="Encryption passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
      <button type="submit" disabled={busy || !pass} className="rounded-ae bg-ae-accent px-3 py-1.5 font-semibold text-ae-on-accent disabled:opacity-50">
        Unlock
      </button>
    </form>
  );
}
