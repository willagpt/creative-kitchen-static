// PaidCadence.jsx — Test velocity + creative library benchmarks for paid Meta ads.
//
// Sister view to Cadence.jsx (organic). Lives as a subtab inside CompetitorAds
// alongside Library and Top Performers. Answers: "how aggressively is each
// brand testing, how big is their live ad library, how ruthlessly do they
// kill, and what does our cadence need to look like at our revenue scale".
//
// Data flow:
//   1. list_paid_cadence_stats() RPC returns one row per page_name with
//      pre-aggregated metrics (test counts on 7d/30d/prev-30d/90d windows,
//      active library size, kill rate inputs, format mix, impressions sum,
//      median days_active, freshness).
//   2. Frontend renders the table + the big-picture panel + the surge banner.
//   3. Inline-edit revenue / niche / CPM persists to paid_brand_meta via a
//      direct PostgREST upsert (RLS is permissive).
//
// CPM defaults are tunable in a strip at the top so the user can plug in
// whatever they think is realistic for the food/DTC niche.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './PaidCadence.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// ---------- Settings ----------

// Default niche CPMs (in £). Editable in the strip at the top of the
// dashboard, persisted to localStorage so they outlive the session.
const DEFAULT_CPMS = {
  food: 12,
  beauty: 18,
  fitness: 15,
  supplements: 14,
  fashion: 16,
  saas: 22,
  other: 12,
}
const NICHE_OPTIONS = ['food', 'beauty', 'fitness', 'supplements', 'fashion', 'saas', 'other']
const CPM_KEY = 'pc-niche-cpms-v1'
const OUR_REVENUE_KEY = 'pc-our-revenue-v1'

// Surge threshold: 30d test count must be >= 2x prev 30d AND >= 5 launches
// (avoid 0 -> 2 false positives on tiny samples).
const SURGE_RATIO = 2
const SURGE_MIN_TESTS = 5

// "Test intensity" tiers — directional spend categorisation that doesn't
// depend on impressions data (which Foreplay rarely passes through for
// these brands). Driven by tests_30d + active_tests.
function intensityTier(row) {
  const t30 = Number(row.tests_30d || 0)
  const active = Number(row.active_tests || 0)
  if (t30 >= 100 || active >= 200) return { key: 'whale', label: 'Whale', desc: 'Enterprise budget tier' }
  if (t30 >= 30 || active >= 50) return { key: 'heavy', label: 'Heavy', desc: 'Significant paid spend' }
  if (t30 >= 10 || active >= 15) return { key: 'mid', label: 'Mid', desc: 'Moderate paid spend' }
  if (t30 > 0 || active > 0) return { key: 'light', label: 'Light', desc: 'Small / sporadic spend' }
  return { key: 'dark', label: 'Dark', desc: 'No recent activity tracked' }
}

// ---------- Formatters ----------

function fmtNumber(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function fmtPercent(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return `${(Number(n) * 100).toFixed(digits)}%`
}

function fmtRatio(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

function fmtCurrency(n, currency = 'GBP', short = true) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const sym = currency === 'GBP' ? '£' : (currency === 'USD' ? '$' : '')
  if (!short) return `${sym}${v.toLocaleString('en-GB')}`
  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m`
  if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}k`
  return `${sym}${v.toFixed(0)}`
}

function daysSince(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / 86400000))
}

// ---------- Parent brand + link helpers ----------

// Build a deep link to Meta Ad Library filtered to a specific page_id.
// view_all_page_id is the canonical filter Meta uses for the Library page.
function metaAdLibraryUrl(pageId) {
  if (!pageId) return null
  const qs = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country: 'ALL',
    search_type: 'page',
    view_all_page_id: String(pageId),
  })
  return `https://www.facebook.com/ads/library/?${qs}`
}

// Extract a clean hostname for display from a destination URL (most_common_link_url).
// Strips www. and any URL parsing failures fall back to a truncated string.
function prettyHost(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}...` : url
  }
}

// For each row, identify the primary brand at its page_id (the one with the
// highest total_tests). Rows that aren't primary are flagged as "creators"
// and their primary's display name is attached.
function annotateParents(rows) {
  if (!rows || !rows.length) return rows
  const byPage = new Map()
  for (const r of rows) {
    if (!r.page_id) continue
    const cur = byPage.get(r.page_id)
    const total = Number(r.total_tests || 0)
    if (!cur || total > Number(cur.total_tests || 0)) {
      byPage.set(r.page_id, r)
    }
  }
  return rows.map(r => {
    const primary = r.page_id ? byPage.get(r.page_id) : null
    const isPrimary = !primary || primary.page_name === r.page_name
    return {
      ...r,
      __is_creator: !isPrimary,
      __parent_brand: isPrimary ? null : (primary?.brand_name_display || primary?.page_name || null),
    }
  })
}

// ---------- Data layer ----------

async function loadStats() {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/list_paid_cadence_stats`, {
    method: 'POST',
    headers: fnHeaders,
    body: '{}',
  })
  if (!res.ok) throw new Error(`list_paid_cadence_stats failed: ${res.status}`)
  return res.json()
}

// Upsert a paid_brand_meta row keyed on page_name_key (lowercased page_name).
// Returns the saved row.
async function savePaidBrandMeta(row) {
  const params = new URLSearchParams({ on_conflict: 'page_name_key' })
  const payload = {
    page_name_key: (row.page_name_display || '').toLowerCase(),
    page_name_display: row.page_name_display,
    page_id: row.page_id ?? null,
    annual_revenue_estimate:
      row.annual_revenue_estimate === '' || row.annual_revenue_estimate === undefined
        ? null
        : Number(row.annual_revenue_estimate),
    revenue_currency: row.revenue_currency || 'GBP',
    niche: row.niche ?? null,
    cpm_override:
      row.cpm_override === '' || row.cpm_override === undefined
        ? null
        : Number(row.cpm_override),
    notes: row.notes ?? null,
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/paid_brand_meta?${params}`, {
    method: 'POST',
    headers: {
      ...fnHeaders,
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`paid_brand_meta upsert failed: ${res.status} ${txt}`)
  }
  const rows = await res.json()
  return rows[0]
}

// ---------- Spend math ----------

// Best CPM for a brand: per-brand override > niche default > "other".
function effectiveCpm(row, cpms) {
  if (row.cpm_override) return Number(row.cpm_override)
  const niche = (row.niche || 'other').toLowerCase()
  return Number(cpms[niche] ?? cpms.other ?? 12)
}

// Monthly spend estimate from impressions × CPM.
// impressions_lower / upper are the totals across currently-active ads.
// We don't know how stale those impression counts are, so this is loose.
function spendBand(row, cpms) {
  const lower = Number(row.impressions_lower_active || 0)
  const upper = Number(row.impressions_upper_active || 0)
  if (!lower && !upper) return { lower: null, upper: null, midpoint: null }
  const cpm = effectiveCpm(row, cpms)
  return {
    lower: (lower * cpm) / 1000,
    upper: (upper * cpm) / 1000,
    midpoint: ((lower + upper) / 2 * cpm) / 1000,
  }
}

// Annualised tests = tests in last 90d × (365 / 90). Falls back to 30d
// when 90d is missing data (very new brand).
function annualisedTests(row) {
  const t90 = Number(row.tests_90d || 0)
  if (t90 >= 3) return Math.round(t90 * (365 / 90))
  const t30 = Number(row.tests_30d || 0)
  if (t30 >= 1) return Math.round(t30 * (365 / 30))
  return null
}

function killRate90d(row) {
  const total = Number(row.ads_total_90d || 0)
  if (!total) return null
  return Number(row.ads_dead_90d || 0) / total
}

function surgeRatio(row) {
  const cur = Number(row.tests_30d || 0)
  const prev = Number(row.tests_prev_30d || 0)
  if (!prev) return cur > 0 ? Infinity : null
  return cur / prev
}

function isSurging(row) {
  const r = surgeRatio(row)
  if (r === null || !Number.isFinite(r)) return false
  return r >= SURGE_RATIO && Number(row.tests_30d || 0) >= SURGE_MIN_TESTS
}

// ---------- Format mix bar ----------

const FORMAT_COLOURS = {
  IMAGE: '#7a8c99',
  VIDEO: '#5b9bd5',
  DCO: '#9d6bff',
  CAROUSEL: '#ff8a3d',
  OTHER: '#3c4754',
}

function FormatMix({ row }) {
  const total =
    Number(row.image_count_90d || 0) +
    Number(row.video_count_90d || 0) +
    Number(row.dco_count_90d || 0) +
    Number(row.carousel_count_90d || 0) +
    Number(row.other_count_90d || 0)
  if (!total) return <span className="pc-mix-empty">—</span>
  const segs = [
    ['IMAGE', Number(row.image_count_90d || 0)],
    ['VIDEO', Number(row.video_count_90d || 0)],
    ['DCO', Number(row.dco_count_90d || 0)],
    ['CAROUSEL', Number(row.carousel_count_90d || 0)],
    ['OTHER', Number(row.other_count_90d || 0)],
  ]
    .filter(([, n]) => n > 0)
    .map(([k, n]) => [k, (n / total) * 100])
    .sort((a, b) => b[1] - a[1])
  return (
    <div className="pc-mix" title={segs.map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(' · ')}>
      <div className="pc-mix-bar">
        {segs.map(([k, v]) => (
          <span key={k} className="pc-mix-seg" style={{ width: `${v}%`, background: FORMAT_COLOURS[k] }} />
        ))}
      </div>
      <div className="pc-mix-legend">
        {segs.slice(0, 3).map(([k, v]) => (
          <span key={k} className="pc-mix-tag">{k.toLowerCase()} {Math.round(v)}%</span>
        ))}
      </div>
    </div>
  )
}

// ---------- Inline edit cell ----------

function InlineEdit({ value, placeholder, onSave, type = 'text', display, suffix }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { setV(value ?? '') }, [value])

  const commit = async () => {
    setErr(null)
    setSaving(true)
    try {
      const out = type === 'number'
        ? (String(v).trim() === '' ? null : Number(String(v).replace(/[, £]/g, '')))
        : (String(v).trim() === '' ? null : String(v).trim())
      if (type === 'number' && out !== null && (!Number.isFinite(out) || out < 0)) {
        setErr('Number')
        return
      }
      await onSave(out)
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
        className={`pc-inline-display ${value === null || value === undefined || value === '' ? 'empty' : ''}`}
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {display !== undefined ? display : (value || placeholder || 'add')}
        {suffix && value ? <span className="pc-inline-suffix">{suffix}</span> : null}
      </button>
    )
  }
  return (
    <div className="pc-inline-edit">
      <input
        autoFocus
        className="pc-inline-input"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setEditing(false); setErr(null); setV(value ?? '') }
        }}
        placeholder={placeholder}
        disabled={saving}
      />
      <button type="button" className="pc-inline-save" onClick={commit} disabled={saving}>{saving ? '…' : '✓'}</button>
      <button type="button" className="pc-inline-cancel" onClick={() => { setEditing(false); setErr(null); setV(value ?? '') }} disabled={saving}>×</button>
      {err && <span className="pc-inline-err">{err}</span>}
    </div>
  )
}

function NicheSelect({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        className={`pc-inline-display ${!value ? 'empty' : ''}`}
        onClick={() => setEditing(true)}
        title="Click to set niche"
      >
        {value || 'set'}
      </button>
    )
  }
  return (
    <select
      autoFocus
      className="pc-niche-select"
      value={value || ''}
      onChange={async e => {
        setSaving(true)
        try {
          await onSave(e.target.value || null)
        } finally {
          setSaving(false)
          setEditing(false)
        }
      }}
      onBlur={() => setEditing(false)}
      disabled={saving}
    >
      <option value="">—</option>
      {NICHE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

// ---------- CPM strip ----------

function CpmStrip({ cpms, setCpms }) {
  return (
    <div className="pc-cpm-strip">
      <div className="pc-cpm-strip-label">Default CPMs (£):</div>
      {NICHE_OPTIONS.map(n => (
        <label key={n} className="pc-cpm-cell">
          <span className="pc-cpm-cell-label">{n}</span>
          <input
            type="number"
            min="0"
            step="0.5"
            className="pc-cpm-input"
            value={cpms[n] ?? ''}
            onChange={e => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              setCpms({ ...cpms, [n]: v ?? DEFAULT_CPMS[n] })
            }}
          />
        </label>
      ))}
      <button
        type="button"
        className="pc-cpm-reset"
        onClick={() => setCpms({ ...DEFAULT_CPMS })}
        title="Reset to defaults"
      >Reset</button>
    </div>
  )
}

// ---------- Surge banner ----------

function SurgeBanner({ rows }) {
  const surging = rows
    .filter(isSurging)
    .map(r => ({
      name: r.brand_name_display || r.page_name,
      cur: Number(r.tests_30d || 0),
      prev: Number(r.tests_prev_30d || 0),
      ratio: surgeRatio(r),
    }))
    .sort((a, b) => (b.ratio === Infinity ? 1 : a.ratio === Infinity ? -1 : b.ratio - a.ratio))
    .slice(0, 6)

  if (!surging.length) return null

  return (
    <div className="pc-surge">
      <div className="pc-surge-icon">📈</div>
      <div className="pc-surge-body">
        <div className="pc-surge-title">
          {surging.length} {surging.length === 1 ? 'brand' : 'brands'} ramped testing 2x+ in the last 30 days
        </div>
        <div className="pc-surge-list">
          {surging.map(s => (
            <span key={s.name} className="pc-surge-chip">
              <strong>{s.name}</strong>{' '}
              <span className="pc-surge-chip-num">
                {s.prev} → {s.cur}
                {s.ratio !== Infinity && ` (${(((s.cur - s.prev) / s.prev) * 100).toFixed(0)}%)`}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- Big picture ----------

function median(values) {
  const vs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (!vs.length) return null
  const mid = Math.floor(vs.length / 2)
  return vs.length % 2 === 0 ? (vs[mid - 1] + vs[mid]) / 2 : vs[mid]
}

function BigPicturePanel({ rows, ourRevenue, setOurRevenue }) {
  const stats = useMemo(() => {
    const t30 = rows.map(r => Number(r.tests_30d || 0)).filter(v => v > 0)
    const annual = rows.map(annualisedTests).filter(v => v && v > 0)
    const ppm = rows
      .filter(r => r.annual_revenue_estimate && annualisedTests(r))
      .map(r => annualisedTests(r) / (Number(r.annual_revenue_estimate) / 1_000_000))
    const active = rows.map(r => Number(r.active_tests || 0)).filter(v => v > 0)
    const kill = rows.map(killRate90d).filter(v => v !== null)
    return {
      medianPerWeek: median(t30) ? median(t30) / 30 * 7 : null,
      maxPerWeek: t30.length ? Math.max(...t30) / 30 * 7 : null,
      medianAnnual: median(annual),
      medianTestsPerMillion: median(ppm),
      medianActive: median(active),
      medianKill: median(kill),
    }
  }, [rows])

  const targetPerWeek = useMemo(() => {
    if (!stats.medianTestsPerMillion || !ourRevenue) return null
    const millions = Number(ourRevenue) / 1_000_000
    if (!Number.isFinite(millions) || millions <= 0) return null
    return (stats.medianTestsPerMillion * millions) / 52
  }, [stats.medianTestsPerMillion, ourRevenue])

  return (
    <div className="pc-bigpic">
      <div className="pc-bigpic-grid">
        <div className="pc-stat">
          <div className="pc-stat-label">Median tester</div>
          <div className="pc-stat-value">{fmtNumber(stats.medianPerWeek, 1)}</div>
          <div className="pc-stat-sub">tests / week (last 30d)</div>
        </div>
        <div className="pc-stat">
          <div className="pc-stat-label">Top tester</div>
          <div className="pc-stat-value">{fmtNumber(stats.maxPerWeek, 1)}</div>
          <div className="pc-stat-sub">tests / week</div>
        </div>
        <div className="pc-stat">
          <div className="pc-stat-label">Median library</div>
          <div className="pc-stat-value">{fmtNumber(stats.medianActive)}</div>
          <div className="pc-stat-sub">live ads</div>
        </div>
        <div className="pc-stat">
          <div className="pc-stat-label">Median kill rate</div>
          <div className="pc-stat-value">{fmtPercent(stats.medianKill, 0)}</div>
          <div className="pc-stat-sub">90d ads killed</div>
        </div>
        <div className="pc-stat">
          <div className="pc-stat-label">Tests / £1m</div>
          <div className="pc-stat-value">{fmtRatio(stats.medianTestsPerMillion)}</div>
          <div className="pc-stat-sub">median across field</div>
        </div>
      </div>

      <div className="pc-target">
        <div className="pc-target-title">Velocity required to compete</div>
        <div className="pc-target-sub">
          Enter Chefly's annual revenue (or a target) to see what testing cadence the
          median competitor would imply at your scale. Requires at least one
          competitor with revenue saved.
        </div>
        <div className="pc-target-row">
          <label className="pc-target-label">Our revenue (£):</label>
          <input
            type="text"
            className="pc-target-input"
            value={ourRevenue}
            onChange={e => setOurRevenue(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 2000000"
          />
          <div className="pc-target-result">
            {targetPerWeek ? (
              <>
                <span className="pc-target-num">{fmtNumber(targetPerWeek, 1)}</span>
                <span className="pc-target-unit">tests / week</span>
                <span className="pc-target-extra">
                  ({fmtNumber(targetPerWeek * 4.33, 0)} / month, {fmtNumber(targetPerWeek * 52)} / year)
                </span>
              </>
            ) : (
              <span className="pc-target-empty">Add revenue to a competitor to compute.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Table ----------

const SORT_KEYS = {
  brand: r => (r.brand_name_display || r.page_name || '').toLowerCase(),
  tests_30d: r => Number(r.tests_30d || 0),
  tests_7d: r => Number(r.tests_7d || 0),
  active_ads: r => Number(r.active_ads || 0),
  active_tests: r => Number(r.active_tests || 0),
  surge: r => {
    const x = surgeRatio(r)
    return x === null ? -Infinity : (Number.isFinite(x) ? x : 9999)
  },
  kill: r => killRate90d(r) ?? -Infinity,
  median_days_active: r => Number(r.median_days_active || 0),
  annualised: r => annualisedTests(r) ?? -Infinity,
  revenue: r => Number(r.annual_revenue_estimate || 0) || -Infinity,
  tests_per_million: r => {
    const a = annualisedTests(r)
    const rev = Number(r.annual_revenue_estimate || 0)
    return a && rev ? a / (rev / 1_000_000) : -Infinity
  },
  freshness: r => r.latest_start_date ? new Date(r.latest_start_date).getTime() : -Infinity,
  intensity: r => {
    const tier = intensityTier(r).key
    return ['dark', 'light', 'mid', 'heavy', 'whale'].indexOf(tier)
  },
}

function CadenceTable({ rows, cpms, showSpend, onAccountUpdated }) {
  const [sortKey, setSortKey] = useState('tests_30d')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    const cp = [...rows]
    const accessor = SORT_KEYS[sortKey] || (() => 0)
    cp.sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
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

  const Header = ({ k, label, align = 'right' }) => (
    <th className={`pc-th pc-th-${align}`}>
      <button
        type="button"
        className={`pc-th-btn ${sortKey === k ? 'active' : ''}`}
        onClick={() => {
          if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          else { setSortKey(k); setSortDir('desc') }
        }}
      >
        {label}{sortKey === k && <span className="pc-th-dir">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  )

  const handleSave = useCallback(async (row, patch) => {
    const merged = {
      page_name_display: row.page_name,
      page_id: row.page_id,
      annual_revenue_estimate: row.annual_revenue_estimate,
      revenue_currency: row.revenue_currency || 'GBP',
      niche: row.niche,
      cpm_override: row.cpm_override,
      ...patch,
    }
    const saved = await savePaidBrandMeta(merged)
    onAccountUpdated(row.page_name, saved)
  }, [onAccountUpdated])

  return (
    <div className="pc-table-wrap">
      <table className="pc-table">
        <thead>
          <tr>
            <Header k="brand" label="Brand" align="left" />
            <Header k="intensity" label="Intensity" align="left" />
            <Header k="tests_30d" label="Tests / 30d" />
            <Header k="tests_7d" label="Tests / 7d" />
            <Header k="surge" label="vs prev 30d" />
            <Header k="active_tests" label="Active tests" />
            <Header k="active_ads" label="Active ads" />
            <Header k="kill" label="Kill rate (90d)" />
            <Header k="median_days_active" label="Median days live" />
            <th className="pc-th pc-th-left">Format mix (90d)</th>
            <Header k="annualised" label="Tests / yr" />
            <th className="pc-th pc-th-left">Niche</th>
            <Header k="revenue" label="Revenue" />
            <Header k="tests_per_million" label="Tests / £1m" />
            <Header k="freshness" label="Last seen" />
            <th className="pc-th pc-th-left">Links</th>
            {showSpend && <th className="pc-th">Est. spend / mo</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const tier = intensityTier(row)
            const surge = surgeRatio(row)
            const kill = killRate90d(row)
            const surging = isSurging(row)
            const stale = daysSince(row.latest_start_date)
            const spend = showSpend ? spendBand(row, cpms) : null
            return (
              <tr key={row.page_name} className={surging ? 'pc-row-surging' : ''}>
                <td className="pc-td pc-td-left">
                  <div className="pc-brand-name">{row.brand_name_display || row.page_name}</div>
                  {row.__is_creator && row.__parent_brand && (
                    <div className="pc-brand-via" title={`Shares page_id ${row.page_id} with ${row.__parent_brand} - likely a UGC creator or affiliated brand`}>
                      via <strong>{row.__parent_brand}</strong>
                    </div>
                  )}
                  <div className="pc-brand-meta">
                    {fmtNumber(row.total_ads)} ads tracked · {fmtNumber(row.total_tests)} tests
                  </div>
                </td>
                <td className="pc-td pc-td-left">
                  <span className={`pc-tier pc-tier-${tier.key}`} title={tier.desc}>{tier.label}</span>
                </td>
                <td className="pc-td">{fmtNumber(row.tests_30d)}</td>
                <td className="pc-td">{fmtNumber(row.tests_7d)}</td>
                <td className="pc-td">
                  {surge === null ? '—' :
                    !Number.isFinite(surge) ? <span className="pc-up">new</span> :
                    surge >= SURGE_RATIO ? <span className="pc-up">+{((surge - 1) * 100).toFixed(0)}%</span> :
                    surge >= 1 ? `+${((surge - 1) * 100).toFixed(0)}%` :
                    <span className="pc-down">{((surge - 1) * 100).toFixed(0)}%</span>}
                </td>
                <td className="pc-td">{fmtNumber(row.active_tests)}</td>
                <td className="pc-td">{fmtNumber(row.active_ads)}</td>
                <td className="pc-td">
                  {kill === null ? '—' :
                    <span className={kill >= 0.7 ? 'pc-kill-high' : kill >= 0.4 ? 'pc-kill-mid' : ''}>
                      {fmtPercent(kill, 0)}
                    </span>}
                </td>
                <td className="pc-td">
                  {row.median_days_active ? `${Number(row.median_days_active).toFixed(0)}d` : '—'}
                </td>
                <td className="pc-td pc-td-left pc-td-mix">
                  <FormatMix row={row} />
                </td>
                <td className="pc-td">{fmtNumber(annualisedTests(row))}</td>
                <td className="pc-td pc-td-left">
                  <NicheSelect
                    value={row.niche}
                    onSave={v => handleSave(row, { niche: v })}
                  />
                </td>
                <td className="pc-td">
                  <InlineEdit
                    value={row.annual_revenue_estimate}
                    type="number"
                    placeholder="e.g. 5000000"
                    display={row.annual_revenue_estimate
                      ? fmtCurrency(row.annual_revenue_estimate, row.revenue_currency)
                      : 'add'}
                    onSave={v => handleSave(row, { annual_revenue_estimate: v })}
                  />
                </td>
                <td className="pc-td pc-td-strong">
                  {fmtRatio(SORT_KEYS.tests_per_million(row) === -Infinity
                    ? null
                    : SORT_KEYS.tests_per_million(row))}
                </td>
                <td className="pc-td">
                  {stale === null ? '—' :
                    <span className={stale > 14 ? 'pc-stale' : ''}>{stale}d ago</span>}
                </td>
                <td className="pc-td pc-td-left pc-td-links">
                  {row.page_id && (
                    <a
                      className="pc-link"
                      href={metaAdLibraryUrl(row.page_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View live ads on Meta Ad Library"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
                      Library
                    </a>
                  )}
                  {row.most_common_link_url && (
                    <a
                      className="pc-link"
                      href={row.most_common_link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Top destination URL: ${row.most_common_link_url}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      {prettyHost(row.most_common_link_url)}
                    </a>
                  )}
                </td>
                {showSpend && (
                  <td className="pc-td">
                    {spend && spend.midpoint
                      ? `${fmtCurrency(spend.lower)} - ${fmtCurrency(spend.upper)}`
                      : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Top-level ----------

export default function PaidCadence() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [intensityFilter, setIntensityFilter] = useState('all')
  const [showSpend, setShowSpend] = useState(false)
  const [hideCreators, setHideCreators] = useState(false)
  const [cpms, setCpms] = useState(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_CPMS }
    try {
      const raw = window.localStorage?.getItem(CPM_KEY)
      return raw ? { ...DEFAULT_CPMS, ...JSON.parse(raw) } : { ...DEFAULT_CPMS }
    } catch { return { ...DEFAULT_CPMS } }
  })
  const [ourRevenue, setOurRevenue] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage?.getItem(OUR_REVENUE_KEY) || ''
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(CPM_KEY, JSON.stringify(cpms))
  }, [cpms])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(OUR_REVENUE_KEY, ourRevenue)
  }, [ourRevenue])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadStats()
      setRows(annotateParents(data || []))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  // Inline-edit upsert merges the saved meta row back into the cached rows
  // so the table re-renders without a full RPC round trip.
  const onAccountUpdated = useCallback((pageName, saved) => {
    if (!saved) return
    setRows(prev => annotateParents(prev.map(r => r.page_name === pageName
      ? {
          ...r,
          meta_id: saved.id,
          annual_revenue_estimate: saved.annual_revenue_estimate,
          revenue_currency: saved.revenue_currency,
          niche: saved.niche,
          cpm_override: saved.cpm_override,
        }
      : r
    )))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !(r.brand_name_display || r.page_name || '').toLowerCase().includes(q)) return false
      if (intensityFilter !== 'all' && intensityTier(r).key !== intensityFilter) return false
      if (hideCreators && r.__is_creator) return false
      return true
    })
  }, [rows, search, intensityFilter, hideCreators])

  // Cap at brands with at least 1 test in the last 90 days OR at least 5
  // active ads. Otherwise the table fills up with stale brands.
  const meaningful = useMemo(() => filtered.filter(r =>
    Number(r.tests_90d || 0) > 0 || Number(r.active_ads || 0) >= 5
  ), [filtered])

  return (
    <div className="pc-root">
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Paid Cadence &amp; Velocity</h2>
          <div className="pc-subtitle">
            How aggressively each brand tests on Meta. Tests dedupe DCO/Carousel cards
            (card_index = 0). Active library counts every variation.
            Data refreshed when the Foreplay sync runs.
          </div>
        </div>
        <div className="pc-controls">
          <input
            type="search"
            className="pc-search"
            placeholder="Search brand..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="pc-intensity-filter"
            value={intensityFilter}
            onChange={e => setIntensityFilter(e.target.value)}
            title="Filter by test intensity tier"
          >
            <option value="all">All tiers</option>
            <option value="whale">Whale</option>
            <option value="heavy">Heavy</option>
            <option value="mid">Mid</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <label className="pc-toggle">
            <input
              type="checkbox"
              checked={showSpend}
              onChange={e => setShowSpend(e.target.checked)}
            />
            <span>Show spend estimate</span>
          </label>
          <label className="pc-toggle" title="Hide UGC creators / affiliated brands sharing a parent's ad account">
            <input
              type="checkbox"
              checked={hideCreators}
              onChange={e => setHideCreators(e.target.checked)}
            />
            <span>Hide creators</span>
          </label>
          <button type="button" className="pc-refresh" onClick={reload} title="Reload">
            ↻
          </button>
        </div>
      </div>

      <SurgeBanner rows={rows} />

      <BigPicturePanel rows={rows} ourRevenue={ourRevenue} setOurRevenue={setOurRevenue} />

      {showSpend && <CpmStrip cpms={cpms} setCpms={setCpms} />}

      {loading ? (
        <div className="pc-empty">Loading paid cadence…</div>
      ) : error ? (
        <div className="pc-error">{error}</div>
      ) : !meaningful.length ? (
        <div className="pc-empty">No brands match this filter.</div>
      ) : (
        <CadenceTable
          rows={meaningful}
          cpms={cpms}
          showSpend={showSpend}
          onAccountUpdated={onAccountUpdated}
        />
      )}

      <div className="pc-foot">
        <strong>How to read this:</strong> "Tests" deduplicates DCO + Carousel cards
        (one row per card_index = 0). "Active ads" includes every running creative
        variation, so a brand with 30 tests but DCO catalogues will show a much higher
        active count. "Tests / £1m" annualises 90 days of testing and divides by
        revenue. Surge banner highlights brands whose 30d test rate is at least 2x
        the prior 30 days (and at least {SURGE_MIN_TESTS} tests).
        {' '}Spend estimate column reads "—" for most brands because Foreplay rarely
        passes through Meta impressions data outside political ads. The intensity
        tier is a working proxy until that data quality improves.
      </div>
    </div>
  )
}
