// Supabase Edge Function: list-organic-posts
// Returns organic posts (IG + YouTube) for followed accounts.
// Supports filters: account_id, platform, post_type, language,
// posted_after, posted_before. Pagination: limit, offset.
// Ordered by posted_at desc (matches organic_posts_account_posted_idx).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FUNCTION_VERSION = "list-organic-posts@1.0.0";

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

type PostFilters = {
  account_id: string;
  platform: string;
  post_type: string;
  language: string;
  posted_after: string;
  posted_before: string;
  limit: number;
  offset: number;
};

function readFilters(source: Record<string, unknown>): PostFilters {
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const num = (v: unknown, fallback: number) => {
    const n = parseInt(str(v));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    account_id: str(source.account_id),
    platform: str(source.platform),
    post_type: str(source.post_type),
    language: str(source.language),
    posted_after: str(source.posted_after),
    posted_before: str(source.posted_before),
    limit: num(source.limit, 100),
    offset: num(source.offset, 0),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let filters: PostFilters;

    if (req.method === "GET") {
      const url = new URL(req.url);
      const record: Record<string, unknown> = {};
      url.searchParams.forEach((v, k) => {
        record[k] = v;
      });
      filters = readFilters(record);
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      filters = readFilters(body || {});
    } else {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    // Validate enum-like fields
    if (filters.platform && !["instagram", "youtube"].includes(filters.platform)) {
      return jsonResponse(
        { success: false, error: "platform must be 'instagram' or 'youtube'" },
        400,
      );
    }

    // UUID sanity check for account_id (don't want to push garbage into PostgREST)
    if (filters.account_id && !/^[0-9a-f-]{36}$/i.test(filters.account_id)) {
      return jsonResponse(
        { success: false, error: "account_id must be a uuid" },
        400,
      );
    }

    // Cap pagination
    const limit = Math.min(Math.max(1, filters.limit), 500);
    const offset = Math.max(0, filters.offset);

    // Build PostgREST query
    const qs = new URLSearchParams();
    qs.append("select", "*");
    qs.append("order", "posted_at.desc.nullslast");
    qs.append("limit", String(limit));
    qs.append("offset", String(offset));

    if (filters.account_id) qs.append("account_id", `eq.${filters.account_id}`);
    if (filters.platform) qs.append("platform", `eq.${filters.platform}`);
    if (filters.post_type) qs.append("post_type", `eq.${filters.post_type}`);
    if (filters.language) qs.append("language", `eq.${filters.language}`);
    if (filters.posted_after) qs.append("posted_at", `gte.${filters.posted_after}`);
    if (filters.posted_before) qs.append("posted_at", `lte.${filters.posted_before}`);

    const url = `${SUPABASE_URL}/rest/v1/organic_posts?${qs.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return jsonResponse(
        { success: false, error: `Supabase error: ${response.status}`, detail: text },
        500,
      );
    }

    const posts = await response.json();

    const contentRange = response.headers.get("Content-Range") || "";
    const totalMatch = contentRange.match(/\/(\d+|\*)$/);
    const total = totalMatch && totalMatch[1] !== "*" ? parseInt(totalMatch[1]) : null;

    return jsonResponse({
      success: true,
      total,
      limit,
      offset,
      filters: {
        account_id: filters.account_id || null,
        platform: filters.platform || null,
        post_type: filters.post_type || null,
        language: filters.language || null,
        posted_after: filters.posted_after || null,
        posted_before: filters.posted_before || null,
      },
      posts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, error: "Unhandled exception", detail: message },
      500,
    );
  }
});
