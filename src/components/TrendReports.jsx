import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './TrendReports.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// ---------- helpers ----------

function formatRelativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status) {
  if (!status) return 'tr-chip-neutral'
  if (status === 'complete') return 'tr-chip-success'
  if (status === 'running' || status === 'pending') return 'tr-chip-running'
  if (status === 'error') return 'tr-chip-error'
  return 'tr-chip-neutral'
}

function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`
}

// ---------- main component ----------

export default function TrendReports() {
  const [view, setView] = useState('list') // list | detail
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showGenerator, setShowGenerator] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState(null)

  // Generator form state
  const [title, setTitle] = useState('')
  const [filterSource, setFilterSource] = useState('organic_post')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterPacing, setFilterPacing] = useState('')
  const [filterSinceDays, setFilterSinceDays] = useState('30')
  const [filterMinDuration, setFilterMinDuration] = useState('')
  const [filterMaxDuration, setFilterMaxDuration] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterLimit, setFilterLimit] = useState('50')

  async function loadReports() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/list-trend-reports?limit=100`, {
        headers: fnHeaders,
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`)
      setReports(body.reports || [])
    } catch (err) {
      setError(err.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReports()
  }, [])

  // Poll running/pending reports
  useEffect(() => {
    const hasRunning = reports.some((r) => r.status === 'running' || r.status === 'pending')
    if (!hasRunning) return
    const interval = setInterval(loadReports, 8000)
    return () => clearInterval(interval)
  }, [reports])

  function openDetail(id) {
    setSelectedId(id)
    setView('detail')
  }

  function backToList() {
    setSelectedId(null)
    setView('list')
    loadReports()
  }

  async function handleGenerate(e) {
    e.preventDefault()
    setGenerating(true)
    setGenerateError(null)
    try {
      const filter = {}
      if (filterSource) filter.source = filterSource
      if (filterPlatform) filter.platform = filterPlatform
      if (filterPacing) filter.pacing_profile = filterPacing
      if (filterSinceDays) filter.since_days = Number(filterSinceDays)
      if (filterMinDuration) filter.min_duration = Number(filterMinDuration)
      if (filterMaxDuration) filter.max_duration = Number(filterMaxDuration)
      if (filterBrand) filter.brand_name = filterBrand
      if (filterLimit) filter.limit = Number(filterLimit)

      const body = {
        filter,
        ...(title.trim() ? { title: title.trim() } : {}),
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/synthesise-organic-trends`, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify(body),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || `HTTP ${res.status}`)
      }

      setShowGenerator(false)
      setTitle('')
      await loadReports()
      if (payload.report_id) {
        openDetail(payload.report_id)
      }
    } catch (err) {
      setGenerateError(err.message || 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  if (view === 'detail' && selectedId) {
    return <TrendReportDetail reportId={selectedId} onBack={backToList} />
  }

  return (
    <div className="tr-root">
      <div className="tr-header">
        <div>
          <h1 className="tr-title">Trend Reports</h1>
          <div className="tr-subtitle">Synthesised patterns across analysed videos</div>
        </div>
        <div className="tr-header-actions">
          <button
            className="tr-btn tr-btn-ghost"
            onClick={loadReports}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            className="tr-btn tr-btn-primary"
            onClick={() => setShowGenerator((v) => !v)}
          >
            {showGenerator ? 'Close' : 'Generate report'}
          </button>
        </div>
      </div>

      {showGenerator && (
        <form className="tr-generator" onSubmit={handleGenerate}>
          <div className="tr-gen-row">
            <label className="tr-gen-field tr-gen-wide">
              <span className="tr-gen-label">Title (optional)</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Organic food reels — April"
                className="tr-gen-input"
              />
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Source</span>
              <select
                className="tr-gen-input"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="">Any</option>
                <option value="organic_post">Organic posts</option>
                <option value="competitor_ad">Competitor ads</option>
              </select>
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Platform</span>
              <select
                className="tr-gen-input"
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
              >
                <option value="">Any</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
          </div>

          <div className="tr-gen-row">
            <label className="tr-gen-field">
              <span className="tr-gen-label">Pacing</span>
              <select
                className="tr-gen-input"
                value={filterPacing}
                onChange={(e) => setFilterPacing(e.target.value)}
              >
                <option value="">Any</option>
                <option value="rapid">Rapid</option>
                <option value="fast">Fast</option>
                <option value="moderate">Moderate</option>
                <option value="slow">Slow</option>
              </select>
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Since (days)</span>
              <input
                type="number"
                min="1"
                max="365"
                className="tr-gen-input"
                value={filterSinceDays}
                onChange={(e) => setFilterSinceDays(e.target.value)}
              />
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Min duration (s)</span>
              <input
                type="number"
                min="0"
                className="tr-gen-input"
                value={filterMinDuration}
                onChange={(e) => setFilterMinDuration(e.target.value)}
              />
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Max duration (s)</span>
              <input
                type="number"
                min="0"
                className="tr-gen-input"
                value={filterMaxDuration}
                onChange={(e) => setFilterMaxDuration(e.target.value)}
              />
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Brand / handle</span>
              <input
                type="text"
                placeholder="e.g. hellofresh"
                className="tr-gen-input"
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
              />
            </label>
            <label className="tr-gen-field">
              <span className="tr-gen-label">Limit</span>
              <input
                type="number"
                min="3"
                max="200"
                className="tr-gen-input"
                value={filterLimit}
                onChange={(e) => setFilterLimit(e.target.value)}
              />
            </label>
          </div>

          {generateError && (
            <div className="tr-error-banner">{generateError}</div>
          )}

          <div className="tr-gen-actions">
            <button
              type="submit"
              className="tr-btn tr-btn-primary"
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Synthesise trends'}
            </button>
            <span className="tr-gen-hint">
              Needs at least 3 analysed videos matching the filter. Uses Claude Sonnet 4.5.
            </span>
          </div>
        </form>
      )}

      {error && <div className="tr-error-banner">{error}</div>}

      {loading && reports.length === 0 ? (
        <div className="tr-empty">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="tr-empty">
          No trend reports yet. Click <strong>Generate report</strong> to synthesise patterns from your analysed videos.
        </div>
      ) : (
        <div className="tr-list">
          {reports.map((r) => (
            <button
              key={r.id}
              className="tr-card"
              onClick={() => openDetail(r.id)}
            >
              <div className="tr-card-head">
                <div className="tr-card-title">{r.title || 'Untitled report'}</div>
                <span className={`tr-chip ${statusClass(r.status)}`}>
                  {r.status || 'unknown'}
                </span>
              </div>
              <div className="tr-card-meta">
                <span>{pluralize(r.source_count || 0, 'source')}</span>
                <span>·</span>
                <span>{formatRelativeTime(r.created_at)}</span>
                {r.model && (
                  <>
                    <span>·</span>
                    <span className="tr-mono">{r.model}</span>
                  </>
                )}
              </div>
              {r.filter && Object.keys(r.filter).length > 0 && (
                <div className="tr-card-filters">
                  {Object.entries(r.filter).map(([k, v]) => (
                    <span key={k} className="tr-filter-pill">
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              )}
              {r.error_message && (
                <div className="tr-card-error">{r.error_message}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- detail view ----------

function TrendReportDetail({ reportId, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [sources, setSources] = useState([])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-trend-report?id=${encodeURIComponent(reportId)}`,
        { headers: fnHeaders }
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`)
      setReport(body.report)
      setSources(body.sources || [])
    } catch (err) {
      setError(err.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [reportId])

  // Poll while running
  useEffect(() => {
    if (!report) return
    if (report.status !== 'running' && report.status !== 'pending') return
    const interval = setInterval(load, 6000)
    return () => clearInterval(interval)
  }, [report])

  if (loading && !report) {
    return (
      <div className="tr-root">
        <button className="tr-back" onClick={onBack}>← Back to reports</button>
        <div className="tr-empty">Loading report…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="tr-root">
        <button className="tr-back" onClick={onBack}>← Back to reports</button>
        <div className="tr-error-banner">{error}</div>
      </div>
    )
  }

  if (!report) return null

  const summary = report.summary || {}
  const isRunning = report.status === 'running' || report.status === 'pending'

  return (
    <div className="tr-root">
      <button className="tr-back" onClick={onBack}>← Back to reports</button>

      <div className="tr-detail-header">
        <div>
          <h1 className="tr-title">{report.title || 'Untitled report'}</h1>
          <div className="tr-detail-meta">
            <span className={`tr-chip ${statusClass(report.status)}`}>{report.status}</span>
            <span>{pluralize(report.source_count || sources.length || 0, 'source')}</span>
            <span>·</span>
            <span>Created {formatDate(report.created_at)}</span>
            {report.completed_at && (
              <>
                <span>·</span>
                <span>Completed {formatDate(report.completed_at)}</span>
              </>
            )}
            {report.model && (
              <>
                <span>·</span>
                <span className="tr-mono">{report.model}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="tr-info-banner">
          Synthesis is running. This page will refresh automatically.
        </div>
      )}

      {report.status === 'error' && report.error_message && (
        <div className="tr-error-banner">
          <strong>Synthesis failed:</strong> {report.error_message}
        </div>
      )}

      {report.status === 'complete' && summary && (
        <div className="tr-summary">
          {summary.overview && (
            <Section title="Overview">
              <p className="tr-prose">{summary.overview}</p>
            </Section>
          )}

          {Array.isArray(summary.recurring_hooks) && summary.recurring_hooks.length > 0 && (
            <Section title="Recurring hooks" count={summary.recurring_hooks.length}>
              <div className="tr-cards">
                {summary.recurring_hooks.map((h, i) => (
                  <HookCard key={i} item={h} />
                ))}
              </div>
            </Section>
          )}

          {summary.shot_length_stats && (
            <Section title="Shot length + pacing">
              <StatsGrid stats={summary.shot_length_stats} />
            </Section>
          )}

          {summary.layout_mix && (
            <Section title="Layout mix">
              <LayoutMix mix={summary.layout_mix} />
            </Section>
          )}

          {Array.isArray(summary.recurring_phrases) && summary.recurring_phrases.length > 0 && (
            <Section title="Recurring phrases" count={summary.recurring_phrases.length}>
              <div className="tr-cards">
                {summary.recurring_phrases.map((p, i) => (
                  <PhraseCard key={i} item={p} />
                ))}
              </div>
            </Section>
          )}

          {Array.isArray(summary.audio_reuse) && summary.audio_reuse.length > 0 && (
            <Section title="Audio reuse" count={summary.audio_reuse.length}>
              <div className="tr-cards">
                {summary.audio_reuse.map((a, i) => (
                  <AudioCard key={i} item={a} />
                ))}
              </div>
            </Section>
          )}

          {Array.isArray(summary.ctas) && summary.ctas.length > 0 && (
            <Section title="CTAs" count={summary.ctas.length}>
              <div className="tr-cards">
                {summary.ctas.map((c, i) => (
                  <CtaCard key={i} item={c} />
                ))}
              </div>
            </Section>
          )}

          {Array.isArray(summary.themes) && summary.themes.length > 0 && (
            <Section title="Themes" count={summary.themes.length}>
              <div className="tr-cards">
                {summary.themes.map((t, i) => (
                  <ThemeCard key={i} item={t} />
                ))}
              </div>
            </Section>
          )}

          {Array.isArray(summary.production_notes) && summary.production_notes.length > 0 && (
            <Section title="Production notes">
              <ul className="tr-bullets">
                {summary.production_notes.map((n, i) => (
                  <li key={i}>{typeof n === 'string' ? n : n.note || JSON.stringify(n)}</li>
                ))}
              </ul>
            </Section>
          )}

          {summary.copy_ideas && (
            <Section title="Copy ideas">
              <CopyIdeas ideas={summary.copy_ideas} />
            </Section>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <Section title="Source videos" count={sources.length}>
          <div className="tr-sources">
            {sources.map((s, i) => (
              <SourceCard key={s.id || i} index={i + 1} source={s} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ---------- subcomponents ----------

function Section({ title, count, children }) {
  return (
    <section className="tr-section">
      <div className="tr-section-head">
        <h2 className="tr-section-title">{title}</h2>
        {typeof count === 'number' && <span className="tr-section-count">{count}</span>}
      </div>
      <div className="tr-section-body">{children}</div>
    </section>
  )
}

function HookCard({ item }) {
  if (!item || typeof item !== 'object') {
    return <div className="tr-card-sm">{String(item)}</div>
  }
  const { hook, frequency, count, example_sources, notes } = item
  return (
    <div className="tr-card-sm">
      <div className="tr-card-sm-title">{hook || item.pattern || item.text}</div>
      <div className="tr-card-sm-meta">
        {typeof count === 'number' && <span>{count}×</span>}
        {frequency && <span>{frequency}</span>}
        {Array.isArray(example_sources) && example_sources.length > 0 && (
          <span className="tr-refs">refs: {example_sources.join(', ')}</span>
        )}
      </div>
      {notes && <div className="tr-card-sm-notes">{notes}</div>}
    </div>
  )
}

function PhraseCard({ item }) {
  if (!item || typeof item !== 'object') {
    return <div className="tr-card-sm">{String(item)}</div>
  }
  const { phrase, count, example_sources, context } = item
  return (
    <div className="tr-card-sm">
      <div className="tr-card-sm-title">"{phrase || item.text}"</div>
      <div className="tr-card-sm-meta">
        {typeof count === 'number' && <span>{count}×</span>}
        {context && <span>{context}</span>}
        {Array.isArray(example_sources) && example_sources.length > 0 && (
          <span className="tr-refs">refs: {example_sources.join(', ')}</span>
        )}
      </div>
    </div>
  )
}

function AudioCard({ item }) {
  if (!item || typeof item !== 'object') {
    return <div className="tr-card-sm">{String(item)}</div>
  }
  const { audio_title, count, example_sources, notes } = item
  return (
    <div className="tr-card-sm">
      <div className="tr-card-sm-title">{audio_title || item.track || 'Audio'}</div>
      <div className="tr-card-sm-meta">
        {typeof count === 'number' && <span>{count}×</span>}
        {Array.isArray(example_sources) && example_sources.length > 0 && (
          <span className="tr-refs">refs: {example_sources.join(', ')}</span>
        )}
      </div>
      {notes && <div className="tr-card-sm-notes">{notes}</div>}
    </div>
  )
}

function CtaCard({ item }) {
  if (!item || typeof item !== 'object') {
    return <div className="tr-card-sm">{String(item)}</div>
  }
  const { cta, count, example_sources, placement } = item
  return (
    <div className="tr-card-sm">
      <div className="tr-card-sm-title">{cta || item.text}</div>
      <div className="tr-card-sm-meta">
        {typeof count === 'number' && <span>{count}×</span>}
        {placement && <span>{placement}</span>}
        {Array.isArray(example_sources) && example_sources.length > 0 && (
          <span className="tr-refs">refs: {example_sources.join(', ')}</span>
        )}
      </div>
    </div>
  )
}

function ThemeCard({ item }) {
  if (!item || typeof item !== 'object') {
    return <div className="tr-card-sm">{String(item)}</div>
  }
  const { theme, description, example_sources } = item
  return (
    <div className="tr-card-sm">
      <div className="tr-card-sm-title">{theme || item.name}</div>
      {description && <div className="tr-card-sm-notes">{description}</div>}
      {Array.isArray(example_sources) && example_sources.length > 0 && (
        <div className="tr-card-sm-meta">
          <span className="tr-refs">refs: {example_sources.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

function StatsGrid({ stats }) {
  const entries = Object.entries(stats).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return null
  return (
    <div className="tr-stats-grid">
      {entries.map(([k, v]) => (
        <div key={k} className="tr-stat">
          <div className="tr-stat-label">{k.replace(/_/g, ' ')}</div>
          <div className="tr-stat-value">
            {typeof v === 'number' ? formatStatValue(k, v) : String(v)}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatStatValue(key, v) {
  if (key.includes('duration') || key.includes('length') || key.includes('seconds')) {
    return `${v.toFixed(2)}s`
  }
  if (key.includes('per_second') || key.includes('rate')) {
    return v.toFixed(2)
  }
  return Number.isInteger(v) ? v : v.toFixed(2)
}

function LayoutMix({ mix }) {
  const entries = Object.entries(mix).filter(([k]) => k !== 'notes')
  const total = entries.reduce((acc, [, v]) => acc + (Number(v) || 0), 0)
  if (total === 0) return <div className="tr-prose">{mix.notes || 'No layout data'}</div>
  return (
    <div>
      <div className="tr-layout-bar">
        {entries.map(([k, v]) => {
          const pct = ((Number(v) || 0) / total) * 100
          if (pct === 0) return null
          return (
            <div
              key={k}
              className={`tr-layout-seg tr-layout-${k.replace(/[^a-z0-9]/gi, '')}`}
              style={{ width: `${pct}%` }}
              title={`${k}: ${v} (${pct.toFixed(1)}%)`}
            >
              <span className="tr-layout-label">{k}</span>
              <span className="tr-layout-pct">{pct.toFixed(0)}%</span>
            </div>
          )
        })}
      </div>
      {mix.notes && <div className="tr-prose" style={{ marginTop: '12px' }}>{mix.notes}</div>}
    </div>
  )
}

function CopyIdeas({ ideas }) {
  if (!ideas || typeof ideas !== 'object') return null
  const hooks = Array.isArray(ideas.hooks) ? ideas.hooks : []
  const beats = Array.isArray(ideas.beats) ? ideas.beats : []
  const ctas = Array.isArray(ideas.ctas) ? ideas.ctas : []

  return (
    <div className="tr-copy-ideas">
      {hooks.length > 0 && (
        <div>
          <div className="tr-copy-label">Hook ideas</div>
          <ul className="tr-bullets">
            {hooks.map((h, i) => (
              <li key={i}>{typeof h === 'string' ? h : h.text || JSON.stringify(h)}</li>
            ))}
          </ul>
        </div>
      )}
      {beats.length > 0 && (
        <div>
          <div className="tr-copy-label">Beat ideas</div>
          <ul className="tr-bullets">
            {beats.map((b, i) => (
              <li key={i}>{typeof b === 'string' ? b : b.text || JSON.stringify(b)}</li>
            ))}
          </ul>
        </div>
      )}
      {ctas.length > 0 && (
        <div>
          <div className="tr-copy-label">CTA ideas</div>
          <ul className="tr-bullets">
            {ctas.map((c, i) => (
              <li key={i}>{typeof c === 'string' ? c : c.text || JSON.stringify(c)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SourceCard({ index, source }) {
  const ad = source.competitor_ad
  const post = source.organic_post
  const isOrganic = source.source === 'organic_post' && post
  const isAd = source.source === 'competitor_ad' && ad

  const thumb = post?.thumbnail_url || ad?.thumbnail_url || source.contact_sheet_url
  const displayName = isOrganic
    ? post.account
      ? `@${post.account.handle || post.account.brand_name}`
      : post.title || 'Organic post'
    : isAd
      ? ad.page_name || ad.creative_title || 'Competitor ad'
      : 'Video'
  const postUrl = post?.post_url

  return (
    <div className="tr-source">
      <div className="tr-source-index">[{index}]</div>
      {thumb ? (
        <img src={thumb} alt="" className="tr-source-thumb" />
      ) : (
        <div className="tr-source-thumb tr-source-thumb-empty">—</div>
      )}
      <div className="tr-source-body">
        <div className="tr-source-title">{displayName}</div>
        <div className="tr-source-meta">
          <span className={`tr-chip ${isOrganic ? 'tr-chip-organic' : 'tr-chip-ad'}`}>
            {isOrganic ? (post.platform || 'organic') : 'ad'}
          </span>
          {typeof source.duration_seconds === 'number' && (
            <span>{source.duration_seconds.toFixed(1)}s</span>
          )}
          {source.pacing_profile && <span>{source.pacing_profile}</span>}
          {typeof source.total_shots === 'number' && (
            <span>{pluralize(source.total_shots, 'shot')}</span>
          )}
          {postUrl && (
            <a href={postUrl} target="_blank" rel="noreferrer" className="tr-source-link">
              open ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
