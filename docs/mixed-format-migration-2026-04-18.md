# Mixed → Named Format Combos Migration (18 April 2026)

## Problem

The Creative Strategy Playbook showed 20 of 72 competitor video analyses (28%) tagged as `production_style.format = "mixed"`. "Mixed" is unactionable: it tells the viewer that more than one style is in play but not which styles, which dominates, or how runtime splits. When a playbook lands on the CMO's desk, "Mixed" reads as "the model gave up".

Root cause: `supabase/functions/ai-analyse-video/index.ts` v2 defined `production_style.format` as a single enum whose allowed values included `mixed` as a terminal bucket. Claude picked it whenever it saw two co-equal styles.

## Solution

Replace the single `format` field on `production_style` with four fields, all additive on the `ai_analysis` JSONB column so downstream readers can migrate at their own pace:

- `primary_format` — the dominant format by runtime. Must come from the canonical vocab: `ugc | talking-head | studio | lifestyle | animation | b-roll-heavy | screen-recording`. No `mixed` fallback.
- `secondary_format` — the second-most-common format, only if it takes 20% or more of runtime and is distinct from primary. Otherwise `null`. Same vocab as primary.
- `format_label` — human-readable combo, e.g. `"UGC"`, `"UGC + Talking Head"`, `"Studio + B-Roll Heavy"`. Used in tables and charts instead of raw enum values.
- `format_rationale` — one-sentence (≤180 chars) description of how runtime splits between the two formats, e.g. `"UGC selfie opens and closes the ad (~60%) while talking-head studio shots deliver the product claim in the middle third (~40%)."`

The legacy `format` key is preserved in the JSONB for any reader that still expects it — edge function normalisation mirrors `format_label` into `format` on write, so pre-migration callers keep working.

## Scope of change

- `supabase/functions/ai-analyse-video/index.ts` → v3. Prompt rewrite, `normaliseProductionStyle()` guard, `x-function-version: ai-analyse-video@3` response header.
- `src/lib/shareableExport.js` → renderProductionStyle now reads `format_label || format` and renders `format_rationale` as italic prose under the metric table.
- `src/components/VideoAnalysis.jsx` → AnalysisTab Production Style section reads `format_label || format`, renders rationale below the style grid, and accepts both legacy (`overlays` / `music`) and new (`text_overlays` / `music_pacing`) keys.
- `scripts/reclassify-mixed-legacy.sql` → audit query for the 20 legacy rows that need re-analysing.

No database migrations. `ai_analysis` is JSONB and the schema is untouched.

## Re-run the legacy rows

Twenty analyses were written with `format = "mixed"` under the v2 prompt (audited 18 Apr 2026):

- 18 competitor_ad sources
- 2 organic_post sources

These must be re-run through `ai-analyse-video` after v3 ships so their `production_style` gets the new fields. Expected cost: ~$0.40 to $0.60 across all 20 rows. Expected wall time: ~5 minutes sequential (the edge function is single-threaded per invocation).

The re-run pattern is:

```sql
-- 1. List the rows to re-process
select id from video_analyses
where status = 'complete'
  and ai_analysis->'production_style'->>'format' = 'mixed';

-- 2. For each id, call ai-analyse-video with analysis_id = that id.
--    (done via loop in the session runner, not from SQL)
```

After the re-run, confirm no rows remain:

```sql
select count(*) from video_analyses
where status = 'complete'
  and ai_analysis->'production_style'->>'format' = 'mixed'
  and ai_analysis->'production_style'->>'primary_format' is null;
-- expect 0
```

## Backwards-compat contract

Readers of `ai_analysis.production_style` should, in order of preference:

1. Display `format_label` if present (v3 and later).
2. Fall back to `format` (pre-v3 rows, or v3 rows where normalisation mirrored label into format).
3. Never display the literal string `"mixed"` to users. If that string is the only value, the row is stale and should be re-analysed.

For grouping / charting / filtering, use `primary_format` as the axis. Pre-v3 rows will have this field absent and should be grouped under "Unclassified" until re-analysed.

## Why not a true schema migration

`production_style` lives inside JSONB. Adding a column would not help — downstream code already reads sub-keys. The cheapest, safest change is to add new keys alongside the old one and let consumers migrate at their own pace. Legacy rows are a one-off cleanup, not an ongoing reconciliation problem.

## Related

- Asana ticket: 1214120254371872
- Feature branch: `feature/production-style-format-combos`
- CLAUDE.md will be bumped to note `ai-analyse-video` v3 once the PR lands on main.
