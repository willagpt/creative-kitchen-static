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

// Extract page ID from various URL formats or raw ID
function extractPageId(input) {
  const trimmed = input.trim()

  // Raw numeric page ID
  if (/^\d+$/.test(trimmed)) return trimmed

  // URL with view_all_page_id param
  const urlMatch = trimmed.match(/view_all_page_id=(\d+)/)
  if (urlMatch) return urlMatch[1]

  // URL with /ads/library/?... &id=123
  const idMatch = trimmed.match(/[?&]id=(\d+)/)
  if (idMatch) return idMatch[1]

  // facebook.com/pagename or facebook.com/pages/name/123
  const pageIdFromPath = trimmed.match(/facebook\.com\/pages\/[^/]+\/(\d+)/)
  if (pageIdFromPath) return pageIdFromPath[1]

  // facebook.com/profile.php?id=123
  const profileMatch = trimmed.match(/profile\.php\?id=(\d+)/)
  if (profileMatch) return profileMatch[1]

  // Can't extract a numeric ID — return null
  return null
}

// Facebook public profile picture
function getPagePictureUrl(pageId) {
  return `https://graph.facebook.com/${pageId}/picture?type=small`
}

// ── Supabase helpers ──

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
      country: row.country || 'GB',
    }))
  } catch {
    return []
  }
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
        country: brand.country || 'GB',
      }),
    })
    return true
  } catch {
    return false
  }
}

async function removeBrandFromSupabase(pageId) {
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

// Look up a page by ID using ads_archive — get its name and platforms
async function lookupPageById(pageId, apiKey, country) {
  // Meta requires search_terms even when using search_page_ids
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

  // Show Meta's actual error if there is one
  if (data.error) {
    console.error('Meta API error:', data.error)
    throw new Error(data.error.message || 'Meta API error')
  }

  if (!response.ok) throw new Error('API error: ' + response.status)

  if (!data.data || data.data.length === 0) {
    // Try without country filter — the page might not have ads in this country
    const params2 = new URLSearchParams({
      access_token: apiKey,
      search_page_ids: pageId,
      search_terms: ' ',
      ad_reached_countries: 'ALL',
      ad_type: 'ALL',
      fields: 'page_id,page_name,publisher_platforms,bylines',
      limit: 10,
      ad_active_status: 'ALL',
    })

    const response2 = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params2)
    const data2 = await response2.json()

    if (data2.error) throw new Error(data2.error.message)
    if (!data2.data || data2.data.length === 0) {
      throw new Error('No ads found for this page ID. Check the URL is correct.')
    }

    return extractBrandFromResults(data2.data, pageId, country)
  }

  return extractBrandFromResults(data.data, pageId, country)
}

function extractBrandFromResults(results, pageId, country) {
  const ad = results[0]
  const platforms = new Set()
  results.forEach(a => {
    if (a.publisher_platforms) a.publisher_platforms.forEach(p => platforms.add(p))
  })

  return {
    pageId: String(ad.page_id || pageId),
    pageName: ad.page_name || 'Unknown',
    platforms: Array.from(platforms),
    byline: ad.bylines?.[0] || '',
    adCount: results.length,
    country,
  }
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
    <img
      src={getPagePictureUrl(pageId)}
      alt={pageName}
      className="ca-avatar-img"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  )
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
  const [sortBy, setSortBy] = useState('longest')
  const [country, setCountry] = useState('GB')
  const [results, setResults] = useState([])
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedCompetitorAds') || '[]') }
    catch { return [] }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savedExpanded, setSavedExpanded] = useState(true)

  // Followed brands
  const [followedBrands, setFollowedBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)

  // Add brand
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const hasKey = apiKey.length > 20

  // Load followed brands on mount
  useEffect(() => {
    fetchFollowedBrands().then(setFollowedBrands)
  }, [])

  // Persist API key
  useEffect(() => {
    if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey)
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

  // ── Add a brand by pasting a URL or page ID ──
  const handleAddBrand = useCallback(async () => {
    if (!addInput.trim() || !apiKey) return

    setAddLoading(true)
    setAddError(null)

    const pageId = extractPageId(addInput)
    if (!pageId) {
      setAddError('Could not find a page ID in that URL. Try pasting a Facebook Ad Library link or a numeric page ID.')
      setAddLoading(false)
      return
    }

    // Check if already followed
    if (followedBrands.some(b => b.pageId === pageId)) {
      setAddError('This brand is already in your list.')
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
        setAddError(null)
      } else {
        setAddError('Failed to save. Try again.')
      }
    } catch (err) {
      setAddError(err.message || 'Could not look up this page.')
    } finally {
      setAddLoading(false)
    }
  }, [addInput, apiKey, country, followedBrands])

  // ── Remove a brand ──
  const handleRemoveBrand = useCallback(async (pageId) => {
    const success = await removeBrandFromSupabase(pageId)
    if (success) {
      setFollowedBrands(prev => prev.filter(b => b.pageId !== pageId))
      if (activeBrand?.pageId === pageId) {
        setActiveBrand(null)
        setResults([])
      }
    }
  }, [activeBrand])

  // ── Load ads for a brand ──
  const loadBrandAds = useCallback(async (brand) => {
    if (!apiKey) return

    setActiveBrand(brand)
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        access_token: apiKey,
        search_page_ids: brand.pageId,
        search_terms: ' ',
        ad_reached_countries: country,
        ad_type: 'ALL',
        fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,bylines,impressions,page_id,page_name,publisher_platforms,estimated_audience_size',
        limit: 50,
        ad_active_status: 'ALL',
      })

      const response = await fetch('https://graph.facebook.com/v19.0/ads_archive?' + params)
      const data = await response.json()
      if (data.error) throw new Error(data.error.message)
      if (!response.ok) throw new Error('API Error: ' + response.status)

      if (data.data && data.data.length > 0) {
        const processed = processResults(data.data)
        setResults(sortAds(processed, sortBy))
      } else {
        setResults([])
      }
    } catch (err) {
      setError(err.message)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [apiKey, country, sortBy, sortAds])

  // Re-sort when sort changes
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

  const handleAddKeyDown = (e) => {
    if (e.key === 'Enter') handleAddBrand()
    if (e.key === 'Escape') { setShowAddForm(false); setAddInput(''); setAddError(null) }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Competitor Ads</h2>
          <p className="page-subtitle">track competitors &mdash; paste a facebook ad library link to add a brand.</p>
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

      {/* ── Followed Brands ── */}
      <div className="ca-brands-section">
        <div className="ca-brands-header">
          <h3 className="ca-brands-title">your brands</h3>
          <button
            className="ca-add-btn"
            onClick={() => setShowAddForm(!showAddForm)}
            disabled={!hasKey}
          >
            {showAddForm ? 'cancel' : '+ add brand'}
          </button>
        </div>

        {/* Add brand form */}
        {showAddForm && (
          <div className="ca-add-form">
            <div className="ca-add-input-row">
              <input
                type="text"
                className="text-input ca-add-input"
                value={addInput}
                onChange={e => { setAddInput(e.target.value); setAddError(null) }}
                onKeyDown={handleAddKeyDown}
                placeholder="paste facebook ad library URL or page ID..."
                autoFocus
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAddBrand}
                disabled={addLoading || !addInput.trim()}
              >
                {addLoading ? 'adding...' : 'add'}
              </button>
            </div>
            {addError && <div className="ca-add-error">{addError}</div>}
            <div className="ca-add-hint">
              e.g. https://www.facebook.com/ads/library/?view_all_page_id=187701838409772
            </div>
          </div>
        )}

        {/* Brand cards */}
        {followedBrands.length === 0 && !showAddForm && (
          <div className="ca-brands-empty">
            no brands added yet. click "+ add brand" and paste a facebook ad library link.
          </div>
        )}

        {followedBrands.length > 0 && (
          <div className="ca-brands-grid">
            {followedBrands.map(brand => (
              <div
                key={brand.pageId}
                className={`ca-brand-card ${activeBrand?.pageId === brand.pageId ? 'active' : ''}`}
              >
                <div
                  className="ca-brand-card-main"
                  onClick={() => loadBrandAds(brand)}
                  title={'View ads from ' + brand.pageName}
                >
                  <AvatarWithFallback pageId={brand.pageId} pageName={brand.pageName} size={36} />
                  <div className="ca-brand-card-info">
                    <div className="ca-brand-card-name">{brand.pageName}</div>
                    <div className="ca-brand-card-meta">
                      {brand.adCount > 0 && (brand.adCount + ' ads')}
                      {brand.platforms.length > 0 && ' \u00b7 '}
                      {brand.platforms.includes('facebook') && 'fb'}
                      {brand.platforms.includes('facebook') && brand.platforms.includes('instagram') && ' \u00b7 '}
                      {brand.platforms.includes('instagram') && 'ig'}
                    </div>
                  </div>
                </div>
                <button
                  className="ca-brand-card-remove"
                  onClick={(e) => { e.stopPropagation(); handleRemoveBrand(brand.pageId) }}
                  title="remove"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Active brand header ── */}
      {activeBrand && (
        <div className="ca-active-header">
          <div className="ca-active-brand">
            <AvatarWithFallback pageId={activeBrand.pageId} pageName={activeBrand.pageName} size={28} />
            <span className="ca-active-name">{activeBrand.pageName}</span>
          </div>

          <div className="ca-active-controls">
            <div className="ca-filter-group">
              <span className="ca-filter-label">sort</span>
              <select
                className="select-input"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
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
                style={{ fontSize: 'var(--text-xs)', width: 70 }}
              >
                {COUNTRIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {activeBrand && (
        <div className="ca-stats">
          <span className="ca-badge">{results.length} ads found</span>
          <span className="ca-badge">{saved.length} saved</span>
        </div>
      )}

      {/* ── Results ── */}
      <div className="ca-results">
        {isLoading && (
          <div className="ca-state-msg">
            <div className="ca-spinner" />
            <span>loading ads...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="ca-state-msg ca-error">
            error: {error}. check your api token and try again.
          </div>
        )}

        {!isLoading && !error && activeBrand && results.length === 0 && (
          <div className="ca-state-msg">no ads found for {activeBrand.pageName}.</div>
        )}

        {!isLoading && !activeBrand && followedBrands.length > 0 && (
          <div className="ca-state-msg">click a brand above to see their ads.</div>
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

      {/* ── Saved Ads ── */}
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
