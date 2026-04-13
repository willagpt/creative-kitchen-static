# Creative Kitchen Static

AI-powered static ad image generator for Willa Ltd, branded as "Big Tasty Productions". Generates marketing images from brand DNA analysis, with AI prompt iteration and a review/rating system. Part of the Marketing suite in Willa HQ.

## Tech Stack

- **Framework:** Vite + React
- **Database:** Supabase project `ifrxylvoufncdxyltgqt` (URL: `https://ifrxylvoufncdxyltgqt.supabase.co`)
- **Hosting:** Vercel (personal account: jameseatcheflycos-projects)
- **Fonts:** Plus Jakarta Sans, Syne, Instrument Serif (Google Fonts)
- **Repo:** github.com/willagpt/creative-kitchen-static

## Live URL

https://creative-kitchen-static.vercel.app

## Architecture

Vite + React SPA with dark theme. Analyses brand DNA (colours, style, product info), generates AI image prompts across templates, creates images, and tracks reviews/ratings.

### Supabase Tables

- `static_runs` — brand DNA generation runs (brand name, URL, product, DNA as JSONB)
- `static_images` — generated images (74+ images). Fields: template_id, template_name, category, prompt, image_url, version
- `static_reviews` — review ratings by claude or user. Ratings: great, good, needs-work, slop. 46+ reviews
- `static_prompt_versions` — prompt iteration history (32+ versions). Tracks template_id, version, prompt text, image_url, brand_dna_snapshot
- `brand_guidelines` — brand identity data. Fields: packaging_format, packaging_specs, colour_palette, typography, tone_of_voice, photo_descriptions
- `competitor_ads` — ~9,900 rows of enriched competitor ads (Simmer data: Jan 11 – Apr 9, 2026). Key fields: `thumbnail_url`, `snapshot_url`, `page_id`, `page_name`, `creative_title`, `creative_body`, `start_date`, `end_date`, `is_active`, `impressions_lower`, `impressions_upper`, `days_active`, `platforms`. **New columns (Apr 2026):** `display_format` (IMAGE/VIDEO/DCO), `video_url`, `card_index`, `parent_ad_id`, `emotional_drivers`, `content_filter`, `creative_targeting`, `categories`, `persona`, `languages`, `market_target`, `niches`, `cta_type`, `link_url`. DCO ads are exploded into one row per card.
- `followed_brands` — brands being tracked for competitor ad monitoring. Simmer: `brand_id: n68cYDEnS6D6eU4T4bLS`, `page_id: 187701838409772`
- `foreplay_credit_log` — tracks Foreplay API credit usage per fetch call. Fields: `brand_id`, `page_id`, `credits_used`, `ads_fetched`, `credit_budget`, `start_date`, `stopped_reason`
- `video_analyses` — **(NEW Apr 2026)** Primary record for video analysis. Fields: competitor_ad_id, run_id, video_url, duration_seconds, total_shots, total_cuts, avg_shot_duration, cuts_per_second, pacing_profile, transcript_text, ocr_text, combined_script, contact_sheet_url, ai_analysis (jsonb), status, error_message
- `video_shots` — **(NEW Apr 2026)** Individual shot records. Fields: video_analysis_id (FK), shot_number, start_time, end_time, duration, frame_url, ocr_text, description
- `video_analysis_runs` — **(NEW Apr 2026)** Batch analysis runs. Fields: brand_name, page_id, percentile (1/2/5/10/20), total_videos, analysed_count, status

### Supabase Storage Buckets

- `reference-images` — existing, public
- `static-uploads` — existing, public
- `video-processing` — **(NEW Apr 2026)** public, 100MB limit. Stores extracted video frames, contact sheets, and audio files. MIME types: video/mp4, video/webm, image/jpeg, image/png, audio/mpeg, audio/mp3

### Workflow

1. Create a "run" with brand DNA (name, URL, product, extracted brand DNA)
2. Generate prompts across templates/categories
3. Create images from prompts
4. Review images (by AI or human) with ratings
5. Iterate on prompts based on feedback

## Key Commands

- **Dev:** `npm run dev` (Vite dev server)
- **Build:** `npm run build`
- **Deploy:** Push to `main` → Vercel auto-deploys

## Design System

- Dark theme (class="dark" on html element)
- Background: bg-bg-0
- Text: white
- Fonts: Inter (UI), JetBrains Mono (code/prompts)
- Antialiased rendering

## Current Status

- **Working:** Brand DNA extraction, prompt generation, image creation, review system, competitor ad viewer with inline video playback and Add Competitor Button
- **Phase 1 Complete:** Video Analysis Engine — Foundation (DB + pipeline + Railway worker + 3 edge functions)
- **Phase 2 Complete:** Script Extraction — Whisper transcription + Claude Vision OCR + combined script merger. 4 new edge functions deployed.
- **Next:** Phase 3 — AI Analysis (creative strategy breakdown using combined_script + contact sheet)
- **Last deployed:** 13 April 2026
- **Edge functions:** 21 edge functions deployed (14 original + 3 Phase 1 video + 4 Phase 2 script extraction). All have `verify_jwt: true`
- **generate-ad-prompt:** v27 (packaging-aware, dynamic packaging terms)
- **brand_guidelines table:** Updated with packaging_format, packaging_specs, colour_palette, typography, tone_of_voice, photo_descriptions columns
- **Edge function `fetch-competitor-ads`:** v6 deployed. Supports `brand_id` or `page_id`, default `start_date: 2025-12-23`, `credit_budget: 500`, DCO card explosion, rich metadata extraction, credit logging to `foreplay_credit_log`
- **Foreplay API:** `public.api.foreplay.co`, key stored in edge function. 1 credit per ad. Simmer brand_id: `n68cYDEnS6D6eU4T4bLS`
- **Supabase anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA`

## Edge Functions

21 edge functions deployed, all have `verify_jwt: true`:

1. `fetch-competitor-ads` — v6: Fetch competitor ads from Foreplay API, support brand_id/page_id, DCO explosion, credit logging
2. `generate-ad-prompt` — v27: Packaging-aware prompt generation with dynamic packaging terms
3. `generate-image` — Image generation via Claude API
4. `list-reviews` — Fetch reviews for images
5. `save-review` — Save image reviews and ratings
6. `get-brand-guidelines` — Fetch brand_guidelines table data
7. `create-static-run` — Create brand DNA generation run
8. `list-static-runs` — List all static runs
9. `get-static-run` — Get specific run details
10. `list-static-images` — List generated images with filters
11. `save-static-image` — Save generated image records
12. `list-prompt-versions` — List prompt iteration history
13. `save-prompt-version` — Save prompt version records
14. `sync-competitor-metadata` — Sync enriched competitor ad metadata
15. `analyse-video` — v4: Phase 1 orchestrator — accepts competitor_ad_id, calls Railway worker, writes to video_analyses + video_shots. Secrets: VIDEO_WORKER_URL, VIDEO_WORKER_SECRET
16. `list-video-analyses` — v1: Query analyses with filters (status, run_id, competitor_ad_id) + pagination. Joins competitor_ads metadata
17. `get-video-analysis` — v1: Fetch single analysis with all shots + full competitor ad context
18. `transcribe-video` — v2 **(Phase 2)**: Whisper transcription with timestamped segments. Downloads audio from Storage, sends to OpenAI Whisper API, stores `[start-end] text` format in transcript_text. Secrets: OPENAI_API_KEY
19. `ocr-video-frames` — v7 **(Phase 2)**: Claude Sonnet 4.6 Vision OCR + frame descriptions. Downloads frames, sends batches to Claude API, updates video_shots (ocr_text, description) and video_analyses (ocr_text). Retry logic for 429/529. Secrets: CLAUDE_API_KEY
20. `merge-video-script` — v1 **(Phase 2)**: Merges transcript + OCR into unified combined_script timeline. Parses timestamped transcript, interleaves with shot descriptions, writes to video_analyses.combined_script
21. `extract-video-script` — v1 **(Phase 2)**: Phase 2 orchestrator. Chains transcribe-video → ocr-video-frames → merge-video-script. Supports skip_transcribe, skip_ocr, ocr_model overrides

## Video Worker (Railway Microservice)

Located at `video-worker/` in repo. Express + FFmpeg service for heavy video processing.

- **Endpoint:** `POST /process-video` — downloads video, detects shots via FFmpeg scene analysis, extracts reference frames, generates contact sheet, extracts audio
- **Auth:** Bearer token via `WORKER_SECRET` env var
- **Deployment:** Railway with Docker (Dockerfile in repo). Project: `triumphant-dedication`, URL: `https://creative-kitchen-static-production.up.railway.app`
- **Env vars:** `WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PORT=3000`
- **Status:** Deployed and verified end-to-end (13 Apr 2026). FFmpeg 5.1.8. Contact sheets tested on 17+ shot videos.
- **Test Videos:**
  - A: Simmer `3324195914449903` — 12.7s, 8 shots, 720x900
  - B: Huel `33860239276954284` — 21.4s, 17 shots, 720x1280
  - C: Frive `1440540640941645` — 31.4s, 17 shots, 720x1280

## Video Analysis Pipeline

Two-phase pipeline for competitor video ad analysis:

### Phase 1: Foundation (analyse-video)
Caller: `POST /functions/v1/analyse-video` with `{competitor_ad_id}`
1. Looks up video_url from competitor_ads
2. Creates video_analyses record (status: processing)
3. Calls Railway worker for FFmpeg processing (scene detection, frame extraction, contact sheet, audio)
4. Worker uploads frames + contact sheet + audio to Supabase Storage (`video-processing` bucket)
5. Updates video_analyses with metrics (duration, shots, pacing) and inserts video_shots records

### Phase 2: Script Extraction (extract-video-script)
Caller: `POST /functions/v1/extract-video-script` with `{analysis_id}`
1. **Transcribe** (transcribe-video): Downloads audio from Storage → Whisper API → timestamped transcript_text
2. **OCR** (ocr-video-frames): Downloads frames → Claude Sonnet 4.6 Vision → per-shot ocr_text + description
3. **Merge** (merge-video-script): Interleaves voiceover + visuals into combined_script timeline

Each step writes independently to the DB, so partial progress is preserved.

## Development Rules

- **GitHub is the single source of truth.** If it's not in the repo, it doesn't exist.
- **Edge functions deploy FROM the repo.** Never deploy directly to Supabase from session code. Commit to GitHub first.
- **No direct pushes to main** (once branching is set up). Use feature branches → dev → main.
- **Ticket-first for multi-file changes.** If a change touches >1 file, create an Asana ticket first in "Creative Kitchen — Engineering Stabilisation" project.
- **Run the pre-session checklist** at `docs/pre-session-checklist.md` before writing any code.
- **Update this file** at the end of every session if architecture, tables, or edge functions changed.

## Known Issues

- Facebook snapshot URLs (`snapshot_url` in `competitor_ads`) may be blocked by Facebook's CSP when rendered in iframes — needs live verification. If blocked, consider server-side screenshotting as fallback.
- Local `src/` directory may be empty — code has been pushed directly to GitHub via MCP in previous sessions. Always check GitHub for the source of truth.
- Shares Supabase tables (static_*) that also appear in the creative-kitchen-video-v3 database
- Foreplay API credits are limited (10,000 per period). Edge function has a `credit_budget` safeguard (default 500) and logs usage to `foreplay_credit_log`. Be careful with exploratory API calls.
- Foreplay Spyder only started tracking Simmer from ~Jan 11, 2026 — no historical data before that date
- OCR with Sonnet 4.6 can take 30-40s for 8 frames — may hit edge function timeout on larger videos. Use batch_size parameter to reduce per-call frame count, or call ocr-video-frames directly with smaller batches.

## Related Projects

- **creative-kitchen-video-v3** — sister project (video content), same Marketing department
- **willa-hq** — loads this tool via iframe as "Static Assets" under Marketing
- **Creative Kitchen** (Supabase) — may be the database this connects to

## Conventions

- Vite + React (not Next.js)
- Dark theme throughout
- Review ratings: great, good, needs-work, slop
- Reviewers: "claude" (AI) or "user" (human)
- Prompt versioning for iterative improvement
