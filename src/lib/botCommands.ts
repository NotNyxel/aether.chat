/** The built-in bot's slash commands (they run on the server: public.bot_command in 012_servers_bot.sql). */
export const BOT_NAME = 'Aether';

export interface BotCommand {
  name: string;
  args?: string;
  description: string;
  /** Needs a moderator permission. */
  mod?: boolean;
}

export const BOT_COMMANDS: BotCommand[] = [
  { name: 'help', description: 'List every command' },
  { name: 'ping', description: 'Check the bot is awake' },
  { name: 'roll', args: '2d6', description: 'Roll dice' },
  { name: 'coinflip', description: 'Heads or tails' },
  { name: '8ball', args: 'question', description: 'Ask the magic 8-ball' },
  { name: 'choose', args: 'a | b | c', description: 'Let the bot pick for you' },
  { name: 'serverinfo', description: 'About this server' },
  { name: 'userinfo', description: 'About you in this server' },
  { name: 'rules', description: 'Show the server rules' },
  { name: 'say', args: 'text', description: 'Post a message as the bot', mod: true },
  { name: 'purge', args: '10', description: 'Delete recent messages (up to 100)', mod: true },
  { name: 'slowmode', args: 'seconds', description: 'Set slow mode (0 turns it off)', mod: true },
];

const NAMES = new Set([...BOT_COMMANDS.map((c) => c.name), 'flip', 'pick', 'clear']);

/** Parses "/roll 2d6" into a known command, or null for ordinary text. */
export function parseBotCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m || !NAMES.has(m[1]!.toLowerCase())) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() };
}
