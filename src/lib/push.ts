/**
 * Web Push for the web app (installed on a phone's home screen, or in a desktop browser).
 * The desktop app uses native Windows/macOS notifications instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { VAPID_PUBLIC_KEY } from '../config';
import { useUiStore } from '../stores/uiStore';
import { isTauri } from './platform';

export const pushSupported = !isTauri && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Asks for permission, subscribes this device and saves it for the push function. */
export async function enablePush(sb: SupabaseClient): Promise<void> {
  if (!pushSupported) throw new Error('This browser does not support push notifications. On iPhone, add Aether to your Home Screen first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  const { error } = await sb.from('push_subscriptions').insert({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' });
  if (error) throw new Error(error.message);
}

export async function disablePush(sb: SupabaseClient): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Tapping a notification opens the message: from the service worker, or from the #goto= link. */
export function listenForPushClicks(): void {
  if (!pushSupported) return;
  const go = (serverId: string | null, scopeId: string, messageId?: string) =>
    useUiStore.getState().goTo({ serverId: serverId || null, scopeId, messageId: messageId || undefined });
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; serverId?: string; scopeId?: string; messageId?: string };
    if (d?.type === 'aether-goto' && d.scopeId) go(d.serverId ?? null, d.scopeId, d.messageId);
  });
  const m = /^#goto=([^:]*):([^:]+):?(.*)$/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname);
    // Open the chat straight away; its messages appear as soon as they load.
    go(m[1] || null, m[2]!, m[3] || undefined);
  }
  // Keep the worker registered so pushes still arrive after updates.
  void navigator.serviceWorker.getRegistration().then((r) => r && void r.update());
}
