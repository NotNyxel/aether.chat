/** Server Settings → Soundboard: upload, preview, rename and remove the server's sounds. */
import { useRef, useState } from 'react';
import { useSoundboard, useSoundboardActions } from '../hooks/useSoundboard';
import { BUILTIN_SOUNDS, builtinBuffer, decodeClip, previewBuffer } from '../lib/soundboard';
import type { Server } from '../types/db';
import { TrashIcon } from './icons';
import { inputCls, Section } from './SettingsPanel';

export function SoundboardTab({ server, canManage }: { server: Server; canManage: boolean }) {
  const { data: sounds = [] } = useSoundboard(server.id);
  const actions = useSoundboardActions(server.id);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      <Section
        title={`Server sounds (${sounds.length}/48)`}
        description="Anyone with the Use Soundboard permission can play these in this server's voice channels. Everyone in the call hears them."
      >
        {sounds.length === 0 ? (
          <p className="text-sm text-ae-muted">No custom sounds yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {sounds.map((s) => (
              <li key={s.id} className="ae-enter flex items-center gap-2 rounded-ae border border-ae-border bg-ae-surface/50 px-3 py-2">
                <button
                  type="button"
                  title="Preview"
                  className="ae-press grid h-8 w-8 place-items-center rounded-full bg-ae-surface hover:bg-ae-hover"
                  onClick={() => void decodeClip(s.url).then((b) => previewBuffer(b, s.volume))}
                >
                  {s.emoji || '🔊'}
                </button>
                {canManage ? (
                  <input
                    className={`${inputCls} py-1`}
                    defaultValue={s.name}
                    maxLength={32}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && actions.update.mutate({ id: s.id, patch: { name: e.target.value.trim() } })}
                  />
                ) : (
                  <span className="flex-1 truncate text-sm">{s.name}</span>
                )}
                {canManage && (
                  <button type="button" title="Delete" className="text-ae-muted hover:text-ae-danger" onClick={() => window.confirm(`Delete “${s.name}”?`) && actions.remove.mutate(s)}>
                    <TrashIcon size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canManage && (
        <Section title="Upload a sound" description="MP3, OGG or WAV, up to 5 seconds and 1 MB.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!file) return;
              actions.add.mutate(
                { file, name: name || file.name.replace(/\.[^.]+$/, ''), emoji, volume },
                {
                  onSuccess: () => {
                    setFile(null);
                    setName('');
                    setEmoji('');
                    setVolume(1);
                  },
                },
              );
            }}
          >
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex gap-2">
              <button type="button" className="ae-press shrink-0 rounded-ae bg-ae-surface px-3 py-2 text-sm hover:bg-ae-hover" onClick={() => fileRef.current?.click()}>
                {file ? `📎 ${file.name}` : 'Choose a file'}
              </button>
              <input className={`${inputCls} w-16 text-center`} placeholder="😀" maxLength={8} value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
              <input className={inputCls} placeholder="Name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <label className="flex items-center gap-3 text-sm">
              Volume
              <input type="range" min={0.1} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="flex-1" />
              <span className="w-10 text-right text-ae-muted">{Math.round(volume * 100)}%</span>
            </label>
            {actions.add.error && <p className="text-xs text-ae-danger">{actions.add.error.message}</p>}
            <button type="submit" disabled={!file || actions.add.isPending} className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
              {actions.add.isPending ? 'Uploading…' : 'Add sound'}
            </button>
          </form>
        </Section>
      )}

      <Section title="Default sounds" description="Available in every server and call.">
        <div className="flex flex-wrap gap-2">
          {BUILTIN_SOUNDS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="ae-press rounded-ae bg-ae-surface px-3 py-1.5 text-sm hover:bg-ae-hover"
              onClick={() => void builtinBuffer(s).then((b) => previewBuffer(b, 0.8))}
            >
              {s.emoji} {s.name}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
