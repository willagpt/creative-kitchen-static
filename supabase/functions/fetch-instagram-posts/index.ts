// Supabase Edge Function: fetch-instagram-posts
//
// Fetches recent Instagram posts for one followed account via Apify's
// `apify/instagram-scraper` actor, upserts into `organic_posts`
// (dedupe on (platform, platform_post_id)), appends a fresh
// `organic_post_metrics` row per post, and logs the run to
// `organic_fetch_log`.
//
// Request shape (POST, JSON):
//   { account_id?: uuid,
//     handle?: string,                // alternative to account_id
//     platform_account_id?: string,   // alternative to account_id / handle
//     limit?: number = 50,            // posts per fetch (max 100)
//     mode?: "fetch" | "test" = "fetch",
//     budget_usd?: number = 30 }      // monthly hard cap
//
// Cost model (Apify pay-per-compute, apify/instagram-scraper):
//   ~$2.30 per 1,000 results. cost_estimate = (posts_fetched / 1000) * 2.30.
//
// Budget guard: sum cost_estimate of all instagram runs in current month.
// If current_month_spend + projected_cost > budget_usd -> abort.
// 80% warning: logged to console, still allowed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";

const APIFY_ACTOR_ID = "shu8hvrXbJbY3Eb9W"; // apify/instagram-scraper
const APIFY_BASE = "https://api.apify.com/v2";
const COST_PER_1000 = 2.30; // USD
const DEFAULT_BUDGET_USD = 30;
const BUDGET_WARN_PCT = 0.80;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const FUNCTION_VERSION = "fetch-instagram-posts@1.0.0";

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
  is_active: boolean;
}

interface ApifyPost {
  id?: string;
  shortCode?: string;
  type?: string;
  productType?: string;
  url?: string;
  timestamp?: string;
  caption?: string;
  hashtags?: string[];
  videoUrl?: string;
  displayUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  videoDuration?: number;
  ownerId?: string;
  ownerUsername?: string;
  musicInfo?: {
    audio_id?: string;
    song_name?: string;
    artist_name?: string;
  };
  [key: string]: unknown;
}

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

async function resolveAccount(input: {
  account_id?: string;
  handle?: string;
  platform_account_id?: string;
}): Promise<OrganicAccount | null> {
  const params = new URLSearchParams();
  params.append("select", "id,platform,handle,brand_name,platform_account_id,is_active");
  params.append("platform", "eq.instagram");
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

async function monthlyInstagramSpend(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const params = new URLSearchParams();
  params.append("select", "cost_estimate");
  params.append("platform", "eq.instagram");
  params.append("started_at", `gte.${start.toISOString()}`);
  const rows = await sbGet(`organic_fetch_log?${params}`);
  let total = 0;
  for (const r of rows) {
    if (r.cost_estimate != null) total += Number(r.cost_estimate);
  }
  return total;
}

function estimateCost(postsFetched: number): number {
  return Math.round((postsFetched / 1000) * COST_PER_1000 * 10000) / 10000;
}

async function callApify(handle: string, resultsLimit: number): Promise<ApifyPost[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN secret not set");

  const url =
    `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items` +
    `?token=${APIFY_TOKEN}&timeout=180&memory=1024`;

  const input = {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts",
    resultsLimit,
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
    throw new Error(`apify call failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`apify returned non-array: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data as ApifyPost[];
}

function mapPostType(p: ApifyPost): string {
  const t = (p.type || "").toLowerCase();
  const prod = (p.productType || "").toLowerCase();
  if (t === "video" && prod === "clips") return "reel";
  if (t === "video") return "video";
  if (t === "sidecar") return "carousel";
  if (t === "image") return "image";
  return t || "unknown";
}

function mapPost(p: ApifyPost, accountId: string): Record<string, unknown> | null {
  const platform_post_id = p.id || p.shortCode;
  if (!platform_post_id || !p.url) return null;

  const hashtags = Array.isArray(p.hashtags) ? p.hashtags : [];

  return {
    account_id: accountId,
    platform: "instagram",
    platform_post_id: String(platform_post_id),
    post_url: p.url,
    post_type: mapPostType(p),
    video_url: p.videoUrl || null,
    thumbnail_url: p.displayUrl || null,
    title: null,
    caption: p.caption || null,
    hashtags,
    posted_at: p.timestamp || null,
    duration_seconds: p.videoDuration != null ? p.videoDuration : null,
    audio_id: p.musicInfo?.audio_id || null,
    audio_title: p.musicInfo?.song_name || null,
    language: null,
    raw: p,
    last_refreshed_at: new Date().toISOString(),
  };
}

function mapMetrics(p: ApifyPost, postId: string): Record<string, unknown> {
  const views = p.videoPlayCount ?? p.videoViewCount ?? null;
  return {
    post_id: postId,
    views: views != null ? views : null,
    likes: p.likesCount ?? null,
    comments: p.commentsCount ?? null,
    saves: null,
    shares: null,
    engagement_rate: null,
  };
}

interface UpsertResult {
  upserted: Array<{ id: string; platform_post_id: string }>;
  newCount: number;
}

async function upsertPosts(rows: Record<string, unknown>[]): Promise<UpsertResult> {
  if (rows.length === 0) return { upserted: [], newCount: 0 };

  const ids = rows.map(r => r.platform_post_id as string);
  const params = new URLSearchParams();
  params.append("select", "platform_post_id");
  params.append("platform", "eq.instagram");
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
  apifyPosts: ApifyPost[],
): Promise<number> {
  if (posts.length === 0) return 0;
  const byPid = new Map<string, ApifyPost>();
  for (const p of apifyPosts) {
    const pid = String(p.id || p.shortCode || "");
    if (pid) byPid.set(pid, p);
  }
  const metricsRows = posts
    .map(p => {
      const a = byPid.get(p.platform_post_id);
      if (!a) return null;
      return mapMetrics(a, p.id);
    })
    .filter(Boolean);

  if (metricsRows.length === 0) return 0;
  await sbPost("organic_post_metrics", metricsRows);
  return metricsRows.length;
}

async function openLog(accountId: string): Promise<string> {
  const row = await sbPost(
    "organic_fetch_log?select=id",
    { account_id: accountId, platform: "instagram", status: "running" },
    "return=representation",
  );
  return Array.isArray(row) ? row[0].id : row.id;
}

async function closeLog(
  logId: string,
  fields: Partial<{
    posts_fetched: number;
    posts_new: number;
    cost_estimate: number;
    status: string;
    error_message: string | null;
  }>,
): Promise<void> {
  await sbPatch(`organic_fetch_log?id=eq.${logId}`, {
    ...fields,
    finished_at: new Date().toISOString(),
  });
}

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
  const budgetUsd = Number(body.budget_usd) || DEFAULT_BUDGET_USD;

  let logId: string | null = null;

  try {
    const account = await resolveAccount({
      account_id: body.account_id,
      handle: body.handle,
      platform_account_id: body.platform_account_id,
    });
    if (!account) {
      return jsonResponse({ error: "account not found (instagram)" }, 404);
    }
    if (!account.is_active && mode !== "test") {
      return jsonResponse({ error: "account is inactive", account_id: account.id }, 400);
    }

    const projectedCost = estimateCost(limit);
    const monthSoFar = await monthlyInstagramSpend();
    const projectedTotal = monthSoFar + projectedCost;

    if (projectedTotal > budgetUsd) {
      return jsonResponse({
        error: "monthly budget exceeded",
        budget_usd: budgetUsd,
        month_spend_usd: Math.round(monthSoFar * 10000) / 10000,
        projected_run_usd: projectedCost,
        projected_total_usd: Math.round(projectedTotal * 10000) / 10000,
      }, 429);
    }
    const warned = projectedTotal >= budgetUsd * BUDGET_WARN_PCT;
    if (warned) {
      console.warn(`[fetch-instagram-posts] budget warning: projected $${projectedTotal.toFixed(2)} >= ${BUDGET_WARN_PCT * 100}% of $${budgetUsd}`);
    }

    if (mode !== "test") {
      logId = await openLog(account.id);
    }

    const apifyPosts = await callApify(account.handle, limit);

    if (mode === "test") {
      return jsonResponse({
        success: true,
        mode: "test",
        account: { id: account.id, handle: account.handle, brand_name: account.brand_name },
        posts_fetched: apifyPosts.length,
        projected_cost_usd: projectedCost,
        month_spend_usd: Math.round(monthSoFar * 10000) / 10000,
        budget_warned: warned,
        sample: apifyPosts.slice(0, 2).map(p => ({
          id: p.id, type: p.type, productType: p.productType,
          url: p.url, timestamp: p.timestamp, caption: (p.caption || "").slice(0, 80),
          likes: p.likesCount, comments: p.commentsCount, views: p.videoPlayCount ?? p.videoViewCount,
        })),
      });
    }

    const postRows = apifyPosts
      .map(p => mapPost(p, account.id))
      .filter((r): r is Record<string, unknown> => r !== null);

    const { upserted, newCount } = await upsertPosts(postRows);
    const metricsInserted = await appendMetrics(upserted, apifyPosts);

    const costEstimate = estimateCost(apifyPosts.length);
    await sbPatch(
      `followed_organic_accounts?id=eq.${account.id}`,
      { last_fetched_at: new Date().toISOString() },
    );

    if (logId) {
      await closeLog(logId, {
        posts_fetched: apifyPosts.length,
        posts_new: newCount,
        cost_estimate: costEstimate,
        status: "success",
      });
    }

    return jsonResponse({
      success: true,
      mode: "fetch",
      account: { id: account.id, handle: account.handle, brand_name: account.brand_name },
      posts_fetched: apifyPosts.length,
      posts_upserted: postRows.length,
      posts_new: newCount,
      metrics_rows_inserted: metricsInserted,
      cost_estimate_usd: costEstimate,
      month_spend_usd: Math.round((monthSoFar + costEstimate) * 10000) / 10000,
      budget_usd: budgetUsd,
      budget_warned: warned,
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
