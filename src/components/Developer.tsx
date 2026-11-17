/**
 * Developer platform (2.1): Settings → Developer (your apps) and Server settings → Bots & apps
 * (the apps in a server). See supabase/migrations/039_bots.sql and functions/bot-api, bot-interact.
 */
import { useState } from 'react';
import { useServers } from '../hooks/useChatData';
import { useBotActions, useBotCommands, useMyBots, useServerApps, type Bot } from '../hooks/useBots';
import { useMeId } from '../hooks/useMe';
import { t } from '../lib/i18n';
import { ask } from './ConfirmDialog';
import { BotIcon, CopyIcon, TrashIcon } from './icons';
import { inputCls, Section, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

const API = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://<project>.supabase.co'}/functions/v1/bot-api`;
const fail = (e: Error) => toast.error(e.message);
const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(t('{what} copied', { what }), <CopyIcon size={14} />));

function Secret({ label, value, onHide }: { label: string; value: string; onHide: () => void }) {
  return (
    <div className="rounded-ae border border-ae-warning/50 bg-ae-warning/10 p-3">
      <p className="mb-1 text-xs font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-ae-sunken px-2 py-1 font-mono text-xs select-all">{value}</code>
        <button type="button" onClick={() => copy(value, label)} className="rounded-ae bg-ae-surface px-2.5 py-1 text-xs font-semibold hover:bg-ae-hover">
          {t('Copy')}
        </button>
        <button type="button" onClick={onHide} className="rounded-ae px-2 py-1 text-xs text-ae-muted hover:text-ae-text">
          {t('Hide')}
        </button>
      </div>
    </div>
  );
}

export function DeveloperTab() {
  const { data: bots = [] } = useMyBots();
  const act = useBotActions();
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const create = () =>
    act.create.mutate(
      { name: name.trim() },
      {
        onSuccess: (r) => {
          setName('');
          setFresh(r);
        },
        onError: fail,
      },
    );
  return (
    <div className="space-y-6">
      <Section title={t('Your apps')} description={t('Make a bot for your servers: it can post messages through the API and answer slash commands. You can have up to 10.')}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder={t('App name')} className={`${inputCls} min-w-0 flex-1`} />
          <button type="submit" disabled={name.trim().length < 2 || act.create.isPending} className="rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            {t('Create app')}
          </button>
        </form>
        {bots.length === 0 && <p className="mt-3 text-sm text-ae-muted">{t('No apps yet.')}</p>}
        <div className="mt-4 space-y-4">
          {bots.map((b) => (
            <BotCard key={b.id} bot={b} token={fresh?.id === b.id ? fresh.token : null} onToken={(token) => setFresh({ id: b.id, token })} onHideToken={() => setFresh(null)} />
          ))}
        </div>
      </Section>
      <Section title={t('Using the API')} description={t('Send your token as “Authorization: Bot <token>”. Keep it secret: anyone with it can post as your app.')}>
        <pre className="ae-scroll overflow-x-auto rounded-ae bg-ae-sunken p-3 font-mono text-xs leading-relaxed">{`# Where your app is (servers and channels)
curl -H "Authorization: Bot $TOKEN" ${API}/me

# Post a message (30 a minute)
curl -X POST -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \\
  -d '{"content":"Hello!"}' ${API}/channels/$CHANNEL_ID/messages`}</pre>
        <p className="mt-3 text-sm text-ae-muted">
          {t('Slash commands: Aether sends a POST to your interactions URL with { type, id, command, args, channel_id, server_id, user }. Check X-Aether-Signature, the hex HMAC-SHA256 of “timestamp.body” with your signing secret (timestamp in X-Aether-Timestamp). Answer within 5 seconds with { "content": "..." } to reply in the channel.')}
        </p>
      </Section>
    </div>
  );
}

function BotCard({ bot, token, onToken, onHideToken }: { bot: Bot; token: string | null; onToken: (t: string) => void; onHideToken: () => void }) {
  const act = useBotActions();
  const me = useMeId();
  const { data: servers = [] } = useServers(me);
  const { data: commands = [] } = useBotCommands([bot.id]);
  const [secret, setSecret] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: bot.name, description: bot.description ?? '', avatar_url: bot.avatar_url ?? '', interactions_url: bot.interactions_url ?? '' });
  const [cmd, setCmd] = useState({ name: '', description: '' });
  const [server, setServer] = useState('');
  const dirty = draft.name !== bot.name || draft.description !== (bot.description ?? '') || draft.avatar_url !== (bot.avatar_url ?? '') || draft.interactions_url !== (bot.interactions_url ?? '');
  const save = () =>
    act.update.mutate(
      {
        id: bot.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        avatar_url: draft.avatar_url.trim() || null,
        interactions_url: draft.interactions_url.trim() || null,
      },
      { onSuccess: () => toast(t('Saved')), onError: fail },
    );
  const reset = async () => {
    if (await ask(t('The old token stops working right away.'), { title: t('Reset token?'), confirmLabel: t('Reset'), danger: true })) {
      act.resetToken.mutate(bot.id, { onSuccess: onToken, onError: fail });
    }
  };
  const remove = async () => {
    if (await ask(t('It leaves every server it’s in, and its token stops working.'), { title: t('Delete {name}?', { name: bot.name }), confirmLabel: t('Delete'), danger: true })) {
      act.remove.mutate(bot.id, { onError: fail });
    }
  };
  return (
    <article className="space-y-3 rounded-ae border border-ae-border bg-ae-surface p-4">
      <header className="flex items-center gap-3">
        {bot.avatar_url ? <img src={bot.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-ae-accent text-ae-on-accent"><BotIcon size={20} /></span>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{bot.name}</p>
          <button type="button" onClick={() => copy(bot.id, t('App ID'))} className="font-mono text-[11px] text-ae-muted hover:text-ae-text">
            {bot.id}
          </button>
        </div>
        <button type="button" aria-label={t('Delete app')} onClick={() => void remove()} className="grid h-8 w-8 place-items-center rounded-ae text-ae-muted hover:bg-ae-hover hover:text-ae-danger">
          <TrashIcon size={15} />
        </button>
      </header>

      {token && <Secret label={t('Token: copy it now, it won’t be shown again')} value={token} onHide={onHideToken} />}
      {secret && <Secret label={t('Signing secret')} value={secret} onHide={() => setSecret(null)} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void reset()} className="rounded-ae bg-ae-sunken px-3 py-1.5 text-xs font-semibold hover:bg-ae-hover">
          {t('Reset token')}
        </button>
        <button type="button" onClick={() => void act.signingSecret(bot.id).then(setSecret, fail)} className="rounded-ae bg-ae-sunken px-3 py-1.5 text-xs font-semibold hover:bg-ae-hover">
          {t('Show signing secret')}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-ae-muted">
          {t('Name')}
          <input value={draft.name} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs text-ae-muted">
          {t('Avatar URL (https)')}
          <input value={draft.avatar_url} maxLength={500} onChange={(e) => setDraft({ ...draft, avatar_url: e.target.value })} placeholder="https://…" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs text-ae-muted sm:col-span-2">
          {t('Description')}
          <input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs text-ae-muted sm:col-span-2">
          {t('Interactions URL (https, for slash commands)')}
          <input value={draft.interactions_url} maxLength={500} onChange={(e) => setDraft({ ...draft, interactions_url: e.target.value })} placeholder="https://example.com/aether" className={`${inputCls} mt-1`} />
        </label>
      </div>
      {dirty && (
        <button type="button" onClick={save} className="rounded-ae bg-ae-accent px-4 py-1.5 text-sm font-semibold text-ae-on-accent">
          {t('Save changes')}
        </button>
      )}
      <Toggle label={t('Public app')} hint={t('Anyone who manages a server can add it with its ID. Otherwise only you can.')} checked={bot.public} onChange={(v) => act.update.mutate({ id: bot.id, public: v }, { onError: fail })} />

      <div>
        <p className="mb-1.5 text-xs font-bold tracking-wide text-ae-muted uppercase">{t('Slash commands')} · {commands.length}/25</p>
        <ul className="mb-2 space-y-1">
          {commands.map((c) => (
            <li key={c.name} className="flex items-center gap-2 text-sm">
              <code className="font-mono text-ae-accent">/{c.name}</code>
              <span className="min-w-0 flex-1 truncate text-ae-muted">{c.description}</span>
              <button type="button" aria-label={t('Remove /{name}', { name: c.name })} onClick={() => act.removeCommand.mutate({ bot_id: bot.id, name: c.name }, { onError: fail })} className="text-ae-muted hover:text-ae-danger">
                <TrashIcon size={13} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.addCommand.mutate({ bot_id: bot.id, name: cmd.name, description: cmd.description.trim() }, { onSuccess: () => setCmd({ name: '', description: '' }), onError: fail });
          }}
        >
          <input value={cmd.name} onChange={(e) => setCmd({ ...cmd, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} maxLength={32} placeholder="command" aria-label={t('Command name')} className={`${inputCls} w-36 font-mono`} />
          <input value={cmd.description} onChange={(e) => setCmd({ ...cmd, description: e.target.value })} maxLength={100} placeholder={t('What it does')} aria-label={t('Command description')} className={`${inputCls} min-w-0 flex-1`} />
          <button type="submit" disabled={!cmd.name} className="rounded-ae bg-ae-sunken px-3 text-sm font-semibold hover:bg-ae-hover disabled:opacity-50">
            {t('Add')}
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={server} onChange={(e) => setServer(e.target.value)} aria-label={t('Server')} className={`${inputCls} w-auto`}>
          <option value="">{t('Add to a server…')}</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!server}
          onClick={() => act.install.mutate({ serverId: server, botId: bot.id }, { onSuccess: () => (setServer(''), toast(t('Added'))), onError: (e) => toast.error(e.message.includes('row-level') ? t('You need Manage Server there, or it already has this app.') : e.message) })}
          className="rounded-ae bg-ae-sunken px-3 py-2 text-sm font-semibold hover:bg-ae-hover disabled:opacity-50"
        >
          {t('Add')}
        </button>
      </div>
    </article>
  );
}

/** Server settings: the apps in this server; add one by ID. */
export function ServerApps({ serverId, editable }: { serverId: string; editable: boolean }) {
  const { data } = useServerApps(serverId);
  const act = useBotActions();
  const [id, setId] = useState('');
  return (
    <Section title={t('Apps')} description={t('Bots made by people on Aether. They can post in this server’s text channels and add slash commands. Make your own in Settings → Developer.')}>
      <ul className="space-y-2">
        {(data?.bots ?? []).map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-ae border border-ae-border bg-ae-surface px-3 py-2">
            {b.avatar_url ? <img src={b.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-ae-accent text-ae-on-accent"><BotIcon size={16} /></span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{b.name}</p>
              <p className="truncate text-xs text-ae-muted">
                {(data?.commands ?? [])
                  .filter((c) => c.bot_id === b.id)
                  .map((c) => `/${c.name}`)
                  .join(' ') || b.description || t('No commands')}
              </p>
            </div>
            {editable && (
              <button type="button" onClick={() => act.uninstall.mutate({ serverId, botId: b.id }, { onError: fail })} className="rounded-ae px-2.5 py-1 text-xs text-ae-danger hover:bg-ae-danger/10">
                {t('Remove')}
              </button>
            )}
          </li>
        ))}
        {data && data.bots.length === 0 && <p className="text-sm text-ae-muted">{t('No apps in this server yet.')}</p>}
      </ul>
      {editable && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.install.mutate(
              { serverId, botId: id.trim() },
              { onSuccess: () => setId(''), onError: (e) => toast.error(e.message.includes('row-level') || e.message.includes('uuid') ? t('No public app with that ID.') : e.message) },
            );
          }}
        >
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder={t('App ID')} className={`${inputCls} min-w-0 flex-1 font-mono text-xs`} />
          <button type="submit" disabled={!/^[0-9a-f-]{36}$/i.test(id.trim())} className="rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            {t('Add app')}
          </button>
        </form>
      )}
    </Section>
  );
}
