// Supabase Edge Function: templatize-prompt
// Takes a master prompt and converts it into a reusable template with placeholders
// Deploy with: supabase functions deploy templatize-prompt

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

    const { prompt } = await req.json()

    if (!prompt) {
      throw new Error('prompt is required')
    }

    const systemPrompt = `You are a prompt template engineer. Your job is to take a detailed image generation prompt and convert it into a reusable template by replacing specific variable content with placeholders.

RULES:
1. Identify and replace these specific sections with placeholders:
   - The meal/product name and its full ingredient description -> {{MEAL_NAME}} and {{MEAL_DESCRIPTION}}
   - The headline or main marketing text -> {{HEADLINE}}
   - The background mood/colour/environment description -> {{BACKGROUND_MOOD}}
   - The CTA (call-to-action) text -> {{CTA_TEXT}}
   - The sleeve colour and pattern description -> {{SLEEVE_STYLE}}

2. Keep EVERYTHING ELSE exactly as it is. Do not change the visual DNA, layout structure, typography system, lighting, camera details, or "what is NOT in the image" section.

3. Each placeholder should replace the MINIMAL specific content. For example:
   - Replace "green goddess bowl" with {{MEAL_NAME}}
   - Replace the full ingredient list paragraph with {{MEAL_DESCRIPTION}}
   - Replace "bye bye, bloating. hello, energy." with {{HEADLINE}}
   - Replace background colour/mood description with {{BACKGROUND_MOOD}}
   - Replace CTA text like "try now and feel the difference" with {{CTA_TEXT}}
   - Replace sleeve colour and pattern description with {{SLEEVE_STYLE}}

4. If a section doesn't exist in the prompt, don't force a placeholder. Only replace what's actually there.

5. Output ONLY the templatized prompt. No preamble, no explanation, no markdown formatting.

6. After the template, add a separator line "---PLACEHOLDERS---" followed by a JSON object listing each placeholder found and what the original content was, like:
{"MEAL_NAME": "green goddess bowl", "MEAL_DESCRIPTION": "emerald green blanched broccolini...", "HEADLINE": "bye bye, bloating. hello, energy.", "BACKGROUND_MOOD": "warm cream (#FFF6EE) with subtle paper grain texture at 5 to 6% opacity", "CTA_TEXT": "try now and feel the difference", "SLEEVE_STYLE": "Electric Green (#A8E10C) with tonal botanical leaf patterns"}`

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
        messages: [
          { role: 'user', content: `Convert this prompt into a reusable template:\n\n${prompt}` }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const rawOutput = claudeData.content?.[0]?.text || ''

    if (!rawOutput) {
      throw new Error('Claude returned empty response')
    }

    // Parse template and placeholders
    let template = rawOutput
    let placeholders = {}

    const separatorIdx = rawOutput.indexOf('---PLACEHOLDERS---')
    if (separatorIdx !== -1) {
      template = rawOutput.slice(0, separatorIdx).trim()
      const jsonStr = rawOutput.slice(separatorIdx + '---PLACEHOLDERS---'.length).trim()
      try {
        placeholders = JSON.parse(jsonStr)
      } catch (e) {
        console.error('Failed to parse placeholders JSON:', e)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        template,
        placeholders,
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
