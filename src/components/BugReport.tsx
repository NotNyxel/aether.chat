/**
 * Report a bug (2.0): describe what went wrong, optionally add a screenshot (pick, paste, or
 * capture the screen), and it goes straight to the Aether team (Admin → Bug reports) with the app
 * version, platform and screen name. Screenshots are private: only you and staff can open them.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { platformLabel } from '../lib/errorTracking';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import { Dialog } from './Dialog';
import { BugIcon, CloseIcon, ScreenIcon, UploadIcon } from './icons';
import { toast } from './Toaster';

const useBugDialog = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));
export const openBugReport = () => useBugDialog.getState().set(true);

const MAX_BYTES = 5 * 1024 * 1024;

/** One frame of the screen (asks permission first). Desktop browsers and the Windows app. */
async function captureScreen(): Promise<Blob | null> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: MediaDevices['getDisplayMedia'] };
  if (!md?.getDisplayMedia) return null;
  const stream = await md.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function BugDialog({ onClose }: { onClose: () => void }) {
  const sb = useSupabase();
  const [text, setText] = useState('');
  const [shot, setShot] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCapture = !!(navigator.mediaDevices as { getDisplayMedia?: unknown } | undefined)?.getDisplayMedia;

  useEffect(() => {
    if (!shot) return setPreview(null);
    const url = URL.createObjectURL(shot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  const take = (b: Blob | null | undefined) => {
    if (!b) return;
    if (!b.type.startsWith('image/')) return toast.error('Screenshots must be images.');
    if (b.size > MAX_BYTES) return toast.error('That image is over 5 MB.');
    setShot(b);
  };

  const page = (() => {
    const s = useUiStore.getState();
    return s.view === 'server' ? 'server' : s.homeTarget === 'friends' ? 'friends' : 'dm';
  })();

  const send = async () => {
    if (text.trim().length < 5 || busy) return;
    setBusy(true);
    try {
      let path: string | null = null;
      if (shot) {
        const { data: u } = await sb.auth.getUser();
        const ext = shot.type === 'image/jpeg' ? 'jpg' : shot.type === 'image/webp' ? 'webp' : 'png';
        path = `${u.user?.id}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('bug-reports').upload(path, shot, { contentType: shot.type });
        if (up.error) throw new Error(`Couldn't upload the screenshot: ${up.error.message}`);
      }
      const { error } = await sb.from('bug_reports').insert({
        description: text.trim().slice(0, 4000),
        screenshot_path: path,
        app_version: __APP_VERSION__,
        platform: platformLabel(),
        user_agent: navigator.userAgent.slice(0, 400),
        page,
      });
      if (error) throw new Error(error.message.includes('row-level') ? 'You’ve sent a lot of reports today. Thank you! Try again tomorrow.' : error.message);
      toast.success('Thanks! Your report was sent to the Aether team.', <BugIcon size={14} />);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t send the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Report a bug" onClose={onClose} wide z="z-[70]">
      <p className="text-sm text-ae-muted">What happened, and what did you expect? Steps to make it happen again help the most.</p>
      <textarea
        autoFocus
        className="ae-input ae-selectable min-h-32 w-full resize-y text-sm"
        maxLength={4000}
        placeholder="e.g. When I open a group call on my phone, the mute button does nothing."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
          if (img) {
            e.preventDefault();
            take(img);
          }
        }}
      />
      {preview ? (
        <div className="relative inline-block">
          <img src={preview} alt="Screenshot to send" className="max-h-48 rounded-ae border border-ae-border" />
          <button type="button" aria-label="Remove screenshot" className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-ae-danger text-white" onClick={() => setShot(null)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label className="ae-press inline-flex cursor-pointer items-center gap-2 rounded-ae bg-ae-surface px-3 py-2 text-sm hover:bg-ae-hover">
            <UploadIcon size={15} /> Add a screenshot
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
          </label>
          {canCapture && (
            <button
              type="button"
              className="ae-press inline-flex items-center gap-2 rounded-ae bg-ae-surface px-3 py-2 text-sm hover:bg-ae-hover"
              onClick={() => void captureScreen().then(take).catch(() => undefined)}
            >
              <ScreenIcon size={15} /> Capture screen
            </button>
          )}
          <span className="self-center text-xs text-ae-muted">or paste an image into the box</span>
        </div>
      )}
      <p className="text-xs text-ae-muted">
        Sent with your report: Aether {__APP_VERSION__}, {platformLabel()}, and which screen you were on. Only the Aether team can see it.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || text.trim().length < 5}
          className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </Dialog>
  );
}

/** Mounted once in the main layout. */
export function BugReportLayer() {
  const { open, set } = useBugDialog();
  return open ? <BugDialog onClose={() => set(false)} /> : null;
}
