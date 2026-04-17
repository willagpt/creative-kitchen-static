# Handover — Organic Intelligence Phase 2 (17 April 2026)

Owner: James
Scope: Phase 2 of Organic Intelligence. Two ingestion pipelines now live and verified end-to-end.

## What shipped

1. **`fetch-instagram-posts`** (edge function, v4) — Apify ingestion for Instagram.
2. **`fetch-youtube-posts`** (edge function, v2) — YouTube Data API v3 ingestion with Shorts detection.
3. 10 IG accounts + 10 YT accounts seeded in `followed_organic_accounts`.
4. Apify token and YouTube Data API key configured as Supabase edge function secrets.
5. End-to-end verification against live data in the production Supabase project.

## Tables touched

| Table | Role |
|-------|------|
| `followed_organic_accounts` | Source of truth for which IG/YT accounts we ingest. 20 rows active. |
| `organic_posts` | One row per post. Idempotent upsert on `(platform, platform_post_id)`. |
| `organic_post_metrics` | Time series, append-only. One row per fetch per post. |
| `organic_fetch_log` | One row per fetch run. Tracks cost (Apify USD) or quota (YT units), status, error. |

Status values enforced by CHECK: `running | success | error | partial`.

## Edge function details

### `fetch-instagram-posts` — v4

- Input: `{ handle, mode: "test"|"fetch", limit: 1..50 }`
- Pipeline: Apify actor `apify/instagram-scraper` (ID `shu8hvrXbJbY3Eb9W`, run sync-get-dataset-items) → map to `organic_posts` shape → upsert → append metrics → close log.
- Cost: ~$2.30 per 1000 results (Apify pricing). Logged in USD to `organic_fetch_log.cost_estimate`.
- post_type inference: `carousel` if multi-media; `reel` if video with duration set; `image` otherwise.
- Fields captured: `platform_post_id`, `post_url`, `post_type`, `video_url`, `thumbnail_url`, `caption`, `hashtags`, `posted_at`, `duration_seconds`, `audio_id`, `audio_title`, `language`, plus full `raw` JSON.
- Metrics captured: `views`, `likes`, `comments`.
- Fix shipped this session: log status values changed from `complete` to `success` to satisfy the CHECK constraint.

### `fetch-youtube-posts` — v2

- Input: `{ handle, mode: "test"|"fetch", limit: 1..50 }`
- Pipeline:
  1. Resolve account → `uploads_playlist_id` (channel `UC...` → `UU...`).
  2. `playlistItems.list` (1 quota unit) → `videos.list` with `part=snippet,contentDetails,statistics` (1 quota unit) → 2 units total per fetch.
  3. For each video with `duration <= 60s`: HEAD probe `https://www.youtube.com/shorts/{id}` with `redirect: "manual"`. 2xx or Location containing `/shorts/` ⇒ Short. Otherwise regular `/watch?v={id}`.
  4. Map post_type to `short | video | livestream` (livestream derived from `liveBroadcastContent`).
  5. Upsert into `organic_posts`, append metrics, update `last_fetched_at`, close log.
- Quota: 10,000 units per day per Google project. Edge function enforces a **monthly** budget via `organic_fetch_log.yt_quota_units` sum since `date_trunc('month', now())`; default budget 10,000 units; 80% warning.
- Fields captured: `platform_post_id`, `post_url`, `post_type`, `thumbnail_url` (best of default→medium→high→standard→maxres), `title`, `caption` (description), `hashtags` (from description + tags), `posted_at`, `duration_seconds`, `language`, full `raw`.
- Metrics captured: `views`, `likes`, `comments`.

## Verification performed (17 Apr 2026)

### fetch-instagram-posts
- `simmer.eats` `mode:"fetch"` `limit:10` → 10 posts upserted, 10 metrics rows, log status=success, cost_estimate=$0.023.
- `eat.ping` `mode:"fetch"` `limit:10` → 10 posts upserted, 10 metrics rows, log status=success.
- Idempotent re-fetch confirmed (posts_new=0 on subsequent call, metrics appended).

### fetch-youtube-posts
- `huelyt` `mode:"test"` `limit:5` → 2 quota units, 5 posts sampled.
- `thebodycoachtv` `mode:"test"` `limit:8` → 2 quota units, mixed content (20 min workouts, 80s clips) correctly flagged `is_short:false`.
- `aragusea` `mode:"test"` `limit:10` → 2 quota units, 10 long-form videos, 0 shorts (matches creator pattern).
- `goustocouk` `mode:"fetch"` `limit:10` → 10 posts upserted, 0 shorts, 10 metrics rows, log status=success, yt_quota_units=2.
- Idempotent re-fetch → posts_new=0, +10 metrics rows (20 total), month_quota_used=4.

### Shorts detection correctness note
Short-duration videos (< 60s) on brand channels that are NOT published to the Shorts shelf are correctly classified as `post_type=video` (not `short`). This matches YouTube's own classification: `/shorts/{id}` redirects to `/watch` for these, so our HEAD probe returns the redirect and we trust it over duration alone. This is the right behaviour for ad-sponsored or regular uploads that happen to be short.

## Secrets

Set in Supabase project `ifrxylvoufncdxyltgqt` as edge function secrets:
- `APIFY_TOKEN` — Apify Personal API token (current session's exploratory value; **rotate after Phase 2 sign-off**).
- `YOUTUBE_API_KEY` — Google Cloud API key restricted to YouTube Data API v3 (**rotate after Phase 2 sign-off**).

## Known limitations / open items

1. **No schedule yet.** Phase 3 will wire a daily cron (pg_cron or Supabase Scheduled Functions) invoking both fetchers for all `is_active=true` accounts.
2. **No frontend surface yet.** Organic posts are ingested but not yet rendered in the Creative Kitchen Static UI. Phase 3 item.
3. **Apify cost visibility.** `cost_estimate` is a rough forward estimate based on result count. Actual Apify run cost reported in the actor payload should be swapped in.
4. **Shorts probe latency.** HEAD probes add ~100 to 300ms per ≤60s video. Acceptable at current volumes; revisit if we fetch large channels.
5. **YouTube quota is shared across projects.** We account for usage per Supabase project via `organic_fetch_log.yt_quota_units`, but Google's dashboard is the source of truth.

## Tickets to close

Mark these complete in the "Creative Kitchen — Engineering Stabilisation" Asana project:
- 1.2: Provision Apify token and store as Supabase secret.
- 1.3: Seed 10 IG accounts + 10 YT accounts into `followed_organic_accounts`.
- 1.4: Build and deploy `fetch-instagram-posts`.
- 2.1: Provision YouTube Data API v3 key and store as Supabase secret.
- 2.2 / 2.3: Build and deploy `fetch-youtube-posts` with Shorts detection.
- 2.4: Verify YT seeding and end-to-end fetch.

## Next session prep

- Phase 3 kickoff: draft schedule + rate-limit policy (IG daily during business hours, YT 2x daily). Consider staggered kickoff to avoid quota spikes.
- Add a Supabase RPC that joins `followed_organic_accounts` → latest `organic_fetch_log` so the UI can render last-run state.
- Start the organic library view in Creative Kitchen Static (list of IG + YT accounts, last fetched, most recent posts with metrics).
