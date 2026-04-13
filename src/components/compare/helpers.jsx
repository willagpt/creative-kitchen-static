import React, { useState } from 'react'

export function ExpandableText({ text, maxLen = 120 }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  if (text.length <= maxLen) return <div style={{ fontSize: '12px', color: '#a1a1a1', lineHeight: '1.5' }}>{text}</div>
  return (
    <div style={{ fontSize: '12px', color: '#a1a1a1', lineHeight: '1.5' }}>
      {expanded ? text : text.substring(0, maxLen) + '...'}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        style={{
          background: 'none', border: 'none', color: '#f97316', fontSize: '11px',
          cursor: 'pointer', padding: '0 4px', marginLeft: '4px'
        }}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </div>
  )
}

export function ThumbnailStrip({ adIndices, allImages, max = 4 }) {
  if (!adIndices || !allImages || allImages.length === 0) return null

  const matches = adIndices
    .map(idx => allImages.find(img => img.ad_index === idx))
    .filter(img => img && img.image_url)
    .sort((a, b) => (b.days_active || 0) - (a.days_active || 0))
    .slice(0, max)

  if (matches.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
      {matches.map((img, i) => (
        <div key={i} style={{ position: 'relative' }}>
          <img
            src={img.image_url}
            alt={img.headline || `Ad ${img.ad_index}`}
            style={{
              width: '72px', height: '72px', objectFit: 'cover',
              borderRadius: '4px', border: '1px solid #333'
            }}
            onError={(e) => { e.target.style.display = 'none' }}
          />
          <div style={{
            position: 'absolute', bottom: '2px', right: '2px',
            backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '2px',
            padding: '1px 4px', fontSize: '9px', color: '#f97316'
          }}>
            {img.days_active}d
          </div>
        </div>
      ))}
    </div>
  )
}
