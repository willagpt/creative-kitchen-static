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

// ── Brand colours for multi-brand comparison ──
const BRAND_COLORS = [
  { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', border: '#6366f1' },
  { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: '#ec4899' },
  { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', border: '#22c55e' },
  { bg: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24', border: '#f59e0b' },
  { bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8', border: '#0ea5e9' },
  { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: '#a855f7' },
  { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: '#f43f5e' },
  { bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf', border: '#14b8a6' },
]

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

  let isVideo = false
  let creativeType = 'unknown'
  if (displayFormat === 'VIDEO') {
    isVideo = true
    creativeType = 'video'
  } else if (displayFormat === 'IMAGE') {
    isVideo = false
    creativeType = 'image'
  } else if (displayFormat === 'DCO') {
    isVideo = isVideoUrl(mediaUrl) || !!videoUrl
    creativeType = isVideo ? 'video' : 'image'
  } else {
    isVideo = isVideoUrl(mediaUrl)
    creativeType = !mediaUrl ? 'unknown' : isVideo ? 'video' : 'image'
  }

  const hasMedia = !!mediaUrl
  const impMid = ((ad.impressions_lower || 0) + (ad.impressions_upper || 0)) / 2
  const daysActive = ad.days_active || 0
  const velocity = daysActive > 0 ? impMid / daysActive : 0

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
    daysActive,
    velocity: parseFloat(velocity.toFixed(1)),
    startDate: ad.start_date || null,
    endDate: ad.end_date || null,
    isActive: ad.is_active === true || ad.is_active === 'true',
    platforms: ad.platforms || [],
    categories: ad.categories || [],
    personas: ad.persona ? (Array.isArray(ad.persona) ? ad.persona : [ad.persona]) : [],
    emotionalDrivers: ad.emotional_drivers || [],
    contentFilter: ad.content_filter || null,
    creativeTargeting: ad.creative_targeting || null,
    languages: ad.languages || [],
    marketTarget: ad.market_target || null,
    niches: ad.niches || [],
    ctaType: ad.cta_type || null,
    linkUrl: ad.link_url || null,
  }
}

function calcPercentile(value, allValues) {
  if (!allValues.length) return 0
  const sorted = allValues.slice().sort((a, b) => a - b)
  let count = 0
  for (const v of sorted) {
    if (v <= value) count++
  }
  return Math.round((count / sorted.length) * 100)
}

// ── Main Component ──
export default function CompetitorAds() {
  const [view, setView] = useState('all')
  const [brands, setBrands] = useState([])
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [ads, setAds] = useState([])
  const [filteredAds, setFilteredAds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [selectedModal, setSelectedModal] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newPageId, setNewPageId] = useState('')
  const [newPageName, setNewPageName] = useState('')
  const [addError, setAddError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterFormat, setFilterFormat] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [topSelectedBrands, setTopSelectedBrands] = useState([])
  const [topPercentile, setTopPercentile] = useState(50)
  const mainRef = useRef(null)

  // ── Load brands ──
  useEffect(() => {
    const loadBrands = async () => {
      try {
        const q = `SELECT DISTINCT page_id, page_name FROM competitor_ads WHERE page_id IS NOT NULL AND page_name IS NOT NULL ORDER BY page_name`
        const res = await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads?select=page_id,page_name&distinct=true&order=page_name.asc`, {
          headers: sbReadHeaders,
        })
        if (!res.ok) throw new Error('Failed to load brands')
        const data = await res.json()
        const uniqueBrands = []
        const seen = new Set()
        for (const row of data) {
          if (!seen.has(row.page_id)) {
            seen.add(row.page_id)
            uniqueBrands.push({ pageId: row.page_id, pageName: row.page_name })
          }
        }
        setBrands(uniqueBrands)
        if (uniqueBrands.length > 0) {
          setSelectedBrand(uniqueBrands[0])
        }
      } catch (err) {
        console.error('Error loading brands:', err)
        setError('Failed to load brands')
      }
    }
    loadBrands()
  }, [])

  // ── Load ads for selected brand ──
  useEffect(() => {
    if (!selectedBrand || view !== 'all') return

    const loadAds = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${selectedBrand.pageId}&limit=1000&offset=0`,
          { headers: sbReadHeaders }
        )
        if (!res.ok) throw new Error('Failed to load ads')
        const data = await res.json()
        const mapped = data.map((ad) => mapDbAd(ad, selectedBrand.pageId, selectedBrand.pageName))
        setAds(mapped)
        setPage(0)
      } catch (err) {
        console.error('Error loading ads:', err)
        setError('Failed to load ads')
      } finally {
        setLoading(false)
      }
    }
    loadAds()
  }, [selectedBrand, view])

  // ── Filter and sort ads ──
  useEffect(() => {
    let result = [...ads]

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (ad) =>
          ad.adName.toLowerCase().includes(q) ||
          ad.adBody.toLowerCase().includes(q) ||
          ad.pageName.toLowerCase().includes(q)
      )
    }

    // Format filter
    if (filterFormat !== 'all') {
      result = result.filter((ad) => ad.creativeType === filterFormat)
    }

    // Date range
    if (dateRange.start || dateRange.end) {
      result = result.filter((ad) => {
        const start = ad.startDate ? new Date(ad.startDate) : null
        const end = ad.endDate ? new Date(ad.endDate) : null
        const filterStart = dateRange.start ? new Date(dateRange.start) : null
        const filterEnd = dateRange.end ? new Date(dateRange.end) : null

        if (filterStart && end && end < filterStart) return false
        if (filterEnd && start && start > filterEnd) return false
        return true
      })
    }

    // Sort
    if (sortBy === 'newest') {
      result.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))
    } else if (sortBy === 'impressions') {
      result.sort((a, b) => b.impressionsUpper - a.impressionsUpper)
    } else if (sortBy === 'velocity') {
      result.sort((a, b) => b.velocity - a.velocity)
    }

    setFilteredAds(result)
  }, [ads, searchQuery, filterFormat, dateRange, sortBy])

  // ── Top Performers logic ──
  const allTopAds = (() => {
    if (view !== 'top' || topSelectedBrands.length === 0) return []

    const map = {}
    for (const brand of topSelectedBrands) {
      const brandAds = brands
        .filter((b) => b.pageId === brand)
        .length
      if (brandAds) {
        const res = fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${brand}&limit=1000&offset=0`,
          { headers: sbReadHeaders }
        )
          .then((r) => r.json())
          .then((ads) => ads.map((ad) => mapDbAd(ad, brand, brands.find((b) => b.pageId === brand)?.pageName || 'Unknown')))
          .catch(() => [])
        map[brand] = res
      }
    }
    return Object.values(map)
  })()

  const loadTopPerformers = async () => {
    if (topSelectedBrands.length === 0) return

    setLoading(true)
    setError('')
    try {
      const allAds = []
      for (const brandId of topSelectedBrands) {
        const brandName = brands.find((b) => b.pageId === brandId)?.pageName || 'Unknown'
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${brandId}&limit=2000&offset=0`,
          { headers: sbReadHeaders }
        )
        if (!res.ok) continue
        const data = await res.json()
        const mapped = data.map((ad) => mapDbAd(ad, brandId, brandName))
        allAds.push(...mapped)
      }

      // Calculate velocities for percentile
      const velocities = allAds.map((ad) => ad.velocity)
      const percentile = calcPercentile(topPercentile, velocities)
      const minVelocity = velocities.length > 0 ? velocities.sort((a, b) => b - a)[Math.floor(velocities.length * (topPercentile / 100))] : 0

      // Filter by percentile
      const filtered = allAds.filter((ad) => ad.velocity >= minVelocity)

      setFilteredAds(filtered.sort((a, b) => b.velocity - a.velocity))
      setPage(0)
    } catch (err) {
      console.error('Error loading top performers:', err)
      setError('Failed to load top performers')
    } finally {
      setLoading(false)
    }
  }

  // ── Add brand ──
  const handleAddBrand = async () => {
    if (!newPageId.trim() || !newPageName.trim()) {
      setAddError('Page ID and name required')
      return
    }
    setAddError('')
    try {
      // Insert into followed_brands (if table exists)
      // Otherwise just add to local state
      const newBrand = { pageId: newPageId.trim(), pageName: newPageName.trim() }
      setBrands([...brands, newBrand])
      setSelectedBrand(newBrand)
      setNewPageId('')
      setNewPageName('')
      setShowAddModal(false)
    } catch (err) {
      setAddError('Failed to add brand')
    }
  }

  const handleDeleteBrand = (pageId) => {
    const updated = brands.filter((b) => b.pageId !== pageId)
    setBrands(updated)
    if (selectedBrand?.pageId === pageId) {
      setSelectedBrand(updated[0] || null)
    }
  }

  // ── Render ──
  const paginatedAds = filteredAds.slice(0, (page + 1) * GRID_PAGE)
  const hasMore = (page + 1) * GRID_PAGE < filteredAds.length

  const showingCount = paginatedAds.length
  const totalCount = filteredAds.length

  return (
    <div className="ca-container">
      {/* Header */}
      <div className="ca-header">
        <h1>Competitor Ads</h1>
        <div className="ca-header-actions">
          <button className="ca-btn-add-competitor" onClick={() => setShowAddModal(true)}>
            + Add Competitor
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div style={{ padding: '16px 24px 0', display: 'flex', gap: '12px' }}>
        <div className="ca-view-tabs">
          <button
            className={`ca-view-tab ${view === 'all' ? 'active' : ''}`}
            onClick={() => setView('all')}
          >
            All Ads
          </button>
          <button
            className={`ca-view-tab ${view === 'top' ? 'active' : ''}`}
            onClick={() => setView('top')}
          >
            Top Performers
          </button>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="ca-add-modal-bg" onClick={() => setShowAddModal(false)}>
          <div className="ca-add-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Competitor</h3>
            <p className="ca-add-modal-desc">Enter the Page ID and name to track competitor ads.</p>
            <input
              type="text"
              className="ca-add-modal-input"
              placeholder="Page ID"
              value={newPageId}
              onChange={(e) => setNewPageId(e.target.value)}
            />
            <input
              type="text"
              className="ca-add-modal-input"
              placeholder="Page Name"
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
            />
            {addError && <p style={{ color: '#f87171', fontSize: '12px', margin: '6px 0 0' }}>{addError}</p>}
            <div className="ca-add-modal-btns">
              <button className="ca-btn-ghost" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button className="ca-btn-primary" onClick={handleAddBrand}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layout */}
      <div className="ca-layout">
        {/* Sidebar */}
        <div className="ca-sidebar">
          <div className="ca-sidebar-title">Brands</div>

          {view === 'top' && (
            <>
              <div className="ca-top-brand-actions">
                <button
                  className="ca-top-select-btn"
                  onClick={() => setTopSelectedBrands(brands.map((b) => b.pageId))}
                >
                  Select All
                </button>
                <button className="ca-top-select-btn" onClick={() => setTopSelectedBrands([])}>
                  Clear
                </button>
              </div>
              <div className="ca-brand-list">
                {brands.map((brand) => (
                  <div
                    key={brand.pageId}
                    className={`ca-brand-row ca-brand-check-row ${topSelectedBrands.includes(brand.pageId) ? 'selected' : ''}`}
                    onClick={() => {
                      setTopSelectedBrands(
                        topSelectedBrands.includes(brand.pageId)
                          ? topSelectedBrands.filter((id) => id !== brand.pageId)
                          : [...topSelectedBrands, brand.pageId]
                      )
                    }}
                  >
                    <div className={`ca-brand-check ${topSelectedBrands.includes(brand.pageId) ? 'checked' : ''}`}>
                      {topSelectedBrands.includes(brand.pageId) && '✓'}
                    </div>
                    <div className="ca-brand-row-info">
                      <div className="ca-brand-row-name">{brand.pageName}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ padding: '0 12px 12px' }}>
                <label style={{ fontSize: '12px', fontWeight: '500', color: '#71717a' }}>
                  Percentile threshold:
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={topPercentile}
                  onChange={(e) => setTopPercentile(Number(e.target.value))}
                  style={{
                    width: '100%',
                    marginTop: '6px',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ fontSize: '12px', color: '#a0a0b0', marginTop: '4px' }}>
                  Top {topPercentile}%
                </div>
              </div>

              <button className="ca-btn-load-top" onClick={loadTopPerformers} disabled={topSelectedBrands.length === 0}>
                Load Top Performers
              </button>
            </>
          )}

          {view === 'all' && (
            <>
              <div className="ca-brand-list">
                {brands.map((brand) => (
                  <div
                    key={brand.pageId}
                    className={`ca-brand-row ${selectedBrand?.pageId === brand.pageId ? 'active' : ''}`}
                    onClick={() => setSelectedBrand(brand)}
                  >
                    <div className="ca-brand-row-info">
                      <div className="ca-brand-row-name">{brand.pageName}</div>
                    </div>
                    <button
                      className="ca-brand-row-x"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteBrand(brand.pageId)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Main */}
        <div className="ca-main" ref={mainRef}>
          {error && (
            <div className="ca-error-msg">
              <span>{error}</span>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {view === 'all' && selectedBrand && (
            <>
              <div className="ca-brand-bar">
                <h2 className="ca-brand-bar-name">{selectedBrand.pageName}</h2>
                <p className="ca-brand-bar-stats">Showing {filteredAds.length} ads</p>
              </div>

              {/* Filters */}
              <div className="ca-filters">
                <div className="ca-filter-pills">
                  <button
                    className={`ca-pill ${filterFormat === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterFormat('all')}
                  >
                    All formats
                  </button>
                  <button
                    className={`ca-pill ${filterFormat === 'image' ? 'active' : ''}`}
                    onClick={() => setFilterFormat('image')}
                  >
                    Images
                  </button>
                  <button
                    className={`ca-pill ${filterFormat === 'video' ? 'active' : ''}`}
                    onClick={() => setFilterFormat('video')}
                  >
                    Videos
                  </button>
                </div>

                <div className="ca-filter-right">
                  <input
                    type="text"
                    className="ca-search"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <select
                    className="ca-sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="newest">Newest first</option>
                    <option value="impressions">Most impressions</option>
                    <option value="velocity">Highest velocity</option>
                  </select>
                </div>
              </div>

              {/* Date range */}
              <div className="ca-date-range">
                <label className="ca-date-label">Date range:</label>
                <input
                  type="date"
                  className="ca-date-input"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                />
                <span className="ca-date-to">to</span>
                <input
                  type="date"
                  className="ca-date-input"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                />
                {(dateRange.start || dateRange.end) && (
                  <button
                    className="ca-date-clear"
                    onClick={() => setDateRange({ start: '', end: '' })}
                  >
                    Clear
                  </button>
                )}
                {filteredAds.length > 0 && <span className="ca-date-count">{filteredAds.length} results</span>}
              </div>

              <p className="ca-showing">Showing {showingCount} of {totalCount}</p>
            </>
          )}

          {view === 'top' && (
            <>
              <div className="ca-top-explainer">
                <strong>Top Performers Analysis</strong><br />
                Velocity rank = avg daily impressions. Compare creative performance across brands.
              </div>

              {topSelectedBrands.length > 1 && (
                <div className="ca-top-legend">
                  {topSelectedBrands.map((brandId, idx) => {
                    const brand = brands.find((b) => b.pageId === brandId)
                    const color = BRAND_COLORS[idx % BRAND_COLORS.length]
                    return (
                      <div key={brandId} className="ca-legend-item">
                        <div className="ca-legend-dot" style={{ background: color.text }}></div>
                        <span>{brand?.pageName || 'Unknown'}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {filteredAds.length === 0 && topSelectedBrands.length === 0 && (
                <div style={{ padding: '60px 0', textAlign: 'center' }}>
                  <div className="ca-empty-top">
                    <div className="ca-empty-icon">📊</div>
                    <div className="ca-empty-title">No brands selected</div>
                    <div className="ca-empty-desc">Select brands from the sidebar and click "Load Top Performers"</div>
                  </div>
                </div>
              )}

              {filteredAds.length === 0 && topSelectedBrands.length > 0 && (
                <div style={{ padding: '60px 0', textAlign: 'center' }}>
                  <div className="ca-empty-top">
                    <div className="ca-empty-icon">✨</div>
                    <div className="ca-empty-title">No ads matching this percentile</div>
                    <div className="ca-empty-desc">Try lowering the percentile threshold or adding more brands</div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Grid */}
          {loading ? (
            <div className="ca-loading">
              <div className="ca-spin"></div>
              Loading ads...
            </div>
          ) : paginatedAds.length === 0 && !loading && view === 'all' ? (
            <div className="ca-empty">No ads found</div>
          ) : (
            <div className="ca-grid">
              {paginatedAds.map((ad, idx) => {
                const brandIdx = topSelectedBrands.indexOf(ad.pageId)
                const color = brandIdx >= 0 ? BRAND_COLORS[brandIdx % BRAND_COLORS.length] : null

                return (
                  <div
                    key={ad.adId}
                    className="ca-card"
                    onClick={() => setSelectedModal(ad)}
                  >
                    {/* Media */}
                    <div className="ca-card-media">
                      {ad.isVideo ? (
                        <>
                          <video
                            preload="metadata"
                            className="ca-lazy-video loaded"
                            src={ad.videoUrl}
                            onError={(e) => {
                              e.target.style.display = 'none'
                            }}
                          />
                          {ad.videoUrl && (
                            <div className="ca-video-play-overlay">
                              <div className="ca-video-play-btn">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M5 3v18l15-9z" />
                                </svg>
                              </div>
                            </div>
                          )}
                          {!ad.videoUrl && <div className="ca-no-preview">No video</div>}
                        </>
                      ) : ad.mediaUrl ? (
                        <img src={ad.mediaUrl} alt={ad.adName} className="ca-card-thumb" onError={(e) => {
                          e.target.style.display = 'none'
                        }} />
                      ) : (
                        <div className="ca-no-preview">No preview</div>
                      )}
                    </div>

                    {/* Body */}
                    <div className="ca-card-body">
                      <h3 className="ca-card-title">{ad.adName}</h3>
                      <div className="ca-card-tags">
                        <span className={`ca-tag ${ad.isVideo ? 'video' : 'image'}`}>
                          {ad.isVideo ? 'Video' : 'Image'}
                        </span>
                        <span className={`ca-tag status-${ad.isActive ? 'active' : 'ended'}`}>
                          {ad.isActive ? 'Active' : 'Ended'}
                        </span>
                        {view === 'top' && color && (
                          <span className="ca-tag ca-tag-brand" style={{ background: color.bg, color: color.text, border: '1px solid ' + color.border }}>
                            {brands.find((b) => b.pageId === ad.pageId)?.pageName || 'Unknown'}
                          </span>
                        )}
                      </div>

                      {view === 'top' && (
                        <div className="ca-card-velocity">
                          <span className="ca-velocity-label">Velocity</span>
                          <span className="ca-velocity-value">{ad.velocity.toFixed(0)}</span>
                          <span className="ca-velocity-sep">/</span>
                          <span className="ca-velocity-imp">{ad.daysActive}d</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Load more */}
          {hasMore && (
            <button className="ca-load-more" onClick={() => setPage(page + 1)}>
              Load more
            </button>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedModal && (
        <div className="ca-modal-bg" onClick={() => setSelectedModal(null)}>
          <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
            <button className="ca-modal-x" onClick={() => setSelectedModal(null)}>×</button>

            {/* Media */}
            {selectedModal.isVideo ? (
              <div className="ca-modal-media">
                <video
                  className="ca-modal-video"
                  src={selectedModal.videoUrl}
                  controls
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
              </div>
            ) : selectedModal.mediaUrl ? (
              <div className="ca-modal-media">
                <img src={selectedModal.mediaUrl} alt={selectedModal.adName} className="ca-modal-img" onError={(e) => {
                  e.target.style.display = 'none'
                }} />
              </div>
            ) : (
              <div className="ca-modal-media" style={{ minHeight: '200px', background: '#0a0a0f' }} />
            )}

            {/* Detail */}
            <div className="ca-modal-detail">
              <h2 className="ca-modal-title">{selectedModal.adName}</h2>
              {selectedModal.adBody && <p className="ca-modal-body">{selectedModal.adBody}</p>}
              {selectedModal.adCaption && <p className="ca-modal-caption">{selectedModal.adCaption}</p>}

              <div className="ca-modal-meta-grid">
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Brand</label>
                  <span>{selectedModal.pageName}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Format</label>
                  <span>{selectedModal.creativeType}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Impressions</label>
                  <span>{selectedModal.impressionsText || 'N/A'}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Status</label>
                  <span className={`ca-status-dot ${selectedModal.isActive ? 'active' : 'ended'}`}>
                    {selectedModal.isActive ? 'Active' : 'Ended'}
                  </span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Start Date</label>
                  <span>{formatDate(selectedModal.startDate) || 'N/A'}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">End Date</label>
                  <span>{formatDate(selectedModal.endDate) || 'N/A'}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Days Active</label>
                  <span>{selectedModal.daysActive || 'N/A'}</span>
                </div>
                <div className="ca-modal-meta-item">
                  <label className="ca-modal-label">Velocity</label>
                  <span>{selectedModal.velocity.toFixed(1)} imps/day</span>
                </div>
              </div>

              {selectedModal.categories.length > 0 && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #1e1e28' }}>
                  <label className="ca-modal-label" style={{ marginBottom: '8px', display: 'block' }}>Categories</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {selectedModal.categories.map((cat) => (
                      <span key={cat} style={{ background: '#1e1e28', color: '#a0a0b0', padding: '4px 10px', borderRadius: '4px', fontSize: '12px' }}>
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
