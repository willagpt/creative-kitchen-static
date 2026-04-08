import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function BrandDNA({ brands, activeBrandId, setActiveBrandId, onRefresh }) {
  const [brand, setBrand] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [newBrandName, setNewBrandName] = useState('')
  const [showNew, setShowNew] = useState(false)

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

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Brand DNA</h2>
          <p className="page-subtitle">Define once. Applied to every generation.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {brands.length > 0 && (
            <select
              className="select-input"
              value={activeBrandId || ''}
              onChange={e => setActiveBrandId(e.target.value)}
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
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="text-input"
              value={newBrandName}
              onChange={e => setNewBrandName(e.target.value)}
              placeholder="Brand name"
              onKeyDown={e => e.key === 'Enter' && createBrand()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={createBrand}>Create</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!brand && !showNew && (
        <div className="empty-state">
          <h3>No brand selected</h3>
          <p>Create a brand to define your visual DNA, packaging specs, and guidelines.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowNew(true)}>
            + Create your first brand
          </button>
        </div>
      )}

      {brand && (
        <div className="brand-form">
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
                    className="text-input text-input-sm"
                    value={c.hex || ''}
                    onChange={e => updateColour(i, 'hex', e.target.value)}
                    placeholder="#hex"
                    style={{ width: 90, fontFamily: 'monospace' }}
                  />
                  <input
                    className="text-input text-input-sm"
                    value={c.name || ''}
                    onChange={e => updateColour(i, 'name', e.target.value)}
                    placeholder="Name (e.g. Primary Orange)"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => removeColour(i)}>&times;</button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addColour} style={{ marginTop: 8 }}>
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
                <label className="field-label">Sleeve styles</label>
                <textarea
                  className="prompt-textarea"
                  value={brand.sleeve_notes || ''}
                  onChange={e => updateField('sleeve_notes', e.target.value)}
                  placeholder="e.g. Electric Green (#A8E10C) with tonal botanical leaf patterns. Deep Burgundy (#6B1D3A) with subtle warmth-gradient swirl. Each sleeve has the meal name in lowercase Syne Bold, centred..."
                  style={{ minHeight: 120 }}
                />
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
