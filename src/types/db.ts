/** Row types matching supabase/schema.sql and supabase/migrations/*.sql. */

export type ChannelType = 'category' | 'text' | 'voice' | 'stream';
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export type NameFont = 'default' | 'serif' | 'mono' | 'rounded' | 'display' | 'handwritten' | 'pixel';
export type NameEffect = 'none' | 'gradient' | 'rainbow' | 'glow' | 'neon' | 'shimmer';
export type ProfileEffect = 'none' | 'sparkles' | 'snow' | 'hearts' | 'fireflies' | 'confetti' | 'rain' | 'stars' | 'bubbles' | 'petals';
export type CardStyle = 'solid' | 'glass' | 'gradient' | 'aurora';
export type AvatarShape = 'circle' | 'squircle' | 'hexagon';
export interface ProfileLink {
  label: string;
  url: string;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  custom_status: string | null;
  custom_status_expires_at: string | null;
  pronouns: string | null;
  name_font: NameFont;
  name_effect: NameEffect;
  name_color_a: string | null;
  name_color_b: string | null;
  profile_effect: ProfileEffect;
  card_style: CardStyle;
  avatar_shape: AvatarShape;
  profile_links: ProfileLink[];
  status_emoji: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_frame: string | null;
  banner_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  badge_ids: string[];
  custom_css: string | null;
  audio_status_url: string | null;
  theme_preset: string;
  presence_status: PresenceStatus;
  created_at: string;
  updated_at: string;
}

/** Columns a user may update on their own profile (mirrors the column GRANTs). */
export type EditableProfile = Pick<
  UserProfile,
  | 'username'
  | 'display_name'
  | 'custom_status'
  | 'custom_status_expires_at'
  | 'pronouns'
  | 'name_font'
  | 'name_effect'
  | 'name_color_a'
  | 'name_color_b'
  | 'profile_effect'
  | 'card_style'
  | 'avatar_shape'
  | 'profile_links'
  | 'status_emoji'
  | 'bio'
  | 'avatar_url'
  | 'avatar_frame'
  | 'banner_url'
  | 'primary_color'
  | 'accent_color'
  | 'custom_css'
  | 'audio_status_url'
  | 'theme_preset'
  | 'presence_status'
>;

export interface Server {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  created_at: string;
}

export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
  timed_out_until: string | null;
}

export interface ServerRole {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  position: number;
  /** Bitmask (see src/lib/permissions.ts). Comes back from PostgREST as a number. */
  permissions: number | string;
  is_default: boolean;
  hoist: boolean;
  mentionable: boolean;
  created_at: string;
}

export interface MemberRole {
  server_id: string;
  user_id: string;
  role_id: string;
}

export interface ChannelOverwrite {
  channel_id: string;
  target_type: 'role' | 'member';
  target_id: string;
  allow: number | string;
  deny: number | string;
}

export interface ServerInvite {
  code: string;
  server_id: string;
  creator_id: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface ServerBan {
  server_id: string;
  user_id: string;
  reason: string | null;
  banned_by: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  server_id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  changes: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

export interface Channel {
  id: string;
  server_id: string;
  parent_id: string | null;
  type: ChannelType;
  name: string;
  topic: string | null;
  position: number;
  rate_limit_seconds: number;
  user_limit: number | null;
  nsfw: boolean;
  created_at: string;
  last_message_at: string | null;
  /** null = plain text (or voice/stage/category). */
  subtype: ChannelSubtype | null;
  forum_tags: ForumTag[];
  require_tag: boolean;
  default_sort: 'activity' | 'created';
  default_layout: 'list' | 'gallery';
  /** Set on threads and forum posts: the channel they live in. */
  thread_parent_id: string | null;
  thread_owner_id: string | null;
  thread_private: boolean;
  thread_locked: boolean;
  thread_archived_at: string | null;
  thread_auto_archive: 60 | 1440 | 4320 | 10080;
  thread_tags: string[];
  thread_message_count: number;
  thread_starter_id: string | null;
}

export type ChannelSubtype = 'announcement' | 'forum' | 'media';

export interface ForumTag {
  id: string;
  name: string;
  emoji?: string | null;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  content_type: string;
  width?: number;
  height?: number;
  spoiler?: boolean;
  alt?: string;
}

export interface Poll {
  question: string;
  options: { text: string; emoji: string | null }[];
  multi: boolean;
  expires_at: string;
}

export interface ForwardedFrom {
  message_id: string;
  author_id: string | null;
  created_at: string;
  channel_id: string | null;
  conversation_id: string | null;
}

export interface Message {
  id: string;
  channel_id: string | null;
  conversation_id: string | null;
  author_id: string | null;
  content: string;
  attachments: Attachment[];
  reply_to_id: string | null;
  pinned: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  poll: Poll | null;
  forwarded_from: ForwardedFrom | null;
  mentions: string[];
  mention_everyone: boolean;
  mention_roles: string[];
  edited_at: string | null;
  created_at: string;
  /** Thread started from this message. */
  thread_id: string | null;
  /** Set on copies delivered from a followed announcement channel. */
  crossposted_from: { message_id: string; channel_id: string; channel_name: string; server_id: string; server_name: string } | null;
  published_at: string | null;
}

export interface PollVote {
  message_id: string;
  user_id: string;
  option_id: number;
  scope_id: string;
  created_at: string;
}

export interface UnreadRow {
  scope_id: string;
  kind: 'channel' | 'dm' | 'group';
  server_id: string | null;
  last_message_at: string | null;
  last_read_at: string | null;
  mention_count: number;
}

/** Where messages live: a server text channel or a DM / group DM conversation. */
export interface MessageScope {
  kind: 'channel' | 'conversation';
  id: string;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
  scope_id: string;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
  hidden: boolean;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group';
  name: string | null;
  icon_url: string | null;
  owner_id: string | null;
  last_message_at: string;
  created_at: string;
  conversation_members: ConversationMember[];
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  accepted_at: string | null;
}

export interface UserBlock {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface Call {
  id: string;
  conversation_id: string;
  started_by: string | null;
  started_at: string;
  ended_at: string | null;
}

export type NotificationLevel = 'all' | 'mentions' | 'none';

export interface NotificationSetting {
  user_id: string;
  scope_id: string;
  scope_kind: 'server' | 'channel' | 'conversation';
  /** null = inherit (channel → server → default). */
  level: NotificationLevel | null;
  /** null = not muted; far future ('infinity') = muted until turned off. */
  muted_until: string | null;
  suppress_everyone: boolean;
  updated_at: string;
}

export interface VoiceState {
  user_id: string;
  channel_id: string;
  server_id: string;
  self_mute: boolean;
  self_deaf: boolean;
  streaming: boolean;
  camera: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  /** Stage audience member. */
  suppressed: boolean;
  request_to_speak_at: string | null;
  joined_at: string;
  updated_at: string;
}

export interface SoundboardSound {
  id: string;
  server_id: string;
  name: string;
  emoji: string | null;
  url: string;
  volume: number;
  created_by: string | null;
  created_at: string;
}

export type EventStatus = 'scheduled' | 'active' | 'completed' | 'canceled';

export interface ServerEvent {
  id: string;
  server_id: string;
  channel_id: string | null;
  location: string | null;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  status: EventStatus;
  created_by: string | null;
  created_at: string;
}

export interface EventRsvp {
  event_id: string;
  user_id: string;
  created_at: string;
}
