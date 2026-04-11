import { useState, useEffect, useRef } from 'react'
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

const GRID_PAGE = 50

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
  const videoUrl = ad.video_url || null
  const displayFormat = (ad.display_format || '').toUpperCase()

  // Use display_format from DB if available, otherwise infer from URL
  let isVideo = false
  let creativeType = 'unknown'
  if (displayFormat === 'VIDEO') {
    isVideo = true
    creativeType = 'video'
  } else if (displayFormat === 'IMAGE') {
    isVideo = false
    creativeType = 'image'
  } else if (displayFormat === 'DCO') {
    // DCO cards can be video or image — check the media URLs
    isVideo = isVideoUrl(mediaUrl) || !!videoUrl
    creativeType = isVideo ? 'video' : 'image'
  } else {
    isVideo = isVideoUrl(mediaUrl)
    creativeType = !mediaUrl ? 'unknown' : isVideo ? 'video' : 'image'
  }

  const hasMedia = !!mediaUrl

  return {
    adId: ad.id,
    adName: ad.creative_title || 'Untitled Ad',
    adBody: ad.creative_body || '',
    adCaption: ad.creative_caption || '',
    adDescription: ad.creative_description || '',
    pageId: ad.page_id || pageId,
    pageName: ad.page_name || pageName,
    displayFormat,
    creativeType,
    mediaUrl,
    videoUrl: videoUrl || (isVideo ? mediaUrl : null),
    isVideo,
    hasMedia,
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
    creativeTargeting: ad.creative_targeting || null,
    emotionalDrivers: ad.emotional_drivers || null,
    ctaType: ad.cta_type || null,
    cardIndex: ad.card_index,
    url: `https://www.facebook.com/ads/library/?ad_type=all&view_all_page_id=${ad.page_id || pageId}`,
  }
}

function extractPageId(input) {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const m = trimmed.match(/view_all_page_id=(\d+)/) || trimmed.match(/[?&]id=(\d+)/) || trimmed.match(/facebook\.com\/pages\/[^/]+\/(\d+)/) || trimmed.match(/profile\.php\?id=(\d+)/)
  return m ? m[1] : null
}

// ── Paginated Supabase fetch ──
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
    hasMore = rows.length === PAGE_SIZE
    offset += PAGE_SIZE
  }
  return allRows
}

// ── Inline Video Card ──
// Plays video directly in the grid card. Click to play/pause.
function InlineVideoCard({ src, onClick }) {
  const wrapRef = useRef(null)
  const vidRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: '200px 0px', threshold: 0 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (visible && src && !failed) {
      if (!v.src || v.src !== src) { v.src = src; v.load() }
    } else if (!visible && v.src) {
      v.pause(); v.removeAttribute('src'); v.load()
      setPlaying(false)
    }
  }, [visible, src, failed])

  function handleVideoClick(e) {
    e.stopPropagation()
    const v = vidRef.current
    if (!v || !v.src) return
    if (v.paused) {
      v.muted = false
      v.play().catch(() => {})
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  return (
    <div ref={wrapRef} className="ca-lazy-video-wrap">
      {!failed && (
        <video
          ref={vidRef}
          muted
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          className={'ca-lazy-video' + (hasFrame ? ' loaded' : '')}
          onLoadedData={() => setHasFrame(true)}
          onError={() => setFailed(true)}
          onEnded={() => setPlaying(false)}
          onClick={handleVideoClick}
        />
      )}
      {(!hasFrame || failed) && (
        <div className="ca-video-placeholder-mini" onClick={handleVideoClick}>
          <div className="ca-video-play-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          </div>
          {failed && <div className="ca-video-label">VIDEO</div>}
          {!failed && !hasFrame && visible && (
            <div className="ca-video-loading-dot"><span></span></div>
          )}
        </div>
      )}
      {hasFrame && !playing && !failed && (
        <div className="ca-video-play-overlay" onClick={handleVideoClick}>
          <div className="ca-video-play-btn">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          </div>
        </div>
      )}
      {hasFrame && (
        <button className="ca-card-detail-btn" onClick={onClick} title="View details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
      )}
    </div>
  )
}

// ── Supabase CRUD ──
async function fetchFollowedBrands() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?order=created_at.desc`, { headers: sbReadHeaders })
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => (
      {
        pageId: row.page_id, pageName: row.page_name, platforms: row.platforms || [],
        byline: row.byline || '', adCount: row.total_ads || 0, country: row.country || 'GB',
        lastFetchedAt: row.last_fetched_at || null, thumbnailUrl: row.thumbnail_url || null,
      }
    ))
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
  const [showCount, setShowCount] = useState(GRID_PAGE)

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const hasKey = apiKey.length > 20

  useEffect(() => { fetchFollowedBrands().then(setFollowedBrands) }, [])
  useEffect(() => { if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey) }, [apiKey])
  useEffect(() => { setShowCount(GRID_PAGE) }, [typeFilter, statusFilter, sortBy, searchText, dateFrom, dateTo])

  const filteredAds = (() => {
    let ads = [...allAds]
    if (typeFilter === 'video') ads = ads.filter(a => a.isVideo)
    if (typeFilter === 'image') ads = ads.filter(a => !a.isVideo && a.hasMedia)
    if (statusFilter === 'active') ads = ads.filter(a => a.status === 'active')
    if (statusFilter === 'ended') ads = ads.filter(a => a.status === 'ended')
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      ads = ads.filter(a => (a.adName || '').toLowerCase().includes(q) || (a.adBody || '').toLowerCase().includes(q))
    }
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

  const pageAds = filteredAds.slice(0, showCount)
  const remaining = filteredAds.length - showCount

  const videoCount = allAds.filter(a => a.isVideo).length
  const imageCount = allAds.filter(a => !a.isVideo && a.hasMedia).length
  const activeCount = allAds.filter(a => a.status === 'active').length

  async function fetchBrandAds(pageId, pageName) {
    setIsLoading(true)
    setError(null)
    setAllAds([])
    setShowCount(GRID_PAGE)
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

  function handleImgError(e) {
    const img = e.target
    img.style.display = 'none'
    const fallback = img.parentElement.querySelector('.ca-img-fallback')
    if (fallback) fallback.style.display = 'flex'
  }

  function openModal(ad, e) {
    if (e) e.stopPropagation()
    setModalAd(ad)
  }

  return (
    <div className="ca-container">
      <div className="ca-header">
        <h1>Competitor Ads</h1>
        <div className="ca-header-actions">
          <button className="ca-btn-add-competitor" onClick={() => setShowAddForm(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Competitor
          </button>
          <div className="ca-token-row">
            <input type="password" placeholder="Meta token (optional)..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="ca-token-input" />
            {hasKey && <span className="ca-token-ok">Connected</span>}
          </div>
        </div>
      </div>

      {/* Add competitor modal */}
      {showAddForm && (
        <div className="ca-add-modal-bg" onClick={() => { setShowAddForm(false); setAddInput(''); setAddError(null) }}>
          <div className="ca-add-modal" onClick={e => e.stopPropagation()}>
            <h3>Add Competitor</h3>
            <p className="ca-add-modal-desc">Enter a Facebook Page ID or Ad Library URL</p>
            <input
              type="text"
              placeholder="e.g. 187701838409772 or facebook.com/ads/library/?view_all_page_id=..."
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              className="ca-add-modal-input"
              disabled={addLoading}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleAddBrand()}
            />
            {addError && <p className="ca-add-err">{addError}</p>}
            <div className="ca-add-modal-btns">
              <button onClick={() => { setShowAddForm(false); setAddInput(''); setAddError(null) }} className="ca-btn-ghost">Cancel</button>
              <button onClick={handleAddBrand} disabled={addLoading || !addInput.trim()} className="ca-btn-primary">{addLoading ? 'Adding...' : 'Add Competitor'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="ca-layout">
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
          <button className="ca-btn-add" onClick={() => setShowAddForm(true)}>+ Add Brand</button>
        </aside>

        <main className="ca-main">
          {activeBrand && (
            <div className="ca-brand-bar">
              <h2 className="ca-brand-bar-name">{activeBrand.pageName}</h2>
              <span className="ca-brand-bar-stats">{allAds.length} total, {videoCount} videos, {imageCount} images, {activeCount} active</span>
            </div>
          )}

          {allAds.length > 0 && (
            <div className="ca-filters">
              <div className="ca-filter-pills">
                {[['all', 'All'], ['video', `Video (${videoCount})`], ['image', `Image (${imageCount})`]].map(([val, label]) => (
                  <button key={val} className={`ca-pill ${typeFilter === val ? 'active' : ''}`} onClick={() => setTypeFilter(val)}>{label}</button>
                ))}
                <span className="ca-filter-sep">|</span>
                {[['all', 'All status'], ['active', `Active (${activeCount})`], ['ended', 'Ended']].map(([val, label]) => (
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

          {allAds.length > 0 && (
            <div className="ca-date-range">
              <span className="ca-date-label">Date range</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="ca-date-input" />
              <span className="ca-date-to">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="ca-date-input" />
              {(dateFrom || dateTo) && <button className="ca-date-clear" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</button>}
              {(dateFrom || dateTo) && <span className="ca-date-count">{filteredAds.length} ads in range</span>}
            </div>
          )}

          {isLoading && <div className="ca-loading"><div className="ca-spin"></div><span>{loadingStatus}</span></div>}
          {error && <div className="ca-error-msg">{error} <button onClick={() => fetchBrandAds(activeBrand.pageId, activeBrand.pageName)}>Retry</button></div>}

          {!isLoading && filteredAds.length > 0 && (
            <>
              <div className="ca-showing">Showing {Math.min(showCount, filteredAds.length)} of {filteredAds.length}</div>
              <div className="ca-grid">
                {pageAds.map(ad => (
                  <div key={ad.adId} className="ca-card">
                    <div className="ca-card-media">
                      {ad.isVideo && ad.mediaUrl ? (
                        <InlineVideoCard src={ad.videoUrl || ad.mediaUrl} onClick={(e) => openModal(ad, e)} />
                      ) : ad.isVideo ? (
                        <div className="ca-video-placeholder-mini" onClick={() => setModalAd(ad)}>
                          <div className="ca-video-play-btn">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                          </div>
                          <div className="ca-video-label">VIDEO</div>
                        </div>
                      ) : ad.mediaUrl ? (
                        <div onClick={() => setModalAd(ad)}>
                          <img src={ad.mediaUrl} alt="" className="ca-card-thumb" loading="lazy" onError={handleImgError} />
                          <div className="ca-img-fallback" style={{display:'none'}}>
                            <span className="ca-fallback-text">{ad.adName || 'Image unavailable'}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="ca-no-preview" onClick={() => setModalAd(ad)}>
                          <span>No preview available</span>
                        </div>
                      )}
                      {/* Detail overlay for non-video cards */}
                      {!ad.isVideo && (
                        <div className="ca-card-overlay" onClick={() => setModalAd(ad)}>
                          <span className="ca-card-expand">Click to expand</span>
                        </div>
                      )}
                    </div>
                    <div className="ca-card-body" onClick={() => setModalAd(ad)}>
                      <div className="ca-card-title">{ad.adName}</div>
                      <div className="ca-card-tags">
                        <span className={`ca-tag ${ad.isVideo ? 'video' : 'image'}`}>
                          {ad.displayFormat === 'DCO' ? (ad.isVideo ? '\u25B6 DCO' : 'DCO') : ad.isVideo ? '\u25B6 video' : 'image'}
                        </span>
                        <span className="ca-tag days">{ad.daysActive}d</span>
                        <span className={`ca-tag status-${ad.status}`}>{ad.status}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {remaining > 0 && (
                <button className="ca-load-more" onClick={() => setShowCount(c => c + GRID_PAGE)}>
                  Load more ({remaining > 0 ? remaining : 0} remaining)
                </button>
              )}
            </>
          )}

          {!isLoading && filteredAds.length === 0 && allAds.length > 0 && <div className="ca-empty">No ads match your filters</div>}
          {!isLoading && allAds.length === 0 && !error && !activeBrand && <div className="ca-empty">Select a brand to view their ads</div>}
          {!isLoading && allAds.length === 0 && !error && activeBrand && <div className="ca-empty">No ads found for {activeBrand.pageName}</div>}
        </main>
      </div>

      {/* Detail modal */}
      {modalAd && (
        <div className="ca-modal-bg" onClick={() => setModalAd(null)}>
          <div className="ca-modal" onClick={e => e.stopPropagation()}>
            <button className="ca-modal-x" onClick={() => setModalAd(null)}>x</button>
            <div className="ca-modal-media">
              {modalAd.isVideo && (modalAd.videoUrl || modalAd.mediaUrl) ? (
                <video
                  src={modalAd.videoUrl || modalAd.mediaUrl}
                  controls
                  playsInline
                  webkit-playsinline="true"
                  x-webkit-airplay="allow"
                  autoPlay
                  muted
                  className="ca-modal-video"
                />
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
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Type</span><span>{modalAd.displayFormat || modalAd.creativeType}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Running</span><span>{modalAd.daysActive} days</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Dates</span><span>{modalAd.startDate} to {modalAd.endDate || 'now'}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Status</span><span className={`ca-status-dot ${modalAd.status}`}>{modalAd.status}</span></div>
                {modalAd.platforms.length > 0 && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Platforms</span><span>{modalAd.platforms.join(', ')}</span></div>
                )}
                {modalAd.creativeTargeting && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Targeting</span><span>{modalAd.creativeTargeting}</span></div>
                )}
                {modalAd.ctaType && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">CTA</span><span>{modalAd.ctaType}</span></div>
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
