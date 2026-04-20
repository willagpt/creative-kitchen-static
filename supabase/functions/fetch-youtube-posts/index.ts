// Supabase Edge Function: fetch-youtube-posts
//
// Fetches recent YouTube uploads for one followed channel via the YouTube
// Data API v3, distinguishes Shorts from regular videos, upserts into
// `organic_posts` (dedupe on (platform, platform_post_id)), appends a
// fresh `organic_post_metrics` row per video, and logs the run to
// `organic_fetch_log`.
//
// Request shape (POST, JSON):
//   { account_id?: uuid,
//     handle?: string,                // alternative to account_id
//     platform_account_id?: string,   // channel id (UC...)
//     limit?: number = 20,            // videos per fetch (max 500)
//     mode?: "fetch" | "test" = "fetch",
//     quota_budget?: number = 10000 } // monthly quota soft cap
//
// Quota model (YouTube Data API v3):
//   playlistItems.list (contentDetails) = 1 unit / page (50 items)
//   videos.list (snippet, contentDetails, statistics) = 1 unit / batch (50 ids)
//   Per fetch: ceil(limit / 50) * 2 quota units.
//
// Shorts detection:
//   duration_seconds <= 60 AND HEAD /shorts/{id} returns 200 (or redirect
//   location still contains /shorts/). For duration > 60s we skip the
//   HEAD probe and classify as "video".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const YT_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";

const YT_BASE = "https://www.googleapis.com/youtube/v3";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const YT_PAGE_SIZE = 50;
const DEFAULT_QUOTA_BUDGET = 10000;
const QUOTA_WARN_PCT = 0.80;

const FUNCTION_VERSION = "fetch-youtube-posts@1.1.0";

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

interface OrganicAccount {
  id: string;
  platform: string;
  handle: string;
  brand_name: string;
  platform_account_id: string;
  uploads_playlist_id: string | null;
  is_active: boolean;
}

interface YtVideoResource {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url: string; width?: number; height?: number }>;
    tags?: string[];
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
    categoryId?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: {
    duration?: string;
    dimension?: string;
    definition?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    favoriteCount?: string;
  };
}

// ---- supabase helpers ------------------------------------------------------

async function sbGet(path: string): Promise<any> {
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

async function sbPost(path: string, body: unknown, prefer?: string): Promise<any> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`supabase POST ${path} failed: ${res.status} ${await res.text()}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? await res.json() : null;
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
  if (!res.ok) {
    throw new Error(`supabase PATCH ${path} failed: ${res.status} ${await res.text()}`);
  }
}

// ---- account lookup --------------------------------------------------------

async function resolveAccount(input: {
  account_id?: string;
  handle?: string;
  platform_account_id?: string;
}): Promise<OrganicAccount | null> {
  const params = new URLSearchParams();
  params.append("select", "id,platform,handle,brand_name,platform_account_id,uploads_playlist_id,is_active");
  params.append("platform", "eq.youtube");
  if (input.account_id) {
    params.append("id", `eq.${input.account_id}`);
  } else if (input.platform_account_id) {
    params.append("platform_account_id", `eq.${input.platform_account_id}`);
  } else if (input.handle) {
    params.append("handle", `eq.${input.handle}`);
  } else {
    return null;
  }
  params.append("limit", "1");
  const rows = await sbGet(`followed_organic_accounts?${params}`);
  return rows.length > 0 ? rows[0] as OrganicAccount : null;
}

// ---- quota guard -----------------------------------------------------------

async function monthlyYoutubeQuota(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const params = new URLSearchParams();
  params.append("select", "yt_quota_units");
  params.append("platform", "eq.youtube");
  params.append("started_at", `gte.${start.toISOString()}`);
  const rows = await sbGet(`organic_fetch_log?${params}`);
  let total = 0;
  for (const r of rows) {
    if (r.yt_quota_units != null) total += Number(r.yt_quota_units);
  }
  return total;
}

// ---- youtube api -----------------------------------------------------------

interface PlaylistItem {
  videoId: string;
  publishedAt?: string;
}

async function listUploads(
  uploadsPlaylistId: string,
  limit: number,
): Promise<{ items: PlaylistItem[]; pagesFetched: number }> {
  if (!YT_API_KEY) throw new Error("YOUTUBE_API_KEY secret not set");
  const items: PlaylistItem[] = [];
  let pagesFetched = 0;
  let pageToken: string | undefined = undefined;
  while (items.length < limit) {
    const remaining = limit - items.length;
    const params = new URLSearchParams();
    params.append("part", "contentDetails,snippet");
    params.append("playlistId", uploadsPlaylistId);
    params.append("maxResults", String(Math.min(YT_PAGE_SIZE, remaining)));
    params.append("key", YT_API_KEY);
    if (pageToken) params.append("pageToken", pageToken);
    const url = `${YT_BASE}/playlistItems?${params}`;
    const res = await fetch(url);
    pagesFetched++;
    if (!res.ok) {
      throw new Error(`youtube playlistItems.list failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const it of data.items || []) {
      const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
      if (vid) {
        items.push({
          videoId: vid,
          publishedAt: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt,
        });
      }
    }
    pageToken = data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return { items: items.slice(0, limit), pagesFetched };
}

async function videosList(
  videoIds: string[],
): Promise<{ items: YtVideoResource[]; batches: number }> {
  if (!YT_API_KEY) throw new Error("YOUTUBE_API_KEY secret not set");
  if (videoIds.length === 0) return { items: [], batches: 0 };
  const out: YtVideoResource[] = [];
  let batches = 0;
  for (let i = 0; i < videoIds.length; i += YT_PAGE_SIZE) {
    const chunk = videoIds.slice(i, i + YT_PAGE_SIZE);
    const params = new URLSearchParams();
    params.append("part", "snippet,contentDetails,statistics");
    params.append("id", chunk.join(","));
    params.append("key", YT_API_KEY);
    params.append("maxResults", String(YT_PAGE_SIZE));
    const url = `${YT_BASE}/videos?${params}`;
    const res = await fetch(url);
    batches++;
    if (!res.ok) {
      throw new Error(`youtube videos.list failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const v of (data.items || []) as YtVideoResource[]) out.push(v);
  }
  return { items: out, batches };
}

// ---- duration + shorts detection ------------------------------------------

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  // PT#H#M#S
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return null;
  const h = Number(m[1] || 0);
  const mn = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return Math.round(h * 3600 + mn * 60 + s);
}

async function isShort(videoId: string, durationSec: number | null): Promise<boolean> {
  if (durationSec == null || durationSec > 60) return false;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
    });
    if (res.status >= 200 && res.status < 300) return true;
    const loc = res.headers.get("location") || "";
    return loc.includes("/shorts/");
  } catch {
    // network hiccup → fall back to duration heuristic
    return true;
  }
}

function pickThumb(thumbs?: Record<string, { url: string }>): string | null {
  if (!thumbs) return null;
  return thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url ||
    thumbs.medium?.url || thumbs.default?.url || null;
}

function extractHashtags(description?: string): string[] {
  if (!description) return [];
  const tags: string[] = [];
  const re = /(?:^|\s)#([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(description)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

// ---- mapping ---------------------------------------------------------------

function postType(v: YtVideoResource, isShortFlag: boolean): string {
  const live = v.snippet?.liveBroadcastContent;
  if (live === "live" || live === "upcoming") return "livestream";
  return isShortFlag ? "short" : "video";
}

function mapPost(
  v: YtVideoResource,
  accountId: string,
  isShortFlag: boolean,
  durationSec: number | null,
): Record<string, unknown> | null {
  if (!v.id) return null;
  const snip = v.snippet || {};
  const hashtags = extractHashtags(snip.description);
  if (snip.tags) {
    for (const t of snip.tags) {
      if (!hashtags.includes(t)) hashtags.push(t);
    }
  }
  const url = isShortFlag
    ? `https://www.youtube.com/shorts/${v.id}`
    : `https://www.youtube.com/watch?v=${v.id}`;
  return {
    account_id: accountId,
    platform: "youtube",
    platform_post_id: v.id,
    post_url: url,
    post_type: postType(v, isShortFlag),
    video_url: null,
    thumbnail_url: pickThumb(snip.thumbnails),
    title: snip.title || null,
    caption: snip.description || null,
    hashtags,
    posted_at: snip.publishedAt || null,
    duration_seconds: durationSec,
    audio_id: null,
    audio_title: null,
    language: snip.defaultAudioLanguage || snip.defaultLanguage || null,
    raw: v,
    last_refreshed_at: new Date().toISOString(),
  };
}

function mapMetrics(v: YtVideoResource, postId: string): Record<string, unknown> {
  const s = v.statistics || {};
  return {
    post_id: postId,
    views: s.viewCount != null ? Number(s.viewCount) : null,
    likes: s.likeCount != null ? Number(s.likeCount) : null,
    comments: s.commentCount != null ? Number(s.commentCount) : null,
    saves: null,
    shares: null,
    engagement_rate: null,
  };
}

// ---- upsert + metrics append ----------------------------------------------

interface UpsertResult {
  upserted: Array<{ id: string; platform_post_id: string }>;
  newCount: number;
}

async function upsertPosts(rows: Record<string, unknown>[]): Promise<UpsertResult> {
  if (rows.length === 0) return { upserted: [], newCount: 0 };
  const ids = rows.map(r => r.platform_post_id as string);
  const params = new URLSearchParams();
  params.append("select", "platform_post_id");
  params.append("platform", "eq.youtube");
  params.append("platform_post_id", `in.(${ids.join(",")})`);
  const existing = await sbGet(`organic_posts?${params}`);
  const existingSet = new Set(existing.map((r: any) => r.platform_post_id));
  const newCount = rows.filter(r => !existingSet.has(r.platform_post_id)).length;
  const upserted = await sbPost(
    "organic_posts?on_conflict=platform,platform_post_id&select=id,platform_post_id",
    rows,
    "return=representation,resolution=merge-duplicates",
  );
  return { upserted, newCount };
}

async function appendMetrics(
  posts: Array<{ id: string; platform_post_id: string }>,
  videos: YtVideoResource[],
): Promise<number> {
  if (posts.length === 0) return 0;
  const byId = new Map<string, YtVideoResource>();
  for (const v of videos) if (v.id) byId.set(v.id, v);
  const metricsRows = posts
    .map(p => {
      const v = byId.get(p.platform_post_id);
      if (!v) return null;
      return mapMetrics(v, p.id);
    })
    .filter(Boolean);
  if (metricsRows.length === 0) return 0;
  await sbPost("organic_post_metrics", metricsRows);
  return metricsRows.length;
}

// ---- fetch log -------------------------------------------------------------

async function openLog(accountId: string): Promise<string> {
  const row = await sbPost(
    "organic_fetch_log?select=id",
    { account_id: accountId, platform: "youtube", status: "running" },
    "return=representation",
  );
  return Array.isArray(row) ? row[0].id : row.id;
}

async function closeLog(
  logId: string,
  fields: Partial<{
    posts_fetched: number;
    posts_new: number;
    yt_quota_units: number;
    status: string;
    error_message: string | null;
  }>,
): Promise<void> {
  await sbPatch(`organic_fetch_log?id=eq.${logId}`, {
    ...fields,
    finished_at: new Date().toISOString(),
  });
}

// ---- main ------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  const body = await req.json().catch(() => null);
  if (!body) return jsonResponse({ error: "invalid JSON body" }, 400);

  const mode = body.mode || "fetch";
  const limit = Math.min(Math.max(1, Number(body.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const quotaBudget = Number(body.quota_budget) || DEFAULT_QUOTA_BUDGET;

  let logId: string | null = null;

  try {
    // 1. resolve account
    const account = await resolveAccount({
      account_id: body.account_id,
      handle: body.handle,
      platform_account_id: body.platform_account_id,
    });
    if (!account) {
      return jsonResponse({ error: "account not found (youtube)" }, 404);
    }
    if (!account.is_active && mode !== "test") {
      return jsonResponse({ error: "account is inactive", account_id: account.id }, 400);
    }
    if (!account.uploads_playlist_id) {
      return jsonResponse({ error: "account missing uploads_playlist_id", account_id: account.id }, 400);
    }

    // 2. quota guard (1 unit per playlistItems page + 1 per videos.list batch, both 50 items)
    const projectedPages = Math.max(1, Math.ceil(limit / YT_PAGE_SIZE));
    const projectedQuota = projectedPages * 2;
    const monthSoFar = await monthlyYoutubeQuota();
    const projectedTotal = monthSoFar + projectedQuota;
    if (projectedTotal > quotaBudget) {
      return jsonResponse({
        error: "monthly quota budget exceeded",
        quota_budget: quotaBudget,
        month_used: monthSoFar,
        projected_run: projectedQuota,
        projected_total: projectedTotal,
      }, 429);
    }
    const warned = projectedTotal >= quotaBudget * QUOTA_WARN_PCT;
    if (warned) {
      console.warn(`[fetch-youtube-posts] quota warning: projected ${projectedTotal} >= ${QUOTA_WARN_PCT * 100}% of ${quotaBudget}`);
    }

    // 3. open log
    if (mode !== "test") {
      logId = await openLog(account.id);
    }

    // 4. list uploads (paginated)
    const { items: uploads, pagesFetched } = await listUploads(account.uploads_playlist_id, limit);
    const videoIds = uploads.map(u => u.videoId);
    if (videoIds.length === 0) {
      if (logId) {
        await closeLog(logId, { posts_fetched: 0, posts_new: 0, yt_quota_units: Math.max(1, pagesFetched), status: "success" });
      }
      return jsonResponse({
        success: true, mode, account: { id: account.id, handle: account.handle, brand_name: account.brand_name },
        posts_fetched: 0, posts_upserted: 0, posts_new: 0, quota_units_used: Math.max(1, pagesFetched),
      });
    }

    // 5. fetch full video details (batched in 50s)
    const { items: videos, batches: videoBatches } = await videosList(videoIds);

    // 6. classify shorts (parallel HEADs, bounded concurrency)
    const durations = new Map<string, number | null>();
    for (const v of videos) durations.set(v.id, parseIsoDuration(v.contentDetails?.duration));

    const shortsFlags = new Map<string, boolean>();
    const candidates = videos.filter(v => {
      const d = durations.get(v.id) ?? null;
      return d != null && d <= 60;
    });
    const CONCURRENCY = 5;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const flags = await Promise.all(batch.map(v => isShort(v.id, durations.get(v.id) ?? null)));
      batch.forEach((v, idx) => shortsFlags.set(v.id, flags[idx]));
    }
    for (const v of videos) if (!shortsFlags.has(v.id)) shortsFlags.set(v.id, false);

    const quotaUsed = pagesFetched + videoBatches; // 1 unit per page + 1 per videos.list batch

    // 7. test mode returns shape without writing
    if (mode === "test") {
      return jsonResponse({
        success: true,
        mode: "test",
        account: { id: account.id, handle: account.handle, brand_name: account.brand_name },
        posts_fetched: videos.length,
        quota_units_used: quotaUsed,
        month_quota_used: monthSoFar,
        quota_warned: warned,
        sample: videos.slice(0, 3).map(v => ({
          id: v.id,
          title: v.snippet?.title,
          duration_seconds: durations.get(v.id),
          is_short: shortsFlags.get(v.id) || false,
          published_at: v.snippet?.publishedAt,
          views: v.statistics?.viewCount,
          likes: v.statistics?.likeCount,
        })),
      });
    }

    // 8. map + upsert
    const postRows = videos
      .map(v => mapPost(v, account.id, shortsFlags.get(v.id) || false, durations.get(v.id) ?? null))
      .filter((r): r is Record<string, unknown> => r !== null);

    const { upserted, newCount } = await upsertPosts(postRows);
    const metricsInserted = await appendMetrics(upserted, videos);

    await sbPatch(
      `followed_organic_accounts?id=eq.${account.id}`,
      { last_fetched_at: new Date().toISOString() },
    );

    if (logId) {
      await closeLog(logId, {
        posts_fetched: videos.length,
        posts_new: newCount,
        yt_quota_units: quotaUsed,
        status: "success",
      });
    }

    const shortsCount = [...shortsFlags.values()].filter(Boolean).length;

    return jsonResponse({
      success: true,
      mode: "fetch",
      account: { id: account.id, handle: account.handle, brand_name: account.brand_name },
      posts_fetched: videos.length,
      posts_upserted: postRows.length,
      posts_new: newCount,
      shorts_detected: shortsCount,
      metrics_rows_inserted: metricsInserted,
      quota_units_used: quotaUsed,
      month_quota_used: monthSoFar + quotaUsed,
      quota_budget: quotaBudget,
      quota_warned: warned,
      log_id: logId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      await closeLog(logId, { status: "error", error_message: message }).catch(() => {});
    }
    return jsonResponse({ error: message }, 500);
  }
});
