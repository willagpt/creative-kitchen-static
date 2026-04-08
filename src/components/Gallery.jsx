export default function Gallery({ ads, versions, loading, filter, setFilter, stats, onSelectAd }) {
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'with-prompt', label: 'With Prompt' },
    { key: 'with-image', label: 'Generated' },
    { key: 'pending', label: 'Pending' },
  ]

  return (
    <>
      {/* Stats */}
      <div className="stats-bar">
        <div className="stat stat-total">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">saved ads</span>
        </div>
        <div className="stat stat-prompts">
          <span className="stat-value">{stats.withPrompt}</span>
          <span className="stat-label">with prompts</span>
        </div>
        <div className="stat stat-images">
          <span className="stat-value">{stats.withImages}</span>
          <span className="stat-label">with images</span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16 }}>
        <div className="filters">
          {filters.map(f => (
            <button
              key={f.key}
              className={`filter-pill ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p>Loading ads...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && ads.length === 0 && (
        <div className="empty-state">
          <h3>No ads yet</h3>
          <p>
            Save ads from the Facebook Ad Library using the Chrome extension.
            They will appear here automatically.
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && ads.length > 0 && (
        <div className="gallery-grid">
          {ads.map(ad => (
            <AdCard
              key={ad.id}
              ad={ad}
              versions={versions[ad.id] || []}
              onClick={() => onSelectAd(ad.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function AdCard({ ad, versions, onClick }) {
  const hasPrompt = !!ad.generated_prompt
  const hasImage = !!ad.generated_image_url || versions.length > 0
  const latestImage = versions[0]?.image_url || ad.generated_image_url

  let badge = null
  if (hasImage) badge = <span className="ad-card-badge has-image">{versions.length || 1} version{versions.length !== 1 ? 's' : ''}</span>
  else if (hasPrompt) badge = <span className="ad-card-badge has-prompt">prompt ready</span>
  else badge = <span className="ad-card-badge pending">pending</span>

  const date = ad.created_at
    ? new Date(ad.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div className="card" onClick={onClick}>
      <div className="ad-card-image">
        {ad.image_url ? (
          <img src={ad.image_url} alt={ad.advertiser_name || 'Ad'} loading="lazy" />
        ) : (
          <div className="panel-placeholder">
            <p>No image</p>
          </div>
        )}
        {badge}
      </div>
      <div className="ad-card-body">
        <div className="ad-card-name">{ad.advertiser_name || 'Unknown brand'}</div>
        <div className="ad-card-meta">
          {date}
          {ad.platform && ` \u00b7 ${ad.platform}`}
          {ad.started_running && ` \u00b7 running since ${ad.started_running}`}
        </div>
        {versions.length > 0 && (
          <div className="ad-card-versions">
            {versions.slice(0, 5).map(v => (
              <div key={v.id} className="ad-card-version-dot">
                <img src={v.image_url} alt="" loading="lazy" />
              </div>
            ))}
            {versions.length > 5 && (
              <div className="ad-card-version-dot" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-3)', fontSize: 'var(--text-xs)', color: 'var(--text-2)'
              }}>
                +{versions.length - 5}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
