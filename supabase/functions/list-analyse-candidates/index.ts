// POST /functions/v1/list-analyse-candidates
// Returns a ranked list of posts / ads that could be analysed.
// Marks each with `already_analysed` so the client can skip them during bulk runs.
//
// Input: {
//   source: "organic_post" | "competitor_ad",
//   filter: {
//     // organic:
//     account_id?: uuid, platform?: "instagram"|"youtube", post_type?: "reel"|"short"|"video",
//     // ads:
//     page_id?: string, brand_id?: string, active_only?: bool, display_format?: "VIDEO",
//     // both:
//     since_days?: number (default 90, max 365),
//     min_duration?: number, max_duration?: number,
//   },
//   rank_by?: "views"|"engagement_rate"|"likes"|"comments"|"shares"|"days_active"|"is_active_days"|"posted_at"|"start_date",
//   top_pct?: number (1-50),
//   top_n?: number (default 50, max 500),
//   exclude_already_analysed?: boolean (default true),
// }
//
// Response: {
//   success: true,
//   source,
//   universe_count: number,  // total matching rows before rank/slice
//   candidates: [{ source_id, already_analysed, metric_value, video_url, thumbnail_url, label, posted_at }, ...],
//   candidates_count: number,
//   to_analyse_count: number,  // candidates excluding already_analysed
// }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FUNCTION_VERSION = "list-analyse-candidates@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Function-Version": FUNCTION_VERSION },
  });
}

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

type Filter = {
  account_id?: string;
  platform?: "instagram" | "youtube";
  post_type?: string;
  page_id?: string;
  brand_id?: string;
  active_only?: boolean;
  display_format?: string;
  since_days?: number;
  min_duration?: number;
  max_duration?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const source = payload.source as "organic_post" | "competitor_ad";
    if (source !== "organic_post" && source !== "competitor_ad") {
      return json({ error: "source must be 'organic_post' or 'competitor_ad'" }, 400);
    }
    const filter = (payload.filter || {}) as Filter;
    const rankBy = (payload.rank_by || (source === "organic_post" ? "views" : "days_active")) as string;
    const topPct = typeof payload.top_pct === "number" ? Math.max(1, Math.min(payload.top_pct, 50)) : null;
    const topN = Math.max(1, Math.min(Number(payload.top_n) || 50, 500));
    const excludeAnalysed = payload.exclude_already_analysed !== false;

    const sinceDays = Math.max(1, Math.min(Number(filter.since_days) || 90, 365));
    const cutoffIso = new Date(Date.now() - sinceDays * 86400000).toISOString();

    // ---------- ORGANIC ----------
    if (source === "organic_post") {
      const params = new URLSearchParams();
      params.set("select", "id,account_id,platform,post_url,post_type,video_url,thumbnail_url,caption,posted_at,duration_seconds");
      params.append("posted_at", `gte.${cutoffIso}`);
      // must have video_url for analysis
      params.append("video_url", "not.is.null");
      if (filter.account_id) params.append("account_id", `eq.${filter.account_id}`);
      if (filter.platform) params.append("platform", `eq.${filter.platform}`);
      if (filter.post_type) params.append("post_type", `eq.${filter.post_type}`);
      if (filter.min_duration) params.append("duration_seconds", `gte.${Number(filter.min_duration)}`);
      if (filter.max_duration) params.append("duration_seconds", `lte.${Number(filter.max_duration)}`);
      params.set("order", "posted_at.desc");
      params.set("limit", "2000");

      const postsRes = await fetch(`${SUPABASE_URL}/rest/v1/organic_posts?${params.toString()}`, { headers: sbHeaders() });
      if (!postsRes.ok) return json({ error: `organic_posts query failed: ${postsRes.status}` }, 500);
      const posts = (await postsRes.json()) as Array<Record<string, unknown>>;
      const universeCount = posts.length;
      if (universeCount === 0) {
        return json({ success: true, source, universe_count: 0, candidates: [], candidates_count: 0, to_analyse_count: 0 });
      }

      // Fetch latest metrics per post
      const pids = posts.map((p) => String(p.id));
      const inList = pids.map((id) => `"${id}"`).join(",");
      const metricsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/organic_post_metrics?post_id=in.(${inList})&select=post_id,captured_at,views,likes,comments,shares,engagement_rate&order=captured_at.desc&limit=5000`,
        { headers: sbHeaders() }
      );
      const metricByPid = new Map<string, Record<string, unknown>>();
      if (metricsRes.ok) {
        const rows = (await metricsRes.json()) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const pid = String(r.post_id);
          if (!metricByPid.has(pid)) metricByPid.set(pid, r);
        }
      }

      // Fetch already-analysed set
      const analysedRes = await fetch(
        `${SUPABASE_URL}/rest/v1/video_analyses?source=eq.organic_post&source_id=in.(${inList})&select=source_id,status`,
        { headers: sbHeaders() }
      );
      const analysedSet = new Set<string>();
      if (analysedRes.ok) {
        const rows = (await analysedRes.json()) as Array<Record<string, unknown>>;
        for (const r of rows) {
          if (r.status !== "error") analysedSet.add(String(r.source_id));
        }
      }

      // Fetch account metadata for labels
      const accountIds = [...new Set(posts.map((p) => String(p.account_id)).filter(Boolean))];
      const accountById = new Map<string, Record<string, unknown>>();
      if (accountIds.length > 0) {
        const aList = accountIds.map((id) => `"${id}"`).join(",");
        const accRes = await fetch(
          `${SUPABASE_URL}/rest/v1/followed_organic_accounts?id=in.(${aList})&select=id,handle,brand_name,platform`,
          { headers: sbHeaders() }
        );
        if (accRes.ok) {
          const rows = (await accRes.json()) as Array<Record<string, unknown>>;
          for (const r of rows) accountById.set(String(r.id), r);
        }
      }

      // Rank
      const withMetric = posts.map((p) => {
        const pid = String(p.id);
        const m = metricByPid.get(pid);
        let metricVal: number | null = null;
        if (rankBy === "posted_at") {
          metricVal = new Date(String(p.posted_at || 0)).getTime();
        } else if (m) {
          const raw = m[rankBy];
          const n = typeof raw === "number" ? raw : Number(raw);
          metricVal = Number.isFinite(n) ? n : null;
        }
        const acc = accountById.get(String(p.account_id));
        const handle = acc?.handle ? `@${acc.handle}` : "";
        return {
          source_id: pid,
          already_analysed: analysedSet.has(pid),
          metric_value: metricVal,
          video_url: p.video_url,
          thumbnail_url: p.thumbnail_url,
          label: handle || (typeof p.caption === "string" ? String(p.caption).slice(0, 60) : pid.slice(0, 8)),
          posted_at: p.posted_at,
          post_type: p.post_type,
          platform: p.platform,
          duration_seconds: p.duration_seconds,
          handle: acc?.handle,
          brand_name: acc?.brand_name,
        };
      });
      withMetric.sort((a, b) => {
        const av = typeof a.metric_value === "number" ? a.metric_value : -Infinity;
        const bv = typeof b.metric_value === "number" ? b.metric_value : -Infinity;
        return bv - av;
      });

      const sliceSize = topPct ? Math.max(1, Math.ceil((topPct / 100) * universeCount)) : topN;
      let candidates = withMetric.slice(0, Math.max(1, sliceSize));
      if (excludeAnalysed) candidates = candidates.filter((c) => !c.already_analysed);

      const toAnalyseCount = candidates.filter((c) => !c.already_analysed).length;
      return json({
        success: true,
        source,
        universe_count: universeCount,
        rank_by: rankBy,
        top_pct: topPct,
        top_n: topN,
        slice_size: sliceSize,
        candidates_count: candidates.length,
        to_analyse_count: toAnalyseCount,
        candidates,
      });
    }

    // ---------- COMPETITOR ADS ----------
    const params = new URLSearchParams();
    params.set(
      "select",
      "id,page_id,page_name,video_url,thumbnail_url,start_date,end_date,days_active,is_active,display_format,creative_title,creative_body"
    );
    // video-only
    params.append("video_url", "not.is.null");
    if (filter.page_id) params.append("page_id", `eq.${filter.page_id}`);
    if (filter.brand_id) params.append("brand_id", `eq.${filter.brand_id}`);
    if (filter.active_only) params.append("is_active", "eq.true");
    params.append("start_date", `gte.${cutoffIso}`);
    params.set("order", "days_active.desc");
    params.set("limit", "2000");

    const adsRes = await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads?${params.toString()}`, { headers: sbHeaders() });
    if (!adsRes.ok) return json({ error: `competitor_ads query failed: ${adsRes.status}` }, 500);
    const ads = (await adsRes.json()) as Array<Record<string, unknown>>;
    const universeCount = ads.length;
    if (universeCount === 0) {
      return json({ success: true, source, universe_count: 0, candidates: [], candidates_count: 0, to_analyse_count: 0 });
    }

    // Already-analysed set
    const adIds = ads.map((a) => String(a.id));
    const adInList = adIds.map((id) => `"${id}"`).join(",");
    const analysedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?source=eq.competitor_ad&source_id=in.(${adInList})&select=source_id,status`,
      { headers: sbHeaders() }
    );
    const analysedSet = new Set<string>();
    if (analysedRes.ok) {
      const rows = (await analysedRes.json()) as Array<Record<string, unknown>>;
      for (const r of rows) {
        if (r.status !== "error") analysedSet.add(String(r.source_id));
      }
    }

    const withMetric = ads.map((a) => {
      const days = typeof a.days_active === "number" ? a.days_active : Number(a.days_active);
      let metricVal: number | null = Number.isFinite(days) ? days : null;
      if (rankBy === "is_active_days" && metricVal !== null) {
        metricVal = metricVal * (a.is_active ? 1 : 0.5);
      } else if (rankBy === "start_date") {
        metricVal = new Date(String(a.start_date || 0)).getTime();
      }
      return {
        source_id: String(a.id),
        already_analysed: analysedSet.has(String(a.id)),
        metric_value: metricVal,
        video_url: a.video_url,
        thumbnail_url: a.thumbnail_url,
        label: (a.page_name as string) || (a.creative_title as string) || String(a.id).slice(0, 8),
        posted_at: a.start_date,
        post_type: "ad",
        platform: "facebook",
        days_active: a.days_active,
        is_active: a.is_active,
        page_name: a.page_name,
      };
    });
    withMetric.sort((a, b) => {
      const av = typeof a.metric_value === "number" ? a.metric_value : -Infinity;
      const bv = typeof b.metric_value === "number" ? b.metric_value : -Infinity;
      return bv - av;
    });

    const sliceSize = topPct ? Math.max(1, Math.ceil((topPct / 100) * universeCount)) : topN;
    let candidates = withMetric.slice(0, Math.max(1, sliceSize));
    if (excludeAnalysed) candidates = candidates.filter((c) => !c.already_analysed);

    const toAnalyseCount = candidates.filter((c) => !c.already_analysed).length;
    return json({
      success: true,
      source,
      universe_count: universeCount,
      rank_by: rankBy,
      top_pct: topPct,
      top_n: topN,
      slice_size: sliceSize,
      candidates_count: candidates.length,
      to_analyse_count: toAnalyseCount,
      candidates,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
