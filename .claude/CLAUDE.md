# Creative Kitchen Static

Static image ad generator and competitive intelligence tool for Willa Ltd (trading as Chefly). Generates AI ad creatives, analyses competitor ads from Meta Ad Library, and manages brand guidelines. Separate project from Creative Kitchen Video (v3).

## Tech Stack

- **Framework:** Vite + React (not Next.js)
- **Database:** Supabase (ref: `ifrxylvoufncdxyltgqt`, EU Central)
- **Secondary DB:** Supabase (ref: `ajpxzifhoohjkyoyktsi`, US East) for cross-project data (ad launches)
- **Hosting:** Vercel (auto-deploy from main)
- **AI:** Anthropic Claude (via Supabase edge functions for prompt generation and ad analysis)
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
    supabase.js        # Primary Supabase client (ifrxylvoufncdxyltgqt)
    supabase-v3.js     # Secondary client (ajpxzifhoohjkyoyktsi) [DEAD CODE: not imported]
  components/
    Generator.jsx      # AI ad prompt generation (580 lines)
    Review.jsx         # Review generated images (300 lines)
    Launcher.jsx       # Push ads to Meta via v3 project (887 lines)
    CompetitorAds.jsx  # Competitor ad library + analysis pipeline (2,369 lines, needs split)
    CompareAnalyses.jsx # Cross-brand competitive comparison (1,018 lines)
    AdDetail.jsx       # Individual ad detail view (528 lines)
    BrandDNA.jsx       # Brand guidelines management (505 lines)
    PhotoLibrary.jsx   # Photo asset management (630 lines)
    PromptTester.jsx   # Prompt iteration/testing tool (696 lines)
    Gallery.jsx        # Image gallery grid (113 lines)
  CompetitorAds.jsx    # [DEAD CODE] Old version, not imported by App.jsx
  CompetitorAds.css    # [DEAD CODE] Accompanies dead JSX file above
```

### Chrome Extension

```
chrome-extension/
  manifest.json        # Chrome extension manifest
  content-script.js    # Injected into Meta Ad Library pages (276 lines)
  background.js        # Service worker (205 lines)
  popup.html/js        # Extension popup
  gallery/
    gallery.js         # Saved ads gallery (567 lines, needs refactor)
    gallery.html/css   # Gallery UI
  supabase-edge-function/
    generate-ad-prompt.ts   # Local copy of edge function
    templatize-prompt.ts    # Local copy of edge function
  sql/
    001_create_saved_ads.sql
```

### Other Files

- `competitor-ads.html` (root): [DEAD CODE] Pre-SPA standalone page (1,147 lines)
- `public/competitor-ads.html`: Redirect to /
- `public/brand/chefly-brand-guidelines-d3.1.html`: Brand guidelines reference
- `public/prompt-tester.html`: Standalone prompt tester
- `docs/pre-session-checklist.md`: Pre-session checklist for AI development

## Supabase Tables (29 tables on ifrxylvoufncdxyltgqt)

### Core Content
| Table | Rows | RLS | Purpose |
|---|---|---|---|
| `brands` | 1 | Yes | Brand profiles |
| `brand_guidelines` | 1 | **No** | Brand guideline documents and packaging format |
| `workspaces` | 1 | Yes | Workspace/tenant |
| `workspace_members` | 1 | Yes | User roles |

### Ad Generation
| Table | Rows | RLS | Purpose |
|---|---|---|---|
| `static_prompt_versions` | 32 | Yes | Prompt templates for image generation |
| `prompt_templates` | 2 | Yes | Reusable prompt structures |
| `prompt_structures` | 1 | Yes | Prompt architecture definitions |
| `static_images` | 74 | Yes | Generated static ad images |
| `static_reviews` | 46 | Yes | Review status/feedback on generated images |
| `static_runs` | 7 | Yes | Generation run metadata |
| `static_uploads` | 0 | Yes | Uploaded source images |
| `generated_versions` | 57 | Yes | Versioned outputs from generation |
| `generation_runs` | 0 | Yes | Generation pipeline runs |
| `gen_images` | 2 | Yes | Generated image outputs |
| `reference_images` | 0 | Yes | Reference images for generation |

### Competitive Intelligence
| Table | Rows | RLS | Purpose |
|---|---|---|---|
| `competitor_ads` | 14,401 | Yes | Scraped competitor ads from Meta Ad Library |
| `competitive_analyses` | 12 | Yes | AI analysis results for competitor creatives |
| `analysis_jobs` | 3 | Yes | Batch analysis job tracking |
| `analysis_job_images` | 34 | Yes | Images queued for analysis |
| `advertisers` | 249 | Yes | Known advertiser profiles |
| `followed_brands` | 5 | Yes | Brands being tracked |
| `saved_ads` | 9 | Yes | User-saved ads from chrome extension |
| `foreplay_credit_log` | 7 | **No** | Foreplay API credit tracking |

### Photo Library
| Table | Rows | RLS | Purpose |
|---|---|---|---|
| `photo_library` | 1 | Yes | Photo asset metadata |

### Video (shared with v3 project)
| Table | Rows | RLS | Purpose |
|---|---|---|---|
| `clips` | 215 | Yes | Video clips |
| `clip_segments` | 1 | Yes | Clip sub-segments |
| `recipes` | 10 | Yes | Video recipes |
| `rendered_videos` | 50 | Yes | Rendered video outputs |
| `activity_log` | 0 | Yes | Activity tracking |

## Edge Functions (14 deployed, only 1 in supabase/functions/)

**CRITICAL: 13 of 14 deployed edge functions are NOT in the repo's supabase/functions/ directory.**

| Function | Version | In Repo? | Purpose |
|---|---|---|---|
| `generate-ad-prompt` | v26 | chrome-ext only | Generate AI ad prompts from brand + photo |
| `templatize-prompt` | v4 | chrome-ext only | Convert prompts to reusable templates |
| `generate-shot-sequence` | v2 | Yes (supabase/functions/) | Generate video shot sequences |
| `analyse-competitor-creatives` | v25 | **No** | AI analysis of competitor ad images |
| `process-analysis-batch` | v16 | **No** | Batch processing for analysis pipeline |
| `fetch-competitor-ads` | v9 | **No** | Fetch ads from Meta Ad Library API |
| `describe-photo` | v8 | **No** | AI photo description for prompt context |
| `extract-ad-thumbnails` | v6 | **No** | Extract thumbnails from ad creatives |
| `generate-variables` | v6 | **No** | Generate prompt variables from guidelines |
| `extract-brand-guidelines` | v5 | **No** | Extract structured data from brand docs |
| `refine-prompt` | v3 | **No** | Iterative prompt refinement |
| `compare-prompts` | v2 | **No** | A/B compare prompt outputs |
| `vision-model-test` | v2 | **No** | Vision model testing utility |
| `seed-advertisers` | v1 | **No** | Seed advertiser database |

## Environment Variables

**Frontend (should use VITE_ prefix, currently hardcoded):**
- Supabase URL: `https://ifrxylvoufncdxyltgqt.supabase.co`
- Supabase Anon Key: hardcoded in `src/lib/supabase.js`
- Secondary Supabase (v3) URL and key: hardcoded in `src/lib/supabase-v3.js`

**Edge Functions (Supabase Secrets):**
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `ANTHROPIC_API_KEY` (for Claude-powered functions)

**No .env.example exists. This needs to be created.**

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

## Known Issues (April 13 2026)

- **Edge function drift:** 13 of 14 edge functions exist only on Supabase, not in repo. Major risk.
- **No CI pipeline:** No GitHub Actions. Build errors only caught by Vercel after push.
- **Hardcoded credentials:** Supabase URL and anon key hardcoded instead of using env vars.
- **No .env.example:** Environment variables undocumented.
- **2 tables without RLS:** `foreplay_credit_log` and `brand_guidelines`.
- **Dead code:** ~3,275 lines of unused files (src/CompetitorAds.jsx, src/CompetitorAds.css, root competitor-ads.html, src/lib/supabase-v3.js).
- **Oversized components:** CompetitorAds.jsx (2,369 lines), CompareAnalyses.jsx (1,018 lines), Launcher.jsx (887 lines).

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
