// Supabase Edge Function: generate-shot-sequence
// Takes a plated reference image + brand context and generates a 5-shot tray sequence
// Deploy with: supabase functions deploy generate-shot-sequence

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
    if (!claudeApiKey) throw new Error('CLAUDE_API_KEY not set')

    const {
      image_url,
      meal_name,
      photo_description,
      brand_name,
      brand_guidelines,
      tone_of_voice,
      sleeve_notes,
      colour_palette,
      typography,
      packaging_specs,
      packaging_mode,
    } = await req.json()

    if (!image_url) throw new Error('image_url is required')

    // ─── Build brand context block ───────────────────────────────
    const brandParts: string[] = []

    if (brand_guidelines) brandParts.push(`BRAND GUIDELINES:\n${brand_guidelines}`)
    if (tone_of_voice) brandParts.push(`TONE OF VOICE:\n${tone_of_voice}`)

    if (colour_palette?.length) {
      const colours = colour_palette.map((c: { name: string; hex: string }) => `${c.name}: ${c.hex}`).join('\n')
      brandParts.push(`COLOUR PALETTE (use exact hex codes):\n${colours}`)
    }

    if (typography && Object.keys(typography).length) {
      const typo = Object.entries(typography).map(([k, v]) => `${k}: ${v}`).join('\n')
      brandParts.push(`TYPOGRAPHY:\n${typo}`)
    }

    if (packaging_specs && Object.keys(packaging_specs).length) {
      const specs = Object.entries(packaging_specs).map(([k, v]) => `${k}: ${v}`).join('\n')
      brandParts.push(`PACKAGING:\n${specs}`)
    }

    if (sleeve_notes) brandParts.push(`SLEEVE DESIGN NOTES:\n${sleeve_notes}`)

    const brandBlock = brandParts.length > 0
      ? `\n\n── BRAND IDENTITY FOR ${(brand_name || 'the target brand').toUpperCase()} ──\n\n${brandParts.join('\n\n')}\n\n── END BRAND IDENTITY ──`
      : ''

    // ─── Packaging mode instruction ─────────────────────────────
    const modeStr = packaging_mode || 'tray'
    let packagingInstruction = ''
    if (modeStr === 'tray') {
      packagingInstruction = `SERVING FORMAT: Every shot MUST show the food in the branded tray with sleeve. The reference image shows the food plated — your job is to reimagine it presented in the brand's bagasse tray with the branded sleeve wrapped around it, exactly as described in the packaging specs and sleeve notes above. The tray and sleeve are central to every shot.`
    } else if (modeStr === 'plated') {
      packagingInstruction = `SERVING FORMAT: Every shot should show the food plated on a clean, premium plate or bowl. No packaging, no trays, no sleeves. The food is the hero.`
    } else {
      packagingInstruction = `SERVING FORMAT: Do not specify a particular serving vessel. Focus on the food itself and the overall scene composition.`
    }

    // ─── System prompt ──────────────────────────────────────────
    const systemPrompt = `You are a food photography creative director for ${brand_name || 'a premium UK DTC meal delivery brand'}. You write image generation prompts that go directly into fal.ai nano-banana-2.

Write the way a food photographer and art director think together: vivid, atmospheric, narrative. Describe scenes, light, textures, and mood. Never write CSS specifications, pixel coordinates, or technical layout grids. Paint a picture instead.

${brandBlock}

${packagingInstruction}

You will be shown a reference photograph of a plated meal. Your job is to create a 5-shot sequence — five distinct image generation prompts that capture this same meal from different angles, contexts, and moods. Each shot should be production-ready for paid social ads.

THE 5 SHOTS:
1. Hero three-quarter — The money shot. Three-quarter angle, warm directional light, shallow depth of field. The tray/plate fills 50-60% of the frame. This is the primary ad image.
2. Close-up detail — Tight crop on the most photogenic element (a glaze, char marks, a garnish, texture). Macro-level detail. Makes you taste it through the screen.
3. Lifestyle context — The meal in a real environment. Kitchen counter, dining table, desk at lunchtime. A human moment without showing faces. Shallow depth, warm tones.
4. Flat-lay bird's eye — Directly overhead looking down. The meal centred with contextual props: cutlery, a drink, a napkin, ingredients scattered. Clean, geometric, editorial.
5. Unboxing moment — The meal being taken out of or placed into the delivery box. Hands visible, casual grip. The outer packaging and the tray both visible. The moment of anticipation.

For each shot, write a complete, standalone prompt of 600-1000 words. Use the same narrative, atmospheric style: flowing paragraphs, sensory food descriptions, exact hex codes from the brand DNA, exact font names for any packaging text, lighting specifics, colour grading notes, and a "what is NOT in the image" section.

Always use three-quarter camera angles except for shot 4 (flat-lay). Describe food like a food writer: textures, glazes, char marks, how light catches surfaces.

Respond in valid JSON with this exact structure:
{
  "shots": [
    { "title": "hero three-quarter.", "prompt": "..." },
    { "title": "close-up detail.", "prompt": "..." },
    { "title": "lifestyle context.", "prompt": "..." },
    { "title": "flat-lay overhead.", "prompt": "..." },
    { "title": "unboxing moment.", "prompt": "..." }
  ]
}

Output ONLY the JSON object. No preamble, no markdown code fences, no explanation.`

    // ─── User message ────────────────────────────────────────────
    let userText = `Here is a reference photograph of "${meal_name}".`
    if (photo_description) {
      userText += `\n\nExisting description of this meal: ${photo_description}`
    }
    userText += `\n\nGenerate the 5-shot sequence based on this reference image. Adapt the food presentation to match the brand's packaging and style guidelines.`

    // ─── Call Claude API ─────────────────────────────────────────
    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 8192,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: image_url } },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    let rawText = claudeData.content?.[0]?.text || ''

    // Strip markdown code fences if present
    rawText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()

    let parsed: { shots: Array<{ title: string; prompt: string }> }
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new Error('Failed to parse Claude response as JSON')
    }

    if (!parsed.shots || !Array.isArray(parsed.shots)) {
      throw new Error('Response missing shots array')
    }

    return new Response(
      JSON.stringify({
        success: true,
        shots: parsed.shots,
        meal_name,
        model: 'claude-opus-4-6',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (err) {
    console.error('generate-shot-sequence error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
