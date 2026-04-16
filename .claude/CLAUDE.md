# Creative Kitchen Static

AI-powered static ad image generator for Willa Ltd, branded as "Big Tasty Productions". Generates marketing images from brand DNA analysis, with AI prompt iteration and a review/rating system. Part of the Marketing suite in Willa HQ.

This repo is also the home of the Video Analysis Engine (Railway worker + Supabase edge function pipeline) and the in-flight Organic Intelligence feature (IG + YouTube organic post monitoring). The broader engineering backlog lives in the Asana project linked at the bottom of this file.

## Tech Stack

- **Framework:** Vite + React
- **Database:** Supabase project `ifrxylvoufncdxyltgqt` (URL: `https://ifrxylvoufncdxyltgqt.supabase.co`)
- **Hosting:** Vercel (personal account: jameseatcheflycos-projects)
- **Video pipeline:** Railway (`creative-kitchen-static-production.up.railway.app`, project `triumphant-dedication`)
- **Fonts:** Plus Jakarta Sans, Syne, Instrument Serif (Google Fonts)
- **Repo:** github.com/willagpt/creative-kitchen-static

## Live URL

https://creative-kitchen-static.vercel.app

## Architecture

Vite + React SPA with dark theme. Analyses brand DNA (colours, style, product info), generates AI image prompts across templates, creates images, and tracks reviews/ratings. Extended to ingest competitor ads from Foreplay, analyse competitor videos through a Railway worker, and (in progress) ingest organic posts from Instagram and YouTube.

### Supabase Tables

- `static_runs` — brand DNA generation runs (brand name, URL, product, DNA as JSONB)
- `static_images` — generated images (74+ images). Fields: template_id, template_name, category, prompt, image_url, version
- `static_reviews` — review ratings by claude or user. Ratings: great, good, needs-work, slop. 46+ reviews
- `static_prompt_versions` — prompt iteration history (32+ versions). Tracks template_id, version, prompt text, image_url, brand_dna_snapshot
- `brand_guidelines` — brand identity data. Fields: packaging_format, packaging_specs, colour_palette, typography, tone_of_voice, photo_descriptions
- `competitor_ads` — ~9,900 rows of enriched competitor ads (Simmer data: Jan 11 – Apr 9, 2026). Key fields: `thumbnail_url`, `snapshot_url`, `page_id`, `page_name`, `creative_title`, `creative_body`, `start_date`, `end_date`, `is_active`, `impressions_lower`, `impressions_upper`, `days_active`, `platforms`. **Apr 2026 columns:** `display_format` (IMAGE/VIDEO/DCO), `video_url`, `card_index`, `parent_ad_id`, `emotional_drivers`, `content_filter`, `creative_targeting`, `categories`, `persona`, `languages`, `market_target`, `niches`, `cta_type`, `link_url`. DCO ads are exploded into one row per card.
- `followed_brands` — brands being tracked for competitor ad monitoring. Simmer: `brand_id: n68cYDEnS6D6eU4T4bLS`, `page_id: 187701838409772`
- `foreplay_credit_log` — tracks Foreplay API credit usage per fetch call. Fields: `brand_id`, `page_id`, `credits_used`, `ads_fetched`, `credit_budget`, `start_date`, `stopped_reason`
- `video_analyses` — Primary record for video analysis. Fields: competitor_ad_id, run_id, video_url, duration_seconds, total_shots, total_cuts, avg_shot_duration, cuts_per_second, pacing_profile, transcript_text, ocr_text, combined_script, contact_sheet_url, ai_analysis (jsonb), layout_summary (jsonb, e.g. `{"full":6,"split-2":2,"split-3":0,"other":0}`), status, error_message
- `video_shots` — Individual shot records. Fields: video_analysis_id (FK), shot_number, start_time, end_time, duration, frame_url, ocr_text, description, screen_layout (text: `full` | `split-2` | `split-3` | `other`, nullable, CHECK constraint)
- `video_analysis_runs` — Batch analysis runs. Fields: brand_name, page_id, percentile (1/2/5/10/20), total_videos, analysed_count, status

**Planned (Organic Intelligence phase):** `followed_organic_accounts`, `organic_posts`, `organic_post_metrics`, `organic_fetch_log`. `video_analyses` will gain `organic_post_id` + `source_kind` columns with a CHECK constraint so the same pipeline serves ad and organic inputs. Specification lives under the Organic Intel milestones in the Asana project.

### Supabase Storage Buckets

- `reference-images` — existing, public
- `static-uploads` — existing, public
- `video-processing` — public, 100 MB limit. Stores extracted video frames, contact sheets, and audio files. MIME types: video/mp4, video/webm, image/jpeg, image/png, audio/mpeg, audio/mp3

### Workflow

1. Create a "run" with brand DNA (name, URL, product, extracted brand DNA)
2. Generate prompts across templates/categories
3. Create images from prompts
4. Review images (by AI or human) with ratings
5. Iterate on prompts based on feedback

## Key Commands

- **Dev:** `npm run dev` (Vite dev server)
- **Build:** `npm run build`
- **Deploy:** Push to `main` → Vercel auto-deploys production and `deploy-edge-functions.yml` redeploys any changed Supabase function.

## Branching and CI

See `docs/branching-and-ci.md` for the full flow. Quick summary:

- `main` → production (Vercel prod + edge function deploys)
- `develop` → integration (Vercel preview per push)
- `feature/<scope>` → off `develop`, PR into `develop`
- `hotfix/<scope>` → off `main`, PR into `main`, rebase `develop` after

CI workflow `ci.yml` runs `npm run build` on pushes and PRs to `main` and `develop`. Every PR must be green before merging. Edge-function deploys fire only from `main`. Branch protection rules are pending a user-side GitHub UI pass (tracked in Asana).

## Design System

- Dark theme (class="dark" on html element)
- Background: bg-bg-0
- Text: white
- Fonts: Inter (UI), JetBrains Mono (code/prompts)
- Antialiased rendering

## Current Status (16 April 2026)

- **Working:** Brand DNA extraction, prompt generation, image creation, review system, competitor ad viewer with inline video playback and Add Competitor button, Video Analysis Engine (Railway worker + 8 video edge functions), layout-aware UGC brief generation.
- **Phase 1 Complete:** Video Analysis Engine — Foundation (DB + pipeline + Railway worker + video edge functions). See `docs/video-analysis-project-spec.md`.
- **Phase 1 re-verification complete (16 Apr):** 24 deployed edge functions all have matching source in `supabase/functions/`. All 24 enforce `verify_jwt: true`. Both former JWT regressions (analyse-competitor-creatives, debug-auth) closed same day.
- **Next:** Phase 2 — Script Extraction (Whisper transcription + OCR), Phase 2 engineering (branching + CI), and Organic Intelligence (IG + YouTube ingestion).
- **Last deployed:** 16 April 2026.
- **generate-ad-prompt:** v29 (packaging-aware, dynamic packaging terms).
- **fetch-competitor-ads:** v12 (brand_id/page_id, DCO explosion, credit logging to `foreplay_credit_log`, default `start_date: 2025-12-23`, `credit_budget: 500`).
- **analyse-competitor-creatives:** v32 (JWT re-enabled 16 Apr).
- **debug-auth:** v6 (soft-retired 16 Apr, returns HTTP 410 Gone; hard-delete tracked in Asana).
- **ai-analyse-video:** v2 (layout detection via Claude vision).
- **generate-ugc-brief:** v6 (16384 max_tokens, shot variations 2/3/4, layout-aware prompts).
- **brand_guidelines table:** packaging_format, packaging_specs, colour_palette, typography, tone_of_voice, photo_descriptions columns live.
- **Foreplay API:** `public.api.foreplay.co`, key stored in edge function. 1 credit per ad. Simmer brand_id: `n68cYDEnS6D6eU4T4bLS`.
- **Supabase anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA`

## Edge Functions

**24 edge functions deployed.** All 24 enforce `verify_jwt: true` (verified via list_edge_functions on 16 Apr post-fix).

**Prompt / brand / image tooling:**

1. `generate-ad-prompt` — v29. Packaging-aware prompt engine with dynamic packaging terms.
2. `refine-prompt` — v6. Surgical prompt editing.
3. `templatize-prompt` — v7. Converts prompts into reusable templates.
4. `compare-prompts` — v5. Visual diff between two prompts.
5. `generate-variables` — v9. Meal-specific creative variables.
6. `extract-brand-guidelines` — v8. Parses brand docs into structured JSON.
7. `describe-photo` — v11. Photo library descriptions via Claude.
8. `generate-shot-sequence` — v5. Food photography shot sequence generator.

**Ad library / competitor analysis:**

9. `fetch-competitor-ads` — v12. Foreplay API ingestion with credit budgeting and DCO card explosion.
10. `seed-advertisers` — v4. Bootstrap advertiser seed data.
11. `extract-ad-thumbnails` — v9. Extracts images from ad HTML snapshots.
12. `analyse-competitor-creatives` — v32. Multi-step AI visual analysis pipeline. JWT re-enabled 16 Apr.
13. `vision-model-test` — v5. Standalone visual forensic analysis test.
14. `process-analysis-batch` — v24. Batch orchestrator for vision analysis.

**Video analysis pipeline:**

15. `analyse-video` — v4. Orchestrator; accepts competitor_ad_id, calls Railway worker, writes `video_analyses` + `video_shots`. Secrets: `VIDEO_WORKER_URL`, `VIDEO_WORKER_SECRET`.
16. `list-video-analyses` — v4. Query analyses with filters (status, run_id, competitor_ad_id) and pagination.
17. `get-video-analysis` — v4. Fetch single analysis with all shots + full competitor ad context.
18. `transcribe-video` — v2. Whisper transcription leg of the pipeline.
19. `ocr-video-frames` — v7. OCR extraction across reference frames.
20. `merge-video-script` — v1. Merges transcript + OCR into combined script.
21. `extract-video-script` — v2. Orchestrates transcribe → OCR → merge.
22. `ai-analyse-video` — v2. Layout detection via Claude vision; writes `screen_layout` per shot and `layout_summary` aggregate.
23. `generate-ugc-brief` — v6. Chefly-branded UGC creator briefs. 16384 max_tokens, truncation detection, shot variations (2/3/4), layout-aware prompts. Secrets: `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY`.

**Diagnostics:**

24. `debug-auth` — v6. **Soft-retired 16 Apr.** Returns HTTP 410 Gone with a retirement notice. Source stays in the repo until callers confirmed gone; then hard-deleted.

**Alignment:** Every deployed slug has a matching `supabase/functions/<slug>/index.ts` directory on `main` (verified 16 Apr). A previous CLAUDE.md revision listed `sync-competitor-metadata` as deployed; that entry was incorrect and has been removed.

## Video Worker (Railway Microservice)

Located at `video-worker/` in repo. Express + FFmpeg service for heavy video processing.

- **Endpoint:** `POST /process-video` — downloads video, detects shots via FFmpeg scene analysis, extracts reference frames, generates contact sheet, extracts audio.
- **Auth:** Bearer token via `WORKER_SECRET` env var.
- **Deployment:** Railway with Docker (Dockerfile in repo). Project: `triumphant-dedication`, URL: `https://creative-kitchen-static-production.up.railway.app`.
- **Env vars:** `WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PORT=3000`.
- **Status:** Deployed and verified end-to-end (13 Apr 2026). FFmpeg 5.1.8. Contact sheets tested on 17+ shot videos.
- **Test Videos:**
  - A: Simmer `3324195914449903` — 12.7s, 8 shots, 720x900
  - B: Huel `33860239276954284` — 21.4s, 17 shots, 720x1280
  - C: Frive `1440540640941645` — 31.4s, 17 shots, 720x1280

**Planned:** yt-dlp added to the worker image to support YouTube downloads for the Organic Intelligence phase.

## Development Rules

- **GitHub is the single source of truth.** If it's not in the repo, it doesn't exist.
- **Edge functions deploy FROM the repo.** Never deploy directly to Supabase from session code. Commit to GitHub first.
- **Every deployed slug must have a matching `supabase/functions/<slug>/index.ts`.** Re-verified 16 Apr; now 1:1.
- **verify_jwt: true is the default.** Never deploy a function with verify_jwt: false without an open ticket explaining why and a dated remediation plan.
- **No direct pushes to main.** Use `feature/<scope>` → PR to `develop` → PR to `main`. Hotfixes PR direct to `main`, then rebase `develop`. See `docs/branching-and-ci.md`.
- **Ticket-first for multi-file changes.** If a change touches more than one file, create an Asana ticket first in the engineering project (see Related Projects below).
- **Run the pre-session checklist** at `docs/pre-session-checklist.md` before writing any code.
- **Update this file** at the end of every session if architecture, tables, or edge functions changed.

## Known Issues

- Facebook snapshot URLs (`snapshot_url` in `competitor_ads`) may be blocked by Facebook's CSP when rendered in iframes, needs live verification. If blocked, consider server-side screenshotting as fallback.
- Local `src/` directory may be empty, code has been pushed directly to GitHub via MCP in previous sessions. Always check GitHub for the source of truth.
- Shares Supabase tables (static_*) that also appear in the creative-kitchen-video-v3 database.
- Foreplay API credits are limited (10,000 per period). Edge function has a `credit_budget` safeguard (default 500) and logs usage to `foreplay_credit_log`. Be careful with exploratory API calls.
- Foreplay Spyder only started tracking Simmer from ~Jan 11, 2026, no historical data before that date.
- Duplicate `CompetitorAds.jsx` exists in `src/` and `src/components/`. The `src/` copy is stale; Phase 3 cleanup.
- `debug-auth` is soft-retired (returns 410 Gone) as of 16 Apr. Hard-delete once caller logs confirm no traffic for 7 days, tracked in the Asana engineering project.

## Related Projects

- **creative-kitchen-video-v3** — sister project (video content), same Marketing department.
- **willa-hq** — loads this tool via iframe as "Static Assets" under Marketing.
- **Asana engineering project** — [project 1214024873723525](https://app.asana.com/1/5717506944667/project/1214024873723525/list/1214024873723542). Tracks stabilisation backlog, Video Analysis work, and Organic Intelligence milestones.

## Conventions

- Vite + React (not Next.js)
- Dark theme throughout
- Review ratings: great, good, needs-work, slop
- Reviewers: "claude" (AI) or "user" (human)
- Prompt versioning for iterative improvement
- Writing style: no em dashes or en dashes. Use commas, colons, full stops, or arrows (→). Write ranges as "2 to 3" not "2-3".
