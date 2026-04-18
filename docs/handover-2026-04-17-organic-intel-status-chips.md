# Organic Intel — per-post pipeline status chips + backfill script (17 Apr 2026)

## Context

The 4dd01b5 fix (handover: `handover-2026-04-17-organic-intel-percentile-pipeline.md`) closed out the three user-reported problems on the Organic Intel tab:

1. Percentile pills now visibly sort/filter the grid.
2. Clicking Analyse now drives the full 4-step Phase 2+3 pipeline (transcribe → OCR → merge → ai-analyse), not just Phase 1.
3. Trend Reports now produces a real synthesis because the 8 stale `organic_post` analyses were backfilled end-to-end.

That handover flagged two low-priority follow-ups. Both are now shipped as PR #37.

## What shipped

### 1. Per-post pipeline status chips

`src/components/OrganicIntel.jsx`:

- The `video_analyses` PostgREST select inside `refreshAnalysesForPosts` now pulls `transcript_status`, `ocr_status`, and `ai_analysis` alongside the existing `id`, `source_id`, `status`.
- New `PipelineStatusChip` helper renders a single chip with a prefix (`TX` or `OCR`) and the current status using the `.oi-chip-status` colour tokens (`success` = green, `partial` = amber, `error` = red, `running` = blue, `pending` = grey).
- `PostCard` gains three chips on the thumb badge row when `alreadyAnalysed`:
  - `TX ok/partial/error/running/pending` (transcribe-video observability)
  - `OCR ok/partial/error/running/pending` (ocr-video-frames observability)
  - `AI` (shown when `video_analyses.ai_analysis` is non-null; blue pill)
- Chips sit next to the existing `Analysed` chip and the post type + duration badges.

`src/components/OrganicIntel.css`:

- `.oi-thumb-badges` gains `flex-wrap: wrap`, `row-gap: 4px`, `align-items: flex-start` so four chips fit at narrow viewport widths instead of overflowing.
- New `.oi-chip-ai` class (blue background + refine colour, semibold, slight letter-spacing).

### 2. `scripts/backfill-organic-pipeline.mjs`

Standalone Node 18+ script (no extra deps, plain ESM JS) that replicates the curl sequence we ran on 17 Apr to heal the 8 stale organic_post analyses.

- Same retry policy as the frontend `runPipelineSteps()`: 2 retries on 429 / 5xx for transcribe-video and ocr-video-frames (2 s delay), no retry for merge-video-script or ai-analyse-video.
- Idempotent: every edge function dedups against its own status column, so re-running the script on already-complete rows is a no-op.
- Flags:
  - `--source=<competitor_ad|organic_post>` (default `organic_post`)
  - `--limit=<N>` (default 50)
  - `--dry-run` (print plan only)
  - `--analysis-id=<uuid>` (target a single row; overrides source/limit)
  - `--concurrency=<N>` (default 1; raise carefully, each step hits Railway or Claude)
- Uses PostgREST to find candidates: `source = <source>` AND `status = complete` AND any of `transcript_status IS NULL | pending`, `ocr_status IS NULL | pending`, or `ai_analysis IS NULL`.
- Logs observability fields on each step's response (`transcript_status`, `ocr_status`, coverage, shots_updated, batch_errors).

### Why `.mjs`, not `.ts`

The prior handover suggested `.ts`, but the repo has no TypeScript tooling configured (`package.json` ships plain React/Vite with no `typescript` dep). `.mjs` runs on Node 18+ with zero setup. If TypeScript is added project-wide later, renaming + adding types is a small follow-up.

## Verification

- `esbuild --loader:.jsx=jsx src/components/OrganicIntel.jsx` → 38,174 bytes, zero errors.
- `esbuild src/components/OrganicIntel.css` → 15,570 bytes, zero errors.
- `node --check scripts/backfill-organic-pipeline.mjs` passes.
- PR #37 merged (squash) as commit `345e782` on `main`.
- GitHub CI `Build` check: success.
- Vercel production deploy `22YDHSsDnM6FQ21erFyenAX5Afkf` READY.
- Live bundle `/assets/index-Cwrgr5Sw.js` contains `PipelineStatusChip`, `transcript_status`, `ocr_status`, and `oi-chip-ai` — confirming the code shipped to production.

## How to exercise it

**Chips (no action needed):**

1. Open https://creative-kitchen-static.vercel.app → Organic Intel → any analysed account (e.g. calo.uk).
2. Any post that already has a complete analysis will show the four chips on the thumbnail.
3. If you find a partial/error state, the chip colour telegraphs it at a glance without opening the DB.

**Backfill (only if future stale rows appear):**

```bash
SUPABASE_URL=https://ifrxylvoufncdxyltgqt.supabase.co \
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... \
node scripts/backfill-organic-pipeline.mjs --source=organic_post --limit=20 --dry-run
```

Drop the `--dry-run` flag to actually run. Expect "No rows need backfilling" today because the 17 Apr heal-up already covered all 8 stale rows.

## Remaining backlog

None from this thread. Broader backlog lives in the Asana engineering project + CLAUDE.md `Next:` bullet:

- Monitor cron runs (IG 02:15 UTC / YT 06:30 UTC tomorrow) via the Organic Intel Last-7-days strip + `organic_fetch_log`.
- Rotate Apify + YouTube API keys (leaked earlier in session).
- Close Asana `1214111637586477` (OCR) + `1214111637546592` (generate-ugc-brief v7).
- Hard-delete `debug-auth` on/after 23 Apr.
- Stale duplicate `src/CompetitorAds.jsx` Phase 3 cleanup.
- Low-priority: mirror YT thumbnails on ingest in `fetch-youtube-posts` for parity.
