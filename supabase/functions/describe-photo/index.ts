// Supabase Edge Function: describe-photo v6
// Upgraded to Claude Sonnet 4.6 (claude-sonnet-4-6)
// Uses URL-based image input (no download needed)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { photo_id, image_url, photo_name, photo_type } = body

    if (!photo_id || !image_url) {
      throw new Error('photo_id and image_url are required')
    }

    console.log('[v6] describe-photo for', photo_id, 'model: claude-sonnet-4-6')

    const systemPrompt = `You are a visual analyst for a food brand's creative team. Your job is to describe reference photos in two ways:

1. DESCRIPTION: A detailed, factual description of what's in the image. Cover: subject matter, composition, camera angle, lighting quality and direction, colour palette, textures, surfaces, props, styling, mood. Be specific about food elements (proteins, garnishes, plating style, steam, sheen). 3 to 5 sentences.

2. PROMPT SNIPPET: A condensed, reusable phrase (1 to 2 sentences) that captures the visual essence of this photo in a way that could be dropped into an image generation prompt. Focus on the most distinctive visual qualities: the lighting style, the surface/background, the plating approach, the colour temperature, the angle. Write it as a fragment, not a full sentence. Example: "overhead flat-lay on matte sage-green surface, natural window light from upper-left, steam rising, scattered fresh herb leaves, warm colour temperature"

IMPORTANT: Never use em dashes or en dashes. Use commas, colons, or full stops instead.

Respond in JSON format exactly like this:
{"description": "...", "prompt_snippet": "..."}`

    const userContent = [
      {
        type: 'image',
        source: {
          type: 'url',
          url: image_url
        }
      },
      {
        type: 'text',
        text: `Describe this reference photo for our creative library.${photo_name ? ` File name: ${photo_name}.` : ''}${photo_type ? ` Tagged as: ${photo_type}.` : ''}\n\nReturn your response as JSON with "description" and "prompt_snippet" keys.`
      }
    ]

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userContent }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error('Claude API error ' + claudeRes.status + ': ' + errText.substring(0, 300))
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text || ''

    if (!rawText) throw new Error('Claude returned empty response')

    let description = ''
    let promptSnippet = ''
    try {
      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(jsonStr)
      description = parsed.description || ''
      promptSnippet = parsed.prompt_snippet || ''
    } catch {
      description = rawText
      promptSnippet = ''
    }

    const { error: updateError } = await supabase
      .from('photo_library')
      .update({
        description,
        prompt_snippet: promptSnippet,
        updated_at: new Date().toISOString()
      })
      .eq('id', photo_id)

    if (updateError) console.error('[v6] DB update error:', JSON.stringify(updateError))

    return new Response(
      JSON.stringify({
        success: true,
        photo_id,
        description,
        prompt_snippet: promptSnippet
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('[v6] ERROR:', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
