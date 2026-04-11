import { useState, useEffect, useRef } from 'react'
import './CompetitorAds.css'

// ── Supabase config ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'
const FOREPLAY_FN_URL = `${SUPABASE_URL}/functions/v1/fetch-competitor-ads`
const ANALYSE_FN_URL = `${SUPABASE_URL}/functions/v1/analyse-competitor-creatives`

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
    impressionsMid: impMid,
    velocity,
    startDate: formatDate(ad.start_date),
    endDate: formatDate(ad.end_date),
    rawStartDate: ad.start_date || null,
    rawEndDate: ad.end_date || null,
    daysActive,
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

function mostCommonPageName(rows) {
  const counts = {}
  for (const row of rows) {
    const name = (row.page_name || '').trim()
    if (!name || /^\d+$/.test(name)) continue
    counts[name] = (counts[name] || 0) + 1
  }
  let best = null, bestCount = 0
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) { best = name; bestCount = count }
  }
  return best
}

async function resolvePageName(pageId, metaToken) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}&page_name=not.is.null&select=page_name&limit=200`,
      { headers: sbReadHeaders }
    )
    if (res.ok) {
      const rows = await res.json()
      const name = mostCommonPageName(rows)
      if (name) return name
    }
  } catch {}

  if (metaToken) {
    try {
      const r = await fetch(`https://graph.facebook.com/${pageId}?access_token=${metaToken}&fields=name`)
      if (r.ok) { const d = await r.json(); if (d.name) return d.name }
    } catch {}
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${pageId}?fields=name`)
    if (r.ok) { const d = await r.json(); if (d.name) return d.name }
  } catch {}

  return null
}

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
  const [showCount, setShowCount] = useState(GRID_PAGE)

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ── Top Performers state ──
  const [viewMode, setViewMode] = useState('library')
  const [selectedTopBrands, setSelectedTopBrands] = useState(new Set())
  const [topAds, setTopAds] = useState([])
  const [topLoading, setTopLoading] = useState(false)
  const [topError, setTopError] = useState(null)
  const [topPercentile, setTopPercentile] = useState(2.5)
  const [topTypeFilter, setTopTypeFilter] = useState('all')
  const [topSortBy, setTopSortBy] = useState('days')
  const [topShowCount, setTopShowCount] = useState(GRID_PAGE)
  const [topLoadingStatus, setTopLoadingStatus] = useState('')

  // ── AI Analysis state ──
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysisTab, setAnalysisTab] = useState('overview') // overview | prompts | ads

  const hasKey = apiKey.length > 20

  const brandColorMap = {}
  followedBrands.forEach((b, i) => {
    brandColorMap[b.pageId] = BRAND_COLORS[i % BRAND_COLORS.length]
  })

  useEffect(() => { fetchFollowedBrands().then(setFollowedBrands) }, [])
  useEffect(() => { if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey) }, [apiKey])
  useEffect(() => { setShowCount(GRID_PAGE) }, [typeFilter, statusFilter, sortBy, searchText, dateFrom, dateTo])
  useEffect(() => { setTopShowCount(GRID_PAGE) }, [topPercentile, topTypeFilter, topSortBy])

  // ── Library: filtered ads ──
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

  // ── Deduplication: group by creative fingerprint ──
  function deduplicateAds(ads) {
    const groups = {}
    for (const ad of ads) {
      // Step 1: strip card index to get parent ad ID
      const parentId = ad.adId.includes('_card') ? ad.adId.split('_card')[0] : ad.adId
      // Step 2: build creative fingerprint from copy + brand
      const copyKey = ((ad.adName || '') + '||' + (ad.adBody || '').slice(0, 100) + '||' + ad.pageId).toLowerCase().trim()
      const groupKey = copyKey || parentId

      if (!groups[groupKey]) {
        groups[groupKey] = { hero: ad, variants: [ad], parentIds: new Set([parentId]) }
      } else {
        groups[groupKey].variants.push(ad)
        groups[groupKey].parentIds.add(parentId)
        // Keep the variant with the longest run as the hero
        if (ad.daysActive > groups[groupKey].hero.daysActive) {
          groups[groupKey].hero = ad
        } else if (ad.daysActive === groups[groupKey].hero.daysActive && ad.hasMedia && !groups[groupKey].hero.hasMedia) {
          groups[groupKey].hero = ad
        }
      }
    }
    return Object.values(groups).map(g => ({
      ...g.hero,
      variantCount: g.variants.length,
      uniqueAdIds: g.parentIds.size,
      variants: g.variants,
    }))
  }

  // ── Top Performers: percentile PER BRAND, then combine and dedup ──
  const sortFn = (a, b) => {
    switch (topSortBy) {
      case 'velocity': return b.velocity - a.velocity
      case 'impressions': return b.impressionsMid - a.impressionsMid
      case 'days': return b.daysActive - a.daysActive
      default: return b.daysActive - a.daysActive
    }
  }

  const topFiltered = (() => {
    // Group ads by brand
    const byBrand = {}
    for (const ad of topAds) {
      if (ad.daysActive < 1) continue
      if (topTypeFilter === 'video' && !ad.isVideo) continue
      if (topTypeFilter === 'image' && (ad.isVideo || !ad.hasMedia)) continue
      const key = ad.pageId
      if (!byBrand[key]) byBrand[key] = []
      byBrand[key].push(ad)
    }

    // Take top percentile from EACH brand independently
    let combined = []
    for (const pageId of Object.keys(byBrand)) {
      const brandAds = byBrand[pageId]
      brandAds.sort(sortFn)
      const cutoff = Math.max(1, Math.ceil(brandAds.length * (topPercentile / 100)))
      combined = combined.concat(brandAds.slice(0, cutoff))
    }

    // Then dedup for clean display
    combined = deduplicateAds(combined)
    combined.sort(sortFn)
    return combined
  })()

  // Count raw eligible ads for the stats bar (per-brand totals)
  const topRawEligible = (() => {
    let ads = [...topAds].filter(a => a.daysActive >= 1)
    if (topTypeFilter === 'video') ads = ads.filter(a => a.isVideo)
    if (topTypeFilter === 'image') ads = ads.filter(a => !a.isVideo && a.hasMedia)
    return ads.length
  })()
  const topRawCutoff = (() => {
    // Sum of per-brand cutoffs
    const byBrand = {}
    for (const ad of topAds) {
      if (ad.daysActive < 1) continue
      if (topTypeFilter === 'video' && !ad.isVideo) continue
      if (topTypeFilter === 'image' && (ad.isVideo || !ad.hasMedia)) continue
      if (!byBrand[ad.pageId]) byBrand[ad.pageId] = 0
      byBrand[ad.pageId]++
    }
    return Object.values(byBrand).reduce((sum, count) => sum + Math.max(1, Math.ceil(count * (topPercentile / 100))), 0)
  })()

  const topPageAds = topFiltered.slice(0, topShowCount)
  const topRemaining = topFiltered.length - topShowCount
  const topVideoCount = topAds.filter(a => a.isVideo).length
  const topImageCount = topAds.filter(a => !a.isVideo && a.hasMedia).length
  const topHasImpressions = topAds.some(a => a.impressionsMid > 0)

  function toggleTopBrand(pageId) {
    setSelectedTopBrands(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  function selectAllTopBrands() {
    setSelectedTopBrands(new Set(followedBrands.map(b => b.pageId)))
  }

  function clearTopBrands() {
    setSelectedTopBrands(new Set())
  }

  async function loadTopPerformers() {
    if (selectedTopBrands.size === 0) return
    setTopLoading(true)
    setTopError(null)
    setTopAds([])
    setTopShowCount(GRID_PAGE)

    try {
      const brandList = followedBrands.filter(b => selectedTopBrands.has(b.pageId))
      let allMapped = []

      for (let i = 0; i < brandList.length; i++) {
        const brand = brandList[i]
        setTopLoadingStatus(`Loading ${brand.pageName} (${i + 1}/${brandList.length})...`)
        const rows = await fetchAllAds(brand.pageId)
        const mapped = rows.map(ad => mapDbAd(ad, brand.pageId, brand.pageName))
        allMapped = allMapped.concat(mapped)
      }

      setTopLoadingStatus(`Ranking ${allMapped.length} ads...`)
      setTopAds(allMapped)
      setTopLoadingStatus('')
    } catch (err) {
      setTopError(err.message)
    } finally {
      setTopLoading(false)
      setTopLoadingStatus('')
    }
  }

  async function runCreativeAnalysis() {
    const adsToAnalyse = topFiltered.filter(a => !a.isVideo && a.hasMedia)
    if (adsToAnalyse.length === 0) {
      setAnalysisError('No static image ads to analyse. Change the type filter to include images.')
      return
    }
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    setShowAnalysis(true)
    setAnalysisTab('overview')

    try {
      const payload = adsToAnalyse.map(ad => ({
        imageUrl: ad.mediaUrl || ad.thumbnailUrl || '',
        title: ad.adName || '',
        body: ad.adBody || '',
        daysActive: ad.daysActive,
        displayFormat: ad.displayFormat || 'IMAGE',
        pageName: ad.pageName || '',
        isVideo: false,
      }))

      // Send metadata for database tracking
      const selectedBrandNames = followedBrands.filter(b => selectedTopBrands.has(b.pageId)).map(b => b.pageName)
      const selectedPageIds = [...selectedTopBrands]

      const res = await fetch(ANALYSE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ads: payload,
          brands_analysed: selectedBrandNames,
          page_ids: selectedPageIds,
          percentile: topPercentile,
          type_filter: topTypeFilter,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Analysis failed (${res.status})`)
      }

      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.analysis?.error) throw new Error(data.analysis.error)

      setAnalysisResult({ ...data.analysis, analysis_id: data.analysis_id, models: data.models })
    } catch (err) {
      setAnalysisError(err.message)
    } finally {
      setAnalysisLoading(false)
    }
  }

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
        const mappedAds = rows.map(ad => mapDbAd(ad, pageId, pageName))
        setAllAds(mappedAds)
        setLoadingStatus('')
        await updateBrand(pageId, { last_fetched_at: new Date().toISOString(), total_ads: rows.length })

        if (pageName && /^Brand \d+$/.test(pageName)) {
          const realName = mostCommonPageName(rows)
          if (realName) {
            await updateBrand(pageId, { page_name: realName })
            setFollowedBrands(prev => prev.map(b =>
              b.pageId === pageId ? { ...b, pageName: realName, adCount: rows.length } : b
            ))
            setActiveBrand(prev => prev?.pageId === pageId ? { ...prev, pageName: realName } : prev)
          }
        }
      } else {
        setLoadingStatus('Fetching from Foreplay...')
        await fetch(FOREPLAY_FN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_id: pageId, limit: 50 }),
        })
        const reRows = await fetchAllAds(pageId)
        const mappedAds = reRows.map(ad => mapDbAd(ad, pageId, pageName))
        setAllAds(mappedAds)
        setLoadingStatus('')

        if (reRows.length > 0) {
          const realName = mostCommonPageName(reRows)
          if (realName && realName !== pageName) {
            await updateBrand(pageId, { page_name: realName, total_ads: reRows.length })
            setFollowedBrands(prev => prev.map(b =>
              b.pageId === pageId ? { ...b, pageName: realName, adCount: reRows.length } : b
            ))
            setActiveBrand(prev => prev?.pageId === pageId ? { ...prev, pageName: realName } : prev)
          }
        }
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

      if (followedBrands.some(b => b.pageId === pageId)) {
        setAddError('This brand is already in your list.')
        setAddLoading(false)
        return
      }

      const resolvedName = await resolvePageName(pageId, hasKey ? apiKey : null)
      const pageName = resolvedName || 'Brand ' + pageId

      const nb = { pageId, pageName, platforms: ['meta'], adCount: 0, lastFetchedAt: null, thumbnailUrl: null }
      if (await saveBrand(nb)) {
        setFollowedBrands([nb, ...followedBrands])
        setAddInput('')
        setShowAddForm(false)
      } else {
        setAddError('Could not save brand.')
      }
    } catch (err) { setAddError(err.message) }
    finally { setAddLoading(false) }
  }

  async function handleRemoveBrand(pageId) {
    const brand = followedBrands.find(b => b.pageId === pageId)
    const brandName = brand?.pageName || pageId
    if (!window.confirm(`Remove "${brandName}" from your competitor list?`)) return
    if (!window.confirm(`Are you sure? This will remove "${brandName}" and all its tracked data from your view. This cannot be undone.`)) return
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

  function renderAdCard(ad, showBrandTag = false) {
    const brandColor = brandColorMap[ad.pageId]
    return (
      <div key={ad.adId + '-' + (ad.cardIndex || '')} className="ca-card">
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
          {!ad.isVideo && (
            <div className="ca-card-overlay" onClick={() => setModalAd(ad)}>
              <span className="ca-card-expand">Click to expand</span>
            </div>
          )}
        </div>
        <div className="ca-card-body" onClick={() => setModalAd(ad)}>
          <div className="ca-card-title">{ad.adName}</div>
          <div className="ca-card-tags">
            {showBrandTag && brandColor && (
              <span className="ca-tag ca-tag-brand" style={{ background: brandColor.bg, color: brandColor.text, borderLeft: `3px solid ${brandColor.border}` }}>
                {ad.pageName}
              </span>
            )}
            {ad.variantCount > 1 && (
              <span className="ca-tag ca-tag-variants" title={`${ad.variantCount} variants across ${ad.uniqueAdIds} ad${ad.uniqueAdIds !== 1 ? 's' : ''}`}>
                {ad.variantCount} variants
              </span>
            )}
            <span className={`ca-tag ${ad.isVideo ? 'video' : 'image'}`}>
              {ad.displayFormat === 'DCO' ? (ad.isVideo ? '\u25B6 DCO' : 'DCO') : ad.isVideo ? '\u25B6 video' : 'image'}
            </span>
            <span className="ca-tag days">{ad.daysActive}d</span>
            <span className={`ca-tag status-${ad.status}`}>{ad.status}</span>
          </div>
          {showBrandTag && (
            <div className="ca-card-velocity">
              {ad.velocity > 0 ? (
                <>
                  <span className="ca-velocity-label">Velocity</span>
                  <span className="ca-velocity-value">{formatNumber(Math.round(ad.velocity))}/day</span>
                  {ad.impressionsText && (
                    <>
                      <span className="ca-velocity-sep">&middot;</span>
                      <span className="ca-velocity-imp">{ad.impressionsText} imp</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="ca-velocity-label">Running</span>
                  <span className="ca-velocity-value">{ad.daysActive} days</span>
                  <span className="ca-velocity-sep">&middot;</span>
                  <span className="ca-velocity-imp">{ad.status === 'active' ? 'Still active' : 'Ended'}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ca-container">
      <div className="ca-header">
        <h1>Competitor Ads</h1>
        <div className="ca-header-actions">
          <div className="ca-view-tabs">
            <button className={`ca-view-tab ${viewMode === 'library' ? 'active' : ''}`} onClick={() => setViewMode('library')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Library
            </button>
            <button className={`ca-view-tab ${viewMode === 'top' ? 'active' : ''}`} onClick={() => setViewMode('top')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
              Top Performers
            </button>
          </div>
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

      {showAddForm && (
        <div className="ca-add-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) { setShowAddForm(false); setAddInput(''); setAddError(null) } }}>
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
              <button onClick={handleAddBrand} disabled={addLoading || !addInput.trim()} className="ca-btn-primary">{addLoading ? 'Resolving name...' : 'Add Competitor'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="ca-layout">
        <aside className="ca-sidebar">
          <div className="ca-sidebar-title">Brands ({followedBrands.length})</div>

          {viewMode === 'library' && (
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
          )}

          {viewMode === 'top' && (
            <>
              <div className="ca-top-brand-actions">
                <button className="ca-top-select-btn" onClick={selectAllTopBrands}>Select all</button>
                <button className="ca-top-select-btn" onClick={clearTopBrands}>Clear</button>
              </div>
              <div className="ca-brand-list">
                {followedBrands.map(b => {
                  const color = brandColorMap[b.pageId]
                  const isSelected = selectedTopBrands.has(b.pageId)
                  return (
                    <div key={b.pageId} className={`ca-brand-row ca-brand-check-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleTopBrand(b.pageId)}>
                      <div className="ca-brand-check" style={isSelected ? { background: color?.border, borderColor: color?.border } : {}}>
                        {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20,6 9,17 4,12"/></svg>}
                      </div>
                      <div className="ca-brand-row-info">
                        <span className="ca-brand-row-name" style={isSelected ? { color: color?.text } : {}}>
                          {b.pageName}
                        </span>
                        <span className="ca-brand-row-count">{b.adCount} ads</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button
                className="ca-btn-load-top"
                onClick={loadTopPerformers}
                disabled={selectedTopBrands.size === 0 || topLoading}
              >
                {topLoading ? topLoadingStatus || 'Loading...' : `Analyse ${selectedTopBrands.size} brand${selectedTopBrands.size !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          <button className="ca-btn-add" onClick={() => setShowAddForm(true)}>+ Add Brand</button>
        </aside>

        <main className="ca-main">
          {viewMode === 'library' && (
            <>
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
                    {pageAds.map(ad => renderAdCard(ad, false))}
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
            </>
          )}

          {viewMode === 'top' && (
            <>
              <div className="ca-brand-bar">
                <h2 className="ca-brand-bar-name">Top Performers</h2>
                <span className="ca-brand-bar-stats">
                  {topAds.length > 0
                    ? `${topFiltered.length} unique creatives from top ${topPercentile}% per brand (${topRawCutoff} of ${topRawEligible} ads) across ${selectedTopBrands.size} brand${selectedTopBrands.size !== 1 ? 's' : ''}`
                    : `Select brands and click Analyse to find top performing ads`
                  }
                </span>
              </div>

              {topAds.length > 0 && (
                <div className="ca-filters">
                  <div className="ca-filter-pills">
                    {[['all', `All (${topAds.length})`], ['video', `Video (${topVideoCount})`], ['image', `Image (${topImageCount})`]].map(([val, label]) => (
                      <button key={val} className={`ca-pill ${topTypeFilter === val ? 'active' : ''}`} onClick={() => setTopTypeFilter(val)}>{label}</button>
                    ))}
                    <span className="ca-filter-sep">|</span>
                    {[1, 2.5, 5, 10, 20].map(pct => (
                      <button key={pct} className={`ca-pill ${topPercentile === pct ? 'active' : ''}`} onClick={() => setTopPercentile(pct)}>Top {pct}%</button>
                    ))}
                  </div>
                  <div className="ca-filter-right">
                    <select value={topSortBy} onChange={e => setTopSortBy(e.target.value)} className="ca-sort-select">
                      <option value="days">Days running (longevity)</option>
                      {topHasImpressions && <option value="velocity">Impressions/day (velocity)</option>}
                      {topHasImpressions && <option value="impressions">Total impressions</option>}
                    </select>
                  </div>
                </div>
              )}

              {topAds.length > 0 && (
                <div className="ca-top-explainer">
                  Ranked by {topSortBy === 'days' ? 'total days running — longer-running ads signal sustained performance' : topSortBy === 'velocity' ? 'impressions per day (higher = more spend sustained over time)' : 'total estimated impressions'}. Showing top {topPercentile}% of {topTypeFilter === 'all' ? 'all formats' : topTypeFilter + ' ads'}.{!topHasImpressions && ' Impression data not available — using longevity as the performance signal.'}
                </div>
              )}

              {/* AI Analysis button — pinned above grid for visibility */}
              {!topLoading && topFiltered.length > 0 && (
                <div className="ca-analysis-trigger">
                  <button
                    className="ca-btn-analyse"
                    onClick={runCreativeAnalysis}
                    disabled={analysisLoading || topFiltered.filter(a => !a.isVideo && a.hasMedia).length === 0}
                  >
                    {analysisLoading ? (
                      <><span className="ca-spin-sm"></span> Analysing {topFiltered.filter(a => !a.isVideo && a.hasMedia).length} ads with Claude Vision...</>
                    ) : (
                      <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Analyse top creatives with AI ({topFiltered.filter(a => !a.isVideo && a.hasMedia).length} images)</>
                    )}
                  </button>
                  {analysisResult && !showAnalysis && (
                    <button className="ca-btn-show-analysis" onClick={() => setShowAnalysis(true)}>
                      Show previous analysis
                    </button>
                  )}
                </div>
              )}

              {/* Analysis Results Panel */}
              {showAnalysis && (
                <div className="ca-analysis-panel">
                  <div className="ca-analysis-header">
                    <h3>Creative Intelligence Report</h3>
                    <button className="ca-analysis-close" onClick={() => setShowAnalysis(false)}>×</button>
                  </div>

                  {analysisLoading && (
                    <div className="ca-analysis-loading">
                      <div className="ca-spin"></div>
                      <p>Claude is analysing {topFiltered.filter(a => !a.isVideo && a.hasMedia).length} top-performing competitor ads...</p>
                      <p className="ca-analysis-loading-sub">Step 1: Sonnet analyses the images for patterns and themes. Step 2: Opus writes detailed Chefly creative briefs. This takes 60–90 seconds.</p>
                    </div>
                  )}

                  {analysisError && (
                    <div className="ca-analysis-error">
                      <strong>Analysis failed:</strong> {analysisError}
                      <button className="ca-btn-retry" onClick={runCreativeAnalysis}>Retry</button>
                    </div>
                  )}

                  {analysisResult && !analysisLoading && (
                    <>
                      <div className="ca-analysis-tabs">
                        <button className={`ca-analysis-tab ${analysisTab === 'overview' ? 'active' : ''}`} onClick={() => setAnalysisTab('overview')}>Themes & Pillars</button>
                        <button className={`ca-analysis-tab ${analysisTab === 'prompts' ? 'active' : ''}`} onClick={() => setAnalysisTab('prompts')}>Chefly Prompts ({analysisResult.chefly_prompts?.length || 0})</button>
                        <button className={`ca-analysis-tab ${analysisTab === 'ads' ? 'active' : ''}`} onClick={() => setAnalysisTab('ads')}>Per-Ad Breakdown ({analysisResult.adAnalyses?.length || 0})</button>
                      </div>

                      {analysisTab === 'overview' && (
                        <div className="ca-analysis-overview">
                          {analysisResult.themes?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Themes</h4>
                              <div className="ca-analysis-cards">
                                {analysisResult.themes.map((t, i) => (
                                  <div key={i} className="ca-analysis-card ca-card-theme">
                                    <div className="ca-card-label">Theme</div>
                                    <h5>{t.name}</h5>
                                    <p>{t.description}</p>
                                    <span className="ca-card-freq">{t.frequency}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.personas?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Target Personas</h4>
                              <div className="ca-analysis-cards">
                                {analysisResult.personas.map((p, i) => (
                                  <div key={i} className="ca-analysis-card ca-card-persona">
                                    <div className="ca-card-label">Persona</div>
                                    <h5>{p.name}</h5>
                                    <p>{p.description}</p>
                                    {p.painPoints?.length > 0 && (
                                      <div className="ca-card-pills">
                                        {p.painPoints.map((pp, j) => <span key={j} className="ca-pill-pain">{pp}</span>)}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.creativePillars?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Creative Pillars</h4>
                              <div className="ca-analysis-cards">
                                {analysisResult.creativePillars.map((cp, i) => (
                                  <div key={i} className="ca-analysis-card ca-card-pillar">
                                    <div className="ca-card-label">Pillar</div>
                                    <h5>{cp.name}</h5>
                                    <p>{cp.description}</p>
                                    <p className="ca-card-why"><strong>Why it works:</strong> {cp.whyItWorks}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {analysisTab === 'prompts' && (
                        <div className="ca-analysis-prompts">
                          {analysisResult.models && (
                            <div className="ca-models-badge">
                              Vision: {analysisResult.models.vision} · Prompts: {analysisResult.models.prompts}
                              {analysisResult.analysis_id && <span className="ca-saved-badge">Saved</span>}
                            </div>
                          )}
                          {analysisResult.chefly_prompts?.map((pr, i) => (
                            <div key={i} className="ca-prompt-card">
                              <div className="ca-prompt-header">
                                <span className="ca-prompt-num">#{pr.promptNumber || i + 1}</span>
                                <h5>{pr.promptName}</h5>
                                <span className="ca-prompt-basis">{pr.basedOn}</span>
                                {pr.aspectRatio && <span className="ca-prompt-ratio">{pr.aspectRatio}</span>}
                              </div>
                              <div className="ca-prompt-body">
                                {/* Full prompt — the complete brief */}
                                {pr.full_prompt && (
                                  <div className="ca-prompt-field">
                                    <label>Full Creative Brief</label>
                                    <div className="ca-prompt-text ca-prompt-full">{pr.full_prompt}</div>
                                  </div>
                                )}

                                {/* Structured sections (collapsible) */}
                                <details className="ca-prompt-sections">
                                  <summary>View sections breakdown</summary>
                                  {pr.concept_and_hook && (
                                    <div className="ca-prompt-field"><label>Concept & Hook</label><div className="ca-prompt-text">{pr.concept_and_hook}</div></div>
                                  )}
                                  {pr.setting_and_surface && (
                                    <div className="ca-prompt-field"><label>Setting & Surface</label><div className="ca-prompt-text">{pr.setting_and_surface}</div></div>
                                  )}
                                  {pr.hero_element && (
                                    <div className="ca-prompt-field"><label>Hero Element</label><div className="ca-prompt-text">{pr.hero_element}</div></div>
                                  )}
                                  {pr.copy_and_text && (
                                    <div className="ca-prompt-field"><label>Copy & Text</label><div className="ca-prompt-text">{pr.copy_and_text}</div></div>
                                  )}
                                  {pr.lighting && (
                                    <div className="ca-prompt-field"><label>Lighting</label><div className="ca-prompt-text">{pr.lighting}</div></div>
                                  )}
                                  {pr.camera_and_lens && (
                                    <div className="ca-prompt-field"><label>Camera & Lens</label><div className="ca-prompt-text">{pr.camera_and_lens}</div></div>
                                  )}
                                  {pr.colour_grading && (
                                    <div className="ca-prompt-field"><label>Colour Grading</label><div className="ca-prompt-text">{pr.colour_grading}</div></div>
                                  )}
                                  {pr.exclusions && (
                                    <div className="ca-prompt-field"><label>Exclusions</label><div className="ca-prompt-text">{pr.exclusions}</div></div>
                                  )}
                                  {pr.composition_summary && (
                                    <div className="ca-prompt-field"><label>Composition Summary</label><div className="ca-prompt-text">{pr.composition_summary}</div></div>
                                  )}
                                </details>

                                {/* Fallback for old-format prompts */}
                                {!pr.full_prompt && pr.imagePrompt && (
                                  <div className="ca-prompt-field"><label>Image Prompt</label><div className="ca-prompt-text">{pr.imagePrompt}</div></div>
                                )}
                                {pr.suggestedHeadline && (
                                  <div className="ca-prompt-row">
                                    <div className="ca-prompt-field"><label>Headline</label><div className="ca-prompt-text">{pr.suggestedHeadline}</div></div>
                                    {pr.suggestedBody && <div className="ca-prompt-field"><label>Body Copy</label><div className="ca-prompt-text">{pr.suggestedBody}</div></div>}
                                  </div>
                                )}

                                <div className="ca-prompt-rationale">
                                  <strong>Rationale:</strong> {pr.rationale}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {analysisTab === 'ads' && (
                        <div className="ca-analysis-ads">
                          {analysisResult.adAnalyses?.map((ad, i) => (
                            <div key={i} className="ca-ad-analysis-card">
                              <div className="ca-ad-analysis-header">
                                <span className="ca-ad-index">Ad {ad.adIndex}</span>
                                <span className="ca-ad-brand">{ad.brand}</span>
                                <span className="ca-ad-score" style={{ background: ad.strengthScore >= 7 ? 'rgba(34,197,94,0.15)' : ad.strengthScore >= 5 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)', color: ad.strengthScore >= 7 ? '#22c55e' : ad.strengthScore >= 5 ? '#eab308' : '#ef4444' }}>
                                  {ad.strengthScore}/10
                                </span>
                              </div>
                              <div className="ca-ad-analysis-body">
                                <div className="ca-ad-meta-row">
                                  <span><strong>Layout:</strong> {ad.visualLayout}</span>
                                  <span><strong>Format:</strong> {ad.format}</span>
                                  <span><strong>Days:</strong> {ad.daysRunning}</span>
                                </div>
                                <p><strong>Hero element:</strong> {ad.heroElement}</p>
                                <p><strong>Emotional hook:</strong> {ad.emotionalHook}</p>
                                <p><strong>Offer/CTA:</strong> {ad.offerStructure}</p>
                                <p><strong>Typography:</strong> {ad.typography}</p>
                                <p className="ca-ad-why">{ad.whyItWorks}</p>
                                {ad.dominantColors?.length > 0 && (
                                  <div className="ca-ad-colors">
                                    {ad.dominantColors.map((c, j) => (
                                      <span key={j} className="ca-color-swatch" style={{ background: c }} title={c}></span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {topLoading && <div className="ca-loading"><div className="ca-spin"></div><span>{topLoadingStatus}</span></div>}
              {topError && <div className="ca-error-msg">{topError}</div>}

              {!topLoading && topFiltered.length > 0 && (
                <>
                  <div className="ca-showing">
                    Showing {Math.min(topShowCount, topFiltered.length)} of {topFiltered.length} top performers
                    <div className="ca-top-legend">
                      {followedBrands.filter(b => selectedTopBrands.has(b.pageId)).map(b => {
                        const color = brandColorMap[b.pageId]
                        const count = topFiltered.filter(a => a.pageId === b.pageId).length
                        return (
                          <span key={b.pageId} className="ca-legend-item" style={{ color: color?.text }}>
                            <span className="ca-legend-dot" style={{ background: color?.border }}></span>
                            {b.pageName} ({count})
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="ca-grid">
                    {topPageAds.map(ad => renderAdCard(ad, true))}
                  </div>
                  {topRemaining > 0 && (
                    <button className="ca-load-more" onClick={() => setTopShowCount(c => c + GRID_PAGE)}>
                      Load more ({topRemaining} remaining)
                    </button>
                  )}

                </>
              )}

              {!topLoading && topAds.length > 0 && topFiltered.length === 0 && (
                <div className="ca-empty">No ads match the current filters. Try widening the percentile or changing the format filter.</div>
              )}

              {!topLoading && topAds.length === 0 && !topError && selectedTopBrands.size === 0 && (
                <div className="ca-empty ca-empty-top">
                  <div className="ca-empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a4a" strokeWidth="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
                  </div>
                  <div className="ca-empty-title">Select brands to compare</div>
                  <div className="ca-empty-desc">Tick one or more brands in the sidebar, then click Analyse to see their top performing ads ranked by velocity.</div>
                </div>
              )}

              {!topLoading && topAds.length === 0 && !topError && selectedTopBrands.size > 0 && (
                <div className="ca-empty ca-empty-top">
                  <div className="ca-empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a4a" strokeWidth="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
                  </div>
                  <div className="ca-empty-title">Ready to analyse</div>
                  <div className="ca-empty-desc">{selectedTopBrands.size} brand{selectedTopBrands.size !== 1 ? 's' : ''} selected. Click <strong>Analyse</strong> in the sidebar to load and rank their ads.</div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {modalAd && (
        <div className="ca-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setModalAd(null) }}>
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
                {modalAd.impressionsText && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Impressions</span><span>{modalAd.impressionsText}</span></div>
                )}
                {modalAd.velocity > 0 && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Velocity</span><span>{formatNumber(Math.round(modalAd.velocity))} imp/day</span></div>
                )}
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
