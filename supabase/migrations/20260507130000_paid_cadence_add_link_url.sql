-- Migration: paid_cadence_add_link_url
-- Adds most_common_link_url to list_paid_cadence_stats() so the Paid Cadence
-- dashboard can show each brand's top destination URL alongside a Meta Ad
-- Library deep link. Drives parent-brand attribution UX (creators rolled up
-- to the page_id holder).

drop function if exists public.list_paid_cadence_stats();

create or replace function public.list_paid_cadence_stats()
returns table (
  page_name text,
  page_id text,
  meta_id uuid,
  brand_name_display text,
  annual_revenue_estimate numeric,
  revenue_currency text,
  niche text,
  cpm_override numeric,
  total_ads bigint,
  total_tests bigint,
  active_ads bigint,
  active_tests bigint,
  tests_7d bigint,
  tests_30d bigint,
  tests_prev_30d bigint,
  tests_90d bigint,
  ads_dead_90d bigint,
  ads_total_90d bigint,
  median_days_active numeric,
  image_count_90d bigint,
  video_count_90d bigint,
  dco_count_90d bigint,
  carousel_count_90d bigint,
  other_count_90d bigint,
  impressions_lower_active bigint,
  impressions_upper_active bigint,
  latest_start_date timestamptz,
  earliest_start_date timestamptz,
  most_common_link_url text
)
language sql
stable
security invoker
set search_path = public
as $$
  with brand_grouped as (
    select
      lower(coalesce(page_name, '')) as page_name_key,
      page_name,
      page_id,
      is_active,
      start_date,
      days_active,
      display_format,
      card_index,
      impressions_lower,
      impressions_upper,
      link_url
    from competitor_ads
    where page_name is not null and page_name <> ''
  ),
  brand_pick as (
    select distinct on (page_name_key)
      page_name_key,
      page_name,
      page_id
    from brand_grouped
    order by page_name_key, page_id nulls last
  ),
  agg as (
    select
      page_name_key,
      count(*) as total_ads,
      count(*) filter (where card_index is null or card_index = 0) as total_tests,
      count(*) filter (where is_active = true) as active_ads,
      count(*) filter (where is_active = true and (card_index is null or card_index = 0)) as active_tests,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '7 days') as tests_7d,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '30 days') as tests_30d,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '60 days' and start_date < now() - interval '30 days') as tests_prev_30d,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '90 days') as tests_90d,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '90 days' and is_active = false) as ads_dead_90d,
      count(*) filter (where (card_index is null or card_index = 0) and start_date >= now() - interval '90 days') as ads_total_90d,
      percentile_cont(0.5) within group (order by days_active)
        filter (where is_active = true and days_active is not null) as median_days_active,
      count(*) filter (where start_date >= now() - interval '90 days' and display_format = 'IMAGE') as image_count_90d,
      count(*) filter (where start_date >= now() - interval '90 days' and display_format = 'VIDEO') as video_count_90d,
      count(*) filter (where start_date >= now() - interval '90 days' and display_format = 'DCO') as dco_count_90d,
      count(*) filter (where start_date >= now() - interval '90 days' and display_format = 'CAROUSEL') as carousel_count_90d,
      count(*) filter (where start_date >= now() - interval '90 days' and display_format not in ('IMAGE','VIDEO','DCO','CAROUSEL')) as other_count_90d,
      coalesce(sum(impressions_lower) filter (where is_active = true), 0) as impressions_lower_active,
      coalesce(sum(impressions_upper) filter (where is_active = true), 0) as impressions_upper_active,
      max(start_date) as latest_start_date,
      min(start_date) as earliest_start_date,
      mode() within group (order by link_url) filter (where link_url is not null and link_url <> '') as most_common_link_url
    from brand_grouped
    group by page_name_key
  )
  select
    bp.page_name,
    bp.page_id,
    pbm.id as meta_id,
    coalesce(pbm.page_name_display, bp.page_name) as brand_name_display,
    pbm.annual_revenue_estimate,
    coalesce(pbm.revenue_currency, 'GBP') as revenue_currency,
    pbm.niche,
    pbm.cpm_override,
    a.total_ads,
    a.total_tests,
    a.active_ads,
    a.active_tests,
    a.tests_7d,
    a.tests_30d,
    a.tests_prev_30d,
    a.tests_90d,
    a.ads_dead_90d,
    a.ads_total_90d,
    a.median_days_active,
    a.image_count_90d,
    a.video_count_90d,
    a.dco_count_90d,
    a.carousel_count_90d,
    a.other_count_90d,
    a.impressions_lower_active,
    a.impressions_upper_active,
    a.latest_start_date,
    a.earliest_start_date,
    a.most_common_link_url
  from brand_pick bp
  join agg a on a.page_name_key = bp.page_name_key
  left join paid_brand_meta pbm on pbm.page_name_key = bp.page_name_key
  order by a.tests_30d desc, a.total_ads desc;
$$;

grant execute on function public.list_paid_cadence_stats() to anon, authenticated, service_role;
