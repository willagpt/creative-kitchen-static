import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VIDEO_WORKER_URL = Deno.env.get("VIDEO_WORKER_URL") || "";
const VIDEO_WORKER_SECRET = Deno.env.get("VIDEO_WORKER_SECRET") || "";

const FUNCTION_VERSION = "analyse-video@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Function-Version": FUNCTION_VERSION },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

type Source = "competitor_ad" | "organic_post";

async function getCompetitorAd(adId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/competitor_ads?id=eq.${encodeURIComponent(adId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch competitor ad: ${res.status}`);
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error(`Competitor ad not found: ${adId}`);
  return rows[0];
}

async function getOrganicPost(postId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/organic_posts?id=eq.${encodeURIComponent(postId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch organic post: ${res.status}`);
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error(`Organic post not found: ${postId}`);
  return rows[0];
}

async function findExistingAnalysis(source: Source, sourceId: string, legacyCompetitorAdId?: string) {
  // New path: source + source_id
  const q = `${SUPABASE_URL}/rest/v1/video_analyses?source=eq.${encodeURIComponent(source)}&source_id=eq.${encodeURIComponent(sourceId)}&status=in.(processing,complete)&select=id,status&limit=1`;
  const res = await fetch(q, { headers: supabaseHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  if (rows && rows.length > 0) return rows[0];

  // Legacy fallback for competitor_ad: old rows indexed only by competitor_ad_id
  if (source === "competitor_ad" && legacyCompetitorAdId) {
    const legacyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?competitor_ad_id=eq.${encodeURIComponent(legacyCompetitorAdId)}&status=in.(processing,complete)&select=id,status&limit=1`,
      { headers: supabaseHeaders() }
    );
    if (legacyRes.ok) {
      const rows2 = await legacyRes.json();
      if (rows2 && rows2.length > 0) return rows2[0];
    }
  }
  return null;
}

async function createAnalysisRecord(
  source: Source,
  sourceId: string,
  videoUrl: string,
  runId: string | null,
  legacyCompetitorAdId: string | null
) {
  const record: Record<string, unknown> = {
    source,
    source_id: sourceId,
    video_url: videoUrl,
    status: "processing",
  };
  if (runId) record.run_id = runId;
  // Keep competitor_ad_id populated for backward-compat with existing UI code.
  if (legacyCompetitorAdId) record.competitor_ad_id = legacyCompetitorAdId;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/video_analyses`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create analysis record: ${res.status} ${errText}`);
  }
  const rows = await res.json();
  return rows[0];
}

async function updateAnalysisRecord(id: string, data: Record<string, unknown>) {
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
  return (await res.json())[0];
}

async function insertShots(analysisId: string, shots: Array<Record<string, unknown>>) {
  const records = shots.map((shot) => ({
    video_analysis_id: analysisId,
    shot_number: shot.shot_number,
    start_time: shot.start_time,
    end_time: shot.end_time,
    duration: shot.duration,
    frame_url: shot.frame_url || null,
    ocr_text: null,
    description: null,
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/video_shots`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to insert shots: ${res.status} ${errText}`);
  }
}

function computePacingProfile(shots: Array<{ duration: number }>): string {
  if (shots.length === 0) return "static";
  const avgDuration = shots.reduce((s, sh) => s + sh.duration, 0) / shots.length;
  if (avgDuration < 1.0) return "fast";
  if (avgDuration < 2.5) return "medium";
  return "slow";
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

    // New polymorphic API: { source, source_id }
    // Legacy API (still supported): { competitor_ad_id }
    let source: Source;
    let sourceId: string;
    let legacyCompetitorAdId: string | null = null;

    if (body.source && body.source_id) {
      if (body.source !== "competitor_ad" && body.source !== "organic_post") {
        return jsonResponse({ error: `Unsupported source: ${body.source}` }, 400);
      }
      source = body.source;
      sourceId = String(body.source_id);
      if (source === "competitor_ad") legacyCompetitorAdId = sourceId;
    } else if (body.competitor_ad_id) {
      source = "competitor_ad";
      sourceId = String(body.competitor_ad_id);
      legacyCompetitorAdId = sourceId;
    } else {
      return jsonResponse({ error: "source+source_id or competitor_ad_id is required" }, 400);
    }

    const sceneThreshold: number = body.scene_threshold || 0.3;
    const runId: string | null = body.run_id || null;

    if (!VIDEO_WORKER_URL) {
      return jsonResponse({ error: "VIDEO_WORKER_URL not configured" }, 500);
    }

    // 1. Resolve the video URL from the source record.
    let videoUrl = "";
    let sourceRecord: Record<string, unknown> | null = null;

    if (source === "competitor_ad") {
      console.log(`Looking up competitor ad: ${sourceId}`);
      sourceRecord = await getCompetitorAd(sourceId);
      videoUrl = String(sourceRecord.video_url || "");
    } else {
      console.log(`Looking up organic post: ${sourceId}`);
      sourceRecord = await getOrganicPost(sourceId);
      videoUrl = String(sourceRecord.video_url || "");
      const postType = String(sourceRecord.post_type || "");
      if (!videoUrl) {
        return jsonResponse(
          { error: `Organic post ${sourceId} has no video_url (post_type=${postType})` },
          400
        );
      }
    }

    if (!videoUrl) {
      return jsonResponse({ error: `No video_url for ${source} ${sourceId}` }, 400);
    }

    // 2. Check for existing analysis (avoid duplicates)
    const existing = await findExistingAnalysis(source, sourceId, legacyCompetitorAdId || undefined);
    if (existing) {
      return jsonResponse({
        error: "Analysis already exists for this source",
        existing_analysis_id: existing.id,
        existing_status: existing.status,
      }, 409);
    }

    // 3. Create analysis record with status=processing
    console.log(`Creating analysis record for ${source}:${sourceId}`);
    const analysis = await createAnalysisRecord(source, sourceId, videoUrl, runId, legacyCompetitorAdId);
    const analysisId = analysis.id;
    console.log(`Analysis record created: ${analysisId}`);

    // 4. Call the Railway video worker
    console.log(`Calling video worker: ${VIDEO_WORKER_URL}/process-video`);
    const workerRes = await fetch(`${VIDEO_WORKER_URL}/process-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VIDEO_WORKER_SECRET}`,
      },
      body: JSON.stringify({
        video_url: videoUrl,
        analysis_id: analysisId,
        scene_threshold: sceneThreshold,
      }),
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text();
      console.error(`Worker error: ${workerRes.status} ${errText}`);
      await updateAnalysisRecord(analysisId, {
        status: "error",
        error_message: `Worker returned ${workerRes.status}: ${errText.slice(0, 500)}`,
      });
      return jsonResponse({ error: "Video worker failed", analysis_id: analysisId, details: errText.slice(0, 500) }, 502);
    }

    const workerResult = await workerRes.json();
    console.log(`Worker result: ${workerResult.total_shots} shots, ${workerResult.duration}s`);

    // 5. Compute edit metrics
    const totalShots = workerResult.total_shots || 0;
    const totalCuts = workerResult.total_cuts || 0;
    const duration = workerResult.duration || 0;
    const avgShotDuration = totalShots > 0 ? duration / totalShots : 0;
    const cutsPerSecond = duration > 0 ? totalCuts / duration : 0;
    const pacingProfile = computePacingProfile(workerResult.shots || []);

    // 6. Update the analysis record with results
    await updateAnalysisRecord(analysisId, {
      status: "complete",
      duration_seconds: parseFloat(duration.toFixed(3)),
      total_shots: totalShots,
      total_cuts: totalCuts,
      avg_shot_duration: parseFloat(avgShotDuration.toFixed(3)),
      cuts_per_second: parseFloat(cutsPerSecond.toFixed(3)),
      pacing_profile: pacingProfile,
      contact_sheet_url: workerResult.contact_sheet_url || null,
      error_message: null,
    });

    // 7. Insert shot records
    if (workerResult.shots && workerResult.shots.length > 0) {
      console.log(`Inserting ${workerResult.shots.length} shot records...`);
      await insertShots(analysisId, workerResult.shots);
    }

    console.log(`Phase 1 complete: ${analysisId} (${source}:${sourceId}). Downstream pipeline steps handled by frontend.`);

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      source,
      source_id: sourceId,
      competitor_ad_id: legacyCompetitorAdId,
      video_url: videoUrl,
      status: "complete",
      duration_seconds: duration,
      total_shots: totalShots,
      total_cuts: totalCuts,
      avg_shot_duration: parseFloat(avgShotDuration.toFixed(3)),
      cuts_per_second: parseFloat(cutsPerSecond.toFixed(3)),
      pacing_profile: pacingProfile,
      contact_sheet_url: workerResult.contact_sheet_url || null,
      audio_url: workerResult.audio_url || null,
      shots_inserted: workerResult.shots?.length || 0,
    });

  } catch (err) {
    console.error("analyse-video error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
