// Cadence.jsx — Posting frequency + production velocity dashboard.
//
// Sits inside the Organic Intelligence tab. Pulls posts from organic_posts
// for all active accounts in a single PostgREST round trip, computes posting
// cadence on multiple time windows (7d / 30d / 90d / all), and renders three
// panels:
//
//   1. Cadence table — per-account posts/week, posts/month, days since last
//      post, format mix, average duration. Sortable.
//   2. Velocity vs revenue — posts/year annualised from the last 90 days,
//      divided by annual revenue (in millions). Lets us see "they ship X
//      posts per 1m of revenue". Inline-edit revenue per account.
//   3. Big picture summary — median cadence across the field + a simple
//      "to keep up with the median, you need to post N/week" target.
//
// All metrics computed client-side from a single posts query so the view
// stays snappy and the data stays in sync with the Organic Intel list.

import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './Cadence.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// ---------- Formatters ----------

function fmtNumber(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function fmtCurrency(n, currency = 'GBP') {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1_000_000) {
    return `${currency === 'GBP' ? '£' : ''}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m`
  }
  if (v >= 1_000) return `${currency === 'GBP' ? '£' : ''}${(v / 1_000).toFixed(0)}k`
  return `${currency === 'GBP' ? '£' : ''}${v.toFixed(0)}`
}

function fmtRatio(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

function daysSince(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / 86400000))
}

// ---------- Data fetch ----------

async function loadAllPosts(accountIds) {
  if (!accountIds.length) return []
  const idList = accountIds.map(id => `"${id}"`).join(',')
  const params = new URLSearchParams({
    select: 'account_id,posted_at,post_type,duration_seconds,language',
    'account_id': `in.(${idList})`,
    order: 'posted_at.desc.nullslast',
    limit: '5000',
  })
  const res = await fetch(`${supabaseUrl}/rest/v1/organic_posts?${params}`, {
    headers: fnHeaders,
  })
  if (!res.ok) throw new Error(`organic_posts read failed: ${res.status}`)
  return res.json()
}

// ---------- Cadence math ----------

function rateForWindow(posts, days) {
  const cutoff = Date.now() - days * 86400000
  let n = 0
  for (const p of posts) {
    if (!p.posted_at) continue
    const t = new Date(p.posted_at).getTime()
    if (Number.isNaN(t)) continue
    if (t >= cutoff) n += 1
  }
  return { count: n, perDay: n / days, perWeek: (n / days) * 7, perMonth: (n / days) * 30 }
}

function annualisedVolume(posts) {
  const w90 = rateForWindow(posts, 90)
  if (w90.count >= 3) return Math.round(w90.perDay * 365)
  const w30 = rateForWindow(posts, 30)
  if (w30.count >= 1) return Math.round(w30.perDay * 365)
  return null
}

function formatMix(posts) {
  const cutoff = Date.now() - 90 * 86400000
  const counts = {}
  let total = 0
  for (const p of posts) {
    if (!p.posted_at) continue
    const t = new Date(p.posted_at).getTime()
    if (Number.isNaN(t) || t < cutoff) continue
    const k = (p.post_type || 'unknown').toLowerCase()
    counts[k] = (counts[k] || 0) + 1
    total += 1
  }
  if (!total) return null
  const pct = {}
  for (const [k, v] of Object.entries(counts)) pct[k] = (v / total) * 100
  return { total, pct }
}

function avgVideoDuration(posts) {
  const cutoff = Date.now() - 90 * 86400000
  let n = 0
  let sum = 0
  for (const p of posts) {
    if (!p.posted_at) continue
    if (!p.duration_seconds) continue
    const t = new Date(p.posted_at).getTime()
    if (Number.isNaN(t) || t < cutoff) continue
    const d = Number(p.duration_seconds)
    if (!Number.isFinite(d) || d <= 0) continue
    sum += d
    n += 1
  }
  return n > 0 ? sum / n : null
}

function latestPostedAt(posts) {
  let latest = 0
  for (const p of posts) {
    if (!p.posted_at) continue
    const t = new Date(p.posted_at).getTime()
    if (!Number.isNaN(t) && t > latest) latest = t
  }
  return latest > 0 ? new Date(latest).toISOString() : null
}

function buildRow(account, posts) {
  const w7 = rateForWindow(posts, 7)
  const w30 = rateForWindow(posts, 30)
  const w90 = rateForWindow(posts, 90)
  const mix = formatMix(posts)
  const avgDur = avgVideoDuration(posts)
  const yearly = annualisedVolume(posts)
  const last = latestPostedAt(posts)
  const rev = account.annual_revenue_estimate ? Number(account.annual_revenue_estimate) : null
  const postsPerMillion = rev && rev > 0 && yearly !== null
    ? yearly / (rev / 1_000_000)
    : null
  return {
    account,
    posts_total: posts.length,
    w7,
    w30,
    w90,
    mix,
    avg_duration_seconds: avgDur,
    posts_per_year: yearly,
    posts_per_million: postsPerMillion,
    last_posted_at: last,
    days_since_last: daysSince(last),
  }
}

function sortAccessor(row, key) {
  switch (key) {
    case 'handle': return (row.account.handle || '').toLowerCase()
    case 'platform': return row.account.platform
    case 'posts_per_week': return row.w30.perWeek
    case 'posts_per_month': return row.w30.perMonth
    case 'last_posted': return row.last_posted_at ? new Date(row.last_posted_at).getTime() : -Infinity
    case 'avg_duration': return row.avg_duration_seconds ?? -Infinity
    case 'posts_per_year': return row.posts_per_year ?? -Infinity
    case 'revenue': return row.account.annual_revenue_estimate ?? -Infinity
    case 'posts_per_million': return row.posts_per_million ?? -Infinity
    default: return 0
  }
}

// ---------- Format mix bar ----------

const FORMAT_COLOURS = {
  reel: '#ff8a3d',
  short: '#ff8a3d',
  video: '#5b9bd5',
  image: '#7a8c99',
  carousel: '#9d6bff',
  livestream: '#d94a4a',
  unknown: '#3c4754',
  other: '#3c4754',
}

function MixBar({ mix }) {
  if (!mix || !mix.total) return <div className="cad-mix-empty">—</div>
  const segments = Object.entries(mix.pct)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  return (
    <div className="cad-mix" title={segments.map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(' · ')}>
      <div className="cad-mix-bar">
        {segments.map(([k, v]) => (
          <span
            key={k}
            className="cad-mix-seg"
            style={{ width: `${v}%`, background: FORMAT_COLOURS[k] || FORMAT_COLOURS.other }}
          />
        ))}
      </div>
      <div className="cad-mix-legend">
        {segments.slice(0, 3).map(([k, v]) => (
          <span key={k} className="cad-mix-tag">{k} {Math.round(v)}%</span>
        ))}
      </div>
    </div>
  )
}

// ---------- Revenue editor ----------

function RevenueCell({ account, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(account.annual_revenue_estimate ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setValue(account.annual_revenue_estimate ?? '')
  }, [account.id, account.annual_revenue_estimate])

  const save = async () => {
    setErr(null)
    const trimmed = String(value).trim()
    let num = null
    if (trimmed !== '') {
      num = Number(trimmed.replace(/[, £]/g, ''))
      if (!Number.isFinite(num) || num < 0) {
        setErr('Number')
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/save-organic-account`, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({
          action: 'upsert',
          brand_name: account.brand_name,
          platform: account.platform,
          handle: account.handle,
          platform_account_id: account.platform_account_id,
          annual_revenue_estimate: num,
          revenue_currency: account.revenue_currency || 'GBP',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onSaved?.(json.account || null)
      setEditing(false)
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="cad-rev-display"
        onClick={() => setEditing(true)}
        title="Click to edit annual revenue estimate"
      >
        {account.annual_revenue_estimate
          ? fmtCurrency(account.annual_revenue_estimate, account.revenue_currency)
          : <span className="cad-rev-empty">add</span>}
      </button>
    )
  }
  return (
    <div className="cad-rev-edit">
      <input
        type="text"
        autoFocus
        className="cad-rev-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setEditing(false); setErr(null); setValue(account.annual_revenue_estimate ?? '') }
        }}
        placeholder="e.g. 5000000"
        disabled={saving}
      />
      <button type="button" className="cad-rev-save" onClick={save} disabled={saving}>
        {saving ? '…' : 'Save'}
      </button>
      <button type="button" className="cad-rev-cancel" onClick={() => { setEditing(false); setErr(null) }} disabled={saving}>
        ×
      </button>
      {err && <div className="cad-rev-err">{err}</div>}
    </div>
  )
}

// ---------- Cadence table ----------

function CadenceTable({ rows, onAccountUpdated }) {
  const [sortKey, setSortKey] = useState('posts_per_week')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    const cp = [...rows]
    cp.sort((a, b) => {
      const av = sortAccessor(a, sortKey)
      const bv = sortAccessor(b, sortKey)
      if (typeof av === 'string' && typeof bv === 'string') {
        const cmp = av.localeCompare(bv)
        return sortDir === 'asc' ? cmp : -cmp
      }
      const an = typeof av === 'number' ? av : -Infinity
      const bn = typeof bv === 'number' ? bv : -Infinity
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return cp
  }, [rows, sortKey, sortDir])

  const headerBtn = (key, label, align = 'right') => (
    <th className={`cad-th cad-th-${align}`}>
      <button
        type="button"
        className={`cad-th-btn ${sortKey === key ? 'active' : ''}`}
        onClick={() => {
          if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          } else {
            setSortKey(key)
            setSortDir('desc')
          }
        }}
      >
        {label}
        {sortKey === key && <span className="cad-th-dir">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  )

  return (
    <div className="cad-table-wrap">
      <table className="cad-table">
        <thead>
          <tr>
            {headerBtn('handle', 'Account', 'left')}
            {headerBtn('platform', 'Platform', 'left')}
            {headerBtn('posts_per_week', 'Posts / wk (30d)')}
            {headerBtn('posts_per_month', 'Posts / mo (30d)')}
            {headerBtn('last_posted', 'Last post')}
            {headerBtn('avg_duration', 'Avg duration')}
            <th className="cad-th cad-th-left">Format mix (90d)</th>
            {headerBtn('posts_per_year', 'Posts / yr')}
            {headerBtn('revenue', 'Revenue')}
            {headerBtn('posts_per_million', 'Posts / £1m')}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.account.id}>
              <td className="cad-td cad-td-left">
                <div className="cad-acc-handle">@{row.account.handle}</div>
                <div className="cad-acc-brand">{row.account.brand_name}</div>
              </td>
              <td className="cad-td cad-td-left">
                <span className={`cad-chip cad-chip-${row.account.platform === 'youtube' ? 'yt' : 'ig'}`}>
                  {row.account.platform === 'youtube' ? 'YT' : 'IG'}
                </span>
              </td>
              <td className="cad-td">{fmtNumber(row.w30.perWeek, 1)}</td>
              <td className="cad-td">{fmtNumber(row.w30.perMonth, 0)}</td>
              <td className="cad-td">
                {row.days_since_last !== null ? (
                  <span className={row.days_since_last > 14 ? 'cad-stale' : ''}>
                    {row.days_since_last}d ago
                  </span>
                ) : '—'}
              </td>
              <td className="cad-td">
                {row.avg_duration_seconds
                  ? `${Math.round(row.avg_duration_seconds)}s`
                  : '—'}
              </td>
              <td className="cad-td cad-td-left cad-td-mix">
                <MixBar mix={row.mix} />
              </td>
              <td className="cad-td">{fmtNumber(row.posts_per_year)}</td>
              <td className="cad-td">
                <RevenueCell account={row.account} onSaved={onAccountUpdated} />
              </td>
              <td className="cad-td cad-td-strong">
                {fmtRatio(row.posts_per_million)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Big picture panel ----------

function median(values) {
  const vs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (!vs.length) return null
  const mid = Math.floor(vs.length / 2)
  return vs.length % 2 === 0 ? (vs[mid - 1] + vs[mid]) / 2 : vs[mid]
}

function BigPicturePanel({ rows, ourRevenue, setOurRevenue }) {
  const stats = useMemo(() => {
    const week30 = rows.map(r => r.w30.perWeek).filter(v => v > 0)
    const yearly = rows.map(r => r.posts_per_year).filter(v => v && v > 0)
    const ppm = rows.map(r => r.posts_per_million).filter(v => v && v > 0)
    return {
      medianPerWeek: median(week30),
      maxPerWeek: week30.length ? Math.max(...week30) : null,
      medianPerYear: median(yearly),
      medianPostsPerMillion: median(ppm),
      bestPostsPerMillion: ppm.length ? Math.max(...ppm) : null,
    }
  }, [rows])

  const targetPerWeek = useMemo(() => {
    if (!stats.medianPostsPerMillion || !ourRevenue) return null
    const millions = Number(ourRevenue) / 1_000_000
    if (!Number.isFinite(millions) || millions <= 0) return null
    return (stats.medianPostsPerMillion * millions) / 52
  }, [stats.medianPostsPerMillion, ourRevenue])

  return (
    <div className="cad-bigpic">
      <div className="cad-bigpic-grid">
        <div className="cad-stat">
          <div className="cad-stat-label">Median competitor</div>
          <div className="cad-stat-value">{fmtNumber(stats.medianPerWeek, 1)}</div>
          <div className="cad-stat-sub">posts / week</div>
        </div>
        <div className="cad-stat">
          <div className="cad-stat-label">Top competitor</div>
          <div className="cad-stat-value">{fmtNumber(stats.maxPerWeek, 1)}</div>
          <div className="cad-stat-sub">posts / week</div>
        </div>
        <div className="cad-stat">
          <div className="cad-stat-label">Median annual volume</div>
          <div className="cad-stat-value">{fmtNumber(stats.medianPerYear)}</div>
          <div className="cad-stat-sub">posts / year</div>
        </div>
        <div className="cad-stat">
          <div className="cad-stat-label">Posts / £1m revenue</div>
          <div className="cad-stat-value">
            {fmtRatio(stats.medianPostsPerMillion)}
          </div>
          <div className="cad-stat-sub">median across field</div>
        </div>
      </div>

      <div className="cad-target">
        <div className="cad-target-head">
          <div className="cad-target-title">Velocity required to compete</div>
          <div className="cad-target-sub">
            Enter Chefly's annual revenue (or a target) to see what cadence the median
            competitor would imply at your scale.
          </div>
        </div>
        <div className="cad-target-input-row">
          <label className="cad-target-label">Our revenue (£):</label>
          <input
            type="text"
            className="cad-target-input"
            value={ourRevenue}
            onChange={e => setOurRevenue(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 2000000"
          />
          <div className="cad-target-result">
            {targetPerWeek ? (
              <>
                <span className="cad-target-result-num">{fmtNumber(targetPerWeek, 1)}</span>
                <span className="cad-target-result-unit">posts / week</span>
                <span className="cad-target-result-extra">
                  ({fmtNumber(targetPerWeek * 4.33, 0)} / month, {fmtNumber(targetPerWeek * 52)} / year)
                </span>
              </>
            ) : (
              <span className="cad-target-result-empty">
                Add revenue figures to at least one competitor to compute.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Top-level Cadence component ----------

const OUR_REVENUE_KEY = 'cad-our-revenue-v1'

export default function Cadence({ accounts, loading: accountsLoading, onAccountUpdated }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [ourRevenue, setOurRevenue] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage?.getItem(OUR_REVENUE_KEY) || ''
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(OUR_REVENUE_KEY, ourRevenue)
  }, [ourRevenue])

  const accountIds = useMemo(() => accounts.map(a => a.id), [accounts])

  useEffect(() => {
    let cancelled = false
    if (!accountIds.length) {
      setPosts([])
      return () => { cancelled = true }
    }
    setLoading(true)
    setError(null)
    loadAllPosts(accountIds)
      .then(rows => { if (!cancelled) setPosts(rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountIds.join(',')])

  const postsByAccount = useMemo(() => {
    const map = new Map()
    for (const p of posts) {
      if (!map.has(p.account_id)) map.set(p.account_id, [])
      map.get(p.account_id).push(p)
    }
    return map
  }, [posts])

  const rows = useMemo(() => {
    return accounts
      .filter(a => platformFilter === 'all' || a.platform === platformFilter)
      .map(a => buildRow(a, postsByAccount.get(a.id) || []))
  }, [accounts, postsByAccount, platformFilter])

  const igCount = accounts.filter(a => a.platform === 'instagram').length
  const ytCount = accounts.filter(a => a.platform === 'youtube').length

  return (
    <div className="cad-root">
      <div className="cad-header">
        <div>
          <h2 className="cad-title">Cadence &amp; Velocity</h2>
          <div className="cad-subtitle">
            Posting frequency over the last 30 days, format mix over 90 days, and
            posts-per-£1m-revenue benchmarks. Annual volume is annualised from the last 90 days.
          </div>
        </div>
        <div className="cad-filters">
          <button
            type="button"
            className={`cad-filter ${platformFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('all')}
          >All ({accounts.length})</button>
          <button
            type="button"
            className={`cad-filter ${platformFilter === 'instagram' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('instagram')}
          >Instagram ({igCount})</button>
          <button
            type="button"
            className={`cad-filter ${platformFilter === 'youtube' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('youtube')}
          >YouTube ({ytCount})</button>
        </div>
      </div>

      <BigPicturePanel rows={rows} ourRevenue={ourRevenue} setOurRevenue={setOurRevenue} />

      {accountsLoading || loading ? (
        <div className="cad-empty">Loading cadence…</div>
      ) : error ? (
        <div className="cad-error">{error}</div>
      ) : !rows.length ? (
        <div className="cad-empty">No accounts match this filter.</div>
      ) : (
        <CadenceTable rows={rows} onAccountUpdated={onAccountUpdated} />
      )}

      <div className="cad-foot">
        <strong>How to read this:</strong> "Posts / £1m" annualises the last 90 days
        of activity, then divides by annual revenue. A brand at £5m revenue posting
        500/year shows 100. The "velocity required to compete" panel scales the
        median across the field to your own revenue.
      </div>
    </div>
  )
}
