// Supabase Edge Function: save-creator-profile
// Public endpoint (no JWT) that backs the Cut30 creator-profile form.
// Auth is via access_slug — the caller must supply a slug that matches an
// existing row. No row creation happens here; rows must be seeded by an
// admin first (preventing public spam).
//
// GET  ?slug=xxx             -> returns the profile row (or 404)
// POST { slug, profile?,     -> updates profile jsonb + status + completion
//        status?,               for the row matching slug
//        completion_percent? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FUNCTION_VERSION = "save-creator-profile@1.0.0";

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

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET: fetch by slug
    if (req.method === "GET") {
      const url = new URL(req.url);
      const slug = (url.searchParams.get("slug") || "").trim();
      if (!slug) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const rows = await sb(
        `/cut30_creator_profiles?access_slug=eq.${encodeURIComponent(slug)}&select=id,creator_name,brand_name,access_slug,profile,status,completion_percent,created_at,updated_at`,
      );
      if (!rows || rows.length === 0) {
        return jsonResponse({ error: "profile not found for this slug" }, 404);
      }
      return jsonResponse({ profile: rows[0] });
    }

    // POST: update by slug
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const slug = (body.slug || "").toString().trim();
      if (!slug) {
        return jsonResponse({ error: "slug is required in body" }, 400);
      }

      // Verify the row exists before updating.
      const existing = await sb(
        `/cut30_creator_profiles?access_slug=eq.${encodeURIComponent(slug)}&select=id`,
      );
      if (!existing || existing.length === 0) {
        return jsonResponse({ error: "profile not found for this slug" }, 404);
      }

      // Build the patch.
      const patch: Record<string, unknown> = {};
      if (body.profile !== undefined) {
        if (typeof body.profile !== "object" || body.profile === null) {
          return jsonResponse({ error: "profile must be a JSON object" }, 400);
        }
        patch.profile = body.profile;
      }
      if (body.status !== undefined) {
        if (body.status !== "draft" && body.status !== "complete") {
          return jsonResponse({ error: "status must be draft or complete" }, 400);
        }
        patch.status = body.status;
      }
      if (body.completion_percent !== undefined) {
        const n = Number(body.completion_percent);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return jsonResponse({ error: "completion_percent must be 0-100" }, 400);
        }
        patch.completion_percent = Math.round(n);
      }

      if (Object.keys(patch).length === 0) {
        return jsonResponse({ error: "nothing to update" }, 400);
      }

      const updated = await sb(
        `/cut30_creator_profiles?access_slug=eq.${encodeURIComponent(slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );

      return jsonResponse({
        profile: Array.isArray(updated) ? updated[0] : updated,
        saved_at: new Date().toISOString(),
      });
    }

    return jsonResponse({ error: "method not allowed" }, 405);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
