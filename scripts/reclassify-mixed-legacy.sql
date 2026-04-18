-- reclassify-mixed-legacy.sql
-- Audit and coordination script for the Mixed → Named Format Combos migration.
-- See docs/mixed-format-migration-2026-04-18.md.
--
-- Run against project ifrxylvoufncdxyltgqt.
-- This script does NOT mutate data. The actual re-analysis is performed by
-- calling the ai-analyse-video edge function (v3+) for each matching id.

-- =====================================================================
-- 1. List all legacy rows still tagged as "mixed".
-- =====================================================================
select
  id,
  competitor_ad_id,
  source,
  source_id,
  status,
  created_at,
  ai_analysis->'production_style'->>'format' as legacy_format,
  ai_analysis->'production_style'->>'primary_format' as new_primary_format,
  ai_analysis->'production_style'->>'format_label' as new_format_label
from video_analyses
where status = 'complete'
  and ai_analysis->'production_style'->>'format' = 'mixed'
order by created_at asc;

-- =====================================================================
-- 2. Count of rows remaining to re-analyse.
-- =====================================================================
select
  count(*) filter (
    where ai_analysis->'production_style'->>'format' = 'mixed'
      and (ai_analysis->'production_style'->>'primary_format') is null
  ) as still_mixed_no_new_fields,
  count(*) filter (
    where ai_analysis->'production_style'->>'primary_format' is not null
  ) as already_migrated
from video_analyses
where status = 'complete';

-- =====================================================================
-- 3. Distribution of primary_format across all migrated rows.
--    Use this after re-running to confirm the taxonomy is healthy
--    (no single bucket >60%, no legacy 'mixed' leaking through).
-- =====================================================================
select
  ai_analysis->'production_style'->>'primary_format' as primary_format,
  ai_analysis->'production_style'->>'secondary_format' as secondary_format,
  ai_analysis->'production_style'->>'format_label' as format_label,
  count(*) as n
from video_analyses
where status = 'complete'
  and ai_analysis->'production_style'->>'primary_format' is not null
group by 1, 2, 3
order by n desc;

-- =====================================================================
-- 4. Sanity check: any row where format_label contradicts primary/secondary?
--    Expect zero rows after the normaliser guard in v3.
-- =====================================================================
select
  id,
  ai_analysis->'production_style'->>'primary_format' as primary_format,
  ai_analysis->'production_style'->>'secondary_format' as secondary_format,
  ai_analysis->'production_style'->>'format_label' as format_label
from video_analyses
where status = 'complete'
  and ai_analysis->'production_style'->>'primary_format' is not null
  and ai_analysis->'production_style'->>'format_label' is null;
