import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

export default function BrandDNA({ brands, activeBrandId, setActiveBrandId, onRefresh }) {
  const [brand, setBrand] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [newBrandName, setNewBrandName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [sleeveMode, setSleeveMode] = useState('primary') // 'primary' or 'alt'
  const htmlInputRef = useRef()

  // Load active brand details
  useEffect(() => {
    if (!activeBrandId) { setBrand(null); return }
    const b = brands.find(b => b.id === activeBrandId)
    if (b) setBrand({ ...b })
  }, [activeBrandId, brands])

  async function saveBrand() {
    if (!brand) return
    setSaving(true)
    setStatus('')
    try {
      const { error } = await supabase
        .from('brands')
        .update({
          guidelines_text: brand.guidelines_text,
          sleeve_notes: brand.sleeve_notes,
          sleeve_notes_alt: brand.sleeve_notes_alt || null,
          colour_palette: brand.colour_palette,
          typography: brand.typography,
          tone_of_voice: brand.tone_of_voice,
          packaging_specs: brand.packaging_specs,
          logo_url: brand.logo_url,
          website_url: brand.website_url,
          updated_at: new Date().toISOString()
        })
        .eq('id', brand.id)
      if (error) throw error
      setStatus('Saved.')
      onRefresh()
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function createBrand() {
    if (!newBrandName.trim()) return
    try {
      const { data, error } = await supabase
        .from('brands')
        .insert({ name: newBrandName.trim() })
        .select()
        .single()
      if (error) throw error
      setNewBrandName('')
      setShowNew(false)
      onRefresh()
      setActiveBrandId(data.id)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  function updateField(field, value) {
    setBrand(prev => ({ ...prev, [field]: value }))
  }

  // Helper for packaging specs (structured JSON)
  function getPackaging(key) {
    const specs = brand?.packaging_specs || {}
    return specs[key] || ''
  }
  function setPackaging(key, value) {
    const specs = { ...(brand?.packaging_specs || {}), [key]: value }
    updateField('packaging_specs', specs)
  }

  // Helper for colour palette (array of {name, hex})
  function getColours() {
    return brand?.colour_palette || []
  }
  function addColour() {
    const colours = [...getColours(), { name: '', hex: '#f97316' }]
    updateField('colour_palette', colours)
  }
  function updateColour(idx, field, value) {
    const colours = [...getColours()]
    colours[idx] = { ...colours[idx], [field]: value }
    updateField('colour_palette', colours)
  }
  function removeColour(idx) {
    const colours = getColours().filter((_, i) => i !== idx)
    updateField('colour_palette', colours)
  }

  // Upload HTML brand guidelines and extract structured data
  async function handleHtmlUpload(file) {
    if (!file || !brand) return
    setExtracting(true)
    setExtractStatus('Reading file...')
    try {
      const htmlContent = await file.text()
      setExtractStatus('Sending to Claude for extraction (this takes 20 to 40 seconds)...')

      const res = await fetch(`${supabaseUrl}/functions/v1/extract-brand-guidelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          html_content: htmlContent,
          existing_guidelines: brand.guidelines_text || undefined,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')

      if (data.structured) {
        // Auto-populate all fields from the structured response
        setBrand(prev => ({
          ...prev,
          guidelines_text: data.guidelines_text || prev.guidelines_text,
          tone_of_voice: data.tone_of_voice || prev.tone_of_voice,
          colour_palette: data.colour_palette || prev.colour_palette,
          typography: data.typography || prev.typography,
          packaging_specs: data.packaging_specs || prev.packaging_specs,
          sleeve_notes: data.sleeve_notes || prev.sleeve_notes,
          sleeve_notes_alt: data.sleeve_notes_alt || prev.sleeve_notes_alt || null,
        }))
        setExtractStatus('Fields populated from guidelines. Review and save.')
        setSleeveMode('primary')
      } else {
        // Fallback: put raw text into guidelines
        setBrand(prev => ({ ...prev, guidelines_text: data.raw_text || prev.guidelines_text }))
        setExtractStatus('Extracted as text (could not structure). Pasted into Brand Guidelines.')
      }
      setTimeout(() => setExtractStatus(''), 5000)
    } catch (err) {
      console.error('HTML extraction failed:', err)
      setExtractStatus(`Error: ${err.message}`)
    } finally {
      setExtracting(false)
      if (htmlInputRef.current) htmlInputRef.current.value = ''
    }
  }

  // Sleeve mode helpers
  function getActiveSleeve() {
    return sleeveMode === 'alt' ? (brand?.sleeve_notes_alt || '') : (brand?.sleeve_notes || '')
  }
  function setActiveSleeve(value) {
    if (sleeveMode === 'alt') {
      updateField('sleeve_notes_alt', value)
    } else {
      updateField('sleeve_notes', value)
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Brand DNA</h2>
          <p className="page-subtitle">Define once. Applied to every generation.</p>
        </div>
        <div className="flex-center gap-sm">
          {brands.length > 0 && (
            <select
              className="select-input"
              value={activeBrandId || ''}
              onChange={e => setActiveBrandId(e.target.value)}
              aria-label="Select brand"
            >
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(!showNew)}>
            + New Brand
          </button>
        </div>
      </div>

      {showNew && (
        <div className="section-card mb-lg">
          <div className="flex gap-sm">
            <input
              className="text-input flex-1"
              value={newBrandName}
              onChange={e => setNewBrandName(e.target.value)}
              placeholder="Brand name"
              onKeyDown={e => e.key === 'Enter' && createBrand()}
            />
            <button className="btn btn-primary btn-sm" onClick={createBrand}>Create</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!brand && !showNew && (
        <div className="empty-state">
          <h3>No brand DNA yet</h3>
          <p>
            Your brand's colours, fonts, tone, and packaging rules live here.
            Once defined, every generated image stays on-brand automatically.
          </p>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + Create your first brand
          </button>
          <p className="empty-state-hint">
            Start with your brand name. You can fill in colours, typography,
            and packaging details at your own pace.
          </p>
        </div>
      )}

      {brand && (
        <div className="brand-form">
          {/* Upload bar */}
          <div className="section-card upload-bar">
            <div className="flex-between">
              <div>
                <h3 className="section-title">Import from Guidelines Document</h3>
                <p className="section-desc">Upload your brand guidelines HTML file. Claude will read it and populate all fields below automatically.</p>
              </div>
              <div className="flex gap-sm">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => htmlInputRef.current?.click()}
                  disabled={extracting}
                >
                  {extracting ? <><span className="spinner spinner-inline" /> Extracting...</> : 'Upload HTML'}
                </button>
                <input
                  ref={htmlInputRef}
                  type="file"
                  accept=".html,.htm"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleHtmlUpload(file)
                  }}
                />
              </div>
            </div>
            {extractStatus && (
              <p className={`text-xs mt-sm ${extractStatus.startsWith('Error') ? 'text-error' : 'text-accent'}`}>
                {extractStatus}
              </p>
            )}
          </div>

          {/* Guidelines */}
          <div className="section-card">
            <h3 className="section-title">Brand Guidelines</h3>
            <p className="section-desc">Visual identity rules, layout principles, what to always include and always avoid.</p>
            <textarea
              className="prompt-textarea"
              value={brand.guidelines_text || ''}
              onChange={e => updateField('guidelines_text', e.target.value)}
              placeholder="e.g. Always use lowercase headlines. Never use exclamation marks. Primary layout is typographic with minimal photography. Warm cream backgrounds (#FFF6EE). Heavy black sans-serif for headlines (Syne Extra Bold). Serif italic for accent text (Instrument Serif)..."
              style={{ minHeight: 180 }}
            />
          </div>

          {/* Colour Palette */}
          <div className="section-card">
            <h3 className="section-title">Colour Palette</h3>
            <p className="section-desc">Hex codes with names. These get injected into every prompt.</p>
            <div className="colour-grid">
              {getColours().map((c, i) => (
                <div key={i} className="colour-swatch-row">
                  <input
                    type="color"
                    value={c.hex || '#000000'}
                    onChange={e => updateColour(i, 'hex', e.target.value)}
                    className="colour-picker"
                  />
                  <input
                    className="text-input text-input-sm tabular-nums"
                    value={c.hex || ''}
                    onChange={e => updateColour(i, 'hex', e.target.value)}
                    placeholder="#hex"
                    style={{ width: 90 }}
                  />
                  <input
                    className="text-input text-input-sm flex-1"
                    value={c.name || ''}
                    onChange={e => updateColour(i, 'name', e.target.value)}
                    placeholder="Name (e.g. Primary Orange)"
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => removeColour(i)}>&times;</button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm mt-sm" onClick={addColour}>
              + Add colour
            </button>
          </div>

          {/* Typography */}
          <div className="section-card">
            <h3 className="section-title">Typography</h3>
            <p className="section-desc">Font references for headlines, body, and accent text.</p>
            <div className="form-grid-2">
              <div>
                <label className="field-label">Headline font</label>
                <input
                  className="text-input"
                  value={brand.typography?.headline || ''}
                  onChange={e => updateField('typography', { ...brand.typography, headline: e.target.value })}
                  placeholder="e.g. Syne Extra Bold"
                />
              </div>
              <div>
                <label className="field-label">Body font</label>
                <input
                  className="text-input"
                  value={brand.typography?.body || ''}
                  onChange={e => updateField('typography', { ...brand.typography, body: e.target.value })}
                  placeholder="e.g. Inter Regular"
                />
              </div>
              <div>
                <label className="field-label">Accent font</label>
                <input
                  className="text-input"
                  value={brand.typography?.accent || ''}
                  onChange={e => updateField('typography', { ...brand.typography, accent: e.target.value })}
                  placeholder="e.g. Instrument Serif Italic"
                />
              </div>
              <div>
                <label className="field-label">CTA font</label>
                <input
                  className="text-input"
                  value={brand.typography?.cta || ''}
                  onChange={e => updateField('typography', { ...brand.typography, cta: e.target.value })}
                  placeholder="e.g. Syne Bold"
                />
              </div>
            </div>
          </div>

          {/* Tone of Voice */}
          <div className="section-card">
            <h3 className="section-title">Tone of Voice</h3>
            <p className="section-desc">How the brand speaks. Gets injected into the emotional tone section of every prompt.</p>
            <textarea
              className="prompt-textarea"
              value={brand.tone_of_voice || ''}
              onChange={e => updateField('tone_of_voice', e.target.value)}
              placeholder="e.g. Calm, confident, factual. Never aggressive or salesy. Honest questions over bold claims. No emojis, no exclamation marks, no uppercase anywhere."
              style={{ minHeight: 100 }}
            />
          </div>

          {/* Packaging */}
          <div className="section-card">
            <h3 className="section-title">Packaging Specs</h3>
            <p className="section-desc">Sleeve styles, tray forms, and packaging details for product shots.</p>
            <div className="form-stack">
              <div>
                <div className="flex-between mb-sm">
                  <label className="field-label" style={{ margin: 0 }}>Sleeve design</label>
                  <div className="sleeve-toggle">
                    <button
                      className={`sleeve-toggle-btn ${sleeveMode === 'primary' ? 'active' : ''}`}
                      onClick={() => setSleeveMode('primary')}
                    >
                      New design
                    </button>
                    <button
                      className={`sleeve-toggle-btn ${sleeveMode === 'alt' ? 'active' : ''}`}
                      onClick={() => setSleeveMode('alt')}
                    >
                      Existing design
                    </button>
                  </div>
                </div>
                <textarea
                  className="prompt-textarea"
                  value={getActiveSleeve()}
                  onChange={e => setActiveSleeve(e.target.value)}
                  placeholder={sleeveMode === 'alt'
                    ? 'Describe the existing/legacy sleeve design here...'
                    : 'Describe the new sleeve design here...'}
                  style={{ minHeight: 120 }}
                />
                <p className="text-xs text-muted mt-sm">
                  {sleeveMode === 'primary'
                    ? 'This is the active sleeve design used in prompt generation.'
                    : 'This is stored as a reference. Switch to "New design" to make it active in prompts.'}
                </p>
              </div>
              <div>
                <label className="field-label">Tray form</label>
                <textarea
                  className="prompt-textarea"
                  value={getPackaging('tray') || ''}
                  onChange={e => setPackaging('tray', e.target.value)}
                  placeholder="e.g. Black matte rectangular tray, 250mm x 180mm, rounded corners, 35mm depth. Visible contents through clear film lid..."
                  style={{ minHeight: 100 }}
                />
              </div>
              <div>
                <label className="field-label">Other packaging notes</label>
                <textarea
                  className="prompt-textarea"
                  value={getPackaging('notes') || ''}
                  onChange={e => setPackaging('notes', e.target.value)}
                  placeholder="e.g. Outer box is kraft brown with brand sticker. Ice packs visible in delivery shots. Unboxing should feel premium..."
                  style={{ minHeight: 80 }}
                />
              </div>
            </div>
          </div>

          {/* Website + Logo */}
          <div className="section-card">
            <h3 className="section-title">Brand Assets</h3>
            <div className="form-grid-2">
              <div>
                <label className="field-label">Website URL</label>
                <input
                  className="text-input"
                  value={brand.website_url || ''}
                  onChange={e => updateField('website_url', e.target.value)}
                  placeholder="https://chefly.co.uk"
                />
              </div>
              <div>
                <label className="field-label">Logo URL</label>
                <input
                  className="text-input"
                  value={brand.logo_url || ''}
                  onChange={e => updateField('logo_url', e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>

          {/* Save bar */}
          <div className="save-bar">
            <button
              className="btn btn-primary"
              onClick={saveBrand}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Brand DNA'}
            </button>
            {status && (
              <span className={`action-status ${status.startsWith('Error') ? 'error' : 'success'}`}>
                {status}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
