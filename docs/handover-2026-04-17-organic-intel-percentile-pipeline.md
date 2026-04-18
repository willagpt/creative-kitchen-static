# Handover — Organic Intel percentile visibility + full pipeline on Analyse (17 Apr 2026)

## User-reported problems

> Okay, so one thing I noticed on the organic is that you can select the top
> percentile, but it doesn't sort by the top percentile. It doesn't filter by
> the top percentile, so you can't actually see which ones they are, and then
> you press Analyse. It goes through them and nothing happens. What are the
> steps supposed to be after you've pressed Analyse? I want to break it down
> and look for trends, but it's just not happening, and everything in the
> trends report is dead.

Three concrete issues:

1. Top 2.5 / 5 / 10 / 20 % pills set `selectedIds` but the grid kept rendering
   all 50 posts chronologically, so the user had no visual confirmation of the
   slice that was picked.
2. Clicking Analyse fired `analyse-video` (Phase 1 only, shots + contact sheet
   via Railway) and stopped. No transcript, no OCR, no AI analysis. User saw
   "nothing happens" because all the visible surfaces (UGC briefs, trend
   reports) depend on Phase 2 and 3.
3. Trend Reports kept erroring with "found 1, need >= 3" because there was
   only one complete `organic_post` analysis in the corpus, and even that one
   had NULL transcript / OCR / `ai_analysis`.

## What shipped (direct push to main: `4dd01b5`)

### `src/components/OrganicIntel.jsx`

1. New state `onlySelected` (boolean). Default `false`.
2. `selectTopPercentile(pct)` now flips `onlySelected = true` after picking
   the slice, so the grid immediately shows exactly the selected posts.
3. `clearSelection()` resets `onlySelected = false` along with `selectedIds`
   and `percentile`.
4. New `displayPosts` useMemo:
   - If `onlySelected && selectedIds.size > 0`, filter `posts` to the selected
     ids.
   - If `percentile` is active, sort by latest views desc.
5. Render loop switched from `{posts.map(...)}` to `{displayPosts.map(...)}`.
6. New "Only selected" / "Show all" toggle button in the bulk bar
   (`oi-bulk-btn-ghost` with `oi-bulk-btn-active` when engaged). Disabled
   when selection is empty.
7. New `runPipelineSteps(analysisId)` function (mirrors
   `CompetitorAds.jsx`'s pattern):
   - Serial run of `transcribe-video` -> `ocr-video-frames` ->
     `merge-video-script` -> `ai-analyse-video`.
   - 2 client-side retries on `transcribe-video` and `ocr-video-frames`
     (retryable = 429 or 5xx), 2s delay.
   - No retries on `merge-video-script` or `ai-analyse-video`; they're quick
     and idempotent and their retriable failure modes are already handled
     server-side.
   - Logs `transcript_status`, `ocr_status`, coverage, batch_errors from
     the success payload so console output is useful during bulk runs.
8. `analyseOne(post)` now extracts `analysis_id` from 2xx or 409 body and
   calls `runPipelineSteps` wrapped in try/catch. One post's pipeline failure
   doesn't abort the bulk run.

### `src/components/OrganicIntel.css`

- New `.oi-bulk-btn-active` rule (accent bg + cream text + brightness hover)
  for the "Only selected" toggle.

## Backfill of 8 pre-existing stale organic analyses

Before the UI fix, 8 `organic_post` analyses existed with `status=complete`
but NULL `transcript_text`, `ocr_text`, `combined_script`, `ai_analysis`,
`layout_summary`. Ran the full pipeline for each via direct curl:

| analysis_id                           | shots | duration |
|---------------------------------------|-------|----------|
| ef84177c-fa88-4b17-87b8-a81eeec30ead  | 15    | 31.6s    |
| a8a55a73-f557-4064-9372-faeb879395e2  | 40    | 62.9s    |
| a3200989-8050-4e34-8649-6a4eb010782e  | 41    | 50.7s    |
| 7e0dfc4a-0c83-4570-bd7d-8d5515042495  | 27    | 53.2s    |
| bcfe2521-61bc-4513-af3e-e5bbeceeb2b4  | 19    | 29.1s    |
| 2c41ee61-e932-4621-82dd-985502d68797  | 23    | 36.8s    |
| e1ccf3f5-1140-43ef-ba31-f16655e20e16  | 23    | 51.8s    |
| 5b0cb8c6-fb5c-4ff1-bbaa-f0ae9023e606  | 19    | 31.2s    |

Final state of all 8: `transcript_status=success`, `ocr_status=success`,
`combined_script IS NOT NULL`, `ai_analysis IS NOT NULL`,
`layout_summary IS NOT NULL`.

## Trend Report proof of life

Regenerated `a0a1d29f-a744-4899-ba1a-22ecf7507044`
(`title: Trend report . 2026-04-17 . organic_post`).

- `status=complete`, `source_count=8`
- `model=claude-sonnet-4-5-20250929`
- `summary` has all 11 sections populated: `overview`, `recurring_hooks`,
  `shot_length_stats`, `layout_mix`, `recurring_phrases`, `audio_reuse`,
  `ctas`, `themes`, `production_notes`, `copy_ideas`, `actionable_ideas`.
- Overview preview: single-brand Calo UK Anjula Devi chef collaboration
  corpus; Claude correctly picked up the chef-heritage narrative thread
  across all 8 videos.

## Verification

- Local syntax check via esbuild jsx loader: zero errors, 36.2kb bundle.
- Full `npm run build` attempted but hit `ENOSPC` on the session volume
  (9.8G 100% used). Rootfs has 1.3G free but swapped to esbuild for the
  syntax check. Vercel CI builds the real artifact.

## Deploy

Production deploy: `dpl_2nFFm9PNMgq7DTV46FjuM2hGaPzk` READY,
commit `4dd01b533be3ec7bd789f90d313a02e671dd1195` on `main`.

## What to test

1. Open Organic Intel, pick any account with posts.
2. Click "Top 5%". Grid should immediately filter to the slice and sort
   views desc with the #1 performer at the top.
3. Click "Show all" - grid should go back to full chronological list (with
   checkboxes still set).
4. Click "Only selected" - grid should filter back down.
5. Click "Analyse N selected" - watch the console for per-post
   `[organic pipeline] transcribe-video ok...`,
   `[organic pipeline] ocr-video-frames ok...`, etc. logs. After a
   few minutes the analysed chip should appear on each card, and
   kicking off a Trend Report against `source=organic_post` should
   succeed with a real summary.

## Remaining work (not this PR)

- OrganicIntel needs a per-post status chip that surfaces
  `transcript_status` / `ocr_status` live (currently only surfaces
  the Phase 1 "analysed" state from `video_analyses.status`). When
  transcribe returns `partial` or `error`, user has to inspect the
  console today. Low priority.
- Backfill script should live in repo (under
  `scripts/backfill-organic-pipeline.ts` or similar) for future
  recoveries. Today it's a one-shot curl sequence.
