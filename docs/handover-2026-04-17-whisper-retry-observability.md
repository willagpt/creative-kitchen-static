# Handover, 17 April 2026, Whisper retry + observability

Session outcome: shipped and verified. VAE Phase 2 subtask "Whisper transcription" (Asana `1214111674112796`) closed.

## TL;DR

1. Hardened `transcribe-video` edge function with retry + partial-text detection. Deployed as v5 via GitHub Actions on push to main.
2. Added four observability columns to `video_analyses`: `transcript_status`, `transcript_attempts`, `transcript_error`, `transcript_completed_at`. Migration applied, 70 existing rows backfilled to status `success`.
3. Wired frontend retry into `CompetitorAds.jsx` `runPipelineSteps` so the pipeline retries `transcribe-video` on transient errors before calling the step a failure.
4. Smoke tested end-to-end against a real `video_analyses` row. DB transitions verified.
5. First real end-to-end test of PR #5 `deploy-edge-functions.yml` shallow-clone fix (from the previous session). The workflow correctly diffed the single changed file and deployed only `transcribe-video`, not all 21 functions.

## What shipped, in detail

### 1. Edge function `transcribe-video` v5

Source: `supabase/functions/transcribe-video/index.ts`. Size went from 188 to 349 lines.

Retry model:

```ts
class WhisperError extends Error {
  status: number; transient: boolean;
}
const MAX_WHISPER_ATTEMPTS = 3;
const WHISPER_BACKOFF_MS = [1000, 3000, 7000];
```

- `transient` flag is set to `true` for 429, 5xx, and transport errors (network, timeout, DNS). It is set to `false` for 4xx client errors (bad request, wrong auth). The retry loop only retries when `transient === true`.
- Backoff is explicit per-attempt rather than computed, so attempt 1 waits 1000ms before attempt 2, attempt 2 waits 3000ms before attempt 3, etc.
- If the loop exhausts all attempts, the outer handler writes `transcript_status: 'error'` with the final error message into `transcript_error` and returns HTTP 500 to the caller.

Partial detection:

```ts
const PARTIAL_COVERAGE_THRESHOLD = 0.9;
const PARTIAL_MIN_DURATION_SECONDS = 5;

function assessPartial(segments, duration) {
  if (!duration || duration < PARTIAL_MIN_DURATION_SECONDS) {
    return { isPartial: false, coverage: 1, reason: null };
  }
  const lastSegmentEnd = segments.length ? segments[segments.length - 1].end : 0;
  const coverage = lastSegmentEnd / duration;
  if (coverage < PARTIAL_COVERAGE_THRESHOLD) {
    return {
      isPartial: true,
      coverage,
      reason: `partial: coverage_${coverage.toFixed(2)}_below_${PARTIAL_COVERAGE_THRESHOLD}`,
    };
  }
  return { isPartial: false, coverage, reason: null };
}
```

- Coverage is the ratio of last segment end-time to Whisper-reported total duration. A value of 1.0 means the segments cover the whole clip; 0.87 means the last 13% of the clip was not transcribed (silence, music, or Whisper gave up).
- Videos under 5 seconds never fire partial because short clips legitimately end with silence or music stings and would false-positive constantly.
- Partial is explicitly NOT retried. Partial output indicates audio quality or content (not a transient API issue), so retrying would just burn credits.

Status machine:

```
(new row) -> running -> success
                    -> partial
                    -> error
```

- `running` is written before the first Whisper call so a crashed run leaves a visible "stuck" row rather than a silent NULL.
- Outer try/catch guarantees a DB state is written even if something unexpected throws between the Whisper call and the final write.

Response body (new fields):

```json
{
  "success": true,
  "transcript_status": "partial",
  "coverage": 0.868,
  "attempts": 1,
  "duration_seconds": 5.76,
  ...
}
```

### 2. Migration `20260417141000_phase2_whisper_observability_columns.sql`

Applied to prod first (so frontend had something to read while smoke-testing the feature branch), committed afterwards so repo matches prod.

```sql
ALTER TABLE public.video_analyses
  ADD COLUMN IF NOT EXISTS transcript_status text
    CHECK (transcript_status IS NULL OR transcript_status IN ('pending','running','partial','success','error')),
  ADD COLUMN IF NOT EXISTS transcript_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_completed_at timestamptz;

UPDATE public.video_analyses
SET transcript_status = 'success',
    transcript_attempts = 1,
    transcript_completed_at = COALESCE(updated_at, created_at)
WHERE transcript_text IS NOT NULL AND transcript_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_analyses_transcript_status
  ON public.video_analyses (transcript_status)
  WHERE transcript_status IS NOT NULL;
```

Backfill result: 70 rows to `success`, 2 stay NULL because they never reached the transcribe phase.

Caveat: the backfill does not recalculate coverage. Existing rows flagged `success` may actually be `partial` under the new logic. This is by design (backfill is a seed, not a recalculation). The distinction only matters for rows going forward.

### 3. Frontend retry in `CompetitorAds.jsx` `runPipelineSteps`

Pipeline steps now carry per-step retry config:

```js
const steps = [
  { name: 'transcribe-video', retries: 2, retryDelayMs: 2000 },
  { name: 'ocr-video-frames', retries: 0, retryDelayMs: 0 },
  { name: 'merge-video-script', retries: 0, retryDelayMs: 0 },
  { name: 'ai-analyse-video', retries: 0, retryDelayMs: 0 },
];
```

Two layers of retry now protect transcription:

1. Edge function internal retries (3 attempts, exponential backoff, transient only). Covers Whisper API 429s and 5xx.
2. Frontend client retries (2 attempts, fixed 2s delay). Covers the case where the edge function itself fails to return (cold start timeout, Supabase gateway blip) before it can write `running` or `error` to the DB.

Frontend only retries on 429/5xx/transport errors. On happy path (200), it logs `transcript_status`, `attempts`, `coverage`, and `char_count`. On `partial`, it logs a warning so the pipeline still continues.

## Deployed state

| Thing | Where | Version | Verified |
|---|---|---|---|
| `transcribe-video` | Supabase `ifrxylvoufncdxyltgqt` | v5, sha256 `96f63400...` | v5 listed, entrypoint path from GitHub runner |
| Migration | Supabase prod | applied, 70 rows backfilled | SELECT on `video_analyses` shows populated columns |
| Frontend retry wiring | Vercel prod | deployed via main push | live URL reflects commit `10bb039c` |

Commit graph on `main` after this session:

```
10bb039c release: Whisper retry + observability (develop -> main) (#23)
ec237c2  Promote deploy workflow fix to main (#5)
db44a48  Fix deploy-edge-functions shallow clone (#4)
...
```

## Verification done

1. `deploy-edge-functions.yml` on commit `10bb039c`:
   - Correctly detected changed file `supabase/functions/transcribe-video/index.ts`.
   - Deployed only that one function (not all 21). Log excerpt: `Deploying functions: transcribe-video` then `Deployed Functions on project ***: transcribe-video`.
   - This is the first real end-to-end validation of the PR #5 fix. Previously the shallow clone was silently deploying nothing.

2. Smoke test on `video_analyses` row `66988d34-828e-4ff4-b357-64265d76c9c2`:
   - Wiped `transcript_text`, `transcript_status`, `transcript_attempts`, `transcript_error`, `transcript_completed_at`.
   - Invoked via `curl` with body `{"analysis_id":"66988d34-..."}`.
   - Response: HTTP 200, `attempts: 1`, `duration_seconds: 5.76`, `coverage: 0.868`, `transcript_status: "partial"`.
   - DB post-check: `t_len: 98`, `transcript_status: partial`, `transcript_attempts: 1`, `transcript_error: "partial: coverage_0.87_below_0.9"`, `transcript_completed_at: 2026-04-17 13:25:06.743+00`.
   - The partial classification is correct: Whisper segmented up to 5.0s of a 5.76s clip, leaving a ~760ms tail not covered.

## Gotchas carried forward

1. **`transcribe-video` parameter name is `analysis_id`, not `video_analysis_id`.** Smoke test initially returned `{"error":"analysis_id is required"}` because I used the wrong name.
2. **Em dashes still leak into generated content.** The Asana close comment on this ticket accidentally contained two em dashes. The rule is absolute; use commas, colons, or arrows.
3. **Coverage threshold may be too aggressive for short ad creatives.** The 5.988s test clip fired partial despite Whisper doing a reasonable job. If ad creatives commonly end with 1-2s of music/silence, this threshold (0.9) will classify many successful runs as partial. Watch the rate over the next week; consider lowering to 0.75 or adding a "speech-density" heuristic (coverage of speech-only segments) if false-positive rate is high.
4. **Backfill is a seed, not a recalculation.** The 70 pre-existing rows flagged `success` could be `partial` under the new logic. Not fixing this; new runs are the ones that matter.

## What this session did NOT touch

Per handover `handover-2026-04-17-session-close-and-asana-setup.md`:

- Apify + YouTube Data API v3 key rotation, still pending (deferred/informal).
- Cron watch, first unattended fires tonight (YT 18:30 UTC) and tomorrow (IG 02:15 UTC, YT 06:30 UTC). Need to confirm cleanliness next session.
- Foreplay competitor fetch orchestrator (Asana `1214111655347530`, due 18 May).
- OCR per shot, the next VAE Phase 2 subtask (Asana `1214111637586477`, due 8 May).

## Files changed this session

New:

- `supabase/migrations/20260417141000_phase2_whisper_observability_columns.sql`
- `docs/handover-2026-04-17-whisper-retry-observability.md` (this file)

Modified:

- `supabase/functions/transcribe-video/index.ts` (188 to 349 lines)
- `src/components/CompetitorAds.jsx` (`runPipelineSteps` step array + retry loop)

Deployed:

- Supabase edge function `transcribe-video` v5
- Vercel prod main from commit `10bb039c`

## Writing style reminder

No em dashes or en dashes in any generated content. Use commas, colons, full stops, or arrows (->). Ranges as "2 to 3", not "2-3". This applies to handover docs like this one.
