# Handover — 17 April 2026 — Organic Intelligence Phase 1.1 + 1.5

## TL;DR

Phases 1.1 (schema) and 1.5 (CRUD edge functions) of the Organic Intelligence feature shipped today, cleanly, with the repo and the deployed Supabase state in sync. Next session picks up at **Phase 2: Apify-powered ingestion** (the piece that actually populates `organic_posts`).

## Repo state (as of 17 Apr 07:20 UTC)

- `main` == `develop` at `6f6a437` (`fix(migrations): align organic intel migration filename (#19)`).
- No open branches, no uncommitted work.
- Vercel preview on the last feature branch deployed green before merge.
- Supabase: 32 migrations registered; top of the stack is `20260417064915 create_organic_intel_tables`.

## What shipped

### Phase 1.1 — Schema (PR #15)

Four new tables, all RLS-enabled, all with the same permissive-public pattern used elsewhere in this project (`using (true)` / `with check (true)` on all four verbs).

| Table | Purpose |
|---|---|
| `followed_organic_accounts` | The accounts we track. Natural key: `UNIQUE (platform, platform_account_id)`. `platform` is `CHECK ('instagram' \| 'youtube')`. |
| `organic_posts` | Individual posts we've scraped. FK to `followed_organic_accounts (id) ON DELETE CASCADE`. Natural key: `UNIQUE (platform, platform_post_id)`. |
| `organic_post_metrics` | Time-series snapshots of reach / likes / comments per post. FK to `organic_posts (id) ON DELETE CASCADE`. |
| `organic_fetch_log` | Audit trail of Apify runs (source `apify_instagram` or `apify_youtube`). FK to `followed_organic_accounts (id) ON DELETE SET NULL`. |

Indexes:

- `organic_posts (account_id, posted_at desc)` → powers the "recent posts per account" UI and the list-organic-posts ordering.
- `organic_post_metrics (post_id, captured_at desc)` → powers "latest metrics for this post" reads.

Migration file: `supabase/migrations/20260417064915_create_organic_intel_tables.sql` (filename now matches the deployed version — see "Gotcha" section below).

### Phase 1.5 — CRUD endpoints (PR #16 → #17)

Three edge functions, all `verify_jwt: true`, all deployed to `ifrxylvoufncdxyltgqt`, all end-to-end tested against the live DB via the anon key.

**1. `list-organic-accounts` (v1)**
- GET + POST. Filters: `platform`, `is_active`. Pagination: `limit` (1-500, default 100), `offset`. Returns exact `total` via a second count-only PostgREST call.
- Ordered `brand_name.asc, platform.asc` for a stable UI.

**2. `save-organic-account` (v1)**
- POST only. Action field: `upsert` (default) | `activate` | `deactivate`.
- **Upsert** uses PostgREST `?on_conflict=platform,platform_account_id` + `Prefer: return=representation,resolution=merge-duplicates`. Idempotent: same natural key returns the same id, with mutable fields merged in. Verified end-to-end.
- **Activate / deactivate** accept either `id` or `(platform, platform_account_id)` and toggle `is_active` without deleting. Posts + history are preserved.
- Required fields for upsert: `brand_name`, `platform`, `handle`, `platform_account_id`. Optional: `uploads_playlist_id`, `is_active`, `fetch_frequency`.

**3. `list-organic-posts` (v1)**
- GET + POST. Filters: `account_id` (UUID-validated before hitting PostgREST), `platform`, `post_type`, `language`, `posted_after`, `posted_before`. Pagination: `limit` (1-500, default 100), `offset`.
- Ordered `posted_at desc nullslast` → matches the `organic_posts (account_id, posted_at desc)` index.
- Returns exact `total` via `Prefer: count=exact` on the same call (parses `Content-Range`).

### Tests run (13 cases, all green)

1. Empty state (`total: 0`)
2. Invalid platform → 400 with human-readable error
3. Upsert new account → returns new row with UUID
4. Upsert same natural key → same id, updated `brand_name` (proves merge-duplicates is working)
5. Missing required fields → 400 listing the missing keys
6. Deactivate by natural key → `is_active: false`
7. `is_active=false` filter returns just the deactivated row
8. Reactivate → `is_active: true`
9. `list-organic-posts` empty state
10. All filters echoed back in response metadata
11. Invalid UUID → 400 ("account_id must be a uuid")
12. POST body path
13. `list-organic-accounts` POST body path

Test row `ig_1_test` was cleaned up at the end (via `execute_sql`, one-line DELETE).

## Supabase edge function count

**27 deployed.** All 27 enforce `verify_jwt: true`. Verified via `list_edge_functions`. Breakdown in `.claude/CLAUDE.md` under "Edge Functions" — Phase 1.5 adds functions 25-27 under a new "Organic Intelligence (Phase 1.5)" subsection.

## Gotcha spotted + fixed this session

Migration filename drift: the migration was applied via `apply_migration` (Supabase MCP) before the repo-side filename was finalised, leaving a ~66s drift between the filename timestamp (`20260417064809`) and the version actually recorded in `supabase_migrations.schema_migrations` (`20260417064915`).

Without a fix, `supabase db pull` or a fresh `supabase db push` would have seen this as a missing migration and tried to re-apply it. PR #18 / #19 renamed the file to match the deployed version. **Pattern to avoid next time:** compose the filename and the migration name first, apply once, don't re-call `apply_migration` with different params.

## Asana

- ✅ [Ticket 1214100586314726 — Phase 1.1](https://app.asana.com/0/1214024873723525/1214100586314726) — closed this morning.
- ✅ [Ticket 1214098892700507 — Phase 1.5](https://app.asana.com/0/1214024873723525/1214098892700507) — closed this afternoon with a full delivery comment.

Remaining Organic Intelligence tickets still open under "Creative Kitchen — Engineering Stabilisation" cover Phase 2 (Apify ingestion) and Phase 3 (UI + scheduler).

## What a Phase 2 session should pick up

1. **Seed real accounts** — one-off call to `save-organic-account` to add Simmer IG + Huel YouTube (or whichever starter list we agreed). Quick sanity check before writing the Apify glue.
2. **Build `fetch-organic-posts-instagram`** and **`fetch-organic-posts-youtube`** edge functions that pull from Apify, dedupe against `UNIQUE (platform, platform_post_id)`, and append to `organic_post_metrics`.
3. **Log every run to `organic_fetch_log`** with `source`, `status`, `posts_fetched`, `credits_used`, `error_message`. Mirror the `foreplay_credit_log` pattern so we can audit spend.
4. **Wire a scheduler** — cron via `pg_net` or Supabase scheduled functions — to call each ingestion function at the `fetch_frequency` configured on the account.
5. **Add yt-dlp to the video-worker image** (already planned per CLAUDE.md) so we can later pull YouTube videos into the video analysis pipeline using the same worker we use for FB ads.

## Open questions for Phase 2

- Apify actor choice: the plan doc in `docs/organic-intel-decisions.md` picks specific actor IDs — confirm before implementation.
- Credit budgeting: do we want per-account caps or per-run caps? `foreplay_credit_log` uses per-run; probably match that.
- Dedupe policy: when a post appears again with changed captions, do we update `creative_body` in place, or append to `organic_post_metrics` only? Currently the schema supports either — we need to pick before writing the ingestion function.

## Key references

- Spec: `docs/organic-intel-decisions.md` (D1-D8)
- Migration: `supabase/migrations/20260417064915_create_organic_intel_tables.sql`
- Edge function source: `supabase/functions/{list-organic-accounts,save-organic-account,list-organic-posts}/index.ts`
- CLAUDE.md: "Edge Functions" section, new "Organic Intelligence (Phase 1.5)" subsection
- PRs: [#15](https://github.com/willagpt/creative-kitchen-static/pull/15), [#16](https://github.com/willagpt/creative-kitchen-static/pull/16), [#17](https://github.com/willagpt/creative-kitchen-static/pull/17), [#18](https://github.com/willagpt/creative-kitchen-static/pull/18), [#19](https://github.com/willagpt/creative-kitchen-static/pull/19)

## Quick smoke test next session (paste into terminal)

```bash
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA"
URL="https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1"

# Confirm all three endpoints are alive
curl -sS "$URL/list-organic-accounts" -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY"
curl -sS "$URL/list-organic-posts"    -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY"

# Seed one account
curl -sS -X POST "$URL/save-organic-account" \
  -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"brand_name":"Simmer","platform":"instagram","handle":"simmereats","platform_account_id":"<IG_USER_ID_HERE>"}'
```

Expect `success: true` on all three. Any 401 → anon key rotated; any 500 → check edge function logs in Supabase dashboard.

---

Generated at the end of the 17 Apr session. Next session owner: probably the same Claude, fresh context.
