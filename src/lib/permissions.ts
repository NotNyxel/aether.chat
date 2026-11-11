/**
 * Permission bitmask, mirrored 1:1 from `public.permission_bit()` (supabase/migrations/006).
 * The database is the source of truth: these helpers only drive UI affordances
 * (hiding buttons, disabling inputs). RLS and RPC checks enforce the real rules.
 */
export const Permission = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  ATTACH_FILES: 1n << 2n,
  MANAGE_MESSAGES: 1n << 3n,
  MENTION_EVERYONE: 1n << 4n,
  CONNECT: 1n << 5n,
  SPEAK: 1n << 6n,
  STREAM: 1n << 7n,
  MUTE_MEMBERS: 1n << 8n,
  DEAFEN_MEMBERS: 1n << 9n,
  MOVE_MEMBERS: 1n << 10n,
  MANAGE_CHANNELS: 1n << 11n,
  MANAGE_ROLES: 1n << 12n,
  MANAGE_SERVER: 1n << 13n,
  CREATE_INVITE: 1n << 14n,
  KICK_MEMBERS: 1n << 15n,
  BAN_MEMBERS: 1n << 16n,
  CHANGE_NICKNAME: 1n << 17n,
  ADMINISTRATOR: 1n << 18n,
  MANAGE_NICKNAMES: 1n << 19n,
  MODERATE_MEMBERS: 1n << 20n,
  VIEW_AUDIT_LOG: 1n << 21n,
  USE_SOUNDBOARD: 1n << 22n,
  MANAGE_EXPRESSIONS: 1n << 23n,
  REQUEST_TO_SPEAK: 1n << 24n,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = (1n << 25n) - 1n;

/** Labels, descriptions and grouping for the role editor and channel overrides. */
export const PERMISSION_GROUPS: { title: string; items: { key: PermissionName; label: string; hint: string; channel?: boolean }[] }[] = [
  {
    title: 'General',
    items: [
      { key: 'VIEW_CHANNEL', label: 'View Channels', hint: 'See channels and read their history.', channel: true },
      { key: 'MANAGE_CHANNELS', label: 'Manage Channels', hint: 'Create, edit, reorder and delete channels.', channel: true },
      { key: 'MANAGE_ROLES', label: 'Manage Roles', hint: 'Create and edit roles below their own, assign them, and edit channel permissions.', channel: true },
      { key: 'MANAGE_SERVER', label: 'Manage Server', hint: 'Change the server name, icon, banner and custom invite codes.' },
      { key: 'VIEW_AUDIT_LOG', label: 'View Audit Log', hint: 'See the record of changes made to this server.' },
    ],
  },
  {
    title: 'Membership',
    items: [
      { key: 'CREATE_INVITE', label: 'Create Invite', hint: 'Invite new people to the server.', channel: true },
      { key: 'CHANGE_NICKNAME', label: 'Change Nickname', hint: 'Change their own nickname in this server.' },
      { key: 'MANAGE_NICKNAMES', label: 'Manage Nicknames', hint: "Change other members' nicknames." },
      { key: 'KICK_MEMBERS', label: 'Kick Members', hint: 'Remove members (they can rejoin with a new invite).' },
      { key: 'BAN_MEMBERS', label: 'Ban Members', hint: 'Remove members permanently.' },
      { key: 'MODERATE_MEMBERS', label: 'Timeout Members', hint: 'Stop members from chatting, reacting or joining voice for a while.' },
    ],
  },
  {
    title: 'Text',
    items: [
      { key: 'SEND_MESSAGES', label: 'Send Messages', hint: 'Post messages in text channels.', channel: true },
      { key: 'ATTACH_FILES', label: 'Attach Files', hint: 'Upload images and files.', channel: true },
      { key: 'MENTION_EVERYONE', label: 'Mention @everyone, @here and all roles', hint: 'Ping everyone, or roles that are not mentionable.', channel: true },
      { key: 'MANAGE_MESSAGES', label: 'Manage Messages', hint: "Pin messages and bypass slow mode.", channel: true },
    ],
  },
  {
    title: 'Voice',
    items: [
      { key: 'CONNECT', label: 'Connect', hint: 'Join voice and stream channels.', channel: true },
      { key: 'SPEAK', label: 'Speak', hint: 'Talk in voice channels.', channel: true },
      { key: 'STREAM', label: 'Video & Screen Share', hint: 'Turn on the camera and share the screen.', channel: true },
      { key: 'USE_SOUNDBOARD', label: 'Use Soundboard', hint: 'Play soundboard sounds in voice.', channel: true },
      { key: 'REQUEST_TO_SPEAK', label: 'Request to Speak', hint: 'Raise a hand to speak in stage channels.', channel: true },
      { key: 'MUTE_MEMBERS', label: 'Mute Members', hint: 'Server-mute others in voice, and moderate stages (invite speakers, move to audience).', channel: true },
      { key: 'DEAFEN_MEMBERS', label: 'Deafen Members', hint: 'Server-deafen others in voice.', channel: true },
      { key: 'MOVE_MEMBERS', label: 'Move Members', hint: 'Move members between voice channels, disconnect them, and join full channels.', channel: true },
    ],
  },
  {
    title: 'Expressions',
    items: [{ key: 'MANAGE_EXPRESSIONS', label: 'Manage Expressions', hint: "Add, edit and remove the server's soundboard sounds." }],
  },
  {
    title: 'Advanced',
    items: [{ key: 'ADMINISTRATOR', label: 'Administrator', hint: 'Every permission, and bypasses channel overrides. Grant with care.' }],
  },
];

/** PostgREST returns bigint columns as numbers or strings depending on size; normalize both. */
export function toMask(value: number | string | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

export function hasPermission(mask: bigint, perm: bigint): boolean {
  if ((mask & Permission.ADMINISTRATOR) !== 0n) return true;
  return (mask & perm) === perm;
}

export function permissionNames(mask: bigint): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter((name) => (mask & Permission[name]) !== 0n);
}
