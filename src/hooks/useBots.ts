/** Apps / bots (2.1): your apps (Settings → Developer), apps in a server, and their slash commands. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import { useMeId } from './useMe';

export interface Bot {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  interactions_url: string | null;
  public: boolean;
  created_at: string;
}
export interface BotCommandRow {
  bot_id: string;
  name: string;
  description: string;
}

const BOT_COLS = 'id, owner_id, name, description, avatar_url, interactions_url, public, created_at';

const unwrap = <T>(r: { data: unknown; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export function useMyBots() {
  const sb = useSupabase();
  const me = useMeId();
  return useQuery({
    queryKey: ['my-bots', me],
    queryFn: async () => unwrap<Bot[]>(await sb.from('bots').select(BOT_COLS).eq('owner_id', me).order('created_at')),
  });
}

export function useBotCommands(botIds: string[]) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['bot-commands', [...botIds].sort().join(',')],
    enabled: botIds.length > 0,
    queryFn: async () => unwrap<BotCommandRow[]>(await sb.from('bot_commands').select('bot_id, name, description').in('bot_id', botIds).order('name')),
  });
}

/** Apps in a server, with their commands (for the composer's / menu). */
export function useServerApps(serverId: string | null | undefined) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-apps', serverId],
    enabled: !!serverId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap<{ bot_id: string; added_at: string }[]>(await sb.from('server_bots').select('bot_id, added_at').eq('server_id', serverId!));
      if (!rows.length) return { bots: [] as Bot[], commands: [] as BotCommandRow[] };
      const ids = rows.map((r) => r.bot_id);
      const [bots, commands] = await Promise.all([
        sb.from('bots').select(BOT_COLS).in('id', ids),
        sb.from('bot_commands').select('bot_id, name, description').in('bot_id', ids).order('name'),
      ]);
      return { bots: unwrap<Bot[]>(bots), commands: unwrap<BotCommandRow[]>(commands) };
    },
  });
}

export function useBotActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const me = useMeId();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-bots', me] });
    void qc.invalidateQueries({ queryKey: ['bot-commands'] });
    void qc.invalidateQueries({ queryKey: ['server-apps'] });
  };
  return {
    create: useMutation({
      mutationFn: async ({ name, description }: { name: string; description?: string }) =>
        unwrap<{ id: string; token: string }[]>(await sb.rpc('create_bot', { p_name: name, p_description: description ?? null }))[0]!,
      onSettled: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: Partial<Bot> & { id: string }) => unwrap(await sb.from('bots').update(patch).eq('id', id)),
      onSettled: refresh,
    }),
    remove: useMutation({ mutationFn: async (id: string) => unwrap(await sb.from('bots').delete().eq('id', id)), onSettled: refresh }),
    resetToken: useMutation({ mutationFn: async (id: string) => unwrap<string>(await sb.rpc('reset_bot_token', { p_bot: id })) }),
    signingSecret: async (id: string) => unwrap<string>(await sb.rpc('bot_signing_secret', { p_bot: id })),
    addCommand: useMutation({
      mutationFn: async (c: BotCommandRow) => unwrap(await sb.from('bot_commands').upsert(c, { onConflict: 'bot_id,name' })),
      onSettled: refresh,
    }),
    removeCommand: useMutation({
      mutationFn: async (c: { bot_id: string; name: string }) => unwrap(await sb.from('bot_commands').delete().eq('bot_id', c.bot_id).eq('name', c.name)),
      onSettled: refresh,
    }),
    install: useMutation({
      mutationFn: async ({ serverId, botId }: { serverId: string; botId: string }) =>
        unwrap(await sb.from('server_bots').insert({ server_id: serverId, bot_id: botId, added_by: me })),
      onSettled: refresh,
    }),
    uninstall: useMutation({
      mutationFn: async ({ serverId, botId }: { serverId: string; botId: string }) => unwrap(await sb.from('server_bots').delete().eq('server_id', serverId).eq('bot_id', botId)),
      onSettled: refresh,
    }),
  };
}

/** Run an app's slash command (bot-interact edge function). */
export function useRunAppCommand() {
  const sb = useSupabase();
  return async (input: { channelId: string; botId: string; command: string; args: string }) => {
    const { data, error } = await sb.functions.invoke('bot-interact', {
      body: { channel_id: input.channelId, bot_id: input.botId, command: input.command, args: input.args },
    });
    if (error) {
      // The function's own message is in the response body.
      const ctx = (error as { context?: Response }).context;
      const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null;
      throw new Error(msg ?? error.message);
    }
    return data as { ok: boolean; posted: boolean };
  };
}
