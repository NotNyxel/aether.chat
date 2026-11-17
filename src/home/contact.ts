/** Contact us page: Turnstile + the contact edge function (supabase/functions/contact). */
import './site';
import { BUILT_IN_BACKEND, TURNSTILE_SITE_KEY } from '../config';

type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void };
const ts = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

const form = document.getElementById('contact-form') as HTMLFormElement | null;
const err = document.getElementById('form-error')!;
const send = document.getElementById('send') as HTMLButtonElement;
const sent = document.getElementById('sent')!;
let token: string | null = null;
let widget: string | null = null;

const showError = (msg: string | null) => {
  err.textContent = msg ?? '';
  err.hidden = !msg;
};

const s = document.createElement('script');
s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
s.async = true;
s.onload = () => {
  const box = document.getElementById('turnstile');
  const api = ts();
  if (!box || !api) return;
  widget = api.render(box, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: 'dark',
    callback: (t: string) => (token = t),
    'expired-callback': () => (token = null),
    'error-callback': () => (token = null),
  });
};
s.onerror = () => showError('The check that you’re human didn’t load. Turn off blockers for this page and reload.');
document.head.appendChild(s);

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  if (!data.name?.trim()) return showError('Please tell us your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email ?? '')) return showError('Please enter an email address we can reply to.');
  if ((data.message ?? '').trim().length < 10) return showError('Your message is a bit short. Tell us a little more.');
  if (!token) return showError('Please complete the check that you’re human.');
  showError(null);
  send.disabled = true;
  send.textContent = 'Sending…';
  try {
    const r = await fetch(`${BUILT_IN_BACKEND.url}/functions/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, turnstile: token }),
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!r.ok || !body.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
    form.hidden = true;
    sent.hidden = false;
    sent.querySelector('h2')?.focus();
  } catch (x) {
    showError(x instanceof Error ? x.message : 'Something went wrong. Please try again.');
    token = null;
    if (widget) ts()?.reset(widget);
  } finally {
    send.disabled = false;
    send.textContent = 'Send message';
  }
});
