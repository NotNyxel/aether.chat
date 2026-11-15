/**
 * Server levels (XP from chatting), the leaderboard, and profile achievements.
 * XP rules live in the database (020_levels.sql): 15-25 XP per message, at most once a minute;
 * level L needs 5·L² + 50·L + 100 more XP than the one before.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useProfile } from '../hooks/useChatData';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { UserProfile } from '../types/db';
import { Dialog } from './Dialog';
import { FlameIcon, HeartIcon, MedalIcon, MessageIcon, RocketIcon, SparklesIcon, StarIcon, TrophyIcon } from './icons';
import { Avatar, StyledName } from './ProfileCard';

/** Level, XP into the current level, and XP needed for the next one. */
export function levelProgress(xp: number) {
  let level = 0;
  let need = 100;
  let left = xp;
  while (left >= need) {
    left -= need;
    level += 1;
    need = 5 * level * level + 50 * level + 100;
  }
  return { level, into: left, need };
}

export function useMemberXp(serverId: string | null, userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['member-xp', serverId, userId],
    enabled: !!serverId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await sb.from('member_xp').select('xp, level, messages').eq('server_id', serverId!).eq('user_id', userId).maybeSingle();
      return (data as { xp: number; level: number; messages: number } | null) ?? { xp: 0, level: 0, messages: 0 };
    },
  });
}

/** "Level 7" with a progress bar, for profiles opened inside a server. */
export function LevelBar({ serverId, userId }: { serverId: string; userId: string }) {
  const { data } = useMemberXp(serverId, userId);
  if (!data) return null;
  const p = levelProgress(data.xp);
  return (
    <div className="rounded-ae bg-ae-sunken/60 p-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-bold">
          <StarIcon size={13} className="fill-current text-[#f5b942]" /> Level {p.level}
        </span>
        <span className="text-ae-muted tabular-nums">
          {p.into.toLocaleString()} / {p.need.toLocaleString()} XP
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ae-surface">
        <div className="h-full rounded-full bg-gradient-to-r from-ae-accent to-[#f5b942]" style={{ width: `${Math.min(100, (p.into / p.need) * 100)}%` }} />
      </div>
    </div>
  );
}

function Row({ userId, rank, xp }: { userId: string; rank: number; xp: number }) {
  const { data: p } = useProfile(userId);
  const peek = useUiStore((s) => s.peekProfile);
  const lp = levelProgress(xp);
  const medal = rank === 1 ? '#f5b942' : rank === 2 ? '#c0c7d4' : rank === 3 ? '#d08b54' : null;
  return (
    <li>
      <button type="button" onClick={(e) => peek(userId, e.currentTarget)} className="flex w-full items-center gap-3 rounded-ae px-2 py-2 text-left hover:bg-ae-hover">
        <span className="grid w-8 shrink-0 place-items-center text-sm font-black tabular-nums" style={{ color: medal ?? 'var(--ae-text-muted)' }}>
          {medal ? <TrophyIcon size={18} /> : `#${rank}`}
        </span>
        <Avatar profile={p} size={36} showFrame={false} />
        <span className="min-w-0 flex-1">
          <StyledName profile={p} className="block truncate text-sm font-semibold" />
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ae-surface">
            <span className="block h-full rounded-full bg-ae-accent" style={{ width: `${Math.min(100, (lp.into / lp.need) * 100)}%` }} />
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold">Lvl {lp.level}</span>
          <span className="block text-[11px] text-ae-muted tabular-nums">{xp.toLocaleString()} XP</span>
        </span>
      </button>
    </li>
  );
}

export function LeaderboardDialog({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const sb = useSupabase();
  const { data = [], isLoading } = useQuery({
    queryKey: ['leaderboard', serverId],
    queryFn: async () => {
      const { data } = await sb.rpc('server_leaderboard', { p_server_id: serverId, p_limit: 50 });
      return (data ?? []) as { user_id: string; xp: number; rank: number }[];
    },
  });
  return (
    <Dialog title={`${serverName} leaderboard`} onClose={onClose}>
      <p className="-mt-2 text-xs text-ae-muted">Chatting earns 15–25 XP, at most once a minute.</p>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-ae-muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-sm text-ae-muted">Nobody has any XP yet. Start chatting!</p>
      ) : (
        <ul className="ae-scroll -mx-2 max-h-[60vh] space-y-0.5 overflow-y-auto">
          {data.map((r) => (
            <Row key={r.user_id} userId={r.user_id} rank={Number(r.rank)} xp={r.xp} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ── Achievements ───────────────────────────────────────────────────────────────────────────

interface Achievement {
  id: string;
  name: string;
  how: string;
  icon: ReactNode;
  color: string;
  /** 0-1 progress; 1 = earned. */
  progress: (s: { messages: number; reactions: number }, p: UserProfile) => number;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', name: 'First Words', how: 'Send your first message', icon: <MessageIcon size={20} />, color: '#3ddc84', progress: (s) => Math.min(1, s.messages) },
  { id: 'chatty', name: 'Chatterbox', how: 'Send 100 messages', icon: <MessageIcon size={20} />, color: '#4facfe', progress: (s) => s.messages / 100 },
  { id: 'story', name: 'Storyteller', how: 'Send 1,000 messages', icon: <SparklesIcon size={20} />, color: '#a18cd1', progress: (s) => s.messages / 1000 },
  { id: 'legend', name: 'Legend', how: 'Send 10,000 messages', icon: <FlameIcon size={20} />, color: '#ff5c6c', progress: (s) => s.messages / 10000 },
  { id: 'react', name: 'Reactor', how: 'React 50 times', icon: <HeartIcon size={20} />, color: '#ff7eb3', progress: (s) => s.reactions / 50 },
  { id: 'react2', name: 'Hype Machine', how: 'React 500 times', icon: <HeartIcon size={20} />, color: '#f857a6', progress: (s) => s.reactions / 500 },
  { id: 'early', name: 'Early Adopter', how: 'Joined Aether in 2026', icon: <RocketIcon size={20} />, color: '#f5b942', progress: (_, p) => (new Date(p.created_at).getFullYear() <= 2026 ? 1 : 0) },
  {
    id: 'veteran',
    name: 'Veteran',
    how: 'One year on Aether',
    icon: <MedalIcon size={20} />,
    color: '#5ad1ff',
    progress: (_, p) => (Date.now() - new Date(p.created_at).getTime()) / (365 * 86_400_000),
  },
];

export function useUserStats(userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['user-stats', userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await sb.from('user_stats').select('messages, reactions').eq('user_id', userId).maybeSingle();
      return (data as { messages: number; reactions: number } | null) ?? { messages: 0, reactions: 0 };
    },
  });
}

/** The Achievements tab of the full profile. */
export function AchievementsTab({ profile }: { profile: UserProfile }) {
  const { data: stats } = useUserStats(profile.id);
  if (!stats) return <div className="ae-skeleton h-32" />;
  const list = ACHIEVEMENTS.map((a) => ({ ...a, p: Math.max(0, Math.min(1, a.progress(stats, profile))) }));
  const earned = list.filter((a) => a.p >= 1).length;
  return (
    <div>
      <p className="mb-3 text-xs text-ae-muted">
        {earned} of {list.length} earned · {stats.messages.toLocaleString()} messages · {stats.reactions.toLocaleString()} reactions
      </p>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        {list.map((a) => (
          <div key={a.id} className={`rounded-ae border p-3 text-center ${a.p >= 1 ? 'border-ae-border bg-ae-sunken/60' : 'border-dashed border-ae-border opacity-60'}`} title={a.how}>
            <span className="mx-auto mb-1.5 grid h-11 w-11 place-items-center rounded-full" style={{ background: a.p >= 1 ? `color-mix(in srgb, ${a.color} 22%, transparent)` : 'var(--ae-surface)', color: a.p >= 1 ? a.color : 'var(--ae-text-muted)' }}>
              {a.icon}
            </span>
            <p className="text-sm font-semibold">{a.name}</p>
            <p className="text-[11px] text-ae-muted">{a.how}</p>
            {a.p < 1 && (
              <div className="mx-auto mt-1.5 h-1 w-3/4 overflow-hidden rounded-full bg-ae-surface">
                <div className="h-full bg-ae-accent" style={{ width: `${a.p * 100}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
