/**
 * Server Settings → "Safety & Welcome" (verification level, welcome channel and message, rules)
 * and → "Bot" (the built-in bot and its slash commands). Saved straight to public.servers; the
 * rules live in 012_servers_bot.sql.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import { useServerEmojis } from '../lib/customEmoji';
import { promptText } from './ConfirmDialog';
import { toast } from './Toaster';
import { useChannels } from '../hooks/useChatData';
import { useUpdateServer } from '../hooks/useServerAdmin';
import { BOT_COMMANDS, BOT_NAME } from '../lib/botCommands';
import type { Server } from '../types/db';
import { BotIcon, HashIcon, ShieldIcon } from './icons';
import { Field, inputCls, Section, Toggle } from './SettingsPanel';
import { DISCOVERY_CATEGORIES } from './ServerDiscovery';
import { WebhooksSection } from './Webhooks';

const LEVELS: { id: NonNullable<Server['verification_level']>; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Anyone with an invite can join and talk.' },
  { id: 'low', label: 'Low', hint: 'Members need a verified email.' },
  { id: 'medium', label: 'Medium', hint: 'Verified email, and an account older than 5 minutes.' },
  { id: 'high', label: 'High', hint: 'All of that, and new members without a role wait 10 minutes before talking.' },
];

function SaveRow({ dirty, pending, error, onSave, onReset }: { dirty: boolean; pending: boolean; error?: string; onSave: () => void; onReset: () => void }) {
  if (!dirty && !error) return null;
  return (
    <div className="ae-enter sticky bottom-4 flex items-center gap-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-2xl">
      <span className="flex-1 text-sm">{error ? <span className="text-ae-danger">{error}</span> : 'You have unsaved changes.'}</span>
      <button type="button" className="rounded-ae px-3 py-1.5 text-sm hover:bg-ae-hover" onClick={onReset}>
        Reset
      </button>
      <button type="button" disabled={pending} className="ae-press rounded-ae bg-ae-success px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50" onClick={onSave}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

export function CommunityTab({ server, userId, editable }: { server: Server; userId: string; editable: boolean }) {
  const update = useUpdateServer(userId);
  const { data: channels = [] } = useChannels(server.id);
  const text = channels.filter((c) => c.type === 'text' && !c.thread_parent_id);
  const initial = () => ({
    verification_level: server.verification_level ?? 'none',
    welcome_channel_id: server.welcome_channel_id ?? null,
    welcome_message: server.welcome_message ?? '',
    rules: server.rules ?? '',
    discoverable: !!server.discoverable,
    discovery_category: server.discovery_category ?? 'social',
  });
  const [d, setD] = useState(initial);
  useEffect(() => setD(initial()), [server]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(initial());

  return (
    <div className="space-y-8">
      {!editable && <p className="rounded-ae bg-ae-sunken p-3 text-sm text-ae-muted">You need the Manage Server permission to change these.</p>}
      <Section title="Verification level" description="How much a new member has to prove before they can join and talk.">
        <div className="grid gap-2 sm:grid-cols-2">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              disabled={!editable}
              onClick={() => setD((x) => ({ ...x, verification_level: l.id }))}
              className={`ae-press flex items-start gap-3 rounded-ae border p-3 text-left ${d.verification_level === l.id ? 'border-ae-accent bg-ae-accent/10' : 'border-ae-border hover:bg-ae-hover'}`}
            >
              <ShieldIcon size={18} className={d.verification_level === l.id ? 'mt-0.5 text-ae-accent' : 'mt-0.5 text-ae-muted'} />
              <span>
                <span className="block text-sm font-semibold">{l.label}</span>
                <span className="block text-xs text-ae-muted">{l.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Welcome" description="Where the bot greets new members. Turn the bot on in the Bot tab.">
        <Field label="Welcome channel">
          <select className={inputCls} disabled={!editable} value={d.welcome_channel_id ?? ''} onChange={(e) => setD((x) => ({ ...x, welcome_channel_id: e.target.value || null }))}>
            <option value="">No welcome messages</option>
            {text.map((c) => (
              <option key={c.id} value={c.id}>
                # {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Welcome message" hint="{user} becomes the new member's name, {server} the server's name.">
          <input
            className={inputCls}
            disabled={!editable}
            maxLength={500}
            placeholder="Welcome to **{server}**, {user}! Say hi 👋"
            value={d.welcome_message}
            onChange={(e) => setD((x) => ({ ...x, welcome_message: e.target.value }))}
          />
        </Field>
      </Section>

      <Section title="Server discovery" description="List this server so anyone can find and join it from Explore public servers, without an invite.">
        <Toggle label="Show in server discovery" checked={d.discoverable} onChange={(v) => editable && setD((x) => ({ ...x, discoverable: v }))} />
        {d.discoverable && (
          <Field label="Category">
            <select className={inputCls} disabled={!editable} value={d.discovery_category} onChange={(e) => setD((x) => ({ ...x, discovery_category: e.target.value }))}>
              {DISCOVERY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Section>

      <Section title="Rules" description="Shown with /rules. Markdown works.">
        <textarea
          className={`${inputCls} min-h-36 text-sm`}
          disabled={!editable}
          maxLength={4000}
          placeholder={'1. Be kind.\n2. No spam.\n3. Keep it on topic.'}
          value={d.rules}
          onChange={(e) => setD((x) => ({ ...x, rules: e.target.value }))}
        />
      </Section>

      <SaveRow
        dirty={dirty}
        pending={update.isPending}
        error={update.error?.message}
        onReset={() => setD(initial())}
        onSave={() =>
          update.mutate({
            id: server.id,
            patch: {
              verification_level: d.verification_level,
              welcome_channel_id: d.welcome_channel_id,
              welcome_message: d.welcome_message.trim() || null,
              rules: d.rules.trim() || null,
              discoverable: d.discoverable,
              discovery_category: d.discovery_category,
            },
          })
        }
      />
    </div>
  );
}

export function BotTab({ server, userId, editable }: { server: Server; userId: string; editable: boolean }) {
  const update = useUpdateServer(userId);
  const set = (patch: Partial<Server>) => update.mutate({ id: server.id, patch });
  const welcomeChannel = server.welcome_channel_id;
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-gradient-to-br from-ae-accent/15 to-transparent p-5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-ae-accent to-[#00d4ff] text-white shadow-lg">
          <BotIcon size={28} />
        </span>
        <div className="flex-1">
          <p className="flex items-center gap-2 text-lg font-bold">
            {BOT_NAME} <span className="rounded bg-ae-accent px-1 py-px text-[10px] font-bold text-ae-on-accent">BOT</span>
          </p>
          <p className="text-sm text-ae-muted">The built-in bot. Type <span className="font-mono">/</span> in any channel to see its commands.</p>
        </div>
        <Toggle label={server.bot_enabled ? 'On' : 'Off'} checked={!!server.bot_enabled} onChange={(v) => editable && set({ bot_enabled: v })} />
      </div>
      {update.error && <p className="text-sm text-ae-danger">{update.error.message}</p>}

      <WebhooksSection server={server} editable={editable} />

      <div className={server.bot_enabled ? '' : 'pointer-events-none opacity-50'}>
        <Section title="Welcome new members">
          <Toggle
            label="Greet people when they join"
            hint={welcomeChannel ? 'Posted in the welcome channel set under Safety & Welcome.' : 'Pick a welcome channel under Safety & Welcome first.'}
            checked={server.bot_welcome !== false}
            onChange={(v) => editable && set({ bot_welcome: v })}
          />
        </Section>
        <Section title="Commands">
          <ul className="divide-y divide-ae-border overflow-hidden rounded-ae border border-ae-border">
            {BOT_COMMANDS.map((c) => (
              <Row key={c.name} name={`/${c.name}${c.args ? ` ${c.args}` : ''}`} mod={c.mod}>
                {c.description}
              </Row>
            ))}
          </ul>
          <p className="flex items-center gap-1.5 text-xs text-ae-muted">
            <HashIcon size={12} /> Commands follow channel permissions: people need Send Messages, and moderator commands need Manage Messages or Manage Channels.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Row({ name, mod, children }: { name: string; mod?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 bg-ae-surface/20 px-3 py-2">
      <span className="w-44 shrink-0 font-mono text-sm text-ae-accent">{name}</span>
      <span className="flex-1 text-sm text-ae-muted">{children}</span>
      {mod && <span className="rounded bg-ae-warning/15 px-1.5 text-[10px] font-bold text-ae-warning uppercase">Mods</span>}
    </li>
  );
}

/** Server Settings → Emoji: upload and manage custom emoji (PNG, GIF, WebP; up to 512 KB). */
export function EmojiTab({ server, canManage }: { server: Server; canManage: boolean }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data: emojis = [] } = useServerEmojis([server.id]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['server-emojis'] });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of [...files].slice(0, 20)) {
      if (!/^image\/(png|gif|webp|jpeg)$/.test(file.type)) {
        toast.error(`${file.name}: use PNG, GIF, WebP or JPEG.`);
        continue;
      }
      if (file.size > 512 * 1024) {
        toast.error(`${file.name} is over 512 KB.`);
        continue;
      }
      const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
      let name = base.length >= 2 ? base : `emoji_${Math.random().toString(36).slice(2, 6)}`;
      if (emojis.some((e) => e.name === name)) name = `${name.slice(0, 28)}_${Math.random().toString(36).slice(2, 5)}`;
      const path = `${server.id}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
      const up = await sb.storage.from('emojis').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
      if (up.error) {
        toast.error(up.error.message);
        continue;
      }
      const url = sb.storage.from('emojis').getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from('server_emojis').insert({ server_id: server.id, name, url, animated: file.type === 'image/gif' });
      if (error) toast.error(error.message);
    }
    setBusy(false);
    refresh();
  };
  const rename = async (id: string, current: string) => {
    const next = await promptText('New name (letters, numbers, _)', { title: 'Rename emoji', initial: current, maxLength: 32 });
    if (!next) return;
    const clean = next.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 2) return toast.error('Names need at least 2 letters or numbers.');
    // Rename = re-insert under the new name (names are the readable part of the token; ids stay valid).
    const e = emojis.find((x) => x.id === id);
    if (!e) return;
    const { error } = await sb.from('server_emojis').insert({ server_id: server.id, name: clean, url: e.url, animated: e.animated });
    if (error) return toast.error(error.message);
    await sb.from('server_emojis').delete().eq('id', id);
    refresh();
  };
  const remove = async (id: string) => {
    await sb.from('server_emojis').delete().eq('id', id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <Section title={`Custom emoji (${emojis.length}/100)`} description="Members use them in messages with the emoji picker or by typing :name:. They show up anywhere, even for people outside this server.">
        {canManage ? (
          <>
            <input ref={fileRef} type="file" multiple accept="image/png,image/gif,image/webp,image/jpeg" className="hidden" onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ''))} />
            <button type="button" disabled={busy || emojis.length >= 100} onClick={() => fileRef.current?.click()} className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
              {busy ? 'Uploading…' : 'Upload emoji'}
            </button>
            <p className="text-xs text-ae-muted">Square images look best. GIFs stay animated. You can pick several files at once.</p>
          </>
        ) : (
          <p className="text-sm text-ae-muted">You need Manage Expressions to add emoji.</p>
        )}
      </Section>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {emojis.map((e) => (
          <div key={e.id} className="group flex items-center gap-2 rounded-ae border border-ae-border bg-ae-surface/20 p-2">
            <img src={e.url} alt="" className="h-9 w-9 object-contain" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">:{e.name}:</span>
            {canManage && (
              <span className="hidden gap-0.5 group-hover:flex">
                <button type="button" className="rounded px-1.5 text-xs text-ae-muted hover:text-ae-text" onClick={() => void rename(e.id, e.name)}>
                  Rename
                </button>
                <button type="button" className="rounded px-1.5 text-xs text-ae-muted hover:text-ae-danger" onClick={() => void remove(e.id)}>
                  Delete
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
