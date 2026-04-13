// Supabase Edge Function: refine-prompt v2
// Takes a current image generation prompt + user feedback
// Sends to Claude Opus to make surgical edits (NOT a rewrite)
// Returns the refined prompt

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

    const { current_prompt, user_feedback } = await req.json()

    if (!current_prompt) {
      throw new Error('current_prompt is required')
    }
    if (!user_feedback) {
      throw new Error('user_feedback is required')
    }

    const systemPrompt = `You are a prompt editor for an AI image generation pipeline. Your job is to make SURGICAL EDITS to an existing image generation prompt based on user feedback.

RULES:
1. ONLY change the specific things the user mentions. Do not rewrite or restructure the rest of the prompt.
2. Keep the same overall structure, length, and level of detail.
3. Keep the same writing style and voice.
4. If the user says "frame too thick" — find the sentence about the frame and change the dimensions/description. Don't touch anything else.
5. If the user says "text should be lower" — find where text positioning is described and adjust it. Don't touch anything else.
6. If the user mentions something that isn't in the prompt, add a brief, well-placed sentence or clause about it in the most logical location.
7. Return ONLY the full refined prompt. No explanations, no commentary, no "Here's the updated prompt:" prefix. Just the prompt text itself.
8. Never add meta-commentary like "[CHANGED]" or "[EDITED]" markers.
9. Preserve all hex colours, font names, brand references, and specific measurements that aren't being changed.
10. The output must be the complete prompt — not a diff, not just the changed parts.`

    const userMessage = `Here is the current image generation prompt:\n\n---\n${current_prompt}\n---\n\nThe user looked at the generated image and gave this feedback:\n\n"${user_feedback}"\n\nMake ONLY the changes needed to address this feedback. Return the full prompt with surgical edits applied.`

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
          { role: 'user', content: userMessage }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const refinedPrompt = claudeData.content?.[0]?.text || ''

    if (!refinedPrompt) {
      throw new Error('Claude returned empty response')
    }

    return new Response(
      JSON.stringify({
        success: true,
        refined_prompt: refinedPrompt,
        model: 'claude-opus-4-20250514',
        feedback_applied: user_feedback
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('Refine prompt error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
