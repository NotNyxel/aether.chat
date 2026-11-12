/**
 * Channel Settings: Overview (name, topic, slow mode, user limit, NSFW, delete) and
 * Permissions (per-role and per-member overrides with allow / inherit / deny).
 */
import { ask } from './ConfirmDialog';
import { useEffect, useMemo, useState } from 'react';
import { useServerMembers } from '../hooks/useChatData';
import { useChannelActions, useChannelOverwrites, useOverwriteActions, useServerRoles } from '../hooks/useServerAdmin';
import { Permission, PERMISSION_GROUPS, toMask } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { ChannelGlyph } from './ChannelSidebar';
import { useProfiles } from './ConversationBits';
import { CheckIcon, CloseIcon, UserIcon } from './icons';
import { useRank } from './ServerSettings';
import { Field, inputCls, Section, Toggle } from './SettingsPanel';
import { useEscape } from '../lib/escape';

const SLOWMODES = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
const fmtSlow = (s: number) => (s === 0 ? 'Off' : s < 60 ? `${s}s` : s < 3600 ? `${s / 60}m` : `${s / 3600}h`);

function OverviewTab({ channel, server, editable, onDeleted }: { channel: Channel; server: Server; editable: boolean; onDeleted: () => void }) {
  const actions = useChannelActions(server.id);
  const initial = useMemo(
    () => ({
      name: channel.name,
      topic: channel.topic ?? '',
      rate: channel.rate_limit_seconds,
      limit: channel.user_limit,
      nsfw: channel.nsfw,
      announcement: channel.subtype === 'announcement',
      tags: channel.forum_tags ?? [],
      requireTag: channel.require_tag,
      sort: channel.default_sort,
      layout: channel.default_layout,
    }),
    [channel],
  );
  const [d, setD] = useState(initial);
  useEffect(() => setD(initial), [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const isVoice = channel.type === 'voice' || channel.type === 'stream';
  const isForum = channel.subtype === 'forum' || channel.subtype === 'media';
  const [tagName, setTagName] = useState('');
  const [tagEmoji, setTagEmoji] = useState('');

  return (
    <div className="space-y-6">
      <Section title="Overview">
        <Field label={channel.type === 'category' ? 'Category name' : 'Channel name'}>
          <input
            className={inputCls}
            disabled={!editable}
            maxLength={100}
            value={d.name}
            onChange={(e) => setD({ ...d, name: channel.type === 'text' ? e.target.value.toLowerCase().replace(/\s+/g, '-') : e.target.value })}
          />
        </Field>
        {channel.type === 'text' && (
          <>
            <Field label={isForum ? 'Post guidelines' : 'Topic'} hint={isForum ? 'Markdown. Shown to everyone from the Guidelines button.' : 'Shown in the channel header.'}>
              <textarea className={`${inputCls} min-h-16`} disabled={!editable} maxLength={1024} value={d.topic} onChange={(e) => setD({ ...d, topic: e.target.value })} />
            </Field>
            <Field label={`Slow mode: ${fmtSlow(d.rate)}`} hint="Members must wait this long between messages. People with Manage Messages are exempt.">
              <input
                type="range"
                className="w-full"
                disabled={!editable}
                min={0}
                max={SLOWMODES.length - 1}
                value={Math.max(0, SLOWMODES.indexOf(d.rate))}
                onChange={(e) => setD({ ...d, rate: SLOWMODES[Number(e.target.value)] })}
              />
            </Field>
            {!isForum && (
              <Toggle
                label="Announcement channel"
                hint="Only people with Manage Messages can post. Other servers can follow it, and published posts are copied to them."
                checked={d.announcement}
                onChange={(v) => editable && setD({ ...d, announcement: v })}
              />
            )}
            <Toggle
              label="Age-restricted channel"
              hint="Members must confirm they are 18+ before viewing."
              checked={d.nsfw}
              onChange={(v) => editable && setD({ ...d, nsfw: v })}
            />
          </>
        )}
        {isForum && (
          <>
            <Field label={`Tags (${d.tags.length}/20)`} hint="Members pick up to 5 when posting, and everyone can filter by them.">
              <div className="flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-ae-border bg-ae-surface px-2 py-0.5 text-xs">
                    {t.emoji} {t.name}
                    {editable && (
                      <button type="button" className="text-ae-muted hover:text-ae-danger" onClick={() => setD({ ...d, tags: d.tags.filter((x) => x.id !== t.id) })}>
                        <CloseIcon size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {editable && d.tags.length < 20 && (
                <div className="mt-2 flex gap-2">
                  <input className={`${inputCls} !w-16 shrink-0 text-center`} placeholder="🏷️" maxLength={8} value={tagEmoji} onChange={(e) => setTagEmoji(e.target.value)} />
                  <input className={inputCls} placeholder="Tag name" maxLength={20} value={tagName} onChange={(e) => setTagName(e.target.value)} />
                  <button
                    type="button"
                    disabled={!tagName.trim()}
                    className="shrink-0 rounded-ae bg-ae-surface px-3 text-sm hover:bg-ae-hover disabled:opacity-40"
                    onClick={() => {
                      const id = Math.random().toString(36).slice(2, 10);
                      setD({ ...d, tags: [...d.tags, { id, name: tagName.trim(), emoji: tagEmoji.trim() || null }] });
                      setTagName('');
                      setTagEmoji('');
                    }}
                  >
                    Add tag
                  </button>
                </div>
              )}
            </Field>
            <Toggle label="Require a tag on new posts" checked={d.requireTag} onChange={(v) => editable && setD({ ...d, requireTag: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Default sort">
                <select className={inputCls} disabled={!editable} value={d.sort} onChange={(e) => setD({ ...d, sort: e.target.value as typeof d.sort })}>
                  <option value="activity">Recently active</option>
                  <option value="created">Newest</option>
                </select>
              </Field>
              <Field label="Default layout">
                <select className={inputCls} disabled={!editable} value={d.layout} onChange={(e) => setD({ ...d, layout: e.target.value as typeof d.layout })}>
                  <option value="list">List</option>
                  <option value="gallery">Gallery</option>
                </select>
              </Field>
            </div>
          </>
        )}
        {isVoice && (
          <Field label={`User limit: ${d.limit ?? 'No limit'}`} hint="Peer-to-peer voice works best with up to about 10 people.">
            <input
              type="range"
              className="w-full"
              disabled={!editable}
              min={0}
              max={25}
              value={d.limit ?? 0}
              onChange={(e) => setD({ ...d, limit: Number(e.target.value) || null })}
            />
          </Field>
        )}
      </Section>

      {editable && (
        <Section title="Danger zone">
          <button
            type="button"
            className="rounded-ae bg-ae-danger px-4 py-2 text-sm font-semibold text-white"
            onClick={async () => {
              const what = channel.type === 'category' ? 'category (channels inside it are kept)' : 'channel and all of its messages';
              if ((await ask(`Delete this ${what}? This cannot be undone.`))) actions.remove.mutate(channel.id, { onSuccess: onDeleted });
            }}
          >
            Delete {channel.type === 'category' ? 'category' : 'channel'}
          </button>
        </Section>
      )}

      {(dirty || actions.update.error) && (
        <div className="sticky bottom-0 flex items-center gap-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-xl">
          <span className="flex-1 text-sm">{actions.update.error ? <span className="text-ae-danger">{actions.update.error.message}</span> : 'You have unsaved changes.'}</span>
          <button type="button" className="text-sm text-ae-muted" onClick={() => setD(initial)}>
            Reset
          </button>
          <button
            type="button"
            disabled={actions.update.isPending}
            className="rounded-ae bg-ae-success px-4 py-1.5 text-sm font-semibold text-black"
            onClick={() =>
              actions.update.mutate({
                id: channel.id,
                patch: {
                  name: d.name.trim() || channel.name,
                  ...(channel.type === 'text' ? { topic: d.topic.trim() || null, rate_limit_seconds: d.rate, nsfw: d.nsfw } : {}),
                  ...(channel.type === 'text' && !isForum ? { subtype: d.announcement ? ('announcement' as const) : null } : {}),
                  ...(isForum ? { forum_tags: d.tags, require_tag: d.requireTag, default_sort: d.sort, default_layout: d.layout } : {}),
                  ...(isVoice ? { user_limit: d.limit } : {}),
                },
              })
            }
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

type TriState = 'allow' | 'inherit' | 'deny';

function PermissionsTab({ channel, server, editable }: { channel: Channel; server: Server; editable: boolean }) {
  const { data: roles = [] } = useServerRoles(server.id);
  const { data: members = [] } = useServerMembers(server.id);
  const { data: overwrites = [] } = useChannelOverwrites(channel.id);
  const actions = useOverwriteActions(channel.id, server.id);
  const memberProfiles = useProfiles(members.map((m) => m.user_id));
  const nameOf = (type: 'role' | 'member', id: string) =>
    type === 'role'
      ? (roles.find((r) => r.id === id)?.name ?? 'Deleted role')
      : (() => {
          const i = members.findIndex((m) => m.user_id === id);
          return members[i]?.nickname || memberProfiles[i]?.display_name || memberProfiles[i]?.username || 'Member';
        })();

  const everyone = roles.find((r) => r.is_default);
  const targets = useMemo(() => {
    const list = overwrites.map((o) => ({ type: o.target_type, id: o.target_id }));
    if (everyone && !list.some((t) => t.id === everyone.id)) list.unshift({ type: 'role', id: everyone.id });
    return list;
  }, [overwrites, everyone]);
  const [selected, setSelected] = useState<{ type: 'role' | 'member'; id: string } | null>(null);
  const current = selected ?? targets[0] ?? null;
  const existing = current ? overwrites.find((o) => o.target_type === current.type && o.target_id === current.id) : undefined;

  const [allow, setAllow] = useState(0n);
  const [deny, setDeny] = useState(0n);
  useEffect(() => {
    setAllow(toMask(existing?.allow));
    setDeny(toMask(existing?.deny));
  }, [existing, current?.id]);
  const dirty = allow !== toMask(existing?.allow) || deny !== toMask(existing?.deny);

  const stateOf = (bit: bigint): TriState => ((allow & bit) !== 0n ? 'allow' : (deny & bit) !== 0n ? 'deny' : 'inherit');
  const setState = (bit: bigint, s: TriState) => {
    setAllow((a) => (s === 'allow' ? a | bit : a & ~bit));
    setDeny((d) => (s === 'deny' ? d | bit : d & ~bit));
  };

  const addable = [
    ...roles.filter((r) => !targets.some((t) => t.id === r.id)).map((r) => ({ type: 'role' as const, id: r.id, label: `@${r.name}` })),
    ...members.filter((m) => !targets.some((t) => t.id === m.user_id)).map((m) => ({ type: 'member' as const, id: m.user_id, label: nameOf('member', m.user_id) })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="space-y-2">
        <p className="px-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Roles / members</p>
        <ul className="space-y-0.5">
          {targets.map((t) => (
            <li key={`${t.type}:${t.id}`}>
              <button
                type="button"
                onClick={() => setSelected(t)}
                className={`w-full truncate rounded-ae px-2 py-1.5 text-left text-sm ${current?.id === t.id ? 'bg-ae-surface' : 'hover:bg-ae-hover'}`}
              >
                {t.type === 'role' ? `@${nameOf('role', t.id).replace(/^@/, '')}` : <><UserIcon size={13} className="ae-ico" /> {nameOf('member', t.id)}</>}
              </button>
            </li>
          ))}
        </ul>
        {editable && addable.length > 0 && (
          <select
            className={inputCls}
            value=""
            onChange={(e) => {
              const [type, id] = e.target.value.split(':') as ['role' | 'member', string];
              if (id) setSelected({ type, id });
            }}
          >
            <option value="">+ Add role or member…</option>
            {addable.map((a) => (
              <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>
                {a.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {current && (
        <div className="space-y-6">
          <p className="text-sm text-ae-muted">
            Overrides for <strong className="text-ae-text">{current.type === 'role' ? `@${nameOf('role', current.id).replace(/^@/, '')}` : nameOf('member', current.id)}</strong> in this{' '}
            {channel.type === 'category' ? 'category' : 'channel'}. <span className="text-ae-danger"><CloseIcon size={15} className="ae-ico" /> deny</span> beats role grants;{' '}
            <span className="text-ae-success"><CheckIcon size={15} className="ae-ico" /> allow</span> grants it here even if roles don't; <strong>/</strong> inherits.
          </p>
          {PERMISSION_GROUPS.map((g) => {
            const items = g.items.filter((i) => i.channel);
            if (!items.length) return null;
            return (
              <Section key={g.title} title={g.title}>
                <div className="space-y-2">
                  {items.map((item) => {
                    const bit = Permission[item.key];
                    const s = stateOf(bit);
                    return (
                      <div key={item.key} className="flex items-center justify-between gap-4">
                        <span>
                          <span className="block text-sm">{item.label}</span>
                          <span className="block text-xs text-ae-muted">{item.hint}</span>
                        </span>
                        <div className="flex overflow-hidden rounded-ae border border-ae-border">
                          {(['deny', 'inherit', 'allow'] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              disabled={!editable}
                              title={opt === 'deny' ? 'Deny' : opt === 'allow' ? 'Allow' : 'Inherit'}
                              onClick={() => setState(bit, opt)}
                              className={`h-8 w-9 text-sm ${
                                s === opt
                                  ? opt === 'deny'
                                    ? 'bg-ae-danger text-white'
                                    : opt === 'allow'
                                      ? 'bg-ae-success text-black'
                                      : 'bg-ae-surface'
                                  : 'hover:bg-ae-hover'
                              }`}
                            >
                              {opt === 'deny' ? <CloseIcon size={14} /> : opt === 'allow' ? <CheckIcon size={14} /> : '/'}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            );
          })}
          {editable && (
            <div className="sticky bottom-0 flex items-center gap-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-xl">
              <span className="flex-1 text-sm">
                {actions.save.error || actions.remove.error ? (
                  <span className="text-ae-danger">{(actions.save.error ?? actions.remove.error)!.message}</span>
                ) : dirty ? (
                  'You have unsaved changes.'
                ) : (
                  'No changes.'
                )}
              </span>
              {existing && (
                <button
                  type="button"
                  className="text-sm text-ae-danger hover:underline"
                  onClick={() => actions.remove.mutate({ target_type: current.type, target_id: current.id }, { onSuccess: () => setSelected(null) })}
                >
                  Remove overrides
                </button>
              )}
              <button
                type="button"
                disabled={!dirty || actions.save.isPending}
                className="rounded-ae bg-ae-success px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40"
                onClick={() => actions.save.mutate({ target_type: current.type, target_id: current.id, allow, deny })}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelSettings({ servers, channels, userId }: { servers: Server[]; channels: Channel[]; userId: string }) {
  const channelId = useUiStore((s) => s.channelSettingsId);
  const close = useUiStore((s) => s.openChannelSettings);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const server = servers.find((s) => s.id === channel?.server_id) ?? null;

  useEscape(() => close(null), !!channelId);

  if (!channel || !server) return null;
  return <ChannelSettingsInner channel={channel} server={server} userId={userId} onClose={() => close(null)} />;
}

function ChannelSettingsInner({ channel, server, userId, onClose }: { channel: Channel; server: Server; userId: string; onClose: () => void }) {
  const rank = useRank(server, userId);
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const canManage = rank.can(Permission.MANAGE_CHANNELS);
  const canPerms = rank.can(Permission.MANAGE_ROLES);

  return (
    <div className="ae-zoom-in absolute inset-0 z-50 flex bg-ae-bg" role="dialog" aria-modal="true" aria-label="Channel settings">
      <nav className="ae-panel flex w-60 shrink-0 flex-col gap-1 border-r border-ae-border p-4">
        <p className="mb-2 flex items-center gap-1 truncate px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
          {channel.type !== 'category' && <ChannelGlyph type={channel.type} size={12} />} {channel.name}
        </p>
        {(['overview', 'permissions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-ae px-3 py-2 text-left text-sm capitalize ${tab === t ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {t}
          </button>
        ))}
      </nav>
      <main className="ae-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-8">
          <h2 className="mb-6 text-xl font-bold capitalize">{tab}</h2>
          {tab === 'overview' && <OverviewTab channel={channel} server={server} editable={canManage} onDeleted={onClose} />}
          {tab === 'permissions' && <PermissionsTab channel={channel} server={server} editable={canPerms} />}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close channel settings"
          className="absolute top-4 right-5 z-10 grid h-9 w-9 bg-ae-bg/80 backdrop-blur place-items-center rounded-full border border-ae-border text-ae-muted hover:text-ae-text"
        >
          <CloseIcon />
        </button>
      </main>
    </div>
  );
}
