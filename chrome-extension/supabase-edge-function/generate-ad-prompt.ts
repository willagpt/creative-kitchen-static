// Supabase Edge Function: generate-ad-prompt
// Takes a saved ad's data + brand context and generates a Creative Kitchen prompt via Claude API
// Deploy with: supabase functions deploy generate-ad-prompt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY not set in Edge Function secrets')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ─── Extract ALL fields from the request body ────────────────
    const {
      saved_ad_id,
      advertiser_name,
      ad_copy,
      image_url,
      media_type,
      brand_name,
      brand_guidelines,
      tone_of_voice,
      sleeve_notes,
      colour_palette,
      typography,
      packaging_specs,
      photo_descriptions,
      creative_direction,
    } = await req.json()

    if (!saved_ad_id) {
      throw new Error('saved_ad_id is required')
    }

    // ─── Build brand context block ───────────────────────────────
    const brandContextParts: string[] = []

    if (brand_guidelines) {
      brandContextParts.push(`BRAND GUIDELINES:\n${brand_guidelines}`)
    }

    if (tone_of_voice) {
      brandContextParts.push(`TONE OF VOICE:\n${tone_of_voice}`)
    }

    if (colour_palette?.length) {
      const colours = colour_palette.map((c: { name: string; hex: string }) => `${c.name}: ${c.hex}`).join('\n')
      brandContextParts.push(`COLOUR PALETTE (use exact hex codes):\n${colours}`)
    }

    if (typography && Object.keys(typography).length) {
      const typo = Object.entries(typography).map(([k, v]) => `${k}: ${v}`).join('\n')
      brandContextParts.push(`TYPOGRAPHY:\n${typo}`)
    }

    if (packaging_specs && Object.keys(packaging_specs).length) {
      const specs = Object.entries(packaging_specs).map(([k, v]) => `${k}: ${v}`).join('\n')
      brandContextParts.push(`PACKAGING:\n${specs}`)
    }

    if (sleeve_notes) {
      brandContextParts.push(`SLEEVE DESIGN NOTES:\n${sleeve_notes}`)
    }

    const brandContextBlock = brandContextParts.length > 0
      ? `\n\n── BRAND IDENTITY FOR ${(brand_name || 'the target brand').toUpperCase()} ──\n\n${brandContextParts.join('\n\n')}\n\n── END BRAND IDENTITY ──`
      : ''

    // ─── Build photo reference block ─────────────────────────────
    let photoBlock = ''
    if (photo_descriptions?.length) {
      const descs = photo_descriptions
        .map((p: { meal_name?: string; name?: string; description?: string; prompt_snippet?: string }) => {
          const label = p.meal_name || p.name || 'meal'
          const desc = p.prompt_snippet || p.description || ''
          return desc ? `${label}: ${desc}` : null
        })
        .filter(Boolean)
        .join('\n\n')
      if (descs) {
        photoBlock = `\n\nFOOD PHOTOGRAPHY REFERENCES — use these descriptions to inform how the food should look, feel, and be lit:\n${descs}`
      }
    }

    // ─── Build the Claude system prompt ──────────────────────────
    const systemPrompt = `You are writing image generation prompts for a DTC food brand's paid social ads. Your prompts will be fed directly into fal.ai nano-banana-2. You must write vivid, atmospheric, narrative descriptions that paint a picture. NOT pixel-level specifications, NOT CSS-like layouts, NOT bullet-point lists.

YOUR TASK: Study a competitor's paid social ad. Recreate the same ad concept, same layout structure, same strategic approach, but fully adapted for the target brand's identity, packaging, and food photography style.

CRITICAL: WHAT DOES NOT WORK WITH IMAGE GENERATORS:
Pixel coordinates ("positioned at y:1680, x:48"), CSS specifications ("6px tall", "40% opacity", "border-radius: 24px"), exact font rendering instructions ("set in Syne Extra Bold 800 at 16px"), layout grids with exact proportions. These all get garbled. Describe the visual hierarchy and spatial relationships instead.

IMAGE GENERATOR COMPOSITION RULES (follow these strictly):
1. DETAIL IMBALANCE: Spend 70 to 80% of your description on the BRAND side (food, packaging, atmosphere). The competitor/negative side should be described BRIEFLY and SIMPLY, in 2 to 3 short sentences maximum. When you describe the ugly side with the same atmospheric depth as the beautiful side, the generator renders both sides with equal quality and the contrast disappears.
2. CAMERA ANGLE: Always describe a three-quarter angle (approximately 30 to 45 degrees), never flat overhead or directly above. Three-quarter angles work reliably with image generators. Overhead flat-lays confuse the spatial composition.
3. COMPARISON ADS: When the original ad compares the brand against something (ready meals, recipe boxes, etc.), describe the competitor side as a simple, clear object: "a generic black plastic ready meal tray with a homogeneous curry inside, film lid peeled back" or "a red recipe box with raw ingredients spilling out." Do NOT describe the competitor food in vivid food-writer detail. Flat, clinical, brief.
4. MEAL CONSISTENCY: If the brand side shows a specific meal, the competitor side should show a generic version of a similar category (e.g. both chicken dishes, both pasta dishes), not an entirely different meal. This prevents the generator from mixing up labels and food.
5. SIMPLICITY OVER COMPLEXITY: Image generators produce better results from clear, confident descriptions than from exhaustive detail. If a section is getting longer than 150 words, you are overcomplicating it. The food hero section is the exception, it should be rich and detailed.

MANDATORY PROMPT STRUCTURE — your prompt MUST include ALL of these sections, written as flowing paragraphs with lowercase section headers. Every section is required. Do not skip any.

1. opening (format, aspect ratio, concept, tone)
Start with what the image IS: photorealistic, the format (story ad, feed post, billboard), the aspect ratio, the core concept in one sentence, and the emotional tone. This paragraph sets the creative direction for everything that follows.

2. environment or background
Describe the background in detail. What is the setting? What colour is the background? Describe the texture (paper grain, matte, glossy). If it is a real-world setting (park, kitchen, street), describe the atmosphere, the depth of field, the ambient light, the feeling. Include hex colour codes woven naturally into the description. Specify the colour temperature in Kelvin (e.g. "warm 3800K like kitchen window light" or "cool 5500K like flat overhead fluorescent"). Minimum 60 words for this section.

3. food hero (CRITICAL — minimum 100 words)
This is the most important section. Describe the food like a food writer, not a menu. Name every visible ingredient. Describe textures: char marks, glistening glazes, caramelised edges, the way light catches toasted nuts, the translucency of steamed rice grains, the deep green of wilted kale. Describe how the food is arranged: is it generous and abundant or precisely plated? Does it fill the tray edge to edge? Describe the specific colours of the food: amber-brown glaze, vivid orange carrot ribbons, pale gold almond slivers. Describe how the food is lit: soft directional window light from camera-left, warm overhead pass light making sauces glisten. The food description must be rich enough that someone could paint the dish from your words alone.

4. packaging (tray, sleeve, sticker)
Describe the tray material: natural kraft-coloured bagasse fibre, warm beige-brown (#D4C5A0 to #C4B08E), matte, slightly textured surface with visible pressed sugarcane fibre grain. Not glossy, not plastic. Describe the branded sleeve: its background colour (determined by protein type — orange for beef, hot yellow for poultry, electric green for vegetarian, blush for pork, sky blue for fish), the single-stroke line-drawn ingredient motifs at 12 to 16% opacity in near-black, what specific motifs appear (based on the meal ingredients). Describe the cream meal sticker (#FFF6EE) with rounded corners showing the meal name in bold lowercase with a full stop. Describe the logo: "chef" in bold geometric sans-serif, "ly" in handwritten cursive script, with registered trademark symbol.

5. typography and text elements
Describe any text that appears in the image. All text is lowercase, always with full stops. Headlines use heavy geometric extra-bold sans-serif. One word per composition is set in elegant serif italic as the single emphasis word. Body text uses clean sans-serif. Describe the visual weight, colour, and placement of each text element narratively. Do not specify exact font sizes in pixels.

6. layout and composition
Describe how the elements are arranged in the frame. Use spatial language: "top-left", "centre divider", "lower third", "full-width bar at the bottom". Describe the visual hierarchy: what does the eye see first, second, third? Describe the flow: how does a viewer's gaze move through the image in under 3 seconds?

7. lighting specifics
Describe the primary light source, its direction, its colour temperature in Kelvin, its quality (soft, hard, diffused, directional). Describe any secondary light sources. Describe how light interacts with specific surfaces: does it make the glaze glisten? Does it create warm highlights on the sleeve? Does it cast gentle shadows? If there are two sides to the image (comparison ad), describe the lighting contrast between them (warm vs cool, directional vs flat). Minimum 40 words.

8. colour grading
Describe the overall colour palette and how colour is distributed. Which areas are warm, which are cool? Which elements are saturated, which are desaturated? The brand follows a 95/5 colour rule: 95% of surface area is cream background and near-black type, with colour coming only from the food, the sleeve, and accent elements. Describe how this creates focal points.

9. camera and technical details
Describe the equivalent lens (50mm, 85mm), aperture (f/2.8, f/5.6), and the resulting depth of field. Describe what is in sharp focus and what falls into bokeh. Describe any subtle effects: slight vignetting, natural colour temperature, compression from a longer lens. This section makes the image feel photographed rather than generated.

10. what is NOT in the image
List everything that should be deliberately absent. This prevents the image generator from adding unwanted elements. Common exclusions: no competitor brand names, no exclamation marks, no title case, no emojis, no lifestyle models, no glossy plastic surfaces, no busy patterns, no gradients between halves. Be specific to the ad type.
${brandContextBlock}
${photoBlock}

REFERENCE PROMPT — this is the quality bar. Your prompt must match this level of detail, this atmospheric depth, and this length. Study how every section is handled:

"""
chefly paid social prompt: kitchen handoff.

A photorealistic vertical portrait image for a premium UK DTC meal delivery brand's paid social story ad. Aspect ratio 9:16 (1080x1920 pixels). The image is a confident, tactile, "hand-to-camera" product hero shot inside a real professional kitchen. It feels like you're being handed your dinner by the chef who just made it. The mood is warm, authentic, and immediately establishes credibility through environment rather than claims.

the background environment.

The entire image is photographed inside a packed, high-end professional kitchen during a full service. Think Michelin-starred brigade in the middle of a Friday night push. Every station is occupied. Every surface is in use. But nothing is chaotic. This is controlled, disciplined intensity. The kind of kitchen where nobody raises their voice because everybody knows exactly where they need to be.

Shot at a shallow depth of field so the kitchen falls into a pleasing bokeh behind the product, but even in the blur you can read the energy and organisation.

The brigade (background, soft focus): Three to four chefs visible at different depths, all in crisp white double-breasted chef jackets and traditional white toques. Nobody is looking at the camera. One chef is plating with tweezers at the pass, bent forward in concentration. Another is working a pan on a gas range, a controlled flame licking up around the edges. A third is moving between stations carrying a stainless steel container. A fourth, further back, is checking tickets on the rail. Their body language is focused, purposeful, fast but never frantic. The hierarchy is visible in how they move: the one at the pass is clearly the senior chef, composed and precise, while the others orbit around the stations with rehearsed efficiency.

The station (mid-ground, soft focus): Immaculate stainless steel surfaces (#C0C0C0 to #A8A8A8) reflecting the warm overhead lights. Everything is in its place. Prep containers (stainless steel sixth-pans and ninth-pans) are lined up in neat rows along the pass, each filled with fresh mise en place: finely diced shallots, fresh herb sprigs (flat-leaf parsley, thyme, chives), sliced radishes, microgreens, sauces in squeeze bottles arranged by colour. A stack of clean white plates sits at the pass, ready. Copper pans hang from an overhead rail. A ticket printer or order rail with white paper tickets is visible. The gas range behind shows the blue glow of open burners. Everything communicates: this kitchen runs like clockwork.

The environment details: Professional extraction hood running the full length of the ceiling. Tiled or stainless steel backsplash. The faint haze of cooking steam in the upper third of the frame, backlit by the overhead lights, giving the air a warm, cinematic density. The kitchen is predominantly monochromatic: stainless grey, white uniforms, warm haze. Small colour accents come from the mise en place (herbs, vegetables in prep containers) but these are muted in the bokeh, not competing with the foreground. The yellow sleeve and the food in the tray should be the only saturated colour in the frame. The kitchen lighting is warm overhead fluorescent mixed with the faint glow of gas flames, creating a colour temperature around 3800 to 4200K. Warm, golden, alive. Stainless surfaces show soft rectangular reflections of the overhead lights and the faint silhouettes of moving chefs, adding depth and kinetic energy even in the bokeh.

the foreground product hero.

A left hand (clean, no jewellery, neatly trimmed nails) extends from the bottom-left corner of the frame, holding an open Chefly meal tray at roughly 20 degrees from horizontal, angled slightly toward camera to show both the top surface and the front edge. The hand grip is relaxed and natural, thumb on the left edge, four fingers beneath, like someone casually presenting it across a kitchen pass. The meal is positioned in the centre-right of the frame, occupying approximately 45% of the image width and 35% of the image height.

the tray and sleeve (critical brand accuracy).

The tray is a natural kraft-coloured bagasse fibre tray. Warm beige-brown (#D4C5A0 to #C4B08E), with a matte, slightly textured surface showing visible pressed sugarcane fibre grain. Not glossy, not plastic, not a supermarket ready-meal container. The material reads as eco-conscious and artisanal, like something you'd see at a premium street food market or a zero-waste deli. No film lid, no plastic wrap, no sealed packaging visible. The tray is open and uncovered, showing the food directly as if it was just plated moments ago: two spice-rubbed grilled chicken thighs, sliced on the diagonal to reveal charred grill marks on the surface and a juicy pink-gold interior. They sit on a generous bed of dark curly kale, deep green and slightly wilted from cooking, with golden roasted butternut squash cubes scattered throughout showing caramelised edges. Toasted flaked almonds and pine nuts are scattered across the top, pale gold and catching the light. The colours are rich and earthy: deep greens from the kale, warm amber-orange from the squash, golden-brown from the spiced chicken skin, pale gold from the nuts. The food fills the tray generously, edge to edge, with no visible tray surface beneath. It looks abundant, not portioned. No steam. The food looks alive, freshly assembled, not sealed behind anything. This is the moment between kitchen and box, before the lid goes on. That's the fiction of the shot, and it makes the food infinitely more appetising than anything behind plastic.

Wrapped around the tray is a Chefly branded protein sleeve. The sleeve is the centrepiece of the packaging identity. It wraps fully around the tray (390x202mm at actual scale). The sleeve's background is a solid food-colour determined by the protein type:

Beef: Orange (#FF6B2C)
Poultry: Hot Yellow (#FFD60A)
Vegetarian: Electric Green (#A8E10C)
Pork: Blush (#FF8FA3)
Fish: Sky Blue (#5CCFFF)

For this image, use: Hot Yellow (#FFD60A) background (poultry).

Over the solid yellow, the sleeve carries tonal ingredient motifs: simple single-stroke line-drawn ingredient SVGs rendered in near-black (#0D0D0D) at 12 to 16% opacity (because yellow is a lighter sleeve background). The motifs for this meal: kale leaf, butternut squash cross-section, almond, rosemary sprig, and a whole chicken thigh outline. The motifs add depth and recipe-specific character up close, but from a distance the bold yellow dominates. The motifs feel organic, hand-drawn, slightly imperfect. Not clip-art, not vector-perfect. Warm, craft-authentic, kitchen-feeling.

On the front face of the sleeve, the Chefly logo is visible. The logo reads "chefly" where "chef" is set in a bold sans-serif (Syne Extra Bold 800) and "ly" is a handwritten script (Instrument Serif Italic). A small registered trademark symbol sits as a superscript to the right of the "ly". On this yellow sleeve, the logo and all sleeve text are near-black (#0D0D0D) (dark text on light background). Minimum visible width: 24mm equivalent.

Below the logo, the tagline reads: "real easy, real tasty, real food." in Syne Extra Bold, all lowercase, with "food" set in Instrument Serif Italic as the single emphasis word. Near-black on the yellow sleeve. 14px equivalent at sleeve scale.

the cream meal sticker.

Sitting on the front face of the sleeve is a cream meal sticker (#FFF6EE). Rounded corners (4mm radius). Matte, uncoated finish. Approximately 160x80mm at actual scale.

At phone-screen viewing distance (9:16 story ad), only three things need to read clearly on the sticker: the cream background (brand recognition), the meal name in bold dark type ("spiced chicken and kale." in Syne Extra Bold, lowercase, full stop), and a small yellow "poultry" badge providing a colour hit that ties the sticker to the sleeve. Below the meal name, a line of smaller text and one or two additional small badges are present but function as texture and detail, not readable content. They signal "there's information here" without needing to be legible at scroll speed. The sticker's job in this image is to look like a premium label, not to be read word for word.

no composited overlays.

No floating labels, no trust badges, no graphic elements composited onto the photograph. The image is purely photographic with real physical elements only: the tray, the sleeve, the sticker, the food, the hand, the kitchen. Any messaging beyond the packaging itself (reviews, CTAs, "your chef just finished this" type copy) belongs in the caption, a text-overlay story frame, or a separate card in a carousel. Let the image breathe. The kitchen and the open food already tell the story.

depth and focus.

Shot with the equivalent of a 50mm lens on full frame at f/2.8. The tray, sleeve, and sticker are tack-sharp. The branded sleeve motifs are visible. The sticker text is perfectly legible. The kitchen environment falls into a smooth, creamy bokeh starting approximately 1 metre behind the tray. The chefs are recognisable as chefs (white jackets, toques) but their faces are soft, not identifiable. The prep ingredients on the counter are colourful blurs that add warmth. Focus falloff is gradual and natural, not a fake portrait-mode effect.

lighting specifics.

Primary light source is the kitchen's overhead lighting (large rectangular fluorescent panels diffused through frosted covers), creating even, soft illumination across the tray from above. A secondary warm light source from camera-right (the heat lamp at the pass) adds a warm golden highlight along the right edge of the tray and the food surface. The blue-orange glow of gas burners in the background adds a subtle warm-cool contrast that reads as unmistakably "live kitchen." The food inside the tray catches the pass light, making sauces glisten and herbs look vibrant. The hand has natural, even skin-tone lighting with no harsh shadows. Stainless steel surfaces throughout the background create soft rectangular reflections of the overhead lights and the moving figures of the brigade, adding industrial authenticity and kinetic energy. A faint haze of cooking steam in the upper portion of the frame is backlit by the overheads, giving the air a warm, cinematic density. Overall exposure is bright and appetising. No moody shadows, no dark corners, but the depth and steam give the image a richness that a clean, empty kitchen could never achieve.

colour grading.

Warm but controlled. The background kitchen reads as near-monochrome: warm greys, white uniforms, golden haze. This is deliberate. The only saturated colour in the frame should be the yellow sleeve and the food itself (the deep greens of the kale, the amber squash, the golden chicken). This creates an instant focal point. Your eye goes straight to the product because it's the only thing with colour. Chef jackets read as true white, not yellow. Stainless steel reads as neutral grey, not blue. The background is warm but desaturated compared to the foreground, creating natural depth separation without competing for attention.

what is NOT in the image.

No plastic film, no cling wrap, no sealed lid, no visible plastic of any kind. No dining table or home setting. No lifestyle models eating or smiling. No flat-lay arrangement. No multiple trays or product lineup. No black trays, no glossy white packaging, no supermarket-style containers. No text overlays baked into the photograph outside of physical elements (the sleeve, the sticker, and the label graphic). No artificial studio backdrop. No garnish scattered around the tray for styling. No cutlery. No competitor branding. No title case or capitalised text anywhere. No exclamation marks. No emojis on the packaging. No more than one food-colour visible (one protein type per image).

composition summary.

Three layers of depth, one focal point. Background: monochrome kitchen brigade in warm bokeh. Mid-ground: stainless steel pass with organised mise en place. Foreground: hand presenting an open tray of vibrant food in a bold yellow sleeve with a cream sticker. The yellow and the food are the only saturated colour. Everything else is warm grey and white. The image works without any text overlay, caption, or graphic element. It's a photograph that tells the whole story on its own.

this version.

Meal: spiced chicken and kale. Protein: poultry. Sleeve: Hot Yellow (#FFD60A). Motifs: kale, butternut squash, almond, rosemary, chicken thigh outline. Near-black motifs at 12 to 16% opacity on yellow.
"""

YOUR PROMPT MUST BE AT LEAST 1,500 WORDS. If your prompt is shorter than this, you have not included enough detail. Go deeper on the food description, the lighting, the atmosphere, and the packaging.

Output ONLY the prompt. No preamble, no explanation, no "Here's the prompt:" prefix. Write in flowing paragraphs with lowercase section headers. Match the depth and atmospheric quality of the reference prompt above.`

    // ─── Build the user message ──────────────────────────────────
    let userMessage = `Study this competitor ad and write an image generation prompt that recreates its concept — same format, same strategic approach — but fully adapted for ${brand_name || 'the target brand'}.

Competitor brand: ${advertiser_name || 'Unknown'}
Ad copy: ${ad_copy || 'No copy available'}
Media type: ${media_type || 'image'}
${image_url ? `Image: ${image_url}` : ''}`

    if (creative_direction) {
      userMessage += `\n\nCreative direction from the user: ${creative_direction}`
    }

    userMessage += `\n\nWrite the prompt in the narrative, atmospheric style shown in the examples. Describe mood, light, food textures, and brand packaging as physical objects in a scene. Do not write CSS specifications or pixel coordinates. Flowing paragraphs, no lists.`

    // ─── Call Claude API ──────────────────────────────────────────
    const messages: Array<{ role: string; content: any }> = []

    // If we have an image URL, send it as a vision message
    if (image_url) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'url',
              url: image_url,
            },
          },
          {
            type: 'text',
            text: userMessage,
          },
        ],
      })
    } else {
      messages.push({
        role: 'user',
        content: userMessage,
      })
    }

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const generatedPrompt = claudeData.content?.[0]?.text || ''

    if (!generatedPrompt) {
      throw new Error('Claude returned empty response')
    }

    // ─── Save the prompt back to the saved_ads row ────────────────
    const { error: updateError } = await supabase
      .from('saved_ads')
      .update({
        generated_prompt: generatedPrompt,
        prompt_generated_at: new Date().toISOString(),
        prompt_model: 'claude-sonnet-4-20250514'
      })
      .eq('id', saved_ad_id)

    if (updateError) {
      console.error('Failed to save prompt:', updateError)
      // Still return the prompt even if DB save fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        prompt: generatedPrompt,
        saved_ad_id,
        model: 'claude-sonnet-4-20250514'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
