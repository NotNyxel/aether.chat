/** Create a poll: question, 2–10 answers (optional emoji), duration, single or multiple choice. */
import { useState } from 'react';
import type { PollDraft } from '../hooks/useMessageExtras';
import { Dialog } from './Dialog';
import { EmojiPicker } from './EmojiPicker';
import { CloseIcon, PlusIcon } from './icons';

const DURATIONS: { hours: PollDraft['duration_hours']; label: string }[] = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
];

export function PollDialog({ onClose, onSubmit, pending, error }: {
  onClose: () => void;
  onSubmit: (poll: PollDraft) => void;
  pending: boolean;
  error: string | null;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<{ text: string; emoji: string | null }[]>([
    { text: '', emoji: null },
    { text: '', emoji: null },
  ]);
  const [duration, setDuration] = useState<PollDraft['duration_hours']>(24);
  const [multi, setMulti] = useState(false);
  const [emojiFor, setEmojiFor] = useState<number | null>(null);

  const filled = options.filter((o) => o.text.trim());
  const valid = question.trim().length > 0 && filled.length >= 2;
  const input = 'ae-input w-full';

  return (
    <Dialog title="Create a poll" onClose={onClose}>
      <label className="block space-y-1">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Question</span>
        <input autoFocus className={input} maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we play tonight?" />
      </label>

      <div className="space-y-1.5">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Answers</span>
        {options.map((o, i) => (
          <div key={i} className="relative flex items-center gap-2">
            <button
              type="button"
              title="Add an emoji"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-ae border border-ae-border bg-ae-sunken text-lg"
              onClick={() => setEmojiFor(emojiFor === i ? null : i)}
            >
              {o.emoji ?? '🙂'}
            </button>
            <input
              className={input}
              maxLength={55}
              value={o.text}
              placeholder={`Answer ${i + 1}`}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
            {options.length > 2 && (
              <button type="button" aria-label="Remove answer" className="text-ae-muted hover:text-ae-danger" onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}>
                <CloseIcon size={16} />
              </button>
            )}
            {emojiFor === i && (
              <EmojiPicker
                className="top-full left-0 mt-1"
                onClose={() => setEmojiFor(null)}
                onPick={(emoji) => {
                  setOptions((list) => list.map((x, j) => (j === i ? { ...x, emoji } : x)));
                  setEmojiFor(null);
                }}
              />
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button type="button" className="flex items-center gap-1 text-sm text-ae-accent hover:underline" onClick={() => setOptions((l) => [...l, { text: '', emoji: null }])}>
            <PlusIcon size={14} /> Add another answer
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Duration</span>
          <select className={input} value={duration} onChange={(e) => setDuration(Number(e.target.value) as PollDraft['duration_hours'])}>
            {DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Allow multiple answers
        </label>
      </div>

      {error && <p className="text-sm text-ae-danger">{error}</p>}
      <button
        type="button"
        disabled={!valid || pending}
        onClick={() =>
          onSubmit({
            question: question.trim(),
            options: filled.map((o) => ({ text: o.text.trim(), emoji: o.emoji })),
            multi,
            duration_hours: duration,
          })
        }
        className="w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
      >
        {pending ? 'Posting…' : 'Post poll'}
      </button>
    </Dialog>
  );
}
