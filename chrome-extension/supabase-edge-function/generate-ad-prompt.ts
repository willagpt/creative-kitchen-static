// Supabase Edge Function: generate-ad-prompt
// Takes a saved ad's data and generates a Creative Kitchen prompt via Claude API
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

    const { saved_ad_id, advertiser_name, ad_copy, image_url, media_type } = await req.json()

    if (!saved_ad_id) {
      throw new Error('saved_ad_id is required')
    }

    // ─── Build the Claude prompt ──────────────────────────────────
    const systemPrompt = `You are a senior creative director at a DTC food and lifestyle brand studio. You reverse-engineer paid social ad creatives into production-ready image generation prompts.

Your prompts must read like a detailed creative brief — not a vague description. Write as if you're briefing a designer who will recreate this ad from scratch without ever seeing the original.

RULES:
1. Start with format and aspect ratio (e.g. "A clean, modern 4:5 social media ad for...")
2. Specify exact hex colour codes where possible — infer from the brand's visual identity if needed
3. Name font styles by reference (e.g. "heavy black sans-serif like Syne Extra Bold", "elegant serif italic like Instrument Serif")
4. Describe the layout top-to-bottom, section by section — headline, centre content, CTA, footer
5. Specify spacing language (generous margin, tight leading, centred, stacked)
6. Describe what's deliberately ABSENT (no photography, no emojis, no uppercase, etc.)
7. End with the overall tone and emotional temperature — calm, confident, urgent, playful, etc.
8. Use backticks for hex codes and exact text strings
9. Never use markdown headers, bullet points, or numbered lists — write in flowing paragraphs
10. Output ONLY the prompt — no preamble, no explanation, no "Here's the prompt:" prefix

QUALITY STANDARD — here is an example of the level of detail and specificity your output must match:

"""
A clean, modern 4:5 social media ad for a UK meal delivery brand called "Chefly". Price comparison format — Chefly vs the real cost of cooking from scratch. Warm cream background (\`#FFF6EE\`) with subtle paper grain texture at 5–6% opacity.
Top: Bold lowercase headline in heavy black sans-serif (like Syne Extra Bold) reading "why pay more to cook it yourself?" — the word "yourself?" is in elegant serif italic (like Instrument Serif Italic). Centre-aligned, with generous margin above and below.
Centre: Two side-by-side comparison cards of equal size, sitting in a rounded-corner container with a very faint warm-grey (\`#E8E0D8\`) background. Left card feels subtly warmer and more inviting than the right.
Below the comparison: A rounded orange (\`#FF6B2C\`) CTA button with white lowercase text and a small right-pointing arrow. Bottom: Logo centred with tagline in serif italic.
Style: The entire ad is typographic — no photography, no lifestyle imagery. The numbers do the talking. 95% cream and black, 5% orange on CTA and dot accents only. No emojis, no exclamation marks, no uppercase anywhere. Clean, confident, factual. The tone is not aggressive or salesy — it's a calm, honest question.
"""

Match this level of specificity for every ad you analyse. Infer design details from the brand name, ad copy, and visual identity. Be opinionated about design choices.`

    const userMessage = `Reverse-engineer this ad into a production-ready image generation prompt:

Brand: ${advertiser_name || 'Unknown'}
Ad copy: ${ad_copy || 'No copy available'}
Media type: ${media_type || 'image'}
${image_url ? `Image URL: ${image_url}` : ''}

Write the prompt at creative-director level — specific hex codes, font references, section-by-section layout, deliberate absences, and emotional tone. Flowing paragraphs, no lists.`

    // ─── Call Claude API ──────────────────────────────────────────
    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
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
