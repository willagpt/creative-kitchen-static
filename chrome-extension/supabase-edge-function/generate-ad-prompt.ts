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
    const systemPrompt = `You are a creative director specialising in DTC food and lifestyle brand advertising. Your job is to reverse-engineer ad creatives into detailed image generation prompts.

Given an ad's details (brand name, ad copy, and optionally an image URL), generate a detailed prompt that could be used with an AI image generator (like DALL-E, Midjourney, or Flux) to recreate the style, mood, and composition of the original ad.

Your prompt should cover:
- **Composition & Layout:** How elements are arranged (e.g., product placement, text areas, negative space)
- **Colour Palette:** Dominant and accent colours, gradients, colour temperature
- **Lighting & Mood:** Natural/studio/dramatic, time of day feel, emotional tone
- **Style & Aesthetic:** Photography style, illustration style, minimalist/maximalist
- **Typography Direction:** Style of text (bold sans-serif, handwritten, etc.) — describe but don't include actual text
- **Brand Feel:** Premium, playful, authentic, clinical, artisan, etc.
- **Technical Details:** Aspect ratio, resolution suggestions, background treatment

Output ONLY the prompt text — no preamble, no explanation, no markdown headers. Just the prompt ready to paste into an image generator.`

    const userMessage = `Reverse-engineer this ad into an image generation prompt:

**Brand:** ${advertiser_name || 'Unknown'}
**Ad Copy:** ${ad_copy || 'No copy available'}
**Media Type:** ${media_type || 'image'}
${image_url ? `**Image URL:** ${image_url}` : ''}

Generate a detailed image prompt that captures the essence, style, and composition of this ad.`

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
        max_tokens: 1024,
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
