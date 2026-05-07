-- Migration: organic_format_performance_rpc
-- Aggregates video_analyses (organic_post sources) joined to the latest
-- organic_post_metrics snapshot per post into per-content_pattern stats.
-- Drives the FormatPerformance dashboard.
--
-- Cross-account default: pass NULL for p_account_id.
-- Per-account: pass an account UUID to filter.

drop function if exists public.list_organic_format_performance(uuid);

create or replace function public.list_organic_format_performance(
  p_account_id uuid default null
)
returns table (
  content_pattern text,
  pattern_label text,
  sample_size bigint,
  total_views bigint,
  total_likes bigint,
  total_comments bigint,
  total_saves bigint,
  median_views numeric,
  p75_views numeric,
  median_engagement_rate numeric,
  p75_engagement_rate numeric,
  median_saves numeric,
  p75_saves numeric,
  example_post_ids uuid[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with latest_metrics as (
    select distinct on (post_id)
      post_id, captured_at, views, likes, comments, saves, shares
    from organic_post_metrics
    order by post_id, captured_at desc
  ),
  joined as (
    select
      coalesce(va.ai_analysis->>'content_pattern', 'other') as content_pattern,
      coalesce(va.ai_analysis->>'content_pattern_label',
               initcap(replace(coalesce(va.ai_analysis->>'content_pattern','other'), '-', ' '))) as pattern_label,
      op.id as post_id,
      op.account_id,
      coalesce(lm.views, 0) as views,
      coalesce(lm.likes, 0) as likes,
      coalesce(lm.comments, 0) as comments,
      coalesce(lm.saves, 0) as saves,
      coalesce(lm.shares, 0) as shares,
      case
        when coalesce(lm.views, 0) > 0
          then (coalesce(lm.likes,0) + coalesce(lm.comments,0)
                + coalesce(lm.saves,0) + coalesce(lm.shares,0))::numeric
               / lm.views
        else null
      end as engagement_rate
    from video_analyses va
    join organic_posts op on op.id = (va.source_id)::uuid
    left join latest_metrics lm on lm.post_id = op.id
    where va.source = 'organic_post'
      and va.ai_analysis is not null
      and va.ai_analysis->>'content_pattern' is not null
      and (p_account_id is null or op.account_id = p_account_id)
  )
  select
    j.content_pattern,
    (array_agg(j.pattern_label order by j.pattern_label))[1] as pattern_label,
    count(*)::bigint as sample_size,
    sum(j.views)::bigint as total_views,
    sum(j.likes)::bigint as total_likes,
    sum(j.comments)::bigint as total_comments,
    sum(j.saves)::bigint as total_saves,
    percentile_cont(0.5) within group (order by j.views) as median_views,
    percentile_cont(0.75) within group (order by j.views) as p75_views,
    percentile_cont(0.5) within group (order by j.engagement_rate)
      filter (where j.engagement_rate is not null) as median_engagement_rate,
    percentile_cont(0.75) within group (order by j.engagement_rate)
      filter (where j.engagement_rate is not null) as p75_engagement_rate,
    percentile_cont(0.5) within group (order by j.saves) as median_saves,
    percentile_cont(0.75) within group (order by j.saves) as p75_saves,
    (array_agg(j.post_id order by j.views desc))[1:5] as example_post_ids
  from joined j
  group by j.content_pattern
  order by sample_size desc, median_views desc;
$$;

grant execute on function public.list_organic_format_performance(uuid) to anon, authenticated, service_role;

comment on function public.list_organic_format_performance(uuid) is
  'Format Performance v1: per-content_pattern aggregate of latest organic_post_metrics. Cross-account default; pass account_id to filter to one account.';
