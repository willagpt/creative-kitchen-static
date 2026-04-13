// Supabase Edge Function: generate-variables v5
// Takes meal names + optional reference images + brand guidelines,
// uses Claude Opus vision to generate matching descriptions,
// multiple headline/CTA variations, moods, and sleeve styles

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
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY not set in Edge Function secrets')
    }

    const { meal_names, original_placeholders, reference_images, brand_guidelines, sleeve_notes } = await req.json()

    if (!meal_names || !Array.isArray(meal_names) || meal_names.length === 0) {
      throw new Error('meal_names array is required')
    }

    const hasImages = reference_images && Array.isArray(reference_images) && reference_images.length > 0

    // FIX: When reference images are present, exclude MEAL_DESCRIPTION from examples
    // so Claude describes the photo instead of copying the old description
    const exampleContext = original_placeholders
      ? `\n\nHere is an example of the style and level of detail from the original prompt. Match this tone and depth for non-image fields:\n${hasImages ? '- MEAL_DESCRIPTION: DO NOT use the example below. Describe what you SEE in the reference photo instead.' : `- MEAL_DESCRIPTION example: "${original_placeholders.MEAL_DESCRIPTION || 'N/A'}"`}\n- HEADLINE example: "${original_placeholders.HEADLINE || 'N/A'}"\n- BACKGROUND_MOOD example: "${original_placeholders.BACKGROUND_MOOD || 'N/A'}"\n- CTA_TEXT example: "${original_placeholders.CTA_TEXT || 'N/A'}"\n- SLEEVE_STYLE example: "${original_placeholders.SLEEVE_STYLE || 'N/A'}"`
      : ''

    const brandGuidelinesBlock = brand_guidelines
      ? `\n\nBRAND GUIDELINES (follow these precisely):\n${brand_guidelines}`
      : ''

    const sleeveBlock = sleeve_notes
      ? `\n\nSLEEVE/PACKAGING NOTES (match existing packaging style):\n${sleeve_notes}`
      : ''

    const systemPrompt = `You generate creative variables for a UK DTC meal delivery brand called Chefly. You write at a senior creative director level.

Chefly brand voice: confident but never arrogant. Warm but not childish. Bold but not loud. All lowercase. No exclamation marks. No puns. No emojis. Headlines end with full stop.${brandGuidelinesBlock}

Chefly colour toolkit for sleeves:
- Orange #FF6B2C (beef)
- Hot Yellow #FFD60A (poultry)
- Electric Green #A8E10C (veg/plant)
- Blush #FF8FA3 (pork)
- Sky Blue #5CCFFF (fish/seafood)
- Warm Brown #D4915E (meatball)${sleeveBlock}

For each meal name provided, generate:
1. MEAL_DESCRIPTION: A rich, appetising paragraph describing the dish at ingredient level. Include colours, textures, garnishes, steam, sheen. 40 to 80 words. This should make someone hungry. CRITICAL: When a reference photo is attached for a meal, describe ONLY what is visible in that specific photo. The photo is the single source of truth. Describe the exact plating, garnishes, sauce placement, side dishes, and colours you see. IGNORE any example descriptions provided elsewhere in this prompt. Do NOT describe a generic version of the dish.
2. HEADLINES: Generate 5 different headline options per meal. Each is short, punchy (3 to 8 words, lowercase, ends with full stop). Vary the angle: one about taste, one about convenience, one emotional, one about ingredients, one playful. They should all work as ad headlines.
3. BACKGROUND_MOOD: A specific colour/environment description with hex codes. Vary these across meals.
4. CTA_TEXTS: Generate 4 different call-to-action options per meal (lowercase, 4 to 8 words each). Vary the urgency and angle: one direct, one curiosity-driven, one social proof, one time-sensitive.
5. SLEEVE_STYLE: Colour name, hex code, and pattern description matching the protein type and brand packaging guidelines.

Output as JSON with this exact structure:
{
  "meals": [
    {
      "MEAL_NAME": "the meal name",
      "MEAL_DESCRIPTION": "the description",
      "HEADLINES": ["headline one.", "headline two.", "headline three.", "headline four.", "headline five."],
      "BACKGROUND_MOOD": "the mood",
      "CTA_TEXTS": ["cta one", "cta two", "cta three", "cta four"],
      "SLEEVE_STYLE": "the style"
    }
  ],
  "extra_headlines": ["generic headline one.", "generic headline two.", "generic headline three.", "generic headline four.", "generic headline five."],
  "extra_moods": ["mood one", "mood two", "mood three"],
  "extra_ctas": ["cta one", "cta two", "cta three"]
}

The extra_headlines, extra_moods, and extra_ctas are bonus variations that work across ANY meal, giving more combinatorial options. Generate 5 extra headlines, 3 extra moods, and 3 extra CTAs.

Output ONLY valid JSON. No markdown, no code fences, no explanation.`

    // Build the user message content blocks
    const contentBlocks: any[] = []

    // Add reference images as vision content if provided
    if (hasImages) {
      for (const img of reference_images) {
        const mealName = meal_names[img.meal_index] || `Meal ${img.meal_index + 1}`
        contentBlocks.push({
          type: 'text',
          text: `Reference photo for "${mealName}":`
        })
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.media_type || 'image/jpeg',
            data: img.base64
          }
        })
      }
    }

    // Add the text prompt
    // FIX: Stronger override instruction when images are present
    const imageNote = hasImages
      ? '\n\nREFERENCE PHOTOS ARE ATTACHED ABOVE. For every meal that has a photo, your MEAL_DESCRIPTION must describe EXACTLY what is in that photo. Override any example descriptions. Describe the specific plating, garnishes, sauce placement, side dishes, proteins, and colours visible in the image. If the photo shows tandoori chicken, describe tandoori chicken. If it shows a burger, describe a burger. The photo always wins.'
      : ''
    contentBlocks.push({
      type: 'text',
      text: `Generate creative variables for these Chefly meals:\n\n${meal_names.map((name: string, i: number) => `${i + 1}. ${name}`).join('\n')}${imageNote}${exampleContext}`
    })

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          { role: 'user', content: contentBlocks }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text || ''

    if (!rawText) {
      throw new Error('Claude returned empty response')
    }

    // Parse JSON, stripping any markdown code fences if present
    const cleanJson = rawText.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim()
    let variables
    try {
      variables = JSON.parse(cleanJson)
    } catch (e) {
      throw new Error(`Failed to parse Claude output as JSON: ${e.message}`)
    }

    return new Response(
      JSON.stringify({ success: true, variables }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('Generate variables error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
