/** Live poll: vote by clicking an answer (click again to remove), bars update in realtime. */
import { CheckIcon } from './icons';
import { useEffect, useState } from 'react';
import type { Message, PollVote } from '../types/db';

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Poll closed';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.round(minutes / 60);
  return hours >= 48 ? `${Math.round(hours / 24)} days left` : `${hours}h left`;
}

export function PollCard({ message, votes, me, onVote }: {
  message: Message;
  votes: PollVote[];
  me: string;
  onVote: (optionIds: number[]) => void;
}) {
  const poll = message.poll!;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const closed = new Date(poll.expires_at).getTime() <= Date.now();
  const mine = new Set(votes.filter((v) => v.user_id === me).map((v) => v.option_id));
  const counts = poll.options.map((_, i) => votes.filter((v) => v.option_id === i).length);
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const max = Math.max(1, ...counts);
  const showResults = closed || mine.size > 0;

  const toggle = (i: number) => {
    if (closed) return;
    if (poll.multi) onVote(mine.has(i) ? [...mine].filter((x) => x !== i) : [...mine, i]);
    else onVote(mine.has(i) ? [] : [i]);
  };

  return (
    <div className="ae-poll mt-1 w-full max-w-md rounded-ae border border-ae-border bg-ae-sunken p-3">
      <p className="font-semibold">{poll.question}</p>
      <p className="mb-2 text-xs text-ae-muted">{poll.multi ? 'Select one or more answers' : 'Select one answer'}</p>
      <ul className="space-y-1.5">
        {poll.options.map((o, i) => {
          const pct = voters ? Math.round((counts[i] / voters) * 100) : 0;
          const chosen = mine.has(i);
          const winner = closed && counts[i] === max && counts[i] > 0;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={closed}
                onClick={() => toggle(i)}
                className={`relative flex w-full items-center gap-2 overflow-hidden rounded-ae border px-3 py-2 text-left text-sm ${
                  chosen ? 'border-ae-accent' : 'border-ae-border hover:border-ae-muted'
                } ${closed ? 'cursor-default' : ''}`}
              >
                {showResults && (
                  <span
                    className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${winner ? 'bg-ae-success/25' : 'bg-ae-accent/15'}`}
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative z-10 flex flex-1 items-center gap-2">
                  {o.emoji && <span className="text-lg leading-none">{o.emoji}</span>}
                  <span className="truncate">{o.text}</span>
                </span>
                {showResults && (
                  <span className="relative z-10 text-xs text-ae-muted">
                    {counts[i]} · {pct}%
                  </span>
                )}
                <span
                  className={`relative z-10 grid h-4 w-4 shrink-0 place-items-center border ${poll.multi ? 'rounded' : 'rounded-full'} ${
                    chosen ? 'border-ae-accent bg-ae-accent text-[10px] text-ae-on-accent' : 'border-ae-muted'
                  }`}
                >
                  {chosen && <CheckIcon size={13} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ae-muted">
        {voters} {voters === 1 ? 'vote' : 'votes'} · {timeLeft(poll.expires_at)}
        {!closed && mine.size > 0 && ' · click your answer again to remove it'}
      </p>
    </div>
  );
}
