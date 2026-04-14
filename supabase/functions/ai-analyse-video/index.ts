import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * ai-analyse-video — Phase 3: Creative Strategy Analysis
 * v2: Added shot_layouts classification for split-screen detection
 * 
 * Takes a completed video analysis (with combined_script + contact_sheet)
 * and sends to Claude for structured creative strategy breakdown.
 * Writes results to video_analyses.ai_analysis (JSONB).
 * Also classifies screen layouts per shot and computes layout_summary.
 */

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status === 529) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000;
        console.log(`API returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
    return res;
  }
  throw new Error("Max retries exceeded");
}

const ANALYSIS_PROMPT = `You are an expert DTC (direct-to-consumer) paid social creative strategist analysing a competitor video advertisement.

You will be given:
1. A combined script showing the voiceover, on-screen text, and visual descriptions at each timestamp
2. A contact sheet image showing key frames from the video
3. Metadata about the ad (brand, duration, pacing, shot count)

Analyse this ad and return a JSON object with the following structure:

{
  "hook": {
    "type": "string \u2014 one of: question, bold-claim, problem-agitate, social-proof, curiosity-gap, product-reveal, ugc-testimonial, before-after, shock-value, direct-address",
    "text": "the exact hook text/voiceover from the first 3 seconds",
    "effectiveness": "1-10 score with brief reasoning"
  },
  "narrative_arc": {
    "structure": "string \u2014 one of: problem-solution, testimonial, listicle, day-in-life, unboxing, transformation, comparison, educational, emotional-story, offer-led",
    "beats": ["array of 3-6 narrative beats describing the story progression"]
  },
  "cta": {
    "type": "string \u2014 one of: visit-site, shop-now, learn-more, sign-up, get-offer, try-free, limited-time, social-proof-cta, none",
    "text": "exact CTA text shown/spoken",
    "placement": "string \u2014 where in the video: end-card, mid-roll, throughout, overlay"
  },
  "selling_points": ["array of key product/brand claims made in the ad"],
  "emotional_drivers": ["array \u2014 e.g. convenience, aspiration, fomo, trust, health, value, community, identity"],
  "target_audience": {
    "primary": "brief description of who this ad targets",
    "signals": ["array of audience signals from visuals/copy \u2014 e.g. gym setting, meal-prep language, price-conscious messaging"]
  },
  "production_style": {
    "format": "string \u2014 one of: ugc, studio, lifestyle, animation, mixed, talking-head, b-roll-heavy",
    "quality": "string \u2014 one of: lo-fi, mid, polished, premium",
    "text_overlays": "string \u2014 one of: heavy, moderate, minimal, none",
    "music_pacing": "string \u2014 one of: upbeat, chill, dramatic, none-detected"
  },
  "pacing_analysis": {
    "overall": "string \u2014 one of: fast, medium, slow",
    "first_3s": "description of what happens in the critical first 3 seconds",
    "rhythm": "brief description of how the pacing changes through the ad"
  },
  "competitor_insights": {
    "what_works": ["2-4 things this ad does well"],
    "what_to_steal": ["2-3 specific techniques we could adapt for our own ads"],
    "weaknesses": ["1-3 things this ad could do better"]
  },
  "one_line_summary": "A single sentence summarising what this ad is and why it works (or doesn't)",
  "shot_layouts": ["array of screen layout classifications for each shot in order (length must match total shots). Each value is one of: full (single full-frame composition), split-2 (screen divided into two panels \u2014 top/bottom or left/right), split-3 (screen divided into three panels/grid), other (unusual or unclear layout). Look at each frame in the contact sheet and classify its composition."]
}

Return ONLY the JSON object, no other text. Be specific and reference actual content from the script \u2014 don't give generic analysis.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  try {
    const body = await req.json();
    const analysisId: string = body.analysis_id;
    const model: string = body.model || DEFAULT_MODEL;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "CLAUDE_API_KEY / ANTHROPIC_API_KEY not configured" }, 500);
    }

    // 1. Fetch analysis with competitor ad context
    console.log(`Fetching analysis: ${analysisId}`);
    const analysisRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}&select=*`,
      { headers: supabaseHeaders() }
    );
    if (!analysisRes.ok) throw new Error(`Failed to fetch analysis: ${analysisRes.status}`);
    const analyses = await analysisRes.json();
    if (!analyses || analyses.length === 0) {
      return jsonResponse({ error: "Analysis not found" }, 404);
    }
    const analysis = analyses[0];

    if (!analysis.combined_script && !analysis.transcript_text && !analysis.ocr_text) {
      return jsonResponse({ error: "No script data available. Run extract-video-script first." }, 400);
    }

    // 2. Fetch competitor ad metadata
    let adMeta: Record<string, unknown> = {};
    if (analysis.competitor_ad_id) {
      const adRes = await fetch(
        `${SUPABASE_URL}/rest/v1/competitor_ads?id=eq.${analysis.competitor_ad_id}&select=page_name,creative_title,creative_body,display_format,platforms,cta_type,link_url,start_date,days_active,impressions_lower,impressions_upper`,
        { headers: supabaseHeaders() }
      );
      if (adRes.ok) {
        const ads = await adRes.json();
        if (ads && ads.length > 0) adMeta = ads[0];
      }
    }

    // 3. Build the content for Claude
    const content: Array<Record<string, unknown>> = [];

    const metadataBlock = [
      `Brand: ${adMeta.page_name || "Unknown"}`,
      `Duration: ${analysis.duration_seconds || 0}s`,
      `Total shots: ${analysis.total_shots || 0}`,
      `Pacing: ${analysis.pacing_profile || "unknown"} (avg shot: ${analysis.avg_shot_duration?.toFixed(1) || "?"}s, cuts/sec: ${analysis.cuts_per_second?.toFixed(2) || "?"})`,
      `Format: ${adMeta.display_format || "VIDEO"}`,
      `Platforms: ${adMeta.platforms || "unknown"}`,
      `Days active: ${adMeta.days_active || "unknown"}`,
      `Impressions: ${adMeta.impressions_lower || "?"} - ${adMeta.impressions_upper || "?"}`,
      adMeta.creative_title ? `Ad title: ${adMeta.creative_title}` : "",
      adMeta.creative_body ? `Ad body: ${String(adMeta.creative_body).slice(0, 300)}` : "",
      adMeta.cta_type ? `CTA button: ${adMeta.cta_type}` : "",
    ].filter(Boolean).join("\n");

    content.push({
      type: "text",
      text: `${ANALYSIS_PROMPT}\n\n--- AD METADATA ---\n${metadataBlock}`,
    });

    // Contact sheet image (if available)
    if (analysis.contact_sheet_url) {
      try {
        console.log(`Downloading contact sheet: ${analysis.contact_sheet_url}`);
        const imgRes = await fetch(analysis.contact_sheet_url);
        if (imgRes.ok) {
          const buffer = await imgRes.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          content.push({
            type: "text",
            text: "--- CONTACT SHEET (key frames from the video) ---",
          });
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: base64,
            },
          });
        }
      } catch (e) {
        console.error(`Failed to load contact sheet: ${e}`);
      }
    }

    // Combined script
    const scriptText = analysis.combined_script || analysis.transcript_text || analysis.ocr_text || "";
    content.push({
      type: "text",
      text: `--- COMBINED SCRIPT ---\n${scriptText}`,
    });

    // 4. Call Claude
    console.log(`Calling Claude (${model}) for creative analysis...`);
    const claudeRes = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeResult = await claudeRes.json();
    const responseText = claudeResult.content?.[0]?.text || "{}";

    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let aiAnalysis: Record<string, unknown>;
    try {
      aiAnalysis = JSON.parse(cleaned);
    } catch (e) {
      console.error(`Failed to parse AI analysis: ${e}`);
      console.error(`Raw: ${cleaned.slice(0, 500)}`);
      aiAnalysis = { raw_response: cleaned, parse_error: String(e) };
    }

    // 5. Save to database
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}`,
      {
        method: "PATCH",
        headers: { ...supabaseHeaders(), Prefer: "return=representation" },
        body: JSON.stringify({ ai_analysis: aiAnalysis }),
      }
    );
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Failed to save analysis: ${updateRes.status} ${errText}`);
    }

    console.log(`AI analysis saved for ${analysisId}`);

    // 6. Update shot screen_layout values from AI classification
    const shotLayouts: string[] = (aiAnalysis.shot_layouts as string[]) || [];
    const layoutSummary: Record<string, number> = { full: 0, "split-2": 0, "split-3": 0, other: 0 };

    if (shotLayouts.length > 0) {
      // Fetch existing shots for this analysis
      const shotsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/video_shots?video_analysis_id=eq.${analysisId}&order=shot_number.asc&select=id,shot_number`,
        { headers: supabaseHeaders() }
      );
      if (shotsRes.ok) {
        const shots = await shotsRes.json();
        for (let i = 0; i < shots.length; i++) {
          const layout = shotLayouts[i] || "full";
          const validLayout = ["full", "split-2", "split-3", "other"].includes(layout) ? layout : "full";
          layoutSummary[validLayout] = (layoutSummary[validLayout] || 0) + 1;

          // Update individual shot
          await fetch(
            `${SUPABASE_URL}/rest/v1/video_shots?id=eq.${shots[i].id}`,
            {
              method: "PATCH",
              headers: supabaseHeaders(),
              body: JSON.stringify({ screen_layout: validLayout }),
            }
          );
        }
      }

      // Update analysis with layout_summary
      await fetch(
        `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}`,
        {
          method: "PATCH",
          headers: supabaseHeaders(),
          body: JSON.stringify({ layout_summary: layoutSummary }),
        }
      );
      console.log(`Layout summary saved: ${JSON.stringify(layoutSummary)}`);
    }

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      model_used: model,
      ai_analysis: aiAnalysis,
      layout_summary: shotLayouts.length > 0 ? layoutSummary : null,
    });

  } catch (err) {
    console.error("ai-analyse-video error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
