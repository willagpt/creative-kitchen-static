# Handover: Organic Intel Phase 3b complete, Phase 3c + key rotation next

Date: 17 April 2026
Author: previous session (Claude)
Status: Phase 3b shipped and live. 3c + key rotation are the next tasks.

## What shipped in this session

### Phase 3a (already in repo at start of session)
Frontend `Organic Intel` tab live at `/organic-intel`. Source: `src/components/OrganicIntel.jsx` + `.css`. List view (All / IG / YT filters), detail view (last run meta, totals bar, up to 50 most recent posts). Data was fetched via three PostgREST calls and grouped client side.

### Phase 3b (new)
Replaced the three client side calls with a single Supabase RPC.

- Migration: `supabase/migrations/20260417100000_create_list_organic_accounts_with_stats_rpc.sql`
- Function: `public.list_organic_accounts_with_stats(p_platform text, p_active_only boolean)`
- Returns one row per followed account, left joined to its most recent `organic_fetch_log` row and its `organic_posts` count.
- `security invoker`, `search_path = public`, `stable`, execute granted to `anon, authenticated, service_role`.
- Frontend change: `src/components/OrganicIntel.jsx` → new `callRpc` helper + `loadAll` now does one POST to `/rest/v1/rpc/list_organic_accounts_with_stats`. State shape is unchanged so `AccountCard`, `AccountsList`, `PostCard`, `AccountDetail` needed zero edits.
- Commit: `d6cb8a6`. Vercel deployment: `dpl_Es1ReyKPVmxMcPeMxu6h7TXJLx9b` (READY, production). Live bundle `/assets/index-BZ0kQLUG.js` verified to contain `list_organic_accounts_with_stats` + `/rest/v1/rpc/`.

RPC smoke test results:
- 21 rows returned (11 IG + 10 YT) with `p_active_only = true`, `p_platform = null`.
- Total `post_count` across rows: 30 (20 IG + 10 YT), matches `organic_posts` row count.
- 3 accounts have `latest_*` populated (the 3 accounts that have been fetched so far). All others have nulls for `latest_log_id` etc.

## What's next

### Phase 3c → scheduled cron
Goal: daily Instagram fetches + twice daily YouTube fetches with staggered kickoffs, and budget guard rails.

Two viable implementations, pick one:

1. Postgres `pg_cron` + `pg_net`. Simplest. Cron job calls the edge function via `net.http_post(...)` with the service role key in the Authorization header. All scheduling state lives in Postgres. Supabase supports `pg_cron` natively on paid plans.
2. Supabase Scheduled Functions (aka Supabase Cron in the dashboard). Cleaner separation but still beta in some regions; check availability for `ifrxylvoufncdxyltgqt`.

Recommended schedule (all UTC):
- Instagram: once per day at 02:15 UTC. Cost guard: skip if current day's total `organic_fetch_log.cost_estimate` for platform=instagram exceeds `$1.00` (gives ~$30 per month headroom).
- YouTube: twice per day at 06:30 and 18:30 UTC. Quota guard: skip if current month's sum of `yt_quota_units` exceeds 8,000 (80% of the 10,000 daily quota × 30 conservative monthly budget).
- Stagger per account within each run: `ORDER BY handle` and add a 30 second sleep between account invocations, so a burst of 10 to 20 accounts doesn't collapse into one second.

Either approach should:
- Read `followed_organic_accounts` where `is_active = true AND (last_fetched_at IS NULL OR last_fetched_at < now() - interval 'X')` where X is 20 hours for IG and 11 hours for YT.
- Call the appropriate edge function (`fetch-instagram-posts` or `fetch-youtube-posts`) with `{ handle, mode: 'fetch' }` for each account.
- On error, rely on the edge function to log into `organic_fetch_log` with `status = 'error'`. Do not retry inside the cron; next run will pick it up.

Observability to add:
- A second RPC `list_fetch_runs_summary(p_since timestamptz)` returning daily totals per platform (runs, successes, errors, posts_new, cost_estimate, yt_quota_units). Surface on the Organic Intel tab as a small header strip.

### Key rotation (deferred from 3a)
Two secrets in production edge functions need rotation. Both are currently set via Supabase CLI secret storage for the `ifrxylvoufncdxyltgqt` project. Rotation steps are identical for both:

1. Apify `APIFY_TOKEN` (used by `fetch-instagram-posts`)
  - Log into Apify, create a new personal API token scoped to the `apify/instagram-scraper` actor.
  - `supabase secrets set APIFY_TOKEN=<new>` via CLI, or set from the Supabase dashboard under Edge Functions → Secrets.
  - Redeploy `fetch-instagram-posts` (or just restart, env reads on cold start).
  - Revoke the old token in Apify once `organic_fetch_log` shows a successful run on the new key.

2. YouTube Data API v3 `YOUTUBE_API_KEY` (used by `fetch-youtube-posts`)
  - Create a new API key in the same Google Cloud project, restrict to YouTube Data API v3 + HTTP referrers optional.
  - `supabase secrets set YOUTUBE_API_KEY=<new>`.
  - Redeploy `fetch-youtube-posts`.
  - Delete the old API key in GCP once a successful run is logged.

Do rotation BEFORE Phase 3c goes live so the first scheduled runs are already on fresh keys.

### Video Analysis Engine Phase 2
Still pending from the main roadmap: Whisper transcription + OCR for shots. Not started.

## Useful pointers

- DB project ref: `ifrxylvoufncdxyltgqt` (EU Central, shared with static_* tables).
- Edge functions live in `supabase/functions/<name>/index.ts`. `fetch-instagram-posts` = v4, `fetch-youtube-posts` = v2.
- Sandbox Vite build is broken in this environment (282KB bundle with no app code, missing rolldown native binding). Do NOT trust local `npm run build` as a verification step; push to a branch and let Vercel build, or `npx esbuild <file.jsx> --loader:.jsx=jsx --format=esm` for a syntax smoke test.
- Writing style rule: no em dashes or en dashes anywhere in generated content. Use commas, colons, full stops, or arrows (`→`). Ranges as "2 to 3" not "2-3".

## Files added in this session
- `supabase/migrations/20260417100000_create_list_organic_accounts_with_stats_rpc.sql`
- `docs/handover-2026-04-17-organic-intel-phase-3b.md` (this file)

## Files modified in this session
- `src/components/OrganicIntel.jsx` (loadAll now calls RPC, added `callRpc` helper)
- `.claude/CLAUDE.md` (Phase 3b bullet added, Next line trimmed)
