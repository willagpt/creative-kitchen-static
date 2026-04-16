# Creative Kitchen Static — Code State Matrix

**Generated:** 16 April 2026
**Previous revision:** 12 April 2026
**Purpose:** Single source of truth for what's deployed to Supabase, what's in GitHub, and known discrepancies.

---

## Edge Functions (Supabase ↔ GitHub)

**Live count in Supabase:** 24 functions
**Directories in `supabase/functions/` on main:** 24
**Repo ↔ Supabase alignment:** 100% (every deployed function has a matching source directory)

| # | Function | Deployed Version | In GitHub | verify_jwt | Notes |
|---|---|---|---|---|---|
| 1 | generate-ad-prompt | v29 | ✅ | ✅ | Packaging-aware prompt engine (dynamic packaging terms) |
| 2 | refine-prompt | v6 | ✅ | ✅ | Surgical prompt editing |
| 3 | templatize-prompt | v7 | ✅ | ✅ | Converts prompts to reusable templates |
| 4 | compare-prompts | v5 | ✅ | ✅ | Visual diff between two prompts |
| 5 | generate-variables | v9 | ✅ | ✅ | Meal-specific creative variables |
| 6 | extract-brand-guidelines | v8 | ✅ | ✅ | Parses brand docs into structured JSON |
| 7 | describe-photo | v11 | ✅ | ✅ | Photo library descriptions via Claude |
| 8 | seed-advertisers | v4 | ✅ | ✅ | Bootstrap advertiser seed data |
| 9 | extract-ad-thumbnails | v9 | ✅ | ✅ | Extracts images from ad HTML snapshots |
| 10 | fetch-competitor-ads | v12 | ✅ | ✅ | Foreplay API ingestion + credit budgeting, DCO explosion |
| 11 | **analyse-competitor-creatives** | **v31** | ✅ | ❌ | ⚠️ **JWT disabled — regression.** Remediation ticket: [1214111066075066](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214111066075066) |
| 12 | vision-model-test | v5 | ✅ | ✅ | Standalone visual forensic analysis test |
| 13 | process-analysis-batch | v24 | ✅ | ✅ | Batch orchestrator for vision analysis |
| 14 | generate-shot-sequence | v5 | ✅ | ✅ | Food photography shot sequence generator |
| 15 | **debug-auth** | **v4** | ✅ | ❌ | ⚠️ **JWT disabled — diagnostic function.** Remediation ticket: [1214101220983182](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214101220983182) (harden or retire) |
| 16 | analyse-video | v4 | ✅ | ✅ | Orchestrator — calls Railway worker, writes video_analyses + video_shots |
| 17 | list-video-analyses | v4 | ✅ | ✅ | Query analyses with filters + pagination |
| 18 | get-video-analysis | v4 | ✅ | ✅ | Fetch single analysis with shots + competitor ad context |
| 19 | transcribe-video | v2 | ✅ | ✅ | Whisper transcription pipeline |
| 20 | ocr-video-frames | v7 | ✅ | ✅ | OCR extraction from video reference frames |
| 21 | merge-video-script | v1 | ✅ | ✅ | Merges transcript + OCR into combined script |
| 22 | extract-video-script | v2 | ✅ | ✅ | Orchestrates transcribe → OCR → merge pipeline |
| 23 | ai-analyse-video | v2 | ✅ | ✅ | Layout detection — classifies shots as full/split-2/split-3/other |
| 24 | generate-ugc-brief | v6 | ✅ | ✅ | Chefly UGC creator briefs, 16384 max_tokens, layout-aware prompts |

**JWT posture:** 22 of 24 enforce `verify_jwt: true`. Two functions (analyse-competitor-creatives, debug-auth) currently run without JWT. Both have open remediation tickets in the engineering project and are tracked below under "Open Issues".

**Phantom entry removed:** Previous versions of `.claude/CLAUDE.md` referenced `sync-competitor-metadata` as a deployed function. This function is not present in Supabase and has no source directory in the repo. It has been removed from the canonical function list.

**Critical rule:** Do NOT deploy edge functions directly to Supabase. Always commit to GitHub first, then deploy from the repo. The 12 Apr 2026 backfill pass plus this 16 Apr re-verification confirms the rule is now being honoured for every function currently live.

---

## Supabase Database — Phase 1 completion checks

| Check | Status | Evidence |
|---|---|---|
| `brand_guidelines.packaging_format` column exists | ✅ | Column in use by `generate-ad-prompt` v29 for dynamic packaging terms |
| Hardcoded sleeve examples removed from `generate-ad-prompt` system prompt | ✅ | Confirmed Apr 13 during Phase 1 close; no regression in v29 |
| All 24 functions sourced from repo | ✅ | 1:1 directory ↔ slug mapping verified 16 Apr |

---

## React Components (GitHub src/)

| Component | Location | Size | Notes |
|---|---|---|---|
| App.jsx | src/ | 6.3 KB | Root component, tab navigation |
| main.jsx | src/ | 230 B | Entry point |
| index.css | src/ | 65.6 KB | Global styles |
| **CompetitorAds.jsx** | **src/** | **59.7 KB** | ⚠️ DUPLICATE — stale copy. Active version lives in src/components/ |
| **CompetitorAds.css** | **src/** | **29.9 KB** | ⚠️ DUPLICATE — stale copy. Active version lives in src/components/ |
| AdDetail.jsx | src/components/ | 20.8 KB | Ad library detail modal |
| BrandDNA.jsx | src/components/ | 19.8 KB | Brand DNA extraction UI |
| CompareAnalyses.jsx | src/components/ | 45.4 KB | Side-by-side analysis comparison |
| CompareAnalyses.css | src/components/ | 4.9 KB | Styles for comparison view |
| **CompetitorAds.jsx** | **src/components/** | **122.2 KB** | ⚠️ Active version — 122KB monolith, Phase 3 refactor target |
| **CompetitorAds.css** | **src/components/** | **48.8 KB** | Active styles for competitor ads |
| Gallery.jsx | src/components/ | 11.5 KB | Ad library grid view |
| Generator.jsx | src/components/ | 21.6 KB | Image generation interface |
| Launcher.jsx | src/components/ | 34.3 KB | Run launcher/dashboard |
| PhotoLibrary.jsx | src/components/ | 27.1 KB | Photo library management |
| PromptTester.jsx | src/components/ | 28.3 KB | Prompt testing interface |
| Review.jsx | src/components/ | 12.7 KB | Image review/rating system |

**Open issues:**
1. Duplicate `CompetitorAds.jsx` in `src/` vs `src/components/` — Phase 3 cleanup.
2. `src/components/CompetitorAds.jsx` at 122 KB needs decomposition — Phase 3.

---

## Video Worker (Railway)

| Component | Location | Status |
|---|---|---|
| Express + FFmpeg service | `video-worker/` in repo | Deployed, verified end-to-end (13 Apr) |
| Dockerfile | repo root of `video-worker/` | Railway build source |
| Endpoint | `POST /process-video` | Bearer-auth via `WORKER_SECRET` |
| Public URL | `https://creative-kitchen-static-production.up.railway.app` | Railway project `triumphant-dedication` |

Test videos confirmed: Simmer (12.7s / 8 shots), Huel (21.4s / 17 shots), Frive (31.4s / 17 shots).

---

## Chrome Extension (GitHub chrome-extension/)

| File | Size | Notes |
|---|---|---|
| manifest.json | 1.1 KB | Extension manifest |
| background.js | 6.9 KB | Service worker |
| content-script.js | 10.5 KB | Page injection |
| popup.html / popup.js | 5.7 KB / 4.4 KB | Extension popup |
| gallery/gallery.js | 17.6 KB | ⚠️ 1,960-line monolith — Phase 3 refactor target |
| gallery/gallery.html | 20.8 KB | Gallery page |
| gallery/gallery.css | 35.7 KB | Gallery styles |
| supabase-edge-function/generate-ad-prompt.ts | 26.4 KB | ⚠️ STALE COPY — not the deployed version (v29 lives in supabase/functions/) |
| supabase-edge-function/templatize-prompt.ts | 4.8 KB | ⚠️ STALE COPY — not the deployed version (v7 lives in supabase/functions/) |

---

## Supabase Database Tables

| Table | Row Count (approx) | Notes |
|---|---|---|
| static_runs | ~10 | Brand DNA generation runs |
| static_images | ~74 | Generated images |
| static_reviews | ~46 | Image ratings (great/good/needs-work/slop) |
| static_prompt_versions | ~32 | Prompt iteration history |
| brand_guidelines | ~1 | ✅ packaging_format column added (Phase 1) |
| competitor_ads | ~9,900 | Enriched competitor ads from Foreplay/Simmer |
| followed_brands | ~1 | Tracked brands for monitoring |
| foreplay_credit_log | ~5 | API credit usage tracking |
| video_analyses | New | Primary record for video analysis (Phase 1 Video) |
| video_shots | New | Individual shot records with screen_layout |
| video_analysis_runs | New | Batch analysis runs |

**New tables planned (Organic Intelligence phase — see Asana project):** `followed_organic_accounts`, `organic_posts`, `organic_post_metrics`, `organic_fetch_log`. `video_analyses` will gain `organic_post_id` + `source_kind` columns with CHECK constraint.

---

## Storage Buckets

| Bucket | Access | Notes |
|---|---|---|
| reference-images | public | Existing |
| static-uploads | public | Existing |
| video-processing | public, 100MB limit | Added for video analysis pipeline. MIME: video/mp4, video/webm, image/jpeg, image/png, audio/mpeg, audio/mp3 |

---

## Summary of Open Issues

| # | Issue | Severity | Tracking |
|---|---|---|---|
| 1 | `analyse-competitor-creatives` has verify_jwt disabled | High | Asana [1214111066075066](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214111066075066) |
| 2 | `debug-auth` has verify_jwt disabled | High | Asana [1214101220983182](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214101220983182) |
| 3 | Duplicate CompetitorAds.jsx in src/ vs src/components/ | Medium | Phase 3 cleanup |
| 4 | `src/components/CompetitorAds.jsx` is 122 KB monolith | Medium | Phase 3 |
| 5 | Chrome extension ships stale copies of generate-ad-prompt.ts and templatize-prompt.ts | Medium | Phase 3 cleanup |
| 6 | `src/lib/supabase.js` and `supabase-v3.js` both present | Low | Phase 3 |
| 7 | `chrome-extension/gallery/gallery.js` is 1,960-line monolith | Medium | Phase 3 |

---

## Closed in This Revision

| # | Issue | Resolution |
|---|---|---|
| A | 13 of 14 edge functions had no JWT auth (12 Apr state) | 22 of 24 now enforce verify_jwt; 2 tracked exceptions have remediation tickets |
| B | Edge functions deployed to Supabase without source in repo | 100% alignment as of 16 Apr — every deployed slug has a matching `supabase/functions/<slug>/` directory on main |
| C | `brand_guidelines` table missing `packaging_format` column | Column added; `generate-ad-prompt` v29 consumes it |
| D | `generate-ad-prompt` system prompt hardcoded sleeve examples | Removed in v25+; no regression in v29 |
| E | `sync-competitor-metadata` documented as deployed | Phantom entry — neither deployed nor in repo. Removed from CLAUDE.md |

---

## Rules Going Forward

1. **GitHub is the single source of truth.** If it's not in the repo, it doesn't exist.
2. **Edge functions deploy FROM the repo.** Never deploy directly to Supabase from a session.
3. **No direct pushes to main** once the branching protocol is live. Use feature branches → dev → main.
4. **Every multi-file change gets a ticket first** in the engineering project. Write what, why, and what could break.
5. **Pre-session checklist.** Verify deployed versions match repo before starting work.
6. **Any new edge function** must be committed to `supabase/functions/<slug>/index.ts` in the same PR that deploys it.
