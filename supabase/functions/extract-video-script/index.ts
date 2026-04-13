import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * extract-video-script — Phase 2 orchestrator
 * Chains: transcribe-video → ocr-video-frames → merge-video-script
 * 
 * Each step writes to the DB independently, so partial progress is preserved
 * even if the function hits an execution time limit.
 * 
 * Call this after analyse-video (Phase 1) completes.
 */

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function callEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  console.log(`Calling ${functionName}...`);
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(`${functionName} returned ${res.status}: ${data.success ? 'success' : data.error || 'unknown'}`);
  
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  try {
    const body = await req.json();
    const analysisId: string = body.analysis_id;
    const skipTranscribe: boolean = body.skip_transcribe || false;
    const skipOcr: boolean = body.skip_ocr || false;
    const ocrModel: string = body.ocr_model || "";
    const ocrBatchSize: number = body.ocr_batch_size || 8;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    // Verify analysis exists and is complete
    const analysisRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}&select=id,status,transcript_text,ocr_text`,
      { headers: supabaseHeaders() }
    );
    const analyses = await analysisRes.json();
    if (!analyses || analyses.length === 0) {
      return jsonResponse({ error: "Analysis not found" }, 404);
    }
    const analysis = analyses[0];
    if (analysis.status !== "complete") {
      return jsonResponse({ error: `Analysis status is '${analysis.status}', must be 'complete' (Phase 1 finished)` }, 400);
    }

    const results: Record<string, unknown> = {
      analysis_id: analysisId,
      steps: {},
    };

    // Step 1: Transcribe (Whisper)
    if (!skipTranscribe) {
      const transcribeResult = await callEdgeFunction("transcribe-video", { analysis_id: analysisId });
      results.steps = {
        ...(results.steps as Record<string, unknown>),
        transcribe: {
          success: transcribeResult.ok,
          segment_count: transcribeResult.data.segment_count || 0,
          char_count: transcribeResult.data.char_count || 0,
          error: transcribeResult.ok ? null : transcribeResult.data.error,
        },
      };
    } else {
      console.log("Skipping transcription (skip_transcribe=true)");
      (results.steps as Record<string, unknown>).transcribe = { skipped: true };
    }

    // Step 2: OCR (Claude Vision)
    if (!skipOcr) {
      const ocrBody: Record<string, unknown> = { analysis_id: analysisId, batch_size: ocrBatchSize };
      if (ocrModel) ocrBody.model = ocrModel;
      const ocrResult = await callEdgeFunction("ocr-video-frames", ocrBody);
      results.steps = {
        ...(results.steps as Record<string, unknown>),
        ocr: {
          success: ocrResult.ok,
          shots_processed: ocrResult.data.shots_processed || 0,
          shots_updated: ocrResult.data.shots_updated || 0,
          model_used: ocrResult.data.model_used || null,
          error: ocrResult.ok ? null : ocrResult.data.error,
        },
      };
    } else {
      console.log("Skipping OCR (skip_ocr=true)");
      (results.steps as Record<string, unknown>).ocr = { skipped: true };
    }

    // Step 3: Merge script
    const mergeResult = await callEdgeFunction("merge-video-script", { analysis_id: analysisId });
    results.steps = {
      ...(results.steps as Record<string, unknown>),
      merge: {
        success: mergeResult.ok,
        total_segments: mergeResult.data.total_segments || 0,
        error: mergeResult.ok ? null : mergeResult.data.error,
      },
    };

    const steps = results.steps as Record<string, Record<string, unknown>>;
    const allSuccess = Object.values(steps).every((s) => s.success || s.skipped);
    results.success = allSuccess;
    results.combined_script = mergeResult.data.combined_script || null;

    console.log(`Script extraction ${allSuccess ? 'complete' : 'partially failed'} for ${analysisId}`);

    return jsonResponse(results, allSuccess ? 200 : 207);

  } catch (err) {
    console.error("extract-video-script error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
