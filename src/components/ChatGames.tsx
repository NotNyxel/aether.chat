/** Games panel (2.1): start a game in this chat, take a seat, play live. */
import { useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { GAME_NAMES, useChatGames, useGameActions, type ChatGame, type GameKind } from '../hooks/useChatGames';
import { useMeId } from '../hooks/useMe';
import { t } from '../lib/i18n';
import { ChevronLeftIcon, GameIcon } from './icons';
import { PanelShell } from './MessagePanels';
import { Avatar } from './ProfileCard';
import { toast } from './Toaster';

const fail = (e: Error) => toast.error(e.message);
const COLORS = ['var(--ae-accent)', '#ffb020'];

export function GamesPanel({ scopeId, onClose }: { scopeId: string; onClose: () => void }) {
  const { games, loading } = useChatGames(scopeId);
  const act = useGameActions(scopeId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = games.find((g) => g.id === openId);
  if (open) return <GameView game={open} scopeId={scopeId} onBack={() => setOpenId(null)} onOpen={setOpenId} onClose={onClose} />;
  const start = (kind: GameKind) => act.start.mutate(kind, { onSuccess: (id) => setOpenId(id), onError: fail });
  const live = games.filter((g) => g.winner === null);
  const done = games.filter((g) => g.winner !== null).slice(0, 8);
  return (
    <PanelShell title={t('Games')} onClose={onClose}>
      <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{t('Start a game')}</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(['tictactoe', 'connect4'] as GameKind[]).map((k) => (
          <button key={k} type="button" disabled={act.start.isPending} onClick={() => start(k)} className="ae-press flex flex-col items-center gap-2 rounded-ae border border-ae-border bg-ae-surface p-3 text-sm font-semibold hover:border-ae-accent">
            <MiniPreview kind={k} />
            {t(GAME_NAMES[k])}
          </button>
        ))}
      </div>
      {loading && <p className="text-sm text-ae-muted">{t('Loading…')}</p>}
      {live.length > 0 && <p className="mb-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{t('Playing now')}</p>}
      <ul className="space-y-1.5">
        {live.map((g) => (
          <GameRow key={g.id} game={g} onOpen={() => setOpenId(g.id)} />
        ))}
      </ul>
      {done.length > 0 && <p className="mt-4 mb-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{t('Finished')}</p>}
      <ul className="space-y-1.5">
        {done.map((g) => (
          <GameRow key={g.id} game={g} onOpen={() => setOpenId(g.id)} />
        ))}
      </ul>
    </PanelShell>
  );
}

const C4_PREVIEW = '..............' + '...B...' + '..AB...' + '..ABA..' + '.BAAB..';

function MiniPreview({ kind }: { kind: GameKind }) {
  if (kind === 'tictactoe')
    return (
      <span className="grid h-10 w-10 grid-cols-3 gap-0.5" aria-hidden="true">
        {'AB.BA...A'.split('').map((c, i) => (
          <span key={i} className="grid place-items-center rounded-[3px] bg-ae-sunken text-[9px] font-black" style={{ color: c === '.' ? undefined : COLORS[c === 'A' ? 0 : 1] }}>
            {c === 'A' ? '×' : c === 'B' ? '○' : ''}
          </span>
        ))}
      </span>
    );
  return (
    <span className="grid h-10 w-12 grid-cols-7 gap-px rounded bg-[#2546b8] p-0.5" aria-hidden="true">
      {C4_PREVIEW.split('').map((c, i) => <span key={i} className="rounded-full" style={{ background: c === '.' ? 'rgba(0,0,0,0.35)' : COLORS[c === 'A' ? 0 : 1] }} />)}
    </span>
  );
}

function Name({ id }: { id: string | null }) {
  const { data: p } = useProfile(id);
  return <>{id ? p?.display_name || p?.username || '…' : t('Open seat')}</>;
}

function status(g: ChatGame, me: string) {
  const mine = g.player_a === me ? 0 : g.player_b === me ? 1 : null;
  if (g.winner === 2) return t('Draw');
  if (g.winner !== null) return mine === null ? null : g.winner === mine ? t('You won') : t('You lost');
  if (!g.player_b) return t('Waiting for a player');
  if (mine !== null) return g.turn === mine ? t('Your turn') : t('Their turn');
  return null;
}

function GameRow({ game: g, onOpen }: { game: ChatGame; onOpen: () => void }) {
  const me = useMeId();
  const s = status(g, me);
  const yourTurn = g.winner === null && g.player_b && ((g.turn === 0 && g.player_a === me) || (g.turn === 1 && g.player_b === me));
  return (
    <li>
      <button type="button" onClick={onOpen} className="ae-press flex w-full items-center gap-3 rounded-ae border border-ae-border bg-ae-surface px-3 py-2 text-left hover:border-ae-muted">
        <GameIcon size={16} className="ae-ico shrink-0 text-ae-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t(GAME_NAMES[g.kind])}</span>
          <span className="block truncate text-xs text-ae-muted">
            <Name id={g.player_a} /> {t('vs')} <Name id={g.player_b} />
          </span>
        </span>
        {s && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${yourTurn ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-sunken text-ae-muted'}`}>{s}</span>}
      </button>
    </li>
  );
}

function Seat({ id, side, active }: { id: string | null; side: 0 | 1; active: boolean }) {
  const { data: p } = useProfile(id);
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 rounded-ae border px-2 py-1.5 ${active ? 'border-ae-accent' : 'border-transparent'}`}>
      {id ? <Avatar profile={p} size={24} showFrame={false} /> : <span className="h-6 w-6 rounded-full border border-dashed border-ae-border" />}
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
        <Name id={id} />
      </span>
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[side] }} />
    </div>
  );
}

function GameView({ game: g, scopeId, onBack, onOpen, onClose }: { game: ChatGame; scopeId: string; onBack: () => void; onOpen: (id: string) => void; onClose: () => void }) {
  const me = useMeId();
  const act = useGameActions(scopeId);
  const mine = g.player_a === me ? 0 : g.player_b === me ? 1 : null;
  const canMove = g.winner === null && !!g.player_b && mine === g.turn && !act.move.isPending;
  const move = (cell: number) => canMove && act.move.mutate({ id: g.id, cell }, { onError: fail });
  const s = status(g, me);
  return (
    <PanelShell title={t('Games')} onClose={onClose}>
      <div className="mb-3 flex items-center gap-1">
        <button type="button" aria-label={t('All games')} onClick={onBack} className="grid h-8 w-8 shrink-0 place-items-center rounded-ae hover:bg-ae-hover">
          <ChevronLeftIcon size={16} />
        </button>
        <span className="flex-1 font-semibold">{t(GAME_NAMES[g.kind])}</span>
      </div>
      <div className="mb-3 flex gap-2">
        <Seat id={g.player_a} side={0} active={g.winner === null && g.turn === 0} />
        <Seat id={g.player_b} side={1} active={g.winner === null && g.turn === 1 && !!g.player_b} />
      </div>
      {g.kind === 'tictactoe' ? (
        <div className="mx-auto grid aspect-square w-full max-w-[260px] grid-cols-3 gap-1.5" role="grid" aria-label={t('Board')}>
          {g.board.split('').map((c, i) => (
            <button
              key={i}
              type="button"
              aria-label={c === '.' ? t('Empty square {n}', { n: i + 1 }) : `${c === 'A' ? '×' : '○'}`}
              disabled={!canMove || c !== '.'}
              onClick={() => move(i)}
              className={`grid place-items-center rounded-ae bg-ae-sunken text-4xl font-black transition-colors ${canMove && c === '.' ? 'hover:bg-ae-hover' : ''}`}
              style={{ color: c === '.' ? undefined : COLORS[c === 'A' ? 0 : 1] }}
            >
              {c === 'A' ? '×' : c === 'B' ? '○' : ''}
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-[300px] grid-cols-7 gap-1 rounded-xl bg-[#2546b8] p-1.5" role="grid" aria-label={t('Board')}>
          {g.board.split('').map((c, i) => (
            <button
              key={i}
              type="button"
              aria-label={t('Column {n}', { n: (i % 7) + 1 })}
              disabled={!canMove || g.board[i % 7] !== '.'}
              onClick={() => move(i % 7)}
              className={`aspect-square rounded-full transition-transform ${canMove ? 'hover:scale-105' : ''}`}
              style={{ background: c === '.' ? 'rgba(0,0,0,0.4)' : COLORS[c === 'A' ? 0 : 1] }}
            />
          ))}
        </div>
      )}
      {s && <p className="mt-3 text-center text-sm font-semibold">{s}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {!g.player_b && mine === null && (
          <button type="button" onClick={() => act.join.mutate(g.id, { onError: fail })} className="rounded-full bg-ae-accent px-4 py-1.5 text-sm font-bold text-ae-on-accent">
            {t('Join game')}
          </button>
        )}
        {g.winner !== null && mine !== null && (
          <button type="button" onClick={() => act.rematch.mutate(g.id, { onSuccess: (id) => onOpen(id), onError: fail })} className="rounded-full bg-ae-accent px-4 py-1.5 text-sm font-bold text-ae-on-accent">
            {t('Rematch')}
          </button>
        )}
        {g.winner === null && mine !== null && (
          <button type="button" onClick={() => act.leave.mutate(g.id, { onSuccess: () => !g.player_b && onBack(), onError: fail })} className="rounded-full px-4 py-1.5 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text">
            {g.player_b ? t('Give up') : t('Cancel game')}
          </button>
        )}
      </div>
    </PanelShell>
  );
}
