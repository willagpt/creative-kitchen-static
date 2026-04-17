# Handover — 17 April 2026 (session close + Asana restructure)

Session close note covering the wrap on Phase 3c, the verification of the cron pipeline in production, and the Asana project structure for the remaining roadmap. Intended as the first thing the next session reads.

## What this session shipped

Phase 3c Organic Intelligence is live and proven end-to-end in production.

1. **Orchestrator auth fix.** `trigger-organic-fetches` was returning 401 on per-account dispatch because Supabase auto-injects `SUPABASE_SERVICE_ROLE_KEY` in the modern `sb_secret_...` format, which PostgREST accepts but the edge-function gateway (`verify_jwt: true`) rejects. Patched the orchestrator to forward the caller's `Authorization` header into both `apikey` and `Bearer` on dispatch, with an optional `ORG_CRON_SERVICE_KEY` env override. Deployed as `trigger-organic-fetches@1.1.0` (Supabase function version 4, sha256 `9c97fad0d05759a0236397fc91891c9e30a0d81fed39511ab0a4ba074757fd1a`).

2. **Cron jobs armed.** All three `pg_cron` jobs active:
   - `organic_fetch_instagram_daily` at 02:15 UTC
   - `organic_fetch_youtube_morning` at 06:30 UTC
   - `organic_fetch_youtube_evening` at 18:30 UTC

3. **Manual fire verification (2026-04-17 12:11:51 UTC).** Called `public._trigger_organic_platform('instagram')` and `public._trigger_organic_platform('youtube')` in parallel. Results:
   - IG: 4 accounts dispatched, 4 succeeded, 0 failed, 200 posts, $0.46 spend. Accounts: `hellofreshuk`, `huel`, `mindfulchefuk`, `pastaevangelists`.
   - YT: 7 accounts dispatched, 7 succeeded, 0 failed, 140 posts, 14 quota units. Accounts: `ethanchlebowski`, `hellofreshuk`, `huelyt`, `madeleineolivia`, `mindfulchefuk`, `mynameisandong`, `pickuplimes`.
   - Today's total: IG $0.85 of $1.00 daily cap, YT 20 of 8000 monthly units. Both well inside budget.

4. **Proven call path.** `pg_cron` → `public._trigger_organic_platform(text)` (SECURITY DEFINER) → `vault.decrypted_secrets(organic_cron_service_key)` → `net.http_post` (60s timeout) → `trigger-organic-fetches@1.1.0` → per-account `fetch-instagram-posts` or `fetch-youtube-posts` → `organic_posts` upsert + `organic_post_metrics` append + `organic_fetch_log` + `last_fetched_at` bump.

5. **Asana ticket structure** for the roadmap. Split the work into two projects (stabilisation vs features) so the roadmap view stays clean and product-facing stakeholders don't need to see tech debt.

## Ticket map

### Creative Kitchen Static — Engineering Stabilisation

Project: https://app.asana.com/1/5717506944667/project/1214024873723525
Section: Phase 3: Clean Up & Refactor

| Ticket | Due | Summary |
|---|---|---|
| [Organic Intel observability polish](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214111674092818) | 30 Apr | Per-account run history drawer + 80% budget warning banner on OrganicIntel. |
| [Facebook snapshot CSP fallback](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214111738524876) | 2 May | Verify iframe CSP in prod; if blocked, build server-side screenshotter. |
| [Foreplay competitor fetch orchestrator](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214111655347530) | 18 May | Mirror Phase 3c pattern onto Foreplay competitor fetch. |

### Creative Kitchen Static — Product Features

Project: https://app.asana.com/1/5717506944667/project/1214111740362506

**In Flight**
- [VAE Phase 2 epic](https://app.asana.com/1/5717506944667/project/1214111740362506/task/1214111637447536) — Transcription + OCR + enriched briefs. Due 15 May.
  - Subtask: [Whisper transcription](https://app.asana.com/1/5717506944667/project/5717506944669/task/1214111674112796) — due 28 Apr
  - Subtask: [OCR per shot](https://app.asana.com/1/5717506944667/project/5717506944669/task/1214111637586477) — due 8 May
  - Subtask: [generate-ugc-brief consumes transcript + OCR](https://app.asana.com/1/5717506944667/project/5717506944669/task/1214111637546592) — due 15 May

**Next Up**
- Engagement trend view on `organic_post_metrics` (25 Apr to 5 May)
- Competitor ↔ organic creative cross-linking (5 May to 20 May)

**Backlog**
- Organic account management UI (20 May to 5 Jun)

**Shipped (history seed)**
- Phase 3c — Organic Intel cron orchestrator (17 Apr 2026)

## Deferred / outside Asana

These are tracked informally because creating tickets for them adds noise.

1. **Apify + YouTube Data API v3 key rotation.** Both leaked in an earlier session. Rotate in Supabase secrets (`APIFY_TOKEN`, `YOUTUBE_API_KEY`), then smoke test both fetchers. Est. 10 minutes.
2. **Cron watch.** Next unattended fires: YT tonight 18:30 UTC, IG tomorrow 02:15 UTC, YT tomorrow 06:30 UTC. If any fires differ from today's pattern (runs, posts, errors), diagnose. Otherwise mark Phase 3c officially bedded in.

## Pre-session checklist (next session)

Per project CLAUDE.md:

1. Read this handover, then `/docs/handover-2026-04-17-organic-intel-phase-3c.md` for the Phase 3c full detail.
2. Pre-flight: configure git credentials, clone repo, `npm install && npm run build`. Commands in `.claude/CLAUDE.md` under "Pre-Flight Check".
3. Confirm last night's cron jobs fired cleanly:
   ```sql
   SELECT l.started_at, l.platform, a.handle, l.status,
          l.posts_fetched, l.posts_new,
          l.cost_estimate AS usd, l.yt_quota_units AS yt_units
   FROM organic_fetch_log l
   JOIN followed_organic_accounts a ON a.id = l.account_id
   WHERE l.started_at >= '2026-04-17 18:00+00'
   ORDER BY l.started_at DESC;
   ```
4. Rotate the Apify + YT keys (Deferred item 1).
5. Pick an Asana ticket. Suggested priority order: Whisper transcription → Foreplay orchestrator → Organic Intel observability polish. Whisper first because VAE Phase 2 unblocks the brief enrichment chain; Foreplay second because the pattern is already known; observability polish third because it's the lightest lift.

## Gotchas + session-specific knowledge

1. **pg_net default timeout is 5 seconds.** When calling an edge function from the database, always pass `timeout_milliseconds := 60000` explicitly. An earlier diagnostic to `fetch-instagram-posts` timed out at 5003ms because Apify calls take ~15s. The orchestrator's helper function `public._trigger_organic_platform(text)` already sets 60s correctly.

2. **sb_secret_ vs legacy JWT.** Auto-injected `SUPABASE_SERVICE_ROLE_KEY` is in the new `sb_secret_...` format. PostgREST accepts both via `apikey` header. The edge-function gateway does NOT accept `sb_secret_` for `verify_jwt: true` functions. The vault secret `organic_cron_service_key` stores the legacy JWT format for this reason. If function-to-function dispatch ever returns 401, this is the first place to check.

3. **Shared Supabase ref.** `creative-kitchen-static` and `creative-kitchen-video-v3` share `static_*` tables in the `ifrxylvoufncdxyltgqt` Supabase project. Be careful not to introduce breaking schema changes without considering both apps.

4. **Single source of truth.** GitHub, not session code. Never deploy edge functions directly to Supabase from session code. Commit to the repo first, deploy from there.

5. **Ticket-first for multi-file work.** Per project CLAUDE.md, anything touching more than one file should have an Asana ticket first. Most roadmap work now has one.

## Files changed this session

- `supabase/functions/trigger-organic-fetches/index.ts` → v1.1.0 auth fix (committed in previous session and deployed during this session).
- `.claude/CLAUDE.md` → Phase 3c status updated (noted in previous session handover).
- No new files this session. All Asana work was UI-side.

## Writing style reminder

No em dashes or en dashes in any generated content. Use commas, colons, full stops, or arrows (→). Ranges as "2 to 3", not "2-3". Applies to code, briefs, commit messages, and handover docs like this one.

---

Ready for next session to pick up. Start with the pre-session checklist, rotate the keys, then pull the Whisper subtask.
