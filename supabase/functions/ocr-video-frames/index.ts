import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
// Default to Sonnet 4.6 for rich frame descriptions + OCR. Override with body.model if needed.
const DEFAULT_MODEL = "claude-sonnet-4-6";

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

// Retry wrapper with exponential backoff for transient errors (429, 529)
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status === 529) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1500; // 1.5s, 3s
        console.log(`API returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
    return res;
  }
  throw new Error("Max retries exceeded");
}

async function ocrFrameBatch(
  frames: Array<{ shot_number: number; frame_url: string; start_time: number; end_time: number }>,
  model: string
): Promise<Array<{ shot_number: number; ocr_text: string; description: string }>> {
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

  console.log(`Calling Claude API (model: ${model}) with ${frames.length} frames...`);
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude Vision API error: ${res.status} ${errText}`);
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "[]";

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error(`Failed to parse Claude response: ${e}`);
    console.error(`Raw response: ${text.slice(0, 500)}`);
    return [];
  }
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
    const batchSize: number = body.batch_size || 8;
    const model: string = body.model || DEFAULT_MODEL;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "CLAUDE_API_KEY / ANTHROPIC_API_KEY not configured" }, 500);
    }

    console.log(`Fetching shots for analysis: ${analysisId}`);
    const shots = await getShots(analysisId);

    if (!shots || shots.length === 0) {
      return jsonResponse({ error: "No shots found for this analysis" }, 404);
    }

    const shotsWithFrames = shots.filter((s: Record<string, unknown>) => s.frame_url);
    console.log(`Found ${shotsWithFrames.length} shots with frames (of ${shots.length} total), model: ${model}`);

    const allResults: Array<{ shot_number: number; ocr_text: string; description: string }> = [];

    for (let i = 0; i < shotsWithFrames.length; i += batchSize) {
      const batch = shotsWithFrames.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: shots ${batch[0].shot_number}-${batch[batch.length - 1].shot_number}`);

      const batchResults = await ocrFrameBatch(
        batch.map((s: Record<string, unknown>) => ({
          shot_number: s.shot_number as number,
          frame_url: s.frame_url as string,
          start_time: parseFloat(String(s.start_time)),
          end_time: parseFloat(String(s.end_time)),
        })),
        model
      );

      allResults.push(...batchResults);
    }

    let updatedCount = 0;
    for (const result of allResults) {
      const shot = shots.find((s: Record<string, unknown>) => s.shot_number === result.shot_number);
      if (shot) {
        await updateShot(shot.id, {
          ocr_text: result.ocr_text || null,
          description: result.description || null,
        });
        updatedCount++;
      }
    }

    const combinedOcr = allResults
      .filter((r) => r.ocr_text && r.ocr_text.trim())
      .map((r) => {
        const shot = shotsWithFrames.find((s: Record<string, unknown>) => s.shot_number === r.shot_number);
        const time = shot ? `[${parseFloat(String(shot.start_time)).toFixed(1)}s]` : "";
        return `${time} ${r.ocr_text}`;
      })
      .join("\n");

    await updateAnalysis(analysisId, {
      ocr_text: combinedOcr || null,
    });

    console.log(`OCR complete: ${updatedCount} shots updated, ${combinedOcr.length} chars of OCR text`);

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      shots_processed: shotsWithFrames.length,
      shots_updated: updatedCount,
      model_used: model,
      ocr_text: combinedOcr,
      results: allResults,
    });

  } catch (err) {
    console.error("ocr-video-frames error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
