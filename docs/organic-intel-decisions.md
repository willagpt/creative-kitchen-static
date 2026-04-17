# Organic Intelligence Decisions (D1 to D8)

**Decided:** 2026-04-17
**Decision maker:** James Howland
**Spec:** see Asana project [Engineering Stabilisation](https://app.asana.com/1/5717506944667/project/1214024873723525) and spec `uploads/organic-monitoring-project-spec-f9c925ad.md`
**Parent tracker:** Asana task 1214098892682283

All eight decisions are now resolved. Phase 1 (Instagram foundation) is unblocked and can start on or after 2026-04-22 per ticket 1214100586314726.

## D1. Apify actor

**Choice:** Official `apify/instagram-scraper` (Apify, maintained).

Reasoning: reliability and documentation win for V1. We will switch to Apidojo pay-per-result if cost exceeds the D4 ceiling for two consecutive months. `hpix` was rejected as least battle-tested.

Cost note: official actor pricing is pay-per-compute, historically around $2.30 per 1000 results. At 10 IG accounts on daily cadence (D2 + D3) this sits comfortably under the D4 budget.

Ticket: 1214110092820488

## D2. Accounts per platform at launch

**Choice:** 10 Instagram + 10 YouTube.

Reasoning: enough breadth for Phase 6 clustering to produce non-noise trends, predictable Apify spend, and matches the spec default. Overlap with `followed_brands` is allowed per D6.

Ticket: 1214101221206423

## D3. Fetch and metrics cadence

**Choice:** Per-account `fetch_frequency` column (daily where set, weekly otherwise). Nightly `refresh-organic-metrics` for all active accounts.

Reasoning: rising-post detection in Phase 4 needs multi-day metric snapshots, so the nightly metrics refresh is non-negotiable. Daily fetch captures rising posts inside their first 24 to 72 hour window, which is where the signal lives.

Tickets: 1214101221206519, 1214110092809836 (edge function), 1214098892716168 (schedule)

## D4. Apify monthly budget ceiling

**Choice:** $30 per month hard cap.

Reasoning: spec default, sized for 10+10 accounts on daily cadence with the official actor. Logged to `organic_fetch_log.cost_estimate`, alert at $24 (80 percent), hard-stop at $30. Revisit after 4 weeks of real usage data.

Ticket: 1214110092820392

## D5. YOUTUBE_API_KEY host

**Choice:** Supabase edge function secret, scoped to the existing Google Cloud project already in use for Google Drive.

Reasoning: zero new infra, one billing account to monitor, scoped strictly to YouTube Data API v3. The API key will be provisioned in ticket 1214101221198950.

Ticket: 1214118049383932

## D6. Accounts table structure (already resolved)

**Choice:** Separate `followed_organic_accounts` table. Overlap with `followed_brands` is allowed.

Status: closed 2026-04-17.

Ticket: 1214100586303945

## D7. Transcript language scope at V1

**Choice:** English only.

Reasoning: Whisper auto-detects language. Non-English posts will be flagged via the `language` column on `organic_posts` and skipped for AI analysis at V1. All downstream prompts and clustering logic assume English; expansion is a V2 decision.

Ticket: 1214101221206583

## D8. YouTube transcript method

**Choice:** Skip YouTube `captions.download`. Always download audio via yt-dlp in the Railway worker and transcribe with Whisper.

Reasoning: `captions.download` requires OAuth (per Google) which adds auth infra for marginal savings. The yt-dlp + Whisper path is identical to the IG and competitor-ad video flows, so we maintain a single transcript code path across all sources. yt-dlp version will be pinned in the worker Dockerfile per risk R4.

Ticket: 1214101221197154

## Downstream ticket impact

With D1 to D8 resolved, these Phase 1 and Phase 2 tickets are now unblocked:

- 1214100586314726 (1.1 Create organic tables with RLS, due 2026-04-22)
- 1214118049370997 (1.2 Provision Apify account + APIFY_TOKEN secret, due 2026-04-22)
- 1214100586312813 (1.3 Seed followed_organic_accounts, due 2026-04-24)
- 1214101221206255 (1.4 Build fetch-instagram-posts edge function, due 2026-04-28)
- 1214098892700507 (1.5 Build list-organic-accounts etc., due 2026-04-30)
- 1214101221198950 (2.1 Provision YOUTUBE_API_KEY secret, due 2026-04-29)
- 1214110092820760 (2.2 Build fetch-youtube-posts edge function, due 2026-05-05)
- 1214101221206679 (2.3 Shorts vs long-form detection, due 2026-05-05)
- 1214118049370898 (2.4 Add YouTube accounts to seed list, due 2026-05-07)

Risk register R1 to R7 stays live throughout Phase 1 and Phase 2 engineering (Asana task 1214110092790353).

## Revision rules

Any deviation from the above (actor swap, budget raise, adding non-English support, etc.) must be raised as a new decision ticket in the Engineering Stabilisation project and linked back to this doc. Do not update these decisions in-place; append a new section instead so the audit trail stays intact.
