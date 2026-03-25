import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'

export default function Upload() {
  const navigate = useNavigate()
  const { workspace, currentRun } = useWorkspace()
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState([])
  const [uploadedImages, setUploadedImages] = useState([])
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)

  const handleDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const droppedFiles = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))
    setFiles(prev => [...prev, ...droppedFiles])
  }, [])

  const handleFileInput = (e) => {
    const selectedFiles = [...e.target.files].filter(f => f.type.startsWith('image/'))
    setFiles(prev => [...prev, ...selectedFiles])
  }

  const handleRemoveFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (!workspace || !currentRun) {
      setError('Please select a workspace and run first (go to Brand Setup)')
      return
    }
    if (files.length === 0) { setError('No files selected'); return }

    setError('')
    setUploading(true)
    setProgress(0)
    const uploaded = []

    for (let i = 0; i < files.length; i++) {
      setProgress(Math.round(((i + 1) / files.length) * 100))
      const file = files[i]
      const path = `${workspace.id}/${currentRun.id}/${Date.now()}_${file.name}`

      try {
        const { error: uploadErr } = await supabase.storage
          .from('static-uploads').upload(path, file)
        if (uploadErr) throw uploadErr

        const { data: { publicUrl } } = supabase.storage
          .from('static-uploads').getPublicUrl(path)

        const { data: record, error: insertErr } = await supabase
          .from('static_uploads').insert({
            run_id: currentRun.id,
            filename: file.name,
            storage_path: path,
            public_url: publicUrl,
            size_bytes: file.size,
          }).select().single()

        if (insertErr) throw insertErr
        uploaded.push(record)
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err)
      }
    }

    setUploadedImages(prev => [...prev, ...uploaded])
    setFiles([])
    setUploading(false)
  }

  const handleDeleteUpload = async (upload) => {
    try {
      await supabase.storage.from('static-uploads').remove([upload.storage_path])
      await supabase.from('static_uploads').delete().eq('id', upload.id)
      setUploadedImages(prev => prev.filter(u => u.id !== upload.id))
    } catch (err) {
      setError('Failed to delete image')
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Bulk Upload</h1>
          <p className="text-zinc-400 text-sm">Upload existing ad images to your library</p>
        </div>

        {!currentRun && (
          <div className="card text-center mb-6">
            <p className="text-zinc-400 mb-4">Select a run first to upload images to.</p>
            <button onClick={() => navigate('/brand-setup')} className="btn btn-primary">Go to Brand Setup</button>
          </div>
        )}

        {currentRun && (
          <>
            {/* Dropzone */}
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`card mb-6 border-2 border-dashed text-center py-12 transition-colors cursor-pointer ${
                dragActive ? 'border-orange-500 bg-orange-500/5' : 'border-zinc-700 hover:border-zinc-500'
              }`}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input id="file-input" type="file" multiple accept="image/*" onChange={handleFileInput} className="hidden" />
              <div className="text-4xl mb-3">\uD83D\uDCE4</div>
              <p className="text-zinc-400 text-sm">Drag & drop images here, or click to browse</p>
              <p className="text-zinc-600 text-xs mt-1">PNG, JPG, WebP accepted</p>
            </div>

            {/* Queued files */}
            {files.length > 0 && (
              <div className="card mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">{files.length} files ready</span>
                  <button onClick={handleUpload} disabled={uploading} className="btn btn-primary">
                    {uploading ? (<><span className="spinner" /> Uploading {progress}%</>) : 'Upload All'}
                  </button>
                </div>
                {uploading && (
                  <div className="w-full bg-zinc-800 rounded-full h-2 mb-3">
                    <div className="bg-orange-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <div key={i} className="badge badge-neutral">
                      {f.name}
                      <button onClick={() => handleRemoveFile(i)} className="ml-1 hover:text-red-400">&times;</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="card mb-6 border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}

            {/* Uploaded images grid */}
            {uploadedImages.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Uploaded Images ({uploadedImages.length})</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {uploadedImages.map(upload => (
                    <div key={upload.id} className="card-sm group relative">
                      <img src={upload.public_url} alt={upload.filename} className="w-full aspect-square object-cover rounded" />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400 truncate">{upload.filename}</span>
                        <button onClick={() => handleDeleteUpload(upload)} className="text-[10px] text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
