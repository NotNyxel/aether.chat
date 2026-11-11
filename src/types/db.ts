/** Row types matching supabase/schema.sql and supabase/migrations/*.sql. */

export type ChannelType = 'category' | 'text' | 'voice' | 'stream';
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  custom_status: string | null;
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
  created_at: string;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  content_type: string;
  width?: number;
  height?: number;
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
  edited_at: string | null;
  created_at: string;
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
