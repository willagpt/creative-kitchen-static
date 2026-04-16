# Handover, Phase 2 (Branching + CI) and debug-auth soft-retirement

Date: 16 April 2026
Session outcome: shipped and verified.

This doc is the single source of truth for where we ended this session and
what the next session should pick up. If anything here contradicts
`.claude/CLAUDE.md`, `.claude/CLAUDE.md` wins, but please reconcile.

## TL;DR

1. Consolidated CI onto a single `.github/workflows/ci.yml` (Build on push/PR
   to `main` and `develop`) and documented the branching strategy in
   `docs/branching-and-ci.md`.
2. Soft-retired `debug-auth` end-to-end through a real `feature/* -> develop
   -> main` round trip (PR #2 -> PR #3). Live endpoint returns HTTP 410 Gone
   and still enforces `verify_jwt: true`.
3. While exercising the flow, discovered and fixed a silent bug in
   `.github/workflows/deploy-edge-functions.yml`: `actions/checkout@v4` was
   shallow-cloning, so `git diff HEAD~1 HEAD` matched nothing and every
   CI-driven edge function deploy was being skipped with a green tick.
   PR #4 -> PR #5 promoted the fix to `main`.

## Current state of `main`

Commit graph on `main` as of handover:

```
ec237c2 Promote deploy workflow fix to main (#5)
db44a48 Fix deploy-edge-functions shallow clone (#4)
bc65315 release: soft-retire debug-auth (develop -> main) (#3)
2680a62 feat(debug-auth): soft-retire to HTTP 410 Gone (#2)
17cc21f chore(ci): consolidate to single ci.yml, add branching strategy doc
```

Branches live in origin: `main`, `develop`. The feature branches
`feature/retire-debug-auth` and `feature/fix-edge-deploy-diff` are merged
and can be deleted at your leisure.

## What is deployed right now

- `debug-auth` -> Supabase version 6, `verify_jwt: true`, returns HTTP 410
  with JSON body `{"error":"Gone","message":"debug-auth has been
  retired...","retired_on":"2026-04-16"}`. Verified this session with a
  signed anon JWT against
  `https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1/debug-auth`.
- All 24 edge functions enforce `verify_jwt: true` (verified earlier this
  session and unchanged since).
- `.github/workflows/ci.yml` -> Build on push/PR to `main` and `develop`.
- `.github/workflows/deploy-edge-functions.yml` -> now uses
  `fetch-depth: 0` and diffs `github.event.before` against `github.sha`,
  with an explicit no-prior-commit bail-out for very first pushes.

## Still owed, next session should pick up

User UI actions (Claude cannot do these via MCP):

1. Branch protection rules on `main` and `develop`. Require PR and a
   passing `Build` status check. Rule sits in GitHub -> Settings -> Branches.
2. Close stale PR #1 (legacy, identified during the Phase 2 audit).
3. Delete legacy branches `dev`, `master`, `v1` if they still exist (they
   are not in origin as of this handover, but double-check).

Code-side follow-ups:

4. Real end-to-end test of the fixed deploy workflow. The next PR that
   changes any `supabase/functions/**` file will be the real validation.
   If it doesn't auto-deploy the changed function, the workflow logs will
   now show why (we added `::group::` logging plus the computed before to
   after range). debug-auth v6 was seeded manually via Supabase MCP this
   session because of the bug, so the workflow has not actually
   round-tripped yet.
5. Hard-delete `debug-auth` on or after 2026-04-23 once Supabase logs
   confirm zero traffic. Tracked as Asana task `1214111067447172` in
   "Creative Kitchen Static, Engineering Stabilisation", due 23 Apr.
   Steps are in the ticket body.

## Open Asana tickets of note

- `1214111067447172`, "Phase 2: hard-delete debug-auth edge function
  (after 7-day quiet period)". Due 23 Apr.
- Earlier Phase 2 tracking tickets in the same project remain open for
  branch protection + stale PR cleanup (UI items 1 to 3 above).

## Useful commands for the next session

Pre-flight from `/tmp`:

```bash
cp "/sessions/<session>/mnt/creative-kitchen-static/.claude/.git-credentials.txt" /tmp/.git-credentials
chmod 600 /tmp/.git-credentials
git config --global credential.helper "store --file=/tmp/.git-credentials"
git config --global user.email "james@freebirdburritos.com"
git config --global user.name "willagpt"
git clone https://github.com/willagpt/creative-kitchen-static.git /tmp/ck-static --depth 5
```

Probing debug-auth (should return 410):

```bash
ANON="eyJhbGciOiJIUzI1NiIs...ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA"
curl -i -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1/debug-auth
```

Checking CI on an open PR via REST (Claude's GitHub MCP has some
parameter-name mismatches; REST is the reliable fallback):

```bash
TOKEN=$(sed -nE 's|https://[^:]+:([^@]+)@github.com|\1|p' /tmp/.git-credentials | head -1)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/willagpt/creative-kitchen-static/commits/<sha>/check-runs"
```

Merging via REST (MCP `merge_pull_request` rejects the `pull_number`
param shape, REST does not):

```bash
curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/willagpt/creative-kitchen-static/pulls/<N>/merge \
  -d '{"merge_method":"squash","commit_title":"...","commit_message":"..."}'
```

## Known gotchas carried forward

- GitHub MCP param-name mismatches. `merge_pull_request` expects
  `pull_number` in the schema but rejects it at call time; same story
  with `add_issue_comment` and `issue_number`. Use the REST API as
  shown above.
- Squash merges desync `develop` from `main`. After a squash merge to
  `main`, `develop` ends up 1 behind and 1 ahead. Merging `develop` back
  into `main` again (next promotion) will include the missing commit;
  alternatively rebase or fast-forward `develop` onto `main` after each
  release. Not urgent.
- Bash sandbox can lock up if a long `sleep && curl` hits the 45 second
  call timeout. If you see "already running" RPC errors, pivot to
  `mcp__workspace__web_fetch` for simple HTTP GETs and give bash a
  couple of minutes to recover.
