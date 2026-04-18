// Supabase Edge Function: backfill-organic-thumbs
//
// One-off workhorse that walks `organic_posts` where thumbnail_cached_url is
// NULL, fetches each original thumbnail_url from the IG / FB / YouTube CDN
// server-side, uploads the bytes to the `organic-thumbs` bucket, and patches
// the `thumbnail_cached_url` column.
//
// Intended to be re-runnable: already-cached rows are skipped by the WHERE
// clause. Idempotent storage (x-upsert: true).
//
// Request (POST, JSON):
//   { platform?: "instagram" | "youtube",  // default: "instagram"
//     batch?: number,                      // max rows per call, default 40, max 100
//     dry_run?: boolean }                  // default false
//
// Response:
//   { processed: number, snapshotted: number, skipped: number, failed: number,
//     remaining_null: number, sample_failures: [...] }
//
// Auth: verify_jwt: true. Anon key is fine — we never write to auth.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const THUMBNAIL_BUCKET = "organic-thumbs";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BATCH = 40;
const MAX_BATCH = 100;

const FUNCTION_VERSION = "backfill-organic-thumbs@1.0.0";

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

async function sbGet(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`sbGet ${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function sbPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sbPatch ${path}: ${res.status} ${await res.text()}`);
}

async function sbCountHead(path: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        "Accept": "image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return { bytes: buf, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function uploadBytes(objectKey: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${THUMBNAIL_BUCKET}/${objectKey}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
        "cache-control": "3600",
      },
      body: bytes,
    },
  );
  if (!res.ok) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${THUMBNAIL_BUCKET}/${objectKey}`;
}

function objectKey(platform: string, platformPostId: string): string {
  return `${platform}/${platformPostId}.jpg`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const platform = (body.platform || "instagram") as string;
  if (platform !== "instagram" && platform !== "youtube") {
    return jsonResponse({ error: "platform must be instagram or youtube" }, 400);
  }
  const batch = Math.min(Math.max(1, Number(body.batch) || DEFAULT_BATCH), MAX_BATCH);
  const dryRun = Boolean(body.dry_run);

  const selectParams = new URLSearchParams();
  selectParams.append("select", "id,platform,platform_post_id,thumbnail_url");
  selectParams.append("platform", `eq.${platform}`);
  selectParams.append("thumbnail_cached_url", "is.null");
  selectParams.append("thumbnail_url", "not.is.null");
  selectParams.append("limit", String(batch));
  selectParams.append("order", "first_seen_at.desc");

  const rows = await sbGet(`organic_posts?${selectParams}`);

  const failures: Array<{ id: string; reason: string }> = [];
  let snapshotted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const id = row.id as string;
    const pid = row.platform_post_id as string;
    const src = row.thumbnail_url as string | null;
    if (!pid || !src) { skipped++; continue; }

    if (dryRun) { snapshotted++; continue; }

    const img = await fetchImageBytes(src);
    if (!img) {
      failed++;
      if (failures.length < 5) failures.push({ id, reason: "fetch_failed_or_blocked" });
      continue;
    }

    let contentType = "image/jpeg";
    if (img.bytes[0] === 0x89 && img.bytes[1] === 0x50) contentType = "image/png";
    else if (img.bytes[0] === 0x52 && img.bytes[1] === 0x49 && img.bytes[8] === 0x57) contentType = "image/webp";

    const publicUrl = await uploadBytes(objectKey(platform, pid), img.bytes, contentType);
    if (!publicUrl) {
      failed++;
      if (failures.length < 5) failures.push({ id, reason: "upload_failed" });
      continue;
    }

    try {
      await sbPatch(`organic_posts?id=eq.${id}`, { thumbnail_cached_url: publicUrl });
      snapshotted++;
    } catch (err) {
      failed++;
      if (failures.length < 5) {
        failures.push({ id, reason: `patch_failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  // Count how many are still NULL, for the next batch estimate
  const remainingParams = new URLSearchParams();
  remainingParams.append("select", "id");
  remainingParams.append("platform", `eq.${platform}`);
  remainingParams.append("thumbnail_cached_url", "is.null");
  remainingParams.append("thumbnail_url", "not.is.null");
  const remainingNull = await sbCountHead(`organic_posts?${remainingParams}`);

  return jsonResponse({
    ok: true,
    platform,
    dry_run: dryRun,
    processed: rows.length,
    snapshotted,
    skipped,
    failed,
    remaining_null: remainingNull,
    sample_failures: failures,
  });
});
