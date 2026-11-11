/**
 * Permission bitmask, mirrored 1:1 from `public.permission_bit()` in supabase/schema.sql.
 * The database is the source of truth: these helpers only drive UI affordances
 * (hiding buttons, disabling inputs). RLS enforces the real checks.
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
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = (1n << 19n) - 1n;

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
