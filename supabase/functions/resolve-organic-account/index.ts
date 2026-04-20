// Supabase Edge Function: resolve-organic-account
//
// Turns a user-typed Instagram or YouTube reference into the canonical
// identifiers that `save-organic-account` wants. Does NOT write to the
// database. The UI is expected to chain:
//
//   resolve-organic-account -> save-organic-account -> fetch-{ig,yt}-posts
//
// Request shape (POST, JSON):
//   { platform: "instagram" | "youtube",
//     input: string }          // handle, @handle, UC..., or any canonical URL
//
// Response shape (200):
//   {
//     platform,
//     platform_account_id,         // IG numeric user id, or YT UC... id
//     handle,                      // IG: "allplants", YT: "aragusea" (no @)
//     brand_name,                  // best-effort display name (editable client-side)
//     uploads_playlist_id?,        // YT only (UU... playlist id)
//     avatar_url?,
//     display_name?,               // same as brand_name for YT, username for IG
//     already_tracked,             // true if (platform, platform_account_id) already exists
//     existing?: { id, is_active } // when already_tracked is true
//   }
//
// Cost model:
//   IG: ~$0.002 per resolve via apify/instagram-scraper run-sync
//       (resultsLimit: 1 returns a single post; we pluck ownerId).
//   YT: ~1 quota unit per resolve (channels.list). @handle is resolved
//       via forHandle=, UC via id=.
//
// If the account already exists in followed_organic_accounts we skip the
// upstream call entirely and return the stored row, so idempotent re-adds
// of the same handle cost nothing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";
const YT_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";

const APIFY_ACTOR_ID = "shu8hvrXbJbY3Eb9W"; // apify/instagram-scraper
const APIFY_BASE = "https://api.apify.com/v2";
const YT_BASE = "https://www.googleapis.com/youtube/v3";

const FUNCTION_VERSION = "resolve-organic-account@1.0.0";

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

// ---------- parsing helpers ----------

function stripAt(s: string): string {
  return s.replace(/^@+/, "").trim();
}

// Extract an IG handle from any of:
//   allplants
//   @allplants
//   https://www.instagram.com/allplants
//   https://instagram.com/allplants/
//   instagram.com/allplants/?hl=en
function parseInstagramInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // URL form
  try {
    const maybeUrl = trimmed.startsWith("http") ? trimmed : null;
    if (maybeUrl) {
      const u = new URL(maybeUrl);
      if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (!seg) return null;
      // Strip trailing non-handle segments like /p/, /reel/, /stories/.
      if (["p", "reel", "reels", "stories", "explore", "tv", "s"].includes(seg)) {
        return null;
      }
      return stripAt(seg);
    }
  } catch {
    /* fall through to handle form */
  }
  // Plain handle, possibly with @
  // IG usernames: letters, digits, dot, underscore. Enforce loosely so we
  // don't silently accept garbage.
  const h = stripAt(trimmed).replace(/\/.*$/, "");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(h)) return null;
  return h;
}

// Extract either { channelId: "UC..." } or { handle: "@foo" } or { forUsername: "legacy" }
// from any YT input. We only hit channels.list with forHandle= or id=;
// legacy /c/name and /user/name fall back to trying the handle endpoint first
// and then bail with a helpful error.
interface YoutubeRef {
  channelId?: string;
  handle?: string;       // without leading @
  legacyUser?: string;   // /user/legacy-name
  customSlug?: string;   // /c/custom-slug
}
function parseYoutubeInput(raw: string): YoutubeRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Bare UC... or UU... (UU is uploads playlist, derived from UC by swapping
  // char index 1 — we normalise back to UC).
  const ucMatch = trimmed.match(/^UC[A-Za-z0-9_-]{20,}$/);
  if (ucMatch) return { channelId: trimmed };
  const uuMatch = trimmed.match(/^UU[A-Za-z0-9_-]{20,}$/);
  if (uuMatch) return { channelId: "UC" + trimmed.slice(2) };

  // Bare @handle
  if (trimmed.startsWith("@")) return { handle: stripAt(trimmed) };

  // URL form
  try {
    const u = trimmed.startsWith("http") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/(^|\.)youtu\.be$/i.test(u.hostname)) {
      return null;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // /@handle or /@handle/...
    if (parts[0].startsWith("@")) {
      return { handle: stripAt(parts[0]) };
    }
    // /channel/UC...
    if (parts[0] === "channel" && parts[1] && parts[1].startsWith("UC")) {
      return { channelId: parts[1] };
    }
    // /user/legacy-name
    if (parts[0] === "user" && parts[1]) {
      return { legacyUser: parts[1] };
    }
    // /c/custom-slug
    if (parts[0] === "c" && parts[1]) {
      return { customSlug: parts[1] };
    }
    // Bare /foo (very old convention) - try as handle as a last resort
    return { handle: stripAt(parts[0]) };
  } catch {
    // Not a URL and not UC/@ prefix. Assume plain handle.
    return { handle: stripAt(trimmed) };
  }
}

// ---------- supabase helpers ----------

async function sbGet(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`supabase GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

// Skip the upstream call when we already track this account. Matches the
// UNIQUE(platform, platform_account_id) constraint exactly.
async function findExisting(
  platform: "instagram" | "youtube",
  platformAccountId: string,
): Promise<{ id: string; is_active: boolean; brand_name: string; handle: string; uploads_playlist_id: string | null } | null> {
  const params = new URLSearchParams();
  params.append("select", "id,is_active,brand_name,handle,uploads_playlist_id");
  params.append("platform", `eq.${platform}`);
  params.append("platform_account_id", `eq.${platformAccountId}`);
  params.append("limit", "1");
  const rows = await sbGet(`followed_organic_accounts?${params}`) as Array<
    { id: string; is_active: boolean; brand_name: string; handle: string; uploads_playlist_id: string | null }
  >;
  return rows.length > 0 ? rows[0] : null;
}

// ---------- instagram resolver ----------

interface IgProfileHit {
  ownerId: string;
  ownerUsername: string;
  caption?: string;
}

async function resolveInstagram(handle: string): Promise<{
  platform_account_id: string;
  handle: string;
  brand_name: string;
  display_name: string;
  avatar_url: string | null;
}> {
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN secret not set");

  // Pull a single post. resultsType:"posts" returns posts with ownerId +
  // ownerUsername populated. Limit 1 keeps the pay-per-result cost under
  // $0.003 per resolve.
  const url =
    `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items` +
    `?token=${APIFY_TOKEN}&timeout=120&memory=1024`;

  const input = {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts",
    resultsLimit: 1,
    searchType: "hashtag",
    searchLimit: 1,
    addParentData: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`apify probe failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`no posts found for @${handle} (private, suspended, or misspelled?)`);
  }
  const first = data[0] as IgProfileHit;
  if (!first.ownerId || !first.ownerUsername) {
    throw new Error(`apify returned a row but it's missing ownerId/ownerUsername for @${handle}`);
  }

  // brand_name starts as the username; user can edit before saving.
  return {
    platform_account_id: String(first.ownerId),
    handle: String(first.ownerUsername),
    brand_name: String(first.ownerUsername),
    display_name: String(first.ownerUsername),
    avatar_url: null, // apify/instagram-scraper post payload doesn't carry a profile pic URL
  };
}

// ---------- youtube resolver ----------

interface YtChannelResource {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
}

async function ytChannelsList(params: URLSearchParams): Promise<YtChannelResource | null> {
  if (!YT_API_KEY) throw new Error("YOUTUBE_API_KEY secret not set");
  params.append("part", "snippet,contentDetails");
  params.append("key", YT_API_KEY);
  params.append("maxResults", "1");
  const res = await fetch(`${YT_BASE}/channels?${params}`);
  if (!res.ok) {
    throw new Error(`youtube channels.list failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const items = (data.items || []) as YtChannelResource[];
  return items[0] || null;
}

function pickAvatar(thumbs?: Record<string, { url: string }>): string | null {
  if (!thumbs) return null;
  return thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
}

async function resolveYoutube(ref: YoutubeRef): Promise<{
  platform_account_id: string;
  handle: string;
  brand_name: string;
  display_name: string;
  avatar_url: string | null;
  uploads_playlist_id: string;
}> {
  let channel: YtChannelResource | null = null;

  if (ref.channelId) {
    const p = new URLSearchParams();
    p.append("id", ref.channelId);
    channel = await ytChannelsList(p);
  } else if (ref.handle) {
    const p = new URLSearchParams();
    p.append("forHandle", `@${ref.handle}`);
    channel = await ytChannelsList(p);
  } else if (ref.legacyUser) {
    const p = new URLSearchParams();
    p.append("forUsername", ref.legacyUser);
    channel = await ytChannelsList(p);
  } else if (ref.customSlug) {
    // Channels.list has no forCustomUrl. Try handle=customSlug as a best effort
    // since most creators migrated their /c/slug to @slug.
    const p = new URLSearchParams();
    p.append("forHandle", `@${ref.customSlug}`);
    channel = await ytChannelsList(p);
  }

  if (!channel) {
    throw new Error(
      "could not resolve YouTube channel. Try pasting the canonical channel URL (youtube.com/@handle or /channel/UC...).",
    );
  }

  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    throw new Error(`YouTube channel ${channel.id} has no uploads playlist (private or malformed)`);
  }

  // Prefer the customUrl (usually "@handle") for display; fall back to the
  // channel title. Strip the leading @ for storage consistency with IG.
  const custom = channel.snippet?.customUrl || "";
  const handle = custom.startsWith("@") ? custom.slice(1) : (custom || channel.snippet?.title || channel.id);
  const title = channel.snippet?.title || handle;

  return {
    platform_account_id: channel.id,
    handle,
    brand_name: title,
    display_name: title,
    avatar_url: pickAvatar(channel.snippet?.thumbnails),
    uploads_playlist_id: uploads,
  };
}

// ---------- handler ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  let body: Record<string, unknown> | null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "JSON body required" }, 400);
  }

  const platform = String(body.platform || "").toLowerCase();
  const input = String(body.input || "").trim();

  if (platform !== "instagram" && platform !== "youtube") {
    return jsonResponse({ error: "platform must be 'instagram' or 'youtube'" }, 400);
  }
  if (!input) {
    return jsonResponse({ error: "input is required (handle, URL, or channel id)" }, 400);
  }

  try {
    if (platform === "instagram") {
      const handle = parseInstagramInput(input);
      if (!handle) {
        return jsonResponse({
          error:
            "could not parse Instagram input. Try @handle, handle, or https://instagram.com/handle",
        }, 400);
      }

      // Short-circuit if we already track this handle (common re-add case).
      // The UNIQUE constraint is on (platform, platform_account_id), not
      // (platform, handle), so we still need to probe Apify for the real
      // numeric id before we can say for sure - but a same-handle hit is
      // a strong signal worth surfacing so the UI can offer "activate" vs
      // "add again".
      const existingByHandle = await sbGet(
        `followed_organic_accounts?select=id,is_active,brand_name,handle,platform_account_id,uploads_playlist_id&platform=eq.instagram&handle=eq.${encodeURIComponent(handle)}&limit=1`,
      ) as Array<{
        id: string; is_active: boolean; brand_name: string; handle: string;
        platform_account_id: string; uploads_playlist_id: string | null;
      }>;
      if (existingByHandle.length > 0) {
        const row = existingByHandle[0];
        return jsonResponse({
          platform: "instagram",
          platform_account_id: row.platform_account_id,
          handle: row.handle,
          brand_name: row.brand_name,
          display_name: row.handle,
          avatar_url: null,
          already_tracked: true,
          existing: { id: row.id, is_active: row.is_active },
        });
      }

      const resolved = await resolveInstagram(handle);

      // Paranoia: a second account might exist with the same numeric id but
      // a different handle (rename). Surface that so the UI can warn.
      const existingById = await findExisting("instagram", resolved.platform_account_id);
      return jsonResponse({
        platform: "instagram",
        ...resolved,
        already_tracked: !!existingById,
        existing: existingById ? { id: existingById.id, is_active: existingById.is_active } : undefined,
      });
    }

    // ---------- youtube ----------
    const ref = parseYoutubeInput(input);
    if (!ref || (!ref.channelId && !ref.handle && !ref.legacyUser && !ref.customSlug)) {
      return jsonResponse({
        error:
          "could not parse YouTube input. Try @handle, UC... channel id, or a youtube.com URL.",
      }, 400);
    }

    const resolved = await resolveYoutube(ref);

    const existing = await findExisting("youtube", resolved.platform_account_id);
    return jsonResponse({
      platform: "youtube",
      ...resolved,
      already_tracked: !!existing,
      existing: existing ? { id: existing.id, is_active: existing.is_active } : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
