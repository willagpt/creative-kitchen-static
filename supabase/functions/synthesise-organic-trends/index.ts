// POST /functions/v1/synthesise-organic-trends
// Pulls N video_analyses rows (transcripts, OCR, shots, layout) and asks Claude
// to synthesise recurring patterns into a trend_reports row.
// v1.1.0 (17 Apr 2026): top-performers mode + actionable_ideas output.
// v1.2.0 (17 Apr 2026): top_pct (percentile 1-50), competitor-ad ranking via days_active.
// Filter adds: top_performers (bool), rank_by ("views"|"engagement_rate"|"likes"|"comments"|"shares"|"days_active"|"is_active_days"), top_n (int), top_pct (1-50), active_only (bool, ads only).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-5";

const FUNCTION_VERSION = "synthesise-organic-trends@1.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Function-Version": FUNCTION_VERSION },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

type Filter = {
  source?: "competitor_ad" | "organic_post";
  platform?: "instagram" | "youtube";
  since_days?: number;
  since_date?: string;
  min_duration?: number;
  max_duration?: number;
  pacing_profile?: "fast" | "medium" | "slow" | "static";
  brand_name?: string;
  limit?: number;
  // Top-performers mode: after enriching sources, attach latest metric
  // (organic posts only) and keep the top-N performers.
  top_performers?: boolean;
  rank_by?: "views" | "engagement_rate" | "likes" | "comments" | "shares" | "days_active" | "is_active_days";
  top_n?: number;
  top_pct?: number; // 1-50, takes priority over top_n if set
  active_only?: boolean; // competitor_ad: only include ads still running
};

async function createReport(title: string, filter: Filter, status = "pending") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trend_reports`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ title, filter, status }),
  });
  if (!res.ok) throw new Error(`Failed to create trend_reports row: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

async function updateReport(id: string, data: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trend_reports?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update trend_reports row: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

async function fetchAnalysesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const inList = ids.map((id) => `"${id}"`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_analyses?id=in.(${inList})&status=eq.complete&select=id,source,source_id,duration_seconds,total_shots,total_cuts,avg_shot_duration,cuts_per_second,pacing_profile,transcript_text,ocr_text,combined_script,ai_analysis,layout_summary,contact_sheet_url,competitor_ad_id,created_at`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch analyses by ids: ${res.status}`);
  return await res.json();
}

async function fetchAnalysesByFilter(filter: Filter) {
  const params = new URLSearchParams();
  params.append(
    "select",
    "id,source,source_id,duration_seconds,total_shots,total_cuts,avg_shot_duration,cuts_per_second,pacing_profile,transcript_text,ocr_text,combined_script,ai_analysis,layout_summary,contact_sheet_url,competitor_ad_id,created_at"
  );
  params.append("status", "eq.complete");
  if (filter.source) params.append("source", `eq.${filter.source}`);
  if (filter.pacing_profile) params.append("pacing_profile", `eq.${filter.pacing_profile}`);
  if (filter.min_duration !== undefined) params.append("duration_seconds", `gte.${filter.min_duration}`);
  if (filter.max_duration !== undefined) params.append("duration_seconds", `lte.${filter.max_duration}`);
  if (filter.since_date) {
    params.append("created_at", `gte.${filter.since_date}`);
  } else if (filter.since_days !== undefined) {
    const d = new Date();
    d.setDate(d.getDate() - filter.since_days);
    params.append("created_at", `gte.${d.toISOString()}`);
  }
  params.append("order", "created_at.desc");
  const limit = Math.min(filter.limit || 40, 80);
  params.append("limit", String(limit));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/video_analyses?${params}`, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Failed to query analyses: ${res.status}`);
  return await res.json();
}

async function enrichWithSources(analyses: Array<Record<string, unknown>>, filter: Filter) {
  // Organic: pull organic_posts + accounts
  const orgIds = analyses.filter((a) => a.source === "organic_post" && a.source_id).map((a) => String(a.source_id));
  if (orgIds.length > 0) {
    const inList = [...new Set(orgIds)].map((id) => `"${id}"`).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/organic_posts?id=in.(${inList})&select=id,platform,post_url,title,caption,hashtags,post_type,duration_seconds,posted_at,audio_title,account_id`,
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      const posts = await res.json() as Array<Record<string, unknown>>;
      const byId = new Map(posts.map((p) => [String(p.id), p]));

      const accIds = [...new Set(posts.map((p) => String(p.account_id)).filter(Boolean))];
      let accById = new Map<string, Record<string, unknown>>();
      if (accIds.length > 0) {
        const aInList = accIds.map((id) => `"${id}"`).join(",");
        const accRes = await fetch(
          `${SUPABASE_URL}/rest/v1/followed_organic_accounts?id=in.(${aInList})&select=id,brand_name,handle,platform`,
          { headers: supabaseHeaders() }
        );
        if (accRes.ok) {
          const accs = await accRes.json() as Array<Record<string, unknown>>;
          accById = new Map(accs.map((a) => [String(a.id), a]));
        }
      }
      for (const a of analyses) {
        if (a.source === "organic_post" && a.source_id) {
          const p = byId.get(String(a.source_id));
          if (p) {
            const acc = accById.get(String(p.account_id)) || null;
            (a as Record<string, unknown>).organic_post = { ...p, account: acc };
          }
        }
      }
    }
  }

  // Competitor ads
  const adIds = analyses.filter((a) => a.source === "competitor_ad" && a.source_id).map((a) => String(a.source_id));
  if (adIds.length > 0) {
    const inList = [...new Set(adIds)].map((id) => `"${id}"`).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/competitor_ads?id=in.(${inList})&select=id,page_name,creative_title,creative_body,display_format,days_active,impressions_lower,impressions_upper,start_date`,
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      const ads = await res.json() as Array<Record<string, unknown>>;
      const byId = new Map(ads.map((a) => [String(a.id), a]));
      for (const a of analyses) {
        if (a.source === "competitor_ad" && a.source_id) {
          const ad = byId.get(String(a.source_id));
          if (ad) (a as Record<string, unknown>).competitor_ad = ad;
        }
      }
    }
  }

  // Apply platform / brand_name / min duration filters post-enrichment
  let filtered = analyses;
  if (filter.platform) {
    filtered = filtered.filter((a) => {
      const post = a.organic_post as Record<string, unknown> | undefined;
      return post && post.platform === filter.platform;
    });
  }
  if (filter.brand_name) {
    const needle = filter.brand_name.toLowerCase();
    filtered = filtered.filter((a) => {
      const post = a.organic_post as Record<string, unknown> | undefined;
      const ad = a.competitor_ad as Record<string, unknown> | undefined;
      const accName = post ? String((post.account as Record<string, unknown> | null)?.brand_name || "").toLowerCase() : "";
      const pageName = ad ? String(ad.page_name || "").toLowerCase() : "";
      return accName.includes(needle) || pageName.includes(needle);
    });
  }
  return filtered;
}

async function rankByPerformance(
  analyses: Array<Record<string, unknown>>,
  rankBy: "views" | "engagement_rate" | "likes" | "comments" | "shares" | "days_active" | "is_active_days",
  topN: number,
  activeOnly = false
): Promise<Array<Record<string, unknown>>> {
  // Organic posts: metric from latest organic_post_metrics snapshot
  // Competitor ads: metric from competitor_ads.days_active (or is_active_days = days_active * (is_active?1:0.5))
  const isOrganicMetric = ["views", "engagement_rate", "likes", "comments", "shares"].includes(rankBy);
  const isAdMetric = ["days_active", "is_active_days"].includes(rankBy);

  // Competitor-ad ranking path
  if (isAdMetric) {
    const adIds: string[] = [];
    const adIdByAid = new Map<string, string>();
    for (const a of analyses) {
      if (a.source === "competitor_ad") {
        const adId = String(a.source_id || (a.competitor_ad_id as string) || "");
        if (adId) {
          adIds.push(adId);
          adIdByAid.set(String(a.id), adId);
        }
      }
    }
    const daysByAdId = new Map<string, number>();
    const activeByAdId = new Map<string, boolean>();
    if (adIds.length > 0) {
      const inList = [...new Set(adIds)].map((id) => `"${id}"`).join(",");
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/competitor_ads?id=in.(${inList})&select=id,days_active,is_active`,
        { headers: supabaseHeaders() }
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const adId = String(r.id);
          const da = typeof r.days_active === "number" ? r.days_active : Number(r.days_active);
          if (!Number.isNaN(da) && Number.isFinite(da)) daysByAdId.set(adId, da);
          activeByAdId.set(adId, !!r.is_active);
        }
      }
    }
    let filtered = analyses;
    if (activeOnly) {
      filtered = analyses.filter((a) => {
        const adId = adIdByAid.get(String(a.id));
        return adId ? activeByAdId.get(adId) === true : false;
      });
    }
    for (const a of filtered) {
      const adId = adIdByAid.get(String(a.id));
      const days = adId ? daysByAdId.get(adId) : undefined;
      const active = adId ? activeByAdId.get(adId) : undefined;
      let val: number | null = null;
      if (typeof days === "number") {
        val = rankBy === "is_active_days" ? days * (active ? 1 : 0.5) : days;
      }
      (a as Record<string, unknown>).performance_metric_rank_by = rankBy;
      (a as Record<string, unknown>).performance_metric_value = val;
    }
    const sorted = [...filtered].sort((a, b) => {
      const av = (a as Record<string, unknown>).performance_metric_value;
      const bv = (b as Record<string, unknown>).performance_metric_value;
      const aNum = typeof av === "number" ? av : -Infinity;
      const bNum = typeof bv === "number" ? bv : -Infinity;
      return bNum - aNum;
    });
    return sorted.slice(0, Math.max(1, topN));
  }

  // Organic ranking path (unchanged logic)
  const postIds: string[] = [];
  const postIdByAid = new Map<string, string>();
  for (const a of analyses) {
    if (a.source === "organic_post") {
      const post = a.organic_post as Record<string, unknown> | undefined;
      const pid = post ? String(post.id) : null;
      if (pid) {
        postIds.push(pid);
        postIdByAid.set(String(a.id), pid);
      }
    }
  }
  const metricByPid = new Map<string, number>();
  if (postIds.length > 0) {
    const inList = [...new Set(postIds)].map((id) => `"${id}"`).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/organic_post_metrics?post_id=in.(${inList})&select=post_id,captured_at,views,likes,comments,shares,engagement_rate&order=captured_at.desc&limit=2000`,
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      // Keep LATEST snapshot per post_id (rows already desc by captured_at)
      const seen = new Set<string>();
      for (const r of rows) {
        const pid = String(r.post_id);
        if (seen.has(pid)) continue;
        seen.add(pid);
        const raw = r[rankBy];
        const val = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isNaN(val) && Number.isFinite(val)) {
          metricByPid.set(pid, val);
        }
      }
    }
  }
  // Attach metric value to each analysis for corpus + detail response
  for (const a of analyses) {
    const pid = postIdByAid.get(String(a.id));
    const val = pid ? metricByPid.get(pid) : undefined;
    (a as Record<string, unknown>).performance_metric_rank_by = rankBy;
    (a as Record<string, unknown>).performance_metric_value = typeof val === "number" ? val : null;
  }
  // Sort DESC by metric, nulls last
  const sorted = [...analyses].sort((a, b) => {
    const av = (a as Record<string, unknown>).performance_metric_value;
    const bv = (b as Record<string, unknown>).performance_metric_value;
    const aNum = typeof av === "number" ? av : -Infinity;
    const bNum = typeof bv === "number" ? bv : -Infinity;
    return bNum - aNum;
  });
  return sorted.slice(0, Math.max(1, topN));
}

async function fetchShotsFor(analysisIds: string[]) {
  if (analysisIds.length === 0) return new Map<string, Array<Record<string, unknown>>>();
  const inList = analysisIds.map((id) => `"${id}"`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_shots?video_analysis_id=in.(${inList})&order=video_analysis_id.asc,shot_number.asc&select=video_analysis_id,shot_number,start_time,end_time,duration,ocr_text,screen_layout`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) return new Map();
  const shots = await res.json() as Array<Record<string, unknown>>;
  const byAid = new Map<string, Array<Record<string, unknown>>>();
  for (const s of shots) {
    const aid = String(s.video_analysis_id);
    if (!byAid.has(aid)) byAid.set(aid, []);
    byAid.get(aid)!.push(s);
  }
  return byAid;
}

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const str = String(s);
  return str.length <= n ? str : str.slice(0, n) + "…";
}

function buildCorpus(analyses: Array<Record<string, unknown>>, shotsByAid: Map<string, Array<Record<string, unknown>>>): string {
  const blocks: string[] = [];
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    const post = a.organic_post as Record<string, unknown> | undefined;
    const ad = a.competitor_ad as Record<string, unknown> | undefined;
    const src = a.source === "organic_post" ? "ORGANIC" : "AD";
    const who = post
      ? `${post.platform} @${((post.account as Record<string, unknown>)?.handle) || "?"} (${((post.account as Record<string, unknown>)?.brand_name) || "?"})`
      : ad
      ? `${ad.page_name || "?"}${ad.display_format ? ` [${ad.display_format}]` : ""}`
      : "unknown";
    const title = post ? trunc(String(post.title || ""), 120) : ad ? trunc(String(ad.creative_title || ""), 120) : "";
    const caption = post
      ? trunc(String(post.caption || ""), 280)
      : ad
      ? trunc(String(ad.creative_body || ""), 280)
      : "";
    const hashtags = post && Array.isArray(post.hashtags) ? (post.hashtags as string[]).slice(0, 10).join(" ") : "";
    const audio = post ? trunc(String(post.audio_title || ""), 80) : "";
    const layout = a.layout_summary ? JSON.stringify(a.layout_summary) : "";
    const shots = shotsByAid.get(String(a.id)) || [];
    const shotLine = shots
      .slice(0, 10)
      .map((s) => {
        const dur = typeof s.duration === "number" ? (s.duration as number).toFixed(1) : s.duration;
        const ocr = s.ocr_text ? ` "${trunc(String(s.ocr_text), 40)}"` : "";
        const lay = s.screen_layout ? ` [${s.screen_layout}]` : "";
        return `#${s.shot_number}:${dur}s${lay}${ocr}`;
      })
      .join(" | ");

    const transcript = trunc(String(a.transcript_text || ""), 600);
    const ocrAll = trunc(String(a.ocr_text || ""), 300);

    const metricVal = (a as Record<string, unknown>).performance_metric_value;
    const metricKey = (a as Record<string, unknown>).performance_metric_rank_by;
    const metricLine = typeof metricVal === "number"
      ? `    metric(${metricKey}): ${metricVal.toLocaleString()}`
      : "";

    blocks.push(
      [
        `--- [${i + 1}] ${src} ${who}`,
        metricLine,
        `    duration=${a.duration_seconds}s shots=${a.total_shots} cuts/s=${a.cuts_per_second} pacing=${a.pacing_profile}`,
        title ? `    title: ${title}` : "",
        caption ? `    caption: ${caption}` : "",
        hashtags ? `    tags: ${hashtags}` : "",
        audio ? `    audio: ${audio}` : "",
        layout ? `    layout: ${layout}` : "",
        transcript ? `    transcript: ${transcript}` : "",
        ocrAll ? `    on-screen: ${ocrAll}` : "",
        shotLine ? `    shots: ${shotLine}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return blocks.join("\n\n");
}

function buildPrompt(corpus: string, n: number, filter: Filter): string {
  const topMode = !!filter.top_performers;
  const rankBy = filter.rank_by || "views";
  const header = topMode
    ? `You are a creative strategist analysing ${n} short-form videos that are the TOP PERFORMERS (ranked by ${rankBy}) in this corpus. Your job is to work out WHY these specific videos outperformed, then turn those signals into concrete creative ideas a production team can shoot next week.`
    : `You are a creative strategist analysing ${n} short-form video ads + organic posts to find trends a production team can turn into new creative.`;

  const ideasGuidance = topMode
    ? `
Actionable ideas: produce 6 to 10 concrete creative ideas we could make ourselves, each tied back to one or more winning videos via the [index] references. Each idea must explain WHY it would likely work based on the winner signals (not generic advice). Prefer specificity: real hook copy, real shot structure, real CTA phrasing. Rank by estimated priority (1 = highest).`
    : `
Actionable ideas: produce 3 to 5 creative ideas inspired by the recurring patterns, each tied back to [index] references. Specificity over cleverness.`;

  return `${header}

Scope of corpus: ${JSON.stringify(filter)}

Below are ${n} videos, each with transcript, on-screen text, shot list (with durations + layout), and platform context.${topMode ? " Each block also includes a metric(...) line with the raw performance value. The top of the corpus is the highest performer." : ""} Find the patterns that actually repeat. Be specific. No filler.
${ideasGuidance}

CORPUS:
${corpus}

Return STRICT JSON matching this schema. No markdown, no commentary, no prose outside JSON:

{
  "overview": "2 to 3 sentence plain-English summary of what this corpus is doing overall",
  ${topMode ? '"why_these_won": ["3 to 6 bullets explaining the specific signals that separate top performers from average (e.g. \'hook is a face-to-camera stop-scroll within 0.8s\')"],' : ""}
  "recurring_hooks": [
    { "pattern": "short name", "description": "what the hook does", "frequency_pct": 30, "examples": ["index numbers e.g. [1]", "[3]"] }
  ],
  "shot_length_stats": {
    "median_seconds": 0,
    "p25_seconds": 0,
    "p75_seconds": 0,
    "dominant_pacing": "fast|medium|slow",
    "notes": "one line"
  },
  "layout_mix": {
    "full_pct": 0,
    "split_2_pct": 0,
    "split_3_pct": 0,
    "other_pct": 0,
    "notes": "how layout is being used"
  },
  "recurring_phrases": [
    { "phrase": "exact or near-exact", "count": 0, "contexts": ["hook|mid|cta"] }
  ],
  "audio_reuse": [
    { "audio_or_vibe": "name / description", "frequency_pct": 0, "notes": "one line" }
  ],
  "ctas": [
    { "cta": "short phrase", "frequency_pct": 0, "placement": "on_screen|spoken|caption" }
  ],
  "themes": [
    { "theme": "short name", "description": "one sentence", "examples": ["[2]"] }
  ],
  "production_notes": [
    "actionable note 1",
    "actionable note 2",
    "..."
  ],
  "copy_ideas": [
    { "hook": "first 1 to 3 seconds of speech or on-screen text", "beat": "what happens next", "cta": "closing" }
  ],
  "actionable_ideas": [
    {
      "title": "punchy working title under 60 chars",
      "priority": 1,
      "rationale": "why this would likely work, citing specific [index] winners and the signal they share",
      "format": "talking_head|voiceover_broll|tutorial|transformation|taste_test|ugc_skit|comparison|listicle|other",
      "target_duration_seconds": 15,
      "suggested_pacing": "fast|medium|slow",
      "suggested_layout": "full|split-2|split-3|mixed",
      "hook": "exact hook copy for the first 1 to 3 seconds",
      "beats": ["shot 1 description", "shot 2 description", "shot 3 description"],
      "cta": "closing line",
      "references": ["[1]", "[4]"]
    }
  ]
}

Rules:
- Only include categories you have real evidence for. Empty arrays are fine.
- frequency_pct is an integer 0 to 100.
- examples and references should reference the [index] numbers from the corpus.
- No em dashes or en dashes anywhere. Use commas or colons.
- Keep each string under 200 chars (except arrays of beats, which can be up to 6 items).
- actionable_ideas priority is integer 1 (highest) to 3.`;
}

async function callClaude(prompt: string): Promise<{ text: string; model: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.content || []).map((b: Record<string, unknown>) => b.text || "").join("");
  return { text, model: json.model || CLAUDE_MODEL };
}

function extractJson(text: string): Record<string, unknown> | null {
  // Strip code fences if present
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  // Find first { and matching last }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  if (!SUPABASE_SERVICE_KEY || !CLAUDE_API_KEY) {
    return jsonResponse({ error: "Server not configured (missing service key or Claude key)" }, 500);
  }

  let reportId: string | null = null;
  try {
    const body = await req.json();
    const filter: Filter = body.filter || {};
    const explicitIds: string[] = Array.isArray(body.analysis_ids) ? body.analysis_ids : [];
    const title: string =
      body.title || `Trend report · ${new Date().toISOString().slice(0, 10)} · ${filter.source || "all"}`;
    const dryRun: boolean = !!body.dry_run;

    // 1. Create pending report up front
    const report = await createReport(title, filter, "running");
    reportId = report.id as string;

    // 2. Gather analyses
    let analyses: Array<Record<string, unknown>> = [];
    if (explicitIds.length > 0) {
      analyses = await fetchAnalysesByIds(explicitIds);
    } else {
      analyses = await fetchAnalysesByFilter(filter);
    }

    analyses = await enrichWithSources(analyses, filter);

    // Top performers mode: rank by latest metric + take top N or top %
    if (filter.top_performers) {
      // Default rank_by depends on what's in the matched set
      const hasAds = analyses.some((a) => a.source === "competitor_ad");
      const hasOrganic = analyses.some((a) => a.source === "organic_post");
      const defaultRank = hasAds && !hasOrganic ? "days_active" : "views";
      const rankBy = (filter.rank_by || defaultRank) as
        | "views" | "engagement_rate" | "likes" | "comments" | "shares" | "days_active" | "is_active_days";
      let topN: number;
      if (typeof filter.top_pct === "number" && filter.top_pct > 0) {
        const pct = Math.max(1, Math.min(filter.top_pct, 50));
        topN = Math.max(3, Math.ceil((pct / 100) * analyses.length));
      } else {
        topN = Math.max(3, Math.min(Number(filter.top_n) || 10, 200));
      }
      analyses = await rankByPerformance(analyses, rankBy, topN, !!filter.active_only);
    }

    if (analyses.length < 3) {
      await updateReport(reportId, {
        status: "error",
        error_message: `Not enough analyses matched filter (found ${analyses.length}, need >= 3)`,
        completed_at: new Date().toISOString(),
        source_count: analyses.length,
        source_analysis_ids: analyses.map((a) => String(a.id)),
      });
      return jsonResponse(
        { error: "Not enough analyses matched filter", found: analyses.length, needed: 3, report_id: reportId },
        400
      );
    }

    const ids = analyses.map((a) => String(a.id));
    const shotsByAid = await fetchShotsFor(ids);

    // 3. Build corpus
    const corpus = buildCorpus(analyses, shotsByAid);
    const prompt = buildPrompt(corpus, analyses.length, filter);

    if (dryRun) {
      await updateReport(reportId, {
        status: "pending",
        source_count: analyses.length,
        source_analysis_ids: ids,
      });
      return jsonResponse({
        success: true,
        dry_run: true,
        report_id: reportId,
        source_count: analyses.length,
        prompt_preview: prompt.slice(0, 1500),
        corpus_size_chars: corpus.length,
      });
    }

    // 4. Call Claude
    const { text, model } = await callClaude(prompt);
    const parsed = extractJson(text);
    if (!parsed) {
      await updateReport(reportId, {
        status: "error",
        error_message: "Failed to parse Claude JSON response",
        model,
        completed_at: new Date().toISOString(),
        source_count: analyses.length,
        source_analysis_ids: ids,
      });
      return jsonResponse(
        {
          error: "Failed to parse model response as JSON",
          report_id: reportId,
          raw_preview: text.slice(0, 800),
        },
        502
      );
    }

    // 5. Persist
    const updated = await updateReport(reportId, {
      status: "complete",
      summary: parsed,
      model,
      completed_at: new Date().toISOString(),
      source_count: analyses.length,
      source_analysis_ids: ids,
    });

    return jsonResponse({
      success: true,
      report_id: reportId,
      source_count: analyses.length,
      title: updated.title,
      summary: parsed,
    });
  } catch (err) {
    console.error("synthesise-organic-trends error:", err);
    if (reportId) {
      try {
        await updateReport(reportId, {
          status: "error",
          error_message: String(err).slice(0, 1000),
          completed_at: new Date().toISOString(),
        });
      } catch (_) {
        // ignore
      }
    }
    return jsonResponse({ error: String(err), report_id: reportId }, 500);
  }
});
