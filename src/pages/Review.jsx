import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'

const ratingOptions = [
  { value: 'great', label: 'Great', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'good', label: 'Good', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'needs-work', label: 'Needs Work', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { value: 'slop', label: 'Slop', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
]

export default function Review() {
  const navigate = useNavigate()
  const { currentRun } = useWorkspace()
  const [images, setImages] = useState([])
  const [reviews, setReviews] = useState({})
  const [notes, setNotes] = useState({})
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentRun) return
    loadData()
  }, [currentRun])

  const loadData = async () => {
    const { data: imgs } = await supabase
      .from('static_images').select('*').eq('run_id', currentRun.id).order('created_at', { ascending: true })
    if (imgs) setImages(imgs)

    const { data: existingReviews } = await supabase
      .from('static_reviews').select('*').in('image_id', (imgs || []).map(i => i.id))
    if (existingReviews) {
      const reviewMap = {}
      const notesMap = {}
      existingReviews.forEach(r => {
        if (r.reviewer === 'user') {
          reviewMap[r.image_id] = r.rating
          notesMap[r.image_id] = r.notes || ''
        }
      })
      setReviews(reviewMap)
      setNotes(notesMap)
    }
  }

  const handleRate = async (imageId, rating) => {
    setReviews(prev => ({ ...prev, [imageId]: rating }))
    setSaving(true)
    try {
      const existing = await supabase
        .from('static_reviews').select('id').eq('image_id', imageId).eq('reviewer', 'user').single()
      if (existing.data) {
        await supabase.from('static_reviews').update({ rating }).eq('id', existing.data.id)
      } else {
        await supabase.from('static_reviews').insert({ image_id: imageId, reviewer: 'user', rating, notes: notes[imageId] || '' })
      }
    } catch (err) {
      setError('Failed to save rating')
    }
    setSaving(false)
  }

  const handleNotes = async (imageId, text) => {
    setNotes(prev => ({ ...prev, [imageId]: text }))
  }

  const handleSaveNotes = async (imageId) => {
    try {
      const existing = await supabase
        .from('static_reviews').select('id').eq('image_id', imageId).eq('reviewer', 'user').single()
      if (existing.data) {
        await supabase.from('static_reviews').update({ notes: notes[imageId] || '' }).eq('id', existing.data.id)
      }
    } catch (err) { /* silent */ }
  }

  const filteredImages = filter === 'all' ? images : images.filter(img => reviews[img.id] === filter)

  const stats = {
    great: Object.values(reviews).filter(r => r === 'great').length,
    good: Object.values(reviews).filter(r => r === 'good').length,
    'needs-work': Object.values(reviews).filter(r => r === 'needs-work').length,
    slop: Object.values(reviews).filter(r => r === 'slop').length,
    unrated: images.length - Object.keys(reviews).length,
  }

  if (!currentRun) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex items-center justify-center">
        <div className="card text-center">
          <p className="text-zinc-400 mb-4">No run selected.</p>
          <button onClick={() => navigate('/brand-setup')} className="btn btn-primary">Go to Brand Setup</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Review Images</h1>
          <p className="text-zinc-400 text-sm">Step 6 \u2014 Rate and review generated images</p>
        </div>

        {/* Stats */}
        <div className="card mb-6">
          <div className="flex flex-wrap gap-4">
            {ratingOptions.map(opt => (
              <div key={opt.value} className="text-center">
                <div className="text-2xl font-bold">{stats[opt.value]}</div>
                <div className="text-[11px] text-zinc-500">{opt.label}</div>
              </div>
            ))}
            <div className="text-center">
              <div className="text-2xl font-bold text-zinc-600">{stats.unrated}</div>
              <div className="text-[11px] text-zinc-500">Unrated</div>
            </div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded text-xs font-medium ${filter === 'all' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}>All ({images.length})</button>
          {ratingOptions.map(opt => (
            <button key={opt.value} onClick={() => setFilter(opt.value)} className={`px-3 py-1.5 rounded text-xs font-medium ${filter === opt.value ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{opt.label} ({stats[opt.value]})</button>
          ))}
        </div>

        {error && <div className="card mb-6 border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}

        {/* Image Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredImages.map(img => (
            <div key={img.id} className="card-sm space-y-3">
              {img.image_url ? (
                <img src={img.image_url} alt={img.template_name} className="w-full aspect-[16/9] object-cover rounded" />
              ) : (
                <div className="w-full aspect-[16/9] rounded bg-zinc-800 flex items-center justify-center">
                  <span className="text-xs text-red-400">Failed</span>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium">{img.template_name}</h4>
                <p className="text-[11px] text-zinc-500">{img.category}</p>
              </div>
              {img.image_url && (
                <div className="grid grid-cols-4 gap-1.5">
                  {ratingOptions.map(opt => (
                    <button key={opt.value} onClick={() => handleRate(img.id, opt.value)}
                      className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${
                        reviews[img.id] === opt.value ? opt.cls : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <textarea value={notes[img.id] || ''} onChange={(e) => handleNotes(img.id, e.target.value)} onBlur={() => handleSaveNotes(img.id)} placeholder="Notes..." rows={2} className="textarea-field text-xs" />
            </div>
          ))}
        </div>

        {filteredImages.length === 0 && (
          <div className="card text-center py-12"><p className="text-zinc-500">No images match this filter.</p></div>
        )}
      </div>
    </div>
  )
}
