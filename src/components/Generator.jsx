import { useState, useEffect } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

export default function Generator({ ads, versions, brands, activeBrandId }) {
  // Template selection
  const [templates, setTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [templateText, setTemplateText] = useState('')
  const [placeholders, setPlaceholders] = useState({})

  // Source ad (for templatizing)
  const [sourceAdId, setSourceAdId] = useState(null)

  // Photo selection
  const [photos, setPhotos] = useState([])
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([])

  // Variables
  const [variables, setVariables] = useState({})
  const [ratios, setRatios] = useState(['4:5'])

  // fal.ai API key
  const [falKey, setFalKey] = useState(() => localStorage.getItem('ck_fal_api_key') || '')
  const [showKeyInput, setShowKeyInput] = useState(false)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [status, setStatus] = useState('')
  const [results, setResults] = useState([])

  // Check if a generator ad was pre-selected (from Gallery "Templatize" action)
  useEffect(() => {
    if (window.__ckGeneratorAdId) {
      setSourceAdId(window.__ckGeneratorAdId)
      window.__ckGeneratorAdId = null
    }
  }, [])

  // Load templates
  useEffect(() => {
    async function load() {
      let query = supabase.from('prompt_templates').select('*').order('created_at', { ascending: false })
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data } = await query
      setTemplates(data || [])
    }
    load()
  }, [activeBrandId])

  // Load photos (approved only)
  useEffect(() => {
    async function load() {
      let query = supabase.from('photo_library').select('*').eq('approved', true).order('star_rating', { ascending: false })
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data } = await query
      setPhotos(data || [])
    }
    load()
  }, [activeBrandId])

  // When template changes, load its data
  useEffect(() => {
    const tmpl = templates.find(t => t.id === selectedTemplateId)
    if (tmpl) {
      setTemplateText(tmpl.template_text)
      setPlaceholders(tmpl.placeholders || {})
      // Initialize variables from placeholders
      const vars = {}
      const phKeys = Object.keys(tmpl.placeholders || {})
      phKeys.forEach(k => { vars[k] = tmpl.placeholders[k] || '' })
      setVariables(vars)
    }
  }, [selectedTemplateId])

  // Templatize from a source ad's prompt
  async function templatizeFromAd() {
    const ad = ads.find(a => a.id === sourceAdId)
    if (!ad?.generated_prompt) {
      setStatus('Selected ad has no prompt. Generate a prompt first.')
      return
    }
    setStatus('Templatizing prompt...')
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/templatize-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ prompt: ad.generated_prompt })
      })
      const data = await res.json()
      if (!res.ok || !data.template) throw new Error(data.error || 'No template returned')

      setTemplateText(data.template)
      setPlaceholders(data.placeholders || {})

      // Initialize variables from extracted placeholders
      const vars = {}
      Object.entries(data.placeholders || {}).forEach(([k, v]) => { vars[k] = v })
      setVariables(vars)

      // Save as a new template
      const templateName = `${ad.advertiser_name || 'Ad'} style - ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      const { data: saved } = await supabase.from('prompt_templates').insert({
        name: templateName,
        template_text: data.template,
        placeholders: data.placeholders,
        source_ad_id: ad.id,
        brand_id: activeBrandId || null,
      }).select().single()

      if (saved) {
        setTemplates(prev => [saved, ...prev])
        setSelectedTemplateId(saved.id)
      }
      setStatus('Template created and saved.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  // Auto-generate variables from brand + photos via Edge Function
  async function autoGenerateVariables() {
    const brand = brands.find(b => b.id === activeBrandId)
    const selectedPhotos = photos.filter(p => selectedPhotoIds.includes(p.id))
    const mealNames = selectedPhotos.map(p => p.name)

    setStatus('Generating variables with AI...')
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({
          meal_names: mealNames,
          original_placeholders: placeholders,
          brand_guidelines: brand?.guidelines_text || '',
          sleeve_notes: brand?.sleeve_notes || '',
          reference_images: selectedPhotos.map(p => ({
            name: p.name,
            description: p.description || '',
            prompt_snippet: p.prompt_snippet || '',
          }))
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')

      // Merge generated variables
      if (data.variables?.meals) {
        const newVars = { ...variables }
        const meals = data.variables.meals
        // Build multi-line values for batch
        Object.keys(placeholders).forEach(key => {
          const values = meals.map(m => m[key]).filter(Boolean)
          if (values.length) newVars[key] = values.join('\n')
        })
        setVariables(newVars)
      }
      setStatus('Variables generated.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  // Calculate combinations
  function getCombinations() {
    const lists = {}
    Object.entries(variables).forEach(([key, val]) => {
      if (key === 'MEAL_DESCRIPTION') {
        // Split by double newline for paragraph entries
        lists[key] = val.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
      } else {
        lists[key] = val.split('\n').map(s => s.trim()).filter(Boolean)
      }
    })

    // Cross-product
    const keys = Object.keys(lists).filter(k => lists[k].length > 0)
    if (keys.length === 0) return []

    let combos = [{}]
    for (const key of keys) {
      const newCombos = []
      for (const combo of combos) {
        for (const value of lists[key]) {
          newCombos.push({ ...combo, [key]: value })
        }
      }
      combos = newCombos
    }
    return combos
  }

  const combinations = getCombinations()
  const totalImages = combinations.length * ratios.length

  // Run batch generation
  async function runGeneration() {
    if (!templateText.trim() || totalImages === 0) return

    if (!falKey) {
      setShowKeyInput(true)
      setStatus('Enter your fal.ai API key above to start generating.')
      return
    }

    setGenerating(true)
    setProgress({ done: 0, total: totalImages })
    setResults([])

    // Create a generation run
    const { data: run } = await supabase.from('generation_runs').insert({
      name: `Run ${new Date().toLocaleDateString('en-GB')}`,
      template_id: selectedTemplateId,
      brand_id: activeBrandId,
      status: 'running',
      total_combinations: totalImages,
      settings: { ratios, variables }
    }).select().single()

    const runId = run?.id
    let done = 0
    let failed = 0
    const allResults = []

    // Build job queue
    const jobs = []
    for (const combo of combinations) {
      for (const ratio of ratios) {
        let prompt = templateText
        Object.entries(combo).forEach(([key, value]) => {
          prompt = prompt.replaceAll(`{{${key}}}`, value)
        })
        jobs.push({ prompt, ratio, combo })
      }
    }

    // Process with concurrency of 2
    const queue = [...jobs]
    const workers = Array(2).fill(null).map(async () => {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) break
        try {
          const headers = { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' }
          const payload = { prompt: job.prompt, num_images: 1, aspect_ratio: job.ratio, enable_safety_checker: false }

          const submitRes = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2`, {
            method: 'POST', headers, body: JSON.stringify(payload)
          })
          const submitData = await submitRes.json()
          if (!submitData.request_id) throw new Error('No request_id')

          // Poll
          let imageUrl = null
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1500))
            const statusRes = await fetch(
              `https://queue.fal.run/fal-ai/nano-banana-2/requests/${submitData.request_id}/status`,
              { headers }
            )
            const statusData = await statusRes.json()
            if (statusData.status === 'COMPLETED') break
            if (statusData.status === 'FAILED') throw new Error('Generation failed')
          }

          const resultRes = await fetch(
            `https://queue.fal.run/fal-ai/nano-banana-2/requests/${submitData.request_id}`,
            { headers }
          )
          const resultData = await resultRes.json()
          imageUrl = resultData?.images?.[0]?.url || resultData?.image?.url
          if (!imageUrl) throw new Error('No image in result')

          // Save to gen_images
          const { data: saved } = await supabase.from('gen_images').insert({
            run_id: runId,
            template_id: selectedTemplateId,
            source_ad_id: sourceAdId,
            prompt_used: job.prompt,
            image_url: imageUrl,
            aspect_ratio: job.ratio,
            variables_used: job.combo,
            status: 'complete'
          }).select().single()

          allResults.push({ ...saved, image_url: imageUrl, variables_used: job.combo, aspect_ratio: job.ratio })
          done++
        } catch (err) {
          console.error('Generation error:', err)
          failed++
          done++
          await supabase.from('gen_images').insert({
            run_id: runId,
            template_id: selectedTemplateId,
            prompt_used: job.prompt,
            aspect_ratio: job.ratio,
            variables_used: job.combo,
            status: 'failed',
            error_message: err.message
          })
        }
        setProgress({ done, total: totalImages })
        setResults([...allResults])
      }
    })

    await Promise.all(workers)

    // Update run status
    if (runId) {
      await supabase.from('generation_runs').update({
        status: 'complete',
        completed_count: done - failed,
        failed_count: failed,
        completed_at: new Date().toISOString()
      }).eq('id', runId)
    }

    setGenerating(false)
    setStatus(`Done: ${done - failed} images generated, ${failed} failed.`)
  }

  // Ads that have prompts (for templatizing)
  const adsWithPrompts = ads.filter(a => a.generated_prompt)

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Generator</h2>
          <p className="page-subtitle">Select a template, pick photos, set variables, batch generate.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {falKey && !showKeyInput && (
            <span
              style={{ fontSize: 11, color: 'var(--text-2)', cursor: 'pointer' }}
              onClick={() => setShowKeyInput(true)}
              title="Click to change API key"
            >
              fal.ai key: ****{falKey.slice(-4)}
            </span>
          )}
          {(!falKey || showKeyInput) && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="password"
                className="text-input"
                placeholder="fal.ai API key"
                value={falKey}
                onChange={e => setFalKey(e.target.value)}
                style={{ width: 220, fontSize: 12 }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  localStorage.setItem('ck_fal_api_key', falKey)
                  setShowKeyInput(false)
                  setStatus(falKey ? 'API key saved.' : '')
                }}
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="generator-layout">
        {/* Left: Template + Variables */}
        <div className="generator-main">

          {/* Step 1: Source ad or existing template */}
          <div className="section-card section-card-orange">
            <h3 className="section-title">1. Choose a template</h3>
            <p className="section-desc">Pick an existing template or create one from a saved ad.</p>

            {templates.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label className="field-label">Existing templates</label>
                <select
                  className="select-input"
                  value={selectedTemplateId || ''}
                  onChange={e => setSelectedTemplateId(e.target.value || null)}
                >
                  <option value="">Select a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.is_winner ? '(winner)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Or templatize from a saved ad</label>
                <select
                  className="select-input"
                  value={sourceAdId || ''}
                  onChange={e => setSourceAdId(e.target.value || null)}
                >
                  <option value="">Select a saved ad...</option>
                  {adsWithPrompts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.advertiser_name} - {a.ad_copy?.slice(0, 40)}...
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-secondary"
                onClick={templatizeFromAd}
                disabled={!sourceAdId}
              >
                Templatize
              </button>
            </div>
          </div>

          {/* Template text */}
          {templateText && (
            <>
              <div className="section-card">
                <h3 className="section-title">Template</h3>
                <textarea
                  className="prompt-textarea"
                  value={templateText}
                  onChange={e => setTemplateText(e.target.value)}
                  style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>

              {/* Step 2: Variables */}
              <div className="section-card section-card-blue">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <h3 className="section-title">2. Set variables</h3>
                    <p className="section-desc">One value per line. All combinations will be generated.</p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={autoGenerateVariables}
                    disabled={selectedPhotoIds.length === 0}
                  >
                    Auto-generate from photos
                  </button>
                </div>

                <div className="variables-grid">
                  {Object.keys(placeholders).map(key => (
                    <div key={key} className={key === 'MEAL_DESCRIPTION' ? 'variable-field full-width' : 'variable-field'}>
                      <label className="field-label">{`{{${key}}}`}</label>
                      <textarea
                        className="prompt-textarea"
                        value={variables[key] || ''}
                        onChange={e => setVariables(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={key === 'MEAL_DESCRIPTION' ? 'Separate entries with a blank line' : 'One value per line'}
                        style={{ minHeight: key === 'MEAL_DESCRIPTION' ? 120 : 80 }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 3: Ratios + generate */}
              <div className="section-card section-card-green">
                <h3 className="section-title">3. Generate</h3>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                  <div className="aspect-pills">
                    {['4:5', '9:16'].map(r => (
                      <button
                        key={r}
                        className={`aspect-pill ${ratios.includes(r) ? 'active' : ''}`}
                        onClick={() => {
                          setRatios(prev =>
                            prev.includes(r)
                              ? prev.filter(x => x !== r)
                              : [...prev, r]
                          )
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
                    {combinations.length} combinations x {ratios.length} ratio{ratios.length > 1 ? 's' : ''} = <strong>{totalImages} images</strong>
                  </span>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={runGeneration}
                  disabled={generating || totalImages === 0}
                  style={{ width: '100%' }}
                >
                  {generating
                    ? `Generating... ${progress.done}/${progress.total}`
                    : `Generate ${totalImages} images`
                  }
                </button>

                {generating && (
                  <div className="progress-bar" style={{ marginTop: 8 }}>
                    <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                )}

                {status && <p style={{ fontSize: 12, color: 'var(--text-1)', marginTop: 8 }}>{status}</p>}
              </div>
            </>
          )}

          {/* Results grid */}
          {results.length > 0 && (
            <div className="section-card">
              <h3 className="section-title">Results ({results.length})</h3>
              <div className="results-grid">
                {results.map((r, i) => (
                  <div key={r.id || i} className="result-card">
                    <div className="result-image">
                      <img src={r.image_url} alt="" loading="lazy" />
                      <span className="result-ratio">{r.aspect_ratio}</span>
                    </div>
                    <div className="result-meta">
                      {r.variables_used?.MEAL_NAME && (
                        <span className="result-meal">{r.variables_used.MEAL_NAME}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Photo picker */}
        <div className="generator-sidebar">
          <div className="section-card">
            <h3 className="section-title">Reference Photos</h3>
            <p className="section-desc">Select photos for variable generation.</p>
            {photos.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-2)', padding: 12 }}>
                No approved photos. Go to Photo Library to upload and approve photos.
              </p>
            ) : (
              <div className="photo-picker-grid">
                {photos.map(p => (
                  <div
                    key={p.id}
                    className={`photo-picker-item ${selectedPhotoIds.includes(p.id) ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedPhotoIds(prev =>
                        prev.includes(p.id)
                          ? prev.filter(x => x !== p.id)
                          : [...prev, p.id]
                      )
                    }}
                  >
                    <img src={p.thumbnail_url || p.storage_url} alt={p.name} />
                    {selectedPhotoIds.includes(p.id) && (
                      <div className="photo-picker-check">&#10003;</div>
                    )}
                    <span className="photo-picker-name">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedPhotoIds.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>
                {selectedPhotoIds.length} photo{selectedPhotoIds.length > 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
