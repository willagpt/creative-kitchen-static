-- Migration: create_list_fetch_runs_summary_rpc
-- Phase 3c observability. Aggregates organic_fetch_log into daily per-platform rows
-- for the Organic Intel tab header strip.
--
-- Signature:
--   list_fetch_runs_summary(p_since timestamptz default now() - interval '30 days')
-- Returns one row per (day, platform) with run counts, status breakdown, and
-- totals for posts_fetched, posts_new, cost_estimate (USD), yt_quota_units.

create or replace function public.list_fetch_runs_summary(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  day date,
  platform text,
  runs bigint,
  successes bigint,
  errors bigint,
  partial_count bigint,
  running_count bigint,
  posts_fetched bigint,
  posts_new bigint,
  cost_estimate numeric,
  yt_quota_units bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (started_at at time zone 'utc')::date                                       as day,
    platform,
    count(*)::bigint                                                            as runs,
    count(*) filter (where status = 'success')::bigint                          as successes,
    count(*) filter (where status = 'error')::bigint                            as errors,
    count(*) filter (where status = 'partial')::bigint                          as partial_count,
    count(*) filter (where status = 'running')::bigint                          as running_count,
    coalesce(sum(posts_fetched), 0)::bigint                                     as posts_fetched,
    coalesce(sum(posts_new), 0)::bigint                                         as posts_new,
    coalesce(sum(cost_estimate), 0)::numeric                                    as cost_estimate,
    coalesce(sum(yt_quota_units), 0)::bigint                                    as yt_quota_units
  from public.organic_fetch_log
  where started_at >= p_since
  group by day, platform
  order by day desc, platform asc;
$$;

grant execute on function public.list_fetch_runs_summary(timestamptz) to anon, authenticated, service_role;

comment on function public.list_fetch_runs_summary(timestamptz) is
  'Phase 3c Organic Intel: daily per-platform rollup of organic_fetch_log for the UI observability strip. One row per (day, platform) with run counts, status breakdown, and totals for posts_fetched, posts_new, cost_estimate, yt_quota_units.';
