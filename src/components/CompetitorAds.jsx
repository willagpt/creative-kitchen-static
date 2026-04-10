import { useState, useEffect, useCallback, useRef } from 'react'
import './CompetitorAds.css'

// ── Supabase config ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'

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
const FORMAT_FILTERS = [
  { key: 'all', label: 'all' },
  { key: 'image', label: 'image' },
  { key: 'video', label: 'video' },
  { key: 'carousel', label: 'meme/carousel' },
]

const SORT_OPTIONS = [
  { value: 'longest', label: 'days running (longest first)' },
  { value: 'shortest', label: 'days running (shortest first)' },
  { value: 'newest', label: 'newest first' },
  { value: 'oldest', label: 'oldest first' },
]

const COUNTRIES = [
  { value: 'GB', label: 'gb' },
  { value: 'US', label: 'us' },
  { value: 'EU', label: 'eu' },
]

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

function formatImpressions(impressions) {
  if (typeof impressions === 'object' && impressions !== null) {
    const lower = parseInt(impressions.lower_bound || 0)
    const upper = parseInt(impressions.upper_bound || 0)
    return formatNumber(lower) + '\u2013' + formatNumber(upper)
  }
  if (typeof impressions === 'number') return formatNumber(impressions)
  return String(impressions)
}

function processResults(rawResults) {
  return rawResults.map(ad => {
    const startTime = new Date(ad.ad_delivery_start_time)
    const endTime = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : new Date()
    const daysActive = Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24))
    return {
      id: ad.id,
      pageName: ad.page_name || 'unknown',
      pageId: ad.page_id,
      snapshotUrl: ad.ad_snapshot_url || null,
      startDate: startTime.toISOString(),
      daysActive: Math.max(daysActive, 0),
      platforms: ad.publisher_platforms || [],
      impressions: ad.impressions || null,
      isActive: !ad.ad_delivery_stop_time,
      creativeBody: ad.ad_creative_bodies ? ad.ad_creative_bodies[0] : '',
    }
  })
}

function extractAdvertisers(rawResults) {
  const seen = new Map()
  for (const ad of rawResults) {
    const pageId = ad.page_id
    if (pageId && !seen.has(pageId)) {
      const adCount = rawResults.filter(a => a.page_id === pageId).length
      const platforms = new Set()
      rawResults.filter(a => a.page_id === pageId).forEach(a => {
        if (a.publisher_platforms) a.publisher_platforms.forEach(p => platforms.add(p))
      })
      seen.set(pageId, {
        pageId,
        pageName: ad.page_name || 'Unknown',
        adCount,
        platforms: Array.from(platforms),
        byline: ad.bylines?.[0] || '',
      })
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.adCount - a.adCount)
}

// ── Supabase helpers ──

async function upsertAdvertisers(advertisers, country) {
  if (!advertisers.length) return
  const rows = advertisers.map(a => ({
    page_id: String(a.pageId),
    page_name: a.pageName,
    ad_count: a.adCount,
    platforms: a.platforms,
    byline: a.byline || '',
    country: country || 'GB',
    last_seen_at: new Date().toISOString(),
  }))
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/advertisers`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify(rows),
    })
  } catch (err) {
    console.warn('Advertiser upsert failed:', err)
  }
}

async function searchSupabaseAdvertisers(query, country) {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length < 2) return []
  try {
    const url = `${SUPABASE_URL}/rest/v1/advertisers?page_name=ilike.*${encodeURIComponent(trimmed)}*&country=eq.${country}&order=ad_count.desc&limit=25`
    const res = await fetch(url, { headers: sbReadHeaders })
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => ({
      pageId: row.page_id,
      pageName: row.page_name,
      adCount: row.ad_count || 0,
      platforms: row.platforms || [],
      byline: row.byline || '',
      source: 'supabase',
    }))
  } catch {
    return []
  }
}

// ── Followed brands helpers ──

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
      adCount: row.ad_count || 0,
      notes: row.notes || '',
      country: row.country || 'GB',
    }))
  } catch {
    return []
  }
}

async function followBrand(brand) {
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
        country: brand.country || 'GB',
      }),
    })
    return true
  } catch {
    return false
  }
}

async function unfollowBrand(pageId) {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`,
      { method: 'DELETE', headers: sbReadHeaders }
    )
    return true
  } catch {
    return false
  }
}

// ── Profile picture helper ──
// Facebook public endpoint — works without auth for public pages
function getPagePictureUrl(pageId) {
  return `https://graph.facebook.com/${pageId}/picture?type=small`
}

function AvatarWithFallback({ pageId, pageName, size = 32 }) {
  const [failed, setFailed] = useState(false)
  const letter = pageName?.charAt(0)?.toUpperCase() || '?'

  if (failed || !pageId) {
    return (
      <div className="ca-suggestion-avatar" style={{ width: size, height: size, fontSize: size * 0.44 }}>
        {letter}
      </div>
    )
  }

  return (
    <img
      src={getPagePictureUrl(pageId)}
      alt={pageName}
      className="ca-suggestion-avatar-img"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  )
}

// ── Components ──

function AdCard({ ad, isSaved, onToggleSave }) {
  return (
    <div className="ca-card">
      <div className="ca-card-preview">
        {ad.snapshotUrl ? (
          <iframe
            src={ad.snapshotUrl}
            className="ca-card-iframe"
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            title="ad preview"
          />
        ) : (
          <div className="ca-card-placeholder">no preview available.</div>
        )}
        <button
          className={`ca-save-btn ${isSaved ? 'saved' : ''}`}
          onClick={() => onToggleSave(ad)}
          title={isSaved ? 'unsave' : 'save'}
        >
          <span className="ca-save-icon">{isSaved ? '\u2605' : '\u2606'}</span>
        </button>
      </div>
      <div className="ca-card-body">
        <div className="ca-card-brand">{ad.pageName}</div>
        <div className="ca-card-meta">
          {ad.isActive ? 'running since ' : 'ran from '}{formatDate(ad.startDate)}
          <br />{ad.daysActive} days active
        </div>
        <div className="ca-card-badges">
          <span className="ca-badge">{ad.daysActive}d</span>
          {ad.impressions && (
            <span className="ca-badge">{formatImpressions(ad.impressions)}</span>
          )}
        </div>
        {ad.creativeBody && (
          <div className="ca-card-excerpt">
            {ad.creativeBody.length > 80
              ? ad.creativeBody.substring(0, 80) + '...'
              : ad.creativeBody}
          </div>
        )}
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

function FollowedBrandsPanel({ brands, onSelectBrand, onUnfollow }) {
  const [expanded, setExpanded] = useState(true)

  if (brands.length === 0) return null

  return (
    <div className="ca-followed-panel">
      <div className="ca-followed-header" onClick={() => setExpanded(!expanded)}>
        <h3 className="ca-followed-title">
          followed brands
          <span className="ca-followed-count">{brands.length}</span>
        </h3>
        <span className={`ca-toggle-arrow ${expanded ? '' : 'collapsed'}`}>&#9660;</span>
      </div>
      {expanded && (
        <div className="ca-followed-grid">
          {brands.map(brand => (
            <div key={brand.pageId} className="ca-followed-card">
              <div
                className="ca-followed-card-main"
                onClick={() => onSelectBrand(brand)}
                title={'View ads from ' + brand.pageName}
              >
                <AvatarWithFallback pageId={brand.pageId} pageName={brand.pageName} size={28} />
                <div className="ca-followed-info">
                  <div className="ca-followed-name">{brand.pageName}</div>
                  <div className="ca-followed-meta">
                    {brand.adCount > 0 && (brand.adCount + ' ads')}
                    {brand.platforms.length > 0 && ' \u00b7 '}
                    {brand.platforms.includes('facebook') && 'fb'}
                    {brand.platforms.includes('facebook') && brand.platforms.includes('instagram') && ' \u00b7 '}
                    {brand.platforms.includes('instagram') && 'ig'}
                  </div>
                </div>
              </div>
              <button
                className="ca-followed-unfollow"
                onClick={(e) => { e.stopPropagation(); onUnfollow(brand.pageId) }}
                title="unfollow"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CompetitorAds() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('metaAdLibraryToken') || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('longest')
  const [country, setCountry] = useState('GB')
  const [results, setResults] = useState([])
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedCompetitorAds') || '[]') }
    catch { return [] }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [savedExpanded, setSavedExpanded] = useState(true)

  // Autocomplete state
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedAdvertiser, setSelectedAdvertiser] = useState(null)
  const debounceRef = useRef(null)
  const searchWrapperRef = useRef(null)

  // Followed brands state
  const [followedBrands, setFollowedBrands] = useState([])
  const followedIds = new Set(followedBrands.map(b => b.pageId))

  const hasKey = apiKey.length > 20

  // Load followed brands on mount
  useEffect(() => {
    fetchFollowedBrands().then(setFollowedBrands)
  }, [])

  // Persist API key
  useEffect(() => {
    if (apiKey.length > 20) {
      localStorage.setItem('metaAdLibraryToken', apiKey)
    }
  }, [apiKey])

  // Persist saved ads
  useEffect(() => {
    localStorage.setItem('savedCompetitorAds', JSON.stringify(saved))
  }, [saved])

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const sortAds = useCallback((ads, sort) => {
    return [...ads].sort((a, b) => {
      switch (sort) {
        case 'longest': return b.daysActive - a.daysActive
        case 'shortest': return a.daysActive - b.daysActive
        case 'newest': return new Date(b.startDate) - new Date(a.startDate)
        case 'oldest': return new Date(a.startDate) - new Date(b.startDate)
        default: return 0
      }
    })
  }, [])

  // ── Follow / unfollow ──
  const handleFollow = useCallback(async (brand) => {
    const success = await followBrand({ ...brand, country })
    if (success) {
      setFollowedBrands(prev => [
        { ...brand, country },
        ...prev.filter(b => b.pageId !== brand.pageId),
      ])
    }
  }, [country])

  const handleUnfollow = useCallback(async (pageId) => {
    const success = await unfollowBrand(pageId)
    if (success) {
      setFollowedBrands(prev => prev.filter(b => b.pageId !== pageId))
    }
  }, [])

  // Click a followed brand to search their ads
  const handleSelectFollowedBrand = useCallback((brand) => {
    setSelectedAdvertiser(brand)
    setSearchQuery(brand.pageName)
    setShowSuggestions(false)
    setSuggestions([])
  }, [])

  // ── Autocomplete: Supabase first, then ads_archive ──
  const lookupAdvertisers = useCallback(async (query) => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    setSuggestionsLoading(true)
    setShowSuggestions(true)
    const trimmed = query.trim().toLowerCase()

    try {
      const sbResults = await searchSupabaseAdvertisers(query, country)

      if (sbResults.length > 0) {
        setSuggestions(sbResults)
        setSuggestionsLoading(false)
      }

      if (apiKey) {
        const params = new URLSearchParams({
          access_token: apiKey,
          search_terms: query.trim(),
          ad_reached_countries: country,
          ad_type: 'ALL',
          fields: 'page_id,page_name,publisher_platforms,bylines',
          limit: 500,
          ad_active_status: 'ALL',
        })

        const response = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params)
        if (response.ok) {
          const data = await response.json()
          if (data.data && data.data.length > 0) {
            const metaPages = extractAdvertisers(data.data)
            upsertAdvertisers(metaPages, country)

            const seenIds = new Set(sbResults.map(s => s.pageId))
            const newFromMeta = metaPages
              .filter(p => !seenIds.has(p.pageId))
              .map(p => ({ ...p, source: 'meta' }))

            const merged = [...sbResults, ...newFromMeta]

            merged.sort((a, b) => {
              const aName = a.pageName.toLowerCase()
              const bName = b.pageName.toLowerCase()
              const aMatch = aName.includes(trimmed)
              const bMatch = bName.includes(trimmed)
              if (aMatch !== bMatch) return aMatch ? -1 : 1
              if (aMatch && bMatch) {
                const aExact = aName === trimmed
                const bExact = bName === trimmed
                if (aExact !== bExact) return aExact ? -1 : 1
                const aStarts = aName.startsWith(trimmed)
                const bStarts = bName.startsWith(trimmed)
                if (aStarts !== bStarts) return aStarts ? -1 : 1
              }
              return b.adCount - a.adCount
            })

            setSuggestions(merged)
          }
        }
      }
    } catch (err) {
      console.error('Lookup error:', err)
    } finally {
      setSuggestionsLoading(false)
    }
  }, [apiKey, country])

  const handleSearchInput = (e) => {
    const value = e.target.value
    setSearchQuery(value)
    if (selectedAdvertiser) setSelectedAdvertiser(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      lookupAdvertisers(value)
    }, 300)
  }

  const selectAdvertiser = (advertiser) => {
    setSelectedAdvertiser(advertiser)
    setSearchQuery(advertiser.pageName)
    setShowSuggestions(false)
    setSuggestions([])
  }

  const clearAdvertiser = () => {
    setSelectedAdvertiser(null)
    setSearchQuery('')
    setResults([])
    setHasSearched(false)
  }

  const performSearch = useCallback(async () => {
    if (!apiKey) return
    if (!selectedAdvertiser && !searchQuery.trim()) return

    setIsLoading(true)
    setError(null)
    setHasSearched(true)
    setShowSuggestions(false)

    try {
      const params = new URLSearchParams({
        access_token: apiKey,
        ad_reached_countries: country,
        ad_type: 'ALL',
        fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,bylines,impressions,page_id,page_name,publisher_platforms,estimated_audience_size',
        limit: 50,
        ad_active_status: 'ALL',
      })

      if (selectedAdvertiser) {
        params.append('search_page_ids', selectedAdvertiser.pageId)
      } else {
        params.append('search_terms', searchQuery.trim())
      }

      if (dateFrom) params.append('ad_delivery_date_min', dateFrom)
      if (dateTo) params.append('ad_delivery_date_max', dateTo)

      const response = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params)
      if (!response.ok) throw new Error('API Error: ' + response.status)
      const data = await response.json()

      if (data.error) throw new Error(data.error.message || 'API error')

      if (data.data && data.data.length > 0) {
        const processed = processResults(data.data)
        setResults(sortAds(processed, sortBy))
        const discovered = extractAdvertisers(data.data)
        upsertAdvertisers(discovered, country)
      } else {
        setResults([])
      }
    } catch (err) {
      console.error('Search error:', err)
      setError(err.message)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [apiKey, searchQuery, selectedAdvertiser, country, dateFrom, dateTo, sortBy, sortAds])

  useEffect(() => {
    if (results.length > 0) {
      setResults(prev => sortAds(prev, sortBy))
    }
  }, [sortBy, sortAds])

  const toggleSave = useCallback((ad) => {
    setSaved(prev => {
      const index = prev.findIndex(s => s.id === ad.id)
      if (index > -1) return prev.filter(s => s.id !== ad.id)
      return [...prev, ad]
    })
  }, [])

  const isAdSaved = useCallback((adId) => {
    return saved.some(s => s.id === adId)
  }, [saved])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { setShowSuggestions(false); performSearch() }
    if (e.key === 'Escape') setShowSuggestions(false)
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Competitor Ads</h2>
          <p className="page-subtitle">search meta ad library — find what's working, save what matters.</p>
        </div>
        <div className="ca-api-row">
          <span className={`ca-api-dot ${hasKey ? 'active' : apiKey.length > 0 ? 'invalid' : ''}`} />
          <input
            type="password"
            className="text-input text-input-sm"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="meta access token"
            style={{ width: 220 }}
          />
        </div>
      </div>

      {/* Followed Brands Panel */}
      <FollowedBrandsPanel
        brands={followedBrands}
        onSelectBrand={handleSelectFollowedBrand}
        onUnfollow={handleUnfollow}
      />

      {/* Search Bar with Autocomplete */}
      <div className="ca-search-row" ref={searchWrapperRef}>
        <div className="ca-search-wrapper">
          {selectedAdvertiser ? (
            <div className="ca-selected-chip">
              <div className="ca-chip-info">
                <span className="ca-chip-name">{selectedAdvertiser.pageName}</span>
                <span className="ca-chip-meta">
                  {selectedAdvertiser.adCount > 0 && (selectedAdvertiser.adCount + ' ads')}
                  {selectedAdvertiser.adCount > 0 && selectedAdvertiser.platforms.length > 0 && ' \u00b7 '}
                  {selectedAdvertiser.platforms.includes('facebook') && 'fb'}
                  {selectedAdvertiser.platforms.includes('facebook') && selectedAdvertiser.platforms.includes('instagram') && ' \u00b7 '}
                  {selectedAdvertiser.platforms.includes('instagram') && 'ig'}
                </span>
              </div>
              <div className="ca-chip-actions">
                {!followedIds.has(selectedAdvertiser.pageId) ? (
                  <button
                    className="ca-chip-follow"
                    onClick={() => handleFollow(selectedAdvertiser)}
                    title="follow this brand"
                  >
                    + follow
                  </button>
                ) : (
                  <span className="ca-chip-following">following</span>
                )}
                <button className="ca-chip-clear" onClick={clearAdvertiser} title="clear">&times;</button>
              </div>
            </div>
          ) : (
            <input
              type="text"
              className="text-input ca-search-input"
              value={searchQuery}
              onChange={handleSearchInput}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
              placeholder="search by brand name or keyword..."
              disabled={!hasKey}
            />
          )}

          {/* Suggestions Dropdown */}
          {showSuggestions && (
            <div className="ca-suggestions">
              {suggestionsLoading && (
                <div className="ca-suggestion-loading">
                  <div className="ca-spinner-sm" />
                  <span>searching advertisers...</span>
                </div>
              )}

              {!suggestionsLoading && suggestions.length === 0 && searchQuery.length >= 2 && (
                <div className="ca-suggestion-empty">no advertisers found</div>
              )}

              {!suggestionsLoading && searchQuery.trim().length >= 2 && (
                <div className="ca-suggestion-item ca-suggestion-text-search" onClick={() => { setShowSuggestions(false); performSearch() }}>
                  <span className="ca-suggestion-search-icon">&#128269;</span>
                  <div>
                    <div className="ca-suggestion-name">&ldquo;{searchQuery}&rdquo;</div>
                    <div className="ca-suggestion-sub">search this exact phrase</div>
                  </div>
                </div>
              )}

              {!suggestionsLoading && suggestions.length > 0 && (
                <>
                  <div className="ca-suggestion-divider">
                    <span>Advertisers</span>
                  </div>
                  {suggestions.map(adv => (
                    <div
                      key={adv.pageId}
                      className="ca-suggestion-item"
                    >
                      <div className="ca-suggestion-main" onClick={() => selectAdvertiser(adv)}>
                        <AvatarWithFallback pageId={adv.pageId} pageName={adv.pageName} size={32} />
                        <div className="ca-suggestion-details">
                          <div className="ca-suggestion-name">{adv.pageName}</div>
                          <div className="ca-suggestion-sub">
                            {adv.adCount} ad{adv.adCount !== 1 ? 's' : ''} found
                            {adv.platforms.length > 0 && ' \u00b7 '}
                            {adv.platforms.includes('facebook') && 'fb'}
                            {adv.platforms.includes('facebook') && adv.platforms.includes('instagram') && ' \u00b7 '}
                            {adv.platforms.includes('instagram') && 'ig'}
                          </div>
                        </div>
                      </div>
                      {!followedIds.has(adv.pageId) ? (
                        <button
                          className="ca-suggestion-follow-btn"
                          onClick={(e) => { e.stopPropagation(); handleFollow(adv) }}
                          title="follow"
                        >
                          +
                        </button>
                      ) : (
                        <span className="ca-suggestion-following-badge">&#check;</span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <button
          className="btn btn-primary btn-sm"
          onClick={performSearch}
          disabled={!hasKey || isLoading || (!selectedAdvertiser && !searchQuery.trim())}
        >
          {isLoading ? 'searching...' : 'search'}
        </button>
      </div>

      {/* Filters */}
      <div className="ca-filters">
        <div className="ca-filter-group">
          <span className="ca-filter-label">format</span>
          {FORMAT_FILTERS.map(f => (
            <button
              key={f.key}
              className={`ca-pill ${formatFilter === f.key ? 'active' : ''}`}
              onClick={() => setFormatFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ca-filter-group">
          <span className="ca-filter-label">date range</span>
          <input
            type="date"
            className="text-input text-input-sm ca-date-input"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            disabled={!hasKey}
          />
          <span className="ca-date-sep">to</span>
          <input
            type="date"
            className="text-input text-input-sm ca-date-input"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            disabled={!hasKey}
          />
        </div>

        <div className="ca-filter-group">
          <span className="ca-filter-label">sort by</span>
          <select
            className="select-input"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            disabled={!hasKey}
            style={{ fontSize: 'var(--text-xs)' }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="ca-filter-group">
          <span className="ca-filter-label">country</span>
          <select
            className="select-input"
            value={country}
            onChange={e => setCountry(e.target.value)}
            disabled={!hasKey}
            style={{ fontSize: 'var(--text-xs)', width: 70 }}
          >
            {COUNTRIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="ca-stats">
        <span className="ca-badge">{results.length} ads found</span>
        <span className="ca-badge">{saved.length} saved</span>
      </div>

      {/* Results */}
      <div className="ca-results">
        {isLoading && (
          <div className="ca-state-msg">
            <div className="ca-spinner" />
            <span>searching ads...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="ca-state-msg ca-error">
            error: {error}. check your api token and try again.
          </div>
        )}

        {!isLoading && !error && hasSearched && results.length === 0 && (
          <div className="ca-state-msg">no ads found for that search.</div>
        )}

        {!isLoading && !hasSearched && (
          <div className="ca-state-msg">search for a brand to see their ads.</div>
        )}

        {!isLoading && results.length > 0 && (
          <div className="ca-grid">
            {results.map(ad => (
              <AdCard
                key={ad.id}
                ad={ad}
                isSaved={isAdSaved(ad.id)}
                onToggleSave={toggleSave}
              />
            ))}
          </div>
        )}
      </div>

      {/* Saved Ads */}
      {saved.length > 0 && (
        <div className="ca-saved-section">
          <div className="ca-saved-header" onClick={() => setSavedExpanded(!savedExpanded)}>
            <h3 className="ca-saved-title">saved ads</h3>
            <span className={`ca-toggle-arrow ${savedExpanded ? '' : 'collapsed'}`}>&#9660;</span>
          </div>
          {savedExpanded && (
            <div className="ca-grid">
              {saved.map(ad => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  isSaved={true}
                  onToggleSave={toggleSave}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}