#!/usr/bin/env node
/**
 * Backfill script: finish Phase 2+3 pipeline for any video_analyses rows
 * whose Phase 1 (shots + contact sheet via analyse-video → Railway worker)
 * has completed but whose downstream steps have not:
 *
 *   transcribe-video  →  ocr-video-frames  →  merge-video-script  →  ai-analyse-video
 *
 * This replaces the ad-hoc curl sequences we ran on 17 Apr 2026 to heal the
 * 8 stale organic_post analyses that were blocking Trend Reports. It is safe
 * to re-run: every edge function is idempotent against its own status column
 * (transcript_status / ocr_status) so rows already past a step are no-ops.
 *
 * Usage:
 *   SUPABASE_URL=https://ifrxylvoufncdxyltgqt.supabase.co \
 *   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... \
 *   node scripts/backfill-organic-pipeline.mjs [--source=organic_post] [--limit=50] [--dry-run]
 *
 * Flags:
 *   --source=<competitor_ad|organic_post>   (default: organic_post)
 *   --limit=<N>                             (default: 50, max rows to touch)
 *   --dry-run                               (print plan only, no HTTP calls)
 *   --analysis-id=<uuid>                    (backfill a single row; overrides --source/--limit)
 *   --concurrency=<N>                       (default: 1 to protect the worker)
 *
 * Environment:
 *   SUPABASE_URL       (required)
 *   SUPABASE_ANON_KEY  (required, anon key is fine; functions enforce verify_jwt)
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env var.')
  process.exit(1)
}

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  acc[k] = v === undefined ? true : v
  return acc
}, {})

const source = args.source || 'organic_post'
const limit = Number(args.limit || 50)
const dryRun = !!args['dry-run']
const concurrency = Math.max(1, Number(args.concurrency || 1))
const singleId = args['analysis-id'] || null

// Steps ordered exactly like the frontend runPipelineSteps() in OrganicIntel.jsx.
// Same retry policy (2 retries on 429/5xx for transcribe + OCR; none for merge/ai).
const STEPS = [
  { name: 'transcribe-video',  retries: 2, retryDelayMs: 2000 },
  { name: 'ocr-video-frames',  retries: 2, retryDelayMs: 2000 },
  { name: 'merge-video-script', retries: 0, retryDelayMs: 0 },
  { name: 'ai-analyse-video',  retries: 0, retryDelayMs: 0 },
]

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

async function pgrest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${path}: ${await res.text().catch(() => '')}`)
  }
  return res.json()
}

async function callStep(step, analysisId) {
  let finalStatus = null
  let finalBody = null
  for (let attempt = 1; attempt <= step.retries + 1; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/${step.name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ analysis_id: analysisId }),
      })
      finalStatus = r.status
      finalBody = await r.json().catch(() => ({}))
      if (r.ok) return { ok: true, status: r.status, body: finalBody }
      const retryable = r.status === 429 || r.status >= 500
      console.warn(`  [${step.name}] attempt ${attempt}/${step.retries + 1} → HTTP ${r.status} (retryable=${retryable})`)
      if (!retryable || attempt > step.retries) break
    } catch (e) {
      console.warn(`  [${step.name}] attempt ${attempt}/${step.retries + 1} threw:`, e.message)
      if (attempt > step.retries) break
    }
    if (step.retryDelayMs) await new Promise(r => setTimeout(r, step.retryDelayMs))
  }
  return { ok: false, status: finalStatus, body: finalBody }
}

async function processOne(row) {
  const id = row.id
  console.log(`\n[${id}] source=${row.source} source_id=${row.source_id}`)
  console.log(`         transcript=${row.transcript_status || 'null'} ocr=${row.ocr_status || 'null'} ai=${row.ai_analysis ? 'set' : 'null'}`)
  if (dryRun) {
    console.log(`         DRY RUN → would run: ${STEPS.map(s => s.name).join(' → ')}`)
    return { id, ok: true, dryRun: true }
  }
  for (const step of STEPS) {
    const result = await callStep(step, id)
    const tag = result.ok ? 'ok' : 'fail'
    const detail =
      step.name === 'transcribe-video' && result.body?.transcript_status
        ? ` status=${result.body.transcript_status} attempts=${result.body.attempts} coverage=${result.body.coverage?.toFixed?.(2) ?? 'n/a'}`
        : step.name === 'ocr-video-frames' && result.body?.ocr_status
          ? ` status=${result.body.ocr_status} shots=${result.body.shots_updated}/${result.body.shots_processed} coverage=${result.body.coverage?.toFixed?.(2) ?? 'n/a'}`
          : ''
    console.log(`         [${step.name}] ${tag}${detail}`)
    if (!result.ok) return { id, ok: false, failedStep: step.name, status: result.status }
  }
  return { id, ok: true }
}

async function main() {
  const query = singleId
    ? `video_analyses?id=eq.${singleId}&select=id,source,source_id,transcript_status,ocr_status,ai_analysis,status`
    : `video_analyses?source=eq.${source}&status=eq.complete` +
      // Anything missing Phase 2 or 3 counts as a backfill target.
      `&or=(transcript_status.is.null,transcript_status.eq.pending,ocr_status.is.null,ocr_status.eq.pending,ai_analysis.is.null)` +
      `&select=id,source,source_id,transcript_status,ocr_status,ai_analysis,status&order=created_at.desc&limit=${limit}`

  console.log(`Querying ${query}`)
  const rows = await pgrest(query)
  if (!rows.length) {
    console.log('No rows need backfilling. Nothing to do.')
    return
  }
  console.log(`Found ${rows.length} row(s) to backfill${dryRun ? ' (DRY RUN)' : ''}.`)

  const results = []
  // Serial by default. Raise --concurrency carefully: each step hits the
  // Railway worker (shots) or Claude (OCR + AI) so parallelism burns budget.
  const queue = [...rows]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const row = queue.shift()
      if (!row) break
      results.push(await processOne(row))
    }
  })
  await Promise.all(workers)

  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount
  console.log(`\nDone. ok=${okCount} fail=${failCount}`)
  if (failCount) {
    for (const r of results.filter(x => !x.ok)) {
      console.log(`  FAIL ${r.id} at ${r.failedStep} (HTTP ${r.status})`)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
