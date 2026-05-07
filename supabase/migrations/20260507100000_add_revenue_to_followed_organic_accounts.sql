-- Migration: add_revenue_to_followed_organic_accounts
-- Adds annual revenue + currency fields to followed_organic_accounts so the Cadence
-- dashboard can compute "posts per 1m revenue" benchmarks against competitors.
--
-- Replaces list_organic_accounts_with_stats() with a version that returns the
-- two new columns. Behaviour is otherwise identical to the 20260417100000 version.

alter table public.followed_organic_accounts
  add column if not exists annual_revenue_estimate numeric,
  add column if not exists revenue_currency text not null default 'GBP';

comment on column public.followed_organic_accounts.annual_revenue_estimate is
  'Manually entered estimate of competitor annual revenue. Used by the Cadence dashboard to compute posts-per-revenue benchmarks. Nullable, in revenue_currency.';
comment on column public.followed_organic_accounts.revenue_currency is
  'ISO 4217 currency code for annual_revenue_estimate. Defaults to GBP.';

drop function if exists public.list_organic_accounts_with_stats(text, boolean);

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
  annual_revenue_estimate numeric,
  revenue_currency text,
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
    a.annual_revenue_estimate,
    a.revenue_currency,
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
  'Cadence v1: returns each followed_organic_accounts row + latest organic_fetch_log + post count + annual_revenue_estimate / revenue_currency for the Cadence dashboard.';
