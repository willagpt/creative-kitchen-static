-- Organic Intelligence: durable thumbnail cache.
--
-- Instagram and Facebook CDN URLs (scontent-*.cdninstagram.com,
-- instagram.*.fbcdn.net) sign their query strings with short-TTL `oh=` tokens
-- and cross-check IP + User-Agent, which makes them unsuitable as long-lived
-- thumbnail sources. We mirror the Trend Reports fallback pattern: snapshot
-- thumbnails to a public Supabase bucket on ingest, store the public URL
-- alongside the original, and fall back through a server-side proxy for any
-- post that pre-dates the snapshot.
--
-- Shape added:
--   organic_posts.thumbnail_cached_url  text
--     -- Supabase-hosted mirror of the IG/FB CDN thumbnail.
--     -- Populated by fetch-instagram-posts on ingest and a one-off backfill.
--     -- Consumed by the UI in preference to raw IG/FB URLs.
--
-- Storage:
--   bucket `organic-thumbs` (public, 5 MB limit, image/* only).
--   Object key convention: `instagram/{platform_post_id}.jpg`.

alter table public.organic_posts
  add column if not exists thumbnail_cached_url text;

comment on column public.organic_posts.thumbnail_cached_url is
  'Supabase-hosted mirror of the original IG/FB CDN thumbnail. '
  'Prefer over thumbnail_url in UIs; IG/FB URLs are hotlink-blocked '
  'after the signed oh= token expires.';

-- Public bucket for thumbnail snapshots. Idempotent: harmless on re-run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organic-thumbs',
  'organic-thumbs',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
