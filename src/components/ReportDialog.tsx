/**
 * Report a message or a user. Server messages go to that server's moderators (Server Settings →
 * Moderation). Reports about DMs or users outside a server are stored for the Aether operator.
 */
import { ShieldIcon } from './icons';
import { useState } from 'react';
import { create } from 'zustand';
import { useProfile } from '../hooks/useChatData';
import { useReport } from '../hooks/useAccount';
import { useFriendActions } from '../hooks/useSocialData';
import type { ReportReason } from '../types/db';
import { Dialog } from './Dialog';
import { inputCls } from './SettingsPanel';
import { toast } from './Toaster';

interface ReportTarget {
  messageId?: string | null;
  userId?: string | null;
  serverId?: string | null;
  preview?: string;
}

const useReportTarget = create<{ target: ReportTarget | null; set: (t: ReportTarget | null) => void }>()((set) => ({
  target: null,
  set: (target) => set({ target }),
}));

export function openReport(t: ReportTarget) {
  useReportTarget.getState().set(t);
}

const REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: 'spam', label: 'Spam', hint: 'Unwanted ads, floods, scams for engagement' },
  { id: 'harassment', label: 'Harassment or bullying', hint: 'Targeting, threats, or abuse aimed at someone' },
  { id: 'hate', label: 'Hate speech', hint: 'Attacks based on who someone is' },
  { id: 'violence', label: 'Violence or threats', hint: 'Threats or glorifying harm' },
  { id: 'nsfw', label: 'Sexual or graphic content', hint: 'Explicit content outside an age-restricted channel' },
  { id: 'self_harm', label: 'Self-harm', hint: 'Someone may be in danger' },
  { id: 'scam', label: 'Scam or phishing', hint: 'Fake giveaways, stolen-account bait, malicious links' },
  { id: 'other', label: 'Something else', hint: 'Tell us in the details' },
];

export function ReportDialog({ me }: { me: string }) {
  const target = useReportTarget((s) => s.target);
  const setTarget = useReportTarget((s) => s.set);
  const report = useReport();
  const friend = useFriendActions();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);
  const { data: who } = useProfile(target?.userId ?? null);
  if (!target) return null;

  const close = () => {
    setTarget(null);
    setReason(null);
    setDetails('');
    setDone(false);
    report.reset();
  };
  const name = who?.display_name || who?.username || 'this user';

  return (
    <Dialog title={target.messageId ? 'Report message' : `Report ${name}`} onClose={close}>
      {done ? (
        <div className="space-y-3 text-center">
          <p className="text-4xl"><ShieldIcon size={15} className="ae-ico" /></p>
          <p className="font-semibold">Thanks, we got it.</p>
          <p className="text-sm text-ae-muted">
            {target.serverId || target.messageId
              ? "The server's moderators will review it. You'll see its status if they act on it."
              : 'Your report was saved for review.'}
          </p>
          {target.userId && target.userId !== me && (
            <button
              type="button"
              className="ae-press w-full rounded-ae bg-ae-surface py-2 text-sm text-ae-danger hover:bg-ae-hover"
              onClick={() => friend.block.mutate(target.userId!, { onSuccess: () => toast.success(`Blocked ${name}.`), onError: (e) => toast.error(e.message) })}
            >
              Also block {name}
            </button>
          )}
          <button type="button" className="ae-press w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) return;
            report.mutate(
              { messageId: target.messageId, targetUserId: target.userId, serverId: target.serverId, reason, details },
              { onSuccess: () => setDone(true) },
            );
          }}
        >
          {target.preview && <blockquote className="line-clamp-3 rounded-ae border-l-4 border-ae-border bg-ae-sunken px-3 py-2 text-sm text-ae-muted">{target.preview}</blockquote>}
          <p className="text-sm text-ae-muted">What&apos;s wrong?</p>
          <div className="ae-scroll max-h-72 space-y-1 overflow-y-auto">
            {REASONS.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-ae border p-2 transition-colors ${reason === r.id ? 'border-ae-accent bg-ae-accent/10' : 'border-ae-border hover:bg-ae-hover'}`}
              >
                <input type="radio" className="mt-1" checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>
                  <span className="block text-sm font-semibold">{r.label}</span>
                  <span className="block text-xs text-ae-muted">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <textarea className={`${inputCls} min-h-16`} maxLength={1000} placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          {reason === 'self_harm' && (
            <p className="rounded-ae bg-ae-warning/10 px-3 py-2 text-xs text-ae-warning">
              If someone is in immediate danger, contact local emergency services. You can also reach out to them directly. It can help.
            </p>
          )}
          {report.error && <p className="text-xs text-ae-danger">{report.error.message}</p>}
          <button type="submit" disabled={!reason || report.isPending} className="ae-press w-full rounded-ae bg-ae-danger py-2 text-sm font-semibold text-white disabled:opacity-40">
            {report.isPending ? 'Sending…' : 'Send report'}
          </button>
        </form>
      )}
    </Dialog>
  );
}
