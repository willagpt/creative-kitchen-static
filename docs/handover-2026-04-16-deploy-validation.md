# Handover, deploy-edge-functions.yml end-to-end validation

Date: 16 April 2026
Session outcome: shipped and verified.

Follow-on to `docs/handover-2026-04-16-phase2-ci-hardening.md`. If anything
here contradicts `.claude/CLAUDE.md`, `.claude/CLAUDE.md` wins; reconcile.

## TL;DR

1. Real end-to-end test of the fixed `deploy-edge-functions.yml` workflow
   (PRs #4 / #5). Round-tripped a deliberately small edge function change
   through `feature/* -> develop -> main` (PR #6 -> PR #7). The workflow
   triggered on merge, correctly computed the diff range, deployed only
   the changed function, and the new behaviour is live.
2. Tidy: re-synced `develop` onto `main` after the squash merge so the
   "1 behind, 1 ahead" desync gotcha is reset. Deleted the three merged
   feature branches from this and the previous session.
3. Found one drift point worth flagging: legacy branches `dev`,
   `master`, `v1` **are** still in origin (the previous handover said
   they weren't).

## What shipped

PR #6 feature -> develop, PR #7 develop -> main. Both green on CI (Build
+ Vercel Preview Comments), both squash-merged.

Single-file diff against `supabase/functions/list-video-analyses/index.ts`:

- New `FUNCTION_VERSION = "list-video-analyses@1.1.0"` constant.
- Added to response headers via the existing `jsonResponse` helper so
  every JSON response now carries `X-Function-Version`.
- Added `Access-Control-Expose-Headers: X-Function-Version` to
  `corsHeaders` so browsers can read it on cross-origin fetches.

Rationale: pick a change that's small, zero-risk, substantive (real ops
value), and remotely verifiable with `curl -I` so we don't depend solely
on Supabase's internal version counter to prove the deploy landed.

## Deploy workflow validation, evidence

On merge of PR #7 to `main` (commit `ee28017`), the workflow ran
`actions/runs/24530672965`:

- `Diff range: d5b6072bc02ff8ea1937ef39a5beec9f457e3328 -> ee2801749ca86fc166f18018894ff5b58cec0afc`
  (before correctly resolved from `github.event.before`, not fallback).
- `Deploying functions:` then `##[group]Deploy list-video-analyses`
  (exactly the changed slug, nothing else).
- `Deployed Functions on project ***: list-video-analyses`.

Supabase side (via MCP):

- `list-video-analyses` now at `version: 5`, `updated_at` matches the
  deploy timestamp.
- `entrypoint_path` is
  `file:///home/runner/work/creative-kitchen-static/creative-kitchen-static/supabase/functions/list-video-analyses/index.ts`
  — the only function with a GitHub runner-path entrypoint. Every other
  function has `/tmp/user_fn_...` paths from manual / dashboard deploys.
  This is a useful audit signal going forward: any function with a
  `/home/runner/...` entrypoint was deployed via CI.
- `verify_jwt: true` intact.

Live endpoint (signed anon JWT):

```
HTTP/2 200
access-control-expose-headers: X-Function-Version
x-function-version: list-video-analyses@1.1.0
...
{"success": true, "total": 72, "limit": 1, "offset": 0, "analyses": [...]}
```

Real response body, real data, new header. End-to-end confirmed.

## Branch hygiene

- `main`, `develop` now both at `ee28017` (0/0 delta).
- Squash-desync gotcha from the previous handover addressed by
  `git reset --hard origin/main && git push --force-with-lease` on
  `develop`. No content lost (the squash on `main` includes everything
  `develop` had).
- Deleted (merged):
  - `feature/version-header-list-video-analyses` (this session, PR #6)
  - `feature/fix-edge-deploy-diff` (last session, PR #4)
  - `feature/retire-debug-auth` (last session, PR #2)
- Left in origin for user review: `dev`, `master`, `v1`. These are
  legacy and the previous handover wanted them deleted, but I didn't
  touch them without your say-so.

## Drift points vs last handover and CLAUDE.md

1. Previous handover: "legacy branches `dev`, `master`, `v1` ... they
   are not in origin as of this handover, but double-check". They
   **are** in origin. SHAs: `dev=882db7f`, `master=d37d42f`,
   `v1=1214dd1`. Recommend you delete in the UI (or I can delete
   next session if you confirm).
2. PR #1 still open (`refs/pull/1/head=882db7f` same as `dev`). Close
   when you handle the legacy cleanup.
3. CLAUDE.md says 18 edge functions; Supabase MCP + repo both show 24.
   The count and the function list in CLAUDE.md under "Edge Functions"
   is stale. The list-video-analyses name is correct; the repo also
   has `ai-analyse-video`, `analyse-competitor-creatives`,
   `compare-prompts`, `debug-auth`, `describe-photo`,
   `extract-ad-thumbnails`, `extract-brand-guidelines`,
   `extract-video-script`, `fetch-competitor-ads`, `generate-ad-prompt`,
   `generate-shot-sequence`, `generate-ugc-brief`, `generate-variables`,
   `get-video-analysis`, `list-video-analyses`, `merge-video-script`,
   `ocr-video-frames`, `process-analysis-batch`, `refine-prompt`,
   `seed-advertisers`, `templatize-prompt`, `transcribe-video`,
   `vision-model-test`. Worth a one-line CLAUDE.md refresh next pass.

## Still owed, user UI actions (carried forward)

1. Branch protection on `main` and `develop`: require PR + passing
   `Build` check. GitHub -> Settings -> Branches.
2. Close stale PR #1.
3. Delete legacy branches `dev`, `master`, `v1` (confirmed present this
   session).

## Still owed, code-side

4. Hard-delete `debug-auth` on or after 2026-04-23 once Supabase logs
   confirm zero traffic. Asana `1214111067447172`, due 23 Apr. This
   session's validation run deployed `list-video-analyses` only, so
   `debug-auth` is untouched and still at v6, HTTP 410, JWT on.

## Useful commands

Verify the deployed version header at any time:

```bash
ANON="<anon jwt>"
curl -sD - -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  "https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1/list-video-analyses?limit=1" \
  -o /dev/null | grep -i x-function-version
```

Pattern for future function version bumps:

1. Edit `supabase/functions/<slug>/index.ts`. Bump the `FUNCTION_VERSION`
   string (or add one if missing). Keep it to a single line.
2. `feature/* -> develop -> main` via PR.
3. After merge, `curl -I` the endpoint. The header is the ground truth.
