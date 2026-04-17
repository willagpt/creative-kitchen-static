// Supabase Edge Function: save-organic-account
// Upsert (create or update) an organic account row, or soft-deactivate one.
//
// Request shape (POST, JSON):
//   action: "upsert" (default) | "deactivate" | "activate"
//
// For upsert:
//   { brand_name, platform, handle, platform_account_id,
//     uploads_playlist_id?, is_active?, fetch_frequency? }
//   - (platform, platform_account_id) is the UNIQUE key
//   - if the row exists, we update the mutable fields; the DB UNIQUE constraint
//     guarantees there's only ever one row per (platform, platform_account_id)
//
// For deactivate / activate:
//   { id } or { platform, platform_account_id }
//   - flips is_active without deleting data (so posts + history are preserved)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FUNCTION_VERSION = "save-organic-account@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const PLATFORMS = new Set(["instagram", "youtube"]);
const VALID_ACTIONS = new Set(["upsert", "activate", "deactivate"]);

async function findByNaturalKey(
  platform: string,
  platformAccountId: string,
): Promise<{ id: string } | null> {
  const params = new URLSearchParams();
  params.append("select", "id");
  params.append("platform", `eq.${platform}`);
  params.append("platform_account_id", `eq.${platformAccountId}`);
  params.append("limit", "1");

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/followed_organic_accounts?${params}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? { id: rows[0].id } : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "JSON body required" }, 400);
    }

    const action = body.action || "upsert";
    if (!VALID_ACTIONS.has(action)) {
      return jsonResponse(
        {
          error: `action must be one of: ${[...VALID_ACTIONS].join(", ")}`,
        },
        400,
      );
    }

    const headers = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    // -----------------------------------------------------------------------
    // activate / deactivate — soft toggle of is_active
    // -----------------------------------------------------------------------
    if (action === "activate" || action === "deactivate") {
      let accountId: string | null = body.id || null;

      if (!accountId) {
        if (!body.platform || !body.platform_account_id) {
          return jsonResponse(
            {
              error:
                "id OR (platform + platform_account_id) required for this action",
            },
            400,
          );
        }
        const found = await findByNaturalKey(
          body.platform,
          body.platform_account_id,
        );
        if (!found) {
          return jsonResponse(
            { error: "account not found" },
            404,
          );
        }
        accountId = found.id;
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/followed_organic_accounts?id=eq.${accountId}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify({ is_active: action === "activate" }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        return jsonResponse(
          { error: `Update failed: ${res.status} ${errText}` },
          500,
        );
      }
      const rows = await res.json();
      return jsonResponse({ success: true, action, account: rows[0] });
    }

    // -----------------------------------------------------------------------
    // upsert — create or update
    // -----------------------------------------------------------------------
    const required = ["brand_name", "platform", "handle", "platform_account_id"];
    const missing = required.filter((k) => !body[k] || typeof body[k] !== "string");
    if (missing.length > 0) {
      return jsonResponse(
        { error: `Missing required fields: ${missing.join(", ")}` },
        400,
      );
    }

    if (!PLATFORMS.has(body.platform)) {
      return jsonResponse(
        { error: "platform must be one of: instagram, youtube" },
        400,
      );
    }

    const payload: Record<string, unknown> = {
      brand_name: body.brand_name,
      platform: body.platform,
      handle: body.handle,
      platform_account_id: body.platform_account_id,
    };
    if (typeof body.uploads_playlist_id === "string") {
      payload.uploads_playlist_id = body.uploads_playlist_id;
    }
    if (typeof body.is_active === "boolean") {
      payload.is_active = body.is_active;
    }
    if (typeof body.fetch_frequency === "string") {
      payload.fetch_frequency = body.fetch_frequency;
    }

    // Use PostgREST on_conflict upsert against the UNIQUE(platform, platform_account_id)
    // constraint. Prefer: resolution=merge-duplicates keeps the row id stable.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_organic_accounts?on_conflict=platform,platform_account_id`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse(
        { error: `Upsert failed: ${res.status} ${errText}` },
        500,
      );
    }

    const rows = await res.json();
    return jsonResponse({
      success: true,
      action: "upsert",
      account: rows[0],
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
