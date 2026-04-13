import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VIDEO_WORKER_URL = Deno.env.get("VIDEO_WORKER_URL") || "";
const VIDEO_WORKER_SECRET = Deno.env.get("VIDEO_WORKER_SECRET") || "";

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

// Fetch a single competitor ad by ID
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

// Create a video_analyses record with status=processing
async function createAnalysisRecord(competitorAdId: string, videoUrl: string, runId: string | null) {
  const record: Record<string, unknown> = {
    competitor_ad_id: competitorAdId,
    video_url: videoUrl,
    status: "processing",
  };
  if (runId) record.run_id = runId;

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

// Update a video_analyses record with results
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

// Insert video_shots records
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

// Compute pacing profile from shot durations
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
    const competitorAdId: string = body.competitor_ad_id;
    const sceneThreshold: number = body.scene_threshold || 0.3;
    const runId: string | null = body.run_id || null;

    if (!competitorAdId) {
      return jsonResponse({ error: "competitor_ad_id is required" }, 400);
    }

    if (!VIDEO_WORKER_URL) {
      return jsonResponse({ error: "VIDEO_WORKER_URL not configured" }, 500);
    }

    // 1. Look up the competitor ad to get video_url
    console.log(`Looking up competitor ad: ${competitorAdId}`);
    const ad = await getCompetitorAd(competitorAdId);
    const videoUrl = ad.video_url;

    if (!videoUrl) {
      return jsonResponse({ error: `No video_url for competitor ad ${competitorAdId}` }, 400);
    }

    // 2. Check for existing analysis (avoid duplicates)
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?competitor_ad_id=eq.${encodeURIComponent(competitorAdId)}&status=in.(processing,complete)&select=id,status&limit=1`,
      { headers: supabaseHeaders() }
    );
    const existing = await existingRes.json();
    if (existing && existing.length > 0) {
      return jsonResponse({
        error: "Analysis already exists for this ad",
        existing_analysis_id: existing[0].id,
        existing_status: existing[0].status,
      }, 409);
    }

    // 3. Create analysis record with status=processing
    console.log(`Creating analysis record for ad: ${competitorAdId}`);
    const analysis = await createAnalysisRecord(competitorAdId, videoUrl, runId);
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
    const updatedAnalysis = await updateAnalysisRecord(analysisId, {
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

    console.log(`Analysis complete: ${analysisId}`);

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      competitor_ad_id: competitorAdId,
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
