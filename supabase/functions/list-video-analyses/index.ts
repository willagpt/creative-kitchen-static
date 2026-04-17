import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FUNCTION_VERSION = "list-video-analyses@1.2.0";

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

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let status = "";
    let runId = "";
    let competitorAdId = "";
    let source = "";
    let sourceId = "";
    let limit = 50;
    let offset = 0;
    let orderBy = "created_at";
    let orderDir = "desc";

    if (req.method === "GET") {
      const url = new URL(req.url);
      status = url.searchParams.get("status") || "";
      runId = url.searchParams.get("run_id") || "";
      competitorAdId = url.searchParams.get("competitor_ad_id") || "";
      source = url.searchParams.get("source") || "";
      sourceId = url.searchParams.get("source_id") || "";
      limit = parseInt(url.searchParams.get("limit") || "50");
      offset = parseInt(url.searchParams.get("offset") || "0");
      orderBy = url.searchParams.get("order_by") || "created_at";
      orderDir = url.searchParams.get("order_dir") || "desc";
    } else if (req.method === "POST") {
      const body = await req.json();
      status = body.status || "";
      runId = body.run_id || "";
      competitorAdId = body.competitor_ad_id || "";
      source = body.source || "";
      sourceId = body.source_id || "";
      limit = body.limit || 50;
      offset = body.offset || 0;
      orderBy = body.order_by || "created_at";
      orderDir = body.order_dir || "desc";
    }

    const params = new URLSearchParams();
    params.append(
      "select",
      "*,competitor_ads(id,page_name,creative_title,display_format,days_active,thumbnail_url)"
    );
    if (status) params.append("status", `eq.${status}`);
    if (runId) params.append("run_id", `eq.${runId}`);
    if (competitorAdId) params.append("competitor_ad_id", `eq.${competitorAdId}`);
    if (source) params.append("source", `eq.${source}`);
    if (sourceId) params.append("source_id", `eq.${sourceId}`);
    params.append("order", `${orderBy}.${orderDir}`);
    params.append("limit", String(Math.min(limit, 200)));
    params.append("offset", String(offset));

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?${params}`,
      { headers: supabaseHeaders() }
    );

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: `Query failed: ${res.status} ${errText}` }, 500);
    }

    const analyses: Array<Record<string, unknown>> = await res.json();

    // Enrich organic_post rows with minimal organic_posts metadata
    // (platform, post_url, thumbnail_url, title, caption, post_type).
    const organicIds = analyses
      .filter((a) => a.source === "organic_post" && a.source_id)
      .map((a) => String(a.source_id));

    if (organicIds.length > 0) {
      const unique = [...new Set(organicIds)];
      const inList = unique.map((id) => `"${id}"`).join(",");
      const orgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/organic_posts?id=in.(${inList})&select=id,platform,post_url,thumbnail_url,title,caption,post_type,account_id,duration_seconds,posted_at`,
        { headers: supabaseHeaders() }
      );
      if (orgRes.ok) {
        const posts: Array<Record<string, unknown>> = await orgRes.json();
        const byId = new Map(posts.map((p) => [String(p.id), p]));

        // Also fetch account handles in one go
        const accountIds = [...new Set(posts.map((p) => String(p.account_id)).filter(Boolean))];
        let accountsById = new Map<string, Record<string, unknown>>();
        if (accountIds.length > 0) {
          const accInList = accountIds.map((id) => `"${id}"`).join(",");
          const accRes = await fetch(
            `${SUPABASE_URL}/rest/v1/followed_organic_accounts?id=in.(${accInList})&select=id,brand_name,handle,platform`,
            { headers: supabaseHeaders() }
          );
          if (accRes.ok) {
            const accs: Array<Record<string, unknown>> = await accRes.json();
            accountsById = new Map(accs.map((a) => [String(a.id), a]));
          }
        }

        for (const a of analyses) {
          if (a.source === "organic_post" && a.source_id) {
            const p = byId.get(String(a.source_id));
            if (p) {
              const acc = accountsById.get(String(p.account_id)) || null;
              a.organic_post = { ...p, account: acc };
            }
          }
        }
      }
    }

    // Total count
    const countParams = new URLSearchParams();
    countParams.append("select", "id");
    if (status) countParams.append("status", `eq.${status}`);
    if (runId) countParams.append("run_id", `eq.${runId}`);
    if (competitorAdId) countParams.append("competitor_ad_id", `eq.${competitorAdId}`);
    if (source) countParams.append("source", `eq.${source}`);
    if (sourceId) countParams.append("source_id", `eq.${sourceId}`);

    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?${countParams}`,
      {
        headers: {
          ...supabaseHeaders(),
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
