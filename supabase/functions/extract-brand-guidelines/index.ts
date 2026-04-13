// Supabase Edge Function: extract-brand-guidelines v3
// Accepts HTML brand guidelines documents OR images of packaging/brand docs.
// Uses Claude to extract structured brand data that maps directly to Brand DNA fields.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const VALID_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function normalizeMediaType(mt: string): string {
  if (!mt) return 'image/jpeg'
  const lower = mt.toLowerCase().trim()
  if (VALID_MEDIA_TYPES.has(lower)) return lower
  if (lower === 'image/jpg') return 'image/jpeg'
  if (lower.startsWith('image/')) return 'image/jpeg'
  return 'image/jpeg'
}

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

    const body = await req.json()
    const { images, html_content, existing_guidelines } = body

    const hasImages = images && Array.isArray(images) && images.length > 0
    const hasHtml = html_content && typeof html_content === 'string' && html_content.length > 0

    if (!hasImages && !hasHtml) {
      throw new Error('Either html_content (string) or images array (each with base64 and media_type) is required')
    }

    const existingContext = existing_guidelines
      ? `\n\nExisting guidelines already on file (update and expand these, do not contradict unless the new content clearly shows something different):\n${existing_guidelines}`
      : ''

    const systemPrompt = `You are a senior brand strategist analysing brand guidelines for a UK DTC meal delivery company.

You will be shown either an HTML brand guidelines document or images of packaging/brand materials. Your job is to extract every detail and return it as structured JSON that maps to our Brand DNA form fields.

Return ONLY valid JSON (no markdown, no code fences, no explanation) with this exact structure:

{
  "guidelines_text": "Full summary of brand rules, identity principles, dos and don'ts. Include version number if visible. Reference the source document. Cover: colour rules, layout rules, typography rules, photography rules, tone rules, logo rules, packaging rules. Be comprehensive but concise.",
  "tone_of_voice": "How the brand speaks. Personality traits, what to do and avoid in copy. Capitalisation rules, punctuation rules.",
  "colour_palette": [
    { "hex": "#FFFFFF", "name": "Colour Name" }
  ],
  "typography": {
    "headline": "Font name, weight, size, tracking, any rules",
    "body": "Font name, weight range",
    "accent": "Font name, style, usage rules",
    "cta": "Font name, weight for CTAs"
  },
  "packaging_specs": {
    "tray": "Physical tray description, material, colour, dimensions if known",
    "sleeve": "General sleeve system description",
    "sticker": "Label/sticker system description",
    "box": "Outer box description",
    "notes": "General packaging rules (e.g. colour ratios, what never to do)"
  },
  "sleeve_notes": "Detailed sleeve design specification. Include: each protein/category colour variant, motif/pattern style, opacity levels, layout (front face, back face), logo placement, tagline, sticker integration, dimensions.",
  "sleeve_notes_alt": "If there are multiple sleeve design options or styles mentioned (e.g. old vs new, minimal vs bold), put the alternative style description here. Otherwise set to null."
}

Be extremely specific. Use exact hex codes from the document. Include all colours mentioned, not just primary ones. For sleeve notes, capture every variant (beef, poultry, veg, pork, fish or whatever categories exist). For typography, include tracking, leading, and capitalisation rules if specified.

Return ONLY the JSON object. No other text.`

    // Build content blocks
    const contentBlocks: any[] = []

    if (hasHtml) {
      // Strip HTML tags to get clean text (Claude can handle HTML but plain text is cleaner)
      contentBlocks.push({
        type: 'text',
        text: `Here is the brand guidelines document in HTML format. Extract all brand information from it:\n\n${html_content}`
      })
    }

    if (hasImages) {
      for (let i = 0; i < images.length; i++) {
        contentBlocks.push({
          type: 'text',
          text: `Brand asset ${i + 1} of ${images.length}:`
        })
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: normalizeMediaType(images[i].media_type),
            data: images[i].base64
          }
        })
      }
    }

    contentBlocks.push({
      type: 'text',
      text: `Extract comprehensive brand guidelines from the above and return as the specified JSON structure.${existingContext}`
    })

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

    // Parse the JSON response
    let extracted: any
    try {
      // Strip any markdown code fences just in case
      const cleaned = rawText.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()
      extracted = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('JSON parse failed, returning raw text:', parseErr)
      return new Response(
        JSON.stringify({
          success: true,
          structured: false,
          raw_text: rawText
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        structured: true,
        ...extracted
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (err) {
    console.error('Extract brand guidelines error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
