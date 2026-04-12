import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { model, image_url, headline, body_text, days_active, brand } = await req.json();
    const apiKey = Deno.env.get("CLAUDE_API_KEY") || "";
    if (!apiKey) return new Response(JSON.stringify({ error: "No API key" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const system = `You are an expert paid social creative strategist performing a detailed VISUAL FORENSIC analysis of a competitor ad image. Your job is to extract every production-level visual detail from the image so that a creative director could recreate its layout, composition, and visual approach for a different brand.

Return VALID JSON only. No markdown, no code fences.`;

    const userContent = [
      { type: "text", text: `--- AD ---\nBrand: ${brand || 'Unknown'}\nHeadline: ${headline || ''}\nDays running: ${days_active || 0}\nBody: ${(body_text || '').slice(0, 200)}` },
      { type: "image", source: { type: "url", url: image_url } },
      { type: "text", text: `Perform a detailed visual forensic analysis of this ad image. Extract PRODUCTION-LEVEL detail, not marketing observations.\n\nReturn JSON:\n{\n  "brand": "",\n  "headline": "",\n  "daysRunning": 0,\n\n  "layout": {\n    "grid": "describe the layout grid (e.g. 60/40 vertical split, rule of thirds, centred stack)",\n    "aspectRatio": "estimated aspect ratio of the image",\n    "visualHierarchy": "what the eye hits first, second, third",\n    "whitespace": "where negative space is used and why",\n    "composition": "200+ words describing exact spatial arrangement of every element"\n  },\n\n  "typography": {\n    "headlineFont": "estimated font family, weight, size relative to frame, case, colour with hex estimate",\n    "subheadFont": "same detail for any secondary text",\n    "bodyFont": "same detail for body/CTA text",\n    "textPlacement": "where text sits in the frame, alignment, margins",\n    "textEffects": "shadows, outlines, backgrounds behind text, opacity treatments"\n  },\n\n  "colour": {\n    "palette": ["#hex1 - name/role", "#hex2 - name/role"],\n    "dominantColour": "which colour occupies most area and estimated %",\n    "accentColour": "which colour draws attention and where",\n    "colourTemperature": "warm/cool/neutral with estimated Kelvin",\n    "contrast": "describe light/dark relationships"\n  },\n\n  "photography": {\n    "subjectMatter": "exactly what is photographed, in detail",\n    "cameraAngle": "overhead, eye-level, three-quarter, etc with estimated degrees",\n    "focalLength": "estimated equivalent focal length",\n    "depthOfField": "what is sharp, what is blurred",\n    "lighting": "direction, quality, colour temp, shadow character",\n    "postProcessing": "saturation level, contrast, any filters or grading"\n  },\n\n  "product": {\n    "visibility": "how the product/packaging appears",\n    "packagingDetails": "exact description of any packaging visible",\n    "foodStyling": "if food is visible, describe presentation",\n    "proportion": "what % of the frame the product occupies"\n  },\n\n  "offer": {\n    "structure": "how the offer is presented visually (badge, banner, overlay, integrated)",\n    "urgency": "any scarcity or time pressure elements",\n    "pricePresentation": "how price/discount is displayed",\n    "cta": "call to action text and visual treatment"\n  },\n\n  "emotionalHook": "what psychological trigger this ad uses",\n  "strengthScore": "1-10",\n  "whyItWorks": "200+ words on why this specific visual execution is effective for paid social, referencing specific design decisions",\n  "howToAdapt": "200+ words on how a competing brand could use this same visual FORMAT (not concept) with their own identity",\n  "visualCluster": "short name for this visual approach category"\n}` }
    ];

    const start = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 6000, system, messages: [{ role: "user", content: userContent }] }),
    });
    const elapsed = Date.now() - start;
    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `API ${response.status}: ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const result = await response.json();
    const text = result.content?.[0]?.text || "";
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { raw: text };
    }
    return new Response(JSON.stringify({ model, elapsed_ms: elapsed, usage: result.usage, analysis: parsed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
