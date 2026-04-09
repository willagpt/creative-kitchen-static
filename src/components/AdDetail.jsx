import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

const FAL_MODEL = 'fal-ai/nano-banana-2'

export default function AdDetail({ ad, versions, onClose, onRefresh, onTemplatize, brands, activeBrandId }) {
  const [prompt, setPrompt] = useState(ad.generated_prompt || '')
  const [direction, setDirection] = useState('')
  const [status, setStatus] = useState('')
  const [statusType, setStatusType] = useState('')
  const [activeVersion, setActiveVersion] = useState(0)
  const [ratio, setRatio] = useState('4:5')
  const [generating, setGenerating] = useState(false)
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [autoPipeline, setAutoPipeline] = useState(false)
  const pipelineRanRef = useRef(false)

  // Escape key to close
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Reset when ad changes
  useEffect(() => {
    setPrompt(ad.generated_prompt || '')
    setActiveVersion(0)
    setStatus('')
    setDirection('')
    pipelineRanRef.current = false
  }, [ad.id])

  const currentImage = versions[activeVersion]?.image_url || ad.generated_image_url
  const hasVersions = versions.length > 0
  const activeBrand = brands?.find(b => b.id === activeBrandId)

  // Build brand context for prompt generation
  function getBrandContext() {
    if (!activeBrand) return {}
    return {
      brand_name: activeBrand.name,
      brand_guidelines: activeBrand.guidelines_text || '',
      tone_of_voice: activeBrand.tone_of_voice || '',
      sleeve_notes: activeBrand.sleeve_notes || '',
      colour_palette: activeBrand.colour_palette || [],
      typography: activeBrand.typography || {},
      packaging_specs: activeBrand.packaging_specs || {},
    }
  }

  // Fetch described photos from the photo library for the active brand
  async function getPhotoDescriptions() {
    try {
      let query = supabase
        .from('photo_library')
        .select('name, type, description, prompt_snippet')
        .not('description', 'is', null)
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data } = await query
      return data || []
    } catch (err) {
      console.error('Failed to fetch photo descriptions:', err)
      return []
    }
  }

  // Auto-pipeline: when opening an ad with no prompt, auto-generate prompt then image
  useEffect(() => {
    if (pipelineRanRef.current) return
    if (ad.generated_prompt || generatingPrompt || generating) return
    const falKey = localStorage.getItem('ck_fal_api_key')
    if (!falKey) return // can't auto-pipeline without a fal key
    pipelineRanRef.current = true
    setAutoPipeline(true)
    runAutoPipeline()
  }, [ad.id])

  async function runAutoPipeline() {
    // Step 1: Generate prompt
    setGeneratingPrompt(true)
    setStatus('Studying the ad and writing your prompt...')
    setStatusType('')
    try {
      const photoDescs = await getPhotoDescriptions()
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-ad-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          saved_ad_id: ad.id,
          advertiser_name: ad.advertiser_name,
          ad_copy: ad.ad_copy,
          image_url: ad.image_url,
          media_type: ad.media_type,
          ...getBrandContext(),
          photo_descriptions: photoDescs.length > 0 ? photoDescs : undefined,
        })
      })
      const data = await res.json()
      if (!res.ok || !data.prompt) throw new Error(data.error || 'No prompt returned')
      setPrompt(data.prompt)
      setGeneratingPrompt(false)
      setStatus('Prompt written. Now generating your image...')
      onRefresh()

      // Step 2: Generate image immediately
      const falKey = localStorage.getItem('ck_fal_api_key')
      if (!falKey) {
        setStatus('Prompt generated. Set your fal.ai key to auto-generate images.')
        setStatusType('success')
        setAutoPipeline(false)
        return
      }
      setGenerating(true)
      const headers = { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' }
      const payload = { prompt: data.prompt.trim(), num_images: 1, aspect_ratio: ratio, enable_safety_checker: false }

      const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
        method: 'POST', headers, body: JSON.stringify(payload)
      })
      if (!submitRes.ok) throw new Error(`fal.ai submit failed (${submitRes.status})`)
      const submitData = await submitRes.json()
      if (!submitData.request_id) throw new Error('No request_id from fal.ai')

      setStatus('Image generating...')
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const statusRes = await fetch(
          `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}/status`,
          { headers }
        )
        const statusData = await statusRes.json()
        if (statusData.status === 'COMPLETED') break
        if (statusData.status === 'FAILED') throw new Error('fal.ai generation failed')
        setStatus(`Image generating... (${Math.round(i * 1.5)}s)`)
      }

      const resultRes = await fetch(
        `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}`,
        { headers }
      )
      const resultData = await resultRes.json()
      const imageUrl = resultData?.images?.[0]?.url || resultData?.image?.url
      if (!imageUrl) throw new Error('No image in fal.ai result')

      await supabase.from('generated_versions').insert({
        saved_ad_id: ad.id,
        image_url: imageUrl,
        prompt: data.prompt.trim(),
        aspect_ratio: ratio
      })
      await supabase
        .from('saved_ads')
        .update({ generated_image_url: imageUrl, image_generated_at: new Date().toISOString() })
        .eq('id', ad.id)

      setStatus('Done. Your Chefly version is ready.')
      setStatusType('success')
      setActiveVersion(0)
      onRefresh()
    } catch (err) {
      console.error('Auto-pipeline failed:', err)
      setStatus(`Pipeline failed: ${err.message}`)
      setStatusType('error')
    } finally {
      setGenerating(false)
      setGeneratingPrompt(false)
      setAutoPipeline(false)
    }
  }

  // Manual: Generate a new prompt via Edge Function
  async function generatePrompt() {
    setGeneratingPrompt(true)
    setStatus('Studying the ad and writing your prompt...')
    setStatusType('')
    try {
      const photoDescs = await getPhotoDescriptions()
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-ad-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          saved_ad_id: ad.id,
          advertiser_name: ad.advertiser_name,
          ad_copy: ad.ad_copy,
          image_url: ad.image_url,
          media_type: ad.media_type,
          creative_direction: direction || undefined,
          ...getBrandContext(),
          photo_descriptions: photoDescs.length > 0 ? photoDescs : undefined,
        })
      })

      const data = await res.json()
      if (!res.ok || !data.prompt) throw new Error(data.error || 'No prompt returned')

      setPrompt(data.prompt)
      setStatus('Prompt generated.')
      setStatusType('success')
      onRefresh()
    } catch (err) {
      console.error('Prompt generation failed:', err)
      setStatus(`Failed: ${err.message}`)
      setStatusType('error')
    } finally {
      setGeneratingPrompt(false)
    }
  }

  // Generate image via fal.ai
  async function generateImage() {
    if (!prompt.trim()) {
      setStatus('Write or generate a prompt first.')
      setStatusType('error')
      return
    }

    setGenerating(true)
    setStatus('Submitting to fal.ai...')
    setStatusType('')

    try {
      // Get fal API key from localStorage (user sets it once)
      const falKey = localStorage.getItem('ck_fal_api_key')
      if (!falKey) {
        setStatus('fal.ai API key not set. Click settings to add it.')
        setStatusType('error')
        setGenerating(false)
        return
      }

      const headers = { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' }
      const payload = { prompt: prompt.trim(), num_images: 1, aspect_ratio: ratio, enable_safety_checker: false }

      // Submit
      const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
        method: 'POST', headers, body: JSON.stringify(payload)
      })
      if (!submitRes.ok) {
        const errText = await submitRes.text()
        throw new Error(`fal.ai submit failed (${submitRes.status}): ${errText.slice(0, 200)}`)
      }
      const submitData = await submitRes.json()
      if (!submitData.request_id) throw new Error('No request_id from fal.ai')

      setStatus('Generating image...')

      // Poll for completion
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const statusRes = await fetch(
          `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}/status`,
          { headers }
        )
        const statusData = await statusRes.json()

        if (statusData.status === 'COMPLETED') break
        if (statusData.status === 'FAILED') throw new Error('fal.ai generation failed')
        setStatus(`Generating image... (${i * 1.5}s)`)
      }

      // Get result
      const resultRes = await fetch(
        `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}`,
        { headers }
      )
      const resultData = await resultRes.json()
      const imageUrl = resultData?.images?.[0]?.url || resultData?.image?.url

      if (!imageUrl) throw new Error('No image in fal.ai result')

      // Save version to Supabase
      await supabase.from('generated_versions').insert({
        saved_ad_id: ad.id,
        image_url: imageUrl,
        prompt: prompt.trim(),
        creative_direction: direction || null,
        aspect_ratio: ratio
      })

      // Update the ad's generated_image_url
      await supabase
        .from('saved_ads')
        .update({ generated_image_url: imageUrl, image_generated_at: new Date().toISOString() })
        .eq('id', ad.id)

      setStatus(`Image generated (${ratio}).`)
      setStatusType('success')
      setActiveVersion(0)
      onRefresh()
    } catch (err) {
      console.error('Image generation failed:', err)
      setStatus(`Failed: ${err.message}`)
      setStatusType('error')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="detail-overlay" role="dialog" aria-modal="true" aria-label="Ad detail" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="detail-panel">
        {/* Header */}
        <div className="detail-header">
          <div>
            <span className="font-heading">{ad.advertiser_name || 'Unknown brand'}</span>
            <span className="text-xs text-muted" style={{ marginLeft: 'var(--space-sm)' }}>
              {ad.platform} {ad.started_running && `\u00b7 ${ad.started_running}`}
            </span>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="Close detail panel">&times;</button>
        </div>

        {/* Comparison */}
        <div className="detail-comparison">
          <div className="detail-comparison-panel">
            <span className="panel-tag panel-tag-original">Original Ad</span>
            <div className="panel-image">
              {ad.image_url ? (
                <img src={ad.image_url} alt="Original" />
              ) : (
                <div className="panel-placeholder"><p>No image captured</p></div>
              )}
            </div>
            {ad.ad_copy && (
              <p className="text-xs text-muted mt-sm" style={{ lineHeight: 1.4 }}>
                {ad.ad_copy.length > 200 ? ad.ad_copy.slice(0, 200) + '...' : ad.ad_copy}
              </p>
            )}
          </div>

          <div className="detail-comparison-panel">
            <span className="panel-tag panel-tag-generated">AI Generated</span>
            <div className="panel-image">
              {currentImage ? (
                <img src={currentImage} alt="Generated" />
              ) : (
                <div className="panel-placeholder">
                  {autoPipeline ? (
                    <>
                      <span className="spinner" style={{ marginBottom: 'var(--space-sm)' }} />
                      <p>{status || 'Processing...'}</p>
                      <p className="text-xs text-muted" style={{ marginTop: 'var(--space-xs)' }}>
                        Claude is studying the original ad and writing a detailed prompt, then generating an image.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>Your Chefly version will appear here</p>
                      <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
                        Click "New Prompt" to have Claude study the original ad and write a generation prompt.
                        Then click "Generate Image" to create your version.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Versions strip */}
        {hasVersions && (
          <div className="versions-strip">
            {versions.map((v, i) => {
              const num = versions.length - i
              const ratioLabel = v.aspect_ratio || ''
              return (
                <div
                  key={v.id}
                  className={`version-thumb ${i === activeVersion ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveVersion(i) }}
                >
                  <img src={v.image_url} alt={`v${num}`} draggable="false" />
                  <span className="version-thumb-label">v{num} {ratioLabel}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Action bar */}
        <div className="action-bar">
          <div className="action-bar-left">
            <button
              className="btn btn-secondary"
              onClick={generatePrompt}
              disabled={generatingPrompt}
            >
              {generatingPrompt ? <><span className="spinner spinner-inline" /> Generating...</> : '\u21bb New Prompt'}
            </button>

            <div className="aspect-pills">
              {['4:5', '9:16'].map(r => (
                <button
                  key={r}
                  className={`aspect-pill ${ratio === r ? 'active' : ''}`}
                  onClick={() => setRatio(r)}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary"
              onClick={generateImage}
              disabled={generating || !prompt.trim()}
            >
              {generating ? <><span className="spinner spinner-inline" /> Generating...</> : '\u26a1 Generate Image'}
            </button>

            {currentImage && (
              <a
                href={currentImage}
                download
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
              >
                {'\u2193'} Download
              </a>
            )}

            {ad.generated_prompt && onTemplatize && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onTemplatize(ad.id)}
              >
                Templatize &rarr;
              </button>
            )}
          </div>

          {status && (
            <span className={`action-status ${statusType}`}>{status}</span>
          )}
        </div>

        {/* Prompt editor */}
        <div className="prompt-section">
          <div className="mb-lg">
            <span className="prompt-label">Creative Direction (optional)</span>
            <input
              type="text"
              className="text-input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder='e.g. "9:16 story, coloured background, packaging flat-lay"'
            />
          </div>
          <div>
            <div className="prompt-header">
              <span className="prompt-label">Chefly Prompt</span>
              {prompt && (
                <button
                  className="btn-copy"
                  onClick={() => {
                    navigator.clipboard.writeText(prompt)
                    setStatus('Copied to clipboard.')
                    setStatusType('success')
                    setTimeout(() => setStatus(''), 2000)
                  }}
                >
                  Copy all
                </button>
              )}
            </div>
            <textarea
              className="prompt-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="No prompt generated yet. Click 'New Prompt' above to create one from this ad."
            />
          </div>
        </div>

        {/* Settings hint */}
        <FalKeySettings />
      </div>
    </div>
  )
}

function FalKeySettings() {
  const [show, setShow] = useState(false)
  const [key, setKey] = useState(localStorage.getItem('ck_fal_api_key') || '')

  function save() {
    localStorage.setItem('ck_fal_api_key', key.trim())
    setShow(false)
  }

  return (
    <div className="fal-settings-bar">
      <button
        className="btn btn-ghost btn-sm text-xs"
        onClick={() => setShow(!show)}
      >
        {show ? 'Hide settings' : 'Settings (fal.ai key)'}
      </button>
      {show && (
        <div className="flex-center gap-sm mt-sm">
          <input
            type="password"
            className="text-input text-input-sm flex-1"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="fal.ai API key"
          />
          <button className="btn btn-secondary btn-sm" onClick={save}>Save</button>
        </div>
      )}
    </div>
  )
}
