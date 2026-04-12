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

Here are two prompts that produce excellent results with this generator. Match their quality, depth, and atmospheric style:

EXAMPLE 1 (product hero in professional kitchen):

A photorealistic vertical portrait image for a premium UK DTC meal delivery brand's paid social story ad. Aspect ratio 9:16 (1080x1920 pixels). The image is a confident, tactile, "hand-to-camera" product hero shot inside a real professional kitchen. It feels like you're being handed your dinner by the chef who just made it. The mood is warm, authentic, and immediately establishes credibility through environment rather than claims.

The entire image is photographed inside a packed, high-end professional kitchen during a full service. Shot at a shallow depth of field so the kitchen falls into a pleasing bokeh behind the product. Three to four chefs visible at different depths, all in crisp white double-breasted chef jackets and traditional white toques. Nobody is looking at the camera. One chef is plating with tweezers at the pass. Another is working a pan on a gas range. The kitchen is predominantly monochromatic: stainless grey, white uniforms, warm haze. The kitchen lighting is warm overhead fluorescent mixed with the faint glow of gas flames, creating a colour temperature around 3800 to 4200K. Stainless surfaces show soft rectangular reflections of the overhead lights.

A left hand extends from the bottom-left corner of the frame, holding an open Chefly meal tray at roughly 20 degrees from horizontal, angled slightly toward camera. The tray is natural kraft-coloured bagasse fibre, warm beige-brown (#D4C5A0 to #C4B08E), with a matte, slightly textured surface showing visible pressed sugarcane fibre grain. Inside: two spice-rubbed grilled chicken thighs, sliced on the diagonal to reveal charred grill marks and a juicy pink-gold interior. They sit on a generous bed of dark curly kale, deep green and slightly wilted from cooking, with golden roasted butternut squash cubes showing caramelised edges. Toasted flaked almonds and pine nuts scattered across the top, pale gold and catching the light. The food fills the tray generously, edge to edge. It looks abundant, not portioned.

Wrapped around the tray is a branded sleeve in Hot Yellow (#FFD60A). The sleeve carries tonal ingredient motifs: simple single-stroke line-drawn ingredient SVGs in near-black (#0D0D0D) at 12 to 16% opacity. The Chefly logo is visible: "chef" in bold geometric sans-serif, "ly" in handwritten cursive script, with registered trademark symbol. A cream meal sticker (#FFF6EE) with rounded corners shows the meal name in bold lowercase with a full stop.

Shot with a 50mm lens at f/2.8. The tray and sleeve are tack-sharp. The kitchen falls into smooth bokeh. The only saturated colour in the frame is the yellow sleeve and the food. Everything else is warm grey and white. No plastic, no sealed lid, no text overlays, no lifestyle models, no exclamation marks, no title case.

EXAMPLE 2 (comparison ad, split-screen):

A photorealistic vertical portrait image for a premium UK DTC meal delivery brand's paid social story ad. Aspect ratio 9:16 (1080x1920 pixels). The image is a bold, split-screen comparison layout that positions the brand as the obvious upgrade from recipe box subscriptions. The tone is confident, factual, and quietly superior.

The frame is divided vertically into two halves. Left half belongs to the brand with a warm cream background (#FFF6EE) with subtle paper grain texture. Right half represents recipe boxes in muted, desaturated tones. The brand name sits top-left in heavy geometric extra-bold lowercase sans-serif in near-black (#0D0D0D). An orange (#FF6B2C) circular "vs" badge sits at the centre divider.

The hero food image on the left shows an open meal tray shot at a three-quarter angle. Inside: tender pieces of teriyaki chicken thigh with a deep glossy caramelised glaze, the surface catching the light with an amber-brown sheen. The chicken sits on fluffy steamed jasmine rice, each grain distinct. Scattered throughout: bright green edamame beans, fine julienned ribbons of pickled carrot in vivid orange, a delicate sprinkle of black sesame seeds, and thin drizzles of sriracha mayo in pale coral. The food fills the tray generously, edge to edge. Photographed in soft, warm, directional light like a kitchen window.

The tray is natural kraft bagasse fibre wrapped in a branded sleeve in Hot Yellow (#FFD60A) with single-stroke line-drawn ingredient motifs at low opacity. A cream meal sticker shows "teriyaki chicken and rice." in bold lowercase with a full stop. The Chefly logo is visible with "chef" in bold sans-serif and "ly" in handwritten script.

Below the food, three benefit lines with electric green (#A8E10C) checkmarks: "ready in under 5 mins." "no cooking or washing up." "rated 'excellent' on trustpilot." All lowercase, full stops. The word "excellent" in elegant serif italic.

The right half shows a generic red recipe box sitting open with raw ingredients spilling out: unwashed vegetables, raw chicken in plastic, loose herbs, a lemon rolling to the side. Flat overhead lighting, no warmth. Below it, three drawback lines with muted red crosses.

A full-width electric green (#A8E10C) CTA bar at the bottom with bold near-black lowercase text and a right-pointing arrow. Shot with an 85mm lens at f/5.6. Left side lit warm at 3200K, right side flat at 5500K. No competitor brand names, no exclamation marks, no title case, no emojis, no lifestyle models.

Output ONLY the prompt. No preamble, no explanation, no "Here's the prompt:" prefix.`

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
        model: 'claude-opus-4-20250514',
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
        prompt_model: 'claude-opus-4-20250514'
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
        model: 'claude-opus-4-20250514'
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
