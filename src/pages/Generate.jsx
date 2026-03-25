import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fal } from '@fal-ai/client'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'

export default function Generate() {
  const navigate = useNavigate()
  const { currentRun } = useWorkspace()
  const [falKey, setFalKey] = useState('')
  const [generating, setGenerating] = useState(false)
  const [images, setImages] = useState([])
  const [prompts, setPrompts] = useState([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)

  useEffect(() => {
    if (!currentRun) return
    loadData()
  }, [currentRun])

  const loadData = async () => {
    const { data: existingImages } = await supabase
      .from('static_images').select('*').eq('run_id', currentRun.id).order('created_at', { ascending: true })
    if (existingImages?.length > 0) setImages(existingImages)

    const { data: promptVersions } = await supabase
      .from('static_prompt_versions').select('*').eq('run_id', currentRun.id).order('created_at', { ascending: true })
    if (promptVersions) setPrompts(promptVersions)
  }

  const handleGenerate = async () => {
    if (!falKey.trim()) { setError('Please enter your fal.ai API key'); return }
    if (prompts.length === 0) { setError('No prompts found. Go back to Prompt Lab to create some.'); return }
    setError(''); setGenerating(true); setProgress({ current: 0, total: prompts.length })
    fal.config({ credentials: falKey.trim() })
    const newImages = []
    for (let i = 0; i < prompts.length; i++) {
      setProgress({ current: i + 1, total: prompts.length })
      const p = prompts[i]
      try {
        const result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
          input: { prompt: p.prompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5 },
        })
        const imageUrl = result?.images?.[0]?.url || result?.data?.images?.[0]?.url
        if (!imageUrl) throw new Error('No image returned')
        const { data: inserted, error: insertErr } = await supabase
          .from('static_images').insert({ run_id: currentRun.id, template_id: p.template_id, template_name: p.template_id, category: '', prompt: p.prompt, image_url: imageUrl, version: p.version || 1 }).select().single()
        if (insertErr) throw insertErr
        newImages.push(inserted)
      } catch (err) {
        console.error(`Failed to generate for ${p.template_id}:`, err)
        newImages.push({ template_id: p.template_id, prompt: p.prompt, image_url: null, error: err.message })
      }
    }
    setImages(prev => [...prev, ...newImages])
    setGenerating(false)
  }

  const handleRegenerate = async (img) => {
    if (!falKey.trim()) { setError('Please enter your fal.ai API key'); return }
    fal.config({ credentials: falKey.trim() })
    try {
      const result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
        input: { prompt: img.prompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5 },
      })
      const imageUrl = result?.images?.[0]?.url || result?.data?.images?.[0]?.url
      if (!imageUrl) throw new Error('No image returned')
      if (img.id) {
        await supabase.from('static_images').update({ image_url: imageUrl, version: (img.version || 1) + 1 }).eq('id', img.id)
      }
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, image_url: imageUrl, version: (i.version || 1) + 1 } : i))
    } catch (err) {
      setError(`Regeneration failed: ${err.message}`)
    }
  }

  const handleDownloadAll = async () => {
    const zip = new JSZip()
    const validImages = images.filter(i => i.image_url)
    for (const img of validImages) {
      try {
        const response = await fetch(img.image_url)
        const blob = await response.blob()
        const ext = img.image_url.includes('.png') ? 'png' : 'jpg'
        zip.file(`${img.template_id || img.template_name || 'image'}_v${img.version || 1}.${ext}`, blob)
      } catch (err) { console.error('Failed to download image for zip:', err) }
    }
    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, `${currentRun?.brand_name || 'images'}_static_ads.zip`)
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

  const successCount = images.filter(i => i.image_url).length
  const failCount = images.filter(i => !i.image_url && i.error).length

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Generate Images</h1>
          <p className="text-zinc-400 text-sm">Step 5 \u2014 Generate AI images from your prompts</p>
        </div>

        <div className="card mb-6">
          <label className="label">fal.ai API Key (BYOK \u2014 your key stays in your browser)</label>
          <div className="flex gap-3">
            <input type="password" value={falKey} onChange={(e) => setFalKey(e.target.value)} placeholder="Enter your fal.ai API key" className="input-field flex-1" />
            <button onClick={handleGenerate} disabled={generating || !falKey.trim() || prompts.length === 0} className="btn btn-primary">
              {generating ? (<><span className="spinner" /> Generating {progress.current}/{progress.total}</>) : `Generate All (${prompts.length} prompts)`}
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">Your API key is never stored or sent anywhere except directly to fal.ai. It disappears when you refresh.</p>
        </div>

        {generating && (
          <div className="card mb-6">
            <div className="flex justify-between text-xs text-zinc-400 mb-2">
              <span>Generating image {progress.current} of {progress.total}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2">
              <div className="bg-orange-500 h-2 rounded-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {error && <div className="card mb-6 border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}

        {images.length > 0 && (
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm text-zinc-400">{successCount} generated{failCount > 0 ? `, ${failCount} failed` : ''}</span>
            <div className="flex gap-3">
              <button onClick={handleDownloadAll} disabled={successCount === 0} className="btn btn-secondary">Download All (.zip)</button>
              <button onClick={() => navigate('/review')} className="btn btn-primary">Continue to Review</button>
            </div>
          </div>
        )}

        {images.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {images.map((img, i) => (
              <div key={img.id || i} className="card-sm group relative">
                {img.image_url ? (
                  <img src={img.image_url} alt={img.template_name || img.template_id} className="w-full aspect-[16/9] object-cover rounded cursor-pointer" onClick={() => setSelectedImage(img)} />
                ) : (
                  <div className="w-full aspect-[16/9] rounded bg-zinc-800 flex items-center justify-center"><span className="text-xs text-red-400">Failed</span></div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400 truncate">{img.template_name || img.template_id}</span>
                  <button onClick={() => handleRegenerate(img)} className="text-[10px] text-orange-400 hover:text-orange-300 opacity-0 group-hover:opacity-100 transition-opacity">Regen</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {images.length === 0 && !generating && (
          <div className="card text-center py-16">
            <p className="text-zinc-500 mb-2">No images generated yet</p>
            <p className="text-zinc-600 text-sm">Enter your fal.ai API key and click Generate All to create images from your {prompts.length} prompts.</p>
          </div>
        )}

        {selectedImage && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={() => setSelectedImage(null)}>
            <div className="card max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <img src={selectedImage.image_url} alt={selectedImage.template_name} className="w-full rounded mb-4" />
              <div className="space-y-3">
                <div><span className="label">Template</span><p className="text-sm">{selectedImage.template_name || selectedImage.template_id}</p></div>
                <div><span className="label">Prompt</span><p className="text-xs text-zinc-400 font-mono leading-relaxed">{selectedImage.prompt}</p></div>
                <div className="flex gap-3 pt-2">
                  <a href={selectedImage.image_url} download target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">Download</a>
                  <button onClick={() => handleRegenerate(selectedImage)} className="btn btn-primary text-xs">Regenerate</button>
                  <button onClick={() => setSelectedImage(null)} className="btn btn-ghost text-xs ml-auto">Close</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
