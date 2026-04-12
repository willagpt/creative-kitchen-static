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
    const systemPrompt = `You are writing image generation prompts for a DTC food brand's paid social ads. Your prompts will be fed directly into an AI image generator (fal.ai nano-banana-2). You must write in a style that image generators respond well to — vivid, atmospheric, narrative descriptions that paint a picture, NOT pixel-level specifications or CSS-like layouts.

YOUR TASK: You will be shown a competitor's paid social ad. Study its composition, format, and visual strategy. Then write a prompt that recreates the same ad concept — same layout structure, same strategic approach — but fully adapted for the target brand's identity, packaging, and food photography style.

HOW TO WRITE PROMPTS THAT WORK:
- Lead with the overall mood, setting, and atmosphere — the emotional first impression
- Describe food like a food writer: textures, colours, char marks, glistening sauces, the way light catches toasted nuts
- Describe light like a photographer: golden hour, soft directional, the warm glow of kitchen overheads, dappled through tree canopy
- Describe the brand's packaging as a physical object in the scene — the sleeve colour, the texture of the tray material, the cream sticker with its meal name
- Use colour codes and font references as guardrails within the narrative, not as the structure itself
- Describe what is deliberately ABSENT — this prevents the image generator from adding unwanted elements
- Write in flowing paragraphs, never bullet points or numbered lists
- The prompt should read like a creative brief that tells a story, not a technical specification

CRITICAL — WHAT DOES NOT WORK:
- Pixel coordinates ("positioned at y:1680, x:48") — image generators cannot follow these
- CSS-like specifications ("6px tall", "40% opacity", "border-radius: 24px") — these get garbled
- Exact font rendering ("set in Syne Extra Bold 800 at 16px") — image models approximate text, they cannot render specific fonts
- Multiple precise text blocks — the more text you ask for, the more errors you get. Keep text elements minimal and large
- Layout grids with exact proportions — describe the visual hierarchy and spatial relationships instead
${brandContextBlock}
${photoBlock}

PROVEN PROMPT EXAMPLES — match this narrative style, this level of detail, and this atmospheric approach:

"""
EXAMPLE 1 (comparison ad — split-screen format):

A photorealistic vertical portrait image for a premium UK DTC meal delivery brand's paid social story ad. Aspect ratio 9:16 (1080×1920 pixels). The image is a bold, split-screen comparison layout that positions the brand as the obvious upgrade from supermarket ready meals. The tone is confident, clean, and factual — letting the food and the facts do the talking.

The frame is divided vertically into two equal halves. Left half belongs to the brand. Right half belongs to generic ready meals. The division is clean and sharp.

The left half has a warm cream background with a subtle paper grain texture. The brand logo sits top-left. Below it, a small rounded badge in electric green with dark text reading "the better choice" in lowercase.

The hero food image shows an open meal tray shot at a slight three-quarter angle. Inside the tray: two spice-rubbed grilled chicken thighs, sliced on the diagonal to reveal charred grill marks and juicy pink-gold interior. They sit on a generous bed of dark curly kale, deep green and slightly wilted from cooking, with golden roasted butternut squash cubes showing caramelised edges. Bright pops from pomegranate seeds, toasted flaked almonds, and a light tahini drizzle. The food fills the tray generously, edge to edge — abundant, not portioned. The food is photographed in natural, soft, directional light — like a kitchen window.

Wrapped around the tray is a branded sleeve in hot yellow. The sleeve carries subtle hand-drawn botanical ingredient motifs at low opacity. A cream meal sticker shows the meal name in bold lowercase type with a full stop.

Below the food, four benefit lines each with a small green checkmark circle, listing protein content, natural ingredients, no seed oils, and trustpilot rating. All lowercase, all ending with full stops.

The right half has a muted, desaturated dark green background — dull, institutional, unappealing. A generic chicken tikka masala in an unbranded black plastic tray with peeled-back film. The sauce is thick, glossy, homogeneous. No texture variation, no fresh herbs. Flat overhead lighting. Below it, four drawback lines with muted red crosses.

A small orange "vs" badge sits at the centre divider. A bright electric green CTA bar spans the full width at the bottom with lowercase text and a right-pointing arrow.

What is NOT in the image: No competitor brand names. No exclamation marks. No title case. No emojis. No lifestyle models. No gradients between halves. No busy patterns.
"""

"""
EXAMPLE 2 (outdoor billboard — lifestyle setting):

A photorealistic outdoor scene of a large freestanding billboard in a lush, green London park setting. Mature trees with dappled sunlight filtering through cherry blossom branches frame the scene. Manicured hedgerows and rich green foliage fill the foreground. The light is soft, natural, and directional — like late-morning spring sun. The billboard casts a gentle, realistic shadow on the ground.

The billboard has a warm cream background with a very subtle paper grain texture — like high-quality uncoated card stock. A circular orange badge in the top-left corner, slightly rotated as if hand-placed, reads "save 50%" in bold white lowercase text.

The main headline in heavy geometric extra-bold sans-serif, all lowercase, near-black, reads: "bye bye, ready meals. hello, real food." — with "food" rendered in elegant serif italic in orange as the single emphasis word. Full stop at the end.

A white rounded-rectangle social proof card beneath contains star ratings and a customer quote in lowercase. Below that, a meal tray tilted at a slight dynamic angle showing sliced grilled steak over quinoa with roasted sweet potato, dark leafy kale, and scattered pomegranate seeds. Wisps of steam rise naturally. The food looks freshly plated — natural, warm, appetising.

The tray is wrapped in an orange branded sleeve with subtle tonal ingredient silhouettes. A cream sticker label shows the meal name in bold lowercase.

Below the billboard, a bright electric green banner bar with bold near-black lowercase text and a right-pointing arrow.

The park setting creates an aspirational lifestyle context. The overall mood is calm, confident, quietly sophisticated. No exclamation marks. No puns. No glossy surfaces. No stock-photo aesthetic.
"""

Output ONLY the prompt. No preamble, no explanation, no "Here's the prompt:" prefix. Write in flowing paragraphs. Match the narrative style of the examples above.`

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
