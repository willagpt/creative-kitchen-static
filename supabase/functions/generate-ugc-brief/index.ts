// POST /functions/v1/generate-ugc-brief
// Generate a structured UGC creator brief from video analysis insights using Claude AI
// v7: Phase 2 — transcript + per-shot OCR context, verbatim hook quoting, graceful Phase 1 fallback
// v6: layout-aware prompts, split-screen framing support
// v5: 16384 max_tokens, truncation detection, Chefly-branded, shot variations

const FUNCTION_VERSION = "generate-ugc-brief@7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "x-function-version": FUNCTION_VERSION,
};

// Format seconds as M:SS for aligning transcript/OCR context
function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(Number(seconds))) return "?";
  const s = Math.max(0, Math.floor(Number(seconds)));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

// Truncate long text while keeping head+tail for context
function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const keep = Math.floor((maxLen - 20) / 2);
  return `${text.substring(0, keep)}... [truncated] ...${text.substring(text.length - keep)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { analysis_id, shot_count = 5, brand_name, variations_per_shot = 3 } = body;

    if (!analysis_id) {
      return new Response(JSON.stringify({ error: "analysis_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (![5, 10].includes(shot_count)) {
      return new Response(JSON.stringify({ error: "shot_count must be 5 or 10" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (![2, 3, 4].includes(variations_per_shot)) {
      return new Response(JSON.stringify({ error: "variations_per_shot must be 2, 3, or 4" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const claudeApiKey = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey || !claudeApiKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dbHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };

    // Fetch video analysis
    const analysisRes = await fetch(
      `${supabaseUrl}/rest/v1/video_analyses?id=eq.${analysis_id}&select=*`,
      { headers: dbHeaders }
    );
    const analyses = await analysisRes.json();
    if (!analyses?.length) {
      return new Response(JSON.stringify({ error: "Video analysis not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const analysis = analyses[0];

    // Fetch competitor ad for context
    let adContext = { page_name: "Unknown", creative_title: "", creative_body: "" };
    if (analysis.competitor_ad_id) {
      const adRes = await fetch(
        `${supabaseUrl}/rest/v1/competitor_ads?id=eq.${analysis.competitor_ad_id}&select=page_name,creative_title,creative_body`,
        { headers: dbHeaders }
      );
      const ads = await adRes.json();
      if (ads?.length) adContext = ads[0];
    }

    // Fetch per-shot OCR + timestamps (Phase 2 data, graceful fallback if empty)
    const shotsRes = await fetch(
      `${supabaseUrl}/rest/v1/video_shots?video_analysis_id=eq.${analysis_id}&select=shot_number,start_time,end_time,ocr_text,screen_layout&order=shot_number.asc`,
      { headers: dbHeaders }
    );
    const shots = (await shotsRes.json()) || [];

    // Extract AI analysis
    const ai = analysis.ai_analysis || {};
    const hook = ai.hook || {};
    const narrativeArc = ai.narrative_arc || {};
    const sellingPoints = ai.selling_points || [];
    const emotionalDrivers = ai.emotional_drivers || [];
    const targetAudience = ai.target_audience || {};
    const competitorInsights = ai.competitor_insights || {};
    const productionStyle = ai.production_style || {};

    const toList = (val: unknown): string => {
      if (Array.isArray(val)) return val.join(", ");
      if (typeof val === "string") return val;
      return "N/A";
    };

    const resolvedBrand = brand_name || adContext.page_name || "the brand";

    // ── Phase 2 context build ────────────────────────────────────────────────
    // Transcript: prefer verbatim transcript_text over combined_script (which may include OCR)
    const transcriptText = (analysis.transcript_text || "").trim();
    const transcriptStatus = analysis.transcript_status || "unknown";
    const transcriptAvailable = transcriptText.length > 0 &&
      (transcriptStatus === "success" || transcriptStatus === "partial" || transcriptStatus === "unknown");

    // Per-shot OCR table
    const shotsWithOcr = shots.filter((s: any) => (s.ocr_text || "").trim().length > 0);
    const ocrStatus = analysis.ocr_status || "unknown";
    const ocrAvailable = shotsWithOcr.length > 0;

    // Build a compact per-shot OCR listing, aligned to shot timestamps
    let ocrBlock = "";
    if (ocrAvailable) {
      const lines = shotsWithOcr.map((s: any) => {
        const range = `${fmtTime(s.start_time)}-${fmtTime(s.end_time)}`;
        const layout = s.screen_layout && s.screen_layout !== "full" ? ` [${s.screen_layout}]` : "";
        const ocr = truncate(String(s.ocr_text || "").replace(/\s+/g, " ").trim(), 180);
        return `  Shot ${s.shot_number} (${range})${layout}: ${ocr}`;
      });
      ocrBlock = lines.join("\n");
    }

    // Compose the reference-video context block
    const contextLines: string[] = [];
    if (transcriptAvailable) {
      contextLines.push("SPOKEN HOOK + DIALOGUE (verbatim transcript):");
      contextLines.push(truncate(transcriptText, 1400));
    }
    if (ocrAvailable) {
      if (contextLines.length > 0) contextLines.push("");
      contextLines.push("ON-SCREEN TEXT PER SHOT (OCR, aligned to timestamps):");
      contextLines.push(ocrBlock);
    }
    const referenceContextBlock = contextLines.length > 0
      ? contextLines.join("\n")
      : "(No verbatim transcript or per-shot OCR available — work from the analysis summary below.)";

    // Concise system prompt
    const systemPrompt = `You are an expert UGC brief writer for Chefly (premium DTC meal delivery). Analyse competitor ads and create actionable, shootable briefs for Chefly's creators. Each shot MUST have exactly ${variations_per_shot} variations (A, B, C etc) — different angles/framings for a creator shot library. For framing, consider split-screen (two panels showing before/after, comparison, or parallel action) and tri-screen layouts where the competitor used them effectively. When a verbatim transcript is provided, quote the opening spoken hook word-for-word in the brief's first shot script_line — never paraphrase. Use the per-shot OCR text to identify persistent branding, CTAs, or recurring on-screen beats across the reference video. Output ONLY valid JSON, no markdown.`;

    const userPrompt = `Create a ${shot_count}-shot Chefly UGC brief from this ${resolvedBrand} competitor analysis.

Video: ${analysis.duration_seconds}s, ${analysis.total_shots} shots, ${analysis.pacing_profile} pacing
Hook: ${hook.type || "?"} — "${hook.text || ""}"
Structure: ${narrativeArc.structure || "?"}, beats: ${toList(narrativeArc.beats)}
Selling points: ${toList(sellingPoints)}
Emotional drivers: ${toList(emotionalDrivers)}
Audience: ${targetAudience.primary || "?"}
Style: ${productionStyle.format || "?"}, ${productionStyle.quality || "?"}
Layout: ${analysis.layout_summary ? Object.entries(analysis.layout_summary).filter(([_,v]) => (v as number) > 0).map(([k,v]) => `${v} ${k}`).join(', ') : 'all full-screen'}
What to steal: ${toList(competitorInsights.what_to_steal)}

REFERENCE VIDEO CONTEXT:
${referenceContextBlock}

This brief is FOR CHEFLY, not ${resolvedBrand}. Adapt the winning formula.

${transcriptAvailable ? "IMPORTANT: The opening spoken hook above is the FIRST line the viewer hears. Quote it word-for-word in shot 1's script_line (adapted lightly for Chefly only if brand-specific words need swapping; otherwise verbatim)." : "No verbatim transcript available — write a hook script_line that mirrors the documented hook type and intent."}
${ocrAvailable ? "Use the OCR text to spot recurring branding, CTAs, or on-screen beats — mirror the strongest ones in Chefly's text_overlay fields where they fit." : ""}

Return this exact JSON structure:
{"concept":"one-line angle","inspired_by":"what inspired this","target_duration":"e.g. 15-20s","tone":"e.g. casual","music_direction":"e.g. upbeat","pacing_notes":"edit flow","production_tips":["tip1","tip2","tip3"],"shots":[{"shot_number":1,"duration_estimate":"2-3s","framing":"close-up handheld","action":"specific action","script_line":"exact words","text_overlay":"overlay or null","notes":"camera/lighting notes","variations":[{"label":"A","framing":"variation framing","action":"variation action","notes":"what differs"}]}]}

Exactly ${shot_count} shots, each with exactly ${variations_per_shot} variations. Be specific enough to film from.`;

    console.log(`[v7] Generating ${shot_count}-shot brief (${variations_per_shot} vars) for analysis ${analysis_id} — transcript=${transcriptAvailable ? `yes/${transcriptStatus}/${transcriptText.length}ch` : "no"}, ocr=${ocrAvailable ? `${shotsWithOcr.length}/${shots.length}/${ocrStatus}` : "no"}`);

    // Call Claude with generous token limit and retry
    let claudeData: any;
    let lastError = "Unknown error";
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 16384,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        });

        if (response.status === 429 || response.status === 529) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1500));
            continue;
          }
          throw new Error(`Rate limited after retries`);
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Claude ${response.status}: ${errText.substring(0, 200)}`);
        }

        claudeData = await response.json();
        break;
      } catch (error) {
        lastError = String(error);
        if (attempt === 2) {
          return new Response(
            JSON.stringify({ error: "Claude API failed", details: lastError }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Check for truncation
    if (claudeData.stop_reason === "max_tokens") {
      console.error(`[v7] TRUNCATED — stop_reason=max_tokens, usage: ${JSON.stringify(claudeData.usage)}`);
      return new Response(
        JSON.stringify({ error: "Brief generation was truncated (response too long). Try fewer shots or variations." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const textContent = claudeData.content?.[0];
    if (!textContent || textContent.type !== "text") {
      return new Response(
        JSON.stringify({ error: "Invalid Claude response format" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawText = textContent.text;
    console.log(`[v7] Got response: ${rawText.length} chars, stop_reason=${claudeData.stop_reason}, usage=${JSON.stringify(claudeData.usage)}`);

    // Parse JSON — strip markdown fences if present
    let brief;
    try {
      let jsonStr = rawText.trim();
      if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
      else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      brief = JSON.parse(jsonStr);

      if (!brief.shots || !Array.isArray(brief.shots) || brief.shots.length === 0) {
        throw new Error("Missing or empty shots array");
      }
    } catch (parseError) {
      console.error("Parse error:", parseError);
      console.error("Raw (first 500):", rawText.substring(0, 500));
      return new Response(
        JSON.stringify({
          error: "Failed to parse generated brief",
          details: String(parseError),
          raw_preview: rawText.substring(0, 300),
          raw_end: rawText.substring(Math.max(0, rawText.length - 200)),
          stop_reason: claudeData.stop_reason,
          usage: claudeData.usage
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        brief,
        analysis_id,
        shot_count,
        variations_per_shot,
        context: {
          transcript_available: transcriptAvailable,
          transcript_status: transcriptStatus,
          transcript_chars: transcriptText.length,
          ocr_available: ocrAvailable,
          ocr_status: ocrStatus,
          shots_with_ocr: shotsWithOcr.length,
          total_shots: shots.length,
        },
        function_version: FUNCTION_VERSION,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
