/**
 * Server-state hooks (TanStack Query v5 + Supabase): profiles, servers, channels, members and
 * messages for both server channels and DM conversations. RLS decides what each query returns,
 * so these hooks never filter by membership themselves.
 */
import { dequeue, enqueue, isNetworkError, readOutbox } from '../lib/outbox';
import { useMeId } from './useMe';
import { encryptBytes, encryptText } from '../lib/e2e';
import { toast } from '../components/Toaster';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useSupabase } from '../lib/supabase';
import { toMask } from '../lib/permissions';
import type {
  Attachment,
  Channel,
  ChannelSubtype,
  ChannelType,
  EditableProfile,
  Message,
  MessageScope,
  Reaction,
  Server,
  ServerMember,
  UserProfile,
} from '../types/db';
import { liveChannel } from '../lib/live';

const PAGE_SIZE = 50;
const TEN_YEARS_S = 10 * 365 * 24 * 3600;

export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

function scopeColumn(scope: MessageScope): 'channel_id' | 'conversation_id' {
  return scope.kind === 'channel' ? 'channel_id' : 'conversation_id';
}

// ── Profiles ───────────────────────────────────────────────────────────────────────────────

export function useProfile(userId: string | null | undefined) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await sb.from('users').select('*').eq('id', userId!).maybeSingle()) as UserProfile | null,
  });
}

export function useUpdateProfile(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<EditableProfile>) =>
      unwrap(await sb.from('users').update(patch).eq('id', userId).select('*').single()) as UserProfile,
    onSuccess: (profile) => qc.setQueryData(['profile', userId], profile),
  });
}

/** Uploads an image or clip to profile-media/<uid>/ and returns its public URL. */
export function useUploadProfileMedia(userId: string) {
  const sb = useSupabase();
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: 'avatar' | 'banner' | 'audio' }) => {
      const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${userId}/${kind}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('profile-media').upload(path, file, {
        contentType: file.type,
        upsert: false,
        cacheControl: '31536000',
      });
      if (error) throw new Error(error.message);
      return sb.storage.from('profile-media').getPublicUrl(path).data.publicUrl;
    },
  });
}

// ── Servers ────────────────────────────────────────────────────────────────────────────────

export function useServers(userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['servers', userId],
    queryFn: async () => unwrap(await sb.from('servers').select('*').order('created_at')) as Server[],
  });
}

export function useCreateServer(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await sb.from('servers').insert({ name }).select('*').single()) as Server,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers', userId] }),
  });
}

export function useJoinServer(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => unwrap(await sb.rpc('join_server', { p_code: code.trim() })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers', userId] }),
  });
}

export function useLeaveServer(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const { error } = await sb.from('server_members').delete().eq('server_id', serverId).eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers', userId] }),
  });
}

export function useDeleteServer(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const { error } = await sb.from('servers').delete().eq('id', serverId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers', userId] }),
  });
}

export function useCreateInvite() {
  const sb = useSupabase();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const row = unwrap(
        await sb.from('server_invites').insert({ server_id: serverId, expires_at: expires }).select('code').single(),
      ) as { code: string };
      return row.code;
    },
  });
}

/** The caller's effective server permission mask (owner and admins get every bit). */
export function useServerPermissions(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-permissions', serverId],
    enabled: !!serverId,
    staleTime: 60_000,
    queryFn: async () => toMask(unwrap(await sb.rpc('server_permissions', { p_server_id: serverId })) as number | string),
  });
}

export function useServerMembers(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-members', serverId],
    enabled: !!serverId,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await sb.from('server_members').select('*').eq('server_id', serverId!).order('joined_at')) as ServerMember[],
  });
}

// ── Channels ───────────────────────────────────────────────────────────────────────────────

export function useChannels(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['channels', serverId],
    enabled: !!serverId,
    queryFn: async () =>
      // Threads and forum posts are channels too, but live under their parent, not in the list.
      unwrap(await sb.from('channels').select('*').eq('server_id', serverId!).is('thread_parent_id', null).order('position').order('created_at')) as Channel[],
  });
}

export function useCreateChannel(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: ChannelType; parentId: string | null; subtype?: ChannelSubtype | null }) =>
      unwrap(
        await sb
          .from('channels')
          .insert({
            server_id: serverId,
            name: input.name,
            type: input.type,
            parent_id: input.parentId,
            position: 99,
            ...(input.subtype ? { subtype: input.subtype, default_layout: input.subtype === 'media' ? 'gallery' : 'list' } : {}),
          })
          .select('*')
          .single(),
      ) as Channel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', serverId] }),
  });
}

// ── Messages ───────────────────────────────────────────────────────────────────────────────

type MessagePages = InfiniteData<Message[], string | null>;

function upsertMessage(data: MessagePages | undefined, msg: Message): MessagePages | undefined {
  if (!data) return data;
  const exists = data.pages.some((page) => page.some((m) => m.id === msg.id));
  if (exists) {
    return { ...data, pages: data.pages.map((page) => page.map((m) => (m.id === msg.id ? msg : m))) };
  }
  // Pages are newest-first. A new message goes at the front of the first page.
  const [first = [], ...rest] = data.pages;
  return { ...data, pages: [[msg, ...first], ...rest] };
}

/**
 * The real id of a message you sent → the temporary id it was shown under while sending. The
 * message list keys rows by this so the row isn't rebuilt (and doesn't animate in a second time)
 * when the server confirms it.
 */
const clientKeys = new Map<string, string>();
export const messageRenderKey = (m: { id: string }): string => clientKeys.get(m.id) ?? m.id;

/** Drops the optimistic copy of a message once the real one arrives (same author and text). */
function settlePending(data: MessagePages | undefined, msg: Message): MessagePages | undefined {
  if (!data) return data;
  let done = false;
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.filter((m) => {
        const hit = !done && (m as { pending?: boolean }).pending && m.author_id === msg.author_id && m.content === msg.content;
        if (hit) {
          done = true;
          if (!clientKeys.has(msg.id)) clientKeys.set(msg.id, m.id);
        }
        return !hit;
      }),
    ),
  };
}

function removeMessage(data: MessagePages | undefined, id: string): MessagePages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== id)) };
}

/** Paginated message history (newest-first pages) kept live with Realtime postgres_changes. */
export function useMessages(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const column = scopeColumn(scope);

  const me = useMeId();
  const query = useInfiniteQuery({
    queryKey: ['messages', scope.id],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = sb.from('messages').select('*').eq(column, scope.id).order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const rows = unwrap(await q) as Message[];
      if (pageParam || !me) return rows;
      // Messages still waiting to send (offline) stay at the bottom of the chat.
      const waiting = readOutbox(me)
        .filter((m) => m.scope.id === scope.id && !rows.some((r) => r.id === m.id))
        .map((m) => queuedMessage(m.scope, m.id, m, m.createdAt));
      return [...waiting.reverse(), ...rows];
    },
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1].created_at : undefined),
    staleTime: Infinity, // Realtime keeps it fresh
  });

  useEffect(() => {
    const key = ['messages', scope.id];
    const filter = `${column}=eq.${scope.id}`;
    const stop = liveChannel(sb, `messages:${scope.id}`, (c) =>
      c
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (p) =>
        qc.setQueryData<MessagePages>(key, (d) => upsertMessage(settlePending(d, p.new as Message), p.new as Message)),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (p) => {
        qc.setQueryData<MessagePages>(key, (d) => upsertMessage(d, p.new as Message));
        void qc.invalidateQueries({ queryKey: ['pins', scope.id] });
      })
      // Delete events cannot be filtered server-side and carry only the primary key.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) qc.setQueryData<MessagePages>(key, (d) => removeMessage(d, id));
      }),
      () => void qc.invalidateQueries({ queryKey: key }),
    );
    return () => {
      stop();
    };
  }, [column, qc, sb, scope.id]);

  return query;
}

export interface SendMessageInput {
  content: string;
  replyToId?: string | null;
  attachments?: Attachment[];
  /** Poll draft; the database normalizes it and sets expires_at from duration_hours. */
  poll?: { question: string; options: { text: string; emoji?: string | null }[]; multi: boolean; duration_hours: number };
}

/** Extra fields for an optimistic send: the message shows up instantly with a temporary id. */
export interface SendVars extends SendMessageInput {
  tempId?: string;
  authorId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A message waiting in the outbox, as it shows in the chat ("Waiting for connection"). */
export function queuedMessage(scope: MessageScope, id: string, v: { content: string; replyToId?: string | null; attachments?: Attachment[]; authorId?: string }, createdAt = new Date().toISOString()): Message {
  return {
    id,
    channel_id: scope.kind === 'channel' ? scope.id : null,
    conversation_id: scope.kind === 'channel' ? null : scope.id,
    author_id: v.authorId ?? null,
    content: v.content,
    attachments: v.attachments ?? [],
    reply_to_id: v.replyToId ?? null,
    pinned: false,
    edited_at: null,
    created_at: createdAt,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    poll: null,
    forwarded_from: null,
    thread_id: null,
    crossposted_from: null,
    published_at: null,
    queued: true,
  } as unknown as Message;
}

export function useSendMessage(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['messages', scope.id];
  return useMutation({
    // Run even when the device says it's offline: the send itself falls back to the outbox
    // (TanStack would otherwise pause it in memory and lose it if the app closed).
    networkMode: 'always',
    // Show it right away; the real row replaces it when the server answers.
    onMutate: (v: SendVars) => {
      if (!v.tempId) return;
      const optimistic = {
        id: v.tempId,
        channel_id: scope.kind === 'channel' ? scope.id : null,
        conversation_id: scope.kind === 'channel' ? null : scope.id,
        author_id: v.authorId ?? null,
        content: v.content,
        attachments: v.attachments ?? [],
        reply_to_id: v.replyToId ?? null,
        pinned: false,
        edited_at: null,
        created_at: new Date().toISOString(),
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        poll: null,
        forwarded_from: null,
        thread_id: null,
        crossposted_from: null,
        published_at: null,
        pending: true,
      } as unknown as Message;
      qc.setQueryData<MessagePages>(key, (d) => upsertMessage(d, optimistic));
    },
    onError: (_e, v) => {
      if (v.tempId) qc.setQueryData<MessagePages>(key, (d) => removeMessage(d, v.tempId!));
    },
    mutationFn: async (input: SendVars) => {
      // The id is picked here, so a retry after a dropped connection can't post it twice.
      const id = input.tempId && UUID.test(input.tempId) ? input.tempId : crypto.randomUUID();
      const res = await sb
        .from('messages')
        .insert({
          id,
          [scopeColumn(scope)]: scope.id,
          content: input.content,
          reply_to_id: input.replyToId ?? null,
          attachments: input.attachments ?? [],
          ...(input.poll ? { poll: input.poll } : {}),
        })
        .select('*');
      if (res.error) {
        // Offline: keep it on this device and send it when the connection is back.
        if (!input.poll && input.authorId && isNetworkError(res.error)) {
          enqueue({ id, scope, content: input.content, replyToId: input.replyToId ?? null, attachments: input.attachments ?? [], createdAt: new Date().toISOString(), authorId: input.authorId });
          return queuedMessage(scope, id, input);
        }
        throw new Error(res.error.message);
      }
      const rows = res.data as Message[];
      if (rows[0]) return rows[0];
      // No row back means the server's AutoMod dropped it. Explain which rule, if we can.
      const { data: { user } } = await sb.auth.getUser();
      const { data: ev } = await sb
        .from('automod_events')
        .select('rule_name, matched, action')
        .eq('user_id', user?.id ?? '')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      const why = ev ? `“${(ev as { rule_name: string }).rule_name}”${(ev as { matched: string | null }).matched ? ` (${(ev as { matched: string }).matched})` : ''}` : 'a server rule';
      throw new Error(
        `🛡️ Your message was blocked by AutoMod: ${why}.${(ev as { action?: string } | null)?.action === 'block_and_timeout' ? ' You were also timed out.' : ''}`,
      );
    },
    onSuccess: (msg, v) => {
      if (v.tempId && !clientKeys.has(msg.id)) clientKeys.set(msg.id, v.tempId);
      qc.setQueryData<MessagePages>(key, (d) => upsertMessage(v.tempId ? removeMessage(d, v.tempId) : d, msg));
    },
  });
}

/**
 * Sends what's waiting in the outbox, oldest first, whenever the app is online: at start, when the
 * connection comes back, and every 20 seconds while anything is waiting. Mounted once.
 */
export function useOutboxFlusher(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  useEffect(() => {
    let busy = false;
    const flush = async () => {
      if (busy || !navigator.onLine) return;
      const items = readOutbox(userId);
      if (!items.length) return;
      busy = true;
      try {
        for (const m of items) {
          const key = ['messages', m.scope.id];
          const res = await sb
            .from('messages')
            .insert({ id: m.id, [scopeColumn(m.scope)]: m.scope.id, content: m.content, reply_to_id: m.replyToId, attachments: m.attachments })
            .select('*');
          if (res.error && isNetworkError(res.error)) break; // still offline: try again later
          dequeue(userId, m.id);
          if (res.error && !/duplicate key/i.test(res.error.message)) {
            // The server said no (left the chat, blocked, slow mode, AutoMod…): don't retry forever.
            qc.setQueryData<MessagePages>(key, (d) => removeMessage(d, m.id));
            toast.error(`A message you wrote offline couldn’t be sent: ${res.error.message}`);
            continue;
          }
          const row = (res.data as Message[] | null)?.[0];
          if (row) qc.setQueryData<MessagePages>(key, (d) => upsertMessage(d, row));
          else void qc.invalidateQueries({ queryKey: key }); // already there (an earlier try got through)
        }
      } finally {
        busy = false;
      }
    };
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const t = setInterval(() => void flush(), 20_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(t);
    };
  }, [sb, qc, userId]);
}

/** Cancel a message that hasn't been sent yet. */
export function useCancelQueued(scope: MessageScope) {
  const qc = useQueryClient();
  const me = useMeId();
  const scopeId = scope.id;
  return useCallback(
    (id: string) => {
      dequeue(me, id);
      qc.setQueryData<MessagePages>(['messages', scopeId], (d) => removeMessage(d, id));
    },
    [qc, me, scopeId],
  );
}

export function useEditMessage(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) =>
      unwrap(await sb.from('messages').update({ content }).eq('id', id).select('*').single()) as Message,
    onSuccess: (msg) => qc.setQueryData<MessagePages>(['messages', scope.id], (d) => upsertMessage(d, msg)),
  });
}

export function useDeleteMessage(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('messages').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: (id) => qc.setQueryData<MessagePages>(['messages', scope.id], (d) => removeMessage(d, id)),
  });
}

/**
 * Uploads a file to attachments/<scope id>/<uuid>/<name>. The bucket is private, so the stored URL
 * is a long-lived signed URL (anyone holding the link can open the file, as with most chat CDNs).
 */
/**
 * Uploads a file into a channel/conversation/thread's attachment folder and returns its metadata.
 * With `key` (an encrypted chat), the file is encrypted first and stored under a meaningless name;
 * its real name, type and image size travel encrypted in `e2e.meta`.
 */
export async function uploadAttachmentTo(sb: ReturnType<typeof useSupabase>, scopeId: string, file: File, key?: CryptoKey | null): Promise<Attachment> {
  // Encryption adds 16 bytes, and the bucket stops at exactly 25 MB.
  if (file.size > 25 * 1024 * 1024 - (key ? 16 : 0)) throw new Error(`${file.name} is larger than 25 MB.`);
  const contentType = /^[a-z]+\/[a-zA-Z0-9.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
  let dims: { width?: number; height?: number } = {};
  if (file.type.startsWith('image/')) {
    try {
      const bmp = await createImageBitmap(file);
      dims = { width: bmp.width, height: bmp.height };
      bmp.close();
    } catch {
      // Unsupported image format for decoding. Dimensions are optional.
    }
  }
  if (key) {
    const sealed = await encryptBytes(key, await file.arrayBuffer());
    const path = `${scopeId}/${crypto.randomUUID()}/file.bin`;
    const up = await sb.storage.from('attachments').upload(path, sealed.blob, { contentType: 'application/octet-stream', upsert: false });
    if (up.error) throw new Error(up.error.message);
    const signedE = await sb.storage.from('attachments').createSignedUrl(path, TEN_YEARS_S);
    if (signedE.error || !signedE.data) throw new Error(signedE.error?.message ?? 'Could not sign the upload URL.');
    const meta = await encryptText(key, JSON.stringify({ name: file.name.slice(0, 255), content_type: contentType, ...dims }));
    return { url: signedE.data.signedUrl, name: 'Encrypted file', size: file.size, content_type: 'application/octet-stream', e2e: { iv: sealed.iv, meta } };
  }
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'file';
  const path = `${scopeId}/${crypto.randomUUID()}/${safeName}`;
  const { error } = await sb.storage.from('attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const signed = await sb.storage.from('attachments').createSignedUrl(path, TEN_YEARS_S);
  if (signed.error || !signed.data) throw new Error(signed.error?.message ?? 'Could not sign the upload URL.');
  return { url: signed.data.signedUrl, name: file.name.slice(0, 255), size: file.size, content_type: contentType, ...dims };
}

export function useUploadAttachment(scope: MessageScope) {
  const sb = useSupabase();
  return useMutation({
    mutationFn: (file: File): Promise<Attachment> => uploadAttachmentTo(sb, scope.id, file),
  });
}

// ── Reactions ──────────────────────────────────────────────────────────────────────────────

/** All reactions in a scope, kept live. Grouped per message by the caller. */
export function useReactions(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['reactions', scope.id];

  const query = useQuery({
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () =>
      unwrap(
        await sb.from('message_reactions').select('*').eq('scope_id', scope.id).order('created_at').limit(5000),
      ) as Reaction[],
  });

  useEffect(() => {
    const k = ['reactions', scope.id];
    const same = (a: Reaction, b: Partial<Reaction>) => a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;
    const stop = liveChannel(sb, `reactions:${scope.id}`, (c) =>
      c
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `scope_id=eq.${scope.id}` }, (p) =>
        qc.setQueryData<Reaction[]>(k, (d) => {
          const r = p.new as Reaction;
          return d && !d.some((x) => same(x, r)) ? [...d, r] : d;
        }),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) =>
        qc.setQueryData<Reaction[]>(k, (d) => d?.filter((x) => !same(x, p.old as Partial<Reaction>))),
      ),
      () => void qc.invalidateQueries({ queryKey: k }),
    );
    return () => {
      stop();
    };
  }, [qc, sb, scope.id]);

  return query;
}

export function useToggleReaction(scope: MessageScope, userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, emoji, active }: { messageId: string; emoji: string; active: boolean }) => {
      if (active) {
        const { error } = await sb
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', userId)
          .eq('emoji', emoji);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb.from('message_reactions').insert({ message_id: messageId, emoji });
        if (error && !error.message.includes('duplicate')) throw new Error(error.message);
      }
    },
    // Optimistic: flip locally right away; Realtime reconciles.
    onMutate: ({ messageId, emoji, active }) => {
      qc.setQueryData<Reaction[]>(['reactions', scope.id], (d) => {
        if (!d) return d;
        if (active) return d.filter((r) => !(r.message_id === messageId && r.user_id === userId && r.emoji === emoji));
        return [...d, { message_id: messageId, user_id: userId, emoji, scope_id: scope.id, created_at: new Date().toISOString() }];
      });
    },
    onError: (e) => {
      toast.error(`Couldn’t react: ${e.message}`);
      void qc.invalidateQueries({ queryKey: ['reactions', scope.id] });
    },
  });
}
