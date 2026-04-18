# Organic Intel: stable percentile sort + bulk-run memory banner

**Date:** 17 April 2026
**Shipped:** PR #38 (commit `b296e1e` on `main`)
**Production deploy:** `32khb8i2u4Pu6Batv4Th7oKckgq6` READY
**Live bundle:** `/assets/index-B7-sZ4gi.js` (719,653 bytes)
**Files touched:** `src/components/OrganicIntel.jsx`, `src/components/OrganicIntel.css`
**No DB changes.**

## Symptoms

Reported against the Organic Intel tab, reproduced on the `calo.uk` account:

1. **Top percentile flips between visits.** User selected top 20%, walked away to watch one of the videos, came back, and the highlighted set of posts had changed.
2. **Bulk Analyse run disappears.** User pressed Analyse, navigated to a video, returned, and the UI showed no sign the run had ever happened.

## Root causes

### 1. Non-deterministic sort on ties

`selectTopPercentile` and the `displayPosts` memo both did:

```js
[...list].sort((a, b) => bv - av)
```

where `bv`/`av` are views from `metricsByPost`. When two posts tied on views (common among viral posts in the same day) the comparator returned `0`, and JS sorts fall back to insertion order, which isn't deterministic across React re-renders once a new row arrives in the `posts` array.

DB confirms the trigger: at 18:30:03 UTC, 20 fresh `organic_post_metrics` snapshots landed for `calo.uk`, exactly when the user was away watching a video. Updated view counts promoted new posts into the tied bands, reshuffling the top slice.

### 2. Component-local bulk state

`bulkStatuses`, `bulkRunning`, `bulkMessage` all live in `AccountDetail` component state. Navigating into a post unmounts `AccountDetail`; returning remounts a fresh instance with empty state. The actual server-side runs were fine (12 `calo.uk` organic-post analyses succeeded in the prior 2h) but the UI had nothing to anchor on.

## Fixes

### 1. `makePostViewComparator(metricsByPost)`

New top-level helper with deterministic tie-breakers:

```
views desc to posted_at desc to id asc
```

Used by both `selectTopPercentile` and the `displayPosts` memo. Same inputs now always produce the same ordering.

### 2. Per-account bulk-run localStorage

Key: `oi.lastBulkRun.v1`. Shape: `{ [accountId]: { startedAt, finishedAt, queuedIds, succeeded, failed } }`. TTL: 24 hours.

Helpers: `readLastBulkRun(accountId)`, `writeLastBulkRun(accountId, rec)`, `clearLastBulkRun(accountId)`. All guard against missing `accountId`, private-mode storage denial, malformed JSON, and stale records.

Written at the end of `runBulkAnalyse` with `queuedIds` equal to the actually-dispatched posts (not the pre-filter selection). Hydrated lazily via `useState(() => readLastBulkRun(account.id))`.

### 3. Return-visit banner

Renders above the bulk bar when a record exists and `!bulkRunning`. Shows:

- Count summary: `N completed, M errors`
- Relative time: `formatRelativeTime(finishedAt)`
- Post count: `K posts`

Actions:

- **View last batch** to `setSelectedIds(new Set(queuedIds))` + `setPercentile(null)` + `setOnlySelected(true)` so the grid filters to the exact posts that ran.
- **Dismiss** to clear the record for this account.

CSS uses a subtle info palette (`rgba(92, 207, 255, 0.08)` bg / `0.25` border) so it doesn't compete with the live running-state progress strip.

## Verification

- esbuild JSX + CSS syntax check: clean.
- Vercel preview (PR #38): success.
- Vercel production deploy `32khb8i2u4Pu6Batv4Th7oKckgq6`: READY.
- Live bundle grep confirms: `oi-last-run-banner`, `oi.lastBulkRun.v1`, `Last Analyse run`, `lastBulkRun`, `finishedAt`, `queuedIds`, `View last batch`. Function names minified out, as expected.

## Follow-ups

- Monitor whether 24h TTL is the right window. If users sometimes come back the next morning after an evening run and still want context, bump to 48-72h.
- If the banner becomes noisy for accounts that run Analyse daily, consider auto-dismissing when the user starts a new run.
- Consider a variant of this memory pattern for other long-running async actions that unmount their initiating view (e.g. trend report generation).
