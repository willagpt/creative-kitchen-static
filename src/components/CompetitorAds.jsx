import { useState, useEffect, useCallback, useRef } from 'react'
import './CompetitorAds.css'

// ── Supabase config ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/extract-ad-thumbnails`

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

const STATUS_OPTIONS = [
  { value: 'all', label: 'all ads' },
  { value: 'live', label: 'live only' },
  { value: 'ended', label: 'ended only' },
]

const COUNTRIES = [
  { value: 'GB', label: 'gb' },
  { value: 'US', label: 'us' },
  { value: 'EU', label: 'eu' },
]

// How old cached data can be before we re-fetch (in hours)
const CACHE_MAX_AGE_HOURS = 12

// ── Helpers ──
function formatDate(date) {
  const d = new Date(date)
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

function fmtImpressions(lower, upper) {
  if (!lower && !upper) return null
  if (lower && upper) return formatNumber(lower) + '\u2013' + formatNumber(upper)
  return formatNumber(upper || lower)
}

function processResults(rawResults) {
  return rawResults.map(ad => {
    const startTime = new Date(ad.ad_delivery_start_time)
    const endTime = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : new Date()
    const daysActive = Math.max(Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24)), 0)

    let impLower = null, impUpper = null
    if (ad.impressions) {
      if (typeof ad.impressions === 'object') {
        impLower = parseInt(ad.impressions.lower_bound || 0) || null
        impUpper = parseInt(ad.impressions.upper_bound || 0) || null
      } else if (typeof ad.impressions === 'number') {
        impUpper = ad.impressions
      }
    }

    return {
      id: ad.id,
      pageName: ad.page_name || 'unknown',
      pageId: ad.page_id,
      snapshotUrl: ad.ad_snapshot_url || null,
      thumbnailUrl: null, // will be filled from cache or edge fn
      startDate: startTime.toISOString(),
      endDate: ad.ad_delivery_stop_time || null,
      daysActive,
      platforms: ad.publisher_platforms || [],
      impressionsLower: impLower,
      impressionsUpper: impUpper,
      isActive: !ad.ad_delivery_stop_time,
      creativeBody: ad.ad_creative_bodies ? ad.ad_creative_bodies[0] : '',
      creativeTitle: ad.ad_creative_link_titles ? ad.ad_creative_link_titles[0] : '',
      creativeCaption: ad.ad_creative_link_captions ? ad.ad_creative_link_captions[0] : '',
      creativeDescription: ad.ad_creative_link_descriptions ? ad.ad_creative_link_descriptions[0] : '',
    }
  })
}

// Extract page ID from URL or raw ID
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
    }))
  } catch { return [] }
}

async function saveBrandToSupabase(brand) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/followed_brands`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        page_id: String(brand.pageId),
        page_name: brand.pageName,
        platforms: brand.platforms || [],
        byline: brand.byline || '',
        ad_count: brand.adCount || 0,
        total_ads: brand.adCount || 0,
        country: brand.country || 'GB',
      }),
    })
    return true
  } catch { return false }
}

async function removeBrandFromSupabase(pageId) {
  try {
    // Delete cached ads too
    await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}`, {
      method: 'DELETE', headers: sbReadHeaders,
    })
    await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`, {
      method: 'DELETE', headers: sbReadHeaders,
    })
    return true
  } catch { return false }
}

// Cache ads to Supabase
async function cacheAdsToSupabase(ads, pageId, country) {
  const rows = ads.map(ad => ({
    id: ad.id,
    page_id: pageId,
    page_name: ad.pageName,
    snapshot_url: ad.snapshotUrl,
    thumbnail_url: ad.thumbnailUrl || null,
    start_date: ad.startDate,
    end_date: ad.endDate,
    days_active: ad.daysActive,
    is_active: ad.isActive,
    platforms: ad.platforms,
    impressions_lower: ad.impressionsLower,
    impressions_upper: ad.impressionsUpper,
    creative_body: ad.creativeBody,
    creative_title: ad.creativeTitle,
    creative_caption: ad.creativeCaption,
    creative_description: ad.creativeDescription,
    country,
  }))

  // Upsert in batches of 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    })
  }

  // Update brand's last_fetched_at and total_ads
  await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify({
      last_fetched_at: new Date().toISOString(),
      total_ads: ads.length,
      ad_count: ads.length,
    }),
  })
}

// Load cached ads from Supabase
async function loadCachedAds(pageId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/competitor_ads?page_id=eq.${pageId}&order=days_active.desc&limit=3000`,
      { headers: sbReadHeaders }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => ({
      id: row.id,
      pageId: row.page_id,
      pageName: row.page_name,
      snapshotUrl: row.snapshot_url,
      thumbnailUrl: row.thumbnail_url,
      startDate: row.start_date,
      endDate: row.end_date,
      daysActive: row.days_active || 0,
      isActive: row.is_active,
      platforms: row.platforms || [],
      impressionsLower: row.impressions_lower,
      impressionsUpper: row.impressions_upper,
      creativeBody: row.creative_body || '',
      creativeTitle: row.creative_title || '',
      creativeCaption: row.creative_caption || '',
      creativeDescription: row.creative_description || '',
    }))
  } catch { return [] }
}

// Look up a page by ID using ads_archive
async function lookupPageById(pageId, apiKey, country) {
  const params = new URLSearchParams({
    access_token: apiKey,
    search_page_ids: pageId,
    search_terms: ' ',
    ad_reached_countries: country,
    ad_type: 'ALL',
    fields: 'page_id,page_name,publisher_platforms,bylines',
    limit: 10,
    ad_active_status: 'ALL',
  })
  const response = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Meta API error')
  if (!response.ok) throw new Error('API error: ' + response.status)

  if (!data.data || data.data.length === 0) {
    // Try ALL countries
    const params2 = new URLSearchParams({
      access_token: apiKey, search_page_ids: pageId, search_terms: ' ',
      ad_reached_countries: 'ALL', ad_type: 'ALL',
      fields: 'page_id,page_name,publisher_platforms,bylines',
      limit: 10, ad_active_status: 'ALL',
    })
    const r2 = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params2)
    const d2 = await r2.json()
    if (d2.error) throw new Error(d2.error.message)
    if (!d2.data?.length) throw new Error('No ads found for this page ID.')
    return extractBrandFromResults(d2.data, pageId, country)
  }
  return extractBrandFromResults(data.data, pageId, country)
}

function extractBrandFromResults(results, pageId, country) {
  const ad = results[0]
  const platforms = new Set()
  results.forEach(a => { if (a.publisher_platforms) a.publisher_platforms.forEach(p => platforms.add(p)) })
  return {
    pageId: String(ad.page_id || pageId),
    pageName: ad.page_name || 'Unknown',
    platforms: Array.from(platforms),
    byline: ad.bylines?.[0] || '',
    adCount: results.length,
    country,
  }
}

// ── Kick off thumbnail extraction for ads missing images ──
async function requestThumbnailExtraction(ads) {
  const needThumbnails = ads
    .filter(ad => !ad.thumbnailUrl && ad.snapshotUrl)
    .slice(0, 50) // First 50 at a time
    .map(ad => ({ id: ad.id, url: ad.snapshotUrl }))

  if (needThumbnails.length === 0) return {}

  try {
    const res = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot_urls: needThumbnails }),
    })
    if (!res.ok) return {}
    const data = await res.json()
    // Return a map of id -> thumbnail_url
    const map = {}
    if (data.results) {
      data.results.forEach(r => { if (r.thumbnail_url) map[r.id] = r.thumbnail_url })
    }
    return map
  } catch { return {} }
}

// ── Components ──

function AvatarWithFallback({ pageId, pageName, size = 32 }) {
  const [failed, setFailed] = useState(false)
  const letter = pageName?.charAt(0)?.toUpperCase() || '?'
  if (failed || !pageId) {
    return (
      <div className="ca-avatar-letter" style={{ width: size, height: size, fontSize: size * 0.44 }}>
        {letter}
      </div>
    )
  }
  return (
    <img src={getPagePictureUrl(pageId)} alt={pageName} className="ca-avatar-img"
      style={{ width: size, height: size }} onError={() => setFailed(true)} referrerPolicy="no-referrer" />
  )
}

function AdPreviewModal({ ad, onClose }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [onClose])

  const impText = fmtImpressions(ad.impressionsLower, ad.impressionsUpper)

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={e => e.stopPropagation()}>
        <button className="ca-modal-close" onClick={onClose}>&times;</button>

        {/* Ad preview: iframe for full ad (including video playback) */}
        {ad.snapshotUrl && (
          <div className="ca-modal-image-wrap" style={{ position: 'relative', width: '100%', minHeight: 400, background: 'var(--bg-1)', borderRadius: 'var(--radius)' }}>
            <iframe
              src={ad.snapshotUrl}
              title="Ad preview"
              style={{ width: '100%', height: 400, border: 'none', borderRadius: 'var(--radius)' }}
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {/* Fallback: thumbnail if no snapshot URL */}
        {!ad.snapshotUrl && ad.thumbnailUrl && (
          <div className="ca-modal-image-wrap">
            <img src={ad.thumbnailUrl} alt="Ad creative" className="ca-modal-image" referrerPolicy="no-referrer" />
          </div>
        )}

        {/* Open on Meta link */}
        {ad.snapshotUrl && (
          <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" className="ca-modal-open-btn">
            Open Full Ad on Meta &#x2197;
          </a>
        )}

        <div className="ca-modal-content">
          <div className="ca-modal-brand-row">
            <AvatarWithFallback pageId={ad.pageId} pageName={ad.pageName} size={36} />
            <div>
              <div className="ca-modal-brand-name">{ad.pageName}</div>
              <div className="ca-modal-brand-meta">
                {ad.isActive ? 'Active since ' : 'Ran from '}{formatDate(ad.startDate)}
                {ad.isActive && (' \u00b7 ' + ad.daysActive + 'd running')}
                {!ad.isActive && ad.daysActive > 0 && (' \u2014 ' + ad.daysActive + ' days')}
              </div>
            </div>
          </div>

          {/* Creative text */}
          <div className="ca-modal-creative">
            {ad.creativeTitle && <div className="ca-modal-creative-title">{ad.creativeTitle}</div>}
            {ad.creativeBody && <div className="ca-modal-creative-body">{ad.creativeBody}</div>}
            {ad.creativeDescription && <div className="ca-modal-creative-desc">{ad.creativeDescription}</div>}
            {ad.creativeCaption && <div className="ca-modal-creative-caption">{ad.creativeCaption}</div>}
            {!ad.creativeTitle && !ad.creativeBody && (
              <div className="ca-modal-creative-body" style={{ opacity: 0.5 }}>No text content available.</div>
            )}
          </div>

          {/* Stats */}
          <div className="ca-modal-details">
            <div className="ca-modal-detail-row">
              <span className="ca-modal-detail-label">Status</span>
              <span className={`ca-modal-status ${ad.isActive ? 'active' : 'ended'}`}>
                {ad.isActive ? 'Active' : 'Ended'}
              </span>
            </div>
            <div className="ca-modal-detail-row">
              <span className="ca-modal-detail-label">Days running</span>
              <span>{ad.daysActive}</span>
            </div>
            {impText && (
              <div className="ca-modal-detail-row">
                <span className="ca-modal-detail-label">Impressions</span>
                <span>{impText}</span>
              </div>
            )}
            {ad.platforms.length > 0 && (
              <div className="ca-modal-detail-row">
                <span className="ca-modal-detail-label">Platforms</span>
                <span>{ad.platforms.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AdCard({ ad, isSaved, onToggleSave, onExpand }) {
  const [imgFailed, setImgFailed] = useState(false)
  const impText = fmtImpressions(ad.impressionsLower, ad.impressionsUpper)
  const hasThumbnail = ad.thumbnailUrl && !imgFailed

  return (
    <div className="ca-card">
      <div className="ca-card-preview" onClick={() => onExpand(ad)} title="Click to expand">
        {hasThumbnail ? (
          <img
            src={ad.thumbnailUrl}
            alt={ad.creativeTitle || 'Ad creative'}
            className="ca-card-thumb"
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="ca-card-text-preview">
            {ad.creativeTitle && <div className="ca-preview-title">{ad.creativeTitle}</div>}
            <div className="ca-preview-body">
              {ad.creativeBody
                ? (ad.creativeBody.length > 140 ? ad.creativeBody.substring(0, 140) + '...' : ad.creativeBody)
                : 'No text content'}
            </div>
            {ad.creativeCaption && <div className="ca-preview-caption">{ad.creativeCaption}</div>}
          </div>
        )}
        <div className="ca-preview-expand-hint">click to preview</div>
        <button
          className={`ca-save-btn ${isSaved ? 'saved' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSave(ad) }}
          title={isSaved ? 'unsave' : 'save'}
        >
          <span className="ca-save-icon">{isSaved ? '\u2605' : '\u2606'}</span>
        </button>
      </div>
      <div className="ca-card-body">
        <div className="ca-card-brand">{ad.pageName}</div>
        <div className="ca-card-meta">
          {ad.isActive ? 'running since ' : 'ran from '}{formatDate(ad.startDate)}
        </div>
        <div className="ca-card-badges">
          <span className="ca-badge">{ad.daysActive}d</span>
          {impText && <span className="ca-badge ca-badge-imp">{impText} imp</span>}
          {ad.isActive && <span className="ca-badge ca-badge-active">active</span>}
        </div>
        <div className="ca-card-footer">
          <div className="ca-platforms">
            {ad.platforms.includes('facebook') && <span className="ca-platform-icon">f</span>}
            {ad.platforms.includes('instagram') && <span className="ca-platform-icon">ig</span>}
          </div>
          {ad.snapshotUrl && (
            <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" className="ca-view-link">
              view on meta &#x2197;
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ──

export default function CompetitorAds() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('metaAdLibraryToken') || '')
  const [sortBy, setSortBy] = useState('longest')
  const [statusFilter, setStatusFilter] = useState('all')
  const [country, setCountry] = useState('GB')
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

  // ── Load brand ads: from cache first, then Meta API if needed ──
  const loadBrandAds = useCallback(async (brand, forceRefresh = false) => {
    setActiveBrand(brand)
    setIsLoading(true)
    setError(null)
    setResults([])
    setLoadingProgress(0)
    setIsCached(false)

    try {
      // Step 1: Try cache first (unless force refresh)
      if (!forceRefresh && isCacheFresh(brand)) {
        setLoadingStatus('loading from cache...')
        const cached = await loadCachedAds(brand.pageId)
        if (cached.length > 0) {
          setResults(sortAds(cached, sortBy))
          setIsCached(true)
          setIsLoading(false)
          setLoadingStatus('')

          // Kick off thumbnail extraction for any ads missing thumbnails (in background)
          const needThumbs = cached.filter(a => !a.thumbnailUrl && a.snapshotUrl)
          if (needThumbs.length > 0) {
            requestThumbnailExtraction(cached).then(thumbMap => {
              if (Object.keys(thumbMap).length > 0) {
                setResults(prev => prev.map(ad =>
                  thumbMap[ad.id] ? { ...ad, thumbnailUrl: thumbMap[ad.id] } : ad
                ))
              }
            })
          }
          return
        }
      }

      // Step 2: Fetch from Meta API
      if (!apiKey) { setError('Enter your Meta API token first.'); setIsLoading(false); return }

      setLoadingStatus('fetching from Meta...')
      let allRaw = []
      let nextUrl = null

      const params = new URLSearchParams({
        access_token: apiKey,
        search_page_ids: brand.pageId,
        search_terms: ' ',
        ad_reached_countries: country,
        ad_type: 'ALL',
        fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_titles,ad_creative_link_descriptions,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,bylines,impressions,page_id,page_name,publisher_platforms,estimated_audience_size',
        limit: 250,
        ad_active_status: 'ALL',
      })

      const response = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params)
      const data = await response.json()
      if (data.error) throw new Error(data.error.message)
      if (!response.ok) throw new Error('API Error: ' + response.status)

      if (data.data) {
        allRaw = [...data.data]
        const firstBatch = processResults(allRaw)
        setResults(sortAds(firstBatch, sortBy))
        setLoadingProgress(allRaw.length)
      }
      nextUrl = data.paging?.next || null

      // Paginate up to 2000
      while (nextUrl && allRaw.length < 2000) {
        setLoadingStatus(`fetching... ${allRaw.length} ads so far`)
        const pageRes = await fetch(nextUrl)
        const pageData = await pageRes.json()
        if (pageData.error) break
        if (pageData.data) {
          allRaw = [...allRaw, ...pageData.data]
          const processed = processResults(allRaw)
          setResults(sortAds(processed, sortBy))
          setLoadingProgress(allRaw.length)
        }
        nextUrl = pageData.paging?.next || null
      }

      const finalAds = processResults(allRaw)
      setResults(sortAds(finalAds, sortBy))

      // Step 3: Cache everything to Supabase
      setLoadingStatus('caching to database...')
      await cacheAdsToSupabase(finalAds, brand.pageId, country)

      // Update brand card
      setFollowedBrands(prev => prev.map(b =>
        b.pageId === brand.pageId
          ? { ...b, adCount: allRaw.length, lastFetchedAt: new Date().toISOString() }
          : b
      ))

      // Step 4: Extract thumbnails in background
      setLoadingStatus('extracting thumbnails...')
      const thumbMap = await requestThumbnailExtraction(finalAds)
      if (Object.keys(thumbMap).length > 0) {
        setResults(prev => prev.map(ad =>
          thumbMap[ad.id] ? { ...ad, thumbnailUrl: thumbMap[ad.id] } : ad
        ))
      }

      if (allRaw.length === 0) setResults([])
    } catch (err) {
      setError(err.message)
      setResults([])
    } finally {
      setIsLoading(false)
      setLoadingProgress(0)
      setLoadingStatus('')
    }
  }, [apiKey, country, sortBy, sortAds])

  // Re-sort when sort changes
  useEffect(() => {
    if (results.length > 0) setResults(prev => sortAds(prev, sortBy))
  }, [sortBy, sortAds])

  // ── Add brand ──
  const handleAddBrand = useCallback(async () => {
    if (!addInput.trim() || !apiKey) return
    setAddLoading(true)
    setAddError(null)
    const pageId = extractPageId(addInput)
    if (!pageId) {
      setAddError('Could not find a page ID in that URL. Try a Facebook Ad Library link or numeric page ID.')
      setAddLoading(false)
      return
    }
    if (followedBrands.some(b => b.pageId === pageId)) {
      setAddError('Already in your list.')
      setAddLoading(false)
      return
    }
    try {
      const brand = await lookupPageById(pageId, apiKey, country)
      const success = await saveBrandToSupabase(brand)
      if (success) {
        setFollowedBrands(prev => [brand, ...prev])
        setAddInput('')
        setShowAddForm(false)
      } else {
        setAddError('Failed to save.')
      }
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddLoading(false)
    }
  }, [addInput, apiKey, country, followedBrands])

  const handleRemoveBrand = useCallback(async (pageId) => {
    const success = await removeBrandFromSupabase(pageId)
    if (success) {
      setFollowedBrands(prev => prev.filter(b => b.pageId !== pageId))
      if (activeBrand?.pageId === pageId) { setActiveBrand(null); setResults([]) }
    }
  }, [activeBrand])

  const toggleSave = useCallback(async (ad) => {
    const exists = saved.some(s => s.id === ad.id)
    if (exists) {
      // Remove from local state + Supabase
      setSaved(prev => prev.filter(s => s.id !== ad.id))
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/saved_ads?library_id=eq.${ad.id}`, {
          method: 'DELETE', headers: sbReadHeaders,
        })
      } catch (err) { console.error('Failed to unsave:', err) }
    } else {
      // Add to local state + Supabase
      setSaved(prev => [...prev, ad])
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/saved_ads`, {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            advertiser_name: ad.pageName,
            ad_copy: ad.creativeBody || '',
            image_url: ad.thumbnailUrl || ad.snapshotUrl || '',
            media_type: 'image',
            library_id: String(ad.id),
            platform: ad.platforms?.join(', ') || 'facebook',
            started_running: ad.startDate ? new Date(ad.startDate).toISOString().split('T')[0] : null,
            page_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
            metadata: {
              days_active: ad.daysActive,
              is_active: ad.isActive,
              impressions_lower: ad.impressionsLower,
              impressions_upper: ad.impressionsUpper,
              creative_title: ad.creativeTitle,
              creative_caption: ad.creativeCaption,
              creative_description: ad.creativeDescription,
              snapshot_url: ad.snapshotUrl,
            },
          }),
        })
      } catch (err) { console.error('Failed to save to library:', err) }
    }
  }, [saved])

  const isAdSaved = useCallback((adId) => saved.some(s => s.id === adId), [saved])

  // Apply status filter
  const filteredResults = results.filter(ad => {
    if (statusFilter === 'live') return ad.isActive
    if (statusFilter === 'ended') return !ad.isActive
    return true
  })

  const liveCount = results.filter(a => a.isActive).length
  const endedCount = results.length - liveCount

  const handleAddKeyDown = (e) => {
    if (e.key === 'Enter') handleAddBrand()
    if (e.key === 'Escape') { setShowAddForm(false); setAddInput(''); setAddError(null) }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Competitor Ads</h2>
          <p className="page-subtitle">track competitors — paste a facebook ad library link to add a brand.</p>
        </div>
        <div className="ca-api-row">
          <span className={`ca-api-dot ${hasKey ? 'active' : apiKey.length > 0 ? 'invalid' : ''}`} />
          <input type="password" className="text-input text-input-sm" value={apiKey}
            onChange={e => setApiKey(e.target.value)} placeholder="meta access token" style={{ width: 220 }} />
        </div>
      </div>

      {/* ── Brands ── */}
      <div className="ca-brands-section">
        <div className="ca-brands-header">
          <h3 className="ca-brands-title">your brands</h3>
          <button className="ca-add-btn" onClick={() => setShowAddForm(!showAddForm)} disabled={!hasKey}>
            {showAddForm ? 'cancel' : '+ add brand'}
          </button>
        </div>

        {showAddForm && (
          <div className="ca-add-form">
            <div className="ca-add-input-row">
              <input type="text" className="text-input ca-add-input" value={addInput}
                onChange={e => { setAddInput(e.target.value); setAddError(null) }}
                onKeyDown={handleAddKeyDown}
                placeholder="paste facebook ad library URL or page ID..." autoFocus />
              <button className="btn btn-primary btn-sm" onClick={handleAddBrand}
                disabled={addLoading || !addInput.trim()}>
                {addLoading ? 'adding...' : 'add'}
              </button>
            </div>
            {addError && <div className="ca-add-error">{addError}</div>}
            <div className="ca-add-hint">
              e.g. https://www.facebook.com/ads/library/?view_all_page_id=187701838409772
            </div>
          </div>
        )}

        {followedBrands.length === 0 && !showAddForm && (
          <div className="ca-brands-empty">no brands added yet. click "+ add brand" and paste a facebook ad library link.</div>
        )}

        {followedBrands.length > 0 && (
          <div className="ca-brands-grid">
            {followedBrands.map(brand => (
              <div key={brand.pageId}
                className={`ca-brand-card ${activeBrand?.pageId === brand.pageId ? 'active' : ''}`}>
                <div className="ca-brand-card-main" onClick={() => loadBrandAds(brand)}
                  title={'View ads from ' + brand.pageName}>
                  <AvatarWithFallback pageId={brand.pageId} pageName={brand.pageName} size={36} />
                  <div className="ca-brand-card-info">
                    <div className="ca-brand-card-name">{brand.pageName}</div>
                    <div className="ca-brand-card-meta">
                      {brand.adCount > 0 && (brand.adCount + ' ads')}
                      {brand.lastFetchedAt && ' \u00b7 cached'}
                    </div>
                  </div>
                </div>
                <button className="ca-brand-card-remove"
                  onClick={(e) => { e.stopPropagation(); handleRemoveBrand(brand.pageId) }} title="remove">
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Active brand controls ── */}
      {activeBrand && (
        <div className="ca-active-header">
          <div className="ca-active-brand">
            <AvatarWithFallback pageId={activeBrand.pageId} pageName={activeBrand.pageName} size={28} />
            <span className="ca-active-name">{activeBrand.pageName}</span>
            {isCached && (
              <button className="ca-refresh-btn" onClick={() => loadBrandAds(activeBrand, true)}
                disabled={isLoading} title="Re-fetch from Meta API">
                &#x21bb; refresh
              </button>
            )}
          </div>
          <div className="ca-active-controls">
            <div className="ca-filter-group">
              <span className="ca-filter-label">status</span>
              <select className="select-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                style={{ fontSize: 'var(--text-xs)', width: 110 }}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ca-filter-group">
              <span className="ca-filter-label">sort</span>
              <select className="select-input" value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ fontSize: 'var(--text-xs)' }}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ca-filter-group">
              <span className="ca-filter-label">country</span>
              <select className="select-input" value={country} onChange={e => setCountry(e.target.value)}
                style={{ fontSize: 'var(--text-xs)', width: 70 }}>
                {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {activeBrand && (
        <div className="ca-stats">
          <span className="ca-badge">{filteredResults.length} of {results.length} ads</span>
          <span className="ca-badge">{liveCount} live</span>
          <span className="ca-badge">{endedCount} ended</span>
          <span className="ca-badge">{saved.length} saved</span>
          {isCached && <span className="ca-badge ca-badge-cached">from cache</span>}
          {isLoading && loadingStatus && (
            <span className="ca-badge ca-badge-loading">
              <span className="ca-spinner-sm" />
              {loadingStatus}
            </span>
          )}
        </div>
      )}

      {/* ── Results ── */}
      <div className="ca-results">
        {isLoading && results.length === 0 && (
          <div className="ca-state-msg">
            <div className="ca-spinner" />
            <span>{loadingStatus || 'loading ads...'}</span>
          </div>
        )}
        {!isLoading && error && (
          <div className="ca-state-msg ca-error">error: {error}. check your api token and try again.</div>
        )}
        {!isLoading && !error && activeBrand && results.length === 0 && (
          <div className="ca-state-msg">no ads found for {activeBrand.pageName}.</div>
        )}
        {!isLoading && !error && activeBrand && results.length > 0 && filteredResults.length === 0 && (
          <div className="ca-state-msg">no {statusFilter === 'live' ? 'live' : 'ended'} ads. try changing the status filter.</div>
        )}
        {!isLoading && !activeBrand && followedBrands.length > 0 && (
          <div className="ca-state-msg">click a brand above to see their ads.</div>
        )}
        {filteredResults.length > 0 && (
          <div className="ca-grid">
            {filteredResults.map(ad => (
              <AdCard key={ad.id} ad={ad} isSaved={isAdSaved(ad.id)}
                onToggleSave={toggleSave} onExpand={setModalAd} />
            ))}
          </div>
        )}
      </div>

      {/* ── Saved ── */}
      {saved.length > 0 && (
        <div className="ca-saved-section">
          <div className="ca-saved-header" onClick={() => setSavedExpanded(!savedExpanded)}>
            <h3 className="ca-saved-title">saved ads ({saved.length})</h3>
            <span className={`ca-toggle-arrow ${savedExpanded ? '' : 'collapsed'}`}>&#9660;</span>
          </div>
          {savedExpanded && (
            <div className="ca-grid">
              {saved.map(ad => (
                <AdCard key={ad.id} ad={ad} isSaved={true} onToggleSave={toggleSave} onExpand={setModalAd} />
              ))}
            </div>
          )}
        </div>
      )}

      {modalAd && <AdPreviewModal ad={modalAd} onClose={() => setModalAd(null)} />}
    </div>
  )
}
