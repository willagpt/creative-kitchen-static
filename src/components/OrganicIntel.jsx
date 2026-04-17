import { useEffect, useMemo, useState } from 'react'
import { supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import './OrganicIntel.css'

const fnHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
}

// Bulk-analyse concurrency cap (keeps Railway worker + edge functions comfortable).
const BULK_CONCURRENCY = 3

// Hosts known to hotlink-block with short-lived signed tokens (oh=... signatures
// cross-checked against caller IP + UA). For these we route the request through
// our server-side proxy-thumbnail edge function.
const HOTLINK_BLOCKED_HOST_RE = /(?:^|\.)(cdninstagram\.com|fbcdn\.net)$/i

function buildProxyThumbUrl(rawUrl) {
  if (!rawUrl) return null
  try {
    const host = new URL(rawUrl).hostname
    if (!HOTLINK_BLOCKED_HOST_RE.test(host)) return rawUrl
    const qs = new URLSearchParams({ url: rawUrl })
    return `${supabaseUrl}/functions/v1/proxy-thumbnail?${qs}`
  } catch {
    return rawUrl
  }
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

function isVideoPost(post) {
  if (!post?.video_url) return false
  const t = (post.post_type || '').toLowerCase()
  return t === 'reel' || t === 'short' || t === 'video'
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

// ---------- Post card ----------

function PostCard({
  post,
  metrics,
  analysisInfo,
  firstFrameUrl,
  onAnalyse,
  analysing,
  bulkState, // null | 'queued' | 'running' | 'done' | 'error'
  selected,
  selectable,
  onToggleSelect,
}) {
  const hasVideo = !!post.video_url
  const typeLabel = (post.post_type || 'post').replace(/_/g, ' ')
  const duration = formatDuration(post.duration_seconds)
  const caption = post.title || post.caption || ''
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : []
  const analysable = isVideoPost(post)
  const alreadyAnalysed = !!analysisInfo

  // Thumbnail fallback chain (robust against IG/FB hotlink blocks):
  // 1. Supabase-hosted first video frame (only for analysed videos) — rock solid.
  // 2. post.thumbnail_cached_url — our on-ingest snapshot in the organic-thumbs bucket.
  // 3. Raw thumbnail_url, routed through the proxy-thumbnail edge function when the
  //    host is a known hotlink-blocked CDN. YouTube i.ytimg.com passes through as-is.
  // 4. onError → hide <img>, show placeholder.
  const primaryThumb =
    firstFrameUrl ||
    post.thumbnail_cached_url ||
    buildProxyThumbUrl(post.thumbnail_url) ||
    null

  const bulkBadge = bulkState === 'queued'
    ? 'Queued'
    : bulkState === 'running'
      ? 'Analysing…'
      : bulkState === 'done'
        ? 'Done'
        : bulkState === 'error'
          ? 'Error'
          : null

  return (
    <div className={`oi-post ${selected ? 'oi-post-selected' : ''}`}>
      <div className="oi-thumb-wrap">
        {primaryThumb ? (
          <>
            <img
              className="oi-thumb"
              src={primaryThumb}
              alt={caption.slice(0, 80)}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const sibling = e.currentTarget.nextElementSibling
                if (sibling) sibling.style.display = 'flex'
              }}
            />
            <div className="oi-thumb-missing" style={{ display: 'none' }}>
              Preview unavailable
            </div>
          </>
        ) : (
          <div className="oi-thumb-missing">No thumbnail</div>
        )}
        <div className="oi-thumb-badges">
          <span className="oi-chip oi-chip-type">{typeLabel}</span>
          {duration && <span className="oi-duration">{duration}</span>}
          {alreadyAnalysed && <span className="oi-chip oi-chip-analysed">Analysed</span>}
          {bulkBadge && <span className={`oi-chip oi-chip-bulk oi-chip-bulk-${bulkState}`}>{bulkBadge}</span>}
        </div>
        {selectable && (
          <label
            className={`oi-select-box ${selected ? 'checked' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect && onToggleSelect(post.id)}
              aria-label="Select for bulk analyse"
            />
            <span />
          </label>
        )}
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
        {analysable && !alreadyAnalysed && (
          <button
            type="button"
            className="oi-post-analyse"
            disabled={analysing}
            onClick={() => onAnalyse && onAnalyse(post)}
          >
            {analysing ? 'Analysing…' : 'Analyse video'}
          </button>
        )}
        {alreadyAnalysed && (
          <span className="oi-post-analysed-label">Analysis ready</span>
        )}
      </div>
    </div>
  )
}

// ---------- Detail view ----------

function AccountDetail({ account, latestLog, onBack }) {
  const [posts, setPosts] = useState([])
  const [metricsByPost, setMetricsByPost] = useState({})
  const [analysesByPostId, setAnalysesByPostId] = useState({})
  const [firstFrameByPostId, setFirstFrameByPostId] = useState({})
  const [analysingIds, setAnalysingIds] = useState(() => new Set())
  const [analyseError, setAnalyseError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Bulk selection + bulk run state.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkStatus, setBulkStatus] = useState({}) // post_id -> 'queued' | 'running' | 'done' | 'error'
  const [bulkMessage, setBulkMessage] = useState(null)
  // Percentile selector — "Top N% by views" quick pick over the eligible set.
  const [percentile, setPercentile] = useState(null) // null | 2.5 | 5 | 10 | 20
  // When true, the grid only renders selected posts. Automatically turns on
  // when a percentile pill is active so the user can see exactly what was
  // picked. Can be toggled manually off/on from the bulk bar.
  const [onlySelected, setOnlySelected] = useState(false)

  async function refreshAnalysesForPosts(postIds) {
    if (!postIds || postIds.length === 0) {
      setAnalysesByPostId({})
      setFirstFrameByPostId({})
      return
    }
    try {
      const idList = postIds.map(id => `"${id}"`).join(',')
      const rows = await fetchTable(
        `video_analyses?source=eq.organic_post&source_id=in.(${idList})&status=in.(processing,complete)&select=id,source_id,status`
      )
      const map = {}
      for (const r of rows) {
        if (!map[r.source_id]) map[r.source_id] = r
      }
      setAnalysesByPostId(map)

      // Pull first-frame URL (shot_number=1) from video_shots for each analysed post.
      // Supabase-hosted URLs bypass Instagram/FB hotlink blocks so we prefer them over post.thumbnail_url.
      const analysisIds = Object.values(map).map(a => `"${a.id}"`)
      if (analysisIds.length > 0) {
        try {
          const shots = await fetchTable(
            `video_shots?video_analysis_id=in.(${analysisIds.join(',')})&shot_number=eq.1&select=video_analysis_id,frame_url`
          )
          const frameByAnalysis = {}
          for (const s of shots) {
            if (s.frame_url) frameByAnalysis[s.video_analysis_id] = s.frame_url
          }
          const frameByPost = {}
          for (const [postId, analysis] of Object.entries(map)) {
            const fu = frameByAnalysis[analysis.id]
            if (fu) frameByPost[postId] = fu
          }
          setFirstFrameByPostId(frameByPost)
        } catch (e) {
          console.warn('Could not load first-frame urls:', e)
          setFirstFrameByPostId({})
        }
      } else {
        setFirstFrameByPostId({})
      }
    } catch (e) {
      console.warn('Could not load existing analyses:', e)
    }
  }

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
          const latest = {}
          for (const m of allMetrics) {
            if (!latest[m.post_id]) latest[m.post_id] = m
          }
          setMetricsByPost(latest)
          await refreshAnalysesForPosts(fetchedPosts.map(p => p.id))
        } else {
          setMetricsByPost({})
          setAnalysesByPostId({})
          setFirstFrameByPostId({})
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

  // Phase 2+3 pipeline: transcribe → OCR → merge → AI analysis.
  // Each step reads video_shots/video_analyses directly; we just kick them
  // off in sequence from the frontend so the Railway worker and edge
  // functions stay decoupled.
  //
  // transcribe-video and ocr-video-frames both have observability columns
  // on video_analyses (`transcript_status`, `ocr_status`) so partial/error
  // states surface in the UI without needing to retry here. We still do
  // up to 2 client-side retries on transient HTTP (429, 5xx, network drop)
  // because the edge function writes its status column AFTER it succeeds,
  // so a gateway blip before that write leaves the row in pending — retrying
  // the edge function in that case is safe and idempotent.
  async function runPipelineSteps(analysisId) {
    if (!analysisId) return
    const steps = [
      { name: 'transcribe-video', retries: 2, retryDelayMs: 2000 },
      { name: 'ocr-video-frames', retries: 2, retryDelayMs: 2000 },
      { name: 'merge-video-script', retries: 0, retryDelayMs: 0 },
      { name: 'ai-analyse-video', retries: 0, retryDelayMs: 0 },
    ]
    for (const step of steps) {
      let finalResp = null
      let finalErr = null
      for (let attempt = 1; attempt <= step.retries + 1; attempt++) {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/${step.name}`, {
            method: 'POST',
            headers: fnHeaders,
            body: JSON.stringify({ analysis_id: analysisId }),
          })
          finalResp = r
          if (r.ok) {
            // Log the observability fields each step exposes so the bulk
            // worker's progress is debuggable from the console.
            try {
              const body = await r.clone().json()
              if (step.name === 'transcribe-video') {
                const cov = typeof body.coverage === 'number' ? body.coverage.toFixed(2) : 'n/a'
                console.log(
                  `[organic pipeline] transcribe-video ok: status=${body.transcript_status}, ` +
                  `attempts=${body.attempts}, coverage=${cov}, chars=${body.char_count}`,
                )
              } else if (step.name === 'ocr-video-frames') {
                const cov = typeof body.coverage === 'number' ? body.coverage.toFixed(2) : 'n/a'
                const batchErrs = Array.isArray(body.batch_errors) ? body.batch_errors.length : 0
                console.log(
                  `[organic pipeline] ocr-video-frames ok: status=${body.ocr_status}, ` +
                  `shots=${body.shots_updated}/${body.shots_processed}, ` +
                  `coverage=${cov}, batch_errors=${batchErrs}/${body.total_batches}`,
                )
              } else {
                console.log(`[organic pipeline] ${step.name} ok`)
              }
            } catch {
              // Body parse is best-effort; don't fail the pipeline on shape drift.
            }
            break
          }
          const retryable = r.status === 429 || r.status >= 500
          console.warn(
            `[organic pipeline] ${step.name} attempt ${attempt}/${step.retries + 1} returned ${r.status} ` +
            `(retryable=${retryable})`,
          )
          if (!retryable || attempt > step.retries) break
        } catch (e) {
          finalErr = e
          console.warn(
            `[organic pipeline] ${step.name} attempt ${attempt}/${step.retries + 1} threw:`,
            e,
          )
          if (attempt > step.retries) break
        }
        if (step.retryDelayMs) {
          await new Promise((res) => setTimeout(res, step.retryDelayMs))
        }
      }
      if (finalErr || (finalResp && !finalResp.ok)) {
        const statusLabel = finalErr ? 'threw' : `${finalResp.status}`
        console.warn(
          `[organic pipeline] ${step.name} gave up after retries (${statusLabel}) for ${analysisId}`,
        )
      }
    }
  }

  // analyseOne now drives the full pipeline: Phase 1 (shots, contact sheet
  // via analyse-video → Railway worker) then Phase 2+3 (transcript, OCR,
  // merged script, AI analysis). Returns the analysis id so callers can
  // surface it if needed. 409 "already exists" is treated as success and
  // the pipeline is still re-run for that analysis, which is idempotent
  // because transcribe-video / ocr-video-frames dedup against their status
  // columns.
  async function analyseOne(post) {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/analyse-video`,
      {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({ source: 'organic_post', source_id: post.id }),
      }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok && res.status !== 409) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const analysisId = data.analysis_id || data.existing_analysis_id || null
    // Phase 2+3: drive transcript / OCR / merge / AI from the frontend.
    if (analysisId) {
      try {
        await runPipelineSteps(analysisId)
      } catch (e) {
        console.warn(`[organic pipeline] top-level failure for ${analysisId}:`, e)
      }
    }
    return { ...data, analysis_id: analysisId }
  }

  async function handleAnalyse(post) {
    if (!post?.id) return
    setAnalyseError(null)
    setAnalysingIds(prev => {
      const next = new Set(prev)
      next.add(post.id)
      return next
    })
    try {
      await analyseOne(post)
      await refreshAnalysesForPosts(posts.map(p => p.id))
    } catch (e) {
      setAnalyseError(`Could not analyse: ${e.message}`)
    } finally {
      setAnalysingIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  // --- Bulk selection handlers ---

  const selectablePosts = useMemo(
    () => posts.filter(p => isVideoPost(p) && !analysesByPostId[p.id]),
    [posts, analysesByPostId]
  )

  function toggleSelect(postId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function selectAllEligible() {
    setSelectedIds(new Set(selectablePosts.map(p => p.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setPercentile(null)
    setOnlySelected(false)
  }

  // Rank the eligible pool by latest views desc, take ceil(N * pct/100).
  // Falls back to 0 for posts with no metrics yet — they sort last, fine.
  function selectTopPercentile(pct) {
    if (!pct || selectablePosts.length === 0) {
      setPercentile(null)
      setSelectedIds(new Set())
      return
    }
    const sorted = [...selectablePosts].sort((a, b) => {
      const av = Number(metricsByPost[a.id]?.views || 0)
      const bv = Number(metricsByPost[b.id]?.views || 0)
      return bv - av
    })
    const n = Math.max(1, Math.ceil(selectablePosts.length * (pct / 100)))
    const slice = sorted.slice(0, n)
    setSelectedIds(new Set(slice.map(p => p.id)))
    setPercentile(pct)
    // Picking a percentile is useless if the user can't see which posts
    // were picked. Default the grid to "only selected" so the user has
    // immediate visual confirmation of the slice.
    setOnlySelected(true)
  }

  async function runBulkAnalyse() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || bulkRunning) return
    const postsById = Object.fromEntries(posts.map(p => [p.id, p]))
    const queue = ids.map(id => postsById[id]).filter(Boolean).filter(p => !analysesByPostId[p.id])
    if (queue.length === 0) {
      setBulkMessage('All selected posts are already analysed.')
      return
    }

    setBulkRunning(true)
    setBulkMessage(null)
    const initial = {}
    for (const p of queue) initial[p.id] = 'queued'
    setBulkStatus(initial)

    // Concurrency-limited runner.
    let cursor = 0
    let succeeded = 0
    let failed = 0
    async function worker() {
      while (cursor < queue.length) {
        const idx = cursor++
        const p = queue[idx]
        setBulkStatus(prev => ({ ...prev, [p.id]: 'running' }))
        try {
          await analyseOne(p)
          succeeded++
          setBulkStatus(prev => ({ ...prev, [p.id]: 'done' }))
        } catch (e) {
          failed++
          setBulkStatus(prev => ({ ...prev, [p.id]: 'error' }))
          console.warn('Bulk analyse failure for', p.id, e)
        }
      }
    }
    const workers = Array.from({ length: Math.min(BULK_CONCURRENCY, queue.length) }, () => worker())
    await Promise.all(workers)

    await refreshAnalysesForPosts(posts.map(p => p.id))
    setBulkRunning(false)
    setBulkMessage(`Bulk analyse finished: ${succeeded} queued, ${failed} error${failed === 1 ? '' : 's'}.`)
    setSelectedIds(new Set())
  }

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

  // What actually renders in the grid. Two overlays on top of the raw
  // chronological list:
  //   1. If a percentile is active OR the user has flipped "Only selected",
  //      we show only the selected post ids.
  //   2. Regardless of (1), if a percentile is active we sort views desc so
  //      the #1 performer is at the top of the grid (matches the ranking
  //      used to pick the slice).
  const displayPosts = useMemo(() => {
    let list = posts
    if (onlySelected && selectedIds.size > 0) {
      list = list.filter(p => selectedIds.has(p.id))
    }
    if (percentile) {
      list = [...list].sort((a, b) => {
        const av = Number(metricsByPost[a.id]?.views || 0)
        const bv = Number(metricsByPost[b.id]?.views || 0)
        return bv - av
      })
    }
    return list
  }, [posts, selectedIds, onlySelected, percentile, metricsByPost])

  const platformLabel = account.platform === 'youtube' ? 'YouTube' : 'Instagram'
  const platformChip = account.platform === 'youtube' ? 'oi-chip-yt' : 'oi-chip-ig'
  const statusKey = latestLog?.status || (account.last_fetched_at ? 'success' : 'never')

  const eligibleCount = selectablePosts.length
  const selectedCount = selectedIds.size

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

      {eligibleCount > 0 && (
        <div className="oi-bulk-bar">
          <div className="oi-bulk-bar-info">
            <strong>{selectedCount}</strong> selected
            <span className="oi-bulk-bar-dim"> of {eligibleCount} eligible video{eligibleCount === 1 ? '' : 's'}</span>
            {bulkRunning && <span className="oi-bulk-bar-running">Running…</span>}
            {bulkMessage && !bulkRunning && <span className="oi-bulk-bar-message">{bulkMessage}</span>}
          </div>
          <div className="oi-bulk-bar-pills" role="group" aria-label="Quick pick top N% by views">
            <span className="oi-bulk-bar-pill-label">Top % by views:</span>
            {[2.5, 5, 10, 20].map(pct => {
              const n = Math.max(1, Math.ceil(eligibleCount * (pct / 100)))
              const active = percentile === pct
              return (
                <button
                  key={pct}
                  type="button"
                  className={`oi-bulk-pill${active ? ' active' : ''}`}
                  disabled={bulkRunning || eligibleCount === 0}
                  onClick={() => selectTopPercentile(pct)}
                  title={`Select top ${pct}% by views (${n} of ${eligibleCount})`}
                >{pct}% <span className="oi-bulk-pill-count">({n})</span></button>
              )
            })}
          </div>
          <div className="oi-bulk-bar-actions">
            <button
              type="button"
              className="oi-bulk-btn oi-bulk-btn-ghost"
              onClick={selectAllEligible}
              disabled={bulkRunning || eligibleCount === 0 || selectedCount === eligibleCount}
            >Select all</button>
            <button
              type="button"
              className={`oi-bulk-btn oi-bulk-btn-ghost${onlySelected ? ' oi-bulk-btn-active' : ''}`}
              onClick={() => setOnlySelected(v => !v)}
              disabled={selectedCount === 0}
              title={onlySelected ? 'Show all posts' : 'Show only the posts in your current selection'}
            >{onlySelected ? 'Show all' : 'Only selected'}</button>
            <button
              type="button"
              className="oi-bulk-btn oi-bulk-btn-ghost"
              onClick={clearSelection}
              disabled={bulkRunning || selectedCount === 0}
            >Clear</button>
            <button
              type="button"
              className="oi-bulk-btn oi-bulk-btn-primary"
              onClick={runBulkAnalyse}
              disabled={bulkRunning || selectedCount === 0}
            >{bulkRunning ? 'Analysing…' : `Analyse ${selectedCount || ''} selected`.trim()}</button>
          </div>
        </div>
      )}

      {error && <div className="oi-error">{error}</div>}
      {analyseError && <div className="oi-error">{analyseError}</div>}

      {loading ? (
        <div className="oi-empty">Loading posts…</div>
      ) : posts.length === 0 ? (
        <div className="oi-empty">No posts fetched for this account yet.</div>
      ) : (
        <div className="oi-posts-grid">
          {displayPosts.map(p => (
            <PostCard
              key={p.id}
              post={p}
              metrics={metricsByPost[p.id]}
              analysisInfo={analysesByPostId[p.id]}
              firstFrameUrl={firstFrameByPostId[p.id]}
              onAnalyse={handleAnalyse}
              analysing={analysingIds.has(p.id) || bulkStatus[p.id] === 'running'}
              bulkState={bulkStatus[p.id] || null}
              selected={selectedIds.has(p.id)}
              selectable={isVideoPost(p) && !analysesByPostId[p.id]}
              onToggleSelect={toggleSelect}
            />
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
