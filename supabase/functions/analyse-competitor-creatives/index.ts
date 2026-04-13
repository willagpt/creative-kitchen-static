import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MODEL = "claude-opus-4-20250514";
const CONSOLIDATION_MODEL = "claude-sonnet-4-20250514";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sbHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

interface AdInput {
  imageUrl: string;
  title: string;
  body: string;
  daysActive: number;
  displayFormat: string;
  pageName: string;
  isVideo: boolean;
}

interface CheflyBrand {
  name: string;
  guidelines_text: string;
  sleeve_notes: string;
  sleeve_notes_alt: string;
  active_sleeve: string;
  colour_palette: Array<{ hex: string; name: string }>;
  typography: Record<string, string>;
  tone_of_voice: string;
  packaging_specs: Record<string, string>;
}

async function fetchCheflyBrand(): Promise<CheflyBrand | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brands?name=eq.chefly&select=name,guidelines_text,sleeve_notes,sleeve_notes_alt,active_sleeve,colour_palette,typography,tone_of_voice,packaging_specs&limit=1`,
      { headers: sbHeaders }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length > 0 ? rows[0] as CheflyBrand : null;
  } catch { return null; }
}

async function saveAnalysis(data: {
  brands: string[]; pageIds: string[]; percentile: number; typeFilter: string;
  adsSent: number; step1Model: string; step2Model: string;
  analysis: unknown; prompts: unknown; status: string;
}): Promise<string | null> {
  try {
    const fa = data.analysis as Record<string, unknown> || {};
    const res = await fetch(`${SUPABASE_URL}/rest/v1/competitive_analyses`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        brands_analysed: data.brands, page_ids: data.pageIds,
        percentile: data.percentile, type_filter: data.typeFilter,
        ads_sent: data.adsSent, model_used: `${data.step1Model} + ${data.step2Model}`,
        themes: fa.themes || null, personas: fa.personas || null,
        creative_pillars: fa.creativePillars || null, ad_analyses: fa.adAnalyses || null,
        creative_formats: fa.creativeFormats || null,
        chefly_prompts: data.prompts || null,
        raw_response: { step1: fa, step2_prompts: data.prompts },
        status: data.status,
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.id || null;
  } catch { return null; }
}

async function callClaude(apiKey: string, model: string, system: string, userContent: unknown[], maxTokens = 8000): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: userContent }] }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText}`);
  }
  const result = await response.json();
  return result.content?.[0]?.text || "";
}

function parseJSON(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { rawResponse: text, parseError: "Could not parse JSON" };
  }
}

// v23: STATIC AD FORMAT TAXONOMY
const STATIC_FORMAT_TAXONOMY = [
  "Product Hero — single product, clean/minimal background, product is the star",
  "Lifestyle In-Context — product shown in a real-life setting (kitchen, table, hands holding)",
  "Before/After Split — two panels showing a transformation or comparison",
  "Side-by-Side Comparison — brand vs competitor or two options compared with text/bullets",
  "Testimonial/Quote Card — customer quote or review as the main content, often with star rating",
  "Stat/Claim Card — bold statistic or claim as hero text (e.g. '98% loved it', 'From £5.98')",
  "Ingredient Spotlight — ingredients or nutritional info as the visual focus",
  "Multi-Product Grid — multiple products/meals shown in a grid or collage",
  "Meme/Trend-Jack — leverages a meme format, pop culture reference, or social trend",
  "Text-Heavy Offer/Promo — discount, code, or promotional offer dominates the frame",
  "Editorial/Magazine — styled like editorial photography, minimal text, aspirational",
  "Infographic/Explainer — step-by-step, numbered process, or visual explanation",
  "Screenshot/Social Proof — screenshot of a review, comment, tweet, or social post",
  "UGC-Style Static — looks like a user photo, casual/authentic feel, not polished",
  "Founder/Team Story — features a person (founder, chef, team member) with personal message",
  "Carousel Card — single frame designed as part of a swipeable carousel series",
];

// === STEP 1: Vision analysis (unchanged from v22) ===
async function step1VisionAnalysis(apiKey: string, ads: AdInput[]): Promise<unknown> {
  const imageAds = ads.filter(a => !a.isVideo && a.imageUrl && !a.imageUrl.endsWith(".mp4") && !a.imageUrl.endsWith(".mov"));
  if (imageAds.length === 0) throw new Error("No static image ads to analyse");
  const batch = imageAds.slice(0, 15);
  const blocks: Array<{ type: string; source?: unknown; text?: string }> = [];
  for (let i = 0; i < batch.length; i++) {
    const ad = batch[i];
    blocks.push({ type: "text", text: `--- IMAGE ${i + 1} ---\nBrand: ${ad.pageName}\nHeadline: ${ad.title}\nDays running: ${ad.daysActive}\nFormat: ${ad.displayFormat}\nBody: ${(ad.body || '').slice(0, 200)}` });
    blocks.push({ type: "image", source: { type: "url", url: ad.imageUrl } });
  }

  const system = `You are an expert paid social creative strategist performing PRODUCTION-LEVEL VISUAL FORENSIC analysis of competitor ad images for DTC food/meal delivery brands. Your job is to extract every detail a creative director would need to understand and recreate each ad's visual approach for a different brand.

You analyse like a cinematographer reverse-engineering a shot: exact colours with hex estimates, font identification, camera angles in degrees, lighting direction and quality, spatial composition, material textures. Not marketing observations. Visual forensics.

For EACH image, provide deeply nested analysis across layout, typography, colour, photography, product, and offer treatment. Classify each ad's CREATIVE FORMAT from the taxonomy provided. Then CLUSTER all images by distinct visual approach and identify overarching themes, personas, creative pillars, AND a summary of creative formats with performance signals.

STATIC AD CREATIVE FORMAT TAXONOMY (assign ONE primary format per ad):
${STATIC_FORMAT_TAXONOMY.map((f, i) => `${i + 1}. ${f}`).join("\n")}

If an ad doesn't fit any category, use "Other — [brief description]".

Return VALID JSON only. No markdown, no code fences.`;

  const user = `Analyse these ${batch.length} images from top-performing competitor ads for DTC food/meal delivery brands.

For EACH image, perform a full visual forensic analysis using the nested schema below. Do NOT compress detail into single-line summaries. Each nested field must contain specific, concrete production detail.

Then:
1. CLUSTER into distinct visual approaches (group ads that use the same FORMAT, not the same brand)
2. Identify overarching themes, target personas, and creative pillars
3. Summarise CREATIVE FORMATS: which formats appear, how many ads use each, and note the days_active for each ad using that format

Return JSON:
{
  "adAnalyses": [
    {
      "adIndex": 1,
      "brand": "",
      "headline": "",
      "daysRunning": 0,
      "format": "",
      "creativeFormat": "one of the taxonomy formats above — use the short name before the em dash",

      "layout": {
        "grid": "describe the layout grid",
        "aspectRatio": "estimated aspect ratio",
        "visualHierarchy": "what the eye hits first, second, third, and why",
        "whitespace": "where negative space is used, approximate % of frame, and its purpose",
        "composition": "150+ words describing exact spatial arrangement"
      },

      "typography": {
        "headlineFont": "estimated font family, weight, size, case, colour with hex",
        "subheadFont": "same detail or 'none'",
        "bodyFont": "same detail or 'none'",
        "textPlacement": "where text sits in the frame",
        "textEffects": "shadows, outlines, backgrounds, opacity, knockout"
      },

      "colour": {
        "palette": ["#hex1 - name/role"],
        "dominantColour": "which colour occupies most area, estimated %",
        "accentColour": "which colour draws attention, where, estimated %",
        "colourTemperature": "warm/cool/neutral with estimated Kelvin range",
        "contrast": "light/dark relationships and hierarchy"
      },

      "photography": {
        "subjectMatter": "exactly what is photographed in physical detail",
        "cameraAngle": "overhead/eye-level/three-quarter/low with estimated degrees",
        "focalLength": "estimated equivalent focal length",
        "depthOfField": "what is sharp, where bokeh begins",
        "lighting": "direction, quality, colour temperature, shadow character",
        "postProcessing": "saturation, contrast, filters, colour grading, grain"
      },

      "product": {
        "visibility": "hero, supporting, or absent",
        "packagingDetails": "exact description of packaging",
        "foodStyling": "specific ingredients, garnish, arrangement, freshness cues",
        "proportion": "% of frame the product occupies"
      },

      "offer": {
        "structure": "how the offer is presented visually",
        "urgency": "scarcity or time pressure elements",
        "pricePresentation": "how price/discount is displayed",
        "cta": "call to action text and visual treatment"
      },

      "emotionalHook": "psychological trigger and how visual execution delivers it",
      "strengthScore": "1-10",
      "whyItWorks": "200+ words on visual effectiveness",
      "howToAdapt": "150+ words on adapting this FORMAT for another brand",
      "visualCluster": "short name for this visual approach category"
    }
  ],

  "visualClusters": [
    {
      "name": "short cluster name",
      "description": "200+ words in production terms",
      "adIndices": [],
      "count": 0,
      "whyBrandsUseThis": "150+ words on paid social performance"
    }
  ],

  "themes": [
    { "name": "", "description": "100+ words", "adIndices": [], "frequency": "" }
  ],

  "personas": [
    { "name": "", "description": "100+ words with demographics and psychographics", "painPoints": [], "adIndices": [] }
  ],

  "creativePillars": [
    { "name": "", "description": "100+ words", "whyItWorks": "100+ words", "exampleAdIndices": [] }
  ],

  "creativeFormats": [
    {
      "name": "format name from taxonomy",
      "description": "how this format is executed across the ads analysed — 80+ words",
      "adIndices": [],
      "count": 0,
      "avgDaysActive": 0,
      "maxDaysActive": 0,
      "brands": ["which brands use this format"]
    }
  ]
}`;

  const text = await callClaude(apiKey, MODEL, system, [...blocks, { type: "text", text: user }], 16000);
  return parseJSON(text);
}

// === STEP 1.5: Consolidate — v23: uses Sonnet for speed, hard caps, aggressive dedup instructions ===
async function step1_5Consolidate(
  apiKey: string,
  themes: unknown[],
  personas: unknown[],
  pillars: unknown[],
  clusters: unknown[],
  formats: unknown[],
  totalAds: number,
  imageMetadata: unknown[]
): Promise<Record<string, unknown>> {
  console.log(`[v23] Consolidation input: ${themes.length} themes, ${personas.length} personas, ${pillars.length} pillars, ${clusters.length} clusters, ${formats.length} formats`);

  const system = `You are a senior creative strategist consolidating competitive intelligence. Multiple batches of competitor ads have been analysed independently, producing overlapping themes, personas, creative pillars, and creative formats. Your job is to AGGRESSIVELY merge duplicates and near-duplicates, producing a clean, non-overlapping, WEIGHTED set.

CRITICAL HARD CAPS — YOU MUST OBEY THESE:
- You MUST return EXACTLY 4 to 6 themes. No more than 6. No fewer than 4.
- You MUST return EXACTLY 2 to 3 personas. No more than 3. No fewer than 2.
- You MUST return EXACTLY 5 to 8 creative pillars. No more than 8. No fewer than 5.
- You MUST return EXACTLY 3 to 5 visual clusters. No more than 5. No fewer than 3.
- If the input has more items than the cap, you MUST merge the most similar ones until you hit the cap.
- If you are unsure whether two items are the same, MERGE THEM. Err on the side of fewer, richer items.

SEMANTIC DEDUPLICATION RULES:
- Two items describing the same underlying concept MUST be merged even if they have different names.
- Examples of duplicates that MUST be merged: "Overwhelmed Achiever" + "The Overwhelmed Professional", "Value for Money" + "Price-Conscious Messaging", "Clean Eating" + "Health & Wellness Focus", "Convenience-First" + "Time-Saving Convenience".
- When merging: keep the catchiest/most descriptive name, combine all descriptions into the richest version, union all adIndices, combine all pain points.
- After merging, review your output and ask: "Could any two of these remaining items reasonably be combined?" If yes, merge them.

WEIGHTING RULES:
1. For each consolidated item, assess which ads exhibit it.
2. Weight by PERFORMANCE not volume: an item backed by 2 ads running 90+ days each is stronger than one backed by 10 ads running 3 days each.
3. Weight by BRAND DIVERSITY: an item exhibited by 3+ brands is a stronger market signal than one from a single brand.
4. Weight formula: find unique brand+cluster combos, take max days_active per combo, sum = raw_score. Normalize to 0-100.
5. Assign momentum: "dominant" (>70), "strong" (40-70), "emerging" (15-40), "niche" (<15).

Return VALID JSON only. No markdown, no code fences.`;

  // Trim metadata to reduce token count — only send what's needed for weighting
  const trimmedMetadata = (imageMetadata as Array<Record<string, unknown>>).map(img => ({
    i: img.ad_index,
    b: img.page_name || 'Unknown',
    c: img.visual_cluster || 'Unclustered',
    f: img.creative_format || 'Unknown',
    d: img.days_active || 0,
  }));

  const user = `Consolidate the following competitive intelligence from ${totalAds} competitor ads. Remember: OBEY THE HARD CAPS.

IMAGE METADATA (i=index, b=brand, c=cluster, f=format, d=days_active):
${JSON.stringify(trimmedMetadata)}

THEMES (${themes.length} — must reduce to 4-6):
${JSON.stringify(themes, null, 1)}

PERSONAS (${personas.length} — must reduce to 2-3):
${JSON.stringify(personas, null, 1)}

CREATIVE PILLARS (${pillars.length} — must reduce to 5-8):
${JSON.stringify(pillars, null, 1)}

VISUAL CLUSTERS (${clusters.length} — must reduce to 3-5):
${JSON.stringify(clusters, null, 1)}

CREATIVE FORMATS (${formats.length}):
${JSON.stringify(formats, null, 1)}

Return this JSON (sorted by weight descending within each category):
{
  "themes": [
    {
      "name": "concise, distinct theme name",
      "description": "100+ words",
      "adIndices": [],
      "frequency": "how common",
      "mergedFrom": ["original name 1", "original name 2"],
      "weight": 0,
      "momentum": "dominant|strong|emerging|niche",
      "brandCount": 0,
      "totalDaysActive": 0,
      "topAds": ["brief description of strongest ads"]
    }
  ],
  "personas": [
    {
      "name": "concise persona name",
      "description": "100+ words",
      "painPoints": [],
      "adIndices": [],
      "mergedFrom": ["original name 1"],
      "weight": 0,
      "momentum": "dominant|strong|emerging|niche",
      "brandCount": 0,
      "totalDaysActive": 0
    }
  ],
  "creativePillars": [
    {
      "name": "concise pillar name",
      "description": "100+ words",
      "whyItWorks": "100+ words",
      "exampleAdIndices": [],
      "mergedFrom": ["original name 1"],
      "weight": 0,
      "momentum": "dominant|strong|emerging|niche",
      "brandCount": 0,
      "totalDaysActive": 0
    }
  ],
  "visualClusters": [
    {
      "name": "concise cluster name",
      "description": "200+ words",
      "adIndices": [],
      "count": 0,
      "whyBrandsUseThis": "150+ words",
      "mergedFrom": ["original name 1"],
      "weight": 0,
      "momentum": "dominant|strong|emerging|niche",
      "brandCount": 0,
      "totalDaysActive": 0
    }
  ],
  "creativeFormats": [
    {
      "name": "format name from taxonomy",
      "description": "100+ words",
      "adIndices": [],
      "count": 0,
      "mergedFrom": ["original name 1"],
      "weight": 0,
      "momentum": "dominant|strong|emerging|niche",
      "brandCount": 0,
      "brands": ["brand names"],
      "avgDaysActive": 0,
      "maxDaysActive": 0,
      "longevityRank": 0,
      "totalDaysActive": 0,
      "topAds": ["brief description of longest-running ads"]
    }
  ],
  "consolidationSummary": {
    "themesReduced": "X to Y",
    "personasReduced": "X to Y",
    "pillarsReduced": "X to Y",
    "clustersReduced": "X to Y",
    "formatsReduced": "X to Y",
    "keyMerges": ["brief description of each significant merge"],
    "dominantSignals": ["3-5 strongest signals by weight"],
    "emergingSignals": ["emerging patterns worth watching"],
    "formatInsights": ["key takeaways about format longevity"]
  }
}`;

  const text = await callClaude(apiKey, CONSOLIDATION_MODEL, system, [{ type: "text", text: user }], 8000);
  const result = parseJSON(text) as Record<string, unknown>;

  // v23: Validate caps and log
  const rThemes = (result.themes as unknown[] || []).length;
  const rPersonas = (result.personas as unknown[] || []).length;
  const rPillars = (result.creativePillars as unknown[] || []).length;
  const rClusters = (result.visualClusters as unknown[] || []).length;
  console.log(`[v23] Consolidation output: ${rThemes} themes, ${rPersonas} personas, ${rPillars} pillars, ${rClusters} clusters`);

  return result;
}

// Build brand context
function buildBrandContext(brand: CheflyBrand): string {
  const colours = brand.colour_palette.map(c => `${c.name}: ${c.hex}`).join(", ");
  const sleeve = brand.active_sleeve === "alt" && brand.sleeve_notes_alt ? brand.sleeve_notes_alt : brand.sleeve_notes;
  const typo = Object.entries(brand.typography || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${brand.guidelines_text}\n\nNAMED HEX CODES (use these exact values):\n${colours}\n\nTYPOGRAPHY SYSTEM:\n${typo}\n\nTONE OF VOICE:\n${brand.tone_of_voice}\n\nCURRENT PACKAGING (describe this EXACTLY in every prompt where packaging appears):\n${sleeve}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { ads, brands_analysed, page_ids, percentile, type_filter, step, step1_result, themes, personas, pillars, clusters, formats, total_ads, image_metadata } = body as {
      ads?: AdInput[]; brands_analysed?: string[]; page_ids?: string[];
      percentile?: number; type_filter?: string; step?: number;
      step1_result?: Record<string, unknown>;
      themes?: unknown[]; personas?: unknown[]; pillars?: unknown[]; clusters?: unknown[]; formats?: unknown[]; total_ads?: number;
      image_metadata?: unknown[];
    };

    const apiKey = Deno.env.get("CLAUDE_API_KEY") || "";
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const brand = await fetchCheflyBrand();
    if (!brand) {
      return new Response(JSON.stringify({ error: "Could not load Chefly brand" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === STEP 1: Vision analysis ===
    if (step === 1) {
      if (!ads || ads.length === 0) {
        return new Response(JSON.stringify({ error: "No ads provided for step 1" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const s1 = await step1VisionAnalysis(apiKey, ads);
      return new Response(JSON.stringify({ success: true, step: 1, analysis: s1, brand: brand.name, model: MODEL }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === STEP 1.5: Consolidate — v23: Sonnet + hard caps ===
    if (step === 1.5) {
      if (!themes && !personas && !pillars) {
        return new Response(JSON.stringify({ error: "themes, personas, and pillars required for step 1.5" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const consolidated = await step1_5Consolidate(
        apiKey,
        themes || [],
        personas || [],
        pillars || [],
        clusters || [],
        formats || [],
        total_ads || 0,
        image_metadata || []
      );
      return new Response(JSON.stringify({ success: true, step: 1.5, consolidated, model: CONSOLIDATION_MODEL }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === STEP 3: Save ===
    if (step === 3) {
      if (!step1_result) {
        return new Response(JSON.stringify({ error: "step1_result required for step 3" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const chefly_prompts = body.chefly_prompts || [];
      const analysis = { ...step1_result, chefly_prompts };
      const analysisId = await saveAnalysis({
        brands: brands_analysed || [], pageIds: page_ids || [],
        percentile: percentile || 10, typeFilter: type_filter || "all",
        adsSent: ads?.length || 0, step1Model: MODEL, step2Model: MODEL,
        analysis, prompts: chefly_prompts, status: "completed",
      });
      return new Response(JSON.stringify({
        success: true, step: 3, analysis_id: analysisId, analysis, brand: brand.name, model: MODEL,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Please specify step=1, step=1.5, or step=3" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error(`[analyse-competitor-creatives v23] Error: ${String(err)}`);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});