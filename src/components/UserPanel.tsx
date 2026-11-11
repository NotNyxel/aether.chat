/** Bottom-of-sidebar area: voice connection dock and the user panel with status picker and controls. */
import { useEffect, useRef, useState } from 'react';
import { useProfile, useUpdateProfile } from '../hooks/useChatData';
import { PresenceDot, STATUS_LABELS, usePresenceOf } from '../hooks/usePresence';
import { useUiStore } from '../stores/uiStore';
import type { PresenceStatus } from '../types/db';
import { useCall } from './CallContext';
import {
  CameraIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenIcon,
  SettingsIcon,
} from './icons';
import { Avatar } from './ProfileCard';

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
  const { voice, room, leave, toggleScreenShare, toggleCamera } = useCall();
  const openHome = useUiStore((s) => s.openHome);
  const selectServer = useUiStore((s) => s.selectServer);
  if (voice.status === 'idle' || !room) {
    return voice.error ? <p className="border-t border-ae-border px-3 py-2 text-xs text-ae-danger">{voice.error}</p> : null;
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
      {voice.error && <p className="mt-1 text-xs text-ae-danger">{voice.error}</p>}
    </div>
  );
}

const STATUSES: PresenceStatus[] = ['online', 'idle', 'dnd', 'invisible'];

export function UserPanel({ userId }: { userId: string }) {
  const { voice } = useCall();
  const { data: me } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const openSettings = useUiStore((s) => s.openSettings);
  const showProfile = useUiStore((s) => s.showProfile);
  const live = usePresenceOf(userId);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const status = me?.presence_status ?? 'online';
  const shownStatus = status === 'invisible' ? 'offline' : live;

  return (
    <>
      <VoiceDock />
      <footer className="relative flex items-center gap-1 bg-ae-sunken/60 px-2 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-ae p-1 text-left hover:bg-ae-hover"
          onClick={() => setMenu((m) => !m)}
        >
          <span className="relative">
            <Avatar profile={me} size={32} speaking={voice.isSpeaking} />
            <PresenceDot status={shownStatus} className="absolute -right-0.5 -bottom-0.5 z-10" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{me?.display_name || me?.username || '…'}</span>
            <span className="block truncate text-xs text-ae-muted">{me?.custom_status || STATUS_LABELS[status]}</span>
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

        {menu && (
          <div ref={menuRef} className="absolute bottom-full left-2 z-30 mb-2 w-56 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover"
              onClick={() => {
                showProfile(userId);
                setMenu(false);
              }}
            >
              View my profile
            </button>
            <div className="my-1 h-px bg-ae-border" />
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover ${status === s ? 'bg-ae-surface' : ''}`}
                onClick={() => {
                  update.mutate({ presence_status: s });
                  setMenu(false);
                }}
              >
                <PresenceDot status={s === 'invisible' ? 'offline' : s} size={10} />
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </footer>
    </>
  );
}
