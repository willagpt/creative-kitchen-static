# Creative Kitchen Static

Static image ad generator and competitive intelligence tool for Willa Ltd (trading as Chefly). Generates AI ad creatives, analyses competitor ads from Meta Ad Library, and manages brand guidelines. Separate project from Creative Kitchen Video (v3).

## Tech Stack

- **Framework:** Vite + React (not Next.js)
- **Database:** Supabase (ref: `ifrxylvoufncdxyltgqt`, EU Central)
- **Secondary DB:** Supabase (ref: `ajpxzifhoohjkyoyktsi`, US East) for cross-project data (ad launches)
- **Hosting:** Vercel (auto-deploy from main)
- **AI:** Anthropic Claude (via Supabase edge functions for prompt generation and ad analysis)
- **CI:** GitHub Actions (build check on push to main and PRs)
- **Repo:** github.com/willagpt/creative-kitchen-static
- **Live URL:** https://creative-kitchen-static.vercel.app

## Architecture

Vite + React SPA. No auth layer currently. Single workspace. Components handle distinct product areas: ad generation, competitor intelligence, brand DNA, photo library, and ad launching.

### Frontend Structure

```
src/
  App.jsx              # Router/tab navigation, loads all views
  main.jsx             # Entry point
  index.css            # Global styles (2,031 lines, large)
  lib/
    supabase.js        # Supabase client (reads from VITE_SUPABASE_URL env var)
  components/
    Generator.jsx      # AI ad prompt generation (580 lines)
    Review.jsx         # Review generated images (300 lines)
    Launcher.jsx       # Push ads to Meta via v3 project (887 lines)
    CompetitorAds.jsx  # Competitor ad library + analysis pipeline (decomposed)
    competitor/          # Extracted modules: config.js, utils.js, api.js, InlineVideoCard.jsx
    CompareAnalyses.jsx # Cross-brand competitive comparison (decomposed)
    compare/             # Extracted modules: config.js, helpers.jsx
    AdDetail.jsx       # Individual ad detail view (528 lines)
    BrandDNA.jsx       # Brand guidelines management (505 lines)
    PhotoLibrary.jsx   # Photo asset management (630 lines)
    PromptTester.jsx   # Prompt iteration/testing tool (696 lines)
    Gallery.jsx        # Image gallery grid (113 lines)
```

### Chrome Extension

```
chrome-extension/
  manifest.json        # Chrome extension manifest
  config.js             # Centralised Supabase config
  content-script.js    # Injected into Meta Ad Library pages (276 lines)
  background.js        # Service worker (205 lines)
  popup.html/js        # Extension popup
  gallery/
    gallery.js         # Saved ads gallery (refactored, uses config.js)
    gallery.html/css   # Gallery UI
  supabase-edge-function/
    generate-ad-prompt.ts   # Local copy of edge function (legacy location)
    templatize-prompt.ts    # Local copy of edge function (legacy location)
  sql/
    001_create_saved_ads.sql
```

### Other Files

- `public/competitor-ads.html`: Redirect to /
- `public/brand/chefly-brand-guidelines-d3.1.html`: Brand guidelines reference
- `public/prompt-tester.html`: Standalone prompt tester
- `docs/pre-session-checklist.md`: Pre-session checklist for AI development
- `STABILISATION-PLAN.md`: Engineering stabilisation tracker

## Supabase Tables (29 tables on ifrxylvoufncdxyltgqt)

All 29 tables have RLS enabled.

### Core Content
| Table | Rows | Purpose |
|---|---|---|
| `brands` | 1 | Brand profiles |
| `brand_guidelines` | 1 | Brand guideline documents and packaging format |
| `workspaces` | 1 | Workspace/tenant |
| `workspace_members` | 1 | User roles |

### Ad Generation
| Table | Rows | Purpose |
|---|---|---|
| `static_prompt_versions` | 32 | Prompt templates for image generation |
| `prompt_templates` | 2 | Reusable prompt structures |
| `prompt_structures` | 1 | Prompt architecture definitions |
| `static_images` | 74 | Generated static ad images |
| `static_reviews` | 46 | Review status/feedback on generated images |
| `static_runs` | 7 | Generation run metadata |
| `static_uploads` | 0 | Uploaded source images |
| `generated_versions` | 57 | Versioned outputs from generation |
| `generation_runs` | 0 | Generation pipeline runs |
| `gen_images` | 2 | Generated image outputs |
| `reference_images` | 0 | Reference images for generation |

### Competitive Intelligence
| Table | Rows | Purpose |
|---|---|---|
| `competitor_ads` | 14,401 | Scraped competitor ads from Meta Ad Library |
| `competitive_analyses` | 12 | AI analysis results for competitor creatives |
| `analysis_jobs` | 3 | Batch analysis job tracking |
| `analysis_job_images` | 34 | Images queued for analysis |
| `advertisers` | 249 | Known advertiser profiles |
| `followed_brands` | 5 | Brands being tracked |
| `saved_ads` | 9 | User-saved ads from chrome extension |
| `foreplay_credit_log` | 7 | Foreplay API credit tracking |

### Photo Library
| Table | Rows | Purpose |
|---|---|---|
| `photo_library` | 1 | Photo asset metadata |

### Video (shared with v3 project)
| Table | Rows | Purpose |
|---|---|---|
| `clips` | 215 | Video clips |
| `clip_segments` | 1 | Clip sub-segments |
| `recipes` | 10 | Video recipes |
| `rendered_videos` | 50 | Rendered video outputs |
| `activity_log` | 0 | Activity tracking |

## Edge Functions (14 deployed, all in supabase/functions/)

All edge functions are version-controlled in `supabase/functions/{slug}/index.ts`.

| Function | Version | Purpose |
|---|---|---|
| `generate-ad-prompt` | v26 | Generate AI ad prompts from brand + photo |
| `templatize-prompt` | v4 | Convert prompts to reusable templates |
| `generate-shot-sequence` | v2 | Generate video shot sequences |
| `analyse-competitor-creatives` | v25 | AI analysis of competitor ad images |
| `process-analysis-batch` | v16 | Batch processing for analysis pipeline |
| `fetch-competitor-ads` | v9 | Fetch ads from Meta Ad Library API |
| `describe-photo` | v8 | AI photo description for prompt context |
| `extract-ad-thumbnails` | v6 | Extract thumbnails from ad creatives |
| `generate-variables` | v6 | Generate prompt variables from guidelines |
| `extract-brand-guidelines` | v5 | Extract structured data from brand docs |
| `refine-prompt` | v3 | Iterative prompt refinement |
| `compare-prompts` | v2 | A/B compare prompt outputs |
| `vision-model-test` | v2 | Vision model testing utility |
| `seed-advertisers` | v1 | Seed advertiser database |

## Environment Variables

**Frontend (Vercel dashboard, VITE_ prefix):**
- `VITE_SUPABASE_URL` → https://ifrxylvoufncdxyltgqt.supabase.co
- `VITE_SUPABASE_ANON_KEY` → Supabase anon key

See `.env.example` for full documentation.

**Edge Functions (Supabase Secrets):**
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `CLAUDE_API_KEY` (for Claude-powered functions)

## CI/CD

GitHub Actions workflow at `.github/workflows/ci.yml`:
- Triggers on push to main and PRs to main
- Runs `npm ci` + `npm run build`
- Catches broken imports and syntax errors before Vercel deploy
- Vercel handles actual deployment (auto-deploy from main)

## Pre-Flight Check (run before any work)

See `docs/pre-session-checklist.md` for the full checklist. Key steps:

```bash
# 1. Clone repo
git clone https://github.com/willagpt/creative-kitchen-static.git
cd creative-kitchen-static

# 2. Install and build
npm install && npm run build

# 3. Dev server
npm run dev  # runs on port 3000
```

## Code Change Workflow

1. Check Asana for a ticket (create one if touching >1 file)
2. Read the specific file that needs changing
3. Use surgical edits, never rewrite entire files
4. `git add <changed-files> && git commit -m "message" && git push`
5. Verify Vercel deploy succeeded

## Key Commands

- **Dev:** `npm run dev` (port 3000)
- **Build:** `npm run build`
- **Deploy:** Push to `main`, Vercel auto-deploys
- **CI:** Runs automatically on push/PR

## Known Issues (April 13 2026)

- **Oversized component:** Launcher.jsx (887 lines) still needs decomposition.
- **RLS policies needed:** foreplay_credit_log and brand_guidelines have RLS enabled but no policies yet (service_role only access currently).
- **Vercel env vars required:** VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in Vercel dashboard.
- **Google Drive sync:** Local Google Drive files may not match repo. GitHub is source of truth.

## Related Projects

- **creative-kitchen-video-v3** (ref: `ajpxzifhoohjkyoyktsi`, US East): Video ad editor. Launcher.jsx reads ad_launches from this project's Supabase.
- **willa-services** (ref: `fhztszxpgqhunogwcoxw`, EU West): Separate project. Do NOT confuse.
- **Chrome Extension** (in `chrome-extension/`): Scrapes Meta Ad Library, saves ads to Supabase.

## Writing Style

- Never use em dashes or en dashes. Use commas, colons, full stops, or arrows instead.
- For ranges, write "2 to 3" or "15 to 30" instead of "2-3".
- Arrows are fine for showing transitions or flows.

## Stabilisation Tracking

Asana project: [Creative Kitchen Static, Engineering Stabilisation](https://app.asana.com/1/5717506944667/project/1214024873723525)
