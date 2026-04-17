import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * ocr-video-frames v10
 * --------------------
 * Per-shot OCR + brief description via Claude vision. Runs batches of frames
 * through the Anthropic Messages API, writes ocr_text + description per
 * video_shots row, and aggregates a timestamped OCR string into
 * video_analyses.ocr_text.
 *
 * v10 mirrors the transcribe-video v5 hardening pattern:
 *   - Lifecycle status on video_analyses (pending → running → success|partial|error)
 *   - Batch-level retry with backoff on transient errors (429/5xx/network)
 *   - Partial detection (some batches failed after retries, or per-shot
 *     coverage below PARTIAL_COVERAGE_THRESHOLD)
 *   - Attempts counter, last-error string, completed_at timestamp
 *   - x-function-version response header
 *
 * Per-shot observability (which shot failed) lives in video_shots.ocr_text
 * being NULL for that shot plus the aggregate status on video_analyses.
 */

const FUNCTION_VERSION = "ocr-video-frames@10";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";

// Default to Sonnet 4.6 for rich frame descriptions + OCR. Override with body.model.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_BATCH_SIZE = 8;

// Retry policy for Claude Vision calls per batch. Only transient failures
// (429/5xx/network) trigger a retry. 4xx auth/validation failures bail
// immediately for that batch, but we continue on to the next batch and
// mark the overall run as partial.
const MAX_BATCH_ATTEMPTS = 3;
const BATCH_BACKOFF_MS = [1000, 3000, 7000];

// Partial detection: if fewer than this share of frame-bearing shots got a
// non-null Claude result (ocr_text OR description), mark the run as partial.
// At 0.9 a single failed batch in an 8-batch video still counts as success;
// two failed batches or a pattern of shot-level JSON parse errors flip it.
const PARTIAL_COVERAGE_THRESHOLD = 0.9;

class ClaudeError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-function-version": FUNCTION_VERSION,
    },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function getAnalysis(analysisId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${encodeURIComponent(analysisId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch analysis: ${res.status}`);
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error(`Analysis not found: ${analysisId}`);
  return rows[0];
}

async function getShots(analysisId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_shots?video_analysis_id=eq.${analysisId}&order=shot_number.asc&select=*`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch shots: ${res.status}`);
  return await res.json();
}

async function updateShot(shotId: string, data: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_shots?id=eq.${shotId}`,
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to update shot ${shotId}: ${res.status} ${errText}`);
  }
}

async function updateAnalysis(id: string, data: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${id}`,
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update analysis: ${res.status} ${errText}`);
  }
}

async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${url} (${res.status})`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface BatchFrame {
  shot_number: number;
  frame_url: string;
  start_time: number;
  end_time: number;
}

interface BatchResult {
  shot_number: number;
  ocr_text: string;
  description: string;
}

/**
 * Single Claude Vision call for one batch of frames. Wraps the response
 * in a ClaudeError with a transient flag so the caller can decide whether
 * to retry.
 */
async function callClaudeOnce(
  frames: BatchFrame[],
  model: string,
): Promise<BatchResult[]> {
  const content: Array<Record<string, unknown>> = [];

  content.push({
    type: "text",
    text: `You are analysing frames from a video advertisement. For each frame, provide:
1. **ocr_text**: ALL on-screen text you can see (headlines, captions, CTAs, prices, brand names, subtitles). If no text, return empty string.
2. **description**: A brief (1-2 sentence) description of what's shown in the frame.

Respond as a JSON array with objects: {"shot_number": N, "ocr_text": "...", "description": "..."}. Return ONLY the JSON array, no other text.`,
  });

  for (const frame of frames) {
    try {
      const base64 = await imageToBase64(frame.frame_url);
      content.push({
        type: "text",
        text: `Shot ${frame.shot_number} (${frame.start_time.toFixed(1)}s - ${frame.end_time.toFixed(1)}s):`,
      });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: base64,
        },
      });
    } catch (e) {
      console.error(`Failed to load frame for shot ${frame.shot_number}: ${e}`);
    }
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (netErr) {
    // fetch() only throws for transport-level failures (DNS, reset, TLS).
    // Treat these as transient so the retry loop kicks in.
    throw new ClaudeError(`Claude network error: ${String(netErr)}`, 0, true);
  }

  if (!res.ok) {
    const errText = await res.text();
    // 429 (rate limit) and 529 (overloaded) are canonical retryable cases.
    // Generic 5xx is retryable too. 4xx (auth, bad request) bails out.
    const transient = res.status === 429 || res.status === 529 || res.status >= 500;
    throw new ClaudeError(
      `Claude Vision API error: ${res.status} ${errText.slice(0, 300)}`,
      res.status,
      transient,
    );
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "[]";

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error(`Claude returned non-array: ${typeof parsed}`);
    }
    return parsed as BatchResult[];
  } catch (e) {
    // A parse failure is not transient (the payload was valid HTTP, the
    // model just went off-format). Don't retry; let the caller mark this
    // batch as failed and continue.
    console.error(`Claude JSON parse failure: ${e}`);
    console.error(`Raw response (first 500 chars): ${text.slice(0, 500)}`);
    throw new ClaudeError(`Claude returned unparseable JSON: ${String(e)}`, 0, false);
  }
}

/**
 * Retry wrapper around callClaudeOnce for one batch. Retries only on
 * transient failures (ClaudeError.transient === true). Returns the
 * successful BatchResult[] or throws the final error.
 */
async function ocrFrameBatchWithRetry(
  frames: BatchFrame[],
  model: string,
  batchLabel: string,
): Promise<BatchResult[]> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
    try {
      return await callClaudeOnce(frames, model);
    } catch (err) {
      lastErr = err;
      const transient = err instanceof ClaudeError ? err.transient : true;
      const status = err instanceof ClaudeError ? err.status : 0;
      console.warn(
        `[${batchLabel}] Claude attempt ${attempt}/${MAX_BATCH_ATTEMPTS} failed ` +
        `(status=${status}, transient=${transient}): ${String(err).slice(0, 200)}`,
      );
      if (!transient || attempt === MAX_BATCH_ATTEMPTS) break;
      const backoff = BATCH_BACKOFF_MS[Math.min(attempt - 1, BATCH_BACKOFF_MS.length - 1)];
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  let analysisId: string | undefined;
  let attemptsSoFar = 0;

  try {
    const body = await req.json();
    analysisId = body.analysis_id;
    const batchSize: number = body.batch_size || DEFAULT_BATCH_SIZE;
    const model: string = body.model || DEFAULT_MODEL;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "CLAUDE_API_KEY / ANTHROPIC_API_KEY not configured" }, 500);
    }

    // 1. Fetch the analysis record for attempts counter.
    console.log(`Fetching analysis: ${analysisId}`);
    const analysis = await getAnalysis(analysisId);
    attemptsSoFar = typeof analysis.ocr_attempts === "number" ? analysis.ocr_attempts : 0;

    if (analysis.status !== "complete") {
      return jsonResponse(
        { error: `Analysis status is '${analysis.status}', expected 'complete'` },
        400,
      );
    }

    // Mark OCR as running so the UI can render a spinner instead of a
    // blank OCR column, and so duplicate invocations are observable.
    await updateAnalysis(analysisId, { ocr_status: "running" });

    // 2. Load shots and filter to those with frame URLs.
    console.log(`Fetching shots for analysis: ${analysisId}`);
    const shots = await getShots(analysisId);

    if (!shots || shots.length === 0) {
      const errMsg = "No shots found for this analysis";
      await updateAnalysis(analysisId, {
        ocr_status: "error",
        ocr_attempts: attemptsSoFar + 1,
        ocr_error: errMsg,
        ocr_completed_at: new Date().toISOString(),
      });
      return jsonResponse({ error: errMsg }, 404);
    }

    const shotsWithFrames = shots.filter((s: Record<string, unknown>) => s.frame_url);
    console.log(
      `Found ${shotsWithFrames.length} shots with frames ` +
      `(of ${shots.length} total), model: ${model}, batch_size: ${batchSize}`,
    );

    if (shotsWithFrames.length === 0) {
      const errMsg = "No shots have frame_url populated; video worker probably failed to upload frames";
      await updateAnalysis(analysisId, {
        ocr_status: "error",
        ocr_attempts: attemptsSoFar + 1,
        ocr_error: errMsg,
        ocr_completed_at: new Date().toISOString(),
      });
      return jsonResponse({ error: errMsg }, 400);
    }

    // 3. Run each batch with retry. Track per-batch outcomes so we can
    //    decide success vs partial at the end.
    const allResults: BatchResult[] = [];
    const batchErrors: Array<{ batch: number; shots: string; error: string }> = [];
    const totalBatches = Math.ceil(shotsWithFrames.length / batchSize);

    for (let i = 0; i < shotsWithFrames.length; i += batchSize) {
      const batch = shotsWithFrames.slice(i, i + batchSize);
      const batchIdx = Math.floor(i / batchSize) + 1;
      const batchLabel = `batch ${batchIdx}/${totalBatches} shots ${batch[0].shot_number}-${batch[batch.length - 1].shot_number}`;
      console.log(`Processing ${batchLabel}`);

      try {
        const batchResults = await ocrFrameBatchWithRetry(
          batch.map((s: Record<string, unknown>) => ({
            shot_number: s.shot_number as number,
            frame_url: s.frame_url as string,
            start_time: parseFloat(String(s.start_time)),
            end_time: parseFloat(String(s.end_time)),
          })),
          model,
          batchLabel,
        );
        allResults.push(...batchResults);
      } catch (err) {
        // One batch failed after all retries. Continue to the next batch
        // so we return partial results rather than losing everything.
        const shotRange = `${batch[0].shot_number}-${batch[batch.length - 1].shot_number}`;
        console.error(`[${batchLabel}] gave up after retries: ${err}`);
        batchErrors.push({
          batch: batchIdx,
          shots: shotRange,
          error: String(err).slice(0, 300),
        });
      }
    }

    // 4. Write per-shot rows (ocr_text + description). Shots in failed
    //    batches are left with whatever was previously there (NULL on
    //    first run). We intentionally do not overwrite with NULL on the
    //    failed shots so a retry can fill them in without dropping prior
    //    data.
    let updatedCount = 0;
    for (const result of allResults) {
      const shot = shots.find((s: Record<string, unknown>) => s.shot_number === result.shot_number);
      if (shot) {
        await updateShot((shot as { id: string }).id, {
          ocr_text: result.ocr_text || null,
          description: result.description || null,
        });
        updatedCount++;
      }
    }

    // 5. Classify: success | partial | error.
    const coverage = shotsWithFrames.length > 0 ? updatedCount / shotsWithFrames.length : 0;
    let finalStatus: "success" | "partial" | "error";
    let errorMsg: string | null = null;

    if (updatedCount === 0) {
      finalStatus = "error";
      errorMsg = batchErrors.length > 0
        ? `All ${batchErrors.length} batch(es) failed: ${batchErrors[0].error}`
        : "No batch returned results";
    } else if (batchErrors.length > 0 || coverage < PARTIAL_COVERAGE_THRESHOLD) {
      finalStatus = "partial";
      errorMsg = batchErrors.length > 0
        ? `partial: ${batchErrors.length}/${totalBatches} batch(es) failed, coverage=${coverage.toFixed(2)}, first_error=${batchErrors[0].error}`
        : `partial: coverage=${coverage.toFixed(2)} below ${PARTIAL_COVERAGE_THRESHOLD}`;
    } else {
      finalStatus = "success";
    }

    console.log(
      `OCR classification: ${finalStatus} ` +
      `(shots_updated=${updatedCount}/${shotsWithFrames.length}, ` +
      `coverage=${coverage.toFixed(2)}, ` +
      `batch_errors=${batchErrors.length}/${totalBatches})`,
    );

    // 6. Aggregate timestamped OCR text for video_analyses.ocr_text.
    const combinedOcr = allResults
      .filter((r) => r.ocr_text && r.ocr_text.trim())
      .map((r) => {
        const shot = shotsWithFrames.find(
          (s: Record<string, unknown>) => s.shot_number === r.shot_number,
        );
        const time = shot ? `[${parseFloat(String(shot.start_time)).toFixed(1)}s]` : "";
        return `${time} ${r.ocr_text}`;
      })
      .join("\n");

    // 7. Write observability + aggregate to video_analyses.
    const update: Record<string, unknown> = {
      ocr_status: finalStatus,
      ocr_attempts: attemptsSoFar + 1,
      ocr_error: errorMsg,
      ocr_completed_at: new Date().toISOString(),
    };
    // Only overwrite ocr_text if we actually have new content. Preserves
    // prior successful runs if a retry partially regresses.
    if (combinedOcr) {
      update.ocr_text = combinedOcr;
    } else if (finalStatus === "error" && !analysis.ocr_text) {
      update.ocr_text = null;
    }

    await updateAnalysis(analysisId, update);

    console.log(
      `Analysis ${analysisId} updated: status=${finalStatus}, ` +
      `shots=${updatedCount}, chars=${combinedOcr.length}`,
    );

    return jsonResponse({
      success: finalStatus !== "error",
      analysis_id: analysisId,
      ocr_status: finalStatus,
      shots_processed: shotsWithFrames.length,
      shots_updated: updatedCount,
      coverage,
      batch_errors: batchErrors,
      total_batches: totalBatches,
      attempts: 1,
      model_used: model,
      ocr_text: combinedOcr,
      results: allResults,
    }, finalStatus === "error" ? 502 : 200);

  } catch (err) {
    console.error("ocr-video-frames error:", err);
    // Best-effort observability write.
    if (analysisId) {
      try {
        await updateAnalysis(analysisId, {
          ocr_status: "error",
          ocr_attempts: attemptsSoFar + 1,
          ocr_error: String(err).slice(0, 500),
          ocr_completed_at: new Date().toISOString(),
        });
      } catch (updateErr) {
        console.error("Failed to write error state to video_analyses:", updateErr);
      }
    }
    return jsonResponse({ error: String(err) }, 500);
  }
});
