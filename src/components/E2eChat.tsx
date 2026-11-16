/**
 * Encrypted chats in the app: the chat key for the open conversation (context), decrypting a
 * message for display, the lock in the DM header, the bar shown when this device can't read a chat
 * yet, and (E2eDeviceLayer) quiet setup on start plus approving new devices.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  allHaveKeys,
  approveLink,
  autoSetUp,
  chatKey,
  decryptText,
  denyLink,
  disableChatEncryption,
  e2eStatus,
  enableChatEncryption,
  isEncrypted,
  linkCode,
  requestLink,
  shareWithNewMembers,
  unlockIdentity,
  type E2eStatus,
  type LinkRequest,
  type PendingLink,
} from '../lib/e2e';
import { useSupabase } from '../lib/supabase';
import { useSettingsStore } from '../stores/settingsStore';
import type { Conversation } from '../types/db';
import { ask } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { E2eIcon } from './icons';
import { toast } from './Toaster';
import { useUiStore } from '../stores/uiStore';

type E2eConv = Conversation & { e2e?: boolean; e2e_declined?: boolean };

interface E2eState {
  on: boolean;
  key: CryptoKey | null;
  status: E2eStatus;
  refresh: () => void;
}
const Ctx = createContext<E2eState>({ on: false, key: null, status: 'none', refresh: () => {} });
export const useE2e = () => useContext(Ctx);

/** Tells every open chat to look again (after unlocking or linking this device). */
const listeners = new Set<() => void>();
export const e2eChanged = () => listeners.forEach((l) => l());

export function E2eProvider({ conv, me, children }: { conv: Conversation; me: string; children: ReactNode }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const c = conv as E2eConv;
  const on = !!c.e2e;
  const auto = useSettingsStore((s) => s.e2eAuto);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [status, setStatus] = useState<E2eStatus>('none');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const memberIds = conv.conversation_members.map((m) => m.user_id).join(',');
  useEffect(() => {
    let gone = false;
    void (async () => {
      const s = await e2eStatus(sb, me);
      if (gone) return;
      setStatus(s);
      if (on) {
        const k = await chatKey(sb, me, conv.id);
        if (gone) return;
        setKey(k);
        if (k) void shareWithNewMembers(sb, me, conv.id);
        return;
      }
      setKey(null);
      // DMs encrypt themselves once both people can, unless someone turned it off for this chat.
      if (conv.type === 'dm' && auto && s === 'ready' && !c.e2e_declined && (await allHaveKeys(sb, memberIds.split(',')))) {
        try {
          await enableChatEncryption(sb, me, conv.id, memberIds.split(','));
          if (!gone) void qc.invalidateQueries({ queryKey: ['conversations'] });
        } catch {
          /* the other side may have done it at the same moment; the refetch sorts it out */
          void qc.invalidateQueries({ queryKey: ['conversations'] });
        }
      }
    })();
    return () => {
      gone = true;
    };
  }, [sb, qc, me, conv.id, conv.type, on, c.e2e_declined, auto, tick, memberIds]);
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
    if (cache.get(content)) return setText(cache.get(content)!);
    if (!key) return setText(null);
    let gone = false;
    void decryptText(key, content).then((t) => {
      if (t) cache.set(content, t);
      if (!gone) setText(t);
    });
    return () => {
      gone = true;
    };
  }, [content, encrypted, key]);
  if (!encrypted) return content;
  return text ?? '🔒 *Encrypted message. This device can’t read it yet.*';
}

/** For previews (replies, notifications, pins): never show the scrambled text. */
export const previewText = (content: string | null | undefined) => (isEncrypted(content) ? '🔒 Encrypted message' : (content ?? ''));

/** The lock in the chat header: shows encryption is on (click to turn off), or turns it on. */
export function E2eButton({ conv, me }: { conv: Conversation; me: string }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { on, status, refresh } = useE2e();
  const openSettings = useUiStore((s) => s.openSettings);
  if (on)
    return (
      <button
        type="button"
        data-tip="End-to-end encrypted: only the people in this chat can read new messages"
        aria-label="End-to-end encrypted"
        className="text-ae-success"
        onClick={async () => {
          const ok = await ask('Turn off end-to-end encryption for new messages in this chat? Messages sent while it was on stay encrypted. Aether won’t turn it back on by itself; you can, with this button.', {
            title: 'Encrypted chat',
            confirmLabel: 'Turn off',
            danger: true,
          });
          if (!ok) return;
          try {
            await disableChatEncryption(sb, conv.id);
            void qc.invalidateQueries({ queryKey: ['conversations'] });
            refresh();
            toast('Encryption is off for new messages in this chat.');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not turn it off.');
          }
        }}
      >
        <E2eIcon size={17} />
      </button>
    );
  return (
    <button
      type="button"
      data-tip="Turn on end-to-end encryption"
      aria-label="Turn on end-to-end encryption"
      className="opacity-60 hover:opacity-100"
      onClick={async () => {
        if (status !== 'ready') {
          toast('Set up encrypted messages on this device first.', <E2eIcon size={14} />);
          openSettings('privacy');
          return;
        }
        const ok = await ask(
          'Turn on end-to-end encryption for this chat? New messages can only be read by the people in it. Message search, link previews and notification previews won’t show encrypted text. Pictures and files are not encrypted.',
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

/** "Approve from another device" / recovery code. Used in the chat bar and in Settings. */
export function UnlockThisDevice({ me, onDone, compact = false }: { me: string; onDone: () => void; compact?: boolean }) {
  const sb = useSupabase();
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<PendingLink | null>(null);
  useEffect(() => () => pendingRef.current?.cancel(), []);

  const startLink = async () => {
    setBusy(true);
    try {
      const p = await requestLink(sb, me);
      pendingRef.current = p;
      setPending(p);
      p.done.then(
        () => {
          pendingRef.current = null;
          setPending(null);
          toast.success('This device can now read your encrypted chats.', <E2eIcon size={14} />);
          e2eChanged();
          onDone();
        },
        (err: Error) => {
          pendingRef.current = null;
          setPending(null);
          toast.error(err.message);
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  if (pending)
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Open Aether on a device where you’re signed in and approve this one. Check it shows <b className="font-mono tracking-wider">{pending.code}</b>.
        </span>
        <button type="button" className="rounded-ae px-3 py-1.5 text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => (pending.cancel(), (pendingRef.current = null), setPending(null))}>
          Cancel
        </button>
      </div>
    );
  if (useCode)
    return (
      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await unlockIdentity(sb, me, code);
            setCode('');
            toast.success('Encrypted messages unlocked on this device.', <E2eIcon size={14} />);
            e2eChanged();
            onDone();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not unlock.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="ae-input min-w-0 flex-1 font-mono text-sm" placeholder="Recovery code (or your old passphrase)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" disabled={busy || !code} className="rounded-ae bg-ae-accent px-3 py-1.5 font-semibold text-ae-on-accent disabled:opacity-50">
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <button type="button" className="rounded-ae px-3 py-1.5 text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setUseCode(false)}>
          Back
        </button>
      </form>
    );
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${compact ? '' : 'pt-1'}`}>
      <button type="button" disabled={busy} onClick={() => void startLink()} className="rounded-ae bg-ae-accent px-3 py-1.5 font-semibold text-ae-on-accent disabled:opacity-50">
        Approve from another device
      </button>
      <button type="button" onClick={() => setUseCode(true)} className="rounded-ae border border-ae-border px-3 py-1.5 font-semibold hover:bg-ae-hover">
        Use recovery code
      </button>
    </div>
  );
}

/** Shown in an encrypted chat when this device can't read it yet. */
export function E2eUnlockBar({ me }: { me: string }) {
  const { on, key, status, refresh } = useE2e();
  if (!on || key) return null;
  if (status === 'ready')
    return <div className="border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm">🔒 You don’t have this chat’s key yet. It arrives once someone else in the chat opens it.</div>;
  if (status === 'none')
    return <div className="border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm">🔒 This chat is end-to-end encrypted. Encryption is being set up on this device…</div>;
  return (
    <div className="space-y-1.5 border-b border-ae-border bg-ae-warning/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-1.5">
        <E2eIcon size={15} /> This chat is end-to-end encrypted. Let this device read it:
      </div>
      <UnlockThisDevice me={me} onDone={refresh} compact />
    </div>
  );
}

/**
 * Always mounted while signed in: sets encryption up quietly the first time, and asks you to
 * approve when another of your devices wants your encryption key.
 */
export function E2eDeviceLayer({ me }: { me: string }) {
  const sb = useSupabase();
  const openSettings = useUiStore((s) => s.openSettings);
  const [ready, setReady] = useState(false);
  const [req, setReq] = useState<(LinkRequest & { code: string }) | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let gone = false;
    const check = () =>
      void autoSetUp(sb, me)
        .then((s) => {
          if (gone) return;
          setReady(s === 'ready');
          if (s === 'ready') e2eChanged();
        })
        .catch(() => {});
    check();
    listeners.add(check);
    return () => {
      gone = true;
      listeners.delete(check);
    };
  }, [sb, me]);

  useEffect(() => {
    if (!ready) return;
    const show = async (r: LinkRequest) => {
      if (r.status !== 'pending' || seen.current.has(r.id)) return;
      if (Date.now() - new Date(r.created_at).getTime() > 15 * 60_000) return;
      seen.current.add(r.id);
      setReq({ ...r, code: await linkCode(r.request_pub) });
    };
    void sb
      .from('e2e_link_requests')
      .select('*')
      .eq('user_id', me)
      .eq('status', 'pending')
      .then(({ data }) => (data as LinkRequest[] | null)?.forEach((r) => void show(r)));
    const channel = sb
      .channel(`e2e-links-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'e2e_link_requests', filter: `user_id=eq.${me}` }, (p) => void show(p.new as LinkRequest))
      .subscribe();
    return () => void sb.removeChannel(channel);
  }, [sb, me, ready]);

  if (!req) return null;
  const close = () => setReq(null);
  return (
    <Dialog title="Let a new device read your encrypted chats?" onClose={close}>
      <p className="text-sm">
        <b>{req.device_name}</b> wants your encryption key. Only approve if that’s you, and the code on that device is:
      </p>
      <p className="text-center font-mono text-3xl font-bold tracking-[0.2em]">{req.code}</p>
      <p className="text-xs text-ae-muted">If the code is different, or you didn’t just sign in somewhere, deny it and change your password.</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-ae px-4 py-2 text-sm font-semibold hover:bg-ae-hover"
          onClick={() => {
            void denyLink(sb, req.id);
            close();
          }}
        >
          Deny
        </button>
        <button
          type="button"
          className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent"
          onClick={async () => {
            try {
              await approveLink(sb, me, req);
              toast.success(`Approved ${req.device_name}.`, <E2eIcon size={14} />);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not approve.');
              openSettings('privacy');
            }
            close();
          }}
        >
          Approve
        </button>
      </div>
    </Dialog>
  );
}
