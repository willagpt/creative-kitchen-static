// Supabase Edge Function: compare-prompts v1
// Takes two prompts and returns a plain English summary of what changed
// and how those changes would affect the generated image

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

    const { prompt_a, prompt_b, label_a, label_b } = await req.json()

    if (!prompt_a || !prompt_b) {
      throw new Error('prompt_a and prompt_b are required')
    }

    const systemPrompt = `You compare two image generation prompts and explain what changed in plain English. Focus on VISUAL IMPACT: what would look different in the generated images.

Rules:
1. List only the actual differences. Do not describe things that stayed the same.
2. For each change, explain the visual impact in simple terms. e.g. "The background changed from outdoor garden to studio cream, so the image will feel more controlled and product-focused."
3. Keep it concise. 3 to 8 bullet points maximum.
4. Use plain language, not prompt jargon. Say "the meal changed from steak to chicken" not "the MEAL_NAME placeholder was substituted".
5. If the prompts are nearly identical with only minor wording tweaks, say so.
6. Start with the most visually significant change first.
7. Format as a simple list with a dash (-) before each point. No headers, no numbering, no bold text.
8. Do not use em dashes. Use commas or full stops instead.`

    const userMessage = `Compare these two prompts and tell me what changed visually.

--- ${label_a || 'Version A'} ---
${prompt_a}

--- ${label_b || 'Version B'} ---
${prompt_b}

What are the visual differences between these two?`

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
    const summary = claudeData.content?.[0]?.text || ''

    if (!summary) {
      throw new Error('Claude returned empty response')
    }

    return new Response(
      JSON.stringify({ success: true, summary }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('Compare prompts error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})