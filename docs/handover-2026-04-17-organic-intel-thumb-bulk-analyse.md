# Organic Intel, thumbnail fix + bulk analyse, handover

**Date:** 17 April 2026 (late)
**Status:** shipped, verified live
**PR:** [#35](https://github.com/willagpt/creative-kitchen-static/pull/35) (squash merge `f9ebef3`)
**Vercel production deploy:** `dpl_GdqX5sSttDKyBH4UM45rpaetsoXQ` (READY)

## What shipped

### 1. Fixed the black thumbnail bug on Organic Intel post cards

Problem: Instagram and Facebook CDN URLs (`scontent-*.cdninstagram.com`, `instagram.*.fbcdn.net`) block hotlinking via signed `oh=` query params and referrer checks, so IG post thumbnails rendered as solid black boxes. YouTube thumbnails (`i.ytimg.com`) were fine, only IG was affected. Survey of the DB at handover time: 335 IG posts on scontent, 151 YT posts on i.ytimg, zero YT rendering issues.

Fix, same pattern as Trend Reports v1.1.0:

1. Prefer the Supabase-hosted first-frame URL (`video_shots.frame_url` where `shot_number = 1`) when the post has been analysed. These URLs live in the public `video-processing` bucket and do not honour referrer checks.
2. Fall back to the IG/FB CDN URL with `referrerPolicy="no-referrer"`, which satisfies CDNs that only check for a missing Referer.
3. Hedge with an `onError` handler that hides the image and reveals a `<div class="oi-thumb-missing">Preview blocked</div>` placeholder.

Touched:

- `src/components/OrganicIntel.jsx`, `PostCard` gained `firstFrameUrl` prop; `AccountDetail` fetches `video_shots?shot_number=eq.1` for each analysed post in `refreshAnalysesForPosts` and passes the URLs down via a `firstFrameByPostId` map.
- `src/components/OrganicIntel.css`, reused the existing `.oi-thumb-missing` placeholder, only the bulk bar added new classes.

Live proof (calo.uk detail view, captured from the production smoke test):

- Card 4 (`Reel 32s`, "6 easy ways to do little bits of movement each day"): analysed post, renders the Supabase first_frame_url with "One hour of intense exercise DOES NOT cancel out sitting down all day" caption burned in.
- Cards 1, 2, 3 (marathon, food bangers, ice bath posts): not yet analysed, IG CDN blocked, correctly show "Preview blocked" placeholder.

### 2. Added bulk analyse to the Organic Intel detail view

Problem: the only way to kick off video analysis was to click the per-post "Analyse video" button one at a time. Adding 35 eligible videos to the queue for a single brand took an unworkable amount of clicking.

Fix: a new toolbar above the grid, plus per-card checkboxes.

- `BULK_CONCURRENCY = 3`, a conservative fan-out to avoid overwhelming the Railway worker and edge functions.
- `AccountDetail` state: `selectedIds`, `bulkRunning`, `bulkStatus` (per-post `queued | running | done | error`), `bulkMessage`.
- `runBulkAnalyse` dispatches 3 workers sharing a cursor, each calling the existing `analyse-video` edge function with `{source: 'organic_post', source_id: post.platform_post_id}`.
- Selection state only covers eligible posts (those with `video_url` whose `post_type` is `reel`, `short`, or `video`, and that are not already analysed). Clear and Select all both respect this.
- Per-card visuals: thumbnail-overlay checkbox (`.oi-select-box`), amber border when selected (`.oi-post-selected`), thumbnail status chips during the run (`.oi-chip-bulk-queued|running|done|error`).
- Bulk bar hides itself when `eligibleCount === 0`.

Live proof (same smoke test):

- Select all, "35 selected of 35 eligible videos", "Analyse 35 selected" primary button enabled, 35 of 35 checkboxes checked.
- Clear, "0 selected of 35 eligible videos", primary button disabled, 0 of 35 checked.
- The already-analysed card (marked "Analysis ready") was correctly excluded from the eligible count.

## Production state at handover

- **Home:** https://creative-kitchen-static.vercel.app
- **main:** `f9ebef3 feat(organic-intel): fix thumbnail previews + add bulk analyse (#35)`
- **Organic Intel accounts:** 21 total (11 IG + 10 YT), 19 fetched at least once, 522 posts tracked.
- **Last-7-day strip from production UI:** IG 10 runs, 10 ok, +371 new, $0.85 spent. YT 10 runs, 10 ok, +151 new, 20 quota units used.
- **Cron:** all three `organic_fetch_*` jobs ACTIVE since 17 Apr (IG 02:15 UTC, YT 06:30 UTC, YT 18:30 UTC). Running cleanly, within budget.
- **Video Analysis corpus:** 73 analyses total, 72 from competitor ads, 1 from organic posts. That 1 is what rendered the first_frame_url on the calo.uk detail view.

## Open items for the next session

### Credentials, still blocked

1. Rotate Apify token (leaked in chat earlier this week). Replace the Supabase function secret `APIFY_TOKEN` used by `fetch-instagram-posts` once rotated.
2. Rotate YouTube Data API key (same, leaked). Replace `YOUTUBE_API_KEY` used by `fetch-youtube-posts` once rotated.

Neither rotation blocks anything now (cron is ticking fine on the old keys), but they should not sit leaked for long.

### Housekeeping

3. Close Asana tasks `1214111637586477` (OCR Phase 2) and `1214111637546592` (generate-ugc-brief Phase 2). Both code shipped; only the tickets are still open.
4. Monitor the Organic Intel "Last 7 days" strip tomorrow morning. IG cron fires at 02:15 UTC, YT morning at 06:30 UTC. Expected outcomes:
   - New rows in `organic_fetch_log` for each run.
   - Handfuls of new rows in `organic_posts` for active accounts, especially the high-volume ones (hellofreshuk, huel, calo.uk, mindfulchefuk).
   - Budget accumulation: IG should stay well under the $1/day cap; YT well under 8000 units/month.
5. The stale duplicate `src/CompetitorAds.jsx` (noted in CLAUDE.md Known Issues) is still there. Phase 3 cleanup; no runtime impact.
6. `debug-auth` (soft-retired on 16 Apr, returns HTTP 410 Gone) is still deployed. Hard-delete once caller logs confirm no traffic for 7 days, i.e. check around 23 Apr.

### Nice to have

7. Bulk analyse currently dispatches into the existing single-post pipeline. If the Railway worker starts queueing or 429-ing with 3-way concurrency, drop `BULK_CONCURRENCY` to 2 (top of `OrganicIntel.jsx`). So far no observed load issue, pipeline stays cold between runs.
8. The bulk bar could carry a live progress counter (`N of M complete`) during the run. Right now it only shows per-card chips. If users end up running large bulk jobs unattended, add a rolled-up summary.

## Verification cheatsheet

To re-verify thumbnails on a fresh account:

1. Organic Intel, pick any IG handle with analysed posts (e.g. calo.uk, 1 analysed).
2. Confirm: analysed card shows the burned-in frame, non-analysed cards show "Preview blocked".

To re-verify bulk analyse without actually running it:

1. Organic Intel, calo.uk.
2. Click Select all, counter should read "35 selected of 35 eligible videos" and the primary CTA should enable.
3. Click Clear, counter returns to 0, primary CTA disables.

## Reference

- PR: https://github.com/willagpt/creative-kitchen-static/pull/35
- Squash commit: https://github.com/willagpt/creative-kitchen-static/commit/f9ebef3628a5dea17aee83bf819bd41309fb1e97
- Precedent for the thumbnail fallback pattern: `src/components/TrendReports.jsx` around lines 1080 to 1135.
