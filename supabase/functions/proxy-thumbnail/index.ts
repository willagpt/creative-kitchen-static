// Supabase Edge Function: proxy-thumbnail
//
// Browser-side fix for Instagram / Facebook CDN hotlink blocking.
//
// Problem:
//   IG/FB CDN URLs (scontent-*.cdninstagram.com, instagram.*.fbcdn.net) carry
//   short-TTL signed `oh=` tokens and cross-check the requesting IP + UA.
//   Browsers hitting them cross-origin (even with referrerPolicy="no-referrer")
//   return 403 once the token expires. Client tricks cannot defeat this.
//
// Fix:
//   Server-side fetch from within the Supabase runtime (trusted IP, no browser
//   referrer). Stream bytes back to the client with a long-lived cache header.
//   The UI still uses the long-term mirror at organic_posts.thumbnail_cached_url
//   (populated on ingest) as the primary path; this function is the fallback
//   for any row that pre-dates the snapshot-on-ingest shipper.
//
// Request shape (GET):
//   /functions/v1/proxy-thumbnail?url=<encoded-original-url>
//
// Response:
//   200 with image bytes + Cache-Control: public, max-age=86400, s-maxage=86400
//   400 for malformed / missing / disallowed url
//   502 if the upstream IG/FB CDN refuses us (expired token)
//
// Auth:
//   verify_jwt: true. The Supabase gateway enforces the JWT; we don't need
//   custom auth code inside.
//
// Safety:
//   Strict host allow-list. No arbitrary SSRF.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FUNCTION_VERSION = "proxy-thumbnail@1.0.0";

// Only IG + FB CDN hosts (and their -*.cdninstagram.com / *.fbcdn.net variants).
// Anything else returns 400.
const HOST_PATTERNS: RegExp[] = [
  /^scontent(-[a-z0-9-]+)?\.cdninstagram\.com$/i,
  /^[a-z0-9-]+\.cdninstagram\.com$/i,
  /^instagram(\.[a-z0-9-]+)+\.fbcdn\.net$/i,
  /^[a-z0-9-]+\.fbcdn\.net$/i,
];

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB, generous for IG/FB thumbs

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Function-Version": FUNCTION_VERSION,
    },
  });
}

function isAllowedHost(host: string): boolean {
  return HOST_PATTERNS.some(re => re.test(host));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("method not allowed", 405);
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return errorResponse("missing url param", 400);

  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    return errorResponse("malformed url", 400);
  }

  if (upstream.protocol !== "https:") {
    return errorResponse("only https upstream allowed", 400);
  }

  if (!isAllowedHost(upstream.hostname)) {
    return errorResponse(`host not allowed: ${upstream.hostname}`, 400);
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // IG/FB respond to browser-ish UAs; mimic a generic one so we don't
        // tip into bot-block territory.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        "Accept": "image/*,*/*;q=0.8",
      },
    });
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`upstream fetch failed: ${msg}`, 502);
  }
  clearTimeout(t);

  if (!upstreamRes.ok) {
    return errorResponse(
      `upstream returned ${upstreamRes.status}`,
      upstreamRes.status === 403 || upstreamRes.status === 404 ? 502 : 502,
    );
  }

  const contentType = upstreamRes.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return errorResponse(`unexpected content-type: ${contentType}`, 502);
  }

  // Enforce MAX_BYTES without buffering a malicious enormous stream
  const contentLengthHeader = upstreamRes.headers.get("content-length");
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_BYTES) {
      return errorResponse(`upstream too large: ${len} bytes`, 502);
    }
  }

  const reader = upstreamRes.body?.getReader();
  if (!reader) return errorResponse("upstream has no body", 502);

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return errorResponse(`upstream exceeded ${MAX_BYTES} bytes`, 502);
      }
      chunks.push(value);
    }
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }

  return new Response(buf, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      // One day CDN cache is fine; IG URLs rotate within hours-days anyway.
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Function-Version": FUNCTION_VERSION,
    },
  });
});
