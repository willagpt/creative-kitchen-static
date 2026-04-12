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
    const systemPrompt = `You write image generation prompts for Chefly, a premium UK DTC meal delivery brand. Your prompts go directly into fal.ai nano-banana-2 to generate paid social ad creatives.

Write the way a food photographer and creative director think together: vivid, atmospheric, narrative. Describe scenes, light, textures, and mood. Never write CSS specifications, pixel coordinates, or technical layout grids. Image generators cannot follow those. Paint a picture instead.

When the ad is a comparison (brand vs ready meals, brand vs recipe boxes), spend most of your description on the Chefly side. The competitor side should be brief and flat: a few sentences describing a generic, unappealing object. Do not describe competitor food in vivid detail or the generator will render both sides equally well and the contrast disappears.

Always use a three-quarter camera angle. Never describe flat overhead or directly-above shots. Describe food like a food writer: textures, glazes, char marks, how light catches surfaces. Describe packaging as a physical object in the scene.
${brandContextBlock}
${photoBlock}

Here are two prompts that produce excellent results with this generator. Match their quality, depth, and atmospheric style. Write as much as you need. No length limits.

EXAMPLE 1 (product hero in professional kitchen):

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

No floating labels, no trust badges, no graphic elements composited onto the photograph. The image is purely photographic with real physical elements only: the tray, the sleeve, the sticker, the food, the hand, the kitchen. Any messaging beyond the packaging itself belongs in the caption or a separate card in a carousel. Let the image breathe.

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

EXAMPLE 2 (comparison ad, split-screen, Chefly vs recipe boxes):

A photorealistic vertical portrait image for a premium UK DTC meal delivery brand's paid social story ad. Aspect ratio 9:16 (1080x1920 pixels). The image is a bold, split-screen comparison layout that positions the brand as the obvious upgrade from recipe box subscriptions. The tone is confident, factual, and quietly superior, letting the food and the convenience gap do the talking. This is not aggressive or mocking. It is calm, assured, and backed by evidence.

The frame is divided vertically into two equal halves by a clean, sharp vertical line. No gradients, no blending, no soft transition between sides. Left half belongs to the brand. Right half belongs to generic recipe boxes.

the left half (the brand).

The background is warm cream (#FFF6EE) with a very subtle paper grain texture, like high-quality uncoated card stock. Top-left corner: the brand name in heavy geometric extra-bold sans-serif (Syne Extra Bold 800), all lowercase, near-black (#0D0D0D).

The "vs" badge: A circular badge in Chefly Orange (#FF6B2C) sits at the exact centre point where the two halves meet, overlapping both sides equally. Inside, bold white lowercase text reads "vs". The badge is slightly rotated at a casual angle, as if hand-placed like a sticker.

The hero food image on the left shows an open Chefly meal tray shot at a slight three-quarter angle. Inside the tray: tender pieces of teriyaki chicken thigh with a deep glossy caramelised glaze, the surface catching the light with an amber-brown sheen. The chicken sits on a generous bed of fluffy steamed jasmine rice, each grain distinct and slightly translucent. Scattered throughout: bright green edamame beans, fine julienned ribbons of pickled carrot in vivid orange, a delicate sprinkle of black sesame seeds creating contrast against the pale rice, and thin drizzles of sriracha mayo in pale coral creating elegant ribbons across the surface. The food fills the tray generously, edge to edge, with no visible tray surface beneath. It looks abundant, not portioned. Photographed in soft, warm, directional light, like a kitchen window on a bright morning.

The tray is natural kraft-coloured bagasse fibre wrapped in a branded sleeve in Hot Yellow (#FFD60A) with single-stroke line-drawn ingredient motifs at low opacity in near-black. A cream meal sticker (#FFF6EE) with rounded corners shows "teriyaki chicken and rice." in bold lowercase type with a full stop. The Chefly logo is visible with "chef" in bold geometric sans-serif and "ly" in handwritten cursive script with registered trademark symbol.

Below the food, three benefit lines stacked vertically with generous spacing. Each line has a small electric green (#A8E10C) circular checkmark icon followed by lowercase text in near-black. "ready in under 5 mins." "no cooking or washing up." "rated 'excellent' on trustpilot." All lowercase, all ending with full stops. The word "excellent" is set in elegant serif italic as the single emphasis word.

the right half (recipe boxes).

The background is a muted, desaturated warm grey, dull and uninviting compared to the cream warmth of the left side. Top-right corner: the words "recipe box" in a generic, medium-weight sans-serif, near-black, all lowercase. No brand name, no identity. Just a category label.

A generic red cardboard recipe box sits open with raw ingredients spilling out: unwashed broccoli, loose cherry tomatoes, raw chicken breast in vacuum-sealed plastic, a lemon, scattered herb sprigs already wilting. A crumpled recipe card is half-visible. The lighting is flat, overhead, and cool-toned, with no warmth or directional quality.

Below the recipe box, three drawback lines with muted red circular cross icons: "ready in 15 to 40 mins." "need to cook and wash up." "rated 'average' on trustpilot." Same typographic treatment as the left side.

the bottom bar.

A full-width electric green (#A8E10C) banner bar spans the entire bottom edge. Bold near-black (#0D0D0D) lowercase text reads: "try your first box today." with a right-pointing arrow. Above the CTA bar, a small Trustpilot badge row.

lighting specifics.

The left half is lit with soft, warm, directional light, approximately 3200K, like natural window light from camera-left. The right half is lit with flat, cool, overhead fluorescent light, approximately 5500K. The difference in colour temperature is subtle but unconsciously powerful. The left side feels like home. The right side feels like a warehouse.

colour grading.

Follows Chefly's 95/5 colour rule. The left side is predominantly cream and near-black with colour coming only from the yellow sleeve, the food, the green checkmarks, and the orange "vs" badge. The right side is deliberately desaturated. The only fully saturated colours in the entire frame are on the brand's side.

what is NOT in the image.

No competitor brand names on the right side. No exclamation marks. No title case. No emojis. No lifestyle models, no hands, no people. No gradients between the two halves. No glossy plastic surfaces on the brand's side. The right side should feel genuinely unappealing without being cartoonish.

Output ONLY the prompt. No preamble, no explanation, no "Here's the prompt:" prefix. Write as much as you need.

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
        model: 'claude-opus-4-6',
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
        prompt_model: 'claude-opus-4-6'
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
        model: 'claude-opus-4-6'
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
