import { useState, useEffect, useCallback } from 'react'
import './CompetitorAds.css'

// ── Supabase config ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'
const FOREPLAY_FN_URL = `${SUPABASE_URL}/functions/v1/fetch-competitor-ads`

const sbHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
}
const sbReadHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
}

// ── Helpers ──
function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

function fmtImpressions(lower, upper) {
  if (!lower && !upper) return null
  if (lower && upper) return formatNumber(lower) + ' to ' + formatNumber(upper)
  return formatNumber(upper || lower)
}

function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm')
}

function mapDbAd(ad, pageId, pageName) {
  const mediaUrl = ad.thumbnail_url || null
  const isVideo = isVideoUrl(mediaUrl)
  return {
    adId: ad.id,
    adName: ad.creative_title || 'Untitled Ad',
    adBody: ad.creative_body || '',
    adCaption: ad.creative_caption || '',
    adDescription: ad.creative_description || '',
    pageId: ad.page_id || pageId,
    pageName: ad.page_name || pageName,
    creativeType: isVideo ? 'video' : 'image',
    mediaUrl,
    isVideo,
    impressionsText: fmtImpressions(ad.impressions_lower, ad.impressions_upper),
    impressionsLower: ad.impressions_lower || 0,
    impressionsUpper: ad.impressions_upper || 0,
    startDate: formatDate(ad.start_date),
    endDate: formatDate(ad.end_date),
    rawStartDate: ad.start_date || null,
    rawEndDate: ad.end_date || null,
    daysActive: ad.days_active || 0,
    status: ad.is_active ? 'active' : 'ended',
    platforms: ad.platforms || [],
    url: `https://www.facebook.com/ads/library/?ad_type=all&view_all_page_id=${ad.page_id || pageId}`,
  }
}

function extractPageId(input) {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const m = trimmed.match(/view_all_page_id=(\d+)/) || trimmed.match(/[?&]id=(\d+)/) || trimmed.match(/facebook\.com\/pages\/[^/]+\/(\d+)/) || trimmed.match(/profile\.php\?id=(\d+)/)
  return m ? m[1] : null
}

// ── Paginated Supabase fetch (gets ALL rows, not just 1000) ──
async function fetchAllAds(pageId) {
  const PAGE_SIZE = 1000
  let allRows = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}&order=start_date.desc&offset=${offset}&limit=${PAGE_SIZE}`,
      { headers: sbReadHeaders }
    )
    if (!res.ok) throw new Error(`Failed to load (${res.status})`)
    const rows = await res.json()
    allRows = allRows.concat(rows)
    if (rows.length < PAGE_SIZE) {
      hasMore = false
    } else {
      offset += PAGE_SIZE
    }
  }
  return allRows
}

// ── Supabase CRUD ──
async function fetchFollowedBrands() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?order=created_at.desc`, { headers: sbReadHeaders })
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => ({
      pageId: row.page_id, pageName: row.page_name, platforms: row.platforms || [],
      byline: row.byline || '', adCount: row.total_ads || 0, country: row.country || 'GB',
      lastFetchedAt: row.last_fetched_at || null, thumbnailUrl: row.thumbnail_url || null,
    }))
  } catch { return [] }
}

async function saveBrand(brand) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({ page_id: brand.pageId, page_name: brand.pageName, platforms: brand.platforms || ['meta'], byline: '', country: 'GB' }),
    })
    return res.ok
  } catch { return false }
}

async function updateBrand(pageId, updates) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`, { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(updates) })
    return res.ok
  } catch { return false }
}

async function deleteBrand(pageId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`, { method: 'DELETE', headers: sbHeaders })
    return res.ok
  } catch { return false }
}

// ── Component ──
export default function CompetitorAds() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('metaAdLibraryToken') || '')
  const [allAds, setAllAds] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followedBrands, setFollowedBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [modalAd, setModalAd] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState('')

  // Filters
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const hasKey = apiKey.length > 20

  useEffect(() => { fetchFollowedBrands().then(setFollowedBrands) }, [])
  useEffect(() => { if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey) }, [apiKey])

  // Apply filters + sort
  const filteredAds = (() => {
    let ads = [...allAds]
    if (typeFilter === 'video') ads = ads.filter(a => a.isVideo)
    if (typeFilter === 'image') ads = ads.filter(a => !a.isVideo)
    if (statusFilter === 'active') ads = ads.filter(a => a.status === 'active')
    if (statusFilter === 'ended') ads = ads.filter(a => a.status === 'ended')
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      ads = ads.filter(a => (a.adName || '').toLowerCase().includes(q) || (a.adBody || '').toLowerCase().includes(q))
    }
    // Date range filter
    if (dateFrom) {
      const from = new Date(dateFrom)
      ads = ads.filter(a => a.rawStartDate && new Date(a.rawStartDate) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      ads = ads.filter(a => a.rawStartDate && new Date(a.rawStartDate) <= to)
    }
    ads.sort((a, b) => {
      switch (sortBy) {
        case 'longest': return b.daysActive - a.daysActive
        case 'shortest': return a.daysActive - b.daysActive
        case 'newest': return new Date(b.rawStartDate || 0) - new Date(a.rawStartDate || 0)
        case 'oldest': return new Date(a.rawStartDate || 0) - new Date(b.rawStartDate || 0)
        default: return 0
      }
    })
    return ads
  })()

  const videoCount = allAds.filter(a => a.isVideo).length
  const imageCount = allAds.filter(a => !a.isVideo).length
  const activeCount = allAds.filter(a => a.status === 'active').length

  // ── Fetch ads (paginated, gets ALL) ──
  async function fetchBrandAds(pageId, pageName) {
    setIsLoading(true)
    setError(null)
    setAllAds([])
    setLoadingStatus('Loading ads...')

    try {
      const rows = await fetchAllAds(pageId)

      if (rows.length > 0) {
        setLoadingStatus(`Processing ${rows.length} ads...`)
        setAllAds(rows.map(ad => mapDbAd(ad, pageId, pageName)))
        setLoadingStatus('')
        await updateBrand(pageId, { last_fetched_at: new Date().toISOString(), total_ads: rows.length })
      } else {
        setLoadingStatus('Fetching from Foreplay...')
        await fetch(FOREPLAY_FN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_id: pageId, limit: 50 }),
        })
        const reRows = await fetchAllAds(pageId)
        setAllAds(reRows.map(ad => mapDbAd(ad, pageId, pageName)))
        setLoadingStatus('')
      }
    } catch (err) {
      setError(err.message)
      setAllAds([])
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  async function handleAddBrand() {
    if (!addInput.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const pageId = extractPageId(addInput)
      if (!pageId) { setAddError('Invalid page ID or URL.'); setAddLoading(false); return }
      let pageName = 'Brand ' + pageId
      if (hasKey) {
        try {
          const r = await fetch(`https://graph.facebook.com/${pageId}?access_token=${apiKey}&fields=name`)
          if (r.ok) { const d = await r.json(); pageName = d.name || pageName }
        } catch {}
      }
      const nb = { pageId, pageName, platforms: ['meta'], adCount: 0, lastFetchedAt: null, thumbnailUrl: null }
      if (await saveBrand(nb)) { setFollowedBrands([nb, ...followedBrands]); setAddInput(''); setShowAddForm(false) }
      else setAddError('Could not save brand.')
    } catch (err) { setAddError(err.message) }
    finally { setAddLoading(false) }
  }

  async function handleRemoveBrand(pageId) {
    if (!window.confirm('Remove this brand?')) return
    await deleteBrand(pageId)
    setFollowedBrands(followedBrands.filter(b => b.pageId !== pageId))
    if (activeBrand?.pageId === pageId) { setActiveBrand(null); setAllAds([]) }
  }

  function clearDateRange() {
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="ca-container">
      {/* ── Header ── */}
      <div className="ca-header">
        <h1>Competitor Ads</h1>
        <div className="ca-token-row">
          <input type="password" placeholder="Meta token (optional)..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="ca-token-input" />
          {hasKey && <span className="ca-token-ok">Connected</span>}
        </div>
      </div>

      <div className="ca-layout">
        {/* ── Sidebar ── */}
        <aside className="ca-sidebar">
          <div className="ca-sidebar-title">Brands ({followedBrands.length})</div>
          <div className="ca-brand-list">
            {followedBrands.map(b => (
              <div key={b.pageId} className={`ca-brand-row ${activeBrand?.pageId === b.pageId ? 'active' : ''}`}
                onClick={() => { setActiveBrand(b); fetchBrandAds(b.pageId, b.pageName) }}>
                <div className="ca-brand-row-info">
                  <span className="ca-brand-row-name">{b.pageName}</span>
                  <span className="ca-brand-row-count">{b.adCount} ads</span>
                </div>
                <button className="ca-brand-row-x" onClick={e => { e.stopPropagation(); handleRemoveBrand(b.pageId) }}>x</button>
              </div>
            ))}
          </div>
          {showAddForm ? (
            <div className="ca-add-form">
              <input type="text" placeholder="Page ID or URL..." value={addInput} onChange={e => setAddInput(e.target.value)} className="ca-add-input" disabled={addLoading} />
              <div className="ca-add-btns">
                <button onClick={handleAddBrand} disabled={addLoading || !addInput.trim()} className="ca-btn-primary">{addLoading ? '...' : 'Add'}</button>
                <button onClick={() => { setShowAddForm(false); setAddInput(''); setAddError(null) }} className="ca-btn-ghost">Cancel</button>
              </div>
              {addError && <p className="ca-add-err">{addError}</p>}
            </div>
          ) : (
            <button className="ca-btn-add" onClick={() => setShowAddForm(true)}>+ Add Brand</button>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="ca-main">
          {activeBrand && (
            <div className="ca-brand-bar">
              <div>
                <h2 className="ca-brand-bar-name">{activeBrand.pageName}</h2>
                <span className="ca-brand-bar-stats">{allAds.length} total, {videoCount} videos, {imageCount} images, {activeCount} active</span>
              </div>
            </div>
          )}

          {/* Filters */}
          {allAds.length > 0 && (
            <div className="ca-filters">
              <div className="ca-filter-pills">
                {[['all', 'All'], ['video', `Video (${videoCount})`], ['image', `Image (${imageCount})`]].map(([val, label]) => (
                  <button key={val} className={`ca-pill ${typeFilter === val ? 'active' : ''}`} onClick={() => setTypeFilter(val)}>{label}</button>
                ))}
                <span className="ca-filter-sep">|</span>
                {[['all', 'All status'], ['active', `Active (${activeCount})`], ['ended', `Ended`]].map(([val, label]) => (
                  <button key={val} className={`ca-pill ${statusFilter === val ? 'active' : ''}`} onClick={() => setStatusFilter(val)}>{label}</button>
                ))}
              </div>
              <div className="ca-filter-right">
                <input type="text" placeholder="Search copy..." value={searchText} onChange={e => setSearchText(e.target.value)} className="ca-search" />
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="ca-sort-select">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="longest">Longest running</option>
                  <option value="shortest">Shortest running</option>
                </select>
              </div>
            </div>
          )}

          {/* Date range */}
          {allAds.length > 0 && (
            <div className="ca-date-range">
              <span className="ca-date-label">Date range</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="ca-date-input" />
              <span className="ca-date-to">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="ca-date-input" />
              {(dateFrom || dateTo) && (
                <button className="ca-date-clear" onClick={clearDateRange}>Clear</button>
              )}
              {(dateFrom || dateTo) && (
                <span className="ca-date-count">{filteredAds.length} ads in range</span>
              )}
            </div>
          )}

          {/* Loading */}
          {isLoading && <div className="ca-loading"><div className="ca-spin"></div><span>{loadingStatus}</span></div>}

          {/* Error */}
          {error && <div className="ca-error-msg">{error} <button onClick={() => fetchBrandAds(activeBrand.pageId, activeBrand.pageName)}>Retry</button></div>}

          {/* Grid */}
          {!isLoading && filteredAds.length > 0 && (
            <div className="ca-grid">
              {filteredAds.map(ad => (
                <div key={ad.adId} className="ca-card" onClick={() => setModalAd(ad)}>
                  <div className="ca-card-media">
                    {ad.isVideo && ad.mediaUrl ? (
                      <video src={ad.mediaUrl} className="ca-card-thumb" muted playsInline preload="metadata"
                        onMouseOver={e => { try { e.target.play() } catch {} }}
                        onMouseOut={e => { try { e.target.pause(); e.target.currentTime = 0 } catch {} }}
                        onError={e => { e.target.parentElement.classList.add('no-media') }} />
                    ) : ad.mediaUrl ? (
                      <img src={ad.mediaUrl} alt="" className="ca-card-thumb"
                        onError={e => { e.target.parentElement.classList.add('no-media') }} />
                    ) : <div className="ca-card-no-thumb">No preview</div>}
                    {ad.isVideo && <div className="ca-card-play">▶</div>}
                    <div className="ca-card-overlay">
                      <span className="ca-card-expand">Click to expand</span>
                    </div>
                  </div>
                  <div className="ca-card-body">
                    <div className="ca-card-title">{ad.adName}</div>
                    <div className="ca-card-tags">
                      <span className={`ca-tag ${ad.isVideo ? 'video' : 'image'}`}>{ad.isVideo ? '▶ video' : 'image'}</span>
                      <span className="ca-tag days">{ad.daysActive}d</span>
                      <span className={`ca-tag status-${ad.status}`}>{ad.status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && filteredAds.length === 0 && allAds.length > 0 && (
            <div className="ca-empty">No ads match your filters</div>
          )}
          {!isLoading && allAds.length === 0 && !error && !activeBrand && (
            <div className="ca-empty">Select a brand to view their ads</div>
          )}
          {!isLoading && allAds.length === 0 && !error && activeBrand && !isLoading && (
            <div className="ca-empty">No ads found for {activeBrand.pageName}</div>
          )}
        </main>
      </div>

      {/* ── Modal ── */}
      {modalAd && (
        <div className="ca-modal-bg" onClick={() => setModalAd(null)}>
          <div className="ca-modal" onClick={e => e.stopPropagation()}>
            <button className="ca-modal-x" onClick={() => setModalAd(null)}>x</button>

            <div className="ca-modal-media">
              {modalAd.isVideo && modalAd.mediaUrl ? (
                <video src={modalAd.mediaUrl} controls playsInline autoPlay className="ca-modal-video" />
              ) : modalAd.mediaUrl ? (
                <img src={modalAd.mediaUrl} alt="" className="ca-modal-img" />
              ) : null}
            </div>

            <div className="ca-modal-detail">
              <h3 className="ca-modal-title">{modalAd.adName}</h3>
              {modalAd.adBody && <div className="ca-modal-body">{modalAd.adBody}</div>}
              {modalAd.adCaption && <div className="ca-modal-caption">{modalAd.adCaption}</div>}

              <div className="ca-modal-meta-grid">
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Brand</span><span>{modalAd.pageName}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Ad ID</span><span>{modalAd.adId}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Type</span><span>{modalAd.creativeType}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Running</span><span>{modalAd.daysActive} days</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Dates</span><span>{modalAd.startDate} to {modalAd.endDate || 'now'}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Status</span><span className={`ca-status-dot ${modalAd.status}`}>{modalAd.status}</span></div>
                {modalAd.platforms.length > 0 && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Platforms</span><span>{modalAd.platforms.join(', ')}</span></div>
                )}
              </div>

              <div className="ca-modal-actions">
                <a href={modalAd.url} target="_blank" rel="noopener noreferrer" className="ca-btn-primary">View on Meta</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
