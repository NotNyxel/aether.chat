-- Aether 2.0: public storage buckets only take the file types they're for. Run after 027.
-- Before, anyone could upload any type (including HTML pages or SVG images, which can carry
-- scripts when opened directly) into profile media, emoji and soundboard storage.
-- (Badge images are uploaded by admins only, and may be SVG.)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
                                                          'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac']
     where id = 'profile-media';
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] where id = 'emojis';
    update storage.buckets set allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac'] where id = 'soundboard';
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'] where id = 'badges';
  end if;
end;
$$;
