// BulkAnalyse.jsx — v1.0.0 (17 Apr 2026)
// Modal for bulk-analysing the top X% (or top N) of a universe of videos.
// Uses list-analyse-candidates for preview, analyse-video for execution.
// Sequential analysis with per-item progress (client-side, single concurrency).

import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './BulkAnalyse.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

const PCT_PRESETS = ['2.5', '5', '10', '20']

// rank_by options per source
const RANK_OPTIONS = {
  organic_post: [
    { value: 'views', label: 'Views' },
    { value: 'engagement_rate', label: 'Engagement rate' },
    { value: 'likes', label: 'Likes' },
    { value: 'comments', label: 'Comments' },
    { value: 'shares', label: 'Shares' },
  ],
  competitor_ad: [
    { value: 'days_active', label: 'Days active (longevity)' },
    { value: 'is_active_days', label: 'Days active × still running' },
  ],
}

export default function BulkAnalyse({ onClose, defaultSource = 'competitor_ad' }) {
  const [source, setSource] = useState(defaultSource)
  const [topPct, setTopPct] = useState('10')
  const [rankBy, setRankBy] = useState(defaultSource === 'competitor_ad' ? 'days_active' : 'views')
  const [activeOnly, setActiveOnly] = useState(true)
  const [excludeAlreadyAnalysed, setExcludeAlreadyAnalysed] = useState(true)

  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState([]) // [{source_id, label, status: 'queued'|'running'|'done'|'error', error?}]
  const [currentIndex, setCurrentIndex] = useState(0)
  const [cancelRequested, setCancelRequested] = useState(false)

  // Reset rank_by when source flips
  useEffect(() => {
    const opts = RANK_OPTIONS[source] || []
    if (!opts.find((o) => o.value === rankBy)) {
      setRankBy(opts[0]?.value || 'views')
    }
    if (source !== 'competitor_ad' && activeOnly) {
      setActiveOnly(false)
    }
  }, [source])

  // Debounced preview fetch
  useEffect(() => {
    if (running) return // don't refetch while analysing
    const t = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const body = {
          source,
          top_pct: Number(topPct),
          rank_by: rankBy,
          exclude_already_analysed: excludeAlreadyAnalysed,
          filter: {},
        }
        if (source === 'competitor_ad' && activeOnly) body.filter.active_only = true
        const res = await fetch(`${supabaseUrl}/functions/v1/list-analyse-candidates`, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify(body),
        })
        const payload = await res.json()
        if (!res.ok || !payload.success) {
          throw new Error(payload.error || `HTTP ${res.status}`)
        }
        setPreview(payload)
      } catch (err) {
        setPreviewError(err.message || 'Preview failed')
        setPreview(null)
      } finally {
        setPreviewLoading(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [source, topPct, rankBy, activeOnly, excludeAlreadyAnalysed, running])

  const toAnalyse = useMemo(() => {
    if (!preview || !Array.isArray(preview.candidates)) return []
    return excludeAlreadyAnalysed
      ? preview.candidates.filter((c) => !c.already_analysed)
      : preview.candidates
  }, [preview, excludeAlreadyAnalysed])

  async function runBatch() {
    if (!toAnalyse.length) return
    const initial = toAnalyse.map((c) => ({
      source_id: c.source_id,
      label: c.label || c.source_id,
      thumbnail_url: c.thumbnail_url,
      status: 'queued',
    }))
    setQueue(initial)
    setCurrentIndex(0)
    setRunning(true)
    setCancelRequested(false)

    for (let i = 0; i < initial.length; i++) {
      if (cancelRequested) break
      setCurrentIndex(i)
      setQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status: 'running' } : item)))
      try {
        const payload = { source, source_id: initial[i].source_id }
        const res = await fetch(`${supabaseUrl}/functions/v1/analyse-video`, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok || !body.success) {
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        setQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status: 'done' } : item)))
      } catch (err) {
        setQueue((q) =>
          q.map((item, idx) =>
            idx === i ? { ...item, status: 'error', error: err.message || 'Failed' } : item,
          ),
        )
      }
      // gentle pacing to avoid bursting the Railway worker
      await new Promise((r) => setTimeout(r, 400))
    }
    setRunning(false)
  }

  function handleCancel() {
    if (running) {
      setCancelRequested(true)
    } else {
      onClose?.()
    }
  }

  const doneCount = queue.filter((q) => q.status === 'done').length
  const errorCount = queue.filter((q) => q.status === 'error').length
  const progress = queue.length ? Math.round(((doneCount + errorCount) / queue.length) * 100) : 0

  return (
    <div className="ba-backdrop" onClick={!running ? onClose : undefined}>
      <div className="ba-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ba-head">
          <div>
            <h2 className="ba-title">Bulk Analyse</h2>
            <div className="ba-subtitle">Analyse the top performers across competitor ads or organic posts</div>
          </div>
          <button className="ba-btn ba-btn-ghost" onClick={handleCancel}>
            {running ? 'Stop after current' : 'Close'}
          </button>
        </div>

        {!running && queue.length === 0 && (
          <>
            <div className="ba-row">
              <label className="ba-field">
                <span className="ba-label">Source</span>
                <select
                  className="ba-input"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="competitor_ad">Competitor ads</option>
                  <option value="organic_post">Organic posts</option>
                </select>
              </label>
              <label className="ba-field">
                <span className="ba-label">Rank by</span>
                <select
                  className="ba-input"
                  value={rankBy}
                  onChange={(e) => setRankBy(e.target.value)}
                >
                  {(RANK_OPTIONS[source] || []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {source === 'competitor_ad' && (
                <label className="ba-field ba-field-toggle">
                  <input
                    type="checkbox"
                    checked={activeOnly}
                    onChange={(e) => setActiveOnly(e.target.checked)}
                  />
                  <span className="ba-label">Active ads only</span>
                </label>
              )}
            </div>

            <div className="ba-row">
              <div className="ba-field">
                <span className="ba-label">Top %</span>
                <div className="ba-pct-row">
                  {PCT_PRESETS.map((v) => (
                    <button
                      type="button"
                      key={v}
                      className={`ba-pct-btn ${topPct === v ? 'ba-pct-active' : ''}`}
                      onClick={() => setTopPct(v)}
                    >{v}%</button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="0.5"
                    className="ba-input ba-pct-input"
                    value={topPct}
                    onChange={(e) => setTopPct(e.target.value)}
                  />
                </div>
              </div>
              <label className="ba-field ba-field-toggle">
                <input
                  type="checkbox"
                  checked={excludeAlreadyAnalysed}
                  onChange={(e) => setExcludeAlreadyAnalysed(e.target.checked)}
                />
                <span className="ba-label">Skip already-analysed</span>
              </label>
            </div>

            <div className="ba-preview">
              {previewLoading ? (
                <span className="ba-preview-neutral">Loading preview…</span>
              ) : previewError ? (
                <span className="ba-preview-bad">Preview failed: {previewError}</span>
              ) : !preview ? (
                <span className="ba-preview-neutral">Adjust filters to see preview</span>
              ) : (
                <div className="ba-preview-card">
                  <div className="ba-preview-headline">
                    <strong>{preview.to_analyse_count}</strong> video{preview.to_analyse_count === 1 ? '' : 's'} will be analysed
                    <span className="ba-preview-sub">
                      {' '}(top {topPct}% of {preview.universe_count} → {preview.slice_size}
                      {preview.candidates_count - preview.to_analyse_count > 0
                        ? `; ${preview.candidates_count - preview.to_analyse_count} already done`
                        : ''})
                    </span>
                  </div>
                  {toAnalyse.length > 0 && (
                    <div className="ba-preview-thumbs">
                      {toAnalyse.slice(0, 8).map((c) => (
                        <div key={c.source_id} className="ba-thumb" title={c.label}>
                          {c.thumbnail_url ? (
                            <img src={c.thumbnail_url} alt="" loading="lazy" />
                          ) : (
                            <div className="ba-thumb-placeholder">—</div>
                          )}
                          <div className="ba-thumb-metric">{formatMetric(c.metric_value, rankBy)}</div>
                        </div>
                      ))}
                      {toAnalyse.length > 8 && (
                        <div className="ba-thumb ba-thumb-more">
                          +{toAnalyse.length - 8}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ba-actions">
              <button
                className="ba-btn ba-btn-primary"
                disabled={!preview || toAnalyse.length === 0 || previewLoading}
                onClick={runBatch}
              >
                {toAnalyse.length === 0
                  ? 'No videos to queue'
                  : `Start analysis (${toAnalyse.length})`}
              </button>
              <span className="ba-hint">
                Runs one at a time. Closing this panel will stop the queue.
              </span>
            </div>
          </>
        )}

        {(running || queue.length > 0) && (
          <div className="ba-run">
            <div className="ba-progress-bar">
              <div className="ba-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="ba-progress-text">
              {doneCount} done · {errorCount} error{errorCount === 1 ? '' : 's'} · {queue.length - doneCount - errorCount} remaining
              {running && cancelRequested && <span className="ba-cancelling"> · stopping after current…</span>}
            </div>
            <div className="ba-queue">
              {queue.map((item, idx) => (
                <div key={item.source_id + idx} className={`ba-queue-item ba-status-${item.status}`}>
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" loading="lazy" />
                  ) : (
                    <div className="ba-thumb-placeholder">—</div>
                  )}
                  <div className="ba-queue-meta">
                    <div className="ba-queue-label">{item.label}</div>
                    <div className="ba-queue-status">
                      {item.status === 'queued' && 'Queued'}
                      {item.status === 'running' && 'Analysing…'}
                      {item.status === 'done' && 'Done'}
                      {item.status === 'error' && `Error: ${item.error}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {!running && (
              <div className="ba-actions">
                <button className="ba-btn ba-btn-primary" onClick={onClose}>
                  Close
                </button>
                <button
                  className="ba-btn ba-btn-ghost"
                  onClick={() => {
                    setQueue([])
                    setCurrentIndex(0)
                  }}
                >
                  Run again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function formatMetric(val, rankBy) {
  if (val === null || val === undefined) return '—'
  if (rankBy === 'engagement_rate') return `${(Number(val) * 100).toFixed(1)}%`
  if (rankBy === 'days_active' || rankBy === 'is_active_days') {
    const n = Number(val)
    return Number.isFinite(n) ? `${n.toFixed(n < 10 ? 1 : 0)}d` : '—'
  }
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}
