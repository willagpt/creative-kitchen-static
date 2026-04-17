-- Migration: create_organic_intel_tables
-- Phase 1.1 of the Organic Intelligence feature.
-- Creates 4 tables (followed_organic_accounts, organic_posts, organic_post_metrics,
-- organic_fetch_log) plus supporting indexes and permissive public RLS policies
-- matching the project convention (see followed_brands, competitor_ads,
-- foreplay_credit_log, video_analyses).
--
-- Decisions embedded:
--   D3 -> followed_organic_accounts.fetch_frequency
--   D4 -> organic_fetch_log.cost_estimate, organic_fetch_log.yt_quota_units
--   D6 -> single accounts table with platform check + UNIQUE(platform, platform_account_id)
--   D7 -> organic_posts.language
--
-- RLS pattern: permissive public (4 policies per table: select/insert/update/delete).
-- This project is NOT workspace-scoped.

-- 1. followed_organic_accounts -----------------------------------------------

create table public.followed_organic_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  platform text not null check (platform in ('instagram', 'youtube')),
  handle text not null,
  platform_account_id text not null,
  uploads_playlist_id text,
  is_active boolean not null default true,
  fetch_frequency text not null default 'daily',
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, platform_account_id)
);

alter table public.followed_organic_accounts enable row level security;

create policy "Anyone can select followed_organic_accounts"
  on public.followed_organic_accounts for select using (true);

create policy "Anyone can insert followed_organic_accounts"
  on public.followed_organic_accounts for insert with check (true);

create policy "Anyone can update followed_organic_accounts"
  on public.followed_organic_accounts for update using (true) with check (true);

create policy "Anyone can delete followed_organic_accounts"
  on public.followed_organic_accounts for delete using (true);

-- 2. organic_posts -----------------------------------------------------------

create table public.organic_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.followed_organic_accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube')),
  platform_post_id text not null,
  post_url text not null,
  post_type text,
  video_url text,
  thumbnail_url text,
  title text,
  caption text,
  hashtags text[] not null default '{}',
  posted_at timestamptz,
  duration_seconds numeric,
  audio_id text,
  audio_title text,
  language text,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  unique (platform, platform_post_id)
);

create index organic_posts_account_posted_idx
  on public.organic_posts (account_id, posted_at desc);

alter table public.organic_posts enable row level security;

create policy "Anyone can select organic_posts"
  on public.organic_posts for select using (true);

create policy "Anyone can insert organic_posts"
  on public.organic_posts for insert with check (true);

create policy "Anyone can update organic_posts"
  on public.organic_posts for update using (true) with check (true);

create policy "Anyone can delete organic_posts"
  on public.organic_posts for delete using (true);

-- 3. organic_post_metrics ----------------------------------------------------

create table public.organic_post_metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.organic_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  shares bigint,
  engagement_rate numeric
);

create index organic_post_metrics_post_captured_idx
  on public.organic_post_metrics (post_id, captured_at desc);

alter table public.organic_post_metrics enable row level security;

create policy "Anyone can select organic_post_metrics"
  on public.organic_post_metrics for select using (true);

create policy "Anyone can insert organic_post_metrics"
  on public.organic_post_metrics for insert with check (true);

create policy "Anyone can update organic_post_metrics"
  on public.organic_post_metrics for update using (true) with check (true);

create policy "Anyone can delete organic_post_metrics"
  on public.organic_post_metrics for delete using (true);

-- 4. organic_fetch_log -------------------------------------------------------

create table public.organic_fetch_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.followed_organic_accounts(id) on delete set null,
  platform text not null check (platform in ('instagram', 'youtube')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  posts_fetched integer not null default 0,
  posts_new integer not null default 0,
  cost_estimate numeric,
  yt_quota_units integer,
  status text not null default 'running' check (status in ('running', 'success', 'error', 'partial')),
  error_message text
);

alter table public.organic_fetch_log enable row level security;

create policy "Anyone can select organic_fetch_log"
  on public.organic_fetch_log for select using (true);

create policy "Anyone can insert organic_fetch_log"
  on public.organic_fetch_log for insert with check (true);

create policy "Anyone can update organic_fetch_log"
  on public.organic_fetch_log for update using (true) with check (true);

create policy "Anyone can delete organic_fetch_log"
  on public.organic_fetch_log for delete using (true);
