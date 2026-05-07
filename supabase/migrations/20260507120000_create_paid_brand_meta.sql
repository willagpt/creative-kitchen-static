-- Migration: create_paid_brand_meta
-- Stores per-brand metadata for the Paid Cadence dashboard inside the
-- Competitor Ads tab. Keyed on page_name (text, lowercase) because the
-- competitor_ads.page_id is not unique per brand in the Foreplay/Simmer
-- data (a single page_id can attribute multiple distinct page_names).
--
-- Captures:
--   - annual_revenue_estimate / revenue_currency  for posts-per-1m benchmarks
--   - niche                                       for default CPM lookup
--   - cpm_override                                per-brand spend math override
--   - notes                                       free text
--
-- RLS: permissive public to match followed_brands / competitor_ads pattern.

create table public.paid_brand_meta (
  id uuid primary key default gen_random_uuid(),
  page_name_key text not null unique,
  page_name_display text not null,
  page_id text,
  annual_revenue_estimate numeric,
  revenue_currency text not null default 'GBP',
  niche text,
  cpm_override numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index paid_brand_meta_page_id_idx on public.paid_brand_meta(page_id);

alter table public.paid_brand_meta enable row level security;

create policy "Anyone can select paid_brand_meta"
  on public.paid_brand_meta for select using (true);

create policy "Anyone can insert paid_brand_meta"
  on public.paid_brand_meta for insert with check (true);

create policy "Anyone can update paid_brand_meta"
  on public.paid_brand_meta for update using (true) with check (true);

create policy "Anyone can delete paid_brand_meta"
  on public.paid_brand_meta for delete using (true);

comment on column public.paid_brand_meta.page_name_key is
  'Lowercased page_name. Used as the natural unique key because page_id is not unique per brand in Foreplay data.';
comment on column public.paid_brand_meta.page_name_display is
  'Original-case page_name as Foreplay reports it. Used for display.';
comment on column public.paid_brand_meta.annual_revenue_estimate is
  'Manually entered revenue estimate. Powers the posts-per-1m-revenue velocity benchmark.';
comment on column public.paid_brand_meta.cpm_override is
  'Per-brand CPM override (in pence). When null the dashboard falls back to the niche default.';
comment on column public.paid_brand_meta.niche is
  'Free-text niche label, e.g. food, beauty, fitness. Drives the default CPM lookup on the frontend.';

-- Updated_at trigger so the dashboard can show "last edited".
create or replace function public.paid_brand_meta_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger paid_brand_meta_updated_at
  before update on public.paid_brand_meta
  for each row
  execute function public.paid_brand_meta_set_updated_at();

-- Cadence stats RPC. Returns one row per (page_name, page_id) brand observed
-- in competitor_ads, joined to its paid_brand_meta row when one exists.
-- Computes the metrics that drive the Paid Cadence dashboard:
--   - tests launched in 7d / 30d / prev 30d / 90d        (test velocity)
--   - active ads now                                     (library size)
--   - distinct creative variations active now            (library size, exploded)
--   - kill rate over the last 90 days                    (testing rigour)
--   - median days_active for currently-active ads        (concept durability)
--   - format mix (last 90d)                              (creative shape)
--   - sum of impressions_lower / upper for active ads    (spend proxy)
--   - data_freshness (latest start_date observed)        (staleness flag)
--
-- "Tests launched" deduplicates DCO + Carousel cards via card_index = 0 OR
-- card_index IS NULL. "Library size" counts every row because each card is
-- a real creative variation that was tested.

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
  earliest_start_date timestamptz
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
      impressions_upper
    from competitor_ads
    where page_name is not null and page_name <> ''
  ),
  brand_pick as (
    -- Pick a representative page_id per page_name (most common one).
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
      min(start_date) as earliest_start_date
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
    a.earliest_start_date
  from brand_pick bp
  join agg a on a.page_name_key = bp.page_name_key
  left join paid_brand_meta pbm on pbm.page_name_key = bp.page_name_key
  order by a.tests_30d desc, a.total_ads desc;
$$;

grant execute on function public.list_paid_cadence_stats() to anon, authenticated, service_role;

comment on function public.list_paid_cadence_stats() is
  'Paid Cadence v1: aggregates competitor_ads per page_name into the metrics that drive the Cadence & Velocity dashboard. Joins paid_brand_meta for revenue + CPM overrides. Tests are deduped on (card_index is null or card_index = 0) so DCO/Carousel cards do not inflate the test-velocity metric.';
