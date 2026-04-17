// GET|POST /functions/v1/get-trend-report?id=...
// Returns a single trend_reports row with summary JSON + a compact list of
// the source analyses (id, source, duration_seconds, pacing, thumbnail).
// v1.0.0

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FUNCTION_VERSION = "get-trend-report@1.0.0";

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

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let reportId = "";
  if (req.method === "GET") {
    reportId = new URL(req.url).searchParams.get("id") || "";
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    reportId = body.id || "";
  }
  if (!reportId) return jsonResponse({ error: "id required" }, 400);

  // 1. Fetch the report
  const rRes = await fetch(
    `${SUPABASE_URL}/rest/v1/trend_reports?id=eq.${encodeURIComponent(reportId)}&select=*&limit=1`,
    { headers: sbHeaders() }
  );
  if (!rRes.ok) return jsonResponse({ error: `Failed to load report: ${rRes.status}` }, 500);
  const rows = await rRes.json();
  if (!rows || rows.length === 0) return jsonResponse({ error: "Report not found" }, 404);
  const report = rows[0];

  // 2. Fetch source analyses (shallow)
  const srcIds = Array.isArray(report.source_analysis_ids) ? (report.source_analysis_ids as string[]) : [];
  let sources: Array<Record<string, unknown>> = [];
  if (srcIds.length > 0) {
    const inList = srcIds.map((id) => `"${id}"`).join(",");
    const aRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=in.(${inList})&select=id,source,source_id,duration_seconds,total_shots,pacing_profile,contact_sheet_url,competitor_ad_id,created_at`,
      { headers: sbHeaders() }
    );
    if (aRes.ok) {
      sources = await aRes.json();

      // Batch: competitor_ads + organic_posts
      const adIds = sources.filter((s) => s.source === "competitor_ad" && s.source_id).map((s) => String(s.source_id));
      const orgIds = sources.filter((s) => s.source === "organic_post" && s.source_id).map((s) => String(s.source_id));
      if (adIds.length > 0) {
        const a2 = [...new Set(adIds)].map((id) => `"${id}"`).join(",");
        const adRes = await fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?id=in.(${a2})&select=id,page_name,creative_title,thumbnail_url`,
          { headers: sbHeaders() }
        );
        if (adRes.ok) {
          const ads = await adRes.json() as Array<Record<string, unknown>>;
          const byId = new Map(ads.map((a) => [String(a.id), a]));
          for (const s of sources) {
            if (s.source === "competitor_ad" && s.source_id) {
              const ad = byId.get(String(s.source_id));
              if (ad) (s as Record<string, unknown>).competitor_ad = ad;
            }
          }
        }
      }
      if (orgIds.length > 0) {
        const o2 = [...new Set(orgIds)].map((id) => `"${id}"`).join(",");
        const pRes = await fetch(
          `${SUPABASE_URL}/rest/v1/organic_posts?id=in.(${o2})&select=id,platform,post_url,thumbnail_url,title,post_type,account_id`,
          { headers: sbHeaders() }
        );
        if (pRes.ok) {
          const posts = await pRes.json() as Array<Record<string, unknown>>;
          const accIds = [...new Set(posts.map((p) => String(p.account_id)).filter(Boolean))];
          let accById = new Map<string, Record<string, unknown>>();
          if (accIds.length > 0) {
            const accInList = accIds.map((id) => `"${id}"`).join(",");
            const accRes = await fetch(
              `${SUPABASE_URL}/rest/v1/followed_organic_accounts?id=in.(${accInList})&select=id,brand_name,handle,platform`,
              { headers: sbHeaders() }
            );
            if (accRes.ok) {
              const accs = await accRes.json() as Array<Record<string, unknown>>;
              accById = new Map(accs.map((a) => [String(a.id), a]));
            }
          }
          const byId = new Map(posts.map((p) => [String(p.id), { ...p, account: accById.get(String(p.account_id)) || null }]));
          for (const s of sources) {
            if (s.source === "organic_post" && s.source_id) {
              const post = byId.get(String(s.source_id));
              if (post) (s as Record<string, unknown>).organic_post = post;
            }
          }
        }
      }
    }
  }

  return jsonResponse({ success: true, report, sources });
});
