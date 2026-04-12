import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const MODELS = [
  { value: 'fal-ai/nano-banana-2', label: 'nano banana 2 (default)' },
  { value: 'fal-ai/nano-banana-pro', label: 'nano banana pro (older)' },
  { value: 'fal-ai/flux-2-pro', label: 'flux 2 pro (current gen)' },
  { value: 'fal-ai/flux-pro/v1.1-ultra', label: 'flux pro v1.1 ultra' },
  { value: 'fal-ai/flux/schnell', label: 'flux schnell (fast/cheap)' },
]

const RATIOS = ['1:1', '4:5', '9:16', '16:9', '3:2', '2:3']
const RESOLUTIONS = ['1K', '512px', '2K', '4K']

const FLUX_SIZE_MAP = {
  '1:1': 'square_hd',
  '4:5': { width: 1080, height: 1350 },
  '9:16': 'portrait_16_9',
  '16:9': 'landscape_16_9',
  '3:2': 'landscape_4_3',
  '2:3': 'portrait_4_3',
}

// Canva design dimensions mapped to aspect ratios
const CANVA_SIZE_MAP = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '3:2': { width: 1080, height: 720 },
  '2:3': { width: 720, height: 1080 },
}

const DEFAULT_PROMPT = `Create a bold headline static advertisement for "CHEFLY" (eatchefly.com). Large, attention-grabbing headline dominates the top third. Product image centered below. Strong call-to-action button at bottom. Brand colors — use ONLY these for all backgrounds, text, accents, and graphic elements: #FF6B2C, #0D0D0D, #FFF6EE, #FFD60A, #A8E10C, #FF8FA3, #5CCFFF. Product: fresh meals. Key claims: Preservative-free meals, no seed oils, high protein. Photography: Clean, minimal, product-focused compositions. Professional advertising quality. 1080x1080 square format.`

const PRESETS = [
  { name: 'B (favourite)', prompt: `Create a bold headline static advertisement for "CHEFLY" (eatchefly.com). Large, attention-grabbing headline dominates the top third. Product image centered below. Strong call-to-action button at bottom. Brand colors — use ONLY these for all backgrounds, text, accents, and graphic elements: #FF6B2C, #0D0D0D, #FFF6EE, #FFD60A, #A8E10C, #FF8FA3, #5CCFFF. Product: fresh meals. Key claims: Preservative-free meals, no seed oils, high protein. Photography: Clean, minimal, product-focused compositions. Professional advertising quality. 1080x1080 square format.` },
  { name: 'C (favourite)', prompt: `Create a bold headline static advertisement. Large, attention-grabbing headline text dominates the top third. Product image centered below. Strong call-to-action button at the bottom. Clean background with brand colors. Brand name: "CHEFLY". Website URL text displayed on ad: "eatchefly.com". Product: fresh meals. Key claims: Preservative-free meals, no seed oils, high protein. Brand colors — use ONLY these for all backgrounds, text, accents, and graphic elements: #FF6B2C, #0D0D0D, #FFF6EE, #FFD60A, #A8E10C, #FF8FA3, #5CCFFF. Photography style: Clean, minimal compositions. Product-focused compositions for CHEFLY. Direct-response advertising with clear value propositions. CHEFLY aesthetic throughout. Strong CTAs with brand color accents. Do NOT generate any AI text overlays, watermarks, or placeholder logos. IMPORTANT: Any website URL shown in the ad MUST read exactly "eatchefly.com" — not any other domain. Professional advertising quality. 1080x1080 square format.` },
  { name: 'B-rewrite (photo)', prompt: `Premium DTC meal delivery advertisement for CHEFLY (eatchefly.com). Hero shot of a freshly prepared high-protein meal in branded matte packaging, steam gently rising, shot on Canon R5 85mm f/2.8 from a 30-degree overhead angle. Soft key light from upper left, warm fill light reflecting off a cream surface. Bold headline text "CHEFLY" dominates the top third in clean sans-serif type, call-to-action button at bottom reading "eatchefly.com". Brand color palette — use ONLY these: #FF6B2C for accents, #0D0D0D for text and backgrounds, #FFF6EE for surface, #FFD60A #A8E10C #FF8FA3 #5CCFFF as accent highlights. Preservative-free, no seed oils, high protein. For a scroll-stopping paid social campaign. 1:1, 1080x1080.` },
  { name: 'C-rewrite (photo)', prompt: `Static advertisement for CHEFLY, a premium chef-cooked meal delivery brand (eatchefly.com). Centre frame: a sealed meal tray with visible protein, grains, and fresh vegetables, shot on Hasselblad X2D 90mm at f/4, shallow depth of field. Warm directional lighting from upper right, dark moody background fading to near-black. Text "CHEFLY" in bold clean sans-serif across the top third, tagline "Preservative-free. No seed oils. High protein." in smaller type below. CTA "eatchefly.com" at bottom. Brand colors — use ONLY these throughout: #FF6B2C, #0D0D0D, #FFF6EE, #FFD60A, #A8E10C, #FF8FA3, #5CCFFF. Direct-response advertising aesthetic, clean modern layout. Do NOT generate any watermarks or placeholder logos. For a high-converting paid social campaign targeting food enthusiasts. 1:1, 1080x1080.` },
  { name: 'empty', prompt: '' },
]

// IndexedDB helpers
const DB_NAME = 'ck_prompt_tester'
const DB_VERSION = 1
const STORE_NAME = 'generations'
const MAX_SAVED = 50

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveToDB(item) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(item)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function loadAllFromDB() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.id - a.id))
    req.onerror = () => reject(req.error)
  })
}

async function deleteFromDB(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function clearDB() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function imageUrlToDataUrl(url) {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch {
    return url
  }
}

export default function PromptTester() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ck_fal_api_key') || '')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [model, setModel] = useState('fal-ai/nano-banana-2')
  const [ratio, setRatio] = useState('4:5')
  const [resolution, setResolution] = useState('1K')
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState('ready')
  const [elapsed, setElapsed] = useState('')
  const [resultImage, setResultImage] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [showDetail, setShowDetail] = useState(null)
  const [refineText, setRefineText] = useState('')
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState(false)
  const [canvaSending, setCanvaSending] = useState(false)
  const [canvaSent, setCanvaSent] = useState(false)

  const timerRef = useRef(null)

  // Persist API key
  useEffect(() => {
    localStorage.setItem('ck_fal_api_key', apiKey)
  }, [apiKey])

  // Load history from IndexedDB on mount
  useEffect(() => {
    loadAllFromDB().then(saved => {
      if (saved.length) {
        setHistory(saved)
        setSelectedId(saved[0].id)
        setResultImage(saved[0].dataUrl || saved[0].url)
        setShowDetail(saved[0])
        setStatus(saved[0].model.split('/').pop() + ' · ' + saved[0].ratio + ' · ' + saved[0].resolution + ' · ' + saved[0].time + 's · restored')
      }
    }).catch(() => {})
  }, [])

  const charCount = prompt.length
  const tokenEst = Math.round(prompt.length / 4)

  const generate = useCallback(async () => {
    if (!apiKey.trim()) { alert('Enter your fal.ai API key first'); return }
    if (!prompt.trim()) { alert('Enter a prompt'); return }

    setGenerating(true)
    setStatus('submitting to ' + model + '...')
    setElapsed('')

    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(((Date.now() - startTime) / 1000).toFixed(1) + 's')
    }, 100)

    const headers = {
      'Authorization': 'Key ' + apiKey.trim(),
      'Content-Type': 'application/json',
    }

    try {
      const isFlux = model.includes('flux')
      const body = { prompt: prompt.trim(), num_images: 1 }

      if (isFlux) {
        body.image_size = FLUX_SIZE_MAP[ratio] || 'square_hd'
      } else {
        const validRes = resolution === '512px' ? '1K' : resolution
        if (resolution === '512px') {
          setStatus('512px not supported by ' + model.split('/').pop() + ', using 1K...')
        }
        body.aspect_ratio = ratio
        body.resolution = validRes
      }

      // Submit
      const submitResp = await fetch('https://queue.fal.run/' + model, {
        method: 'POST', headers,
        body: JSON.stringify(body),
      })
      if (!submitResp.ok) throw new Error('Submit error: ' + submitResp.status)
      const submitData = await submitResp.json()

      let imageUrl = submitData.images?.[0]?.url || submitData.output?.images?.[0]?.url

      if (!imageUrl) {
        const requestId = submitData.request_id
        if (!requestId) throw new Error('No request_id returned')

        const statusUrl = 'https://queue.fal.run/' + model + '/requests/' + requestId + '/status'
        const resultUrl = 'https://queue.fal.run/' + model + '/requests/' + requestId

        setStatus('queued...')
        const maxWait = 180000
        while (Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 1500))
          const pollResp = await fetch(statusUrl, { headers: { 'Authorization': 'Key ' + apiKey.trim() } })
          if (!pollResp.ok) throw new Error('Poll error: ' + pollResp.status)
          const pollData = await pollResp.json()
          const secs = Math.round((Date.now() - startTime) / 1000)

          if (pollData.status === 'COMPLETED') {
            setStatus('downloading...')
            const resultResp = await fetch(resultUrl, { headers: { 'Authorization': 'Key ' + apiKey.trim() } })
            if (!resultResp.ok) throw new Error('Result error: ' + resultResp.status)
            const resultData = await resultResp.json()
            imageUrl = resultData.images?.[0]?.url || resultData.output?.images?.[0]?.url
            break
          } else if (pollData.status === 'FAILED') {
            throw new Error('Generation failed: ' + (pollData.error || 'unknown'))
          } else {
            setStatus(pollData.status.toLowerCase().replace('_', ' ') + '... ' + secs + 's')
          }
        }
        if (!imageUrl) throw new Error('Timed out after 3 minutes')
      }

      // Done
      clearInterval(timerRef.current)
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
      setElapsed(totalTime + 's')

      setResultImage(imageUrl)
      setStatus(model.split('/').pop() + ' · ' + ratio + ' · ' + resolution + ' · ' + totalTime + 's · saving...')

      // Cache as data URL
      const dataUrl = await imageUrlToDataUrl(imageUrl)

      const entry = {
        id: Date.now(),
        url: imageUrl,
        dataUrl,
        model,
        ratio,
        resolution,
        time: totalTime,
        prompt: prompt.trim(),
      }

      setResultImage(dataUrl)
      setSelectedId(entry.id)
      setShowDetail(entry)

      try {
        await saveToDB(entry)
      } catch {}

      setHistory(prev => {
        const next = [entry, ...prev]
        // Trim old entries
        if (next.length > MAX_SAVED) {
          const old = next.splice(MAX_SAVED)
          old.forEach(item => deleteFromDB(item.id).catch(() => {}))
        }
        return next
      })

      setStatus(model.split('/').pop() + ' · ' + ratio + ' · ' + resolution + ' · ' + totalTime + 's · saved')
    } catch (err) {
      clearInterval(timerRef.current)
      setStatus('error: ' + err.message)
    }

    setGenerating(false)
  }, [apiKey, prompt, model, ratio, resolution])

  const loadPreset = (presetPrompt) => setPrompt(presetPrompt)

  const loadFromHistory = (item) => {
    setPrompt(item.prompt)
    setModel(item.model)
    setRatio(item.ratio)
    setResolution(item.resolution)
    setStatus('prompt loaded from #' + (history.length - history.findIndex(h => h.id === item.id)))
    // Scroll prompt textarea into view
    setTimeout(() => {
      const textarea = document.querySelector('.pt-prompt-input')
      if (textarea) {
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' })
        textarea.focus()
        // Brief highlight flash
        textarea.style.boxShadow = '0 0 0 2px var(--accent)'
        setTimeout(() => { textarea.style.boxShadow = '' }, 1500)
      }
    }, 50)
  }

  const selectHistoryItem = (item) => {
    setSelectedId(item.id)
    setResultImage(item.dataUrl || item.url)
    setShowDetail(item)
    setStatus(item.model.split('/').pop() + ' · ' + item.ratio + ' · ' + item.resolution + ' · ' + item.time + 's')
  }

  const handleClearHistory = async () => {
    const count = history.length
    if (!count) return
    const msg = `This will remove ${count} generation(s) from your local browser history.\n\nBefore clearing, a backup will be saved to Supabase so they can be recovered.\n\nContinue?`
    if (!confirm(msg)) return

    // Backup to Supabase before clearing
    try {
      setStatus('backing up to Supabase...')
      const backupRows = history.map(h => ({
        image_url: h.url || h.dataUrl,
        status: 'complete',
        aspect_ratio: h.ratio,
        prompt_used: h.prompt,
        variables_used: { SOURCE: 'prompt-tester-backup', MODEL: h.model, RESOLUTION: h.resolution, TIME: h.time },
      }))
      // Insert in batches of 10
      for (let i = 0; i < backupRows.length; i += 10) {
        const batch = backupRows.slice(i, i + 10)
        await supabase.from('gen_images').upsert(batch, { ignoreDuplicates: true })
      }
      setStatus(`backed up ${count} images to Supabase. clearing local...`)
    } catch (err) {
      console.error('Backup failed:', err)
      if (!confirm('Backup to Supabase failed. Clear local history anyway?')) {
        setStatus('clear cancelled (backup failed)')
        return
      }
    }

    try { await clearDB() } catch {}
    setHistory([])
    setSelectedId(null)
    setShowDetail(null)
    setResultImage(null)
    setStatus(`history cleared (${count} backed up to Supabase gen_images)`)
  }

  // Download current result image
  const handleDownload = () => {
    if (!resultImage) return
    const a = document.createElement('a')
    a.href = resultImage
    a.download = `chefly-${model.split('/').pop()}-${ratio.replace(':', 'x')}-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Promote current result to Launcher (save as winner in gen_images)
  const handlePromote = async () => {
    if (!showDetail) return
    setPromoting(true)
    setPromoted(false)

    try {
      const { error } = await supabase.from('gen_images').insert({
        image_url: showDetail.url || showDetail.dataUrl,
        is_winner: true,
        status: 'complete',
        aspect_ratio: showDetail.ratio,
        prompt_used: showDetail.prompt,
        variables_used: { SOURCE: 'prompt-tester', MODEL: showDetail.model },
        rating: 'great',
      })
      if (error) throw error
      setPromoted(true)
      setStatus('promoted to launcher')
      setTimeout(() => setPromoted(false), 3000)
    } catch (err) {
      setStatus('promote failed: ' + err.message)
    }
    setPromoting(false)
  }

  // Send to Canva: copy image to clipboard + open new Canva design at correct size
  const handleSendToCanva = async () => {
    if (!resultImage) return
    setCanvaSending(true)
    setCanvaSent(false)

    try {
      // Convert image to blob for clipboard
      let blob
      if (resultImage.startsWith('data:')) {
        // Data URL — convert to blob
        const resp = await fetch(resultImage)
        blob = await resp.blob()
      } else {
        // Remote URL — fetch and convert
        const resp = await fetch(resultImage)
        blob = await resp.blob()
      }

      // Ensure it's a PNG for clipboard compatibility
      if (blob.type !== 'image/png') {
        const img = new Image()
        const canvas = document.createElement('canvas')
        await new Promise((resolve, reject) => {
          img.onload = () => {
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            canvas.toBlob((pngBlob) => {
              blob = pngBlob
              resolve()
            }, 'image/png')
          }
          img.onerror = reject
          img.src = resultImage
        })
      }

      // Copy to clipboard
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])

      // Open Canva with correct dimensions
      const currentRatio = showDetail?.ratio || ratio
      const size = CANVA_SIZE_MAP[currentRatio] || CANVA_SIZE_MAP['1:1']
      const canvaUrl = `https://www.canva.com/design/create?width=${size.width}&height=${size.height}`
      window.open(canvaUrl, '_blank')

      setCanvaSent(true)
      setStatus('image copied — paste into Canva (Ctrl+V)')
      setTimeout(() => setCanvaSent(false), 4000)
    } catch (err) {
      // Fallback: if clipboard fails, just open Canva and tell user to download
      console.error('Clipboard copy failed:', err)
      const currentRatio = showDetail?.ratio || ratio
      const size = CANVA_SIZE_MAP[currentRatio] || CANVA_SIZE_MAP['1:1']
      const canvaUrl = `https://www.canva.com/design/create?width=${size.width}&height=${size.height}`
      window.open(canvaUrl, '_blank')
      setStatus('clipboard blocked — download the image and upload to Canva manually')
    }
    setCanvaSending(false)
  }

  // Refine: append refinement text and re-generate
  const handleRefine = () => {
    if (!refineText.trim()) return
    setPrompt(prev => prev.trim() + '\n\nREFINEMENT: ' + refineText.trim())
    setRefineText('')
    // Auto-generate after a tick (so prompt state updates)
    setTimeout(() => generate(), 50)
  }

  // Keyboard shortcut: Ctrl/Cmd + Enter to generate
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !generating) {
        e.preventDefault()
        generate()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [generate, generating])

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Prompt Tester</h2>
          <p className="page-subtitle">Test prompts against fal.ai models. Iterate fast, waste nothing.</p>
        </div>
        <div className="pt-api-row">
          <span className={`pt-api-dot ${apiKey ? 'active' : ''}`} />
          <input
            type="password"
            className="text-input text-input-sm"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="fal.ai API key"
            style={{ width: 220 }}
          />
        </div>
      </div>

      <div className="pt-layout">
        {/* Left: Prompt panel */}
        <div className="pt-panel">
          <div className="pt-panel-title">prompt</div>

          {/* Presets */}
          <div className="pt-presets">
            {PRESETS.map(p => (
              <button
                key={p.name}
                className="preset-btn"
                onClick={() => loadPreset(p.prompt)}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="pt-controls">
            <select className="select-input" value={model} onChange={e => setModel(e.target.value)} style={{ fontSize: 'var(--text-xs)' }}>
              {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select className="select-input" value={ratio} onChange={e => setRatio(e.target.value)} style={{ fontSize: 'var(--text-xs)', width: 70 }}>
              {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="select-input" value={resolution} onChange={e => setResolution(e.target.value)} style={{ fontSize: 'var(--text-xs)', width: 80 }}>
              {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={generate}
              disabled={generating}
            >
              {generating ? 'generating...' : 'generate'}
            </button>
          </div>

          {/* Prompt textarea */}
          <textarea
            className="prompt-textarea pt-prompt-input"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Write your prompt here... (Cmd+Enter to generate)"
          />

          <div className="pt-meta">
            <span>{charCount} chars</span>
            <span>~{tokenEst} tokens</span>
          </div>
        </div>

        {/* Right: Result panel */}
        <div className="pt-panel">
          <div className="pt-panel-title">result</div>

          <div className="pt-result-area">
            {resultImage ? (
              <img src={resultImage} alt="Generated" />
            ) : (
              <div className="pt-placeholder">
                <div style={{ fontSize: 13 }}>paste a prompt and hit generate</div>
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-2)' }}>
                  tip: start at 512px to iterate fast, then upscale winners
                </div>
              </div>
            )}
          </div>

          <div className="pt-status-bar">
            <span className={generating ? 'pt-generating' : ''}>{status}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{elapsed}</span>
          </div>

          {/* Actions: Refine, Download, Canva, Promote */}
          {resultImage && (
            <>
              <div className="pt-refine-bar">
                <input
                  type="text"
                  className="text-input text-input-sm pt-refine-input"
                  value={refineText}
                  onChange={e => setRefineText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && refineText.trim()) handleRefine() }}
                  placeholder="Refine: e.g. 'use our actual meal names' or 'make text bigger'"
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleRefine}
                  disabled={!refineText.trim() || generating}
                >
                  refine
                </button>
              </div>
              <div className="pt-actions">
                <button className="btn btn-ghost btn-sm" onClick={handleDownload}>
                  download
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleSendToCanva}
                  disabled={canvaSending || canvaSent}
                  style={{
                    background: canvaSent ? 'var(--green)' : 'rgba(0, 196, 204, 0.12)',
                    color: canvaSent ? '#000' : '#00c4cc',
                    borderColor: canvaSent ? 'var(--green)' : 'rgba(0, 196, 204, 0.3)',
                  }}
                >
                  {canvaSent ? 'copied — paste in Canva' : canvaSending ? 'copying...' : 'send to canva'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handlePromote}
                  disabled={promoting || promoted}
                >
                  {promoted ? 'promoted' : promoting ? 'promoting...' : 'send to launcher'}
                </button>
              </div>
            </>
          )}

          {/* Selected history detail */}
          {showDetail && (
            <div className="pt-history-detail">
              <div className="pt-detail-header">
                <span className="pt-detail-label">
                  #{history.length - history.findIndex(h => h.id === showDetail.id)} {'\u00B7'} {showDetail.model.split('/').pop()} {'\u00B7'} {showDetail.ratio} {'\u00B7'} {showDetail.resolution} {'\u00B7'} {showDetail.time}s
                </span>
                <button className="preset-btn" onClick={() => loadFromHistory(showDetail)}>
                  {'\u2191'} load prompt
                </button>
              </div>
              <div className="pt-detail-prompt">
                {showDetail.prompt.length > 300
                  ? showDetail.prompt.slice(0, 300) + '...'
                  : showDetail.prompt}
              </div>
            </div>
          )}

          {/* History strip */}
          {history.length > 0 && (
            <>
              <div className="pt-history-label">
                <span>generation history · {history.length} saved</span>
                <button className="preset-btn" onClick={handleClearHistory} style={{ color: 'var(--blush)' }}>
                  clear all
                </button>
              </div>
              <div className="pt-history-strip">
                {history.map(item => (
                  <div
                    key={item.id}
                    className={`pt-history-thumb ${item.id === selectedId ? 'active' : ''}`}
                    onClick={() => selectHistoryItem(item)}
                    title={item.model.split('/').pop() + ' · ' + item.ratio + ' · ' + item.time + 's'}
                  >
                    <img src={item.dataUrl || item.url} alt="" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
