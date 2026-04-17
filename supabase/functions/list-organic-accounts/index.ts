// Supabase Edge Function: list-organic-accounts
// Returns the list of organic accounts we follow (IG + YouTube).
// Supports filters: platform, is_active. Pagination: limit, offset.
// Always ordered by brand_name asc, then platform asc for deterministic UI.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FUNCTION_VERSION = "list-organic-accounts@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Function-Version": FUNCTION_VERSION,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let platform = "";
    let isActive: string | null = null;
    let limit = 100;
    let offset = 0;

    if (req.method === "GET") {
      const url = new URL(req.url);
      platform = url.searchParams.get("platform") || "";
      isActive = url.searchParams.get("is_active");
      limit = parseInt(url.searchParams.get("limit") || "100");
      offset = parseInt(url.searchParams.get("offset") || "0");
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      platform = body.platform || "";
      isActive = typeof body.is_active === "boolean" ? String(body.is_active) : null;
      limit = typeof body.limit === "number" ? body.limit : 100;
      offset = typeof body.offset === "number" ? body.offset : 0;
    }

    if (platform && !["instagram", "youtube"].includes(platform)) {
      return jsonResponse(
        { error: "platform must be one of: instagram, youtube" },
        400,
      );
    }

    const params = new URLSearchParams();
    params.append("select", "*");
    if (platform) params.append("platform", `eq.${platform}`);
    if (isActive === "true" || isActive === "false") {
      params.append("is_active", `eq.${isActive}`);
    }
    // Deterministic ordering for a stable UI list.
    params.append("order", "brand_name.asc,platform.asc");
    params.append("limit", String(Math.min(Math.max(limit, 1), 500)));
    params.append("offset", String(Math.max(offset, 0)));

    const headers = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_organic_accounts?${params}`,
      { headers },
    );

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse(
        { error: `Query failed: ${res.status} ${errText}` },
        500,
      );
    }

    const accounts = await res.json();

    // Exact count with a HEAD-style call so pagination can size controls correctly.
    const countParams = new URLSearchParams();
    if (platform) countParams.append("platform", `eq.${platform}`);
    if (isActive === "true" || isActive === "false") {
      countParams.append("is_active", `eq.${isActive}`);
    }
    countParams.append("select", "id");

    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_organic_accounts?${countParams}`,
      {
        headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
      },
    );
    const contentRange = countRes.headers.get("content-range") || "";
    const totalMatch = contentRange.match(/\/(\d+|\*)/);
    const total = totalMatch && totalMatch[1] !== "*"
      ? parseInt(totalMatch[1])
      : accounts.length;

    return jsonResponse({
      success: true,
      total,
      limit,
      offset,
      accounts,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
