import { useState, useEffect, useRef } from 'react'
import './CompetitorAds.css'

// ── Supabase config ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'
const FOREPLAY_FN_URL = `${SUPABASE_URL}/functions/v1/fetch-competitor-ads`
const ANALYSE_FN_URL = `${SUPABASE_URL}/functions/v1/analyse-competitor-creatives`
const BATCH_FN_URL = `${SUPABASE_URL}/functions/v1/process-analysis-batch`

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
    impMid,
    daysActive,
    velocity,
    startDate: ad.start_date,
    endDate: ad.end_date,
    isActive: ad.is_active,
    impressions: fmtImpressions(ad.impressions_lower, ad.impressions_upper),
    impressionsLower: ad.impressions_lower,
    impressionsUpper: ad.impressions_upper,
    platforms: (ad.platforms || '').split(',').filter(Boolean),
    linkUrl: ad.link_url || '',
    ctaType: ad.cta_type || '',
    categories: ad.categories ? JSON.parse(ad.categories) : [],
    persona: ad.persona ? JSON.parse(ad.persona) : [],
    languages: ad.languages ? JSON.parse(ad.languages) : [],
    marketTarget: ad.market_target ? JSON.parse(ad.market_target) : [],
    niches: ad.niches ? JSON.parse(ad.niches) : [],
    emotionalDrivers: ad.emotional_drivers ? JSON.parse(ad.emotional_drivers) : [],
    contentFilter: ad.content_filter || '',
    creativeTargeting: ad.creative_targeting ? JSON.parse(ad.creative_targeting) : [],
    cardIndex: ad.card_index,
    parentAdId: ad.parent_ad_id,
  }
}

// ── Main component ──
export default function CompetitorAds() {
  const [currentBrand, setCurrentBrand] = useState('')
  const [allAds, setAllAds] = useState([])
  const [adsByBrand, setAdsByBrand] = useState({})
  const [selectedAds, setSelectedAds] = useState(new Set())
  const [filteredAds, setFilteredAds] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [expandedAdIds, setExpandedAdIds] = useState(new Set())
  const [videoErrors, setVideoErrors] = useState(new Set())
  const [expandedCategory, setExpandedCategory] = useState('')
  const [analysingAdIds, setAnalysingAdIds] = useState(new Set())
  const [analysisResults, setAnalysisResults] = useState({})
  const [batchProcessing, setBatchProcessing] = useState(false)
  const scrollContainerRef = useRef(null)
  const [sortBy, setSortBy] = useState('velocity')
  const [sortDir, setSortDir] = useState('desc')
  const [gridPage, setGridPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPersona, setSelectedPersona] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedCta, setSelectedCta] = useState('')
  const [selectedMarketTarget, setSelectedMarketTarget] = useState('')
  const [minImpressionsLower, setMinImpressionsLower] = useState(0)
  const [isDownloadingMarkdown, setIsDownloadingMarkdown] = useState(false)

  // ── Effects ──
  useEffect(() => {
    refetchAds()
  }, [])

  useEffect(() => {
    if (!allAds || !currentBrand) return
    applyFilters()
  }, [filterText, allAds, currentBrand, sortBy, sortDir, gridPage, searchQuery, selectedPersona, selectedCategory, selectedCta, selectedMarketTarget, minImpressionsLower])

  // ── Fetch ads from database ──
  async function refetchAds() {
    setIsLoading(true)
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads`, {
        headers: sbReadHeaders,
      })
      const data = await resp.json()
      setAllAds(data || [])
      
      // Group by page name
      const grouped = {}
      ;(data || []).forEach((ad) => {
        const key = ad.page_name || 'Unknown'
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(ad)
      })
      setAdsByBrand(grouped)
      
      // Set first brand as current
      const brands = Object.keys(grouped)
      if (brands.length > 0) {
        setCurrentBrand(brands[0])
      }
    } catch (err) {
      console.error('Failed to fetch ads:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // ── Apply filters ──
  function applyFilters() {
    let ads = adsByBrand[currentBrand] || []
    ads = ads.map((ad) => mapDbAd(ad, '', currentBrand))

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      ads = ads.filter((ad) => {
        return ad.adName.toLowerCase().includes(q) ||
               ad.adBody.toLowerCase().includes(q) ||
               ad.adDescription.toLowerCase().includes(q)
      })
    }

    // Filter by persona
    if (selectedPersona) {
      ads = ads.filter((ad) => ad.persona.includes(selectedPersona))
    }

    // Filter by category
    if (selectedCategory) {
      ads = ads.filter((ad) => ad.categories.includes(selectedCategory))
    }

    // Filter by CTA
    if (selectedCta) {
      ads = ads.filter((ad) => ad.ctaType === selectedCta)
    }

    // Filter by market target
    if (selectedMarketTarget) {
      ads = ads.filter((ad) => ad.marketTarget.includes(selectedMarketTarget))
    }

    // Filter by minimum impressions
    if (minImpressionsLower > 0) {
      ads = ads.filter((ad) => {
        const lower = ad.impressionsLower || 0
        return lower >= minImpressionsLower
      })
    }

    // Apply text filter
    if (filterText) {
      const lc = filterText.toLowerCase()
      ads = ads.filter(
        (ad) =>
          (ad.adName && ad.adName.toLowerCase().includes(lc)) ||
          (ad.adBody && ad.adBody.toLowerCase().includes(lc)) ||
          (ad.adDescription && ad.adDescription.toLowerCase().includes(lc))
      )
    }

    // Sort
    ads.sort((a, b) => {
      let aVal, bVal
      switch (sortBy) {
        case 'velocity':
          aVal = a.velocity || 0
          bVal = b.velocity || 0
          break
        case 'impressions':
          aVal = a.impMid || 0
          bVal = b.impMid || 0
          break
        case 'days':
          aVal = a.daysActive || 0
          bVal = b.daysActive || 0
          break
        case 'name':
          aVal = a.adName || ''
          bVal = b.adName || ''
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
        default:
          return 0
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    // Paginate
    const startIdx = (gridPage - 1) * GRID_PAGE
    const endIdx = startIdx + GRID_PAGE
    const paginated = ads.slice(startIdx, endIdx)

    setFilteredAds(paginated)
  }

  // ── Analyse a single ad ──
  async function analyseAd(ad) {
    const key = `${ad.pageId}:${ad.adId}`
    setAnalysingAdIds((prev) => new Set(prev).add(key))

    try {
      const resp = await fetch(ANALYSE_FN_URL, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          ads: [ad],
          mode: 'single',
        }),
      })

      const result = await resp.json()
      const analysis = result?.analysis || result

      setAnalysisResults((prev) => ({
        ...prev,
        [key]: analysis,
      }))
    } catch (err) {
      console.error('Failed to analyse ad:', err)
    } finally {
      setAnalysingAdIds((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  // ── Batch process selected ads ──
  async function processBatch() {
    if (selectedAds.size === 0) return

    setBatchProcessing(true)
    const adsToProcess = Array.from(selectedAds)
      .map((key) => {
        const [pageId, adId] = key.split(':')
        return filteredAds.find((a) => a.pageId === pageId && a.adId === adId)
      })
      .filter(Boolean)

    try {
      const resp = await fetch(BATCH_FN_URL, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          ads: adsToProcess,
          mode: 'batch',
        }),
      })

      const result = await resp.json()
      setAnalysisResults((prev) => ({
        ...prev,
        ...result,
      }))

      setSelectedAds(new Set())
    } catch (err) {
      console.error('Batch processing failed:', err)
    } finally {
      setBatchProcessing(false)
    }
  }

  // ── Export as markdown ──
  function exportAsMarkdown() {
    setIsDownloadingMarkdown(true)
    setTimeout(() => {
      let markdown = `# Competitor Ad Analysis Report\n\n`
      markdown += `**Report Generated:** ${new Date().toLocaleString()}\n`
      markdown += `**Brand Analyzed:** ${currentBrand}\n`
      markdown += `**Total Ads:** ${filteredAds.length}\n\n`

      markdown += `## Ads Summary\n\n`
      filteredAds.forEach((ad, idx) => {
        markdown += `### Ad ${idx + 1}: ${ad.adName}\n`
        markdown += `- **Status:** ${ad.isActive ? 'Active' : 'Inactive'}\n`
        markdown += `- **Type:** ${ad.creativeType}\n`
        markdown += `- **Impressions:** ${ad.impressions || 'N/A'}\n`
        markdown += `- **Days Active:** ${ad.daysActive}\n`
        markdown += `- **Velocity:** ${ad.velocity?.toFixed(2) || 'N/A'}\n`
        if (ad.adBody) markdown += `- **Body:** ${ad.adBody}\n`
        if (ad.categories.length > 0) markdown += `- **Categories:** ${ad.categories.join(', ')}\n`
        if (ad.persona.length > 0) markdown += `- **Personas:** ${ad.persona.join(', ')}\n`
        markdown += `\n`
      })

      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `competitor-ads-${currentBrand}-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
      setIsDownloadingMarkdown(false)
    }, 100)
  }

  // ── Get all unique values for filters ──
  function getUniquePersonas() {
    const personas = new Set()
    ;(adsByBrand[currentBrand] || []).forEach((ad) => {
      const p = ad.persona ? JSON.parse(ad.persona) : []
      p.forEach((x) => personas.add(x))
    })
    return Array.from(personas).sort()
  }

  function getUniqueCategories() {
    const cats = new Set()
    ;(adsByBrand[currentBrand] || []).forEach((ad) => {
      const c = ad.categories ? JSON.parse(ad.categories) : []
      c.forEach((x) => cats.add(x))
    })
    return Array.from(cats).sort()
  }

  function getUniqueCtas() {
    const ctas = new Set()
    ;(adsByBrand[currentBrand] || []).forEach((ad) => {
      if (ad.cta_type) ctas.add(ad.cta_type)
    })
    return Array.from(ctas).sort()
  }

  function getUniqueMarketTargets() {
    const targets = new Set()
    ;(adsByBrand[currentBrand] || []).forEach((ad) => {
      const m = ad.market_target ? JSON.parse(ad.market_target) : []
      m.forEach((x) => targets.add(x))
    })
    return Array.from(targets).sort()
  }

  // ── UI Render ──
  const brands = Object.keys(adsByBrand)
  const totalPages = Math.ceil(
    (adsByBrand[currentBrand]?.length || 0) / GRID_PAGE
  )

  return (
    <div className="competitor-ads-container">
      <div className="header-section">
        <h1>Creative Intelligence Report</h1>
        <p>Competitor Ad Library & Analysis Dashboard</p>
      </div>

      {/* Brand selector */}
      <div className="brand-selector">
        <label>Brand:</label>
        <select value={currentBrand} onChange={(e) => {
          setCurrentBrand(e.target.value)
          setGridPage(1)
        }}>
          {brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
      </div>

      {/* Markdown export button */}
      <div className="action-bar">
        <button
          onClick={exportAsMarkdown}
          disabled={isDownloadingMarkdown}
          className="export-btn"
        >
          {isDownloadingMarkdown ? 'Exporting...' : 'Export as Markdown'}
        </button>
      </div>

      {/* Filters toggle */}
      <button
        className="toggle-filters-btn"
        onClick={() => setShowFilters(!showFilters)}
      >
        {showFilters ? 'Hide Filters' : 'Show Filters'}
      </button>

      {/* Filter panel */}
      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <label>Search:</label>
            <input
              type="text"
              placeholder="Search ad name, body, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label>Persona:</label>
            <select value={selectedPersona} onChange={(e) => setSelectedPersona(e.target.value)}>
              <option value="">All Personas</option>
              {getUniquePersonas().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Category:</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="">All Categories</option>
              {getUniqueCategories().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>CTA Type:</label>
            <select value={selectedCta} onChange={(e) => setSelectedCta(e.target.value)}>
              <option value="">All CTAs</option>
              {getUniqueCtas().map((cta) => (
                <option key={cta} value={cta}>
                  {cta}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Market Target:</label>
            <select value={selectedMarketTarget} onChange={(e) => setSelectedMarketTarget(e.target.value)}>
              <option value="">All Markets</option>
              {getUniqueMarketTargets().map((mt) => (
                <option key={mt} value={mt}>
                  {mt}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Min Impressions:</label>
            <input
              type="number"
              value={minImpressionsLower}
              onChange={(e) => setMinImpressionsLower(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      )}

      {/* Sort controls */}
      <div className="sort-controls">
        <label>Sort by:</label>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="velocity">Velocity</option>
          <option value="impressions">Impressions</option>
          <option value="days">Days Active</option>
          <option value="name">Name</option>
        </select>
        <button onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}>
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <button
          onClick={() => setGridPage(Math.max(1, gridPage - 1))}
          disabled={gridPage === 1}
        >
          Previous
        </button>
        <span>
          Page {gridPage} of {totalPages || 1}
        </span>
        <button
          onClick={() => setGridPage(gridPage + 1)}
          disabled={gridPage >= totalPages}
        >
          Next
        </button>
      </div>

      {/* Ads grid */}
      <div className="ads-grid" ref={scrollContainerRef}>
        {filteredAds.length === 0 ? (
          <div className="empty-state">No ads to display</div>
        ) : (
          filteredAds.map((ad) => {
            const key = `${ad.pageId}:${ad.adId}`
            const isAnalysing = analysingAdIds.has(key)
            const analysis = analysisResults[key]
            const isExpanded = expandedAdIds.has(key)
            const hasVideoError = videoErrors.has(key)

            return (
              <div key={key} className="ad-card">
                <div className="ad-media-section">
                  {ad.isVideo ? (
                    <div className="video-wrapper">
                      {!hasVideoError ? (
                        <video
                          controls
                          onError={() =>
                            setVideoErrors((prev) => new Set(prev).add(key))
                          }
                        >
                          <source src={ad.videoUrl} type="video/mp4" />
                          Your browser doesn't support video playback
                        </video>
                      ) : (
                        <div className="video-error">Video unavailable</div>
                      )}
                    </div>
                  ) : ad.hasMedia ? (
                    <img src={ad.mediaUrl} alt={ad.adName} />
                  ) : (
                    <div className="no-media">No media</div>
                  )}
                </div>

                <div className="ad-info">
                  <h3>{ad.adName}</h3>
                  <p className="ad-body">{ad.adBody}</p>
                  <p className="ad-description">{ad.adDescription}</p>

                  <div className="ad-stats">
                    <span>
                      <strong>Impressions:</strong> {ad.impressions || 'N/A'}
                    </span>
                    <span>
                      <strong>Days:</strong> {ad.daysActive}
                    </span>
                    <span>
                      <strong>Velocity:</strong> {ad.velocity?.toFixed(2) || 'N/A'}/day
                    </span>
                  </div>

                  {ad.categories.length > 0 && (
                    <div className="tags">
                      <strong>Categories:</strong>
                      {ad.categories.map((cat) => (
                        <span key={cat} className="tag">
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

                  {ad.persona.length > 0 && (
                    <div className="tags">
                      <strong>Personas:</strong>
                      {ad.persona.map((p) => (
                        <span key={p} className="tag">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}

                  {analysis && (
                    <div className="analysis-results">
                      <h4>Analysis</h4>
                      <pre>{JSON.stringify(analysis, null, 2)}</pre>
                    </div>
                  )}

                  <div className="ad-actions">
                    <button onClick={() => analyseAd(ad)} disabled={isAnalysing}>
                      {isAnalysing ? 'Analysing...' : 'Analyse'}
                    </button>
                    <input
                      type="checkbox"
                      checked={selectedAds.has(key)}
                      onChange={(e) => {
                        const next = new Set(selectedAds)
                        if (e.target.checked) {
                          next.add(key)
                        } else {
                          next.delete(key)
                        }
                        setSelectedAds(next)
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Batch processing */}
      {selectedAds.size > 0 && (
        <div className="batch-actions">
          <p>{selectedAds.size} ad(s) selected</p>
          <button onClick={processBatch} disabled={batchProcessing}>
            {batchProcessing ? 'Processing...' : 'Process Batch'}
          </button>
        </div>
      )}
    </div>
  )
}
