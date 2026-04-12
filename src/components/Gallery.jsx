import { useState } from 'react'

export default function Gallery({ ads, loading, onSelectAd, brands, activeBrandId }) {
  const activeBrand = brands?.find(b => b.id === activeBrandId)

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <h2 className="font-heading" style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xs)' }}>
          Ad Library
        </h2>
        <p className="text-xs text-muted">
          Click any ad to scan it. Opus 4.6 analyses the creative, reviews your brand guidelines, and writes a long-format prompt.
        </p>
        {activeBrand && (
          <p className="text-xs" style={{ marginTop: 'var(--space-xs)', color: 'var(--accent)' }}>
            Brand: {activeBrand.name}
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p>Loading saved ads...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && ads.length === 0 && (
        <div className="empty-state">
          <h3>No ads saved yet</h3>
          <p>
            Save ads from the Facebook Ad Library using the Chrome extension.
            They'll appear here ready to scan.
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
              onClick={() => onSelectAd(ad.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function AdCard({ ad, onClick }) {
  const hasPrompt = !!ad.generated_prompt
  const date = ad.created_at
    ? new Date(ad.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="ad-card-image">
        {ad.image_url ? (
          <img
            src={ad.image_url}
            alt={ad.advertiser_name || 'Ad'}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.parentElement.classList.add('img-expired') }}
          />
        ) : (
          <div className="panel-placeholder">
            <p>No image</p>
          </div>
        )}
        {hasPrompt ? (
          <span className="ad-card-badge has-prompt">scanned</span>
        ) : (
          <span className="ad-card-badge pending">ready to scan</span>
        )}
      </div>
      <div className="ad-card-body">
        <div className="ad-card-name">{ad.advertiser_name || 'Unknown brand'}</div>
        <div className="ad-card-meta">
          {date}
          {ad.platform && ` · ${ad.platform}`}
        </div>
      </div>
    </div>
  )
}
