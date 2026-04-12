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

- **Working:** Brand DNA extraction, prompt generation, image creation, review system, competitor ad viewer with inline video playback and Add Competitor button
- **Last deployed:** 12 April 2026
- **Edge functions:** All 14 edge functions in repo under `supabase/functions/{slug}/index.ts`. All have `verify_jwt: true`
- **generate-ad-prompt:** v27 (packaging-aware, dynamic packaging terms)
- **brand_guidelines table:** Updated with packaging_format, packaging_specs, colour_palette, typography, tone_of_voice, photo_descriptions columns
- **Edge function `fetch-competitor-ads`:** v6 deployed. Supports `brand_id` or `page_id`, default `start_date: 2025-12-23`, `credit_budget: 500`, DCO card explosion, rich metadata extraction, credit logging to `foreplay_credit_log`
- **Foreplay API:** `public.api.foreplay.co`, key stored in edge function. 1 credit per ad. Simmer brand_id: `n68cYDEnS6D6eU4T4bLS`
- **Supabase anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA`

## Edge Functions

All 14 edge functions deployed to repo and have `verify_jwt: true`:

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
