import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './OrganicIntel.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// ---------- Formatting helpers ----------

function formatRelativeTime(iso) {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Never'
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
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatNumber(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return null
  const s = Number(seconds)
  if (Number.isNaN(s) || s <= 0) return null
  if (s < 60) return `${Math.round(s)}s`
  const mins = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${mins}:${String(rem).padStart(2, '0')}`
}

function statusLabel(status) {
  if (!status) return 'Never fetched'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// ---------- Data hooks ----------

async function fetchTable(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: fnHeaders })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PostgREST ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function callRpc(fn, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: fnHeaders,
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RPC ${fn} ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ---------- List view ----------

function AccountCard({ account, latestLog, postCount, onOpen }) {
  const platformChip = account.platform === 'youtube' ? 'oi-chip-yt' : 'oi-chip-ig'
  const platformLabel = account.platform === 'youtube' ? 'YouTube' : 'Instagram'
  const statusKey = latestLog?.status || (account.last_fetched_at ? 'success' : 'never')

  return (
    <button className="oi-card" onClick={() => onOpen(account)} type="button">
      <div className="oi-card-head">
        <span className={`oi-chip ${platformChip}`}>{platformLabel}</span>
        <span className={`oi-chip oi-chip-status ${statusKey}`}>{statusLabel(latestLog?.status)}</span>
      </div>
      <div>
        <div className="oi-card-handle">@{account.handle}</div>
        <div className="oi-card-brand">{account.brand_name}</div>
      </div>
      <div className="oi-card-meta">
        <div>
          <div className="oi-card-meta-label">Last fetch</div>
          <div className="oi-card-meta-value">{formatRelativeTime(account.last_fetched_at)}</div>
        </div>
        <div>
          <div className="oi-card-meta-label">Posts</div>
          <div className="oi-card-meta-value">{formatNumber(postCount)}</div>
        </div>
      </div>
    </button>
  )
}

function AccountsList({ accounts, logsByAccount, postsByAccount, onOpen }) {
  if (!accounts.length) return <div className="oi-empty">No accounts match this filter.</div>
  return (
    <div className="oi-grid">
      {accounts.map(acc => (
        <AccountCard
          key={acc.id}
          account={acc}
          latestLog={logsByAccount[acc.id]}
          postCount={postsByAccount[acc.id] || 0}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

// ---------- Detail view ----------

function PostCard({ post, metrics }) {
  const hasVideo = !!post.video_url
  const typeLabel = (post.post_type || 'post').replace(/_/g, ' ')
  const duration = formatDuration(post.duration_seconds)
  const caption = post.title || post.caption || ''
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : []

  return (
    <div className="oi-post">
      <div className="oi-thumb-wrap">
        {post.thumbnail_url ? (
          <img className="oi-thumb" src={post.thumbnail_url} alt={caption.slice(0, 80)} loading="lazy" />
        ) : (
          <div className="oi-thumb-missing">No thumbnail</div>
        )}
        <div className="oi-thumb-badges">
          <span className="oi-chip oi-chip-type">{typeLabel}</span>
          {duration && <span className="oi-duration">{duration}</span>}
        </div>
      </div>
      <div className="oi-post-body">
        {caption && <div className="oi-post-caption">{caption}</div>}
        {hashtags.length > 0 && (
          <div>
            {hashtags.slice(0, 4).map(tag => <span key={tag} className="oi-hashtag">#{tag}</span>)}
          </div>
        )}
        <div className="oi-post-posted">{formatDate(post.posted_at)}</div>
        <div className="oi-post-metrics">
          <div className="oi-post-metric">
            <span className="oi-post-metric-label">Views</span>
            <span className="oi-post-metric-value">{formatNumber(metrics?.views)}</span>
          </div>
          <div className="oi-post-metric">
            <span className="oi-post-metric-label">Likes</span>
            <span className="oi-post-metric-value">{formatNumber(metrics?.likes)}</span>
          </div>
          <div className="oi-post-metric">
            <span className="oi-post-metric-label">Comments</span>
            <span className="oi-post-metric-value">{formatNumber(metrics?.comments)}</span>
          </div>
        </div>
      </div>
      <div className="oi-post-links">
        {post.post_url && <a className="oi-post-link" href={post.post_url} target="_blank" rel="noreferrer">View post &rarr;</a>}
        {hasVideo && <a className="oi-post-link" href={post.video_url} target="_blank" rel="noreferrer">Video &rarr;</a>}
      </div>
    </div>
  )
}

function AccountDetail({ account, latestLog, onBack }) {
  const [posts, setPosts] = useState([])
  const [metricsByPost, setMetricsByPost] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const fetchedPosts = await fetchTable(
          `organic_posts?select=*&account_id=eq.${account.id}&order=posted_at.desc&limit=50`
        )
        if (cancelled) return
        setPosts(fetchedPosts)

        if (fetchedPosts.length > 0) {
          const ids = fetchedPosts.map(p => p.id).join(',')
          const allMetrics = await fetchTable(
            `organic_post_metrics?select=post_id,captured_at,views,likes,comments,saves,shares,engagement_rate&post_id=in.(${ids})&order=captured_at.desc`
          )
          if (cancelled) return
          // group by post_id, keep first (latest) due to order
          const latest = {}
          for (const m of allMetrics) {
            if (!latest[m.post_id]) latest[m.post_id] = m
          }
          setMetricsByPost(latest)
        } else {
          setMetricsByPost({})
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [account.id])

  const totals = useMemo(() => {
    let views = 0, likes = 0, comments = 0
    for (const p of posts) {
      const m = metricsByPost[p.id]
      if (m) {
        views += Number(m.views || 0)
        likes += Number(m.likes || 0)
        comments += Number(m.comments || 0)
      }
    }
    return { views, likes, comments, count: posts.length }
  }, [posts, metricsByPost])

  const platformLabel = account.platform === 'youtube' ? 'YouTube' : 'Instagram'
  const platformChip = account.platform === 'youtube' ? 'oi-chip-yt' : 'oi-chip-ig'
  const statusKey = latestLog?.status || (account.last_fetched_at ? 'success' : 'never')

  return (
    <div className="oi-root">
      <button className="oi-back" onClick={onBack} type="button">&larr; All accounts</button>

      <div className="oi-detail-head">
        <div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
            <span className={`oi-chip ${platformChip}`}>{platformLabel}</span>
            <span className={`oi-chip oi-chip-status ${statusKey}`}>{statusLabel(latestLog?.status)}</span>
          </div>
          <h2 className="oi-detail-title">@{account.handle}</h2>
          <div className="oi-detail-brand">{account.brand_name}</div>
          <div className="oi-detail-meta">
            <span>Last fetched {formatRelativeTime(account.last_fetched_at)}</span>
            {latestLog?.posts_fetched != null && <span>{latestLog.posts_fetched} posts in last run</span>}
            {latestLog?.posts_new != null && <span>{latestLog.posts_new} new</span>}
            {latestLog?.cost_estimate != null && <span>Cost ${Number(latestLog.cost_estimate).toFixed(3)}</span>}
            {latestLog?.yt_quota_units != null && <span>{latestLog.yt_quota_units} YT units</span>}
          </div>
        </div>
      </div>

      <div className="oi-stats-bar">
        <div className="oi-stat">
          <div className="oi-stat-label">Posts tracked</div>
          <div className="oi-stat-value">{formatNumber(totals.count)}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-stat-label">Total views</div>
          <div className="oi-stat-value">{formatNumber(totals.views)}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-stat-label">Total likes</div>
          <div className="oi-stat-value">{formatNumber(totals.likes)}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-stat-label">Total comments</div>
          <div className="oi-stat-value">{formatNumber(totals.comments)}</div>
        </div>
      </div>

      {error && <div className="oi-error">{error}</div>}

      {loading ? (
        <div className="oi-empty">Loading posts…</div>
      ) : posts.length === 0 ? (
        <div className="oi-empty">No posts fetched for this account yet.</div>
      ) : (
        <div className="oi-posts-grid">
          {posts.map(p => (
            <PostCard key={p.id} post={p} metrics={metricsByPost[p.id]} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Top-level component ----------

export default function OrganicIntel() {
  const [accounts, setAccounts] = useState([])
  const [logsByAccount, setLogsByAccount] = useState({})
  const [postsByAccount, setPostsByAccount] = useState({})
  const [runsSummary, setRunsSummary] = useState({ ig: null, yt: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [selectedAccount, setSelectedAccount] = useState(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      // Phase 3b: single RPC returns account + latest log + post count.
      // Replaces the Phase 3a client-side grouping of 500 logs + 5000 post ids.
      // Phase 3c: parallel call for the last-7-days observability strip.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [rows, summaryRows] = await Promise.all([
        callRpc('list_organic_accounts_with_stats', {
          p_platform: null,
          p_active_only: true,
        }),
        callRpc('list_fetch_runs_summary', { p_since: since }).catch(() => []),
      ])

      const accountsRes = []
      const latestByAccount = {}
      const counts = {}

      for (const r of rows) {
        accountsRes.push({
          id: r.id,
          brand_name: r.brand_name,
          platform: r.platform,
          handle: r.handle,
          platform_account_id: r.platform_account_id,
          uploads_playlist_id: r.uploads_playlist_id,
          is_active: r.is_active,
          fetch_frequency: r.fetch_frequency,
          last_fetched_at: r.last_fetched_at,
          created_at: r.created_at,
        })
        counts[r.id] = Number(r.post_count) || 0
        if (r.latest_log_id) {
          latestByAccount[r.id] = {
            account_id: r.id,
            started_at: r.latest_started_at,
            finished_at: r.latest_finished_at,
            posts_fetched: r.latest_posts_fetched,
            posts_new: r.latest_posts_new,
            cost_estimate: r.latest_cost_estimate,
            yt_quota_units: r.latest_yt_quota_units,
            status: r.latest_status,
            error_message: r.latest_error_message,
          }
        }
      }

      setAccounts(accountsRes)
      setLogsByAccount(latestByAccount)
      setPostsByAccount(counts)

      // Aggregate the daily rows into per-platform totals for the strip.
      const emptyRoll = { runs: 0, successes: 0, errors: 0, posts_new: 0, cost_estimate: 0, yt_quota_units: 0 }
      const byPlatform = { instagram: null, youtube: null }
      for (const row of summaryRows || []) {
        const p = row.platform
        if (p !== 'instagram' && p !== 'youtube') continue
        if (!byPlatform[p]) byPlatform[p] = { ...emptyRoll }
        byPlatform[p].runs += Number(row.runs) || 0
        byPlatform[p].successes += Number(row.successes) || 0
        byPlatform[p].errors += Number(row.errors) || 0
        byPlatform[p].posts_new += Number(row.posts_new) || 0
        byPlatform[p].cost_estimate += Number(row.cost_estimate) || 0
        byPlatform[p].yt_quota_units += Number(row.yt_quota_units) || 0
      }
      setRunsSummary({ ig: byPlatform.instagram, yt: byPlatform.youtube })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const filtered = useMemo(() => {
    if (platformFilter === 'all') return accounts
    return accounts.filter(a => a.platform === platformFilter)
  }, [accounts, platformFilter])

  const summary = useMemo(() => {
    const totalPosts = Object.values(postsByAccount).reduce((s, n) => s + n, 0)
    const ig = accounts.filter(a => a.platform === 'instagram').length
    const yt = accounts.filter(a => a.platform === 'youtube').length
    const fetched = accounts.filter(a => a.last_fetched_at).length
    return { totalPosts, ig, yt, fetched, total: accounts.length }
  }, [accounts, postsByAccount])

  if (selectedAccount) {
    return (
      <AccountDetail
        account={selectedAccount}
        latestLog={logsByAccount[selectedAccount.id]}
        onBack={() => setSelectedAccount(null)}
      />
    )
  }

  return (
    <div className="oi-root">
      <div className="oi-header">
        <div>
          <h2 className="oi-title">Organic Intelligence</h2>
          <div className="oi-subtitle">Instagram &amp; YouTube accounts we track. Daily fetches write to organic_posts + metrics.</div>
        </div>
        <div className="oi-filters">
          <button
            type="button"
            className={`oi-filter-btn ${platformFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('all')}
          >All ({summary.total})</button>
          <button
            type="button"
            className={`oi-filter-btn ${platformFilter === 'instagram' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('instagram')}
          >Instagram ({summary.ig})</button>
          <button
            type="button"
            className={`oi-filter-btn ${platformFilter === 'youtube' ? 'active' : ''}`}
            onClick={() => setPlatformFilter('youtube')}
          >YouTube ({summary.yt})</button>
          <button type="button" className="oi-filter-btn" onClick={loadAll} title="Refresh">&#x21bb;</button>
        </div>
      </div>

      <div className="oi-stats-bar">
        <div className="oi-stat">
          <div className="oi-stat-label">Accounts</div>
          <div className="oi-stat-value">{summary.total}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-stat-label">Fetched at least once</div>
          <div className="oi-stat-value">{summary.fetched} / {summary.total}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-stat-label">Posts tracked</div>
          <div className="oi-stat-value">{formatNumber(summary.totalPosts)}</div>
        </div>
      </div>

      {(runsSummary.ig || runsSummary.yt) && (
        <div className="oi-runs-strip">
          <div className="oi-runs-strip-label">Last 7 days</div>
          {runsSummary.ig && (
            <div className="oi-runs-chip">
              <span className="oi-chip oi-chip-ig">IG</span>
              <span>{runsSummary.ig.runs} runs</span>
              <span>{runsSummary.ig.successes} ok</span>
              {runsSummary.ig.errors > 0 && <span className="oi-runs-chip-err">{runsSummary.ig.errors} err</span>}
              <span>+{formatNumber(runsSummary.ig.posts_new)} new</span>
              <span>${Number(runsSummary.ig.cost_estimate || 0).toFixed(2)}</span>
            </div>
          )}
          {runsSummary.yt && (
            <div className="oi-runs-chip">
              <span className="oi-chip oi-chip-yt">YT</span>
              <span>{runsSummary.yt.runs} runs</span>
              <span>{runsSummary.yt.successes} ok</span>
              {runsSummary.yt.errors > 0 && <span className="oi-runs-chip-err">{runsSummary.yt.errors} err</span>}
              <span>+{formatNumber(runsSummary.yt.posts_new)} new</span>
              <span>{runsSummary.yt.yt_quota_units} units</span>
            </div>
          )}
        </div>
      )}

      {error && <div className="oi-error">{error}</div>}

      {loading ? (
        <div className="oi-empty">Loading accounts…</div>
      ) : (
        <AccountsList
          accounts={filtered}
          logsByAccount={logsByAccount}
          postsByAccount={postsByAccount}
          onOpen={setSelectedAccount}
        />
      )}
    </div>
  )
}
