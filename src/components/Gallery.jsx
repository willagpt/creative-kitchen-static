import { useState } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

const FAL_MODEL = 'fal-ai/nano-banana-2'

export default function Gallery({ ads, versions, loading, filter, setFilter, stats, onSelectAd, onRefresh, brands, activeBrandId }) {
  const activeBrand = brands?.find(b => b.id === activeBrandId)
  const [processing, setProcessing] = useState(false)
  const [processStatus, setProcessStatus] = useState('')
  const [processProgress, setProcessProgress] = useState({ done: 0, total: 0 })

  const pendingAds = ads.filter(a => !a.generated_prompt)
  const hasFalKey = !!localStorage.getItem('ck_fal_api_key')

  // Fetch described photos from photo library for the active brand
  async function getPhotoDescriptions() {
    try {
      let query = supabase
        .from('photo_library')
        .select('name, type, description, prompt_snippet')
        .not('description', 'is', null)
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data } = await query
      return data || []
    } catch (err) {
      console.error('Failed to fetch photo descriptions:', err)
      return []
    }
  }

  async function processAllPending() {
    const toProcess = pendingAds
    if (toProcess.length === 0) return
    setProcessing(true)
    setProcessProgress({ done: 0, total: toProcess.length })
    const falKey = localStorage.getItem('ck_fal_api_key')

    // Fetch photo descriptions once for the entire batch
    const photoDescs = await getPhotoDescriptions()

    for (let i = 0; i < toProcess.length; i++) {
      const ad = toProcess[i]
      setProcessStatus(`Processing ${i + 1}/${toProcess.length}: ${ad.advertiser_name || 'Ad'}...`)
      try {
        // Step 1: Generate prompt
        const promptRes = await fetch(`${supabaseUrl}/functions/v1/generate-ad-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({
            saved_ad_id: ad.id,
            advertiser_name: ad.advertiser_name,
            ad_copy: ad.ad_copy,
            image_url: ad.image_url,
            media_type: ad.media_type,
            ...(activeBrand ? {
              brand_name: activeBrand.name,
              brand_guidelines: activeBrand.guidelines_text || '',
              tone_of_voice: activeBrand.tone_of_voice || '',
              sleeve_notes: activeBrand.sleeve_notes || '',
              colour_palette: activeBrand.colour_palette || [],
              typography: activeBrand.typography || {},
              packaging_specs: activeBrand.packaging_specs || {},
            } : {}),
            photo_descriptions: photoDescs.length > 0 ? photoDescs : undefined,
          })
        })
        const promptData = await promptRes.json()
        if (!promptRes.ok || !promptData.prompt) throw new Error(promptData.error || 'No prompt')

        // Step 2: Generate image (if fal key exists)
        if (falKey) {
          setProcessStatus(`Generating image ${i + 1}/${toProcess.length}: ${ad.advertiser_name || 'Ad'}...`)
          const headers = { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' }
          const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
            method: 'POST', headers,
            body: JSON.stringify({ prompt: promptData.prompt.trim(), num_images: 1, aspect_ratio: '4:5', enable_safety_checker: false })
          })
          const submitData = await submitRes.json()
          if (submitData.request_id) {
            for (let j = 0; j < 60; j++) {
              await new Promise(r => setTimeout(r, 1500))
              const sRes = await fetch(`https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}/status`, { headers })
              const sData = await sRes.json()
              if (sData.status === 'COMPLETED') break
              if (sData.status === 'FAILED') throw new Error('Image generation failed')
            }
            const resultRes = await fetch(`https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}`, { headers })
            const resultData = await resultRes.json()
            const imageUrl = resultData?.images?.[0]?.url || resultData?.image?.url
            if (imageUrl) {
              await supabase.from('generated_versions').insert({
                saved_ad_id: ad.id, image_url: imageUrl,
                prompt: promptData.prompt.trim(), aspect_ratio: '4:5'
              })
              await supabase.from('saved_ads').update({
                generated_image_url: imageUrl,
                image_generated_at: new Date().toISOString()
              }).eq('id', ad.id)
            }
          }
        }
      } catch (err) {
        console.error(`Failed processing ${ad.advertiser_name}:`, err)
      }
      setProcessProgress({ done: i + 1, total: toProcess.length })
      if (onRefresh) onRefresh()
    }
    setProcessing(false)
    setProcessStatus(`Done. ${toProcess.length} ads processed.`)
    setTimeout(() => setProcessStatus(''), 5000)
  }

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'with-prompt', label: 'With Prompt' },
    { key: 'with-image', label: 'Generated' },
    { key: 'pending', label: 'Pending' },
  ]

  return (
    <>
      {/* Workflow context */}
      {ads.length > 0 && stats.withImages === 0 && (
        <div className="workflow-banner mb-lg">
          <div className="workflow-steps">
            <span className="workflow-step done">1. Save ads</span>
            <span className="workflow-arrow">{'\u2192'}</span>
            <span className={`workflow-step ${stats.withPrompt > 0 ? 'done' : 'current'}`}>2. Generate prompts</span>
            <span className="workflow-arrow">{'\u2192'}</span>
            <span className="workflow-step">3. Generate images</span>
            <span className="workflow-arrow">{'\u2192'}</span>
            <span className="workflow-step">4. Review + download</span>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 'var(--space-xs)', textAlign: 'center' }}>
            Click any ad to open it, or hit "Process {pendingAds.length} pending" to auto-generate prompts + images for all ads at once.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat stat-total">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">saved ads</span>
        </div>
        <div className="stat stat-prompts">
          <span className="stat-value">{stats.withPrompt}</span>
          <span className="stat-label">with prompts</span>
        </div>
        <div className="stat stat-images">
          <span className="stat-value">{stats.withImages}</span>
          <span className="stat-label">with images</span>
        </div>
      </div>

      {/* Filters + Process All */}
      <div className="flex-between mb-lg">
        <div className="filters">
          {filters.map(f => (
            <button
              key={f.key}
              className={`filter-pill ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {pendingAds.length > 0 && !processing && (
          <button className="btn btn-primary btn-sm" onClick={processAllPending}>
            Process {pendingAds.length} pending
          </button>
        )}
        {processing && (
          <span className="text-xs text-accent">
            <span className="spinner spinner-inline" style={{ marginRight: 'var(--space-xs)' }} />
            {processStatus}
          </span>
        )}
      </div>

      {/* Processing progress bar */}
      {processing && (
        <div className="progress-bar mb-lg">
          <div className="progress-fill" style={{ width: `${(processProgress.done / processProgress.total) * 100}%` }} />
        </div>
      )}

      {!processing && processStatus && (
        <p className="text-xs text-subtle mb-lg">{processStatus}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p>Pulling your saved ads from the kitchen...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && ads.length === 0 && (
        <div className="empty-state">
          <h3>The kitchen is empty</h3>
          <p>
            Save ads from the Facebook Ad Library using the Chrome extension.
            They'll land here, ready to cook with.
          </p>
          <div className="workflow-steps">
            <span className="workflow-step current">1. Save ads</span>
            <span className="workflow-arrow">→</span>
            <span className="workflow-step">2. Brand DNA</span>
            <span className="workflow-arrow">→</span>
            <span className="workflow-step">3. Generate</span>
            <span className="workflow-arrow">→</span>
            <span className="workflow-step">4. Review</span>
          </div>
          <p className="empty-state-hint">
            Install the Chrome extension to capture competitor ads from Meta Ad Library.
            Each ad becomes a template you can remix with your own brand.
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && ads.length > 0 && (
        <div className="gallery-grid">
          {ads.map(ad => (
            <AdCard
              key={ad.id}
              ad={ad}
              versions={versions[ad.id] || []}
              onClick={() => onSelectAd(ad.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function AdCard({ ad, versions, onClick }) {
  const hasPrompt = !!ad.generated_prompt
  const hasImage = !!ad.generated_image_url || versions.length > 0
  const latestImage = versions[0]?.image_url || ad.generated_image_url

  let badge = null
  if (hasImage) badge = <span className="ad-card-badge has-image">{versions.length || 1} version{versions.length !== 1 ? 's' : ''}</span>
  else if (hasPrompt) badge = <span className="ad-card-badge has-prompt">prompt ready</span>
  else badge = <span className="ad-card-badge pending">pending</span>

  const date = ad.created_at
    ? new Date(ad.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div className="card" onClick={onClick}>
      <div className="ad-card-image">
        {ad.image_url ? (
          <img src={ad.image_url} alt={ad.advertiser_name || 'Ad'} loading="lazy" />
        ) : (
          <div className="panel-placeholder">
            <p>No image</p>
          </div>
        )}
        {badge}
      </div>
      <div className="ad-card-body">
        <div className="ad-card-name">{ad.advertiser_name || 'Unknown brand'}</div>
        <div className="ad-card-meta">
          {date}
          {ad.platform && ` \u00b7 ${ad.platform}`}
          {ad.started_running && ` \u00b7 running since ${ad.started_running}`}
        </div>
        {versions.length > 0 && (
          <div className="ad-card-versions">
            {versions.slice(0, 5).map(v => (
              <div key={v.id} className="ad-card-version-dot">
                <img src={v.image_url} alt="" loading="lazy" />
              </div>
            ))}
            {versions.length > 5 && (
              <div className="ad-card-version-dot flex-center text-xs text-muted" style={{
                justifyContent: 'center', background: 'var(--bg-3)'
              }}>
                +{versions.length - 5}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
