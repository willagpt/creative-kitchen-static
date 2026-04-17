// POST /functions/v1/synthesise-organic-trends
// Pulls N video_analyses rows (transcripts, OCR, shots, layout) and asks Claude
// to synthesise recurring patterns into a trend_reports row.
// v1.0.0

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-5";

const FUNCTION_VERSION = "synthesise-organic-trends@1.0.0";

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

    blocks.push(
      [
        `--- [${i + 1}] ${src} ${who}`,
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
  return `You are a creative strategist analysing ${n} short-form video ads + organic posts to find trends a production team can turn into new creative.

Scope of corpus: ${JSON.stringify(filter)}

Below are ${n} videos, each with transcript, on-screen text, shot list (with durations + layout), and platform context. Find the patterns that actually repeat. Be specific. No filler.

CORPUS:
${corpus}

Return STRICT JSON matching this schema. No markdown, no commentary, no prose outside JSON:

{
  "overview": "2 to 3 sentence plain-English summary of what this corpus is doing overall",
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
  ]
}

Rules:
- Only include categories you have real evidence for. Empty arrays are fine.
- frequency_pct is an integer 0 to 100.
- examples should reference the [index] numbers from the corpus.
- No em dashes or en dashes anywhere. Use commas or colons.
- Keep each string under 200 chars.`;
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
