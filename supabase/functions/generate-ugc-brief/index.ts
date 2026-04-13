// POST /functions/v1/generate-ugc-brief
// Generate a structured UGC creator brief from video analysis insights using Claude AI

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

async function callClaudeWithRetry(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxRetries = 2
): Promise<string> {
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (response.status === 429 || response.status === 529) {
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1500;
          console.log(`Claude API ${response.status}, retrying in ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`Claude API rate limited after ${maxRetries} retries`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const textContent = data.content?.[0];
      if (!textContent || textContent.type !== "text") {
        throw new Error("Invalid Claude response format");
      }
      return textContent.text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxRetries) throw lastError;
    }
  }
  throw lastError;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { analysis_id, shot_count = 5, brand_name } = body;

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

    // Extract AI analysis with correct nested structure
    const ai = analysis.ai_analysis || {};
    const hook = ai.hook || {};
    const narrativeArc = ai.narrative_arc || {};
    const sellingPoints = ai.selling_points || [];
    const emotionalDrivers = ai.emotional_drivers || [];
    const targetAudience = ai.target_audience || {};
    const competitorInsights = ai.competitor_insights || {};
    const productionStyle = ai.production_style || {};
    const whatToSteal = Array.isArray(competitorInsights.what_to_steal)
      ? competitorInsights.what_to_steal.join("\n- ")
      : competitorInsights.what_to_steal || "";
    const whatWorks = Array.isArray(competitorInsights.what_works)
      ? competitorInsights.what_works.join("\n- ")
      : competitorInsights.what_works || "";

    const resolvedBrand = brand_name || adContext.page_name || "the brand";

    const systemPrompt = `You are an expert UGC (User Generated Content) brief writer for DTC food and meal delivery brands. You translate competitor video ad analysis into actionable, shootable briefs that real creators can execute.

Key principles:
- Be SPECIFIC and ACTIONABLE — creators need exact shot directions, not vague concepts
- Include precise timings and realistic framing language (handheld, close-up, POV, etc.)
- Script lines must sound authentic and conversational — never corporate or salesy
- Production tips must be practical and achievable with a phone camera and natural light
- Capture the FEELING and STRUCTURE of what works, don't copy the content
- For food brands: emphasise product beauty shots, unboxing moments, and real eating reactions

Always output valid JSON with no markdown formatting or code blocks.`;

    const userPrompt = `Generate a ${shot_count}-shot UGC creator brief based on this competitor video analysis.

**Original Video Stats:**
- Duration: ${analysis.duration_seconds}s | Shots: ${analysis.total_shots} | Pacing: ${analysis.pacing_profile}
- Brand: ${resolvedBrand}
- Creative title: "${adContext.creative_title || "N/A"}"
- Body copy: "${adContext.creative_body || "N/A"}"

**What Made the Original Work:**
- Hook type: ${hook.type || "unknown"} — "${hook.text || ""}"
- Hook effectiveness: ${hook.effectiveness || "unknown"}
- Narrative structure: ${narrativeArc.structure || "unknown"}
- Story beats: ${(narrativeArc.beats || []).join(" → ")}
- Selling points: ${sellingPoints.join(", ")}
- Emotional drivers: ${emotionalDrivers.join(", ")}
- Target audience: ${targetAudience.primary || "unknown"}
- Audience signals: ${(targetAudience.signals || []).join("; ")}
- Production style: ${productionStyle.format || "mixed"}, ${productionStyle.quality || "mid"} quality, ${productionStyle.music_pacing || "upbeat"} music
- One-line summary: ${ai.one_line_summary || "N/A"}

**What to steal from this ad:**
- ${whatToSteal || "N/A"}

**What works in the original:**
- ${whatWorks || "N/A"}

**Full Combined Script (voiceover + visuals):**
${analysis.combined_script || "(No script available)"}

---

Generate a JSON object with this EXACT structure:
{
  "concept": "One-line creative angle for this brief",
  "inspired_by": "What from the original ad inspired this brief",
  "target_duration": "e.g. 15-20 seconds",
  "tone": "e.g. casual, energetic, authentic",
  "music_direction": "e.g. upbeat trending audio, lo-fi chill",
  "pacing_notes": "How the edit should flow",
  "production_tips": ["tip1", "tip2", "tip3"],
  "shots": [
    {
      "shot_number": 1,
      "duration_estimate": "2-3 seconds",
      "framing": "Close-up, handheld, eye-level",
      "action": "Specific physical action the creator does",
      "script_line": "Exact words the creator says",
      "text_overlay": "On-screen text/emoji or null",
      "notes": "Camera movement, lighting, energy level"
    }
  ]
}

The brief must have exactly ${shot_count} shots. Make every shot specific enough that a creator could film it from this description alone.`;

    console.log(`Generating ${shot_count}-shot UGC brief for analysis ${analysis_id}...`);
    const claudeResponse = await callClaudeWithRetry(claudeApiKey, systemPrompt, userPrompt);

    // Parse JSON response
    let brief;
    try {
      let jsonStr = claudeResponse.trim();
      if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
      else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      brief = JSON.parse(jsonStr);

      if (!brief.shots || !Array.isArray(brief.shots) || brief.shots.length === 0) {
        throw new Error("Missing or empty shots array");
      }
    } catch (parseError) {
      console.error("Failed to parse Claude response:", parseError);
      console.error("Raw response:", claudeResponse.substring(0, 500));
      return new Response(
        JSON.stringify({ error: "Failed to parse generated brief", raw: claudeResponse.substring(0, 1000) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ brief, analysis_id, shot_count }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
