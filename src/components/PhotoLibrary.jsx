import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

export default function PhotoLibrary({ brands, activeBrandId }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [describing, setDescribing] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef()
  const dropRef = useRef()

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

        // Get dimensions
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
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve({ width: 0, height: 0 })
      img.src = URL.createObjectURL(file)
    })
  }

  // Add photos by Google Drive URL
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

  // Describe a photo with Claude Vision via edge function
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

      // Update local state
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

  // Batch describe all undescribed photos
  async function describeAll() {
    const undescribed = photos.filter(p => !p.description)
    for (const photo of undescribed) {
      await describePhoto(photo)
    }
  }

  // Update photo metadata
  async function updatePhoto(id, updates) {
    await supabase.from('photo_library').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
    if (selectedPhoto?.id === id) setSelectedPhoto(prev => ({ ...prev, ...updates }))
  }

  // Drag and drop handlers
  function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over') }
  function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over') }
  function handleDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  const types = ['product', 'lifestyle', 'ingredients', 'packaging', 'texture', 'mood']
  const undescribedCount = photos.filter(p => !p.description).length

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Photo Library</h2>
          <p className="page-subtitle">{photos.length} photos {undescribedCount > 0 && `(${undescribedCount} need descriptions)`}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {undescribedCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={describeAll} disabled={!!describing}>
              Describe all ({undescribedCount})
            </button>
          )}
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
      <div style={{ marginBottom: 16 }}>
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

      {/* Drop zone */}
      {photos.length === 0 && !loading && (
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
            <h3>Drop photos here</h3>
            <p>Or click to browse. Upload your high-quality product photography.</p>
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>Each photo will get auto-described by Claude Vision for use in prompts.</p>
          </div>
        </div>
      )}

      {uploading && (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-1)' }}>
          <span className="spinner spinner-inline" style={{ marginRight: 8 }} /> Uploading...
        </div>
      )}

      {/* Photo grid */}
      {filteredPhotos.length > 0 && (
        <div className="photo-grid">
          {/* Inline drop zone when photos exist */}
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
                <span className="photo-card-name">{photo.name}</span>
                <span className={`photo-card-type photo-type-${photo.type || 'product'}`}>{photo.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedPhoto && (
        <div className="photo-detail-panel">
          <div className="photo-detail-header">
            <h3>{selectedPhoto.name}</h3>
            <button className="detail-close" onClick={() => setSelectedPhoto(null)}>&times;</button>
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

              <label className="field-label" style={{ marginTop: 12 }}>Star Rating</label>
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

              <label className="field-label" style={{ marginTop: 12 }}>Approved</label>
              <button
                className={`btn btn-sm ${selectedPhoto.approved ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updatePhoto(selectedPhoto.id, { approved: !selectedPhoto.approved })}
              >
                {selectedPhoto.approved ? 'Approved' : 'Mark as Approved'}
              </button>

              <label className="field-label" style={{ marginTop: 16 }}>AI Description</label>
              <textarea
                className="prompt-textarea"
                value={selectedPhoto.description || ''}
                onChange={e => {
                  setSelectedPhoto(prev => ({ ...prev, description: e.target.value }))
                }}
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

              <label className="field-label" style={{ marginTop: 16 }}>Prompt Snippet</label>
              <textarea
                className="prompt-textarea"
                value={selectedPhoto.prompt_snippet || ''}
                onChange={e => {
                  setSelectedPhoto(prev => ({ ...prev, prompt_snippet: e.target.value }))
                }}
                onBlur={e => updatePhoto(selectedPhoto.id, { prompt_snippet: e.target.value })}
                placeholder="A reusable text snippet describing this photo for injection into prompts."
                style={{ minHeight: 80 }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
