/**
 * Invites: the join card shown for aether.chat/inv/CODE links in chat, the "Add a server" dialog
 * (create, or join with a link or code with a live preview), and the "Invite people" dialog
 * (copy link, invite friends directly, pick how long it lasts).
 */
import { setJoinHandler } from '../lib/joinBus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { unwrap, useCreateServer, useJoinServer, useProfile } from '../hooks/useChatData';
import { useConversationActions, useFriendships } from '../hooks/useSocialData';
import { inviteLink, parseInviteCode, webInviteLink } from '../lib/invites';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Server } from '../types/db';
import { Dialog } from './Dialog';
import { ArrowLeftIcon, SearchIcon, CheckIcon, CompassIcon, CopyIcon, GlobeIcon, InviteIcon, PlusIcon, UsersIcon } from './icons';
import { Avatar } from './ProfileCard';
import { toast } from './Toaster';
import { ServerDiscovery } from './ServerDiscovery';

export interface InviteDetails {
  code: string;
  server_id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  member_count: number;
  online_hint: number;
  is_member: boolean;
  expires_at: string | null;
}

export function useInviteDetails(code: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['invite', code?.toLowerCase()],
    enabled: !!code,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => ((unwrap(await sb.rpc('invite_details', { p_code: code })) as InviteDetails[])[0] ?? null),
  });
}

function ServerBadge({ d, size = 48 }: { d: Pick<InviteDetails, 'icon_url' | 'name'>; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[30%] bg-ae-surface font-bold" style={{ width: size, height: size, fontSize: size * 0.32 }}>
      {d.icon_url ? <img src={d.icon_url} alt="" className="h-full w-full object-cover" /> : d.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)}
    </span>
  );
}

/** Join card rendered under a message that contains an invite link. */
export function InviteEmbed({ code, me }: { code: string; me: string }) {
  const { data: d, isLoading } = useInviteDetails(code);
  const join = useJoinServer(me);
  const selectServer = useUiStore((s) => s.selectServer);
  return (
    <div className="ae-enter mt-1.5 w-[min(26rem,100%)] overflow-hidden rounded-ae border border-ae-border bg-ae-sunken">
      {d?.banner_url && <img src={d.banner_url} alt="" className="h-16 w-full object-cover" />}
      <div className="p-3">
        <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">You&apos;ve been invited to join a server</p>
        {isLoading ? (
          <div className="ae-skeleton h-12" />
        ) : !d ? (
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-[30%] bg-ae-surface text-ae-muted">
              <InviteIcon size={22} />
            </span>
            <div>
              <p className="font-semibold">Invalid invite</p>
              <p className="text-xs text-ae-muted">This invite may be expired, or you may not have permission to join.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <ServerBadge d={d} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{d.name}</p>
              <p className="flex items-center gap-3 text-xs text-ae-muted">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-ae-success" /> {d.online_hint} in voice
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-ae-muted" /> {d.member_count} member{d.member_count === 1 ? '' : 's'}
                </span>
              </p>
            </div>
            <button
              type="button"
              disabled={join.isPending}
              className={`ae-press shrink-0 rounded-ae px-4 py-2 text-sm font-semibold ${d.is_member ? 'bg-ae-surface text-ae-text' : 'bg-ae-success text-black'}`}
              onClick={() =>
                d.is_member
                  ? selectServer(d.server_id)
                  : join.mutate(code, { onSuccess: (id) => (selectServer(id), toast.success(`Welcome to ${d.name}!`)), onError: (e) => toast.error(e.message) })
              }
            >
              {d.is_member ? 'Joined' : join.isPending ? 'Joining…' : 'Join'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add a server (create or join) ─────────────────────────────────────────────────────────

export const useAddServer = create<{ open: null | 'menu' | 'create' | 'join' | 'explore'; code: string; set: (open: null | 'menu' | 'create' | 'join' | 'explore', code?: string) => void }>()((set) => ({
  open: null,
  code: '',
  set: (open, code = '') => set({ open, code }),
}));

export function AddServerDialog({ userId }: { userId: string }) {
  const { open, code: preset, set } = useAddServer();
  useEffect(() => {
    setJoinHandler((c) => useAddServer.getState().set('join', c));
    return () => setJoinHandler(null);
  }, []);
  const [name, setName] = useState('');
  const [input, setInput] = useState('');
  const create = useCreateServer(userId);
  const join = useJoinServer(userId);
  const selectServer = useUiStore((s) => s.selectServer);
  const { data: me } = useProfile(userId);
  useEffect(() => {
    if (open === 'join') setInput(preset);
    if (open === 'create') setName(me ? `${me.display_name || me.username}'s server` : '');
  }, [open, preset, me]);
  const code = parseInviteCode(input);
  const { data: preview, isFetching } = useInviteDetails(open === 'join' ? code : null);
  if (!open) return null;
  const close = () => set(null);

  if (open === 'menu')
    return (
      <Dialog title="Add a server" onClose={close}>
        <p className="text-sm text-ae-muted">Your server is where you and your friends hang out. Make yours, or join one with an invite.</p>
        <button type="button" onClick={() => set('create')} className="ae-lift flex w-full items-center gap-3 rounded-ae border border-ae-border p-3 text-left hover:border-ae-accent">
          <span className="grid h-11 w-11 place-items-center rounded-ae bg-ae-accent/15 text-ae-accent">
            <PlusIcon size={22} />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">Create my own</span>
            <span className="block text-xs text-ae-muted">Start fresh with text and voice channels.</span>
          </span>
        </button>
        <button type="button" onClick={() => set('join')} className="ae-lift flex w-full items-center gap-3 rounded-ae border border-ae-border p-3 text-left hover:border-ae-accent">
          <span className="grid h-11 w-11 place-items-center rounded-ae bg-ae-success/15 text-ae-success">
            <CompassIcon size={22} />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">Join a server</span>
            <span className="block text-xs text-ae-muted">Use an invite link like aether.chat/inv/aether, or just the code.</span>
          </span>
        </button>
        <button type="button" onClick={() => set('explore')} className="ae-lift flex w-full items-center gap-3 rounded-ae border border-ae-border p-3 text-left hover:border-ae-accent">
          <span className="grid h-11 w-11 place-items-center rounded-ae bg-[#00d4ff]/15 text-[#00d4ff]">
            <SearchIcon size={22} />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">Explore public servers</span>
            <span className="block text-xs text-ae-muted">Find communities anyone can join.</span>
          </span>
        </button>
      </Dialog>
    );

  if (open === 'explore')
    return (
      <Dialog wide title="Explore public servers" onClose={close}>
        <ServerDiscovery userId={userId} onDone={close} />
        <button type="button" className="flex items-center gap-1 rounded-ae px-3 py-2 text-sm text-ae-muted hover:text-ae-text" onClick={() => set('menu')}>
          <ArrowLeftIcon size={15} /> Back
        </button>
      </Dialog>
    );

  if (open === 'create')
    return (
      <Dialog title="Create your server" onClose={close}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name.trim(), { onSuccess: (s) => (selectServer(s.id), close(), toast.success('Server created.')), onError: (err) => toast.error(err.message) });
          }}
        >
          <label className="block space-y-1">
            <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Server name</span>
            <input className="ae-input w-full" autoFocus maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex justify-between gap-2">
            <button type="button" className="flex items-center gap-1 rounded-ae px-3 py-2 text-sm text-ae-muted hover:text-ae-text" onClick={() => set('menu')}>
              <ArrowLeftIcon size={15} /> Back
            </button>
            <button type="submit" disabled={create.isPending || !name.trim()} className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
              Create
            </button>
          </div>
        </form>
      </Dialog>
    );

  return (
    <Dialog title="Join a server" onClose={close}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!code) return toast.error('That doesn’t look like an invite link or code.');
          join.mutate(code, { onSuccess: (id) => (selectServer(id), close(), toast.success(`Welcome to ${preview?.name ?? 'the server'}!`)), onError: (err) => toast.error(err.message) });
        }}
      >
        <p className="text-sm text-ae-muted">Paste an invite link or type the code.</p>
        <label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Invite link or code</span>
          <input className="ae-input w-full" autoFocus placeholder="aether.chat/inv/aether" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <p className="text-xs text-ae-muted">
          Examples: <code className="rounded bg-ae-sunken px-1">aether.chat/inv/aether</code> or <code className="rounded bg-ae-sunken px-1">aether</code>
        </p>
        {code && (
          <div className="ae-enter rounded-ae border border-ae-border bg-ae-sunken p-3">
            {isFetching && !preview ? (
              <div className="ae-skeleton h-12" />
            ) : preview ? (
              <div className="flex items-center gap-3">
                <ServerBadge d={preview} />
                <div className="min-w-0">
                  <p className="truncate font-bold">{preview.name}</p>
                  <p className="text-xs text-ae-muted">
                    {preview.member_count} member{preview.member_count === 1 ? '' : 's'}
                    {preview.is_member && ' · you’re already in it'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ae-danger">No server found for that invite.</p>
            )}
          </div>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className="flex items-center gap-1 rounded-ae px-3 py-2 text-sm text-ae-muted hover:text-ae-text" onClick={() => set('menu')}>
            <ArrowLeftIcon size={15} /> Back
          </button>
          <button type="submit" disabled={join.isPending || !preview} className="ae-press rounded-ae bg-ae-success px-5 py-2 text-sm font-semibold text-black disabled:opacity-50">
            {preview?.is_member ? 'Open server' : 'Join server'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Invite people ──────────────────────────────────────────────────────────────────────────

const EXPIRY = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: 'Never', minutes: 0 },
];

function FriendInviteRow({ userId, link, server }: { userId: string; link: string; server: Server }) {
  const { data: p } = useProfile(userId);
  const convo = useConversationActions();
  const sb = useSupabase();
  const [sent, setSent] = useState(false);
  return (
    <li className="flex items-center gap-3 rounded-ae px-2 py-1.5 hover:bg-ae-hover">
      <Avatar profile={p} size={32} showFrame={false} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p?.display_name || p?.username || '…'}</span>
      <button
        type="button"
        disabled={sent}
        className={`ae-press rounded-ae px-3 py-1 text-xs font-semibold ${sent ? 'text-ae-muted' : 'border border-ae-success text-ae-success hover:bg-ae-success hover:text-black'}`}
        onClick={() =>
          convo.openDm.mutate(userId, {
            onSuccess: async (conv) => {
              const { error } = await sb.from('messages').insert({ conversation_id: conv, content: `Join me in **${server.name}**! ${link}` });
              if (error) toast.error(error.message);
              else setSent(true);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      >
        {sent ? 'Sent' : 'Invite'}
      </button>
    </li>
  );
}

export function InviteDialog({ server, me, onClose }: { server: Server; me: string; onClose: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(10080);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'web' | null>(null);
  const [filter, setFilter] = useState('');
  const { data: friendships = [] } = useFriendships();
  const friends = useMemo(
    () => friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id)),
    [friendships, me],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const expires = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
      const { data, error } = await sb.from('server_invites').insert({ server_id: server.id, expires_at: expires }).select('code').single();
      if (cancelled) return;
      if (error) toast.error(error.message);
      else setCode((data as { code: string }).code);
    })();
    return () => {
      cancelled = true;
    };
  }, [minutes, sb, server.id]);

  const link = code ? inviteLink(code) : '…';
  const copy = (kind: 'link' | 'web') => {
    if (!code) return;
    void navigator.clipboard.writeText(kind === 'link' ? link : webInviteLink(code)).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
      void qc.invalidateQueries({ queryKey: ['invites', server.id] });
    });
  };
  const visibleFriends = friends.filter((id) => {
    const p = qc.getQueryData<{ username: string; display_name: string | null }>(['profile', id]);
    return !filter || `${p?.username} ${p?.display_name}`.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <Dialog wide title={`Invite friends to ${server.name}`} onClose={onClose}>
      {friends.length > 0 && (
        <>
          <input className="ae-input w-full" placeholder="Search for friends" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="ae-scroll max-h-56 space-y-0.5 overflow-y-auto">
            {visibleFriends.map((id) => (
              <FriendInviteRow key={id} userId={id} link={link} server={server} />
            ))}
          </ul>
          <div className="h-px bg-ae-border" />
        </>
      )}
      <div className="space-y-1.5">
        <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Or, send a server invite link to a friend</p>
        <div className="flex items-center gap-2 rounded-ae border border-ae-border bg-ae-sunken p-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-sm">{link}</span>
          <button type="button" onClick={() => copy('link')} className={`ae-press flex items-center gap-1.5 rounded-ae px-4 py-1.5 text-sm font-semibold ${copied === 'link' ? 'bg-ae-success text-black' : 'bg-ae-accent text-ae-on-accent'}`}>
            {copied === 'link' ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied === 'link' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ae-muted">
          <span className="flex items-center gap-2">
            Expires after
            <select className="ae-input !py-1 text-xs" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {EXPIRY.map((x) => (
                <option key={x.minutes} value={x.minutes}>
                  {x.label}
                </option>
              ))}
            </select>
          </span>
          <button type="button" className="flex items-center gap-1 hover:text-ae-text" onClick={() => copy('web')}>
            <GlobeIcon size={13} /> {copied === 'web' ? 'Web link copied' : 'Copy a web link (opens in any browser or the app)'}
          </button>
        </div>
        <p className="flex items-center gap-1.5 pt-1 text-xs text-ae-muted">
          <UsersIcon size={13} /> Anyone with the link can join. Custom codes like <b>aether.chat/inv/{server.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'myserver'}</b> can be set in Server Settings → Invites.
        </p>
      </div>
    </Dialog>
  );
}
