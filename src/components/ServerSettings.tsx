/**
 * Server Settings: Overview · Roles · Members · Invites · Bans · Audit Log.
 * Every tab and control is gated by the caller's permissions and role rank; the database
 * enforces the same rules (RLS + RPC checks), so the UI only hides what would fail anyway.
 */
import { inviteLink } from '../lib/invites';
import { ask, promptText } from './ConfirmDialog';
import { AutomodTab, ModerationTab, TransferOwnership } from './ServerModeration';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useChannels, useProfile, useServerMembers, useServerPermissions, useUploadProfileMedia } from '../hooks/useChatData';
import {
  useAuditLog,
  useBans,
  useInviteActions,
  useInvites,
  useMemberStyles,
  useModeration,
  useRoleActions,
  useServerRoles,
  useUpdateServer,
} from '../hooks/useServerAdmin';
import { hasPermission, Permission, PERMISSION_GROUPS, toMask, type PermissionName } from '../lib/permissions';
import { useUiStore, type ServerSettingsTab } from '../stores/uiStore';
import type { AuditEntry, Server, ServerMember, ServerRole } from '../types/db';
import { useProfiles } from './ConversationBits';
import { ArchiveIcon, BellIcon, BellOffIcon, BlockIcon, CalendarIcon, CheckIcon, CloseIcon, CrownIcon, FlagIcon, GavelIcon, GripIcon, LockIcon, MailIcon, MegaphoneIcon, MicIcon, MicOffIcon, MinusIcon, PartyIcon, PhoneOffIcon, PlayIcon, PlusIcon, SettingsIcon, SoundboardIcon, SquareIcon, TagIcon, TimeoutIcon, TrashIcon, UnlockIcon, UserCheckIcon, UserCogIcon, UserXIcon } from './icons';
import { DisplayName, formatTime } from './MessageItem';
import { Avatar } from './ProfileCard';
import { SoundboardTab } from './SoundboardSettings';
import { ColorField, Field, inputCls, Section, Toggle } from './SettingsPanel';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Rank {
  isOwner: boolean;
  perms: bigint;
  /** Highest role position the caller holds (owners: Infinity). */
  top: number;
  can: (p: bigint) => boolean;
  /** Whether the caller outranks a role at this position. */
  above: (position: number) => boolean;
}

function useRank(server: Server, userId: string): Rank {
  const { data: perms = 0n } = useServerPermissions(server.id);
  const styles = useMemberStyles(server.id);
  const isOwner = server.owner_id === userId;
  const top = isOwner ? Infinity : (styles.get(userId)?.topPosition ?? 0);
  return {
    isOwner,
    perms,
    top,
    can: (p) => isOwner || hasPermission(perms, p),
    above: (position) => isOwner || position < top,
  };
}

function RolePill({ role, onRemove }: { role: ServerRole; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ae-border bg-ae-sunken px-2 py-0.5 text-xs">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color ?? 'var(--ae-text-muted)' }} />
      {role.name}
      {onRemove && (
        <button type="button" aria-label={`Remove ${role.name}`} className="text-ae-muted hover:text-ae-danger" onClick={onRemove}>
          <CloseIcon size={10} />
        </button>
      )}
    </span>
  );
}

function SaveBar({ dirty, pending, error, onSave, onReset }: { dirty: boolean; pending: boolean; error?: string | null; onSave: () => void; onReset: () => void }) {
  if (!dirty && !error) return null;
  return (
    <div className="sticky bottom-0 z-10 mt-6 flex items-center gap-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-xl">
      <span className="flex-1 text-sm">{error ? <span className="text-ae-danger">{error}</span> : 'You have unsaved changes.'}</span>
      <button type="button" className="text-sm text-ae-muted hover:text-ae-text" onClick={onReset}>
        Reset
      </button>
      <button type="button" disabled={pending} onClick={onSave} className="rounded-ae bg-ae-success px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────────────────────

function OverviewTab({ server, userId, rank }: { server: Server; userId: string; rank: Rank }) {
  const update = useUpdateServer(userId);
  const upload = useUploadProfileMedia(userId);
  const [draft, setDraft] = useState({ name: server.name, description: server.description ?? '', icon_url: server.icon_url, banner_url: server.banner_url });
  useEffect(() => setDraft({ name: server.name, description: server.description ?? '', icon_url: server.icon_url, banner_url: server.banner_url }), [server]);
  const editable = rank.can(Permission.MANAGE_SERVER);
  const dirty =
    draft.name !== server.name || draft.description !== (server.description ?? '') || draft.icon_url !== server.icon_url || draft.banner_url !== server.banner_url;

  const pickImage = (kind: 'icon_url' | 'banner_url') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) upload.mutate({ file, kind: kind === 'icon_url' ? 'avatar' : 'banner' }, { onSuccess: (url) => setDraft((d) => ({ ...d, [kind]: url })) });
    };
    input.click();
  };

  return (
    <div className="space-y-6">
      {!editable && <p className="rounded-ae bg-ae-sunken p-3 text-sm text-ae-muted">You need the Manage Server permission to edit these.</p>}
      <Section title="Server identity">
        <div className="flex items-start gap-6">
          <div className="space-y-2 text-center">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-ae-surface text-2xl font-bold">
              {draft.icon_url ? <img src={draft.icon_url} alt="" className="h-full w-full object-cover" /> : server.name.slice(0, 2).toUpperCase()}
            </div>
            {editable && (
              <div className="flex flex-col gap-1">
                <button type="button" className="text-xs text-ae-accent hover:underline" onClick={() => pickImage('icon_url')}>
                  {upload.isPending ? 'Uploading…' : 'Upload icon'}
                </button>
                {draft.icon_url && (
                  <button type="button" className="text-xs text-ae-muted hover:text-ae-danger" onClick={() => setDraft((d) => ({ ...d, icon_url: null }))}>
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <Field label="Server name">
              <input className={inputCls} disabled={!editable} maxLength={100} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="Description">
              <textarea
                className={`${inputCls} min-h-20`}
                disabled={!editable}
                maxLength={1000}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Section>
      <Section title="Banner" description="Shown at the top of the channel list.">
        <div className="h-28 overflow-hidden rounded-ae border border-ae-border bg-ae-sunken">
          {draft.banner_url && <img src={draft.banner_url} alt="" className="h-full w-full object-cover" />}
        </div>
        {editable && (
          <div className="flex gap-3">
            <button type="button" className="text-sm text-ae-accent hover:underline" onClick={() => pickImage('banner_url')}>
              Upload banner
            </button>
            {draft.banner_url && (
              <button type="button" className="text-sm text-ae-muted hover:text-ae-danger" onClick={() => setDraft((d) => ({ ...d, banner_url: null }))}>
                Remove
              </button>
            )}
          </div>
        )}
      </Section>
      <SaveBar
        dirty={dirty}
        pending={update.isPending}
        error={update.error?.message ?? upload.error?.message}
        onReset={() => setDraft({ name: server.name, description: server.description ?? '', icon_url: server.icon_url, banner_url: server.banner_url })}
        onSave={() =>
          update.mutate({
            id: server.id,
            patch: { name: draft.name.trim(), description: draft.description.trim() || null, icon_url: draft.icon_url, banner_url: draft.banner_url },
          })
        }
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────────────────────

function RoleEditor({ server, role, rank, members, onDeleted }: {
  server: Server;
  role: ServerRole;
  rank: Rank;
  members: ServerMember[];
  onDeleted: () => void;
}) {
  const actions = useRoleActions(server.id);
  const styles = useMemberStyles(server.id);
  const [draft, setDraft] = useState({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, perms: toMask(role.permissions) });
  useEffect(
    () => setDraft({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, perms: toMask(role.permissions) }),
    [role],
  );
  const editable = rank.can(Permission.MANAGE_ROLES) && rank.above(role.position);
  const dirty =
    draft.name !== role.name ||
    draft.color !== role.color ||
    draft.hoist !== role.hoist ||
    draft.mentionable !== role.mentionable ||
    draft.perms !== toMask(role.permissions);

  const holders = members.filter((m) => styles.get(m.user_id)?.roleIds.includes(role.id));
  const holderProfiles = useProfiles(holders.map((m) => m.user_id));
  const candidates = members.filter((m) => !styles.get(m.user_id)?.roleIds.includes(role.id));
  const candidateProfiles = useProfiles(candidates.map((m) => m.user_id));

  const togglePerm = (key: PermissionName, on: boolean) =>
    setDraft((d) => ({ ...d, perms: on ? d.perms | Permission[key] : d.perms & ~Permission[key] }));

  return (
    <div className="space-y-6">
      {!editable && (
        <p className="rounded-ae bg-ae-sunken p-3 text-sm text-ae-muted">
          {rank.can(Permission.MANAGE_ROLES) ? 'This role is at or above your highest role, so you can only view it.' : 'You need Manage Roles to edit roles.'}
        </p>
      )}
      <Section title={role.is_default ? '@everyone' : 'Display'} description={role.is_default ? 'The base permissions every member has.' : undefined}>
        {!role.is_default && (
          <>
            <Field label="Role name">
              <input className={inputCls} disabled={!editable} maxLength={64} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <ColorField label="Role color" value={draft.color} onChange={(v) => editable && setDraft((d) => ({ ...d, color: v }))} />
            <Toggle
              label="Display role members separately from online members"
              checked={draft.hoist}
              onChange={(v) => editable && setDraft((d) => ({ ...d, hoist: v }))}
            />
            <Toggle
              label="Allow anyone to @mention this role"
              hint="Members with “Mention @everyone” can always mention every role."
              checked={draft.mentionable}
              onChange={(v) => editable && setDraft((d) => ({ ...d, mentionable: v }))}
            />
          </>
        )}
      </Section>

      {PERMISSION_GROUPS.map((group) => (
        <Section key={group.title} title={`${group.title} permissions`}>
          <div className="space-y-3">
            {group.items.map((item) => {
              const bit = Permission[item.key];
              const lacking = !rank.can(bit); // can't grant what you don't have
              return (
                <label key={item.key} className={`flex items-start justify-between gap-4 ${lacking || !editable ? 'opacity-60' : 'cursor-pointer'}`}>
                  <span>
                    <span className="block text-sm">{item.label}</span>
                    <span className="block text-xs text-ae-muted">{item.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={(draft.perms & bit) !== 0n}
                    disabled={!editable || lacking}
                    onChange={(e) => togglePerm(item.key, e.target.checked)}
                  />
                </label>
              );
            })}
          </div>
        </Section>
      ))}

      {!role.is_default && (
        <Section title={`Members with this role (${holders.length})`}>
          <ul className="space-y-1">
            {holders.map((m, i) => (
              <li key={m.user_id} className="flex items-center gap-2 rounded-ae px-2 py-1 hover:bg-ae-hover">
                <Avatar profile={holderProfiles[i]} size={24} showFrame={false} />
                <span className="flex-1 truncate text-sm">{m.nickname || holderProfiles[i]?.display_name || holderProfiles[i]?.username}</span>
                {editable && (
                  <button type="button" className="text-xs text-ae-muted hover:text-ae-danger" onClick={() => actions.unassign.mutate({ userId: m.user_id, roleId: role.id })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editable && candidates.length > 0 && (
            <select
              className={inputCls}
              value=""
              onChange={(e) => e.target.value && actions.assign.mutate({ userId: e.target.value, roleId: role.id })}
            >
              <option value="">Add a member…</option>
              {candidates.map((m, i) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.nickname || candidateProfiles[i]?.display_name || candidateProfiles[i]?.username || m.user_id}
                </option>
              ))}
            </select>
          )}
        </Section>
      )}

      {!role.is_default && editable && (
        <Section title="Danger zone">
          <button
            type="button"
            className="rounded-ae bg-ae-danger px-4 py-2 text-sm font-semibold text-white"
            onClick={async () => {
              if ((await ask(`Delete the role "${role.name}"? Members keep their other roles.`))) actions.remove.mutate(role.id, { onSuccess: onDeleted });
            }}
          >
            Delete role
          </button>
        </Section>
      )}

      <SaveBar
        dirty={dirty}
        pending={actions.update.isPending}
        error={actions.update.error?.message ?? actions.assign.error?.message ?? actions.remove.error?.message}
        onReset={() => setDraft({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, perms: toMask(role.permissions) })}
        onSave={() =>
          actions.update.mutate({
            id: role.id,
            patch: {
              ...(role.is_default ? {} : { name: draft.name.trim() || role.name, color: draft.color, hoist: draft.hoist, mentionable: draft.mentionable }),
              permissions: Number(draft.perms),
            },
          })
        }
      />
    </div>
  );
}

function RolesTab({ server, rank }: { server: Server; rank: Rank }) {
  const { data: roles = [] } = useServerRoles(server.id);
  const { data: members = [] } = useServerMembers(server.id);
  const actions = useRoleActions(server.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const ordered = roles.filter((r) => !r.is_default); // highest first
  const everyone = roles.find((r) => r.is_default);
  const selected = roles.find((r) => r.id === selectedId) ?? ordered[0] ?? everyone ?? null;
  const canManage = rank.can(Permission.MANAGE_ROLES);

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((r) => r.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    actions.reorder.mutate(ids);
    setDragId(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="space-y-2">
        {canManage && (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent"
            onClick={() => {
              const position = rank.isOwner ? (ordered[0]?.position ?? 0) + 1 : Math.max(1, Math.min(rank.top - 1, 1));
              actions.create.mutate({ name: 'new role', position }, { onSuccess: (r) => setSelectedId(r.id) });
            }}
          >
            <PlusIcon size={14} /> Create role
          </button>
        )}
        <p className="px-1 text-[11px] text-ae-muted">Drag to reorder. Higher roles outrank lower ones.</p>
        <ul className="space-y-0.5">
          {ordered.map((r) => {
            const movable = canManage && rank.above(r.position);
            return (
              <li
                key={r.id}
                draggable={movable}
                onDragStart={() => setDragId(r.id)}
                onDragOver={(e) => movable && e.preventDefault()}
                onDrop={() => dropOn(r.id)}
                className={`${dragId === r.id ? 'opacity-40' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${selected?.id === r.id ? 'bg-ae-surface' : 'hover:bg-ae-hover'}`}
                >
                  {movable && <GripIcon size={14} className="cursor-grab text-ae-muted" />}
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color ?? 'var(--ae-text-muted)' }} />
                  <span className="truncate">{r.name}</span>
                  {!movable && canManage && <span className="ml-auto text-xs text-ae-muted" title="Above your highest role"><LockIcon size={15} className="ae-ico" /></span>}
                </button>
              </li>
            );
          })}
          {everyone && (
            <li>
              <button
                type="button"
                onClick={() => setSelectedId(everyone.id)}
                className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${selected?.id === everyone.id ? 'bg-ae-surface' : 'hover:bg-ae-hover'}`}
              >
                <span className="h-3 w-3 rounded-full bg-ae-muted" />
                @everyone
              </button>
            </li>
          )}
        </ul>
        {actions.reorder.error && <p className="text-xs text-ae-danger">{actions.reorder.error.message}</p>}
      </div>
      {selected && <RoleEditor key={selected.id} server={server} role={selected} rank={rank} members={members} onDeleted={() => setSelectedId(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TIMEOUTS: { minutes: number; label: string }[] = [
  { minutes: 1, label: '60 seconds' },
  { minutes: 5, label: '5 minutes' },
  { minutes: 10, label: '10 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
  { minutes: 10080, label: '1 week' },
];

export function MemberModeration({ server, member, rank, compact = false }: { server: Server; member: ServerMember; rank: Rank; compact?: boolean }) {
  const { data: roles = [] } = useServerRoles(server.id);
  const styles = useMemberStyles(server.id);
  const roleActions = useRoleActions(server.id);
  const mod = useModeration(server.id);
  const memberTop = member.user_id === server.owner_id ? Infinity : (styles.get(member.user_id)?.topPosition ?? 0);
  const outranks = rank.isOwner ? member.user_id !== server.owner_id : memberTop < rank.top;
  const roleIds = styles.get(member.user_id)?.roleIds ?? [];
  const assignable = roles.filter((r) => !r.is_default && !roleIds.includes(r.id) && rank.above(r.position));
  const timedOut = member.timed_out_until && new Date(member.timed_out_until) > new Date();
  const error = mod.kick.error ?? mod.ban.error ?? mod.timeout.error ?? mod.nickname.error ?? roleActions.assign.error ?? roleActions.unassign.error;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {roleIds.map((id) => {
          const r = roles.find((x) => x.id === id);
          if (!r) return null;
          const removable = rank.can(Permission.MANAGE_ROLES) && rank.above(r.position);
          return <RolePill key={id} role={r} onRemove={removable ? () => roleActions.unassign.mutate({ userId: member.user_id, roleId: id }) : undefined} />;
        })}
        {rank.can(Permission.MANAGE_ROLES) && assignable.length > 0 && (
          <select
            className="rounded-full border border-dashed border-ae-border bg-transparent px-2 py-0.5 text-xs text-ae-muted"
            value=""
            onChange={(e) => e.target.value && roleActions.assign.mutate({ userId: member.user_id, roleId: e.target.value })}
          >
            <option value="">+ Role</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {timedOut && (
        <p className="text-xs text-ae-warning">
          <TimeoutIcon size={15} className="ae-ico" /> Timed out until {new Date(member.timed_out_until!).toLocaleString()}
          {rank.can(Permission.MODERATE_MEMBERS) && outranks && (
            <button type="button" className="ml-2 text-ae-accent hover:underline" onClick={() => mod.timeout.mutate({ userId: member.user_id, minutes: 0 })}>
              Remove timeout
            </button>
          )}
        </p>
      )}
      {outranks && (
        <div className={`flex flex-wrap gap-2 ${compact ? '' : 'pt-1'}`}>
          {rank.can(Permission.MANAGE_NICKNAMES) && (
            <button
              type="button"
              className="rounded-ae bg-ae-surface px-2.5 py-1 text-xs hover:bg-ae-hover"
              onClick={async () => {
                const nick = await promptText('Nickname', { title: 'Change nickname', initial: member.nickname ?? '', maxLength: 32, placeholder: 'Leave empty to reset' });
                if (nick !== null) mod.nickname.mutate({ userId: member.user_id, nickname: nick });
              }}
            >
              Nickname
            </button>
          )}
          {rank.can(Permission.MODERATE_MEMBERS) && !timedOut && (
            <select
              className="rounded-ae bg-ae-surface px-2 py-1 text-xs hover:bg-ae-hover"
              value=""
              onChange={async (e) => {
                const minutes = Number(e.target.value);
                if (!minutes) return;
                const reason = await promptText('Shown in the audit log.', { title: 'Reason (optional)', maxLength: 300, confirmLabel: 'Time out', danger: true });
                if (reason === null) return;
                mod.timeout.mutate({ userId: member.user_id, minutes, reason: reason || undefined });
              }}
            >
              <option value="">Timeout…</option>
              {TIMEOUTS.map((t) => (
                <option key={t.minutes} value={t.minutes}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          {rank.can(Permission.KICK_MEMBERS) && (
            <button
              type="button"
              className="rounded-ae bg-ae-surface px-2.5 py-1 text-xs text-ae-danger hover:bg-ae-hover"
              onClick={async () => {
                const reason = await promptText('They can rejoin with an invite. Add a reason for the audit log (optional).', { title: 'Kick this member?', maxLength: 300, confirmLabel: 'Kick', danger: true });
                if (reason !== null) mod.kick.mutate({ userId: member.user_id, reason: reason || undefined });
              }}
            >
              Kick
            </button>
          )}
          {rank.can(Permission.BAN_MEMBERS) && (
            <button
              type="button"
              className="rounded-ae bg-ae-danger px-2.5 py-1 text-xs font-semibold text-white"
              onClick={async () => {
                const reason = await promptText('They can’t rejoin until unbanned. Add a reason for the audit log (optional).', { title: 'Ban this member?', maxLength: 300, confirmLabel: 'Ban', danger: true });
                if (reason !== null) mod.ban.mutate({ userId: member.user_id, reason: reason || undefined });
              }}
            >
              Ban
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-ae-danger">{error.message}</p>}
    </div>
  );
}

function MembersTab({ server, rank }: { server: Server; rank: Rank }) {
  const { data: members = [] } = useServerMembers(server.id);
  const profiles = useProfiles(members.map((m) => m.user_id));
  const [q, setQ] = useState('');
  const rows = members
    .map((m, i) => ({ m, p: profiles[i] }))
    .filter(({ m, p }) => {
      const s = q.trim().toLowerCase();
      return !s || `${m.nickname ?? ''} ${p?.username ?? ''} ${p?.display_name ?? ''}`.toLowerCase().includes(s);
    });

  return (
    <div className="space-y-4">
      <input className={inputCls} placeholder={`Search ${members.length} members`} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y divide-ae-border">
        {rows.map(({ m, p }) => (
          <li key={m.user_id} className="flex gap-3 py-3">
            <Avatar profile={p} size={40} showFrame={false} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold">
                {m.nickname || p?.display_name || p?.username || '…'}{' '}
                <span className="font-normal text-ae-muted">@{p?.username}</span>
                {m.user_id === server.owner_id && <span title="Owner"> <CrownIcon size={15} className="ae-ico" /></span>}
              </p>
              <p className="text-xs text-ae-muted">Joined {new Date(m.joined_at).toLocaleDateString()}</p>
              <MemberModeration server={server} member={m} rank={rank} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Invites & bans
// ─────────────────────────────────────────────────────────────────────────────────────────────

function InvitesTab({ server, rank, userId }: { server: Server; rank: Rank; userId: string }) {
  const { data: invites = [], isLoading } = useInvites(server.id, true);
  const actions = useInviteActions(server.id);
  const [expires, setExpires] = useState<number | null>(168);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const canCreate = rank.can(Permission.CREATE_INVITE);

  return (
    <div className="space-y-6">
      {canCreate && (
        <Section title="Create an invite">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Expire after">
              <select className={inputCls} value={expires ?? ''} onChange={(e) => setExpires(e.target.value ? Number(e.target.value) : null)}>
                <option value={0.5}>30 minutes</option>
                <option value={1}>1 hour</option>
                <option value={6}>6 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>1 day</option>
                <option value={168}>7 days</option>
                <option value="">Never</option>
              </select>
            </Field>
            <Field label="Max uses">
              <select className={inputCls} value={maxUses ?? ''} onChange={(e) => setMaxUses(e.target.value ? Number(e.target.value) : null)}>
                <option value="">No limit</option>
                {[1, 5, 10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} use{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </Field>
            {rank.can(Permission.MANAGE_SERVER) && (
              <Field label="Custom code (optional)" hint="6–32 letters and numbers">
                <input className={inputCls} value={code} maxLength={32} placeholder="myserver" onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} />
              </Field>
            )}
          </div>
          <button
            type="button"
            disabled={actions.create.isPending || (code.length > 0 && code.length < 6)}
            className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
            onClick={() => actions.create.mutate({ maxUses, expiresHours: expires, code: code || undefined }, { onSuccess: () => setCode('') })}
          >
            Create invite
          </button>
          {actions.create.error && <p className="text-sm text-ae-danger">{actions.create.error.message}</p>}
        </Section>
      )}

      <Section title={`Active invites (${invites.length})`}>
        {isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
        {!isLoading && invites.length === 0 && <p className="text-sm text-ae-muted">No invites yet.</p>}
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wide text-ae-muted uppercase">
            <tr>
              <th className="py-1">Code</th>
              <th>Inviter</th>
              <th>Uses</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
              const canRevoke = inv.creator_id === userId || rank.can(Permission.MANAGE_SERVER);
              return (
                <tr key={inv.code} className={`border-t border-ae-border ${expired ? 'opacity-50' : ''}`}>
                  <td className="py-2 font-mono">
                    <button
                      type="button"
                      title="Copy"
                      className="hover:text-ae-accent"
                      onClick={() => void navigator.clipboard.writeText(inviteLink(inv.code)).then(() => setCopied(inv.code))}
                    >
                      aether.chat/inv/{inv.code} {copied === inv.code && <CheckIcon size={13} className="ae-ico" />}
                    </button>
                  </td>
                  <td className="truncate">
                    <DisplayName userId={inv.creator_id} />
                  </td>
                  <td>
                    {inv.uses}
                    {inv.max_uses ? ` / ${inv.max_uses}` : ''}
                  </td>
                  <td className="text-xs">{expired ? 'Expired' : inv.expires_at ? new Date(inv.expires_at).toLocaleString() : 'Never'}</td>
                  <td className="text-right">
                    {canRevoke && (
                      <button type="button" className="text-xs text-ae-danger hover:underline" onClick={() => actions.revoke.mutate(inv.code)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function BansTab({ server }: { server: Server }) {
  const { data: bans = [], isLoading } = useBans(server.id, true);
  const mod = useModeration(server.id);
  const profiles = useProfiles(bans.map((b) => b.user_id));
  return (
    <Section title={`Bans (${bans.length})`} description="Banned users can't rejoin with any invite until unbanned.">
      {isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {!isLoading && bans.length === 0 && <p className="text-sm text-ae-muted">Nobody is banned. <PartyIcon size={15} className="ae-ico" /></p>}
      <ul className="divide-y divide-ae-border">
        {bans.map((b, i) => (
          <li key={b.user_id} className="flex items-center gap-3 py-2">
            <Avatar profile={profiles[i]} size={32} showFrame={false} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{profiles[i]?.display_name || profiles[i]?.username || b.user_id}</p>
              <p className="truncate text-xs text-ae-muted">
                {b.reason ? `Reason: ${b.reason}` : 'No reason given'} · banned {formatTime(b.created_at)}
              </p>
            </div>
            <button type="button" className="rounded-ae bg-ae-surface px-3 py-1 text-xs hover:bg-ae-hover" onClick={() => mod.unban.mutate(b.user_id)}>
              Unban
            </button>
          </li>
        ))}
      </ul>
      {mod.unban.error && <p className="text-sm text-ae-danger">{mod.unban.error.message}</p>}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { icon: ReactNode; text: string }> = {
  server_update: { icon: <SettingsIcon size={15} />, text: 'updated the server' },
  role_create: { icon: <UserCogIcon size={15} />, text: 'created a role' },
  role_update: { icon: <UserCogIcon size={15} />, text: 'updated a role' },
  role_delete: { icon: <TrashIcon size={15} />, text: 'deleted a role' },
  role_reorder: { icon: '↕️', text: 'reordered roles' },
  member_role_add: { icon: <PlusIcon size={15} />, text: 'added a role to' },
  member_role_remove: { icon: <MinusIcon size={15} />, text: 'removed a role from' },
  channel_create: { icon: '#️⃣', text: 'created a channel' },
  channel_update: { icon: '#️⃣', text: 'updated a channel' },
  channel_delete: { icon: <TrashIcon size={15} />, text: 'deleted a channel' },
  channel_reorder: { icon: '↕️', text: 'reordered channels' },
  overwrite_create: { icon: <LockIcon size={15} />, text: 'added channel permissions in' },
  overwrite_update: { icon: <LockIcon size={15} />, text: 'changed channel permissions in' },
  overwrite_delete: { icon: <LockIcon size={15} />, text: 'removed channel permissions in' },
  member_kick: { icon: <UserXIcon size={15} />, text: 'kicked' },
  member_ban: { icon: <GavelIcon size={15} />, text: 'banned' },
  member_unban: { icon: <UserCheckIcon size={15} />, text: 'unbanned' },
  member_timeout: { icon: <TimeoutIcon size={15} />, text: 'timed out' },
  member_timeout_remove: { icon: <TimeoutIcon size={15} />, text: 'removed the timeout for' },
  member_nickname: { icon: <TagIcon size={15} />, text: 'changed the nickname of' },
  invite_create: { icon: <MailIcon size={15} />, text: 'created invite' },
  invite_delete: { icon: <MailIcon size={15} />, text: 'revoked invite' },
  voice_server_mute: { icon: <MicOffIcon size={15} />, text: 'server-muted' },
  voice_server_unmute: { icon: <MicIcon size={15} />, text: 'removed the server mute for' },
  voice_server_deafen: { icon: <BellOffIcon size={15} />, text: 'server-deafened' },
  voice_server_undeafen: { icon: <BellIcon size={15} />, text: 'removed the server deafen for' },
  voice_move: { icon: '↪️', text: 'moved' },
  voice_disconnect: { icon: <PhoneOffIcon size={15} />, text: 'disconnected' },
  sound_create: { icon: <SoundboardIcon size={15} />, text: 'added the sound' },
  sound_update: { icon: <SoundboardIcon size={15} />, text: 'updated the sound' },
  sound_delete: { icon: <TrashIcon size={15} />, text: 'removed the sound' },
  server_transfer: { icon: <CrownIcon size={15} />, text: 'transferred ownership to' },
  report_resolved: { icon: <CheckIcon size={15} />, text: 'resolved a report about' },
  report_dismissed: { icon: <ArchiveIcon size={15} />, text: 'dismissed a report about' },
  report_open: { icon: <FlagIcon size={15} />, text: 'reopened a report about' },
  thread_lock: { icon: <LockIcon size={15} />, text: 'locked the thread' },
  thread_unlock: { icon: <UnlockIcon size={15} />, text: 'unlocked the thread' },
  thread_delete: { icon: <TrashIcon size={15} />, text: 'deleted the thread' },
  channel_follow: { icon: <MegaphoneIcon size={15} />, text: 'followed an announcement channel into' },
  event_create: { icon: <CalendarIcon size={15} />, text: 'scheduled the event' },
  event_update: { icon: <CalendarIcon size={15} />, text: 'edited the event' },
  event_delete: { icon: <TrashIcon size={15} />, text: 'deleted the event' },
  event_active: { icon: <PlayIcon size={15} />, text: 'started the event' },
  event_completed: { icon: <SquareIcon size={15} />, text: 'ended the event' },
  event_canceled: { icon: <BlockIcon size={15} />, text: 'canceled the event' },
};

function AuditRow({ e }: { e: AuditEntry }) {
  const { data: actor } = useProfile(e.actor_id);
  const label = ACTION_LABELS[e.action] ?? { icon: '•', text: e.action };
  const changed = Object.keys(e.changes ?? {}).filter((k) => !['role_id', 'id', 'server_id'].includes(k));
  let target: ReactNode = e.target_name ? <strong>{e.target_type === 'channel' ? `#${e.target_name}` : e.target_name}</strong> : null;
  if (e.target_type === 'member' && e.target_id)
    target = (
      <strong>
        <DisplayName userId={e.target_id} />
      </strong>
    );
  const detail =
    e.action === 'member_role_add' || e.action === 'member_role_remove'
      ? `(${String((e.changes as { role_name?: string }).role_name ?? 'role')})`
      : e.action === 'member_timeout'
        ? `for ${String((e.changes as { minutes?: number }).minutes)} min`
        : e.action.endsWith('_update') && changed.length
          ? `(${changed.join(', ')})`
          : '';

  return (
    <li className="flex gap-3 py-2.5">
      <span className="text-lg">{label.icon}</span>
      <Avatar profile={actor} size={28} showFrame={false} />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <strong>{actor?.display_name || actor?.username || 'Someone'}</strong> {label.text} {target} <span className="text-ae-muted">{detail}</span>
        </p>
        {e.reason && <p className="text-xs text-ae-muted">Reason: {e.reason}</p>}
        <p className="text-xs text-ae-muted">{formatTime(e.created_at)}</p>
      </div>
    </li>
  );
}

function AuditTab({ server }: { server: Server }) {
  const { data = [], isLoading, error } = useAuditLog(server.id, true);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const actors = useMemo(() => [...new Set(data.map((e) => e.actor_id).filter(Boolean))] as string[], [data]);
  const actorProfiles = useProfiles(actors);
  const rows = data.filter((e) => (!action || e.action.startsWith(action)) && (!actor || e.actor_id === actor));

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select className={inputCls} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All users</option>
          {actors.map((id, i) => (
            <option key={id} value={id}>
              {actorProfiles[i]?.display_name || actorProfiles[i]?.username || id}
            </option>
          ))}
        </select>
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="server_">Server</option>
          <option value="role_">Roles</option>
          <option value="member_role">Member roles</option>
          <option value="channel_">Channels</option>
          <option value="overwrite_">Channel permissions</option>
          <option value="member_kick">Kicks</option>
          <option value="member_ban">Bans</option>
          <option value="member_timeout">Timeouts</option>
          <option value="invite_">Invites</option>
        </select>
      </div>
      {isLoading && <p className="text-sm text-ae-muted">Loading…</p>}
      {error && <p className="text-sm text-ae-danger">{(error as Error).message}</p>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-ae-muted">Nothing logged yet.</p>}
      <ul className="divide-y divide-ae-border">
        {rows.map((e) => (
          <AuditRow key={e.id} e={e} />
        ))}
      </ul>
      <p className="text-xs text-ae-muted">Showing the latest 200 entries. The log is written by the database and can't be edited.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function ServerSettings({ servers, userId }: { servers: Server[]; userId: string }) {
  const target = useUiStore((s) => s.serverSettings);
  const open = useUiStore((s) => s.openServerSettings);
  const server = servers.find((s) => s.id === target?.serverId) ?? null;

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, open]);

  if (!target || !server) return null;
  return <ServerSettingsInner server={server} userId={userId} tab={target.tab} />;
}

function ServerSettingsInner({ server, userId, tab }: { server: Server; userId: string; tab: ServerSettingsTab }) {
  const open = useUiStore((s) => s.openServerSettings);
  const rank = useRank(server, userId);
  const { data: settingsChannels = [] } = useChannels(server.id);
  const tabs: { id: ServerSettingsTab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'roles', label: 'Roles', show: rank.can(Permission.MANAGE_ROLES) },
    {
      id: 'members',
      label: 'Members',
      show: [Permission.MANAGE_ROLES, Permission.KICK_MEMBERS, Permission.BAN_MEMBERS, Permission.MODERATE_MEMBERS, Permission.MANAGE_NICKNAMES].some(rank.can),
    },
    { id: 'moderation', label: 'Moderation', show: rank.can(Permission.MANAGE_MESSAGES) },
    { id: 'automod', label: 'AutoMod', show: rank.can(Permission.MANAGE_SERVER) },
    { id: 'soundboard', label: 'Soundboard', show: true },
    { id: 'invites', label: 'Invites', show: rank.can(Permission.CREATE_INVITE) },
    { id: 'bans', label: 'Bans', show: rank.can(Permission.BAN_MEMBERS) },
    { id: 'audit', label: 'Audit Log', show: rank.can(Permission.VIEW_AUDIT_LOG) },
  ];
  const visible = tabs.filter((t) => t.show);
  const active = visible.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="ae-zoom-in fixed inset-0 z-50 flex bg-ae-bg" role="dialog" aria-modal="true" aria-label="Server settings">
      <nav className="ae-panel flex w-60 shrink-0 flex-col gap-1 border-r border-ae-border p-4">
        <p className="mb-2 truncate px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{server.name}</p>
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => open({ serverId: server.id, tab: t.id })}
            className={`rounded-ae px-3 py-2 text-left text-sm ${active === t.id ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="ae-scroll relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-8">
          <h2 className="mb-6 text-xl font-bold">{visible.find((t) => t.id === active)?.label}</h2>
          {active === 'overview' && (
            <>
              <OverviewTab server={server} userId={userId} rank={rank} />
              <div className="mt-6">
                <TransferOwnership server={server} userId={userId} />
              </div>
            </>
          )}
          {active === 'moderation' && <ModerationTab server={server} channels={settingsChannels} />}
          {active === 'automod' && <AutomodTab server={server} />}
          {active === 'roles' && <RolesTab server={server} rank={rank} />}
          {active === 'members' && <MembersTab server={server} rank={rank} />}
          {active === 'soundboard' && <SoundboardTab server={server} canManage={rank.can(Permission.MANAGE_EXPRESSIONS)} />}
          {active === 'invites' && <InvitesTab server={server} rank={rank} userId={userId} />}
          {active === 'bans' && <BansTab server={server} />}
          {active === 'audit' && <AuditTab server={server} />}
        </div>
        <button
          type="button"
          onClick={() => open(null)}
          aria-label="Close server settings"
          className="fixed top-6 right-6 grid h-9 w-9 place-items-center rounded-full border border-ae-border text-ae-muted hover:text-ae-text"
        >
          <CloseIcon />
        </button>
      </main>
    </div>
  );
}

export { useRank, type Rank };
