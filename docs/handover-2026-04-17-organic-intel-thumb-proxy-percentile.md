# Organic Intel, server-side thumbnail snapshots + percentile bulk selector, handover

**Date:** 17 April 2026 (late)
**Status:** shipped, production deploy verified READY
**PR:** [#36](https://github.com/willagpt/creative-kitchen-static/pull/36) (squash merge `6973398`)
**Vercel production deploy:** `dpl_FhpYruzhhf2sHz4ziuiwSBFzRRec` (READY, target production, commit `6973398d9a5a556fbde5215c52bd0efc89937137`)

## Context, why this exists

PR #35 shipped earlier today fixed IG thumbnails on the happy path (analysed posts use the Supabase `first_frame_url`) and added bulk analyse. Two things survived into this PR:

1. Non-analysed IG cards still rendered "Preview blocked" because IG/FB CDN URLs (`scontent-*.cdninstagram.com`, `instagram.*.fbcdn.net`) sign their query strings with short-TTL `oh=` tokens that cross-check the requesting IP + UA. No browser-side trick (referrerPolicy stripping, no-cors, etc.) gets past that.
2. Power-user selection was missing. With 35 eligible videos per brand, users wanted percentile presets (top 2.5 / 5 / 10 / 20% by views) instead of hand-picking or running the full batch.

PR #36 closes both.

## What shipped

### 1. Durable thumbnail cache (server-side)

Three cooperating pieces, all server-side because that is the only place the hotlink defences can be defeated:

**(a) Schema** — migration `supabase/migrations/20260417180000_organic_thumbnails_cache.sql`

- Adds nullable `organic_posts.thumbnail_cached_url text` with a comment explaining the hotlink rationale.
- Creates the public `organic-thumbs` storage bucket (5 MB limit; `image/jpeg`, `image/png`, `image/webp`). Idempotent `on conflict (id) do update`.

**(b) Snapshot on ingest** — `fetch-instagram-posts` v5 @ 1.1.0

After every upsert cycle, the function fans out (concurrency 3) to download each new post's `thumbnail_url` server-side (Supabase runtime IP + Safari UA, 10s timeout, 5 MB cap, image/* content-type guard), uploads the bytes to `organic-thumbs/instagram/{platform_post_id}.jpg` with `x-upsert: true`, then patches the row's `thumbnail_cached_url`. Best-effort: individual failures are counted (`thumbnails_failed`) but never fail the ingest run. Response payload gains `thumbnails_snapshotted` and `thumbnails_failed` counters; `X-Function-Version: fetch-instagram-posts@1.1.0` header.

**(c) One-off backfill** — `backfill-organic-thumbs` v1

POST-only helper for rows that pre-date the snapshot shipper. Body: `{platform?: "instagram"|"youtube", batch?: 1-100, dry_run?: bool}`. Selects `organic_posts` where `thumbnail_cached_url is null and thumbnail_url is not null`, ordered by `first_seen_at desc`, downloads bytes, magic-byte content-type detection (0x89,0x50 = PNG; 0x52,0x49 + 0x57@8 = WebP; else JPEG), uploads via the same storage convention, patches the row.

Run result: **IG 371/371, YT 151/151, 0 failures, remaining_null = 0.** All 522 pre-existing posts now mirrored.

**(d) Runtime proxy fallback** — `proxy-thumbnail` v1

GET `/functions/v1/proxy-thumbnail?url=<encoded-original>` with a strict host allow-list (`scontent.*.cdninstagram.com`, `*.fbcdn.net` variants). Server-side fetch, streams bytes back with `Cache-Control: public, max-age=86400, s-maxage=86400`. Purpose: catch any row that somehow slips through the snapshot-on-ingest path (e.g. API transients). `verify_jwt: true`; strict host allow-list prevents SSRF.

**(e) UI wiring** — `src/components/OrganicIntel.jsx`

```
primaryThumb =
  firstFrameUrl                                // analysed posts (Trend Reports pattern)
  || post.thumbnail_cached_url                 // snapshot-on-ingest / backfilled
  || buildProxyThumbUrl(post.thumbnail_url)    // runtime fallback
  || null
```

`buildProxyThumbUrl` matches host against `/(?:^|\.)(cdninstagram\.com|fbcdn\.net)$/i`. Non-matching hosts fall through unchanged so YouTube `i.ytimg.com` thumbs go direct. Placeholder copy changed from "Preview blocked" to "Preview unavailable" to better reflect post-PR #36 semantics (reaching the placeholder means all three layers missed).

### 2. Percentile bulk selector

New pill row inside the existing bulk bar (only visible when `eligibleCount > 0`).

- 4 preset buttons: 2.5%, 5%, 10%, 20%. Each button label shows the count it will select as `N pct (M)` derived live from the current eligible pool.
- `selectTopPercentile(pct)` ranks `selectablePosts` by `metricsByPost[id].views` desc (tie-break: post order), takes `Math.max(1, Math.ceil(eligibleCount * pct / 100))`, and sets `selectedIds` accordingly. Also sets `percentile` state so the active pill highlights.
- `clearSelection()` now also resets `percentile` to null.
- Zero network cost: all metrics used for ranking are already loaded into `metricsByPost` by the existing post-fetch hydration.

On calo.uk (35 eligible videos): 2.5% = 1, 5% = 2, 10% = 4, 20% = 7.

## Production state at handover

- **Home:** https://creative-kitchen-static.vercel.app
- **main:** `6973398 feat(organic-intel): server-side thumbnail snapshots + percentile bulk selector (#36)`
- **Migration:** `20260417180000_organic_thumbnails_cache.sql` applied.
- **Edge functions now deployed:** `proxy-thumbnail` v1 ACTIVE, `backfill-organic-thumbs` v1 ACTIVE, `fetch-instagram-posts` v5 @ 1.1.0 ACTIVE. Total edge function count moves from 30 to 32. All 32 enforce `verify_jwt: true`.
- **Storage:** public bucket `organic-thumbs` live, 522 objects across `instagram/` and `youtube/` prefixes.
- **organic_posts.thumbnail_cached_url:** 522 of 522 non-null after backfill run.

## Verification cheatsheet

To re-verify thumbnails:

1. Organic Intel, pick any IG handle with non-analysed posts (e.g. calo.uk).
2. Open a card's network request for the thumbnail. The URL should be `https://ifrxylvoufncdxyltgqt.supabase.co/storage/v1/object/public/organic-thumbs/instagram/<pid>.jpg` for rows covered by snapshot / backfill, or a `/functions/v1/proxy-thumbnail?url=...` call for any row that escapes (should be rare).
3. YouTube posts should still resolve directly to `https://i.ytimg.com/...`; no proxy URL.

To re-verify the percentile selector:

1. Organic Intel, calo.uk.
2. Bulk bar visible. Pills read `Top % by views: 2.5% (1) · 5% (2) · 10% (4) · 20% (7)`.
3. Click 10%, counter reads "4 selected of 35 eligible videos"; the 4 highest-view posts are checked.
4. Click Clear, counter returns to 0 and active pill highlight clears.

## Open items for the next session

### Still deferred (unchanged from PR #35 handover)

1. Rotate Apify token (leaked in chat earlier this week). Replace Supabase function secret `APIFY_TOKEN` used by `fetch-instagram-posts`.
2. Rotate YouTube Data API key (same, leaked). Replace `YOUTUBE_API_KEY` used by `fetch-youtube-posts`.
3. Close Asana tasks `1214111637586477` (OCR Phase 2) and `1214111637546592` (generate-ugc-brief Phase 2). Code shipped; only tickets open.
4. `debug-auth` (soft-retired 16 Apr, HTTP 410 Gone) is still deployed. Hard-delete around 23 Apr once no traffic for 7 days is confirmed.
5. Stale duplicate `src/CompetitorAds.jsx`. Phase 3 cleanup; no runtime impact.

### New, opened by this PR

6. YouTube snapshot-on-ingest parity. `backfill-organic-thumbs` already handles YT on request, but `fetch-youtube-posts` does not yet mirror thumbs on ingest. YT thumbs are not currently hotlink-blocked, so this is low-priority insurance.
7. `proxy-thumbnail` should rarely be hit now. Monitor its invocation count over the next 7 days. If consistently zero, safe to leave. If non-zero, investigate which rows are slipping through (likely candidates: ingest-time network flakes, Apify thumb_url churn between fetches).
8. Consider a migration to drop or repurpose `organic_posts.thumbnail_url` once the mirror has proven itself for a full retention window. Not urgent.

## Reference

- PR: https://github.com/willagpt/creative-kitchen-static/pull/36
- Squash commit: https://github.com/willagpt/creative-kitchen-static/commit/6973398d9a5a556fbde5215c52bd0efc89937137
- Migration: `supabase/migrations/20260417180000_organic_thumbnails_cache.sql`
- Companion: PR #35 handover at `docs/handover-2026-04-17-organic-intel-thumb-bulk-analyse.md`
- Precedent for the thumb fallback pattern: `src/components/TrendReports.jsx` around lines 1080 to 1135.
