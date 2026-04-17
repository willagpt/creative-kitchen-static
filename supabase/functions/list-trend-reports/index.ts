// GET|POST /functions/v1/list-trend-reports
// Lists trend_reports rows, most recent first.
// v1.0.0

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FUNCTION_VERSION = "list-trend-reports@1.0.0";

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let status = "";
  let limit = 50;

  if (req.method === "GET") {
    const url = new URL(req.url);
    status = url.searchParams.get("status") || "";
    limit = parseInt(url.searchParams.get("limit") || "50");
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    status = body.status || "";
    limit = body.limit || 50;
  }

  const params = new URLSearchParams();
  params.append(
    "select",
    "id,title,filter,source_count,status,error_message,model,created_at,completed_at"
  );
  if (status) params.append("status", `eq.${status}`);
  params.append("order", "created_at.desc");
  params.append("limit", String(Math.min(limit, 200)));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/trend_reports?${params}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: `Query failed: ${res.status} ${errText}` }, 500);
  }

  const reports = await res.json();
  return jsonResponse({ success: true, reports });
});
