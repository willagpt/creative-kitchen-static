# Handover, 17 April 2026 repo cleanup

Follow-on to `docs/handover-2026-04-16-deploy-validation.md`.

## TL;DR

1. Shipped the CLAUDE.md staleness fix (PR #8 -> PR #9, both squash-merged,
   both green on CI + Vercel Preview).
2. Burned down the carried-forward cleanup list: closed stale PR #1,
   deleted legacy branches `dev`, `master`, `v1`, and the merged
   `feature/refresh-claudemd-edge-fn-versions`.
3. Re-synced `develop` onto `main` after the squash merges so we do not
   leave a "1 behind, 1 ahead" desync.
4. Remaining blocker untouched: `debug-auth` hard-delete is still pinned
   to on-or-after 2026-04-23 per Asana `1214111067447172`.

## What shipped

PR #8 feature -> develop, PR #9 develop -> main. Both green. Single-file
change to `.claude/CLAUDE.md`:

- `list-video-analyses` version table entry bumped from v4 to v5. Adds
  a note that v5 exposes the `X-Function-Version:
  list-video-analyses@1.1.0` response header (CI deploy audit marker).
- New paragraph in the Edge Functions section, "CI deploy audit signal",
  documenting the `entrypoint_path` tell returned by
  `list_edge_functions`:
  - `file:///home/runner/work/...` -> deployed via
    `deploy-edge-functions.yml`.
  - `file:///tmp/user_fn_.../source/index.ts` -> deployed manually or
    from the Supabase dashboard.
  - Only `list-video-analyses` currently carries the runner path. Every
    other function predates CI.

Rationale: the previous session's validation work left CLAUDE.md out of
date. Fixing it now means anyone pulling the repo sees the accurate
version numbers and knows how to read `entrypoint_path` as a CI audit
signal going forward.

## Repo hygiene

Final state (verified 2026-04-17):

- Remote branches: `main`, `develop` only. Both at commit
  `2191a7bab4ef26108c45ee545f6e7d4858f1d25e`. 0/0 delta.
- Open PRs: 0.

Deletions this session:

- `dev` (legacy, SHA `882db7f`).
- `master` (legacy, SHA `d37d42f`).
- `v1` (legacy, SHA `1214dd1`).
- `feature/refresh-claudemd-edge-fn-versions` (merged via PR #8).

PR #1 was auto-closed by GitHub as a side-effect of deleting its head
branch (`dev`). An explanatory comment was left on the PR for
auditability.

## Supabase edge functions, current state

24 deployed, all `verify_jwt: true` (verified via
`list_edge_functions` on 17 Apr).

- `list-video-analyses` version 5, entrypoint
  `file:///home/runner/work/creative-kitchen-static/creative-kitchen-static/supabase/functions/list-video-analyses/index.ts`
  (CI deploy).
- `debug-auth` version 6, still serving HTTP 410 Gone with retirement
  notice. JWT still on. Hard-delete window opens 23 Apr.
- All 22 others still carry `/tmp/user_fn_.../source/index.ts`
  entrypoints (predate CI).

## Still owed, user UI actions (carried forward)

1. Branch protection on `main` and `develop`: require PR + passing
   `Build` check. GitHub -> Settings -> Branches.

## Still owed, code-side

1. Hard-delete `debug-auth` on or after 2026-04-23 once Supabase logs
   confirm zero traffic. Asana `1214111067447172`, due 23 Apr.

## Quick verification commands

Verify the deployed version header:

```bash
ANON="<anon jwt>"
curl -sD - -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  "https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1/list-video-analyses?limit=1" \
  -o /dev/null | grep -i x-function-version
```

Confirm the branch list stays clean:

```bash
git ls-remote --heads https://github.com/willagpt/creative-kitchen-static.git
# Expect: main and develop only, same SHA.
```
