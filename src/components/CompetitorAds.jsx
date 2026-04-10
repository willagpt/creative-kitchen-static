import { useState, useEffect, useCallback, useRef } from 'react'
import './CompetitorAds.css'

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

// Extract unique advertisers from ad results
function extractAdvertisers(rawResults) {
  const seen = new Map()
  for (const ad of rawResults) {
    const pageId = ad.page_id
    if (pageId && !seen.has(pageId)) {
      // Count ads for this page in the results
      const adCount = rawResults.filter(a => a.page_id === pageId).length
      // Collect platforms
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
        followers: 0,
        category: '',
        pictureUrl: null,
      })
    }
  }
  // Sort by ad count (most ads first)
  return Array.from(seen.values()).sort((a, b) => b.adCount - a.adCount)
}

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

  const hasKey = apiKey.length > 20

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

  // Debounced advertiser lookup \u2014 fires as user types
  // Two strategies: (1) Facebook Pages Search API for direct page name matching,
  // (2) Fallback to ads_archive with high limit + client-side name filtering
  const lookupAdvertisers = useCallback(async (query) => {
    if (!query.trim() || query.trim().length < 2 || !apiKey) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    setSuggestionsLoading(true)
    setShowSuggestions(true)
    const trimmed = query.trim().toLowerCase()

    try {
      let advertisers = []

      // Strategy 1: Facebook Pages Search API \u2014 searches page NAMES directly
      // Requires pages_read_engagement permission on the token
      const pageSearchEndpoints = [
        'https://graph.facebook.com/v19.0/pages/search',
        'https://graph.facebook.com/v19.0/search',
      ]

      for (const endpoint of pageSearchEndpoints) {
        if (advertisers.length > 0) break
        try {
          const pageParams = new URLSearchParams({
            access_token: apiKey,
            q: query.trim(),
            fields: 'id,name,category,fan_count,picture',
            limit: 25,
          })
          // The /search endpoint needs type=page
          if (endpoint.endsWith('/search')) {
            pageParams.append('type', 'page')
          }
          const pageResp = await fetch(endpoint + '?' + pageParams)
          const pageData = await pageResp.json()

          // Log for debugging \u2014 visible in browser console
          if (pageData.error) {
            console.warn('[Pages Search] ' + endpoint + ' \u2192', pageData.error.message)
            continue
          }

          if (pageData.data && pageData.data.length > 0) {
            console.info('[Pages Search] ' + endpoint + ' \u2192 found ' + pageData.data.length + ' pages')
            advertisers = pageData.data.map(page => ({
              pageId: page.id,
              pageName: page.name,
              category: page.category || '',
              followers: page.fan_count || 0,
              platforms: ['facebook'],
              adCount: 0,
              byline: page.category || '',
              pictureUrl: page.picture?.data?.url || null,
              source: 'pages_search',
            }))
          }
        } catch (e) {
          console.warn('[Pages Search] ' + endpoint + ' failed:', e.message)
        }
      }

      // Strategy 2: Fallback \u2014 ads_archive with high limit + smart name filtering
      if (advertisers.length === 0) {
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
        if (!response.ok) throw new Error('API Error')
        const data = await response.json()

        if (data.data && data.data.length > 0) {
          const allPages = extractAdvertisers(data.data)

          // Filter to pages whose name actually matches the query
          const nameMatches = allPages.filter(adv =>
            adv.pageName.toLowerCase().includes(trimmed)
          )

          // Sort matches: exact match first, then starts-with, then contains
          nameMatches.sort((a, b) => {
            const aName = a.pageName.toLowerCase()
            const bName = b.pageName.toLowerCase()
            const aExact = aName === trimmed
            const bExact = bName === trimmed
            if (aExact !== bExact) return aExact ? -1 : 1
            const aStarts = aName.startsWith(trimmed)
            const bStarts = bName.startsWith(trimmed)
            if (aStarts !== bStarts) return aStarts ? -1 : 1
            return b.adCount - a.adCount
          })

          // Use name-filtered results if we have them, otherwise show all
          advertisers = nameMatches.length > 0 ? nameMatches : allPages
        }
      }

      setSuggestions(advertisers)
    } catch (err) {
      console.error('Lookup error:', err)
      setSuggestions([])
    } finally {
      setSuggestionsLoading(false)
    }
  }, [apiKey, country])

  // Handle search input changes with debounce
  const handleSearchInput = (e) => {
    const value = e.target.value
    setSearchQuery(value)

    // If they had a selected advertiser and are now editing, clear it
    if (selectedAdvertiser) {
      setSelectedAdvertiser(null)
    }

    // Debounce the lookup
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      lookupAdvertisers(value)
    }, 400)
  }

  // Select an advertiser from dropdown
  const selectAdvertiser = (advertiser) => {
    setSelectedAdvertiser(advertiser)
    setSearchQuery(advertiser.pageName)
    setShowSuggestions(false)
    setSuggestions([])
  }

  // Clear selected advertiser
  const clearAdvertiser = () => {
    setSelectedAdvertiser(null)
    setSearchQuery('')
    setResults([])
    setHasSearched(false)
  }

  // Full ad search \u2014 uses page_id if advertiser selected, otherwise text search
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

      // If we have a selected advertiser, search by page_id for precision
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

  // Re-sort when sort changes
  useEffect(() => {
    if (results.length > 0) {
      setResults(prev => sortAds(prev, sortBy))
    }
  }, [sortBy, sortAds])

  const toggleSave = useCallback((ad) => {
    setSaved(prev => {
      const index = prev.findIndex(s => s.id === ad.id)
      if (index > -1) {
        return prev.filter(s => s.id !== ad.id)
      } else {
        return [...prev, ad]
      }
    })
  }, [])

  const isAdSaved = useCallback((adId) => {
    return saved.some(s => s.id === adId)
  }, [saved])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      setShowSuggestions(false)
      performSearch()
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Competitor Ads</h2>
          <p className="page-subtitle">search meta ad library \u2014 find what's working, save what matters.</p>
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

      {/* Search Bar with Autocomplete */}
      <div className="ca-search-row" ref={searchWrapperRef}>
        <div className="ca-search-wrapper">
          {selectedAdvertiser ? (
            <div className="ca-selected-chip">
              <div className="ca-chip-info">
                <span className="ca-chip-name">{selectedAdvertiser.pageName}</span>
                <span className="ca-chip-meta">
                  {selectedAdvertiser.followers > 0 && (formatNumber(selectedAdvertiser.followers) + ' followers')}
                  {selectedAdvertiser.followers > 0 && selectedAdvertiser.category && ' \u00b7 '}
                  {selectedAdvertiser.category && selectedAdvertiser.category}
                  {!selectedAdvertiser.followers && !selectedAdvertiser.category && (
                    <>
                      {selectedAdvertiser.platforms.includes('facebook') && 'fb'}
                      {selectedAdvertiser.platforms.includes('facebook') && selectedAdvertiser.platforms.includes('instagram') && ' \u00b7 '}
                      {selectedAdvertiser.platforms.includes('instagram') && 'ig'}
                      {selectedAdvertiser.adCount > 0 && (' \u00b7 ' + selectedAdvertiser.adCount + ' ads')}
                    </>
                  )}
                </span>
              </div>
              <button className="ca-chip-clear" onClick={clearAdvertiser} title="clear">&times;</button>
            </div>
          ) : (
            <input
              type="text"
              className="text-input ca-search-input"
              value={searchQuery}
              onChange={handleSearchInput}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
              placeholder="search by brand or page name..."
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
                    <div className="ca-suggestion-name">"{searchQuery}"</div>
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
                      onClick={() => selectAdvertiser(adv)}
                    >
                      {adv.pictureUrl ? (
                        <img src={adv.pictureUrl} alt="" className="ca-suggestion-avatar-img" />
                      ) : (
                        <div className="ca-suggestion-avatar">
                          {adv.pageName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="ca-suggestion-details">
                        <div className="ca-suggestion-name">{adv.pageName}</div>
                        <div className="ca-suggestion-sub">
                          {adv.followers > 0 && (
                            <span>{formatNumber(adv.followers)} followers</span>
                          )}
                          {adv.followers > 0 && (adv.category || adv.adCount > 0) && ' \u00b7 '}
                          {adv.category && <span>{adv.category}</span>}
                          {!adv.category && adv.adCount > 0 && (
                            <span>{adv.adCount} ad{adv.adCount !== 1 ? 's' : ''} found</span>
                          )}
                          {adv.category && adv.adCount > 0 && (
                            <span> \u00b7 {adv.adCount} ad{adv.adCount !== 1 ? 's' : ''}</span>
                          )}
                          {!adv.followers && !adv.category && adv.adCount === 0 && (
                            <>
                              {adv.platforms.includes('facebook') && <span>fb</span>}
                              {adv.platforms.includes('instagram') && (
                                <span>{adv.platforms.includes('facebook') ? ' \u00b7 ' : ''}ig</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
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
