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
   - The meal/product name -> {{MEAL_NAME}}
   - ALL food-specific visual descriptions -> {{MEAL_DESCRIPTION}}
   - The headline or main marketing text -> {{HEADLINE}}
   - The background mood/colour/environment description -> {{BACKGROUND_MOOD}}
   - The CTA (call-to-action) text -> {{CTA_TEXT}}
   - The sleeve colour and pattern description -> {{SLEEVE_STYLE}}

2. CRITICAL: {{MEAL_DESCRIPTION}} must capture ALL food-related visual content from EVERY section of the prompt. This includes:
   - The full ingredient list / dish description paragraph
   - Any references to specific food items, proteins, sides, grains, vegetables, sauces
   - Sauce colours, drizzle descriptions, garnish arrangements
   - Tray/bowl/plate descriptions that reference specific food colours or arrangements
   - Steam, sheen, char marks, or other food-specific visual effects

   COMMON HIDING SPOTS FOR FOOD REFERENCES (you MUST check all of these):
   - **Lighting/technical section**: phrases like "the salmon glistens", "the quinoa catches light", "the falafel has textural depth" MUST be replaced. Use generic equivalents: "the protein glistens", "the grains catch individual light", "the elements have textural depth"
   - **Hand/garnish section**: specific garnish names ("microgreens", "pea shoots", "radish sprouts") should be replaced with {{GARNISH_DESCRIPTION}} or made generic ("fresh garnish")
   - **Strategic narrative section**: any references to specific dishes or ingredients in the brand strategy text must be genericized
   - **Negative prompts section**: food items mentioned in "what is NOT in the image" that are meal-agnostic (like "no supplements") can stay, but anything referencing the specific replaced meal should be removed
   - **Colour references tied to food**: "coral-pink (#FA8072)" describing salmon, "golden-brown" describing roasted chicken, etc. must be extracted

   TEST: After templatizing, read through the ENTIRE template and ask: "If I replaced {{MEAL_DESCRIPTION}} with 'tandoori chicken with pilau rice and raita', would ANY other text in this template contradict that?" If yes, you missed a food reference. Extract it.

3. ASPECT RATIO: Replace any specific aspect ratio mention (e.g. "1:1 (1080x1080 pixels)", "4:5 (1080x1350)", "9:16") with {{ASPECT_RATIO}}. The actual ratio is controlled by the generation system, not the prompt text.

4. Keep these parts of the template intact (they are meal-agnostic):
   - Camera angle, lens, lighting setup (but genericize any food-specific examples within them)
   - Typography system (font, size, weight, positioning)
   - Layout structure (where elements are placed)
   - Image quality/style directives
   - Brand-specific elements (logo, badge structure, review card)
   - General container/packaging shape (but NOT food-specific colours in the container)

5. For the lighting/technical section, replace specific food examples with generic versions:
   BEFORE: "the salmon glistens, the quinoa has individual grains catching light, the vegetables have a natural sheen from roasting, the falafel has textural depth"
   AFTER: "the protein glistens with freshness, grains and seeds catch individual light, vegetables have a natural sheen, and textural elements show depth from the lighting angle"

6. If a section doesn't exist in the prompt, don't force a placeholder. Only replace what's actually there.

7. Output ONLY the templatized prompt. No preamble, no explanation, no markdown formatting.

8. After the template, add a separator line "---PLACEHOLDERS---" followed by a JSON object listing each placeholder found and what the original content was, like:
{"MEAL_NAME": "green goddess bowl", "MEAL_DESCRIPTION": "emerald green blanched broccolini, golden-seared salmon fillet with honey-soy glaze...", "HEADLINE": "bye bye, bloating. hello, energy.", "BACKGROUND_MOOD": "warm cream (#FFF6EE) with subtle paper grain texture", "CTA_TEXT": "try now and feel the difference", "SLEEVE_STYLE": "Electric Green (#A8E10C) with tonal botanical leaf patterns", "ASPECT_RATIO": "1:1 (1080x1080 pixels)"}

IMPORTANT: The MEAL_DESCRIPTION in the JSON should contain ALL the food-visual text you extracted, concatenated together, even if it came from multiple places in the prompt. This gives the most complete picture for regeneration with a different meal.`

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
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
