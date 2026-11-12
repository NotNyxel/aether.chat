/**
 * Scheduled events: the 📅 bar in the channel list, the events dialog (list, RSVP, start/end,
 * cancel) and the create/edit form.
 */
import { ask } from './ConfirmDialog';
import { useMemo, useState } from 'react';
import { useProfile, useServerPermissions } from '../hooks/useChatData';
import { useEventActions, useEventRsvps, useServerEvents, type EventInput } from '../hooks/useEvents';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server, ServerEvent } from '../types/db';
import { useCall } from './CallContext';
import { Dialog } from './Dialog';
import { CalendarIcon, MapPinIcon, PlayIcon, SquareIcon, StageIcon, StarIcon, VolumeIcon } from './icons';
import { Avatar } from './ProfileCard';
import { inputCls } from './SettingsPanel';

function whenLabel(e: ServerEvent): string {
  if (e.status === 'active') return 'Happening now';
  const d = new Date(e.starts_at);
  const mins = Math.round((d.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return 'Starting soon';
  if (mins < 60) return `In ${mins} min`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Local datetime-local value for an ISO date. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shown at the top of the channel list when the server has upcoming or live events. */
export function EventsBar({ server }: { server: Server }) {
  const { data: events = [] } = useServerEvents(server.id);
  const openEvents = useUiStore((s) => s.openEvents);
  const live = events.find((e) => e.status === 'active');
  return (
    <button
      type="button"
      onClick={() => openEvents(server.id)}
      className={`ae-enter mx-2 mt-2 flex items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${
        live ? 'bg-ae-success/15 text-ae-text hover:bg-ae-success/25' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
      }`}
    >
      <CalendarIcon size={16} />
      {live ? (
        <span className="min-w-0 flex-1 truncate">
          <span className="ae-live mr-1 rounded bg-ae-success px-1 text-[9px] font-bold text-black">LIVE</span>
          {live.name}
        </span>
      ) : (
        <span className="flex-1">{events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'Events'}</span>
      )}
    </button>
  );
}

function EventCard({ e, server, channels, userId, canManage, interested, going, onEdit }: {
  e: ServerEvent;
  server: Server;
  channels: Channel[];
  userId: string;
  canManage: boolean;
  interested: number;
  going: boolean;
  onEdit: () => void;
}) {
  const actions = useEventActions(server.id);
  const { joinChannel } = useCall();
  const openEvents = useUiStore((s) => s.openEvents);
  const { data: host } = useProfile(e.created_by);
  const channel = channels.find((c) => c.id === e.channel_id);
  const err = actions.update.error ?? actions.rsvp.error ?? actions.remove.error;
  const btn = 'ae-press rounded-ae px-3 py-1.5 text-xs font-semibold';
  return (
    <li className={`ae-enter ae-lift space-y-2 rounded-ae border p-3 ${e.status === 'active' ? 'border-ae-success' : 'border-ae-border'} bg-ae-surface/40`}>
      <p className={`text-xs font-semibold ${e.status === 'active' ? 'text-ae-success' : 'text-ae-accent'}`}>
        {e.status === 'active' && <span className="ae-live mr-1">●</span>}
        {whenLabel(e)}
      </p>
      <p className="text-base font-bold">{e.name}</p>
      {e.description && <p className="text-sm whitespace-pre-wrap text-ae-muted">{e.description}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs text-ae-muted">
        <span className="inline-flex items-center gap-1">{channel ? <>{channel.type === 'stream' ? <StageIcon size={13} /> : <VolumeIcon size={13} />} {channel.name}</> : <><MapPinIcon size={13} /> {e.location}</>}</span>
        <span className="flex items-center gap-1">
          <Avatar profile={host} size={16} showFrame={false} /> Hosted by {host?.display_name || host?.username || '…'}
        </span>
        <span><StarIcon size={15} className="ae-ico" /> {interested} interested</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btn} ${going ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface hover:bg-ae-hover'}`}
          onClick={() => actions.rsvp.mutate({ id: e.id, going: !going, userId })}
        >
          <StarIcon size={13} className="ae-ico" fill={going ? 'currentColor' : 'none'} /> Interested
        </button>
        {e.status === 'active' && channel && (
          <button
            type="button"
            className={`${btn} bg-ae-success text-black`}
            onClick={() => {
              joinChannel(channel);
              openEvents(null);
            }}
          >
            Join
          </button>
        )}
        {canManage && e.status === 'scheduled' && (
          <button
            type="button"
            className={`${btn} bg-ae-success text-black`}
            onClick={() => {
              actions.update.mutate({ id: e.id, patch: { status: 'active' } });
              if (channel) joinChannel(channel);
            }}
          >
            <PlayIcon size={14} className="ae-ico" /> Start event
          </button>
        )}
        {canManage && e.status === 'active' && (
          <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => actions.update.mutate({ id: e.id, patch: { status: 'completed' } })}>
            <SquareIcon size={13} className="ae-ico" /> End event
          </button>
        )}
        {canManage && (
          <>
            <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className={`${btn} text-ae-danger hover:bg-ae-hover`}
              onClick={async () => (await ask(`Cancel “${e.name}”?`)) && actions.update.mutate({ id: e.id, patch: { status: 'canceled' } })}
            >
              Cancel event
            </button>
          </>
        )}
      </div>
      {err && <p className="text-xs text-ae-danger">{err.message}</p>}
    </li>
  );
}

function EventForm({ server, channels, initial, onDone }: { server: Server; channels: Channel[]; initial: ServerEvent | null; onDone: () => void }) {
  const actions = useEventActions(server.id);
  const voice = channels.filter((c) => c.type === 'voice' || c.type === 'stream');
  const defaultStart = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }, []);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [where, setWhere] = useState<'voice' | 'elsewhere'>(initial?.location ? 'elsewhere' : 'voice');
  const [channelId, setChannelId] = useState(initial?.channel_id ?? voice[0]?.id ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [start, setStart] = useState(toLocalInput(initial?.starts_at ?? defaultStart));
  const [end, setEnd] = useState(initial?.ends_at ? toLocalInput(initial.ends_at) : '');
  const m = initial ? actions.update : actions.create;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input: EventInput = {
          name: name.trim(),
          description: description.trim() || null,
          channel_id: where === 'voice' ? channelId || null : null,
          location: where === 'elsewhere' ? location.trim() || null : null,
          starts_at: new Date(start).toISOString(),
          ends_at: end ? new Date(end).toISOString() : null,
        };
        const done = { onSuccess: onDone };
        if (initial) actions.update.mutate({ id: initial.id, patch: input }, done);
        else actions.create.mutate(input, done);
      }}
    >
      <input className={inputCls} autoFocus maxLength={100} placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className={`${inputCls} min-h-20`} maxLength={1000} placeholder="What's happening? (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2 text-sm">
        {(['voice', 'elsewhere'] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWhere(w)}
            className={`ae-press flex-1 rounded-ae border px-3 py-2 ${where === w ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border'}`}
          >
            {w === 'voice' ? <><VolumeIcon size={15} className="ae-ico" /> Voice or stage channel</> : <><MapPinIcon size={15} className="ae-ico" /> Somewhere else</>}
          </button>
        ))}
      </div>
      {where === 'voice' ? (
        <select className={inputCls} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          {voice.map((c) => (
            <option key={c.id} value={c.id}>
              {c.type === 'stream' ? 'Stage: ' : 'Voice: '}{c.name}
            </option>
          ))}
        </select>
      ) : (
        <input className={inputCls} maxLength={100} placeholder="Location or link" value={location} onChange={(e) => setLocation(e.target.value)} />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
          Starts
          <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
          Ends (optional)
          <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {m.error && <p className="text-xs text-ae-danger">{m.error.message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={onDone}>
          Back
        </button>
        <button
          type="submit"
          disabled={!name.trim() || !start || m.isPending || (where === 'voice' ? !channelId : !location.trim())}
          className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
        >
          {initial ? 'Save' : 'Schedule event'}
        </button>
      </div>
    </form>
  );
}

export function EventsDialog({ servers, channels, userId }: { servers: Server[]; channels: Channel[]; userId: string }) {
  const serverId = useUiStore((s) => s.eventsServerId);
  const openEvents = useUiStore((s) => s.openEvents);
  const server = servers.find((s) => s.id === serverId) ?? null;
  const { data: events = [] } = useServerEvents(serverId);
  const { data: rsvps = [] } = useEventRsvps(events.map((e) => e.id));
  const { data: perms = 0n } = useServerPermissions(serverId);
  const [mode, setMode] = useState<'list' | 'create' | ServerEvent>('list');
  if (!server) return null;
  const canManage = server.owner_id === userId || hasPermission(perms, Permission.MANAGE_EVENTS);
  const serverChannels = channels.filter((c) => c.server_id === server.id);

  return (
    <Dialog
      wide
      title={mode === 'list' ? `Events in ${server.name}` : mode === 'create' ? 'Schedule an event' : `Edit ${mode.name}`}
      onClose={() => {
        setMode('list');
        openEvents(null);
      }}
    >
      {mode === 'list' ? (
        <div className="space-y-3">
          {canManage && (
            <button type="button" className="ae-press w-full rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent" onClick={() => setMode('create')}>
              + Schedule an event
            </button>
          )}
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-ae-muted">No upcoming events.{canManage ? '' : ' Moderators can schedule them.'}</p>
          ) : (
            <ul className="ae-scroll max-h-[60vh] space-y-2 overflow-y-auto">
              {events.map((e) => (
                <EventCard
                  key={e.id}
                  e={e}
                  server={server}
                  channels={serverChannels}
                  userId={userId}
                  canManage={canManage}
                  interested={rsvps.filter((r) => r.event_id === e.id).length}
                  going={rsvps.some((r) => r.event_id === e.id && r.user_id === userId)}
                  onEdit={() => setMode(e)}
                />
              ))}
            </ul>
          )}
          <p className="text-[11px] text-ae-muted">Mark yourself interested to get a reminder 15 minutes before it starts.</p>
        </div>
      ) : (
        <EventForm server={server} channels={serverChannels} initial={mode === 'create' ? null : mode} onDone={() => setMode('list')} />
      )}
    </Dialog>
  );
}
