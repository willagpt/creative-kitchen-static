import { useState, useEffect, useCallback, useRef } from 'react'
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

// ── Constants ──
const SORT_OPTIONS = [
  { value: 'longest', label: 'longest running' },
  { value: 'shortest', label: 'shortest running' },
  { value: 'newest', label: 'newest first' },
  { value: 'oldest', label: 'oldest first' },
  { value: 'impressions', label: 'most impressions' },
]

// How old cached data can be before we re-fetch (in hours)
const CACHE_MAX_AGE_HOURS = 12

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

// ── Helper: detect if a URL points to a video ──
function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm') || lower.includes('/video')
}

// ── Map a competitor_ads DB row to the frontend ad object ──
function mapDbAdToFrontend(ad, pageId, pageName) {
  const mediaUrl = ad.thumbnail_url || null
  const isVideo = isVideoUrl(mediaUrl)
  const impressionsText = fmtImpressions(ad.impressions_lower, ad.impressions_upper)

  return {
    adId: ad.id,
    adName: ad.creative_title || ad.creative_caption || 'Untitled Ad',
    adBody: ad.creative_body || '',
    adCaption: ad.creative_caption || '',
    adDescription: ad.creative_description || '',
    pageId: ad.page_id || pageId,
    pageName: ad.page_name || pageName,
    platform: 'Meta',
    creativeType: isVideo ? 'video' : 'image',
    mediaUrl,
    isVideo,
    adPreviewUrl: mediaUrl,
    impressionsText,
    impressionsLower: ad.impressions_lower || 0,
    impressionsUpper: ad.impressions_upper || 0,
    startDate: formatDate(ad.start_date),
    endDate: formatDate(ad.end_date),
    daysActive: ad.days_active || 0,
    status: ad.is_active ? 'active' : 'ended',
    isVideoContent: isVideo,
    platforms: ad.platforms || [],
    url: `https://www.facebook.com/ads/library/?ad_type=all&view_all_page_id=${ad.page_id || pageId}`,
  }
}

function extractPageId(input) {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const urlMatch = trimmed.match(/view_all_page_id=(\d+)/)
  if (urlMatch) return urlMatch[1]
  const idMatch = trimmed.match(/[?&]id=(\d+)/)
  if (idMatch) return idMatch[1]
  const pageIdFromPath = trimmed.match(/facebook\.com\/pages\/[^/]+\/(\d+)/)
  if (pageIdFromPath) return pageIdFromPath[1]
  const profileMatch = trimmed.match(/profile\.php\?id=(\d+)/)
  if (profileMatch) return profileMatch[1]
  return null
}

function getPagePictureUrl(pageId) {
  return `https://graph.facebook.com/${pageId}/picture?type=small`
}

// ── Supabase CRUD ──

async function fetchFollowedBrands() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_brands?order=created_at.desc`,
      { headers: sbReadHeaders }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => ({
      pageId: row.page_id,
      pageName: row.page_name,
      platforms: row.platforms || [],
      byline: row.byline || '',
      adCount: row.total_ads || row.ad_count || 0,
      country: row.country || 'GB',
      lastFetchedAt: row.last_fetched_at || null,
      thumbnailUrl: row.thumbnail_url || null,
    }))
  } catch { return [] }
}

async function saveBrandToSupabase(brand) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/followed_brands`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        page_id: brand.pageId,
        page_name: brand.pageName,
        platforms: brand.platforms || ['meta'],
        byline: brand.byline || '',
        country: brand.country || 'GB',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function updateBrandInSupabase(pageId, updates) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`,
      {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(updates),
      }
    )
    return res.ok
  } catch {
    return false
  }
}

async function deleteBrandFromSupabase(pageId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`,
      { method: 'DELETE', headers: sbHeaders }
    )
    return res.ok
  } catch {
    return false
  }
}

// ── Render ──

export default function CompetitorAds() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('metaAdLibraryToken') || '')
  const [results, setResults] = useState([])
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedCompetitorAds') || '[]') } catch { return [] }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savedExpanded, setSavedExpanded] = useState(true)
  const [followedBrands, setFollowedBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [modalAd, setModalAd] = useState(null)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [isCached, setIsCached] = useState(false)
  const [totalCount, setTotalCount] = useState(0)

  const hasKey = apiKey.length > 20

  useEffect(() => { fetchFollowedBrands().then(setFollowedBrands) }, [])
  useEffect(() => { if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('savedCompetitorAds', JSON.stringify(saved)) }, [saved])

  const sortAds = useCallback((ads, sort) => {
    return [...ads].sort((a, b) => {
      switch (sort) {
        case 'longest': return b.daysActive - a.daysActive
        case 'shortest': return a.daysActive - b.daysActive
        case 'newest': return new Date(b.startDate) - new Date(a.startDate)
        case 'oldest': return new Date(a.startDate) - new Date(b.startDate)
        case 'impressions': return (b.impressionsUpper || 0) - (a.impressionsUpper || 0)
        default: return 0
      }
    })
  }, [])

  // ── Check if brand cache is fresh enough ──
  function isCacheFresh(brand) {
    if (!brand.lastFetchedAt) return false
    const hoursAgo = (Date.now() - new Date(brand.lastFetchedAt).getTime()) / (1000 * 60 * 60)
    return hoursAgo < CACHE_MAX_AGE_HOURS
  }

  // ── Fetch ads for a brand from Supabase competitor_ads table ──
  async function fetchBrandAds(pageId, pageName) {
    setIsLoading(true)
    setError(null)
    setResults([])
    setLoadingProgress(0)
    setLoadingStatus('Loading ads...')
    setIsCached(false)

    try {
      setLoadingProgress(20)

      // Load ads from Supabase competitor_ads table
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}&order=days_active.desc&limit=200`,
        { headers: sbReadHeaders }
      )

      if (!res.ok) {
        throw new Error(`Failed to load ads (${res.status})`)
      }

      setLoadingProgress(60)
      setLoadingStatus('Processing...')

      const rows = await res.json()

      if (rows.length > 0) {
        const processed = rows.map(ad => mapDbAdToFrontend(ad, pageId, pageName))

        setLoadingProgress(100)
        setResults(processed)
        setTotalCount(processed.length)
        setLoadingStatus('Done')
        setIsCached(true)

        await updateBrandInSupabase(pageId, {
          last_fetched_at: new Date().toISOString(),
          total_ads: rows.length,
        })
      } else {
        // No cached data, try the Foreplay edge function
        setLoadingStatus('No cached ads. Fetching from Foreplay...')
        setLoadingProgress(40)

        const response = await fetch(FOREPLAY_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_id: pageId, limit: 50 }),
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Foreplay fetch failed (${response.status}): ${errText}`)
        }

        setLoadingProgress(70)
        const data = await response.json()

        // After edge function upserts, re-read from Supabase
        setLoadingStatus('Reading fetched ads...')
        setLoadingProgress(85)

        const reRes = await fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}&order=days_active.desc&limit=200`,
          { headers: sbReadHeaders }
        )

        if (reRes.ok) {
          const reRows = await reRes.json()
          const processed = reRows.map(ad => mapDbAdToFrontend(ad, pageId, pageName))
          setResults(processed)
          setTotalCount(processed.length)
        }

        setLoadingProgress(100)
        setLoadingStatus('Done')
      }
    } catch (err) {
      console.error('Fetch error:', err)
      setError(err.message || 'Failed to fetch ads.')
      setResults([])
    } finally {
      setIsLoading(false)
      setLoadingProgress(0)
    }
  }

  // ── Add brand to followed list ──
  async function handleAddBrand() {
    if (!addInput.trim()) return

    setAddLoading(true)
    setAddError(null)

    try {
      const pageId = extractPageId(addInput)
      if (!pageId) {
        setAddError('Invalid input. Please enter a valid page ID or Facebook URL.')
        setAddLoading(false)
        return
      }

      let pageName = 'Brand ' + pageId
      let picUrl = getPagePictureUrl(pageId)

      if (apiKey && apiKey.length > 20) {
        try {
          const metaRes = await fetch(`https://graph.facebook.com/${pageId}?access_token=${apiKey}&fields=name,picture`)
          if (metaRes.ok) {
            const pageData = await metaRes.json()
            pageName = pageData.name || pageName
            picUrl = pageData.picture?.data?.url || picUrl
          }
        } catch {}
      }

      const newBrand = {
        pageId,
        pageName,
        platforms: ['meta'],
        byline: '',
        country: 'GB',
        adCount: 0,
        lastFetchedAt: null,
        thumbnailUrl: picUrl,
      }

      const ok = await saveBrandToSupabase(newBrand)
      if (ok) {
        setFollowedBrands([newBrand, ...followedBrands])
        setAddInput('')
        setShowAddForm(false)
      } else {
        setAddError('Could not save brand. Please try again.')
      }
    } catch (err) {
      setAddError(err.message || 'Failed to add brand.')
    } finally {
      setAddLoading(false)
    }
  }

  // ── Remove brand ──
  async function handleRemoveBrand(pageId) {
    if (window.confirm('Remove this brand from your list?')) {
      await deleteBrandFromSupabase(pageId)
      setFollowedBrands(followedBrands.filter(b => b.pageId !== pageId))
      if (activeBrand?.pageId === pageId) {
        setActiveBrand(null)
        setResults([])
      }
    }
  }

  const handleSort = useCallback((sort) => {
    setResults(prev => sortAds(prev, sort))
  }, [sortAds])

  const openModal = (ad) => setModalAd(ad)
  const closeModal = () => setModalAd(null)

  const exportCSV = () => {
    const csv = [
      ['Ad ID', 'Ad Name', 'Brand', 'Type', 'Running Days', 'Impressions', 'Status', 'Start Date', 'End Date'].join(','),
      ...results.map(ad => [
        ad.adId,
        `"${(ad.adName || '').replace(/"/g, '""')}"`,
        `"${(ad.pageName || '').replace(/"/g, '""')}"`,
        ad.creativeType,
        ad.daysActive,
        ad.impressionsText || 'N/A',
        ad.status,
        ad.startDate,
        ad.endDate,
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `competitor-ads-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="competitor-ads-container">
      <div className="header">
        <h1>Competitor Ads Research</h1>
        <p className="subtitle">Track Meta ad activity by brand</p>
      </div>

      <div className="token-setup">
        <input
          type="password"
          placeholder="Meta token (optional, for adding brands)..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="token-input"
        />
        {hasKey && <span className="token-indicator">Token loaded</span>}
      </div>

      <div className="main-content">
        {/* ── Sidebar ── */}
        <div className="sidebar">
          <div className="followed-section">
            <div className="section-header" onClick={() => setSavedExpanded(!savedExpanded)}>
              <span>{savedExpanded ? '▼' : '▶'} Followed Brands ({followedBrands.length})</span>
            </div>
            {savedExpanded && (
              <div className="followed-list">
                {followedBrands.map(brand => (
                  <div
                    key={brand.pageId}
                    className={`brand-item ${activeBrand?.pageId === brand.pageId ? 'active' : ''}`}
                    onClick={() => {
                      setActiveBrand(brand)
                      fetchBrandAds(brand.pageId, brand.pageName)
                    }}
                  >
                    <div className="brand-info">
                      {brand.thumbnailUrl && (
                        <img src={brand.thumbnailUrl} alt={brand.pageName} className="brand-thumbnail" />
                      )}
                      <div className="brand-text">
                        <div className="brand-name">{brand.pageName}</div>
                        <div className="brand-meta">{brand.adCount} ads</div>
                      </div>
                    </div>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveBrand(brand.pageId)
                      }}
                    >
                      X
                    </button>
                  </div>
                ))}
                {followedBrands.length === 0 && (
                  <p className="empty-state">No brands followed yet. Add one to get started.</p>
                )}
              </div>
            )}
          </div>

          <div className="add-brand-section">
            {showAddForm ? (
              <div className="add-form">
                <input
                  type="text"
                  placeholder="Facebook page ID or URL..."
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  className="add-input"
                  disabled={addLoading}
                />
                <button
                  className="add-btn"
                  onClick={handleAddBrand}
                  disabled={addLoading || !addInput.trim()}
                >
                  {addLoading ? 'Adding...' : 'Add'}
                </button>
                <button
                  className="cancel-btn"
                  onClick={() => {
                    setShowAddForm(false)
                    setAddInput('')
                    setAddError(null)
                  }}
                >
                  Cancel
                </button>
                {addError && <p className="error-msg">{addError}</p>}
              </div>
            ) : (
              <button
                className="add-brand-btn"
                onClick={() => setShowAddForm(true)}
              >
                + Add Brand
              </button>
            )}
          </div>
        </div>

        {/* ── Results ── */}
        <div className="results-section">
          {activeBrand && (
            <div className="brand-header">
              {activeBrand.thumbnailUrl && (
                <img src={activeBrand.thumbnailUrl} alt={activeBrand.pageName} className="brand-thumbnail-large" />
              )}
              <div className="brand-info-large">
                <h2>{activeBrand.pageName}</h2>
                <p>{activeBrand.byline}</p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>{loadingStatus}</p>
              {loadingProgress > 0 && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${loadingProgress}%` }}></div>
                </div>
              )}
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <>
              <div className="results-toolbar">
                <div className="sort-controls">
                  <label>Sort by:</label>
                  <select onChange={(e) => handleSort(e.target.value)} defaultValue="longest">
                    {SORT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="action-buttons">
                  <span className="results-count">{totalCount} ads</span>
                  {isCached && <span className="cache-badge">Cached</span>}
                  <button className="export-btn" onClick={exportCSV}>
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="ads-grid">
                {results.map(ad => (
                  <div key={ad.adId} className="ad-card" onClick={() => openModal(ad)}>
                    {ad.isVideo && ad.mediaUrl ? (
                      <video
                        src={ad.mediaUrl}
                        className="ad-preview ad-preview-video"
                        muted
                        playsInline
                        preload="metadata"
                        onMouseOver={(e) => { try { e.target.play() } catch {} }}
                        onMouseOut={(e) => { try { e.target.pause(); e.target.currentTime = 0 } catch {} }}
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    ) : ad.mediaUrl && !ad.isVideo ? (
                      <img src={ad.mediaUrl} alt={ad.adName} className="ad-preview" onError={(e) => e.target.style.display = 'none'} />
                    ) : null}
                    <div className="ad-card-content">
                      <div className="ad-name">{ad.adName}</div>
                      <div className="ad-meta">
                        <span className="meta-type">{ad.isVideo ? '▶ video' : 'image'}</span>
                        <span className="meta-days">{ad.daysActive}d</span>
                        <span className={`meta-status ${ad.status}`}>{ad.status}</span>
                      </div>
                      {ad.impressionsText && (
                        <div className="ad-impressions">~{ad.impressionsText} impressions</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!isLoading && results.length === 0 && !error && !activeBrand && (
            <div className="empty-state">
              <p>Select a brand from the list to view their ads</p>
            </div>
          )}

          {!isLoading && results.length === 0 && !error && activeBrand && (
            <div className="empty-state">
              <p>No ads found for {activeBrand.pageName}</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p>{error}</p>
              {activeBrand && (
                <button onClick={() => fetchBrandAds(activeBrand.pageId, activeBrand.pageName)}>
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Ad Details Modal ── */}
      {modalAd && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>X</button>
            <div className="modal-body">
              <h3>{modalAd.adName}</h3>
              {modalAd.adBody && <p className="modal-ad-body">{modalAd.adBody}</p>}
              <p><strong>Brand:</strong> {modalAd.pageName}</p>
              <p><strong>Ad ID:</strong> {modalAd.adId}</p>
              <p><strong>Type:</strong> {modalAd.creativeType}</p>
              <p><strong>Duration:</strong> {modalAd.daysActive} days ({modalAd.startDate} to {modalAd.endDate})</p>
              {modalAd.impressionsText && <p><strong>Impressions:</strong> ~{modalAd.impressionsText}</p>}
              <p><strong>Status:</strong> {modalAd.status}</p>
              {modalAd.platforms && modalAd.platforms.length > 0 && (
                <p><strong>Platforms:</strong> {modalAd.platforms.join(', ')}</p>
              )}
              {modalAd.isVideo && modalAd.mediaUrl ? (
                <video
                  src={modalAd.mediaUrl}
                  controls
                  playsInline
                  style={{ maxWidth: '100%', marginTop: '12px', borderRadius: '8px' }}
                  onError={(e) => e.target.style.display = 'none'}
                />
              ) : modalAd.mediaUrl ? (
                <img src={modalAd.mediaUrl} alt={modalAd.adName} style={{ maxWidth: '100%', marginTop: '12px', borderRadius: '8px' }} onError={(e) => e.target.style.display = 'none'} />
              ) : null}
              <div className="modal-actions">
                <button
                  className="save-btn"
                  onClick={() => {
                    setSaved([...saved, modalAd])
                    closeModal()
                  }}
                >
                  Save Ad
                </button>
                <a href={modalAd.url} target="_blank" rel="noopener noreferrer" className="view-link-btn">
                  View on Meta
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
