/**
 * Birthdays (2.1): month and day only, kept out of the public profile row. Friends see yours when
 * you allow it (friend_birthdays()); nobody else ever does.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import { useMeId } from './useMe';

export interface Birthday {
  month: number;
  day: number;
}
export interface MyBirthday extends Birthday {
  visibility: 'friends' | 'nobody';
}

export function useMyBirthday() {
  const sb = useSupabase();
  const me = useMeId();
  return useQuery({
    queryKey: ['my-birthday', me],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('birthdays').select('month, day, visibility').maybeSingle();
      if (error) throw new Error(error.message);
      return (data as MyBirthday | null) ?? null;
    },
  });
}

export function useSaveBirthday() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const me = useMeId();
  return useMutation({
    mutationFn: async (b: MyBirthday | null) => {
      const { error } = b
        ? await sb.from('birthdays').upsert({ month: b.month, day: b.day, visibility: b.visibility }, { onConflict: 'user_id' })
        : await sb.from('birthdays').delete().eq('user_id', me);
      if (error) throw new Error(error.message);
    },
    onMutate: (b) => qc.setQueryData(['my-birthday', me], b),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['my-birthday', me] }),
  });
}

/** Your friends' shared birthdays, by user id. */
export function useFriendBirthdays() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['friend-birthdays'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('friend_birthdays');
      if (error) throw new Error(error.message);
      return new Map((data as { user_id: string; month: number; day: number }[]).map((r) => [r.user_id, { month: r.month, day: r.day }]));
    },
  });
}

/** One person's birthday: yours, or a friend's they share. */
export function useBirthdayOf(userId: string | null | undefined): Birthday | null {
  const me = useMeId();
  const mine = useMyBirthday().data;
  const friends = useFriendBirthdays().data;
  if (!userId) return null;
  if (userId === me) return mine ? { month: mine.month, day: mine.day } : null;
  return friends?.get(userId) ?? null;
}

/** Days until the next one (0 = today). 29 Feb counts as 28 Feb in other years. */
export function daysUntil(b: Birthday, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const on = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return new Date(y, b.month - 1, b.month === 2 && b.day === 29 && !leap ? 28 : b.day);
  };
  let next = on(today.getFullYear());
  if (next < today) next = on(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

export function formatBirthday(b: Birthday): string {
  return new Date(2000, b.month - 1, b.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}
