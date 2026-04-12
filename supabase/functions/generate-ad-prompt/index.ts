// Supabase Edge Function: generate-ad-prompt
// Takes a saved ad's data + brand DNA and generates a Creative Kitchen prompt via Claude Opus 4.6
// v25: Supports mode='scan' which returns both visual analysis + long-format prompt

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

    const {
      saved_ad_id,
      advertiser_name,
      ad_copy,
      image_url,
      media_type,
      creative_direction,
      brand_name,
      brand_guidelines,
      tone_of_voice,
      sleeve_notes,
      colour_palette,
      typography,
      packaging_specs,
      photo_descriptions,
      mode,  // NEW: 'scan' mode returns analysis + prompt
    } = await req.json()

    if (!saved_ad_id) {
      throw new Error('saved_ad_id is required')
    }

    // ─── Build the brand DNA context block ───────────────────
    const brandDnaSections: string[] = []

    if (brand_guidelines) {
      brandDnaSections.push(`BRAND GUIDELINES:\n${brand_guidelines}`)
    }
    if (tone_of_voice) {
      brandDnaSections.push(`TONE OF VOICE:\n${tone_of_voice}`)
    }
    if (sleeve_notes) {
      brandDnaSections.push(`SLEEVE & PACKAGING NOTES:\n${sleeve_notes}`)
    }
    if (colour_palette) {
      brandDnaSections.push(`COLOUR PALETTE:\n${typeof colour_palette === 'object' ? JSON.stringify(colour_palette, null, 2) : colour_palette}`)
    }
    if (typography) {
      brandDnaSections.push(`TYPOGRAPHY:\n${typeof typography === 'object' ? JSON.stringify(typography, null, 2) : typography}`)
    }
    if (packaging_specs) {
      brandDnaSections.push(`PACKAGING SPECIFICATIONS:\n${typeof packaging_specs === 'object' ? JSON.stringify(packaging_specs, null, 2) : packaging_specs}`)
    }
    if (photo_descriptions && photo_descriptions.length > 0) {
      const photoBlock = photo_descriptions
        .map((p: any) => `- ${p.meal_name || p.name}: ${p.description || ''}${p.prompt_snippet ? ` | Prompt snippet: ${p.prompt_snippet}` : ''}`)
        .join('\n')
      brandDnaSections.push(`PHOTO LIBRARY (approved meal photography):\n${photoBlock}`)
    }

    const brandDnaBlock = brandDnaSections.length > 0
      ? `\n\n═══ BRAND DNA — USE THIS AS YOUR SOURCE OF TRUTH ═══\n\n${brandDnaSections.join('\n\n')}\n\n═══ END BRAND DNA ═══`
      : ''

    // ─── SCAN MODE: two-part output (analysis + prompt) ──────
    if (mode === 'scan') {
      const scanSystemPrompt = `You are a senior creative director at a premium DTC food brand studio. You have two jobs:

1. VISUAL ANALYSIS: Study the competitor ad with the eye of an art director. Break down what makes it work (or not) — composition, colour palette, typography choices, photography style, emotional hook, target audience, platform conventions. Be specific and opinionated.

2. PROMPT WRITING: Then reverse-engineer the ad concept and rewrite it as a production-ready image generation prompt for YOUR brand, using the brand DNA provided.

You must output your response in exactly this format:

<analysis>
[Your visual analysis of the competitor ad. 200-400 words. Be specific: what's the layout structure, what colours dominate, what's the typography doing, what emotion does it evoke, what platform conventions does it follow, what's the hook, what would you steal vs discard. Write as a creative director briefing their team.]
</analysis>

<prompt>
[The full production-ready image generation prompt. 1,000-1,500 words. Follow the exact structure below.]
</prompt>

PROMPT STRUCTURE — the content inside <prompt> tags must follow this exact structure:
1. Opening line: "chefly paid social prompt: [ad concept description, all lowercase, full stop.]"
2. Opening paragraph: format, aspect ratio with pixel dimensions, platform, overall concept, emotional tone. 2-3 sentences.
3. Section headers in lowercase with full stops (e.g. "the left half — chefly side.") to organise the layout description.
4. Within each section: flowing descriptive paragraphs. No bullet points, no numbered lists, no markdown.
5. A "colour discipline." or "colour palette." section explaining colour balance.
6. A "what is NOT in the image." section listing deliberate absences.
7. A "this version." metadata footer.

PROMPT RULES:
- Use EXACT hex colour codes from the brand DNA — never approximate.
- Use EXACT font names from the brand DNA — Syne Extra Bold, Space Grotesk, Instrument Serif Italic, etc.
- For food photography: describe tray material, sleeve colour from sleeve notes, meal contents in vivid sensory language, lighting.
- Follow the brand's 95/5 colour rule: 95% cream and near-black, with colour only as purposeful punctuation.
- All text in the ad must be lowercase with full stops.
- Describe what things LOOK like, not how they'd be coded.
- 1,000–1,500 words for the prompt. This is non-negotiable.
- Output ONLY the <analysis> and <prompt> blocks — no other text.`

      const scanUserMessage = `Study this competitor ad and then rewrite it as a production-ready prompt for our brand.

COMPETITOR AD DETAILS:
Advertiser: ${advertiser_name || 'Unknown'}
Ad copy: ${ad_copy || 'No copy available'}
Media type: ${media_type || 'image'}
${image_url ? `Image URL: ${image_url}` : ''}
${creative_direction ? `\nCREATIVE DIRECTION FROM USER:\n${creative_direction}` : ''}
${brandDnaBlock}

First, analyse the competitor ad as a creative director. Then rewrite the concept for our brand using ONLY the brand DNA above.`

      // Build messages - include image if available
      const userContent: any[] = []
      if (image_url) {
        userContent.push({
          type: 'image',
          source: { type: 'url', url: image_url }
        })
      }
      userContent.push({ type: 'text', text: scanUserMessage })

      const claudeRes = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 16384,
          system: scanSystemPrompt,
          messages: [
            { role: 'user', content: userContent }
          ]
        })
      })

      if (!claudeRes.ok) {
        const errText = await claudeRes.text()
        throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
      }

      const claudeData = await claudeRes.json()
      const fullResponse = claudeData.content?.[0]?.text || ''

      // Parse out analysis and prompt
      const analysisMatch = fullResponse.match(/<analysis>([\s\S]*?)<\/analysis>/)
      const promptMatch = fullResponse.match(/<prompt>([\s\S]*?)<\/prompt>/)

      const analysis = analysisMatch ? analysisMatch[1].trim() : ''
      const generatedPrompt = promptMatch ? promptMatch[1].trim() : fullResponse

      if (!generatedPrompt) {
        throw new Error('Claude returned empty response')
      }

      // Save the prompt back to saved_ads
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
      }

      return new Response(
        JSON.stringify({
          success: true,
          analysis,
          prompt: generatedPrompt,
          saved_ad_id,
          model: 'claude-opus-4-6',
          mode: 'scan'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // ─── LEGACY MODE: original prompt-only generation ─────────
    const systemPrompt = `You are a senior creative director at a premium DTC food brand studio. You reverse-engineer competitor paid social ad creatives and rewrite them as production-ready image generation prompts for YOUR brand.

You have been given the brand's complete DNA — colour palette, typography, packaging system, sleeve designs, tone of voice, and photography style. USE IT. Every hex code, every font reference, every packaging detail in your prompt must come from the brand DNA, not guessed or inferred.

Your prompts are consumed by an AI image generation model, not a human designer. This means:
- Vivid visual and sensory descriptions work. Pixel-perfect CSS specifications do not.
- Use pixel sizes SPARINGLY as approximate spatial guides (e.g. "approximately 40px margin", "approximately 80px tall bar") — do NOT specify every element's exact dimensions.
- Focus on what things LOOK like, not how they'd be coded.

STRUCTURE — your prompt must follow this exact structure:
1. Opening paragraph: format, aspect ratio, platform, overall concept, emotional tone. 2-3 sentences.
2. Section headers in lowercase with full stops (e.g. "the left half — chefly side.") to organise the layout description. These are NOT markdown headers — just short orienting labels on their own line.
3. Within each section: flowing descriptive paragraphs. No bullet points, no numbered lists, no markdown.
4. A "what is NOT in the image." section listing deliberate absences.
5. A "this version." metadata footer: meal name, protein type, sleeve colour, comparison target (if applicable), aspect ratio, platform.

RULES:
1. Start with format, aspect ratio, and platform context.
2. Use EXACT hex colour codes from the brand DNA — never approximate or infer colours.
3. Use EXACT font names from the brand DNA — Syne Extra Bold, Space Grotesk, Instrument Serif Italic, etc. Never say "like" or "similar to".
4. For food photography: describe the tray material, sleeve colour and design from sleeve notes, meal contents in vivid sensory language, and lighting warmth/direction. Keep the food description to ONE focused paragraph.
5. Follow the brand's 95/5 colour rule: 95% cream and near-black, with colour only as purposeful punctuation.
6. All text in the ad must be lowercase with full stops. Single italic emphasis words use Instrument Serif Italic.
7. Describe what is deliberately ABSENT.
8. Output ONLY the prompt — no preamble, no explanation, no "Here's the prompt:" prefix.
9. TARGET LENGTH: 1,000–1,500 words. This is critical. Longer prompts degrade image generation quality. Be vivid and specific but disciplined — every sentence must earn its place.

PROMPT STRUCTURE TEMPLATE — your output must follow this structural pattern regardless of ad type:

"""
[short title line: brand name + ad format description, all lowercase, full stop.]
[Opening paragraph: 2-3 sentences. State the format ("A photorealistic vertical portrait image for..."), aspect ratio with pixel dimensions, the ad concept/angle, and the emotional tone. Set the scene.]
[section header in lowercase with full stop, e.g. "overall layout and structure."]
[1-2 paragraphs describing the frame division, spatial organisation, and how the composition works at a high level.]
[section header for each major visual zone, e.g. "the left half — chefly side." or "the hero section." or "the headline zone."]
[For each zone: 1-2 paragraphs covering background colour/texture (with exact hex from brand DNA), typography (exact font names and weights from brand DNA), and key visual elements. Use approximate pixel sizes sparingly as spatial guides.]
[If food is present: ONE paragraph of vivid sensory description — colours, textures, ingredients, plating style, lighting warmth and direction. Describe how the branded tray and sleeve look using details from the sleeve/packaging notes.]
[If the ad has a comparison or secondary element: a section for that side with the same level of detail.]
[section header: "colour discipline."]
[1 paragraph explaining the colour balance — which colours dominate, where accent colours appear, how the 95/5 rule is maintained.]
[section header: "what is NOT in the image."]
[1 paragraph listing every deliberate absence — no exclamation marks, no title case, no emojis, no competitor brand names, no gradients, etc. Be thorough.]
[section header: "this version."]
[Metadata footer on one line: Meal name. Protein type. Sleeve colour with hex. Comparison target if applicable. Aspect ratio. Platform.]
"""

CRITICAL CONSTRAINTS:
- 1,000–1,500 words MAXIMUM. This is non-negotiable. Longer prompts degrade image generation quality.
- The section headers adapt to the ad type — a testimonial ad will have different sections than a comparison ad. Use headers that make sense for the layout you're describing.
- ONE paragraph per food description. Vivid and sensory, but contained.
- Every hex code and font name must come from the brand DNA, never guessed.
- All ad text is lowercase with full stops. Single italic emphasis words use Instrument Serif Italic.
- Focus on what things LOOK like, not how they'd be coded. Sensory descriptions over pixel specifications.`

    let userMessage = `Reverse-engineer this competitor ad and rewrite it as a production-ready image generation prompt for our brand.

COMPETITOR AD DETAILS:
Advertiser: ${advertiser_name || 'Unknown'}
Ad copy: ${ad_copy || 'No copy available'}
Media type: ${media_type || 'image'}
${image_url ? `Image URL: ${image_url}` : ''}
${creative_direction ? `\nCREATIVE DIRECTION FROM USER:\n${creative_direction}` : ''}
${brandDnaBlock}

Rewrite this ad concept for our brand using ONLY the brand DNA above. The competitor ad gives you the CONCEPT and LAYOUT STRUCTURE. The brand DNA gives you EVERY visual detail — colours, fonts, packaging, photography style.

TARGET: 1,000–1,500 words. Use section headers. One paragraph per food description. End with a "this version." metadata footer. Match the quality example exactly.`

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 16384,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
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