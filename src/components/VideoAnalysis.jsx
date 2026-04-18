import React, { useState, useEffect } from 'react'
import './VideoAnalysis.css'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import { generateShareableHTML } from '../lib/shareableExport'
import { generateBriefHTML } from '../lib/briefExport'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// Helper: detect meaningless/empty values from AI analysis
function isEmptyValue(val) {
  if (val === null || val === undefined) return true
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase()
    return trimmed === '' || trimmed === 'unknown' || trimmed === '—' || trimmed === '-' || trimmed === 'n/a' || trimmed === 'none'
  }
  if (Array.isArray(val)) return val.length === 0
  return false
}

// Helper: check if an array has any meaningful (non-empty) items
function filterMeaningful(arr) {
  if (!Array.isArray(arr)) return []
  return arr.filter(item => {
    if (typeof item === 'string') return !isEmptyValue(item)
    if (typeof item === 'object' && item !== null) {
      return Object.values(item).some(v => !isEmptyValue(v))
    }
    return true
  })
}

// Helper: format layout summary into readable string
function formatLayoutSummary(layoutSummary) {
  if (!layoutSummary) return null
  const parts = []
  if (layoutSummary.full) parts.push(`${layoutSummary.full} Full`)
  if (layoutSummary['split-2']) parts.push(`${layoutSummary['split-2']} Split`)
  if (layoutSummary['split-3']) parts.push(`${layoutSummary['split-3']} Tri`)
  if (layoutSummary.other) parts.push(`${layoutSummary.other} Other`)
  return parts.length > 0 ? parts.join(' / ') : null
}

// Helper: format cuts per second as "cut every Xs"
function formatCutInterval(cutsPerSecond) {
  if (!cutsPerSecond || cutsPerSecond <= 0) return '—'
  const interval = 1 / cutsPerSecond
  return `${interval.toFixed(1)}s`
}

export default function VideoAnalysis() {
  const [view, setView] = useState('list') // 'list' or 'detail'
  const [analyses, setAnalyses] = useState([])
  const [selectedAnalysis, setSelectedAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showAnalyzeForm, setShowAnalyzeForm] = useState(false)
  const [analyzingAdId, setAnalyzingAdId] = useState('')
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [detailTab, setDetailTab] = useState('script') // 'script', 'analysis', 'shots'
  const [deletingId, setDeletingId] = useState(null)
  const [sourceFilter, setSourceFilter] = useState('all') // 'all' | 'competitor_ad' | 'organic_post'

  // Fetch all analyses
  useEffect(() => {
    fetchAnalyses()
  }, [])

  const fetchAnalyses = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/video_analyses?select=*&order=created_at.desc`,
        { headers: fnHeaders }
      )
      if (!response.ok) throw new Error('Failed to fetch analyses')
      const data = await response.json()

      // Fetch first-shot frame_url for each analysis (used as card thumbnail).
      // Contact sheets look bad at 16/9 because they are 4-col portrait grids padded with black.
      let firstFrameByAnalysisId = new Map()
      try {
        const ids = data.map((a) => a.id).filter(Boolean)
        if (ids.length > 0) {
          const idList = ids.map((id) => `"${id}"`).join(',')
          const shotsRes = await fetch(
            `${supabaseUrl}/rest/v1/video_shots?shot_number=eq.1&video_analysis_id=in.(${idList})&select=video_analysis_id,frame_url`,
            { headers: fnHeaders }
          )
          if (shotsRes.ok) {
            const shots = await shotsRes.json()
            shots.forEach((s) => {
              if (s.video_analysis_id && s.frame_url) {
                firstFrameByAnalysisId.set(s.video_analysis_id, s.frame_url)
              }
            })
          }
        }
      } catch (e) {
        console.warn('First-frame fetch failed, falling back to contact sheet:', e)
      }

      // Enrich with source-specific metadata
      const enriched = await Promise.all(
        data.map(async (analysis) => {
          const hookType = analysis.ai_analysis?.hook_type || analysis.ai_analysis?.hook_framework
          const hookLabel = hookType ? ` — ${hookType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}` : ''
          try {
            if (analysis.source === 'organic_post' && analysis.source_id) {
              const postRes = await fetch(
                `${supabaseUrl}/rest/v1/organic_posts?id=eq.${analysis.source_id}&select=id,platform,post_url,thumbnail_url,title,caption,post_type,account_id`,
                { headers: fnHeaders }
              )
              const posts = await postRes.json()
              const post = posts[0] || null
              let handle = null
              let brandName = null
              if (post?.account_id) {
                const accRes = await fetch(
                  `${supabaseUrl}/rest/v1/followed_organic_accounts?id=eq.${post.account_id}&select=brand_name,handle,platform`,
                  { headers: fnHeaders }
                )
                const accs = await accRes.json()
                handle = accs[0]?.handle || null
                brandName = accs[0]?.brand_name || null
              }
              const displayName = handle
                ? `@${handle}`
                : (brandName || post?.platform || 'Organic')
              return {
                ...analysis,
                brand_name: displayName + hookLabel,
                page_name: brandName || displayName,
                source_label: (post?.platform || 'organic').toString(),
                organic_post: post,
                first_frame_url: firstFrameByAnalysisId.get(analysis.id) || null,
              }
            }

            // Default: competitor_ad
            const lookupId = analysis.source_id || analysis.competitor_ad_id
            const adRes = await fetch(
              `${supabaseUrl}/rest/v1/competitor_ads?id=eq.${lookupId}&select=page_name,page_id`,
              { headers: fnHeaders }
            )
            const ads = await adRes.json()
            const pageName = ads[0]?.page_name || 'Unknown'
            return {
              ...analysis,
              brand_name: pageName + hookLabel,
              page_name: pageName,
              source_label: 'ad',
              first_frame_url: firstFrameByAnalysisId.get(analysis.id) || null,
            }
          } catch (e) {
            return {
              ...analysis,
              brand_name: 'Unknown',
              page_name: '',
              source_label: analysis.source === 'organic_post' ? 'organic' : 'ad',
              first_frame_url: firstFrameByAnalysisId.get(analysis.id) || null,
            }
          }
        })
      )

      setAnalyses(enriched)
    } catch (e) {
      setError(e.message)
      console.error('Fetch error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeSubmit = async (e) => {
    e.preventDefault()
    if (!analyzingAdId.trim()) {
      setAnalyzeError('Please enter a competitor ad ID')
      return
    }

    setAnalyzeLoading(true)
    setAnalyzeError(null)

    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/analyse-video`,
        {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify({ competitor_ad_id: analyzingAdId }),
        }
      )

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || 'Failed to start analysis')
      }

      const result = await response.json()
      setShowAnalyzeForm(false)
      setAnalyzingAdId('')

      // Refresh list
      setTimeout(fetchAnalyses, 1000)
    } catch (e) {
      setAnalyzeError(e.message)
      console.error('Analyze error:', e)
    } finally {
      setAnalyzeLoading(false)
    }
  }

  const handleDeleteAnalysis = async (analysisId) => {
    if (!window.confirm('Delete this video analysis? This cannot be undone.')) return
    setDeletingId(analysisId)
    try {
      // Delete related video_shots first
      await fetch(
        `${supabaseUrl}/rest/v1/video_shots?video_analysis_id=eq.${analysisId}`,
        { method: 'DELETE', headers: fnHeaders }
      )
      // Delete the analysis itself
      const res = await fetch(
        `${supabaseUrl}/rest/v1/video_analyses?id=eq.${analysisId}`,
        { method: 'DELETE', headers: fnHeaders }
      )
      if (!res.ok) throw new Error('Failed to delete analysis')
      // Remove from local state
      setAnalyses(prev => prev.filter(a => a.id !== analysisId))
      // If we were viewing the deleted one, go back to list
      if (selectedAnalysis?.id === analysisId) {
        setView('list')
        setSelectedAnalysis(null)
      }
    } catch (e) {
      console.error('Delete error:', e)
      alert('Failed to delete analysis: ' + e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const openDetail = (analysis) => {
    setSelectedAnalysis(analysis)
    setDetailTab('script')
    setView('detail')
  }

  const closeDetail = () => {
    setView('list')
    setSelectedAnalysis(null)
  }

  return (
    <div className="va-container">
      {/* Header with action button */}
      <div className="va-header">
        <div>
          <h1 className="va-title">Video Analysis</h1>
          <p className="va-subtitle">Review AI-generated insights from competitor video ads</p>
        </div>
        <button
          className="va-btn va-btn-primary"
          onClick={() => setShowAnalyzeForm(!showAnalyzeForm)}
        >
          {showAnalyzeForm ? 'Cancel' : '+ Analyse New Video'}
        </button>
      </div>

      {/* Analyze form (expanded) */}
      {showAnalyzeForm && (
        <div className="va-analyze-form">
          <h2>Start New Analysis</h2>
          <form onSubmit={handleAnalyzeSubmit}>
            <div className="va-form-group">
              <label htmlFor="ad-id">Competitor Ad ID</label>
              <input
                id="ad-id"
                type="text"
                placeholder="e.g., 3324195914449903"
                value={analyzingAdId}
                onChange={(e) => setAnalyzingAdId(e.target.value)}
                className="va-input"
              />
              <p className="va-hint">Paste the ID of a video ad from the competitor ads list</p>
            </div>
            {analyzeError && <div className="va-error-banner">{analyzeError}</div>}
            <div className="va-form-actions">
              <button type="submit" className="va-btn va-btn-primary" disabled={analyzeLoading}>
                {analyzeLoading ? 'Analysing...' : 'Start Analysis'}
              </button>
              <button
                type="button"
                className="va-btn va-btn-secondary"
                onClick={() => setShowAnalyzeForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Source filter */}
      {view === 'list' && (
        <div className="va-filter-bar">
          {[
            { key: 'all', label: 'All' },
            { key: 'competitor_ad', label: 'Ads' },
            { key: 'organic_post', label: 'Organic' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`va-filter-btn${sourceFilter === opt.key ? ' active' : ''}`}
              onClick={() => setSourceFilter(opt.key)}
            >
              {opt.label}
              <span className="va-filter-count">
                {opt.key === 'all'
                  ? analyses.length
                  : analyses.filter((a) => a.source === opt.key).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main content area */}
      {view === 'list' ? (
        <ListViewContent
          analyses={sourceFilter === 'all' ? analyses : analyses.filter((a) => a.source === sourceFilter)}
          loading={loading}
          error={error}
          onSelect={openDetail}
          onRetry={fetchAnalyses}
          onDelete={handleDeleteAnalysis}
          deletingId={deletingId}
        />
      ) : (
        <DetailViewContent
          analysis={selectedAnalysis}
          detailTab={detailTab}
          onTabChange={setDetailTab}
          onClose={closeDetail}
          onDelete={handleDeleteAnalysis}
          deletingId={deletingId}
        />
      )}
    </div>
  )
}

function ListViewContent({ analyses, loading, error, onSelect, onRetry, onDelete, deletingId }) {
  if (loading) {
    return (
      <div className="va-empty-state">
        <div className="va-spinner"></div>
        <p>Loading analyses...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="va-empty-state">
        <div className="va-error-icon">⚠</div>
        <p>{error}</p>
        <button className="va-btn va-btn-secondary" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (analyses.length === 0) {
    return (
      <div className="va-empty-state">
        <div className="va-empty-icon">📹</div>
        <h2>No analyses yet</h2>
        <p>Start by analyzing a video ad to see insights here</p>
      </div>
    )
  }

  return (
    <div className="va-grid">
      {analyses.map((analysis) => (
        <AnalysisCard
          key={analysis.id}
          analysis={analysis}
          onClick={() => onSelect(analysis)}
          onDelete={onDelete}
          isDeleting={deletingId === analysis.id}
        />
      ))}
    </div>
  )
}

function AnalysisCard({ analysis, onClick, onDelete, isDeleting }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return '#34d399'
      case 'processing':
        return '#fbbf24'
      case 'error':
        return '#f43f5e'
      default:
        return '#71717a'
    }
  }

  return (
    <div className="va-card" onClick={onClick}>
      <div className="va-card-image">
        {(analysis.first_frame_url || analysis.contact_sheet_url) ? (
          <img
            src={analysis.first_frame_url || analysis.contact_sheet_url}
            alt="First-frame thumbnail"
            onError={(e) => {
              e.target.style.display = 'none'
              e.target.nextElementSibling.style.display = 'flex'
            }}
          />
        ) : null}
        <div className="va-card-placeholder" style={{ display: (analysis.first_frame_url || analysis.contact_sheet_url) ? 'none' : 'flex' }}>
          📹
        </div>
      </div>

      <div className="va-card-content">
        <div className="va-card-header">
          <h3 className="va-card-title">{analysis.brand_name}</h3>
          <div
            className="va-status-badge"
            style={{ borderColor: getStatusColor(analysis.status) }}
          >
            <span style={{ color: getStatusColor(analysis.status) }}>●</span>
            {analysis.status}
          </div>
        </div>
        {analysis.source === 'organic_post' && (
          <div className="va-source-chip va-source-organic">
            {analysis.source_label || 'Organic'}
          </div>
        )}
        {analysis.source === 'competitor_ad' && (
          <div className="va-source-chip va-source-ad">
            Ad
          </div>
        )}

        <div className="va-card-meta">
          {analysis.duration_seconds && (
            <span className="va-meta-item">
              ⏱ {analysis.duration_seconds.toFixed(1)}s
            </span>
          )}
          {analysis.total_shots && (
            <span className="va-meta-item">
              🎬 {analysis.total_shots} shots
            </span>
          )}
          {analysis.cuts_per_second && (
            <span className="va-meta-item">
              ✂ cut every {formatCutInterval(analysis.cuts_per_second)}
            </span>
          )}
          {analysis.layout_summary && (analysis.layout_summary['split-2'] > 0 || analysis.layout_summary['split-3'] > 0) && (
            <span className="va-meta-item">
              ⬒ {formatLayoutSummary(analysis.layout_summary)}
            </span>
          )}
        </div>

        {analysis.ai_analysis?.one_line_summary && (
          <p className="va-card-summary">{analysis.ai_analysis.one_line_summary}</p>
        )}

        <div className="va-card-actions">
          <button className="va-card-action">View Details →</button>
          <button
            className="va-card-delete"
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(analysis.id)
            }}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailViewContent({ analysis, detailTab, onTabChange, onClose, onDelete, deletingId }) {
  const [briefData, setBriefData] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState(null)
  const [briefShotCount, setBriefShotCount] = useState(5)
  const [briefVariations, setBriefVariations] = useState(3)
  const [shareLoading, setShareLoading] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)

  if (!analysis) return null

  const doExportReport = async (format) => {
    setShareLoading(true)
    setShowShareMenu(false)
    try {
      // Fetch shots for the report
      const response = await fetch(
        `${supabaseUrl}/rest/v1/video_shots?video_analysis_id=eq.${analysis.id}&select=*&order=shot_number.asc`,
        { headers: fnHeaders }
      )
      const shots = await response.json()
      // Pass brief data so the share report includes it
      const html = generateShareableHTML(analysis, shots, briefData || null)

      if (format === 'pdf') {
        const win = window.open('', '_blank')
        win.document.write(html)
        win.document.close()
        setTimeout(() => win.print(), 600)
      } else {
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `video-analysis-${analysis.brand_name || 'report'}-${new Date().toISOString().slice(0, 10)}.html`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Share error:', e)
    } finally {
      setShareLoading(false)
    }
  }

  const handleGenerateBrief = async () => {
    setBriefLoading(true)
    setBriefError(null)
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-ugc-brief`,
        {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify({
            analysis_id: analysis.id,
            shot_count: briefShotCount,
            brand_name: analysis.brand_name,
            variations_per_shot: briefVariations,
          }),
        }
      )
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to generate brief')
      }
      const data = await response.json()
      setBriefData(data.brief)
      onTabChange('brief')
    } catch (e) {
      setBriefError(e.message)
      console.error('Brief generation error:', e)
    } finally {
      setBriefLoading(false)
    }
  }

  return (
    <div className="va-detail-overlay">
      <div className="va-detail-panel">
        {/* Detail Header */}
        <div className="va-detail-header">
          <div className="va-detail-top">
            <button className="va-close-btn" onClick={onClose}>✕</button>
            <h2 className="va-detail-title">{analysis.brand_name}</h2>
            <button
              className="va-detail-delete-btn"
              disabled={deletingId === analysis.id}
              onClick={() => onDelete(analysis.id)}
            >
              {deletingId === analysis.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>

          {analysis.contact_sheet_url && (
            <div className="va-detail-hero">
              <img src={analysis.contact_sheet_url} alt="Contact sheet" />
            </div>
          )}

          <div className="va-detail-stats">
            <StatItem label="Duration" value={`${analysis.duration_seconds?.toFixed(1) || '—'}s`} />
            <StatItem label="Total Shots" value={analysis.total_shots || '—'} />
            <StatItem label="Avg Shot Length" value={`${analysis.avg_shot_duration?.toFixed(1) || '—'}s`} />
            <StatItem label="Cut Every" value={formatCutInterval(analysis.cuts_per_second)} />
            <StatItem label="Pacing" value={analysis.pacing_profile || '—'} />
            {analysis.layout_summary && (
              <StatItem label="Layout" value={formatLayoutSummary(analysis.layout_summary) || '—'} />
            )}
            <StatItem label="Status" value={analysis.status} />
          </div>

          {/* Action buttons */}
          <div className="va-detail-actions">
            <div className="va-share-wrapper">
              <button
                className="va-btn va-btn-secondary"
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={shareLoading}
              >
                {shareLoading ? 'Exporting...' : 'Share Report ▾'}
              </button>
              {showShareMenu && (
                <div className="va-share-menu">
                  <button className="va-share-menu-item" onClick={() => doExportReport('html')}>
                    ↓ Download HTML
                  </button>
                  <button className="va-share-menu-item" onClick={() => doExportReport('pdf')}>
                    ↓ Save as PDF
                  </button>
                </div>
              )}
            </div>
            <div className="va-brief-controls">
              <select
                className="va-select"
                value={briefShotCount}
                onChange={(e) => setBriefShotCount(Number(e.target.value))}
                disabled={briefLoading}
              >
                <option value={5}>5 Shots</option>
                <option value={10}>10 Shots</option>
              </select>
              <select
                className="va-select"
                value={briefVariations}
                onChange={(e) => setBriefVariations(Number(e.target.value))}
                disabled={briefLoading}
              >
                <option value={2}>2 Variations</option>
                <option value={3}>3 Variations</option>
                <option value={4}>4 Variations</option>
              </select>
              <button
                className="va-btn va-btn-primary"
                onClick={handleGenerateBrief}
                disabled={briefLoading}
              >
                {briefLoading ? 'Generating...' : 'Generate Chefly Brief'}
              </button>
            </div>
          </div>

          {/* Loading banner - visible when generating brief */}
          {briefLoading && (
            <div className="va-loading-banner">
              <div className="va-spinner-sm"></div>
              <div className="va-loading-banner-text">
                <span className="va-loading-banner-title">Generating Chefly UGC Brief...</span>
                <span className="va-loading-banner-sub">AI is crafting a {briefShotCount}-shot brief with {briefVariations} variations per shot. This usually takes 10-15 seconds.</span>
              </div>
            </div>
          )}

          {briefError && <div className="va-error-banner" style={{marginTop:'1rem'}}>{briefError}</div>}
        </div>

        {/* Tabs */}
        <div className="va-tabs">
          <button
            className={`va-tab ${detailTab === 'script' ? 'active' : ''}`}
            onClick={() => onTabChange('script')}
          >
            Script
          </button>
          <button
            className={`va-tab ${detailTab === 'analysis' ? 'active' : ''}`}
            onClick={() => onTabChange('analysis')}
          >
            AI Analysis
          </button>
          <button
            className={`va-tab ${detailTab === 'shots' ? 'active' : ''}`}
            onClick={() => onTabChange('shots')}
          >
            Shots
          </button>
          {briefData && (
            <button
              className={`va-tab ${detailTab === 'brief' ? 'active' : ''}`}
              onClick={() => onTabChange('brief')}
            >
              Chefly Brief
            </button>
          )}
        </div>

        {/* Tab Content */}
        <div className="va-tab-content">
          {detailTab === 'script' && <ScriptTab analysis={analysis} />}
          {detailTab === 'analysis' && <AnalysisTab analysis={analysis} />}
          {detailTab === 'shots' && <ShotsTab analysis={analysis} />}
          {detailTab === 'brief' && briefData && <BriefTab brief={briefData} brandName={analysis.brand_name} contactSheetUrl={analysis.contact_sheet_url} />}
        </div>
      </div>
    </div>
  )
}

function StatItem({ label, value }) {
  return (
    <div className="va-stat">
      <span className="va-stat-label">{label}</span>
      <span className="va-stat-value">{value}</span>
    </div>
  )
}

function ScriptTab({ analysis }) {
  if (!analysis.combined_script) {
    return <div className="va-tab-empty">No script data available</div>
  }

  const lines = (analysis.combined_script || '').split('\n').filter((l) => l.trim())

  return (
    <div className="va-script">
      {lines.map((line, idx) => {
        const isVoiceover = line.includes('VOICEOVER:')
        const isVisual = line.includes('VISUAL:') || line.includes('TEXT ON SCREEN:')

        return (
          <div
            key={idx}
            className={`va-script-line ${isVoiceover ? 'voiceover' : ''} ${isVisual ? 'visual' : ''}`}
          >
            {line}
          </div>
        )
      })}
    </div>
  )
}

function AnalysisTab({ analysis }) {
  const ai = analysis.ai_analysis || {}

  // Pre-check which sections have meaningful content
  const hasHook = ai.hook && (!isEmptyValue(ai.hook.type) || !isEmptyValue(ai.hook.text) || ai.hook.effectiveness_score)

  const narrativeBeats = filterMeaningful(ai.narrative_arc?.beats || [])
  const hasNarrativeArc = ai.narrative_arc && (!isEmptyValue(ai.narrative_arc.structure) || narrativeBeats.length > 0)

  const hasCta = ai.cta && (!isEmptyValue(ai.cta.type) || !isEmptyValue(ai.cta.text) || !isEmptyValue(ai.cta.placement))

  const sellingPoints = filterMeaningful(ai.selling_points || [])
  const hasSellingPoints = sellingPoints.length > 0

  const emotionalDrivers = filterMeaningful(ai.emotional_drivers || [])
  const hasEmotionalDrivers = emotionalDrivers.length > 0

  const hasTargetAudience = ai.target_audience && (
    !isEmptyValue(ai.target_audience.description) ||
    !isEmptyValue(ai.target_audience.primary) ||
    filterMeaningful(ai.target_audience.signals || []).length > 0
  )

  // v3 (Apr 2026): accept either the new format_label (e.g. "UGC + Talking Head")
  // or the legacy `format` enum. format_rationale is optional v3-only prose.
  // See docs/mixed-format-migration-2026-04-18.md.
  const productionStyleItems = ai.production_style ?
    ['format_label', 'format', 'quality', 'overlays', 'text_overlays', 'music', 'music_pacing', 'format_rationale'].filter(k => !isEmptyValue(ai.production_style[k])) : []
  const hasProductionStyle = productionStyleItems.length > 0

  const hasCompetitorInsights = ai.competitor_insights && (
    !isEmptyValue(ai.competitor_insights.what_works) ||
    !isEmptyValue(ai.competitor_insights.what_to_steal) ||
    !isEmptyValue(ai.competitor_insights.weaknesses)
  )

  const hasAnything = hasHook || hasNarrativeArc || hasCta || hasSellingPoints || hasEmotionalDrivers || hasTargetAudience || hasProductionStyle || hasCompetitorInsights

  if (!hasAnything) {
    return <div className="va-tab-empty">No AI analysis data available</div>
  }

  return (
    <div className="va-analysis">
      {/* Hook */}
      {hasHook && (
        <Section title="Hook">
          <div className="va-badge-row">
            {!isEmptyValue(ai.hook.type) && <Badge color="indigo">{ai.hook.type}</Badge>}
            {ai.hook.effectiveness_score && (
              <div className="va-score-bar">
                <span className="va-score-label">Effectiveness</span>
                <div className="va-bar-bg">
                  <div
                    className="va-bar-fill"
                    style={{ width: `${Math.min(ai.hook.effectiveness_score * 10, 100)}%` }}
                  ></div>
                </div>
                <span className="va-score-value">{ai.hook.effectiveness_score.toFixed(1)}/10</span>
              </div>
            )}
          </div>
          {!isEmptyValue(ai.hook.text) && <p className="va-section-text">{ai.hook.text}</p>}
        </Section>
      )}

      {/* Narrative Arc */}
      {hasNarrativeArc && (
        <Section title="Narrative Arc">
          {!isEmptyValue(ai.narrative_arc.structure) && (
            <Badge color="purple">{ai.narrative_arc.structure}</Badge>
          )}
          {narrativeBeats.length > 0 && (
            <ol className="va-beats">
              {narrativeBeats.map((beat, idx) => (
                <li key={idx}>{typeof beat === 'string' ? beat : (beat.description || beat.phase || beat.name || JSON.stringify(beat))}</li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {/* CTA */}
      {hasCta && (
        <Section title="Call-to-Action">
          <div className="va-badge-row">
            {!isEmptyValue(ai.cta.type) && <Badge color="indigo">{ai.cta.type}</Badge>}
            {!isEmptyValue(ai.cta.placement) && <Badge color="slate">{ai.cta.placement}</Badge>}
          </div>
          {!isEmptyValue(ai.cta.text) && <p className="va-section-text">{ai.cta.text}</p>}
        </Section>
      )}

      {/* Selling Points */}
      {hasSellingPoints && (
        <Section title="Selling Points">
          <div className="va-pills">
            {sellingPoints.map((point, idx) => (
              <span key={idx} className="va-pill">{point}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Emotional Drivers */}
      {hasEmotionalDrivers && (
        <Section title="Emotional Drivers">
          <div className="va-emotion-pills">
            {emotionalDrivers.map((driver, idx) => (
              <span key={idx} className="va-emotion-pill">{driver}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Target Audience */}
      {hasTargetAudience && (
        <Section title="Target Audience">
          {!isEmptyValue(ai.target_audience.description) && (
            <p className="va-section-text">{ai.target_audience.description}</p>
          )}
          {!isEmptyValue(ai.target_audience.primary) && (
            <p className="va-section-text">{ai.target_audience.primary}</p>
          )}
          {filterMeaningful(ai.target_audience.signals || []).length > 0 && (
            <div className="va-pills">
              {filterMeaningful(ai.target_audience.signals).map((signal, idx) => (
                <span key={idx} className="va-pill">{signal}</span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Production Style */}
      {hasProductionStyle && (
        <Section title="Production Style">
          <div className="va-style-grid">
            {(() => {
              // v3: prefer format_label (e.g. "UGC + Talking Head") with fallback to legacy format enum.
              const formatValue = ai.production_style.format_label || ai.production_style.format
              return !isEmptyValue(formatValue) ? (
                <StyleItem label="Format" value={formatValue} />
              ) : null
            })()}
            {!isEmptyValue(ai.production_style.quality) && (
              <StyleItem label="Quality" value={ai.production_style.quality} />
            )}
            {!isEmptyValue(ai.production_style.text_overlays || ai.production_style.overlays) && (
              <StyleItem label="Overlays" value={ai.production_style.text_overlays || ai.production_style.overlays} />
            )}
            {!isEmptyValue(ai.production_style.music_pacing || ai.production_style.music) && (
              <StyleItem label="Music" value={ai.production_style.music_pacing || ai.production_style.music} />
            )}
          </div>
          {!isEmptyValue(ai.production_style.format_rationale) && (
            <p className="va-section-text" style={{ marginTop: '0.75rem', fontStyle: 'italic', opacity: 0.85 }}>
              {ai.production_style.format_rationale}
            </p>
          )}
        </Section>
      )}

      {/* Competitor Insights */}
      {hasCompetitorInsights && (
        <Section title="Competitor Insights">
          {!isEmptyValue(ai.competitor_insights.what_works) && (
            <InsightCard border="green" title="What Works" text={ai.competitor_insights.what_works} />
          )}
          {!isEmptyValue(ai.competitor_insights.what_to_steal) && (
            <InsightCard border="blue" title="What to Steal" text={ai.competitor_insights.what_to_steal} />
          )}
          {!isEmptyValue(ai.competitor_insights.weaknesses) && (
            <InsightCard border="red" title="Weaknesses" text={ai.competitor_insights.weaknesses} />
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="va-section">
      <h3 className="va-section-title">{title}</h3>
      <div className="va-section-body">{children}</div>
    </div>
  )
}

function Badge({ color, children }) {
  const colors = {
    indigo: '#6366f1',
    purple: '#a855f7',
    slate: '#71717a',
  }
  return (
    <span className="va-badge" style={{ backgroundColor: `${colors[color] || colors.indigo}20`, borderColor: colors[color] || colors.indigo }}>
      {children}
    </span>
  )
}

function StyleItem({ label, value }) {
  return (
    <div className="va-style-item">
      <span className="va-style-label">{label}</span>
      <span className="va-style-value">{value}</span>
    </div>
  )
}

function InsightCard({ border, title, text }) {
  const borderColors = {
    green: '#34d399',
    blue: '#3b82f6',
    red: '#f43f5e',
  }
  return (
    <div className="va-insight-card" style={{ borderLeftColor: borderColors[border] }}>
      <h4 className="va-insight-title">{title}</h4>
      <p className="va-insight-text">{text}</p>
    </div>
  )
}

function ShotsTab({ analysis }) {
  const [shots, setShots] = useState([])
  const [shotsLoading, setShotsLoading] = useState(true)

  useEffect(() => {
    fetchShots()
  }, [analysis.id])

  const fetchShots = async () => {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/video_shots?video_analysis_id=eq.${analysis.id}&select=*&order=shot_number.asc`,
        { headers: fnHeaders }
      )
      if (!response.ok) throw new Error('Failed to fetch shots')
      const data = await response.json()
      setShots(data)
    } catch (e) {
      console.error('Fetch shots error:', e)
    } finally {
      setShotsLoading(false)
    }
  }

  if (shotsLoading) {
    return <div className="va-tab-empty">Loading shots...</div>
  }

  if (shots.length === 0) {
    return <div className="va-tab-empty">No shots available</div>
  }

  return (
    <div className="va-shots-grid">
      {shots.map((shot) => (
        <div key={shot.id} className="va-shot-card">
          {shot.frame_url && (
            <img src={shot.frame_url} alt={`Shot ${shot.shot_number}`} className="va-shot-image" />
          )}
          <div className="va-shot-info">
            <div className="va-shot-number">
              Shot {shot.shot_number}
              {shot.screen_layout && shot.screen_layout !== 'full' && (
                <span className="va-shot-layout-badge">{shot.screen_layout === 'split-2' ? '⬒ Split' : shot.screen_layout === 'split-3' ? '⬒ Tri' : shot.screen_layout}</span>
              )}
            </div>
            {shot.duration && (
              <div className="va-shot-duration">{shot.duration.toFixed(2)}s</div>
            )}
            {shot.ocr_text && (
              <p className="va-shot-ocr">{shot.ocr_text}</p>
            )}
            {shot.description && (
              <p className="va-shot-desc">{shot.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function BriefTab({ brief, brandName, contactSheetUrl }) {
  if (!brief) return <div className="va-tab-empty">No brief generated yet</div>

  const handleExportHTML = () => {
    const html = generateBriefHTML(brief, brandName, contactSheetUrl)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chefly-ugc-brief-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPDF = () => {
    const html = generateBriefHTML(brief, brandName, contactSheetUrl)
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    // Give it a moment to render, then trigger print
    setTimeout(() => win.print(), 500)
  }

  return (
    <div className="va-analysis">
      {/* Export bar */}
      <div className="va-brief-export-bar">
        <button className="va-btn va-btn-ghost" onClick={handleExportHTML}>
          ↓ Download HTML
        </button>
        <button className="va-btn va-btn-ghost" onClick={handleExportPDF}>
          ↓ Save as PDF
        </button>
      </div>

      {/* Concept */}
      <Section title="Creative Concept">
        <p className="va-section-text" style={{fontSize:'1.1rem',fontWeight:600,color:'#fff'}}>{brief.concept}</p>
        {brief.inspired_by && (
          <p className="va-section-text" style={{fontStyle:'italic'}}>Inspired by: {brief.inspired_by}</p>
        )}
      </Section>

      {/* Overview */}
      <Section title="Production Overview">
        <div className="va-style-grid">
          {brief.target_duration && <StyleItem label="Duration" value={brief.target_duration} />}
          {brief.tone && <StyleItem label="Tone" value={brief.tone} />}
          {brief.music_direction && <StyleItem label="Music" value={brief.music_direction} />}
          {brief.pacing_notes && <StyleItem label="Pacing" value={brief.pacing_notes} />}
        </div>
      </Section>

      {/* Production Tips */}
      {brief.production_tips && brief.production_tips.length > 0 && (
        <Section title="Production Tips">
          <div className="va-brief-tips">
            {brief.production_tips.map((tip, idx) => (
              <div key={idx} className="va-brief-tip">{tip}</div>
            ))}
          </div>
        </Section>
      )}

      {/* Shot List */}
      <Section title={`Shot List (${brief.shots?.length || 0} shots)`}>
        <div className="va-brief-shots">
          {(brief.shots || []).map((shot, idx) => (
            <div key={idx} className="va-brief-shot">
              <div className="va-brief-shot-header">
                <span className="va-brief-shot-number">Shot {shot.shot_number}</span>
                <span className="va-brief-shot-duration">{shot.duration_estimate}</span>
              </div>
              <div className="va-brief-shot-body">
                <div className="va-brief-shot-row">
                  <span className="va-brief-shot-label">Framing</span>
                  <span className="va-brief-shot-value">{shot.framing}</span>
                </div>
                <div className="va-brief-shot-row">
                  <span className="va-brief-shot-label">Action</span>
                  <span className="va-brief-shot-value">{shot.action}</span>
                </div>
                <div className="va-brief-shot-row">
                  <span className="va-brief-shot-label">Script</span>
                  <span className="va-brief-shot-value va-brief-script-line">"{shot.script_line}"</span>
                </div>
                {shot.text_overlay && (
                  <div className="va-brief-shot-row">
                    <span className="va-brief-shot-label">Text Overlay</span>
                    <span className="va-brief-shot-value">{shot.text_overlay}</span>
                  </div>
                )}
                {shot.notes && (
                  <div className="va-brief-shot-row">
                    <span className="va-brief-shot-label">Notes</span>
                    <span className="va-brief-shot-value va-brief-note">{shot.notes}</span>
                  </div>
                )}

                {/* Variations */}
                {shot.variations && shot.variations.length > 0 && (
                  <div className="va-brief-variations">
                    <div className="va-brief-variations-title">Variations</div>
                    {shot.variations.map((v, vIdx) => (
                      <div key={vIdx} className="va-brief-variation">
                        <div className="va-brief-variation-label">Variation {v.label}</div>
                        {v.framing && (
                          <div className="va-brief-variation-row">
                            <span className="va-brief-shot-label">Framing</span>
                            <span className="va-brief-shot-value">{v.framing}</span>
                          </div>
                        )}
                        {v.action && (
                          <div className="va-brief-variation-row">
                            <span className="va-brief-shot-label">Action</span>
                            <span className="va-brief-shot-value">{v.action}</span>
                          </div>
                        )}
                        {v.notes && (
                          <div className="va-brief-variation-row">
                            <span className="va-brief-shot-label">Notes</span>
                            <span className="va-brief-shot-value va-brief-note">{v.notes}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
