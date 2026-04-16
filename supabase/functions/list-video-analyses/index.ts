import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Bumped by commit, read back via `X-Function-Version` response header to
// verify a deploy has actually landed. See docs/branching-and-ci.md.
const FUNCTION_VERSION = "list-video-analyses@1.1.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Function-Version": FUNCTION_VERSION },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let status = "";
    let runId = "";
    let competitorAdId = "";
    let limit = 50;
    let offset = 0;
    let orderBy = "created_at";
    let orderDir = "desc";

    if (req.method === "GET") {
      const url = new URL(req.url);
      status = url.searchParams.get("status") || "";
      runId = url.searchParams.get("run_id") || "";
      competitorAdId = url.searchParams.get("competitor_ad_id") || "";
      limit = parseInt(url.searchParams.get("limit") || "50");
      offset = parseInt(url.searchParams.get("offset") || "0");
      orderBy = url.searchParams.get("order_by") || "created_at";
      orderDir = url.searchParams.get("order_dir") || "desc";
    } else if (req.method === "POST") {
      const body = await req.json();
      status = body.status || "";
      runId = body.run_id || "";
      competitorAdId = body.competitor_ad_id || "";
      limit = body.limit || 50;
      offset = body.offset || 0;
      orderBy = body.order_by || "created_at";
      orderDir = body.order_dir || "desc";
    }

    // Build query string
    const params = new URLSearchParams();
    params.append("select", "*,competitor_ads(id,page_name,creative_title,display_format,days_active,thumbnail_url)");
    if (status) params.append("status", `eq.${status}`);
    if (runId) params.append("run_id", `eq.${runId}`);
    if (competitorAdId) params.append("competitor_ad_id", `eq.${competitorAdId}`);
    params.append("order", `${orderBy}.${orderDir}`);
    params.append("limit", String(Math.min(limit, 200)));
    params.append("offset", String(offset));

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?${params}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: `Query failed: ${res.status} ${errText}` }, 500);
    }

    const analyses = await res.json();

    // Get total count
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?select=id${status ? `&status=eq.${status}` : ""}${runId ? `&run_id=eq.${runId}` : ""}${competitorAdId ? `&competitor_ad_id=eq.${competitorAdId}` : ""}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0",
        },
      }
    );
    const contentRange = countRes.headers.get("content-range") || "";
    const totalMatch = contentRange.match(/\/(\d+|\*)/);
    const total = totalMatch ? parseInt(totalMatch[1]) : analyses.length;

    return jsonResponse({
      success: true,
      total,
      limit,
      offset,
      analyses,
    });

  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
