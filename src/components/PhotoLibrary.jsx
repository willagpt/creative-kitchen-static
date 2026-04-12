import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

const PACKAGING_MODES = [
  { value: 'tray', label: 'Tray' },
  { value: 'plated', label: 'Plate' },
  { value: 'tray_with_sleeve', label: 'Tray + Sleeve' },
]

export default function PhotoLibrary({ brands, activeBrandId }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [describing, setDescribing] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef()
  const dropRef = useRef()

  // Shot sequence state
  const [sequenceMode, setSequenceMode] = useState(false)
  const [sequenceRef, setSequenceRef] = useState(null)
  const [sequenceShots, setSequenceShots] = useState([])
  const [sequenceGenerating, setSequenceGenerating] = useState(false)
  const [sequenceError, setSequenceError] = useState('')

  async function loadPhotos() {
    setLoading(true)
    try {
      let query = supabase.from('photo_library').select('*').order('created_at', { ascending: false })
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data, error } = await query
      if (error) throw error
      setPhotos(data || [])
    } catch (err) {
      console.error('Failed to load photos:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPhotos() }, [activeBrandId])

  const filteredPhotos = photos.filter(p => {
    if (filter === 'all') return true
    if (filter === 'approved') return p.approved
    if (filter === 'described') return !!p.description
    if (filter === 'undescribed') return !p.description
    return p.type === filter
  })

  const typeCount = (type) => photos.filter(p => p.type === type).length

  // Upload photos via drag-drop or file picker
  async function handleFiles(files) {
    setUploading(true)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const filePath = `photos/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('reference-images')
          .upload(filePath, file, { contentType: file.type })

        let storageUrl = ''
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('reference-images').getPublicUrl(filePath)
          storageUrl = urlData?.publicUrl || ''
        }

        const dims = await getImageDimensions(file)

        const { error } = await supabase.from('photo_library').insert({
          name: file.name.replace(/\.[^.]+$/, ''),
          storage_url: storageUrl,
          thumbnail_url: storageUrl,
          brand_id: activeBrandId || null,
          width: dims.width,
          height: dims.height,
          aspect_ratio: dims.width > dims.height ? 'landscape' : dims.width < dims.height ? 'portrait' : 'square',
        })
        if (error) console.error('Insert error:', error)
      } catch (err) {
        console.error('Upload failed:', err)
      }
    }
    setUploading(false)
    loadPhotos()
  }

  function getImageDimensions(file) {
    return new Promise(resolve => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => { URL.revokeObjectURL(objectUrl); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve({ width: 0, height: 0 }) }
      img.src = objectUrl
    })
  }

  async function addDriveUrl(url) {
    if (!url.trim()) return
    try {
      await supabase.from('photo_library').insert({
        name: 'Drive photo',
        drive_url: url.trim(),
        thumbnail_url: url.trim(),
        brand_id: activeBrandId || null,
      })
      loadPhotos()
    } catch (err) {
      console.error('Failed to add drive URL:', err)
    }
  }

  async function deletePhoto(photo) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    try {
      if (photo.storage_url && photo.storage_url.includes('reference-images')) {
        const match = photo.storage_url.match(/reference-images\/(.+)$/)
        if (match) {
          await supabase.storage.from('reference-images').remove([decodeURIComponent(match[1])])
        }
      }
      await supabase.from('photo_library').delete().eq('id', photo.id)
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      setSelectedPhoto(null)
      if (sequenceRef?.id === photo.id) setSequenceRef(null)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  async function describePhoto(photo) {
    setDescribing(photo.id)
    try {
      const imageUrl = photo.storage_url || photo.drive_url || photo.thumbnail_url
      if (!imageUrl) throw new Error('No image URL')

      const res = await fetch(`${supabaseUrl}/functions/v1/describe-photo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({ photo_id: photo.id, image_url: imageUrl })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')

      setPhotos(prev => prev.map(p =>
        p.id === photo.id
          ? { ...p, description: data.description, prompt_snippet: data.prompt_snippet }
          : p
      ))
      if (selectedPhoto?.id === photo.id) {
        setSelectedPhoto(prev => ({ ...prev, description: data.description, prompt_snippet: data.prompt_snippet }))
      }
    } catch (err) {
      console.error('Describe failed:', err)
    } finally {
      setDescribing(null)
    }
  }

  async function describeAll() {
    const undescribed = photos.filter(p => !p.description)
    for (const photo of undescribed) {
      await describePhoto(photo)
    }
  }

  async function updatePhoto(id, updates) {
    await supabase.from('photo_library').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
    if (selectedPhoto?.id === id) setSelectedPhoto(prev => ({ ...prev, ...updates }))
  }

  // Generate 5-shot sequence from a reference photo
  async function generateSequence() {
    if (!sequenceRef || !activeBrandId) return
    setSequenceGenerating(true)
    setSequenceError('')
    setSequenceShots([])
    try {
      const activeBrand = brands?.find(b => b.id === activeBrandId)
      if (!activeBrand) throw new Error('No brand selected')

      const activeSleeveMode = activeBrand.active_sleeve || 'primary'
      const sleeveNotes = activeSleeveMode === 'alt'
        ? (activeBrand.sleeve_notes_alt || activeBrand.sleeve_notes || '')
        : (activeBrand.sleeve_notes || '')

      const brandContext = {
        brand_name: activeBrand.name,
        brand_guidelines: activeBrand.guidelines_text || '',
        tone_of_voice: activeBrand.tone_of_voice || '',
        sleeve_notes: sleeveNotes,
        colour_palette: activeBrand.colour_palette || [],
        typography: activeBrand.typography || {},
        packaging_specs: activeBrand.packaging_specs || {},
        packaging_mode: activeBrand.packaging_mode || 'tray',
      }

      const imageUrl = sequenceRef.storage_url || sequenceRef.drive_url || sequenceRef.thumbnail_url
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-shot-sequence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          image_url: imageUrl,
          meal_name: sequenceRef.meal_name || sequenceRef.name || 'meal',
          photo_description: sequenceRef.description || sequenceRef.prompt_snippet || '',
          ...brandContext,
        })
      })
      const data = await res.json()
      if (!res.ok || !data.shots) throw new Error(data.error || 'No shots returned')

      const defaultMode = activeBrand.packaging_mode || 'tray'
      setSequenceShots(data.shots.map(s => ({
        ...s,
        packagingMode: defaultMode,
      })))
    } catch (err) {
      console.error('Shot sequence failed:', err)
      setSequenceError(`Failed: ${err.message}`)
    } finally {
      setSequenceGenerating(false)
    }
  }

  // Drag and drop handlers
  function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over') }
  function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over') }
  function handleDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (selectedPhoto) setSelectedPhoto(null)
        else if (sequenceMode && !sequenceGenerating) {
          setSequenceMode(false)
          setSequenceRef(null)
          setSequenceShots([])
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selectedPhoto, sequenceMode, sequenceGenerating])

  const types = ['product', 'lifestyle', 'ingredients', 'packaging', 'texture', 'mood']
  const undescribedCount = photos.filter(p => !p.description).length

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Photo Library</h2>
          <p className="page-subtitle">{photos.length} photos {undescribedCount > 0 && `(${undescribedCount} need descriptions)`}</p>
        </div>
        <div className="flex gap-sm">
          {undescribedCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={describeAll} disabled={!!describing}>
              Describe all ({undescribedCount})
            </button>
          )}
          <button
            className={`btn btn-sm ${sequenceMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setSequenceMode(!sequenceMode)
              if (sequenceMode) { setSequenceRef(null); setSequenceShots([]); setSequenceError('') }
            }}
          >
            {sequenceMode ? 'Close Sequence' : 'Shot Sequence'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
            + Upload Photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="mb-lg">
        <div className="filters">
          <button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All ({photos.length})
          </button>
          <button className={`filter-pill ${filter === 'approved' ? 'active' : ''}`} onClick={() => setFilter('approved')}>
            Approved
          </button>
          <button className={`filter-pill ${filter === 'described' ? 'active' : ''}`} onClick={() => setFilter('described')}>
            Described
          </button>
          <button className={`filter-pill ${filter === 'undescribed' ? 'active' : ''}`} onClick={() => setFilter('undescribed')}>
            Needs Description
          </button>
          {types.map(t => (
            typeCount(t) > 0 && (
              <button key={t} className={`filter-pill ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
                {t} ({typeCount(t)})
              </button>
            )
          ))}
        </div>
      </div>

      {/* SHOT SEQUENCE MODE */}
      {sequenceMode && (
        <div className="section-card" style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 className="section-title">Shot Sequence Generator</h3>
          <p className="section-desc" style={{ marginBottom: 'var(--space-md)' }}>
            Select a plated reference image, then Opus 4.6 will generate a 5-shot sequence adapted to your brand packaging.
          </p>

          {!sequenceRef ? (
            <div>
              <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)' }}>Select a reference photo:</p>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                gap: 'var(--space-sm)', maxHeight: 300, overflowY: 'auto',
                padding: 'var(--space-sm)', background: 'var(--bg-1)', borderRadius: 8,
              }}>
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    onClick={() => setSequenceRef(photo)}
                    style={{
                      cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
                      border: '2px solid var(--border)', transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <img
                      src={photo.thumbnail_url || photo.storage_url || photo.drive_url}
                      alt={photo.name}
                      style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                    <div style={{ padding: '3px 6px', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {photo.meal_name || photo.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <img
                  src={sequenceRef.thumbnail_url || sequenceRef.storage_url || sequenceRef.drive_url}
                  alt=""
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--accent)' }}
                />
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>{sequenceRef.meal_name || sequenceRef.name}</p>
                  <p className="text-xs text-muted">{sequenceRef.description ? 'Has description' : 'No description'}</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setSequenceRef(null); setSequenceShots([]) }}>Change</button>
              </div>

              {sequenceShots.length === 0 && !sequenceGenerating && (
                <button
                  className="btn btn-primary"
                  onClick={generateSequence}
                  disabled={!activeBrandId}
                >
                  Generate 5-Shot Sequence
                </button>
              )}

              {sequenceGenerating && (
                <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                  <span className="spinner" style={{ display: 'inline-block', marginBottom: 'var(--space-sm)' }} />
                  <p className="text-sm text-muted">Opus 4.6 is analysing your reference image and writing 5 shot prompts...</p>
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>This usually takes 30 to 60 seconds.</p>
                </div>
              )}

              {sequenceError && (
                <div style={{
                  padding: 'var(--space-md)', marginTop: 'var(--space-md)',
                  background: 'rgba(255,80,80,0.1)', borderRadius: 8, border: '1px solid rgba(255,80,80,0.3)',
                }}>
                  <p className="text-sm" style={{ color: '#ff5050' }}>{sequenceError}</p>
                </div>
              )}

              {sequenceShots.length > 0 && (
                <div style={{ marginTop: 'var(--space-lg)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Shot Sequence ({sequenceShots.length} shots)</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSequenceShots([]); generateSequence() }}>
                      Regenerate All
                    </button>
                  </div>
                  {sequenceShots.map((shot, i) => (
                    <div key={i} style={{
                      background: 'var(--bg-1)', borderRadius: 8, border: '1px solid var(--border)',
                      padding: 'var(--space-md)', marginBottom: 'var(--space-md)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                          Shot {i + 1} \u2014 {shot.title}
                        </span>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {PACKAGING_MODES.map(mode => (
                            <button
                              key={mode.value}
                              style={{
                                padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer', border: 'none',
                                background: shot.packagingMode === mode.value ? 'var(--accent)' : 'var(--bg-3)',
                                color: shot.packagingMode === mode.value ? 'var(--bg-0)' : 'var(--text-muted)',
                                transition: 'all 0.15s ease',
                              }}
                              onClick={() => setSequenceShots(prev => prev.map((s, j) => j === i ? { ...s, packagingMode: mode.value } : s))}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        className="prompt-textarea"
                        value={shot.prompt}
                        onChange={e => setSequenceShots(prev => prev.map((s, j) => j === i ? { ...s, prompt: e.target.value } : s))}
                        style={{ minHeight: 200, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.7 }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-xs)' }}>
                        <span className="text-xs text-muted">
                          {shot.prompt.length.toLocaleString()} chars \u00b7 {shot.prompt.split(/\s+/).length.toLocaleString()} words
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigator.clipboard.writeText(shot.prompt)}
                        >
                          Copy Prompt
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Drop zone */}
      {photos.length === 0 && !loading && !sequenceMode && (
        <div
          ref={dropRef}
          className="dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="dropzone-content">
            <p style={{ fontSize: 32, marginBottom: 8 }}>&#128247;</p>
            <h3>Your ingredients start here</h3>
            <p>Drop product shots, lifestyle photos, or hero images. Click to browse.</p>
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 8, color: 'var(--text-2)' }}>Claude Vision will auto-describe each photo so your prompts know what they're working with.</p>
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--text-2)' }}>Best results: clean backgrounds, good lighting, multiple angles per meal.</p>
          </div>
        </div>
      )}

      {uploading && (
        <div className="text-center text-subtle" style={{ padding: 'var(--space-md)' }}>
          <span className="spinner spinner-inline" style={{ marginRight: 8 }} /> Uploading...
        </div>
      )}

      {/* Photo grid (hidden when sequence mode has a ref selected) */}
      {filteredPhotos.length > 0 && !(sequenceMode && sequenceRef) && (
        <div className="photo-grid">
          <div
            className="photo-card photo-card-add"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <span style={{ fontSize: 'var(--text-xl)', color: 'var(--text-2)' }}>+</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-2)' }}>Add photos</span>
          </div>

          {filteredPhotos.map(photo => (
            <div
              key={photo.id}
              className={`photo-card ${selectedPhoto?.id === photo.id ? 'selected' : ''}`}
              onClick={() => setSelectedPhoto(selectedPhoto?.id === photo.id ? null : photo)}
            >
              <div className="photo-card-image">
                <img
                  src={photo.thumbnail_url || photo.storage_url || photo.drive_url}
                  alt={photo.name}
                  loading="lazy"
                />
                {photo.approved && <span className="photo-badge approved">&#10003;</span>}
                {!photo.description && <span className="photo-badge needs-desc">?</span>}
              </div>
              <div className="photo-card-body">
                <span className="photo-card-name">{photo.meal_name || photo.name}</span>
                <span className={`photo-card-type photo-type-${photo.type || 'product'}`}>{photo.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedPhoto && (
        <div className="photo-detail-panel" role="dialog" aria-modal="false" aria-label="Photo detail">
          <div className="photo-detail-header">
            <h3>{selectedPhoto.name}</h3>
            <button className="detail-close" onClick={() => setSelectedPhoto(null)} aria-label="Close photo detail">&times;</button>
          </div>

          <div className="photo-detail-body">
            <div className="photo-detail-preview">
              <img src={selectedPhoto.storage_url || selectedPhoto.drive_url || selectedPhoto.thumbnail_url} alt="" />
            </div>

            <div className="photo-detail-fields">
              <label className="field-label">Type</label>
              <select
                className="select-input"
                value={selectedPhoto.type || 'product'}
                onChange={e => updatePhoto(selectedPhoto.id, { type: e.target.value })}
              >
                {types.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="other">other</option>
              </select>

              <label className="field-label mt-md">Meal Name</label>
              <input
                type="text"
                className="text-input"
                value={selectedPhoto.meal_name || ''}
                onChange={e => setSelectedPhoto(prev => ({ ...prev, meal_name: e.target.value }))}
                onBlur={e => updatePhoto(selectedPhoto.id, { meal_name: e.target.value })}
                placeholder="e.g. Thai Green Curry, Beef Bourguignon"
              />

              <label className="field-label mt-md">Star Rating</label>
              <div className="star-rating">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    className={`star-btn ${(selectedPhoto.star_rating || 0) >= n ? 'active' : ''}`}
                    onClick={() => updatePhoto(selectedPhoto.id, { star_rating: n })}
                  >
                    &#9733;
                  </button>
                ))}
              </div>

              <label className="field-label mt-md">Approved</label>
              <button
                className={`btn btn-sm ${selectedPhoto.approved ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updatePhoto(selectedPhoto.id, { approved: !selectedPhoto.approved })}
              >
                {selectedPhoto.approved ? 'Approved' : 'Mark as Approved'}
              </button>

              <label className="field-label mt-lg">AI Description</label>
              <textarea
                className="prompt-textarea"
                value={selectedPhoto.description || ''}
                onChange={e => setSelectedPhoto(prev => ({ ...prev, description: e.target.value }))}
                onBlur={e => updatePhoto(selectedPhoto.id, { description: e.target.value })}
                placeholder="Auto-generated by Claude Vision, or write manually."
                style={{ minHeight: 120 }}
              />
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 4 }}
                onClick={() => describePhoto(selectedPhoto)}
                disabled={describing === selectedPhoto.id}
              >
                {describing === selectedPhoto.id ? 'Describing...' : 'Describe with Claude Vision'}
              </button>

              <label className="field-label mt-lg">Prompt Snippet</label>
              <textarea
                className="prompt-textarea"
                value={selectedPhoto.prompt_snippet || ''}
                onChange={e => setSelectedPhoto(prev => ({ ...prev, prompt_snippet: e.target.value }))}
                onBlur={e => updatePhoto(selectedPhoto.id, { prompt_snippet: e.target.value })}
                placeholder="A reusable text snippet describing this photo for injection into prompts."
                style={{ minHeight: 80 }}
              />

              <button
                className="btn btn-sm"
                style={{
                  marginTop: 'var(--space-lg)',
                  color: '#ff5050',
                  border: '1px solid rgba(255,80,80,0.3)',
                  background: 'rgba(255,80,80,0.08)',
                }}
                onClick={() => deletePhoto(selectedPhoto)}
              >
                Delete Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
