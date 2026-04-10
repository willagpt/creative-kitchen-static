import { useState, useEffect, useCallback } from 'react'
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

  const performSearch = useCallback(async () => {
    if (!searchQuery.trim() || !apiKey) return
    setIsLoading(true)
    setError(null)
    setHasSearched(true)

    try {
      const params = new URLSearchParams({
        access_token: apiKey,
        search_terms: searchQuery,
        ad_reached_countries: country,
        ad_type: 'ALL',
        fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,bylines,impressions,page_id,page_name,publisher_platforms,estimated_audience_size',
        limit: 50,
        ad_active_status: 'ALL',
      })

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
  }, [apiKey, searchQuery, country, dateFrom, dateTo, sortBy, sortAds])

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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') performSearch()
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

      {/* Search Bar */}
      <div className="ca-search-row">
        <input
          type="text"
          className="text-input ca-search-input"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="search by brand or page name..."
          disabled={!hasKey}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={performSearch}
          disabled={!hasKey || isLoading || !searchQuery.trim()}
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
