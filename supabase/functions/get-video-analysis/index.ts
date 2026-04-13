import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let analysisId = "";

    if (req.method === "GET") {
      const url = new URL(req.url);
      analysisId = url.searchParams.get("id") || "";
    } else if (req.method === "POST") {
      const body = await req.json();
      analysisId = body.id || "";
    }

    if (!analysisId) {
      return jsonResponse({ error: "id is required" }, 400);
    }

    const headers = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    // Fetch the analysis with related competitor ad data
    const analysisRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${encodeURIComponent(analysisId)}&select=*,competitor_ads(id,page_name,creative_title,creative_body,display_format,days_active,thumbnail_url,video_url,is_active,platforms,start_date)&limit=1`,
      { headers }
    );

    if (!analysisRes.ok) {
      const errText = await analysisRes.text();
      return jsonResponse({ error: `Query failed: ${analysisRes.status} ${errText}` }, 500);
    }

    const analyses = await analysisRes.json();
    if (!analyses || analyses.length === 0) {
      return jsonResponse({ error: `Analysis not found: ${analysisId}` }, 404);
    }

    const analysis = analyses[0];

    // Fetch all shots for this analysis, ordered by shot_number
    const shotsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_shots?video_analysis_id=eq.${analysisId}&order=shot_number.asc&select=*`,
      { headers }
    );

    let shots: unknown[] = [];
    if (shotsRes.ok) {
      shots = await shotsRes.json();
    }

    return jsonResponse({
      success: true,
      analysis: {
        ...analysis,
        shots,
      },
    });

  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
