# Organic Intelligence — Phase 3c Handover

**Date:** 17 April 2026
**Status:** shipped, cron DISABLED on ship pending key rotation + vault populate
**Author:** working session, continuing from `handover-2026-04-17-organic-intel-phase-3b.md`

## What shipped

Phase 3c closes the Organic Intelligence loop by making the fetch pipeline automatic. Before today, a human had to manually invoke `fetch-instagram-posts` and `fetch-youtube-posts` per account. Now a scheduled cron orchestrator drives the whole thing, with budget guards that stop the run before money is spent if the monthly or daily cap has already been reached.

### 1. New edge function: `trigger-organic-fetches` (v2)

Source: `supabase/functions/trigger-organic-fetches/index.ts`. Deployed with `verify_jwt: true` (project convention).

Request shape:

```json
{
  "platform": "instagram" | "youtube",
  "idle_hours": 20,             // optional, override per-platform default
  "limit_per_account": 50,       // optional, override fetcher default
  "stagger_ms": 30000,           // optional, delay between account calls
  "max_accounts": 50,            // optional, safety cap per run
  "dry_run": false               // optional, plan only, no side effects
}
```

Per-platform defaults:

| Platform  | idle_hours | limit/account | orchestrator cap       |
|-----------|------------|---------------|------------------------|
| instagram | 20         | 50            | $1.00 USD / UTC day    |
| youtube   | 11         | 20            | 8000 units / UTC month |

Behaviour:

1. Pre-flight budget guard. For IG, sum `cost_estimate` from `organic_fetch_log` since the UTC day start; if >= $1.00, return `status: "budget_exhausted"` and dispatch nothing. For YT, sum `yt_quota_units` since the UTC month start; if >= 8000, return `status: "quota_exhausted"`.
2. Due-account selection. Read `followed_organic_accounts` for the target platform with `is_active = true`, then filter client-side to those where `last_fetched_at IS NULL` OR `last_fetched_at < now() - idle_hours`. Capped at `max_accounts`.
3. Dispatch. For each due account, POST to `fetch-instagram-posts` or `fetch-youtube-posts` with `{handle, mode: "fetch", limit}`. Wait `stagger_ms` between calls so a batch does not collapse into a one-second spike. Per-account errors do not fail the run; the underlying fetcher logs its own `status: "error"` to `organic_fetch_log`.
4. Response. Aggregate counts (`dispatched`, `succeeded`, `failed`) plus a per-account `results` array with http_status and posts_fetched/posts_new if available.

Verification:

- IG dry_run (11:05 UTC today): `budget_used: 0.046, budget_cap: 1, due_count: 9`, zero fetch_log rows created.
- YT dry_run (11:05 UTC today): `budget_used: 4, budget_cap: 8000, due_count: 9`, zero fetch_log rows created.

### 2. pg_cron schedule

Migration: `supabase/migrations/20260417140000_phase3c_cron_schedule.sql`.

Installs `pg_cron` (pg_net was already present) and creates three jobs, all DISABLED on ship:

| Job name                            | Schedule (UTC) | Platform  |
|-------------------------------------|----------------|-----------|
| `organic_fetch_instagram_daily`     | `15 2 * * *`   | instagram |
| `organic_fetch_youtube_morning`     | `30 6 * * *`   | youtube   |
| `organic_fetch_youtube_evening`     | `30 18 * * *`  | youtube   |

Each job runs `select public._trigger_organic_platform('<platform>');`.

### 3. Cron helper: `public._trigger_organic_platform(text)`

Same migration as above. SECURITY DEFINER, executable by `service_role` only. Reads the service role JWT from `vault.decrypted_secrets where name = 'organic_cron_service_key'` and POSTs to the orchestrator via `net.http_post` (pg_net). Returns the `net.http_post` request id. Raises if the vault secret is empty so cron jobs fail loudly rather than silently firing unauthenticated.

### 4. Observability RPC: `public.list_fetch_runs_summary(since)`

Migration: `supabase/migrations/20260417140100_create_list_fetch_runs_summary_rpc.sql`.

Signature:

```sql
list_fetch_runs_summary(p_since timestamptz default now() - interval '30 days')
returns table (
  day date,
  platform text,
  runs bigint,
  successes bigint,
  errors bigint,
  partial_count bigint,
  running_count bigint,
  posts_fetched bigint,
  posts_new bigint,
  cost_estimate numeric,
  yt_quota_units bigint
)
```

Groups `organic_fetch_log` by `(started_at at time zone 'utc')::date` and platform, with `count(*) filter (where status = '...')` for each status bucket. Grants execute to anon, authenticated, service_role. Used by the Organic Intel UI strip described below.

Smoke test (30-day window as of today) returned two rows: 2026-04-17 instagram (2 runs, 2 successes, 20 posts_fetched, 20 posts_new, $0.046) and 2026-04-17 youtube (2 runs, 2 successes, 20 posts_fetched, 10 posts_new, 4 quota units).

### 5. UI observability strip

Files changed: `src/components/OrganicIntel.jsx` and `src/components/OrganicIntel.css`.

`OrganicIntel.jsx` now calls `list_fetch_runs_summary` in parallel with `list_organic_accounts_with_stats` (7-day window) and aggregates totals per platform into a new `runsSummary` state. The list view gains an `.oi-runs-strip` below the stats bar with a "Last 7 days" label and one chip per platform showing runs, successes, errors, posts_new, and `$cost` (IG) or quota units (YT). Error counts appear in the `.oi-runs-chip-err` accent colour when non-zero.

`OrganicIntel.css` appends four new selectors using the existing design tokens: `.oi-runs-strip`, `.oi-runs-strip-label`, `.oi-runs-chip`, `.oi-runs-chip-err`.

## How to turn the scheduler on

The cron jobs ship DISABLED on purpose. Two things must happen first.

### Step 1: Rotate leaked API keys

Earlier in the session the Apify token and YouTube Data API v3 key were both pasted into chat. Before letting the scheduler drive automated runs, rotate both:

- Apify: https://console.apify.com/settings/integrations → delete the old token, generate a new one, update the `APIFY_TOKEN` secret on `fetch-instagram-posts` in Supabase.
- YouTube Data API v3: https://console.cloud.google.com/apis/credentials → delete the old key, create a new restricted key (HTTP referrers or IP allow-list), update the `YOUTUBE_API_KEY` secret on `fetch-youtube-posts`.

Test each fetcher once with `{handle: "<any active account>", mode: "fetch", limit: 1}` after rotation to confirm the new keys work.

### Step 2: Populate the cron vault secret and enable the jobs

Once the keys are rotated, give pg_cron the service role JWT it needs to call the orchestrator. In the SQL editor on the production project (`ifrxylvoufncdxyltgqt`):

```sql
-- 1. Store the service role JWT from Project Settings → API (NOT the anon key).
select vault.create_secret(
  '<PASTE_SERVICE_ROLE_JWT_HERE>',
  'organic_cron_service_key',
  'Bearer token for trigger-organic-fetches cron helper'
);

-- 2. Enable all three cron jobs. cron.alter_job is the sanctioned API — direct UPDATE on cron.job is locked.
select cron.alter_job(jobid, active := true)
from cron.job
where jobname in (
  'organic_fetch_instagram_daily',
  'organic_fetch_youtube_morning',
  'organic_fetch_youtube_evening'
);

-- 3. Confirm they are active.
select jobid, jobname, schedule, active
from cron.job
where jobname like 'organic_fetch_%'
order by jobname;
```

If the vault secret ever needs to change:

```sql
-- Replace the secret without changing name/description.
select vault.update_secret(
  (select id from vault.secrets where name = 'organic_cron_service_key'),
  '<NEW_SERVICE_ROLE_JWT>'
);
```

### Step 3: Watch the first runs

After enabling, pg_cron will fire each job on schedule. Inspect:

```sql
-- Cron system view of recent runs.
select jobid, runid, job_pid, start_time, end_time, status, return_message
from cron.job_run_details
where start_time > now() - interval '2 days'
order by start_time desc
limit 20;

-- Application view of what the orchestrator and fetchers actually did.
select started_at, platform, status, posts_fetched, posts_new, cost_estimate, yt_quota_units, error_message
from public.organic_fetch_log
order by started_at desc
limit 20;
```

The UI strip on the Organic Intel tab will also show the new runs appear in the "Last 7 days" chips.

## How to stop the scheduler (emergency)

```sql
select cron.alter_job(jobid, active := false)
from cron.job
where jobname like 'organic_fetch_%';
```

Underlying fetchers still have their own second-line monthly caps ($30/mo IG, 10000/mo YT) so even if you forget to disable after a spend scare, damage is bounded.

## Files added or changed this session

New:

- `supabase/functions/trigger-organic-fetches/index.ts`
- `supabase/migrations/20260417140000_phase3c_cron_schedule.sql`
- `supabase/migrations/20260417140100_create_list_fetch_runs_summary_rpc.sql`
- `docs/handover-2026-04-17-organic-intel-phase-3c.md` (this file)

Modified:

- `src/components/OrganicIntel.jsx` (runsSummary state, parallel RPC, new strip JSX)
- `src/components/OrganicIntel.css` (appended `.oi-runs-strip*` selectors)
- `.claude/CLAUDE.md` (phase 3b + 3c status, edge function list, counts)

Deployed to Supabase:

- Edge function `trigger-organic-fetches` → v2 (SHA256 `793ee88c...`)
- Migration `phase3c_cron_schedule` → applied
- Migration `create_list_fetch_runs_summary_rpc` → applied

## Known deferred items

- Key rotation: must happen before enabling cron. Deliberately left to the operator.
- Agency tests: orchestrator was verified via dry_run only. The first live run will be the first real integration test of the orchestrator → fetcher dispatch pipeline. Recommend running `{platform: "instagram"}` once manually (non-dry_run) during business hours before letting cron own it, so any dispatch failure happens while someone is watching.
- YT orchestrator monthly cap (8000) vs fetcher monthly cap (10000): deliberately set the orchestrator lower so it bails before the fetcher's own cap trips. If that feels too tight once live, bump `YT_DEFAULTS.monthlyQuotaUnits` in `index.ts`.
- The cron vault secret is the project's service role JWT, which is itself rotatable. If the JWT is rotated upstream, call `vault.update_secret` with the new value; no migration rewrite needed.

## Next phase ideas (not shipped)

- Per-account priority scoring: right now all active accounts are equal. Could order by a "staleness score" (idle hours × follower count) so busy rotations surface new posts faster.
- Webhook on orchestrator completion to push a Slack message summarising runs, successes, errors, and posts_new.
- Expose an operator UI button on the Organic Intel tab that calls the orchestrator with `dry_run: true` so you can preview the next scheduled run without waiting for cron.
