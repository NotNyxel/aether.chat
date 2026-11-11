/**
 * Forum and media channels: a browsable list (or gallery) of posts with tags, sort, search and
 * guidelines. Each post is a thread; opening one shows it in the side panel. Media channels use
 * the gallery layout and every post needs an image or video.
 */
import { useMemo, useRef, useState } from 'react';
import { uploadAttachmentTo, useProfile } from '../hooks/useChatData';
import { isArchived, useChannelPermissions, useForumStarters, useThreadActions, useThreads } from '../hooks/useThreads';
import { Markdown } from '../lib/markdown';
import { hasPermission, Permission } from '../lib/permissions';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Message, Server } from '../types/db';
import { ChannelIcon } from './ChannelSidebar';
import { Dialog } from './Dialog';
import { Avatar } from './ProfileCard';
import { inputCls } from './SettingsPanel';
import { TagPill, ThreadPanel, timeAgo } from './Threads';

function PostAuthor({ userId }: { userId: string | null }) {
  const { data: p } = useProfile(userId);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar profile={p} size={18} showFrame={false} />
      <span className="truncate">{p?.display_name || p?.username || '…'}</span>
    </span>
  );
}

function firstMedia(m: Message | undefined) {
  return m?.attachments?.find((a) => a.content_type.startsWith('image/') || a.content_type.startsWith('video/'));
}

function PostCard({ post, starter, forum, layout, onOpen }: { post: Channel; starter: Message | undefined; forum: Channel; layout: 'list' | 'gallery'; onOpen: () => void }) {
  const tags = forum.forum_tags.filter((t) => post.thread_tags.includes(t.id));
  const media = firstMedia(starter);
  const archived = isArchived(post);
  const replies = Math.max(0, post.thread_message_count - 1);

  if (layout === 'gallery') {
    return (
      <button type="button" onClick={onOpen} className="ae-enter ae-lift group overflow-hidden rounded-ae border border-ae-border bg-ae-surface/50 text-left hover:border-ae-accent">
        <div className="relative aspect-[4/3] bg-ae-sunken">
          {media && !media.spoiler ? (
            media.content_type.startsWith('image/') ? (
              <img src={media.url} alt={media.alt ?? ''} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : (
              <video src={media.url} muted className="h-full w-full object-cover" />
            )
          ) : (
            <div className="grid h-full place-items-center text-4xl opacity-40">{media?.spoiler ? '🙈' : '🖼️'}</div>
          )}
          {archived && <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 text-[10px] text-white uppercase">archived</span>}
        </div>
        <div className="space-y-1 p-2.5">
          <p className="truncate text-sm font-semibold">{post.name}</p>
          <div className="flex items-center justify-between text-xs text-ae-muted">
            <PostAuthor userId={post.thread_owner_id} />
            <span className="shrink-0">💬 {replies}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button type="button" onClick={onOpen} className="ae-enter ae-lift flex w-full gap-3 rounded-ae border border-ae-border bg-ae-surface/40 p-3 text-left hover:border-ae-accent">
      <div className="min-w-0 flex-1 space-y-1">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <TagPill key={t.id} tag={t} />
            ))}
          </div>
        )}
        <p className="font-semibold">
          {post.thread_locked && '🔒 '}
          {post.name}
          {archived && <span className="ml-2 rounded bg-ae-surface px-1.5 text-[10px] font-normal text-ae-muted uppercase">archived</span>}
        </p>
        {starter?.content && <div className="line-clamp-2 text-sm text-ae-muted">{starter.content.slice(0, 300)}</div>}
        <div className="flex items-center gap-3 text-xs text-ae-muted">
          <PostAuthor userId={post.thread_owner_id} />
          <span>
            💬 {replies} {replies === 1 ? 'reply' : 'replies'}
          </span>
          <span>{timeAgo(post.last_message_at ?? post.created_at)}</span>
        </div>
      </div>
      {media && !media.spoiler && media.content_type.startsWith('image/') && (
        <img src={media.url} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-ae object-cover" />
      )}
    </button>
  );
}

function NewPostDialog({ forum, onClose }: { forum: Channel; onClose: (postId?: string) => void }) {
  const sb = useSupabase();
  const actions = useThreadActions(forum.id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const media = forum.subtype === 'media';
  const needsMedia = media && !files.some((f) => /^(image|video)\//.test(f.type));
  const needsTag = forum.require_tag && tags.length === 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const post = await actions.create.mutateAsync({ parentId: forum.id, name: title.trim(), tags });
      const attachments = [];
      for (const f of files) attachments.push(await uploadAttachmentTo(sb, post.id, f));
      const { error: e } = await sb.from('messages').insert({ channel_id: post.id, content: body.trim(), attachments });
      if (e) throw new Error(e.message);
      onClose(post.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog wide title={media ? 'New media post' : 'New post'} onClose={() => onClose()}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className={inputCls} autoFocus maxLength={100} placeholder="Post title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className={`${inputCls} min-h-28`}
          maxLength={4000}
          placeholder={media ? 'Say something about it (optional)' : 'What do you want to share? Markdown works.'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {forum.forum_tags.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Tags {forum.require_tag && '(pick at least one)'}</p>
            <div className="flex flex-wrap gap-1.5">
              {forum.forum_tags.map((t) => (
                <TagPill
                  key={t.id}
                  tag={t}
                  active={tags.includes(t.id)}
                  onClick={() => setTags((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : cur.length < 5 ? [...cur, t.id] : cur))}
                />
              ))}
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={media ? 'image/*,video/*' : undefined}
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
        />
        <button type="button" className="ae-press rounded-ae bg-ae-surface px-3 py-2 text-sm hover:bg-ae-hover" onClick={() => fileRef.current?.click()}>
          📎 {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} attached` : media ? 'Add an image or video' : 'Attach files'}
        </button>
        {error && <p className="text-xs text-ae-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={() => onClose()}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim() || (!body.trim() && files.length === 0) || needsMedia || needsTag}
            className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ForumView({ forum, server, userId, channels }: { forum: Channel; server: Server; userId: string; channels: Channel[] }) {
  const { data: posts = [], isLoading } = useThreads(forum.id);
  const { data: perms = 0n } = useChannelPermissions(forum.id);
  const threadId = useUiStore((s) => s.threadId);
  const openThread = useUiStore((s) => s.openThread);
  const [sort, setSort] = useState<'activity' | 'created'>(forum.default_sort);
  const [layout, setLayout] = useState<'list' | 'gallery'>(forum.default_layout);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const canPost = hasPermission(perms, Permission.SEND_MESSAGES);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts
      .filter((p) => (showArchived ? true : !isArchived(p)))
      .filter((p) => tagFilter.every((t) => p.thread_tags.includes(t)))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'created' ? b.created_at.localeCompare(a.created_at) : (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
      );
  }, [posts, query, showArchived, sort, tagFilter]);
  const { data: starters } = useForumStarters(visible.slice(0, 60).map((p) => p.id));
  const archivedCount = posts.filter((p) => isArchived(p)).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ae-border px-4">
          <ChannelIcon channel={forum} size={18} />
          <h1 className="font-semibold">{forum.name}</h1>
          {forum.topic && (
            <button type="button" className="truncate border-l border-ae-border pl-3 text-left text-sm text-ae-muted hover:text-ae-text" onClick={() => setGuidelinesOpen(true)}>
              📜 Guidelines
            </button>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-ae-border px-4 py-2">
          <input
            className="w-56 rounded-ae border border-ae-border bg-ae-sunken px-2 py-1 text-sm outline-none focus:border-ae-accent"
            placeholder="Search posts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="rounded-ae border border-ae-border bg-ae-sunken px-2 py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="activity">Recently active</option>
            <option value="created">Newest</option>
          </select>
          <div className="flex rounded-ae border border-ae-border text-xs">
            {(['list', 'gallery'] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLayout(l)} className={`px-2 py-1 capitalize ${layout === l ? 'bg-ae-surface font-semibold' : 'text-ae-muted'}`}>
                {l === 'list' ? '☰ List' : '▦ Gallery'}
              </button>
            ))}
          </div>
          {archivedCount > 0 && (
            <label className="flex items-center gap-1 text-xs text-ae-muted">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived ({archivedCount})
            </label>
          )}
          {canPost && (
            <button type="button" className="ae-press ml-auto rounded-ae bg-ae-accent px-3 py-1.5 text-sm font-semibold text-ae-on-accent" onClick={() => setComposing(true)}>
              + New post
            </button>
          )}
          {forum.forum_tags.length > 0 && (
            <div className="flex w-full flex-wrap gap-1.5">
              {forum.forum_tags.map((t) => (
                <TagPill
                  key={t.id}
                  tag={t}
                  active={tagFilter.includes(t.id)}
                  onClick={() => setTagFilter((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
                />
              ))}
            </div>
          )}
        </div>

        <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="p-8 text-center text-sm text-ae-muted">Loading posts…</p>
          ) : visible.length === 0 ? (
            <div className="ae-enter p-10 text-center">
              <p className="mb-2 text-4xl">{forum.subtype === 'media' ? '🖼️' : '💬'}</p>
              <p className="font-semibold">{posts.length ? 'No posts match.' : 'No posts yet.'}</p>
              {canPost && !posts.length && <p className="text-sm text-ae-muted">Start the first conversation with “New post”.</p>}
            </div>
          ) : layout === 'gallery' ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {visible.map((p) => (
                <PostCard key={p.id} post={p} starter={starters?.get(p.id)} forum={forum} layout="gallery" onOpen={() => openThread(p.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((p) => (
                <PostCard key={p.id} post={p} starter={starters?.get(p.id)} forum={forum} layout="list" onOpen={() => openThread(p.id)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {threadId && <ThreadPanel threadId={threadId} server={server} userId={userId} channels={channels} wide />}
      {composing && (
        <NewPostDialog
          forum={forum}
          onClose={(id) => {
            setComposing(false);
            if (id) openThread(id);
          }}
        />
      )}
      {guidelinesOpen && forum.topic && (
        <Dialog title={`Guidelines for #${forum.name}`} onClose={() => setGuidelinesOpen(false)}>
          <Markdown source={forum.topic} className="text-sm" />
        </Dialog>
      )}
    </div>
  );
}
