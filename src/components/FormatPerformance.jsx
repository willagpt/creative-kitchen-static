// FormatPerformance.jsx — Cross-account analysis of which organic content
// patterns over-index on engagement.
//
// Sister to Cadence.jsx and PaidCadence.jsx. Lives as a subtab inside
// OrganicIntel. Calls the list_organic_format_performance RPC, joins
// optional account filter, and renders:
//
//   1. Leaderboard table — one row per content_pattern with sample size,
//      median + P75 views / engagement rate / saves, "over-index" badge
//   2. Account-scope toggle: "All accounts" default, dropdown to filter
//      to one account
//   3. Metric switcher: Views / Engagement / Saves (changes which column
//      is highlighted + which median drives the rank)
//   4. Sample-size warnings: patterns with n<3 are dimmed and labelled
//      'low sample' so we don't draw conclusions from one-off videos
//
// The rationale text we wrote into ai-analyse-video lands in
// content_pattern_rationale on each analysis, which we surface on hover
// via the example_post_ids drill-in (each post links into the existing
// Organic Intel detail view).

import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './FormatPerformance.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// Minimum sample size before we treat a pattern as "real". Below this
// the row is dimmed and excluded from the cross-pattern median.
const MIN_SAMPLE = 3

// Metric definitions — drives the "rank by" dropdown and which column
// gets the gold-highlight treatment.
const METRICS = [
  {
    key: 'views',
    label: 'Views',
    sub: 'algorithmic reach',
    medianKey: 'median_views',
    p75Key: 'p75_views',
    fmt: v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : Math.round(v || 0).toString(),
  },
  {
    key: 'engagement',
    label: 'Engagement rate',
    sub: '(likes+comments+saves+shares) / views',
    medianKey: 'median_engagement_rate',
    p75Key: 'p75_engagement_rate',
    fmt: v => v != null ? `${(v * 100).toFixed(1)}%` : '—',
  },
  {
    key: 'saves',
    label: 'Saves',
    sub: 'high-quality signal (per Mosseri)',
    medianKey: 'median_saves',
    p75Key: 'p75_saves',
    fmt: v => v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : Math.round(v || 0).toString(),
  },
]

// ---------- Data layer ----------

async function loadFormatStats(accountId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/list_organic_format_performance`, {
    method: 'POST',
    headers: fnHeaders,
    body: JSON.stringify({ p_account_id: accountId || null }),
  })
  if (!res.ok) throw new Error(`list_organic_format_performance failed: ${res.status}`)
  return res.json()
}

// Fetch metadata for the example posts referenced in each row.
async function loadExamplePosts(postIds) {
  if (!postIds || !postIds.length) return {}
  const ids = [...new Set(postIds)]
  const params = new URLSearchParams({
    select: 'id,thumbnail_url,post_url,caption,post_type,posted_at,account_id',
    'id': `in.(${ids.map(id => `"${id}"`).join(',')})`,
    limit: '500',
  })
  const res = await fetch(`${supabaseUrl}/rest/v1/organic_posts?${params}`, { headers: fnHeaders })
  if (!res.ok) return {}
  const rows = await res.json()
  const map = {}
  for (const r of rows) map[r.id] = r
  return map
}

// ---------- Helpers ----------

function fmtPercent(v, digits = 1) {
  if (v === null || v === undefined) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

function fmtNumber(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function median(values) {
  const vs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (!vs.length) return null
  const mid = Math.floor(vs.length / 2)
  return vs.length % 2 === 0 ? (vs[mid - 1] + vs[mid]) / 2 : vs[mid]
}

// Hotlink-blocked CDN proxy — same logic as OrganicIntel.jsx
const HOTLINK_BLOCKED = /(?:^|\.)(cdninstagram\.com|fbcdn\.net)$/i
function thumb(url) {
  if (!url) return null
  try {
    const host = new URL(url).hostname
    if (!HOTLINK_BLOCKED.test(host)) return url
    return `${supabaseUrl}/functions/v1/proxy-thumbnail?${new URLSearchParams({ url })}`
  } catch { return url }
}

// ---------- Components ----------

function ExamplePostStrip({ ids, postsById }) {
  if (!ids || !ids.length) return null
  return (
    <div className="fp-examples">
      {ids.slice(0, 5).map(id => {
        const p = postsById[id]
        if (!p) return null
        return (
          <a
            key={id}
            href={p.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="fp-example"
            title={(p.caption || '').slice(0, 200)}
          >
            <img src={thumb(p.thumbnail_url)} alt="" loading="lazy" referrerPolicy="no-referrer"
                 onError={e => { e.currentTarget.style.display = 'none' }} />
          </a>
        )
      })}
    </div>
  )
}

function PerformanceTable({ rows, postsById, metric, fieldMedian }) {
  // Compute the field median for the active metric so we can flag rows that
  // over-index. Only count rows with sample >= MIN_SAMPLE.
  const m = METRICS.find(x => x.key === metric) || METRICS[0]

  return (
    <div className="fp-table-wrap">
      <table className="fp-table">
        <thead>
          <tr>
            <th className="fp-th fp-th-left">Content pattern</th>
            <th className="fp-th">Sample (n)</th>
            <th className={`fp-th ${metric === 'views' ? 'fp-th-active' : ''}`}>
              Median views
            </th>
            <th className={`fp-th ${metric === 'engagement' ? 'fp-th-active' : ''}`}>
              Median engagement
            </th>
            <th className={`fp-th ${metric === 'saves' ? 'fp-th-active' : ''}`}>
              Median saves
            </th>
            <th className="fp-th">P75 ({m.label})</th>
            <th className="fp-th-left">Index</th>
            <th className="fp-th-left">Top performers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const lowSample = Number(row.sample_size) < MIN_SAMPLE
            const activeVal = Number(row[m.medianKey]) || 0
            const idx = fieldMedian && fieldMedian > 0 ? activeVal / fieldMedian : null
            const overIndex = idx !== null && idx >= 1.5 && !lowSample
            const underIndex = idx !== null && idx < 0.5 && !lowSample
            return (
              <tr
                key={row.content_pattern}
                className={`${lowSample ? 'fp-row-low' : ''} ${overIndex ? 'fp-row-over' : ''}`}
              >
                <td className="fp-td fp-td-left">
                  <div className="fp-pattern-label">{row.pattern_label || row.content_pattern}</div>
                  <div className="fp-pattern-key">{row.content_pattern}</div>
                </td>
                <td className={`fp-td ${lowSample ? 'fp-td-warn' : ''}`}>
                  {row.sample_size}
                  {lowSample && <span className="fp-td-warn-label" title={`Need ≥${MIN_SAMPLE} for confidence`}>low</span>}
                </td>
                <td className={`fp-td ${metric === 'views' ? 'fp-td-active' : ''}`}>
                  {fmtNumber(row.median_views)}
                </td>
                <td className={`fp-td ${metric === 'engagement' ? 'fp-td-active' : ''}`}>
                  {fmtPercent(row.median_engagement_rate)}
                </td>
                <td className={`fp-td ${metric === 'saves' ? 'fp-td-active' : ''}`}>
                  {fmtNumber(row.median_saves)}
                </td>
                <td className="fp-td">{m.fmt(row[m.p75Key])}</td>
                <td className="fp-td fp-td-left">
                  {idx === null ? '—' : (
                    <span className={`fp-index ${overIndex ? 'fp-index-over' : underIndex ? 'fp-index-under' : ''}`}>
                      {idx.toFixed(2)}x
                    </span>
                  )}
                </td>
                <td className="fp-td fp-td-left">
                  <ExamplePostStrip ids={row.example_post_ids} postsById={postsById} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BigPicture({ rows, metric, totalSample, fieldMedian }) {
  const m = METRICS.find(x => x.key === metric) || METRICS[0]
  // Pick the top + bottom row by the active metric, ignoring low-sample.
  const eligible = rows.filter(r => Number(r.sample_size) >= MIN_SAMPLE)
  const sorted = [...eligible].sort((a, b) => Number(b[m.medianKey] || 0) - Number(a[m.medianKey] || 0))
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]

  return (
    <div className="fp-bigpic">
      <div className="fp-bigpic-stat">
        <div className="fp-bigpic-label">Patterns observed</div>
        <div className="fp-bigpic-value">{rows.length}</div>
        <div className="fp-bigpic-sub">{eligible.length} with n≥{MIN_SAMPLE}</div>
      </div>
      <div className="fp-bigpic-stat">
        <div className="fp-bigpic-label">Total videos analysed</div>
        <div className="fp-bigpic-value">{totalSample}</div>
        <div className="fp-bigpic-sub">across all patterns</div>
      </div>
      <div className="fp-bigpic-stat fp-bigpic-stat-tall">
        <div className="fp-bigpic-label">Best on {m.label.toLowerCase()}</div>
        <div className="fp-bigpic-value fp-bigpic-value-name">
          {top ? top.pattern_label : '—'}
        </div>
        <div className="fp-bigpic-sub">
          {top ? `${m.fmt(top[m.medianKey])} median (n=${top.sample_size})` : ''}
        </div>
      </div>
      <div className="fp-bigpic-stat fp-bigpic-stat-tall">
        <div className="fp-bigpic-label">Weakest on {m.label.toLowerCase()}</div>
        <div className="fp-bigpic-value fp-bigpic-value-name fp-bigpic-value-dim">
          {bottom && bottom !== top ? bottom.pattern_label : '—'}
        </div>
        <div className="fp-bigpic-sub">
          {bottom && bottom !== top ? `${m.fmt(bottom[m.medianKey])} median (n=${bottom.sample_size})` : ''}
        </div>
      </div>
      <div className="fp-bigpic-stat">
        <div className="fp-bigpic-label">Field median</div>
        <div className="fp-bigpic-value">{m.fmt(fieldMedian)}</div>
        <div className="fp-bigpic-sub">across patterns with n≥{MIN_SAMPLE}</div>
      </div>
    </div>
  )
}

// ---------- Top-level ----------

export default function FormatPerformance({ accounts }) {
  const [accountId, setAccountId] = useState('all')
  const [metric, setMetric] = useState('engagement')
  const [rows, setRows] = useState([])
  const [postsById, setPostsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadFormatStats(accountId === 'all' ? null : accountId)
      .then(async data => {
        if (cancelled) return
        setRows(data || [])
        const exampleIds = (data || []).flatMap(r => r.example_post_ids || [])
        if (exampleIds.length) {
          const posts = await loadExamplePosts(exampleIds)
          if (!cancelled) setPostsById(posts)
        } else {
          setPostsById({})
        }
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  const sorted = useMemo(() => {
    const m = METRICS.find(x => x.key === metric) || METRICS[0]
    return [...rows].sort((a, b) => {
      const aLow = Number(a.sample_size) < MIN_SAMPLE
      const bLow = Number(b.sample_size) < MIN_SAMPLE
      if (aLow !== bLow) return aLow ? 1 : -1
      return Number(b[m.medianKey] || 0) - Number(a[m.medianKey] || 0)
    })
  }, [rows, metric])

  const fieldMedian = useMemo(() => {
    const m = METRICS.find(x => x.key === metric) || METRICS[0]
    const eligible = rows
      .filter(r => Number(r.sample_size) >= MIN_SAMPLE)
      .map(r => Number(r[m.medianKey] || 0))
    return median(eligible)
  }, [rows, metric])

  const totalSample = useMemo(
    () => rows.reduce((s, r) => s + Number(r.sample_size || 0), 0),
    [rows]
  )

  return (
    <div className="fp-root">
      <div className="fp-header">
        <div>
          <h2 className="fp-title">Format Performance</h2>
          <div className="fp-subtitle">
            Which content patterns over-index on engagement. Pulled from
            video_analyses.ai_analysis.content_pattern joined to the latest
            organic_post_metrics snapshot per post. Patterns with fewer than{' '}
            {MIN_SAMPLE} videos are flagged as low-sample.
          </div>
        </div>
        <div className="fp-controls">
          <select
            className="fp-select"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            title="Filter to one account, or aggregate across all"
          >
            <option value="all">All accounts</option>
            {accounts && accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.platform === 'youtube' ? 'YT' : 'IG'} · {a.brand_name || a.handle}
              </option>
            ))}
          </select>
          <div className="fp-metric-pills">
            {METRICS.map(m => (
              <button
                key={m.key}
                type="button"
                className={`fp-pill ${metric === m.key ? 'active' : ''}`}
                onClick={() => setMetric(m.key)}
                title={m.sub}
              >{m.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="fp-empty">Loading format performance…</div>
      ) : error ? (
        <div className="fp-error">{error}</div>
      ) : !rows.length ? (
        <div className="fp-empty">
          No analysed videos yet. Run AI analysis on organic posts to populate this view.
        </div>
      ) : (
        <>
          <BigPicture
            rows={rows}
            metric={metric}
            totalSample={totalSample}
            fieldMedian={fieldMedian}
          />
          <PerformanceTable
            rows={sorted}
            postsById={postsById}
            metric={metric}
            fieldMedian={fieldMedian}
          />
          <div className="fp-foot">
            <strong>How to read the index:</strong> the rightmost "Index" column is the
            pattern's median (on the active metric) divided by the field median across
            patterns with n≥{MIN_SAMPLE}. ≥1.5x is highlighted in green (over-indexes),
            &lt;0.5x in red (under-indexes). "Sample (n)" is the number of videos in
            that pattern bucket; rows with n&lt;{MIN_SAMPLE} are dimmed because medians
            on tiny samples are noisy. Top performers thumbnails link to the original
            posts on Instagram / YouTube.
          </div>
        </>
      )}
    </div>
  )
}
