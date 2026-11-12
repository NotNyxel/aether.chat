/** Bottom-of-sidebar area: voice connection dock and the user panel with status picker and controls. */
import { useState } from 'react';
import { useProfile, useUpdateProfile } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, STATUS_LABELS, usePresenceOf } from '../hooks/usePresence';
import { ActivityLine } from './ActivityCards';
import { UserPopout } from './UserPopout';
import { useUiStore } from '../stores/uiStore';
import { useCall } from './CallContext';
import { BellOffIcon, CameraIcon, HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, PhoneOffIcon, ScreenIcon, SettingsIcon, UsersIcon } from './icons';
import { Dialog } from './Dialog';
import { Avatar } from './ProfileCard';
import { plateProps } from '../lib/cosmetics';
import { EmojiButton } from './EmojiPicker';

function IconButton({ label, danger, active, onClick, children }: {
  label: string;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-ae hover:bg-ae-hover ${
        danger ? 'text-ae-danger' : active ? 'text-ae-accent' : 'text-ae-muted hover:text-ae-text'
      }`}
    >
      {children}
    </button>
  );
}

export function VoiceDock() {
  const { voice, room, leave, toggleScreenShare, toggleCamera, notice, myVoiceState } = useCall();
  const openHome = useUiStore((s) => s.openHome);
  const selectServer = useUiStore((s) => s.selectServer);
  if (voice.status === 'idle' || !room) {
    const msg = voice.error ?? notice;
    return msg ? <p className="ae-enter border-t border-ae-border px-3 py-2 text-xs text-ae-danger">{msg}</p> : null;
  }

  return (
    <div className="border-t border-ae-border px-3 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => (room.kind === 'conversation' ? openHome(room.id) : selectServer(useUiStore.getState().serverId))}
        >
          <p className={`text-xs font-semibold ${voice.status === 'connected' ? 'text-ae-success' : 'text-ae-warning'}`}>
            {voice.status === 'connected' ? 'Voice connected' : voice.status === 'error' ? 'Connection failed' : 'Connecting…'}
          </p>
          <p className="truncate text-xs text-ae-muted">{room.name}</p>
        </button>
        <div className="flex">
          <IconButton label={voice.isCameraOn ? 'Turn camera off' : 'Turn camera on'} active={voice.isCameraOn} onClick={toggleCamera}>
            <CameraIcon size={16} />
          </IconButton>
          <IconButton label={voice.isSharingScreen ? 'Stop sharing' : 'Share screen'} active={voice.isSharingScreen} onClick={toggleScreenShare}>
            <ScreenIcon size={16} />
          </IconButton>
          <IconButton label="Disconnect" danger onClick={leave}>
            <PhoneOffIcon size={16} />
          </IconButton>
        </div>
      </div>
      {myVoiceState?.server_mute && <p className="mt-1 text-xs text-ae-danger"><MicOffIcon size={15} className="ae-ico" /> Server muted by a moderator</p>}
      {myVoiceState?.server_deaf && <p className="mt-1 text-xs text-ae-danger"><BellOffIcon size={15} className="ae-ico" /> Server deafened by a moderator</p>}
      {room.stage && myVoiceState?.suppressed && <p className="mt-1 text-xs text-ae-muted"><UsersIcon size={15} className="ae-ico" /> You&apos;re in the audience</p>}
      {voice.error && <p className="mt-1 text-xs text-ae-danger">{voice.error}</p>}
    </div>
  );
}


const CLEAR_AFTER: { label: string; value: string }[] = [
  { label: 'Today', value: 'today' },
  { label: '30 minutes', value: '30' },
  { label: '1 hour', value: '60' },
  { label: '4 hours', value: '240' },
  { label: 'This week', value: '10080' },
  { label: "Don't clear", value: 'never' },
];

function expiryFrom(value: string): string | null {
  if (value === 'never') return null;
  if (value === 'today') {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }
  return new Date(Date.now() + Number(value) * 60_000).toISOString();
}

function CustomStatusDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data: me } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const current = activeCustomStatus(me);
  const [text, setText] = useState(current ?? '');
  const [emoji, setEmoji] = useState(current ? (me?.status_emoji ?? '') : '');
  const [clearAfter, setClearAfter] = useState('today');
  const input = 'ae-input w-full';
  return (
    <Dialog title="Set a custom status" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          update.mutate(
            value || emoji.trim()
              ? { custom_status: value || null, status_emoji: emoji.trim() || null, custom_status_expires_at: expiryFrom(clearAfter) }
              : { custom_status: null, status_emoji: null, custom_status_expires_at: null },
            { onSuccess: onClose },
          );
        }}
      >
        <div className="flex gap-2">
          <EmojiButton value={emoji} onChange={(e) => setEmoji(e ?? '')} />
          <input className={input} value={text} maxLength={128} autoFocus placeholder="What's happening?" onChange={(e) => setText(e.target.value)} />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-bold tracking-wide text-ae-muted uppercase">Clear after</span>
          <select className={input} value={clearAfter} onChange={(e) => setClearAfter(e.target.value)}>
            {CLEAR_AFTER.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {update.error && <p className="text-xs text-ae-danger">{update.error.message}</p>}
        <div className="flex justify-end gap-2">
          {current && (
            <button
              type="button"
              className="mr-auto rounded-ae px-3 py-2 text-sm text-ae-danger hover:bg-ae-hover"
              onClick={() => update.mutate({ custom_status: null, status_emoji: null, custom_status_expires_at: null }, { onSuccess: onClose })}
            >
              Clear status
            </button>
          )}
          <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={update.isPending} className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function UserPanel({ userId }: { userId: string }) {
  const { voice } = useCall();
  const { data: me } = useProfile(userId);
  const openSettings = useUiStore((s) => s.openSettings);
  const live = usePresenceOf(userId);
  const [menu, setMenu] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);

  const status = me?.presence_status ?? 'online';
  const shownStatus = status === 'invisible' ? 'offline' : live;

  return (
    <>
      <VoiceDock />
      <footer className="relative flex items-center gap-1 bg-ae-sunken/60 px-2 py-2">
        <button
          type="button"
          data-user-panel
          className="ae-plate flex min-w-0 flex-1 items-center gap-2 rounded-ae p-1 text-left hover:bg-ae-hover"
          {...plateProps(me?.nameplate, me?.decor)}
          onClick={() => setMenu((m) => !m)}
        >
          <span className="relative inline-block shrink-0 leading-none">
            <Avatar profile={me} size={32} speaking={voice.isSpeaking} />
            <PresenceDot status={shownStatus} className="absolute -right-0.5 -bottom-0.5 z-10" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{me?.display_name || me?.username || '…'}</span>
            <span className="block truncate text-xs text-ae-muted">
              <ActivityLine userId={userId} fallback={(me?.status_emoji && activeCustomStatus(me) ? `${me.status_emoji} ` : '') + (activeCustomStatus(me) || STATUS_LABELS[status])} />
            </span>
          </span>
        </button>
        <IconButton label={voice.isMuted ? 'Unmute' : 'Mute'} danger={voice.isMuted} onClick={voice.toggleMute}>
          {voice.isMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
        </IconButton>
        <IconButton label={voice.isDeafened ? 'Undeafen' : 'Deafen'} danger={voice.isDeafened} onClick={voice.toggleDeafen}>
          {voice.isDeafened ? <HeadphonesOffIcon size={16} /> : <HeadphonesIcon size={16} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => openSettings()}>
          <SettingsIcon size={16} />
        </IconButton>

        {menu && <UserPopout userId={userId} shownStatus={shownStatus} onClose={() => setMenu(false)} onEditStatus={() => setStatusDialog(true)} />}
      </footer>
      {statusDialog && <CustomStatusDialog userId={userId} onClose={() => setStatusDialog(false)} />}
    </>
  );
}
