# Creative Kitchen Static — Code State Matrix

**Generated:** 12 April 2026
**Purpose:** Single source of truth for what's deployed, what's in GitHub, and known discrepancies.

---

## Edge Functions (Supabase → GitHub)

All 14 deployed edge functions have now been exported to `supabase/functions/{slug}/index.ts` in the GitHub repo as of 12 April 2026.

| Function | Deployed Version | In GitHub | JWT Auth | Notes |
|---|---|---|---|---|
| generate-ad-prompt | v25 | ✅ | ❌ | Core prompt engine. System prompt hardcodes sleeve examples (known bug) |
| refine-prompt | v2 | ✅ | ❌ | Surgical prompt editing |
| templatize-prompt | v3 | ✅ | ❌ | Converts prompts to reusable templates |
| compare-prompts | v1 | ✅ | ❌ | Visual diff between two prompts |
| generate-variables | v5 | ✅ | ❌ | Meal-specific creative variables |
| extract-brand-guidelines | v3 | ✅ | ❌ | Parses brand docs into structured JSON |
| describe-photo | v6 | ✅ | ❌ | Photo library descriptions via Claude |
| seed-advertisers | v1 | ✅ | ✅ | Only function with JWT auth enabled |
| extract-ad-thumbnails | v4 | ✅ | ❌ | Extracts images from ad HTML snapshots |
| fetch-competitor-ads | v7 | ✅ | ❌ | Foreplay API ingestion with credit budgeting |
| analyse-competitor-creatives | v23 | ✅ | ❌ | Multi-step AI visual analysis pipeline |
| vision-model-test | v1 | ✅ | ❌ | Standalone visual forensic analysis test |
| process-analysis-batch | v15 | ✅ | ❌ | Batch orchestrator for vision analysis |
| generate-shot-sequence | v1 | ✅ | ❌ | Food photography shot sequence generator |

**Status:** All functions now in repo. GitHub is the source of truth for edge function code going forward.

**Critical rule:** Do NOT deploy edge functions directly to Supabase. Always commit to GitHub first, then deploy from the repo.

---

## React Components (GitHub src/)

| Component | Location | Size | Notes |
|---|---|---|---|
| App.jsx | src/ | 6.3 KB | Root component, tab navigation. Reverted to pre-Apr-12 state |
| main.jsx | src/ | 230 B | Entry point |
| index.css | src/ | 65.6 KB | Global styles |
| **CompetitorAds.jsx** | **src/** | **59.7 KB** | **⚠️ DUPLICATE — stale copy. Active version is in src/components/** |
| **CompetitorAds.css** | **src/** | **29.9 KB** | **⚠️ DUPLICATE — stale copy. Active version is in src/components/** |
| AdDetail.jsx | src/components/ | 20.8 KB | Ad library detail modal. Reverted to pre-Apr-12 state |
| BrandDNA.jsx | src/components/ | 19.8 KB | Brand DNA extraction UI |
| CompareAnalyses.jsx | src/components/ | 45.4 KB | Side-by-side analysis comparison |
| CompareAnalyses.css | src/components/ | 4.9 KB | Styles for comparison view |
| **CompetitorAds.jsx** | **src/components/** | **122.2 KB** | **⚠️ Active version — 122KB monolith, needs refactoring (Phase 3)** |
| **CompetitorAds.css** | **src/components/** | **48.8 KB** | **Active styles for competitor ads** |
| Gallery.jsx | src/components/ | 11.5 KB | Ad library grid view. Reverted to pre-Apr-12 state |
| Generator.jsx | src/components/ | 21.6 KB | Image generation interface |
| Launcher.jsx | src/components/ | 34.3 KB | Run launcher/dashboard |
| PhotoLibrary.jsx | src/components/ | 27.1 KB | Photo library management |
| PromptTester.jsx | src/components/ | 28.3 KB | Prompt testing interface |
| Review.jsx | src/components/ | 12.7 KB | Image review/rating system |

**Issues found:**
1. **Duplicate CompetitorAds files** — `src/CompetitorAds.jsx` (59.7 KB) and `src/components/CompetitorAds.jsx` (122.2 KB) both exist. The `src/` version appears to be a stale older copy. Should be deleted.
2. **122KB component** — `src/components/CompetitorAds.jsx` is far too large for a single file. Scheduled for Phase 3 refactoring.

---

## Chrome Extension (GitHub chrome-extension/)

| File | Size | Notes |
|---|---|---|
| manifest.json | 1.1 KB | Extension manifest |
| background.js | 6.9 KB | Service worker |
| content-script.js | 10.5 KB | Page injection |
| popup.html / popup.js | 5.7 KB / 4.4 KB | Extension popup |
| gallery/gallery.js | 17.6 KB | **⚠️ 1,960-line monolith — Phase 3 refactor target** |
| gallery/gallery.html | 20.8 KB | Gallery page |
| gallery/gallery.css | 35.7 KB | Gallery styles |
| supabase-edge-function/generate-ad-prompt.ts | 26.4 KB | **⚠️ STALE COPY — not the deployed version (v25 is in supabase/functions/)** |
| supabase-edge-function/templatize-prompt.ts | 4.8 KB | **⚠️ STALE COPY — not the deployed version (v3 is in supabase/functions/)** |

**Issues found:**
1. **Stale edge function copies** — `chrome-extension/supabase-edge-function/` contains old versions of generate-ad-prompt.ts and templatize-prompt.ts. These do NOT match the deployed versions. Should be deleted or clearly marked as archived to prevent confusion.
2. **gallery.js monolith** — Single IIFE, 1,960 lines. Scheduled for Phase 3 refactoring.

---

## Supabase Database Tables

| Table | Row Count (approx) | RLS | Notes |
|---|---|---|---|
| static_runs | ~10 | ❓ | Brand DNA generation runs |
| static_images | ~74 | ❓ | Generated images |
| static_reviews | ~46 | ❓ | Image ratings (great/good/needs-work/slop) |
| static_prompt_versions | ~32 | ❓ | Prompt iteration history |
| competitor_ads | ~9,900 | ❓ | Enriched competitor ads from Foreplay/Simmer |
| followed_brands | ~1 | ❓ | Tracked brands for monitoring |
| foreplay_credit_log | ~5 | ❓ | API credit usage tracking |
| brand_guidelines | ~1 | ❓ | **⚠️ Missing packaging_format column (Phase 1 task)** |

---

## Utility/Config Files

| File | Location | Notes |
|---|---|---|
| supabase.js | src/lib/ | Supabase client init (460 B) |
| supabase-v3.js | src/lib/ | Alternate Supabase client (535 B) — **⚠️ why two?** |
| vercel.json | root | Vercel config (144 B) |
| vite.config.js | root | Vite build config (158 B) |
| package.json | root | Dependencies (400 B) |
| competitor-ads.html | root | Standalone competitor ads page (37 KB) |
| prompt-tester.html | public/ | Standalone prompt tester page (25.5 KB) |
| chefly-brand-guidelines-d3.1.html | public/brand/ | Brand guidelines doc (170 KB) |

**Issues found:**
1. **Two Supabase client files** — `supabase.js` and `supabase-v3.js` in `src/lib/`. Need to determine which is active and remove the other.
2. **Standalone HTML pages** — `competitor-ads.html` (root) and `prompt-tester.html` (public/) appear to be standalone pages outside the React app. May be legacy or used by the Chrome extension.

---

## Summary of Discrepancies

| # | Issue | Severity | Phase |
|---|---|---|---|
| 1 | Duplicate CompetitorAds.jsx in src/ vs src/components/ | Medium | Immediate cleanup |
| 2 | Stale edge function copies in chrome-extension/supabase-edge-function/ | Medium | Immediate cleanup |
| 3 | Two Supabase client files (supabase.js vs supabase-v3.js) | Low | Phase 3 |
| 4 | 13/14 edge functions have no JWT auth | High | Phase 1 |
| 5 | brand_guidelines table missing packaging_format column | High | Phase 1 |
| 6 | generate-ad-prompt system prompt hardcodes sleeve examples | High | Phase 1 |
| 7 | CompetitorAds.jsx is 122KB monolith | Medium | Phase 3 |
| 8 | gallery.js is 1,960-line monolith | Medium | Phase 3 |
| 9 | No CI/CD for edge function deployment | High | Phase 2 |
| 10 | All pushes go directly to main branch | Medium | Phase 2 |

---

## Rules Going Forward

1. **GitHub is the single source of truth.** If it's not in the repo, it doesn't exist.
2. **Edge functions deploy FROM the repo.** Never deploy directly to Supabase from a session.
3. **No direct pushes to main.** Use feature branches → dev → main.
4. **Every multi-file change gets a ticket first.** Write what, why, and what could break.
5. **Pre-session checklist.** Verify deployed versions match repo before starting work.
