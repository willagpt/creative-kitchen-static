import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const RATINGS = [
  { key: 'great', label: 'Great', color: '#22c55e' },
  { key: 'good', label: 'Good', color: '#3b82f6' },
  { key: 'needs-work', label: 'Needs Work', color: '#eab308' },
  { key: 'slop', label: 'Slop', color: '#ef4444' },
]

export default function Review({ brands, activeBrandId }) {
  const [runs, setRuns] = useState([])
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedImage, setSelectedImage] = useState(null)

  async function loadRuns() {
    setLoading(true)
    const { data } = await supabase
      .from('generation_runs')
      .select('*')
      .order('created_at', { ascending: false })
    setRuns(data || [])

    // Auto-select latest
    if (data?.length && !selectedRunId) setSelectedRunId(data[0].id)
    setLoading(false)
  }

  async function loadImages(runId) {
    if (!runId) { setImages([]); return }
    const { data } = await supabase
      .from('gen_images')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true })
    setImages(data || [])
  }

  useEffect(() => { loadRuns() }, [])
  useEffect(() => { if (selectedRunId) loadImages(selectedRunId) }, [selectedRunId])

  async function rateImage(imageId, rating) {
    await supabase.from('gen_images').update({ rating }).eq('id', imageId)
    setImages(prev => prev.map(img => img.id === imageId ? { ...img, rating } : img))
    if (selectedImage?.id === imageId) setSelectedImage(prev => ({ ...prev, rating }))
  }

  async function toggleWinner(imageId, current) {
    await supabase.from('gen_images').update({ is_winner: !current }).eq('id', imageId)
    setImages(prev => prev.map(img => img.id === imageId ? { ...img, is_winner: !current } : img))
    if (selectedImage?.id === imageId) setSelectedImage(prev => ({ ...prev, is_winner: !current }))
  }

  const filteredImages = images.filter(img => {
    if (img.status === 'failed') return false
    if (filter === 'all') return true
    if (filter === 'unrated') return !img.rating
    if (filter === 'winners') return img.is_winner
    return img.rating === filter
  })

  const stats = {
    total: images.filter(i => i.status !== 'failed').length,
    rated: images.filter(i => i.rating).length,
    winners: images.filter(i => i.is_winner).length,
    great: images.filter(i => i.rating === 'great').length,
    slop: images.filter(i => i.rating === 'slop').length,
  }

  const selectedRun = runs.find(r => r.id === selectedRunId)

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Review</h2>
          <p className="page-subtitle">Rate outputs, mark winners, create variations on what works.</p>
        </div>
        <div>
          <select
            className="select-input"
            value={selectedRunId || ''}
            onChange={e => setSelectedRunId(e.target.value || null)}
          >
            <option value="">Select a run...</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {r.name || 'Run'} ({r.completed_count}/{r.total_combinations})
                {r.status === 'running' ? ' (running)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedRun && (
        <>
          {/* Stats */}
          <div className="stats-bar">
            <div className="stat">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">images</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.rated}</span>
              <span className="stat-label">rated</span>
            </div>
            <div className="stat">
              <span className="stat-value" style={{ color: 'var(--success)' }}>{stats.winners}</span>
              <span className="stat-label">winners</span>
            </div>
            <div className="stat">
              <span className="stat-value" style={{ color: '#22c55e' }}>{stats.great}</span>
              <span className="stat-label">great</span>
            </div>
            <div className="stat">
              <span className="stat-value" style={{ color: '#ef4444' }}>{stats.slop}</span>
              <span className="stat-label">slop</span>
            </div>
          </div>

          {/* Filters */}
          <div style={{ marginBottom: 16 }}>
            <div className="filters">
              <button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
              <button className={`filter-pill ${filter === 'unrated' ? 'active' : ''}`} onClick={() => setFilter('unrated')}>Unrated</button>
              <button className={`filter-pill ${filter === 'winners' ? 'active' : ''}`} onClick={() => setFilter('winners')}>Winners</button>
              {RATINGS.map(r => (
                <button
                  key={r.key}
                  className={`filter-pill ${filter === r.key ? 'active' : ''}`}
                  onClick={() => setFilter(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Image grid */}
          <div className="review-grid">
            {filteredImages.map(img => (
              <div
                key={img.id}
                className={`review-card ${img.is_winner ? 'winner' : ''} ${selectedImage?.id === img.id ? 'selected' : ''}`}
                onClick={() => setSelectedImage(selectedImage?.id === img.id ? null : img)}
              >
                <div className="review-card-image">
                  <img src={img.image_url} alt="" loading="lazy" />
                  {img.is_winner && <span className="winner-badge">&#9733; Winner</span>}
                  {img.rating && (
                    <span
                      className="rating-badge"
                      style={{ background: RATINGS.find(r => r.key === img.rating)?.color }}
                    >
                      {img.rating}
                    </span>
                  )}
                  <span className="result-ratio">{img.aspect_ratio}</span>
                </div>
                <div className="review-card-body">
                  {img.variables_used?.MEAL_NAME && (
                    <span className="review-card-meal">{img.variables_used.MEAL_NAME}</span>
                  )}
                  <div className="rating-buttons" onClick={e => e.stopPropagation()}>
                    {RATINGS.map(r => (
                      <button
                        key={r.key}
                        className={`rating-btn ${img.rating === r.key ? 'active' : ''}`}
                        style={{ '--rating-color': r.color }}
                        onClick={() => rateImage(img.id, r.key)}
                        title={r.label}
                      >
                        {r.label.charAt(0)}
                      </button>
                    ))}
                    <button
                      className={`rating-btn winner-btn ${img.is_winner ? 'active' : ''}`}
                      onClick={() => toggleWinner(img.id, img.is_winner)}
                      title="Mark as winner"
                    >
                      &#9733;
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredImages.length === 0 && !loading && (
            <div className="empty-state">
              <h3>No images to review</h3>
              <p>Run a generation first, then come here to rate the outputs.</p>
            </div>
          )}
        </>
      )}

      {!selectedRun && !loading && (
        <div className="empty-state">
          <h3>No generation runs yet</h3>
          <p>Go to the Generator tab to create your first batch.</p>
        </div>
      )}

      {/* Detail panel */}
      {selectedImage && (
        <div className="review-detail-overlay" onClick={e => { if (e.target === e.currentTarget) setSelectedImage(null) }}>
          <div className="review-detail-panel">
            <div className="detail-header">
              <span style={{ fontWeight: 700 }}>
                {selectedImage.variables_used?.MEAL_NAME || 'Generated Image'}
              </span>
              <button className="detail-close" onClick={() => setSelectedImage(null)}>&times;</button>
            </div>
            <div className="review-detail-body">
              <div className="review-detail-image">
                <img src={selectedImage.image_url} alt="" />
              </div>
              <div className="review-detail-info">
                <label className="field-label">Rating</label>
                <div className="rating-buttons" style={{ marginBottom: 12 }}>
                  {RATINGS.map(r => (
                    <button
                      key={r.key}
                      className={`rating-btn ${selectedImage.rating === r.key ? 'active' : ''}`}
                      style={{ '--rating-color': r.color }}
                      onClick={() => rateImage(selectedImage.id, r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <button
                  className={`btn ${selectedImage.is_winner ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => toggleWinner(selectedImage.id, selectedImage.is_winner)}
                  style={{ marginBottom: 16 }}
                >
                  {selectedImage.is_winner ? '&#9733; Winner' : 'Mark as Winner'}
                </button>

                <label className="field-label">Aspect Ratio</label>
                <p style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 12 }}>{selectedImage.aspect_ratio}</p>

                {selectedImage.variables_used && Object.keys(selectedImage.variables_used).length > 0 && (
                  <>
                    <label className="field-label">Variables Used</label>
                    <div style={{ fontSize: 12, color: 'var(--text-1)' }}>
                      {Object.entries(selectedImage.variables_used).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 4 }}>
                          <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{`{{${k}}}`}</span>
                          <span style={{ marginLeft: 8 }}>{String(v).slice(0, 100)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <label className="field-label" style={{ marginTop: 16 }}>Prompt Used</label>
                <textarea
                  className="prompt-textarea"
                  value={selectedImage.prompt_used || ''}
                  readOnly
                  style={{ minHeight: 160, fontSize: 11 }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
