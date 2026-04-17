-- Migration: create_list_organic_accounts_with_stats_rpc
-- Phase 3b of Organic Intelligence.
--
-- Adds a single RPC that returns each followed_organic_accounts row joined to its latest
-- organic_fetch_log entry plus a count of organic_posts. Replaces the client-side grouping
-- the OrganicIntel frontend used in Phase 3a (fetched last 500 logs + 5000 post ids and
-- grouped in JS). This keeps the frontend to one round trip and scales past thousands of
-- posts / fetch runs.
--
-- Signature:
--   list_organic_accounts_with_stats(p_platform text default null, p_active_only boolean default true)
-- Returns one row per account with the account fields, post_count, and latest_* columns
-- (null if the account has never been fetched).

create or replace function public.list_organic_accounts_with_stats(
  p_platform text default null,
  p_active_only boolean default true
)
returns table (
  id uuid,
  brand_name text,
  platform text,
  handle text,
  platform_account_id text,
  uploads_playlist_id text,
  is_active boolean,
  fetch_frequency text,
  last_fetched_at timestamptz,
  created_at timestamptz,
  post_count bigint,
  latest_log_id uuid,
  latest_started_at timestamptz,
  latest_finished_at timestamptz,
  latest_posts_fetched integer,
  latest_posts_new integer,
  latest_cost_estimate numeric,
  latest_yt_quota_units integer,
  latest_status text,
  latest_error_message text
)
language sql
stable
security invoker
set search_path = public
as $$
  with latest_log as (
    select distinct on (account_id)
      id,
      account_id,
      started_at,
      finished_at,
      posts_fetched,
      posts_new,
      cost_estimate,
      yt_quota_units,
      status,
      error_message
    from organic_fetch_log
    where account_id is not null
    order by account_id, started_at desc
  ),
  post_counts as (
    select account_id, count(*)::bigint as post_count
    from organic_posts
    group by account_id
  )
  select
    a.id,
    a.brand_name,
    a.platform,
    a.handle,
    a.platform_account_id,
    a.uploads_playlist_id,
    a.is_active,
    a.fetch_frequency,
    a.last_fetched_at,
    a.created_at,
    coalesce(pc.post_count, 0) as post_count,
    ll.id as latest_log_id,
    ll.started_at as latest_started_at,
    ll.finished_at as latest_finished_at,
    ll.posts_fetched as latest_posts_fetched,
    ll.posts_new as latest_posts_new,
    ll.cost_estimate as latest_cost_estimate,
    ll.yt_quota_units as latest_yt_quota_units,
    ll.status as latest_status,
    ll.error_message as latest_error_message
  from followed_organic_accounts a
  left join latest_log ll on ll.account_id = a.id
  left join post_counts pc on pc.account_id = a.id
  where (p_active_only = false or a.is_active = true)
    and (p_platform is null or a.platform = p_platform)
  order by a.platform asc, a.handle asc;
$$;

grant execute on function public.list_organic_accounts_with_stats(text, boolean) to anon, authenticated, service_role;

comment on function public.list_organic_accounts_with_stats(text, boolean) is
  'Phase 3b Organic Intel: returns each followed_organic_accounts row joined to its latest organic_fetch_log entry plus a count of organic_posts. Replaces the client-side grouping the OrganicIntel frontend used in Phase 3a.';
