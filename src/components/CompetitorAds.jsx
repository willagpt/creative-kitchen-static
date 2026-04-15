import { useState, useEffect, useRef } from 'react'
import './CompetitorAds.css'
import { supabaseUrl } from '../lib/supabase'
import {
  FOREPLAY_FN_URL, ANALYSE_FN_URL, BATCH_FN_URL,
  sbHeaders, sbReadHeaders, fnHeaders, GRID_PAGE, BRAND_COLORS
} from './competitor/config'
import {
  formatDate, formatNumber, fmtImpressions, isVideoUrl,
  mapDbAd, extractPageId, mostCommonPageName
} from './competitor/utils'
import {
  resolvePageName, fetchAllAds, fetchFollowedBrands,
  saveBrand, updateBrand, deleteBrand
} from './competitor/api'
import InlineVideoCard from './competitor/InlineVideoCard'


// ── Component ──
export default function CompetitorAds({ onNavigate, onAdLibraryRefresh }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('metaAdLibraryToken') || '')
  const [allAds, setAllAds] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followedBrands, setFollowedBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [modalAd, setModalAd] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [showCount, setShowCount] = useState(GRID_PAGE)

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ── Top Performers state ──
  const [viewMode, setViewMode] = useState('library')
  const [selectedTopBrands, setSelectedTopBrands] = useState(new Set())
  const [topAds, setTopAds] = useState([])
  const [topLoading, setTopLoading] = useState(false)
  const [topError, setTopError] = useState(null)
  const [topPercentile, setTopPercentile] = useState(2.5)
  const [topTypeFilter, setTopTypeFilter] = useState('all')
  const [topSortBy, setTopSortBy] = useState('days')
  const [topShowCount, setTopShowCount] = useState(GRID_PAGE)
  const [topLoadingStatus, setTopLoadingStatus] = useState('')

  // ── AI Analysis state ──
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysisTab, setAnalysisTab] = useState('overview') // overview | prompts | ads | trends
  const [trendsData, setTrendsData] = useState(null)
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [analysisStep, setAnalysisStep] = useState(0) // 0=idle, 1=vision, 1.5=consolidating, 2=saving
  const [variantIndex, setVariantIndex] = useState(0) // cycling through DCO variants in modal
  const [copiedPromptIdx, setCopiedPromptIdx] = useState(null) // flash "Copied!" on prompt card
  const [cardVariantIdx, setCardVariantIdx] = useState({}) // { [adId]: index } for inline carousel
  const [libraryQueue, setLibraryQueue] = useState([]) // ads queued to add to library tab

  // ── Batch Job state ──
  const [batchJobId, setBatchJobId] = useState(null)
  const [batchStatus, setBatchStatus] = useState(null) // full job status object
  const [batchImages, setBatchImages] = useState([]) // per-image status array
  const [batchSummary, setBatchSummary] = useState(null) // { total, step1_completed, step2_completed, ... }
  const pollRef = useRef(null) // polling interval ref

  // ── Analysis History state ──
  const [pastAnalyses, setPastAnalyses] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // ── Video Analysis from Top Performers ──
  const [analysingAdIds, setAnalysingAdIds] = useState(new Set())     // in-flight video analyses
  const [selectedVideoIds, setSelectedVideoIds] = useState(new Set())  // bulk selection checkboxes
  const [analysedAdIds, setAnalysedAdIds] = useState(new Set())        // already-analysed dedup cache
  const [videoAnalysisNotice, setVideoAnalysisNotice] = useState(null) // { type: 'success'|'error', message }

  const hasKey = apiKey.length > 20

  // Copy full prompt to clipboard
  const copyPrompt = (text, idx) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPromptIdx(idx)
      setTimeout(() => setCopiedPromptIdx(null), 2000)
    })
  }

  // Scope Ctrl+A inside prompt text areas
  const handlePromptKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault()
      e.stopPropagation()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(e.currentTarget)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }

  // Fetch past analysis history: merge both analysis_jobs (new) and competitive_analyses (legacy)
  const fetchAnalysisHistory = async () => {
    setHistoryLoading(true)
    try {
      // Fetch from both sources in parallel
      const [jobsRes, legacyRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs?select=id,created_at,brands_analysed,percentile,type_filter,total_images,status,error_message,competitive_analysis_id,pipeline_version&order=created_at.desc&limit=20`, {
          headers: sbReadHeaders
        }),
        fetch(`${SUPABASE_URL}/rest/v1/competitive_analyses?select=id,created_at,brands_analysed,percentile,type_filter,ads_sent,model_used,status&order=created_at.desc&limit=20`, {
          headers: sbReadHeaders
        }),
      ])

      const allRuns = []

      // New batch pipeline runs
      if (jobsRes.ok) {
        const jobs = await jobsRes.json()
        // Collect competitive_analysis_ids that are linked to jobs (to avoid dupes)
        const linkedLegacyIds = new Set(jobs.map(j => j.competitive_analysis_id).filter(Boolean))
        for (const j of jobs) {
          allRuns.push({
            id: j.id,
            created_at: j.created_at,
            brands_analysed: j.brands_analysed || [],
            percentile: j.percentile,
            type_filter: j.type_filter,
            ads_sent: j.total_images,
            status: j.status,
            error_message: j.error_message,
            pipeline_version: j.pipeline_version || 'v1',
            _source: 'analysis_jobs',
            _competitive_analysis_id: j.competitive_analysis_id,
          })
        }

        // Legacy runs (exclude any that are already linked to a batch job)
        if (legacyRes.ok) {
          const legacy = await legacyRes.json()
          for (const r of legacy) {
            if (!linkedLegacyIds.has(r.id)) {
              allRuns.push({ ...r, _source: 'competitive_analyses' })
            }
          }
        }
      } else if (legacyRes.ok) {
        // Only legacy available
        const legacy = await legacyRes.json()
        for (const r of legacy) {
          allRuns.push({ ...r, _source: 'competitive_analyses' })
        }
      }

      // Sort by date descending and limit
      allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      setPastAnalyses(allRuns.slice(0, 20))
    } catch (e) { console.error('Failed to fetch analysis history', e) }
    setHistoryLoading(false)
  }

  // Load a full past analysis by ID (handles both analysis_jobs and competitive_analyses)
  const loadPastAnalysis = async (id, source) => {
    setAnalysisLoading(true)
    setAnalysisError(null)
    try {
      if (source === 'analysis_jobs') {
        // Load from batch pipeline tables
        const [jobRes, imgRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs?id=eq.${id}&select=*`, { headers: sbReadHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/analysis_job_images?job_id=eq.${id}&order=ad_index.asc`, { headers: sbReadHeaders }),
        ])
        if (!jobRes.ok) throw new Error('Failed to load analysis job')
        const jobs = await jobRes.json()
        if (!jobs.length) throw new Error('Analysis job not found')
        const job = jobs[0]
        const images = imgRes.ok ? await imgRes.json() : []

        setAnalysisResult({
          analysis_id: job.id,
          themes: job.merged_themes || [],
          personas: job.merged_personas || [],
          creativePillars: job.merged_pillars || [],
          visualClusters: job.merged_clusters || [],
          adAnalyses: images.filter(img => img.step1_analysis).map(img => img.step1_analysis),
          models: { vision: job.step1_model || '?' },
          _loaded_from_history: true,
          _loaded_at: job.created_at,
          _brands: job.brands_analysed,
          _percentile: job.percentile,
          _ads_sent: job.total_images,
          _batch_images: images,
          _batch_job_id: job.id,
        })
      } else {
        // Legacy: load from competitive_analyses
        const res = await fetch(`${SUPABASE_URL}/rest/v1/competitive_analyses?id=eq.${id}&select=*`, {
          headers: sbReadHeaders
        })
        if (!res.ok) throw new Error('Failed to load analysis')
        const rows = await res.json()
        if (!rows.length) throw new Error('Analysis not found')
        const row = rows[0]
        setAnalysisResult({
          analysis_id: row.id,
          themes: row.themes,
          personas: row.personas,
          creative_pillars: row.creative_pillars,
          adAnalyses: row.ad_analyses,
          chefly_prompts: row.chefly_prompts,
          models: { vision: (row.model_used || '').split(' + ')[0] || '?', prompts: (row.model_used || '').split(' + ')[1] || '?' },
          _loaded_from_history: true,
          _loaded_at: row.created_at,
          _brands: row.brands_analysed,
          _percentile: row.percentile,
          _ads_sent: row.ads_sent,
        })
      }
      setShowAnalysis(true)
      setAnalysisTab('overview')
      setShowHistory(false)
    } catch (e) {
      setAnalysisError(e.message)
    }
    setAnalysisLoading(false)
  }

  // Load all v2 runs for Market Trends comparison
  async function loadTrendsData() {
    if (trendsData) return // already loaded
    setTrendsLoading(true)
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs?pipeline_version=eq.v2&status=eq.completed&select=id,created_at,brands_analysed,merged_themes,merged_personas,merged_pillars,total_images,percentile&order=created_at.asc`,
        { headers: sbReadHeaders }
      )
      if (!res.ok) throw new Error('Failed to load trends data')
      const runs = await res.json()
      if (!runs.length) { setTrendsData({ runs: [], themes: [], personas: [], pillars: [] }); setTrendsLoading(false); return }

      // Collect all unique names across runs and track their weight over time
      const themeMap = {}, personaMap = {}, pillarMap = {}
      for (const run of runs) {
        const runDate = new Date(run.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        const runMeta = { id: run.id, date: runDate, fullDate: run.created_at, brands: run.brands_analysed, totalImages: run.total_images }
        for (const t of (run.merged_themes || [])) {
          if (!themeMap[t.name]) themeMap[t.name] = { name: t.name, description: t.description, points: [] }
          themeMap[t.name].points.push({ ...runMeta, weight: t.weight || 0, momentum: t.momentum || 'niche' })
        }
        for (const p of (run.merged_personas || [])) {
          if (!personaMap[p.name]) personaMap[p.name] = { name: p.name, description: p.description, points: [] }
          personaMap[p.name].points.push({ ...runMeta, weight: p.weight || 0, momentum: p.momentum || 'niche' })
        }
        for (const pl of (run.merged_pillars || [])) {
          if (!pillarMap[pl.name]) pillarMap[pl.name] = { name: pl.name, description: pl.description, points: [] }
          pillarMap[pl.name].points.push({ ...runMeta, weight: pl.weight || 0, momentum: pl.momentum || 'niche' })
        }
      }

      // Sort each by latest weight descending
      const sortByLatest = items => Object.values(items).sort((a, b) => {
        const aLast = a.points[a.points.length - 1]?.weight || 0
        const bLast = b.points[b.points.length - 1]?.weight || 0
        return bLast - aLast
      })

      // Calculate trend direction for items with 2+ data points
      for (const map of [themeMap, personaMap, pillarMap]) {
        for (const item of Object.values(map)) {
          if (item.points.length >= 2) {
            const first = item.points[0].weight
            const last = item.points[item.points.length - 1].weight
            const diff = last - first
            item.trend = diff > 10 ? 'rising' : diff < -10 ? 'declining' : 'stable'
            item.trendDelta = diff
          } else {
            item.trend = 'new'
            item.trendDelta = 0
          }
        }
      }

      setTrendsData({
        runs: runs.map(r => ({ id: r.id, date: new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), fullDate: r.created_at, brands: r.brands_analysed, totalImages: r.total_images })),
        themes: sortByLatest(themeMap),
        personas: sortByLatest(personaMap),
        pillars: sortByLatest(pillarMap),
      })
    } catch (e) {
      console.error('Failed to load trends', e)
      setTrendsData({ runs: [], themes: [], personas: [], pillars: [], error: e.message })
    }
    setTrendsLoading(false)
  }

  const brandColorMap = {}
  followedBrands.forEach((b, i) => {
    brandColorMap[b.pageId] = BRAND_COLORS[i % BRAND_COLORS.length]
  })

  useEffect(() => { fetchFollowedBrands(supabaseUrl).then(setFollowedBrands) }, [])
  useEffect(() => { if (apiKey.length > 20) localStorage.setItem('metaAdLibraryToken', apiKey) }, [apiKey])
  useEffect(() => { setShowCount(GRID_PAGE) }, [typeFilter, statusFilter, sortBy, searchText, dateFrom, dateTo])
  useEffect(() => { setTopShowCount(GRID_PAGE) }, [topPercentile, topTypeFilter, topSortBy])

  // ── Library: filtered ads ──
  const filteredAds = (() => {
    let ads = [...allAds]
    if (typeFilter === 'video') ads = ads.filter(a => a.isVideo)
    if (typeFilter === 'image') ads = ads.filter(a => !a.isVideo && a.hasMedia)
    if (statusFilter === 'active') ads = ads.filter(a => a.status === 'active')
    if (statusFilter === 'ended') ads = ads.filter(a => a.status === 'ended')
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      ads = ads.filter(a => (a.adName || '').toLowerCase().includes(q) || (a.adBody || '').toLowerCase().includes(q))
    }
    if (dateFrom) {
      const from = new Date(dateFrom)
      ads = ads.filter(a => a.rawStartDate && new Date(a.rawStartDate) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      ads = ads.filter(a => a.rawStartDate && new Date(a.rawStartDate) <= to)
    }
    ads.sort((a, b) => {
      switch (sortBy) {
        case 'longest': return b.daysActive - a.daysActive
        case 'shortest': return a.daysActive - b.daysActive
        case 'newest': return new Date(b.rawStartDate || 0) - new Date(a.rawStartDate || 0)
        case 'oldest': return new Date(a.rawStartDate || 0) - new Date(b.rawStartDate || 0)
        default: return 0
      }
    })
    return ads
  })()

  const pageAds = filteredAds.slice(0, showCount)
  const remaining = filteredAds.length - showCount

  const videoCount = allAds.filter(a => a.isVideo).length
  const imageCount = allAds.filter(a => !a.isVideo && a.hasMedia).length
  const activeCount = allAds.filter(a => a.status === 'active').length

  // ── Deduplication: group by creative fingerprint ──
  function deduplicateAds(ads) {
    const groups = {}
    for (const ad of ads) {
      // Step 1: strip card index to get parent ad ID
      const parentId = ad.adId.includes('_card') ? ad.adId.split('_card')[0] : ad.adId
      // Step 2: build creative fingerprint from copy + brand
      const copyKey = ((ad.adName || '') + '||' + (ad.adBody || '').slice(0, 100) + '||' + ad.pageId).toLowerCase().trim()
      const groupKey = copyKey || parentId

      if (!groups[groupKey]) {
        groups[groupKey] = { hero: ad, variants: [ad], parentIds: new Set([parentId]) }
      } else {
        groups[groupKey].variants.push(ad)
        groups[groupKey].parentIds.add(parentId)
        // Keep the variant with the longest run as the hero
        if (ad.daysActive > groups[groupKey].hero.daysActive) {
          groups[groupKey].hero = ad
        } else if (ad.daysActive === groups[groupKey].hero.daysActive && ad.hasMedia && !groups[groupKey].hero.hasMedia) {
          groups[groupKey].hero = ad
        }
      }
    }
    return Object.values(groups).map(g => ({
      ...g.hero,
      variantCount: g.variants.length,
      uniqueAdIds: g.parentIds.size,
      variants: g.variants,
    }))
  }

  // ── Top Performers: percentile PER BRAND, then combine and dedup ──
  const sortFn = (a, b) => {
    switch (topSortBy) {
      case 'velocity': return b.velocity - a.velocity
      case 'impressions': return b.impressionsMid - a.impressionsMid
      case 'days': return b.daysActive - a.daysActive
      default: return b.daysActive - a.daysActive
    }
  }

  const topFiltered = (() => {
    // Group ads by brand — only include currently selected brands
    const byBrand = {}
    for (const ad of topAds) {
      if (selectedTopBrands.size > 0 && !selectedTopBrands.has(ad.pageId)) continue
      if (ad.daysActive < 1) continue
      if (topTypeFilter === 'video' && !ad.isVideo) continue
      if (topTypeFilter === 'image' && (ad.isVideo || !ad.hasMedia)) continue
      const key = ad.pageId
      if (!byBrand[key]) byBrand[key] = []
      byBrand[key].push(ad)
    }

    // Take top percentile from EACH brand independently
    let combined = []
    for (const pageId of Object.keys(byBrand)) {
      const brandAds = byBrand[pageId]
      brandAds.sort(sortFn)
      const cutoff = Math.max(1, Math.ceil(brandAds.length * (topPercentile / 100)))
      combined = combined.concat(brandAds.slice(0, cutoff))
    }

    // Then dedup for clean display
    combined = deduplicateAds(combined)
    combined.sort(sortFn)
    return combined
  })()

  // Count raw eligible ads for the stats bar (per-brand totals)
  const topRawEligible = (() => {
    let ads = [...topAds].filter(a => a.daysActive >= 1)
    if (selectedTopBrands.size > 0) ads = ads.filter(a => selectedTopBrands.has(a.pageId))
    if (topTypeFilter === 'video') ads = ads.filter(a => a.isVideo)
    if (topTypeFilter === 'image') ads = ads.filter(a => !a.isVideo && a.hasMedia)
    return ads.length
  })()
  const topRawCutoff = (() => {
    // Sum of per-brand cutoffs
    const byBrand = {}
    for (const ad of topAds) {
      if (selectedTopBrands.size > 0 && !selectedTopBrands.has(ad.pageId)) continue
      if (ad.daysActive < 1) continue
      if (topTypeFilter === 'video' && !ad.isVideo) continue
      if (topTypeFilter === 'image' && (ad.isVideo || !ad.hasMedia)) continue
      if (!byBrand[ad.pageId]) byBrand[ad.pageId] = 0
      byBrand[ad.pageId]++
    }
    return Object.values(byBrand).reduce((sum, count) => sum + Math.max(1, Math.ceil(count * (topPercentile / 100))), 0)
  })()

  const topPageAds = topFiltered.slice(0, topShowCount)
  const topRemaining = topFiltered.length - topShowCount
  const topBrandAds = selectedTopBrands.size > 0 ? topAds.filter(a => selectedTopBrands.has(a.pageId)) : topAds
  const topVideoCount = topBrandAds.filter(a => a.isVideo).length
  const topImageCount = topBrandAds.filter(a => !a.isVideo && a.hasMedia).length
  const topHasImpressions = topBrandAds.some(a => a.impressionsMid > 0)

  function toggleTopBrand(pageId) {
    setSelectedTopBrands(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  function selectAllTopBrands() {
    setSelectedTopBrands(new Set(followedBrands.map(b => b.pageId)))
  }

  function clearTopBrands() {
    setSelectedTopBrands(new Set())
  }

  async function loadTopPerformers() {
    if (selectedTopBrands.size === 0) return
    setTopLoading(true)
    setTopError(null)
    setTopAds([])
    setTopShowCount(GRID_PAGE)

    try {
      const brandList = followedBrands.filter(b => selectedTopBrands.has(b.pageId))
      let allMapped = []

      for (let i = 0; i < brandList.length; i++) {
        const brand = brandList[i]
        setTopLoadingStatus(`Loading ${brand.pageName} (${i + 1}/${brandList.length})...`)
        const rows = await fetchAllAds(brand.pageId, supabaseUrl)
        const mapped = rows.map(ad => mapDbAd(ad, brand.pageId, brand.pageName))
        allMapped = allMapped.concat(mapped)
      }

      setTopLoadingStatus(`Ranking ${allMapped.length} ads...`)
      setTopAds(allMapped)
      setTopLoadingStatus('')
    } catch (err) {
      setTopError(err.message)
    } finally {
      setTopLoading(false)
      setTopLoadingStatus('')
    }
  }

  // Stop processing on unmount
  useEffect(() => { return () => { pollRef.current = false } }, [])

  // Background status poller: runs every 5s independently of process_next
  function startStatusPoller(jobId) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(BATCH_FN_URL, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify({ action: 'status', job_id: jobId }),
        })
        if (res.ok) {
          const d = await res.json()
          setBatchStatus(d.job)
          setBatchImages(d.images || [])
          setBatchSummary(d.summary)
          const s = d.summary || {}
          // Pipeline v3: no step 2 prompt generation
        }
      } catch { /* swallow */ }
    }, 5000)
    return interval
  }

  // Drive processing loop: call process_next repeatedly until job is done
  async function driveProcessing(jobId) {
    pollRef.current = true // flag to allow cancellation
    let consecutiveErrors = 0

    // Start background status poller so progress updates every 5s,
    // even while process_next is blocking on a long Claude API call
    const statusInterval = startStatusPoller(jobId)

    try {
      while (pollRef.current) {
        try {
          // Call process_next to do one unit of work
          const res = await fetch(BATCH_FN_URL, {
            method: 'POST',
            headers: fnHeaders,
            body: JSON.stringify({ action: 'process_next', job_id: jobId }),
          })

          if (!res.ok) {
            consecutiveErrors++
            if (consecutiveErrors >= 3) {
              setAnalysisError('Processing failed after multiple retries')
              setAnalysisLoading(false)
              setAnalysisStep(0)
              return
            }
            await new Promise(r => setTimeout(r, 2000))
            continue
          }

          const data = await res.json()
          if (data.error) {
            consecutiveErrors++
            if (consecutiveErrors >= 3) {
              setAnalysisError(data.error)
              setAnalysisLoading(false)
              setAnalysisStep(0)
              return
            }
            await new Promise(r => setTimeout(r, 2000))
            continue
          }

          consecutiveErrors = 0 // reset on success

          // Update UI based on current phase
          if (data.phase === 'step1_running') {
            setAnalysisStep(1)
          } else if (data.phase === 'step1_done' || data.phase === 'consolidation_done' || data.phase === 'consolidation_skipped') {
            setAnalysisStep(1.5)
          } else if (data.phase === 'saving') {
            setAnalysisStep(2)
          }

          // Job finished
          if (data.phase === 'completed') {
            await loadBatchResults(jobId)
            return
          }

          if (data.phase === 'failed') {
            setAnalysisError(data.error || 'Batch job failed. Check edge function logs for details.')
            setAnalysisLoading(false)
            setAnalysisStep(0)
            return
          }

          // No work to do (already completed)
          if (data.message === 'No work to do') {
            if (data.phase === 'completed') {
              await loadBatchResults(jobId)
            } else {
              setAnalysisError(`Job in unexpected state: ${data.phase}`)
              setAnalysisLoading(false)
              setAnalysisStep(0)
            }
            return
          }

        } catch (err) {
          consecutiveErrors++
          if (consecutiveErrors >= 3) {
            setAnalysisError('Network error during processing. You can retry.')
            setAnalysisLoading(false)
            setAnalysisStep(0)
            return
          }
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    } finally {
      // Always clean up the background poller
      clearInterval(statusInterval)
    }
  }

  // Load completed batch results into the existing analysis UI format
  async function loadBatchResults(jobId) {
    try {
      const res = await fetch(BATCH_FN_URL, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({ action: 'results', job_id: jobId }),
      })
      if (!res.ok) throw new Error('Failed to load results')
      const data = await res.json()
      const job = data.job || {}
      const images = data.images || []

      // Build analysisResult in the format the UI expects, plus 1:1 image-prompt pairs
      const adAnalyses = images.filter(img => img.step1_analysis).map(img => img.step1_analysis)
      setAnalysisResult({
        adAnalyses,
        themes: job.merged_themes || [],
        personas: job.merged_personas || [],
        creativePillars: job.merged_pillars || [],
        visualClusters: job.merged_clusters || [],
        creativeFormats: job.merged_formats || [],
        consolidation_summary: job.consolidation_summary || null,
        analysis_id: job.competitive_analysis_id,
        models: { vision: job.step1_model || 'claude-opus-4-20250514' },
        _batch_job_id: jobId,
        _batch_images: images,
        _brands: job.brands_analysed,
      })
      setAnalysisTab('overview')
    } catch (err) {
      setAnalysisError(err.message)
    } finally {
      setAnalysisLoading(false)
      setAnalysisStep(0)
    }
  }

  async function runCreativeAnalysis() {
    const adsToAnalyse = topFiltered.filter(a => !a.isVideo && a.hasMedia)
    if (adsToAnalyse.length === 0) {
      setAnalysisError('No static image ads to analyse. Change the type filter to include images.')
      return
    }
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    setShowAnalysis(true)
    setAnalysisTab('overview')
    setAnalysisStep(1)

    try {
      // Expand all unique variant images
      const seenUrls = new Set()
      const expandedAds = []
      for (const ad of adsToAnalyse) {
        const variants = ad.variants || [ad]
        for (const v of variants) {
          const url = v.mediaUrl || v.thumbnailUrl || ''
          if (!url || seenUrls.has(url) || v.isVideo) continue
          seenUrls.add(url)
          expandedAds.push(v)
        }
      }
      const payload = expandedAds.map(ad => ({
        imageUrl: ad.mediaUrl || ad.thumbnailUrl || '',
        title: ad.adName || '',
        body: ad.adBody || '',
        daysActive: ad.daysActive,
        displayFormat: ad.displayFormat || 'IMAGE',
        pageName: ad.pageName || '',
        isVideo: false,
        id: ad.adId || null,
      }))

      const selectedBrandNames = followedBrands.filter(b => selectedTopBrands.has(b.pageId)).map(b => b.pageName)
      const selectedPageIds = [...selectedTopBrands]

      // Create batch job via orchestrator
      const res = await fetch(BATCH_FN_URL, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({
          action: 'create',
          ads: payload,
          brands_analysed: selectedBrandNames,
          page_ids: selectedPageIds,
          percentile: topPercentile,
          type_filter: topTypeFilter,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Failed to create batch job (${res.status})`)
      }

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setBatchJobId(data.job_id)
      const reusedS1 = data.reused_step1 || 0
      setBatchSummary({
        total: data.total_images,
        step1_completed: reusedS1,
        reused_step1: reusedS1,
      })

      // Drive processing loop (frontend calls process_next repeatedly)
      driveProcessing(data.job_id)

    } catch (err) {
      const msg = err.message === 'Failed to fetch'
        ? 'Failed to start analysis: network error (the server may be temporarily unavailable, try again)'
        : err.message
      setAnalysisError(msg)
      setAnalysisLoading(false)
      setAnalysisStep(0)
    }
  }

  async function fetchBrandAds(pageId, pageName) {
    setIsLoading(true)
    setError(null)
    setAllAds([])
    setShowCount(GRID_PAGE)
    setLoadingStatus('Loading ads...')
    try {
      const rows = await fetchAllAds(pageId, supabaseUrl)
      if (rows.length > 0) {
        setLoadingStatus(`Processing ${rows.length} ads...`)
        const mappedAds = rows.map(ad => mapDbAd(ad, pageId, pageName))
        setAllAds(mappedAds)
        setLoadingStatus('')
        await updateBrand(pageId, { last_fetched_at: new Date().toISOString(), total_ads: rows.length }, supabaseUrl)

        if (pageName && /^Brand \d+$/.test(pageName)) {
          const realName = mostCommonPageName(rows)
          if (realName) {
            await updateBrand(pageId, { page_name: realName }, supabaseUrl)
            setFollowedBrands(prev => prev.map(b =>
              b.pageId === pageId ? { ...b, pageName: realName, adCount: rows.length } : b
            ))
            setActiveBrand(prev => prev?.pageId === pageId ? { ...prev, pageName: realName } : prev)
          }
        }
      } else {
        setLoadingStatus('Fetching from Foreplay...')
        await fetch(FOREPLAY_FN_URL, {
          method: 'POST', headers: fnHeaders,
          body: JSON.stringify({ page_id: pageId, limit: 50 }),
        })
        const reRows = await fetchAllAds(pageId, supabaseUrl)
        const mappedAds = reRows.map(ad => mapDbAd(ad, pageId, pageName))
        setAllAds(mappedAds)
        setLoadingStatus('')

        if (reRows.length > 0) {
          const realName = mostCommonPageName(reRows)
          if (realName && realName !== pageName) {
            await updateBrand(pageId, { page_name: realName, total_ads: reRows.length }, supabaseUrl)
            setFollowedBrands(prev => prev.map(b =>
              b.pageId === pageId ? { ...b, pageName: realName, adCount: reRows.length } : b
            ))
            setActiveBrand(prev => prev?.pageId === pageId ? { ...prev, pageName: realName } : prev)
          }
        }
      }
    } catch (err) {
      setError(err.message)
      setAllAds([])
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  async function handleAddBrand() {
    if (!addInput.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const pageId = extractPageId(addInput)
      if (!pageId) { setAddError('Invalid page ID or URL.'); setAddLoading(false); return }

      if (followedBrands.some(b => b.pageId === pageId)) {
        setAddError('This brand is already in your list.')
        setAddLoading(false)
        return
      }

      const resolvedName = await resolvePageName(pageId, supabaseUrl, hasKey ? apiKey : null)
      const pageName = resolvedName || 'Brand ' + pageId

      const nb = { pageId, pageName, platforms: ['meta'], adCount: 0, lastFetchedAt: null, thumbnailUrl: null }
      if (await saveBrand(nb, supabaseUrl)) {
        setFollowedBrands([nb, ...followedBrands])
        setAddInput('')
        setShowAddForm(false)
      } else {
        setAddError('Could not save brand.')
      }
    } catch (err) { setAddError(err.message) }
    finally { setAddLoading(false) }
  }

  async function handleRemoveBrand(pageId) {
    const brand = followedBrands.find(b => b.pageId === pageId)
    const brandName = brand?.pageName || pageId
    if (!window.confirm(`Remove "${brandName}" from your competitor list?`)) return
    if (!window.confirm(`Are you sure? This will remove "${brandName}" and all its tracked data from your view. This cannot be undone.`)) return
    await deleteBrand(pageId, supabaseUrl)
    setFollowedBrands(followedBrands.filter(b => b.pageId !== pageId))
    if (activeBrand?.pageId === pageId) { setActiveBrand(null); setAllAds([]) }
  }

  function handleImgError(e) {
    const img = e.target
    img.style.display = 'none'
    const fallback = img.parentElement.querySelector('.ca-img-fallback')
    if (fallback) fallback.style.display = 'flex'
  }

  function openModal(ad, e) {
    if (e) e.stopPropagation()
    { setModalAd(ad); setVariantIndex(0) }
  }

  // Save an ad to the saved_ads table (Ad Library page)
  async function saveToAdLibrary(variant) {
    try {
      const body = {
        advertiser_name: variant.pageName || '',
        ad_copy: [variant.adName, variant.adBody].filter(Boolean).join('\n'),
        image_url: variant.mediaUrl || '',
        video_url: variant.videoUrl || null,
        media_type: variant.isVideo ? 'video' : 'image',
        library_id: variant.adId || `foreplay_${Date.now()}`,
        platform: 'facebook',
        started_running: variant.rawStartDate || null,
        page_url: variant.url || '',
        metadata: {
          source: 'competitor_ads',
          days_active: variant.daysActive,
          display_format: variant.displayFormat,
          card_index: variant.cardIndex,
          status: variant.status,
          capturedAt: new Date().toISOString(),
        },
      }
      await fetch(`${SUPABASE_URL}/rest/v1/saved_ads`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify(body),
      })
      // Refresh Ad Library data so it's ready when they switch tabs
      if (onAdLibraryRefresh) onAdLibraryRefresh()
    } catch (err) {
      console.error('Failed to save to Ad Library:', err)
    }
  }

  function addToLibraryQueue(ad) {
    const variants = ad.variants || [ad]
    const seen = new Set()
    const unique = variants.filter(v => {
      const key = v.mediaUrl || v.adId
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setLibraryQueue(prev => {
      const existingIds = new Set(prev.map(a => a.adId + (a.cardIndex || '')))
      const newAds = unique.filter(v => !existingIds.has(v.adId + (v.cardIndex || '')))
      if (newAds.length === 0) return prev
      // Also save each new ad to the Ad Library (saved_ads table)
      newAds.forEach(v => saveToAdLibrary(v))
      return [...prev, ...newAds]
    })
  }

  function addSingleToLibraryQueue(variant) {
    setLibraryQueue(prev => {
      const key = variant.adId + (variant.cardIndex || '')
      if (prev.some(a => (a.adId + (a.cardIndex || '')) === key)) return prev
      // Also save to the Ad Library (saved_ads table)
      saveToAdLibrary(variant)
      return [...prev, variant]
    })
  }

  // ── Video Analysis helpers ──

  // Check if a video has already been analysed (dedup guard)
  async function checkVideoAnalysed(adId) {
    if (analysedAdIds.has(adId)) return true
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/video_analyses?competitor_ad_id=eq.${adId}&select=id,status&limit=1`,
        { headers: sbReadHeaders }
      )
      if (!res.ok) return false
      const rows = await res.json()
      if (rows.length > 0 && (rows[0].status === 'complete' || rows[0].status === 'processing')) {
        setAnalysedAdIds(prev => new Set([...prev, adId]))
        return rows[0].status // 'complete' or 'processing'
      }
      return false
    } catch { return false }
  }

  // Trigger video analysis for a single ad
  async function handleAnalyseVideo(ad) {
    if (analysingAdIds.has(ad.adId)) return

    // Dedup check
    const existing = await checkVideoAnalysed(ad.adId)
    if (existing === 'processing') {
      setVideoAnalysisNotice({ type: 'info', message: `"${ad.adName || ad.adId}" is already being analysed.` })
      setTimeout(() => setVideoAnalysisNotice(null), 4000)
      return
    }
    if (existing === 'complete') {
      setVideoAnalysisNotice({ type: 'info', message: `"${ad.adName || ad.adId}" was already analysed. Check the Video Analysis tab for results.` })
      setTimeout(() => setVideoAnalysisNotice(null), 5000)
      return
    }

    setAnalysingAdIds(prev => new Set([...prev, ad.adId]))
    setVideoAnalysisNotice({ type: 'success', message: `Queued "${ad.adName || ad.adId}" for video analysis...` })
    setTimeout(() => setVideoAnalysisNotice(null), 3000)

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/analyse-video`, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({ competitor_ad_id: ad.adId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || 'Failed to start analysis')
      }
      setAnalysedAdIds(prev => new Set([...prev, ad.adId]))
    } catch (e) {
      setVideoAnalysisNotice({ type: 'error', message: `Analysis failed: ${e.message}` })
      setTimeout(() => setVideoAnalysisNotice(null), 5000)
    } finally {
      setAnalysingAdIds(prev => { const s = new Set(prev); s.delete(ad.adId); return s })
    }
  }

  // Bulk analyse selected videos (concurrency limit of 2)
  async function handleBulkAnalyse() {
    const selectedAds = topFiltered.filter(a => selectedVideoIds.has(a.adId) && a.isVideo && a.hasMedia)
    if (selectedAds.length === 0) return

    // Pre-check for already analysed
    const toAnalyse = []
    let skipped = 0
    for (const ad of selectedAds) {
      const existing = await checkVideoAnalysed(ad.adId)
      if (existing) { skipped++; continue }
      toAnalyse.push(ad)
    }

    if (toAnalyse.length === 0) {
      setVideoAnalysisNotice({ type: 'info', message: `All ${skipped} selected video(s) already analysed. Check Video Analysis tab.` })
      setTimeout(() => setVideoAnalysisNotice(null), 4000)
      setSelectedVideoIds(new Set())
      return
    }

    const skipMsg = skipped > 0 ? ` (${skipped} already analysed, skipped)` : ''
    setVideoAnalysisNotice({ type: 'success', message: `Queued ${toAnalyse.length} video(s) for analysis${skipMsg}. Results will appear in Video Analysis tab.` })
    setTimeout(() => setVideoAnalysisNotice(null), 5000)
    setSelectedVideoIds(new Set())

    // Process with concurrency limit of 2
    const concurrency = 2
    let i = 0
    async function runNext() {
      if (i >= toAnalyse.length) return
      const ad = toAnalyse[i++]
      setAnalysingAdIds(prev => new Set([...prev, ad.adId]))
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/analyse-video`, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify({ competitor_ad_id: ad.adId }),
        })
        if (res.ok) setAnalysedAdIds(prev => new Set([...prev, ad.adId]))
      } catch { /* silent */ }
      setAnalysingAdIds(prev => { const s = new Set(prev); s.delete(ad.adId); return s })
      await runNext()
    }
    const workers = Array.from({ length: Math.min(concurrency, toAnalyse.length) }, () => runNext())
    await Promise.allSettled(workers)
  }

  // Toggle video selection for bulk
  function toggleVideoSelection(adId) {
    setSelectedVideoIds(prev => {
      const next = new Set(prev)
      if (next.has(adId)) { next.delete(adId) } else if (next.size < 5) { next.add(adId) }
      return next
    })
  }

  function renderAdCard(ad, showBrandTag = false) {
    const brandColor = brandColorMap[ad.pageId]
    // Inline carousel: get unique image variants
    const allVariants = ad.variants || [ad]
    const seenMedia = new Set()
    const uniqueVars = allVariants.filter(v => {
      const key = v.mediaUrl || v.adId
      if (!v.mediaUrl || seenMedia.has(key)) return false
      seenMedia.add(key)
      return true
    })
    const hasCarousel = uniqueVars.length > 1 && !ad.isVideo
    const currentIdx = cardVariantIdx[ad.adId] || 0
    const safeIdx = currentIdx % uniqueVars.length
    const displayVariant = hasCarousel ? uniqueVars[safeIdx] : ad
    const displayUrl = displayVariant.mediaUrl || ad.mediaUrl
    const isInQueue = libraryQueue.some(a => (a.adId + (a.cardIndex || '')) === (displayVariant.adId + (displayVariant.cardIndex || '')))

    const goCardPrev = (e) => {
      e.stopPropagation()
      setCardVariantIdx(prev => ({ ...prev, [ad.adId]: (safeIdx - 1 + uniqueVars.length) % uniqueVars.length }))
    }
    const goCardNext = (e) => {
      e.stopPropagation()
      setCardVariantIdx(prev => ({ ...prev, [ad.adId]: (safeIdx + 1) % uniqueVars.length }))
    }

    const isAnalysing = analysingAdIds.has(ad.adId)
    const isAlreadyAnalysed = analysedAdIds.has(ad.adId)
    const isSelected = selectedVideoIds.has(ad.adId)

    return (
      <div key={ad.adId + '-' + (ad.cardIndex || '')} className={`ca-card ${isAnalysing ? 'ca-card-analysing' : ''}`}>
        <div className="ca-card-media">
          {/* Video analysis checkbox (Top Performers video cards only) */}
          {showBrandTag && ad.isVideo && ad.hasMedia && (
            <label className="ca-card-checkbox" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleVideoSelection(ad.adId)}
              />
            </label>
          )}
          {ad.isVideo && ad.mediaUrl ? (
            <InlineVideoCard src={ad.videoUrl || ad.mediaUrl} onClick={(e) => openModal(ad, e)} />
          ) : ad.isVideo ? (
            <div className="ca-video-placeholder-mini" onClick={() => { setModalAd(ad); setVariantIndex(0) }}>
              <div className="ca-video-play-btn">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
              </div>
              <div className="ca-video-label">VIDEO</div>
            </div>
          ) : displayUrl ? (
            <div onClick={() => { setModalAd(ad); setVariantIndex(safeIdx) }}>
              <img src={displayUrl} alt="" className="ca-card-thumb" loading="lazy" onError={handleImgError} />
              <div className="ca-img-fallback" style={{display:'none'}}>
                <span className="ca-fallback-text">{ad.adName || 'Image unavailable'}</span>
              </div>
            </div>
          ) : (
            <div className="ca-no-preview" onClick={() => { setModalAd(ad); setVariantIndex(0) }}>
              <span>No preview available</span>
            </div>
          )}
          {/* Inline carousel arrows */}
          {hasCarousel && (
            <>
              <button className="ca-card-arrow ca-card-arrow-left" onClick={goCardPrev} title="Previous variant">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button className="ca-card-arrow ca-card-arrow-right" onClick={goCardNext} title="Next variant">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 6 15 12 9 18"/></svg>
              </button>
              <div className="ca-card-dots">
                {uniqueVars.map((_, i) => (
                  <span key={i} className={`ca-card-dot ${i === safeIdx ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCardVariantIdx(prev => ({ ...prev, [ad.adId]: i })) }} />
                ))}
              </div>
            </>
          )}
          {/* Add to library button (images only) */}
          {!ad.isVideo && displayUrl && (
            <button
              className={`ca-card-add-lib ${isInQueue ? 'added' : ''}`}
              onClick={(e) => { e.stopPropagation(); hasCarousel ? addSingleToLibraryQueue(displayVariant) : addToLibraryQueue(ad) }}
              title={isInQueue ? 'Added to library' : (hasCarousel ? 'Add this variant to Ad Library' : `Add to Ad Library`)}
            >
              {isInQueue ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Added</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add</>
              )}
            </button>
          )}
          {/* Analyse Video button (video cards in Top Performers only) */}
          {showBrandTag && ad.isVideo && ad.hasMedia && (
            <button
              className={`ca-card-analyse-btn ${isAlreadyAnalysed ? 'analysed' : ''} ${isAnalysing ? 'loading' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAnalyseVideo(ad) }}
              disabled={isAnalysing}
              title={isAlreadyAnalysed ? 'Already analysed' : isAnalysing ? 'Analysing...' : 'Analyse this video with AI'}
            >
              {isAnalysing ? (
                <><span className="ca-spin-sm"></span> Analysing</>
              ) : isAlreadyAnalysed ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Analysed</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Analyse</>
              )}
            </button>
          )}
          {!ad.isVideo && (
            <div className="ca-card-overlay" onClick={() => { setModalAd(ad); setVariantIndex(hasCarousel ? safeIdx : 0) }}>
              <span className="ca-card-expand">Click to expand</span>
            </div>
          )}
          {/* Variant counter badge */}
          {hasCarousel && (
            <div className="ca-card-variant-counter">{safeIdx + 1} / {uniqueVars.length}</div>
          )}
        </div>
        <div className="ca-card-body" onClick={() => { setModalAd(ad); setVariantIndex(hasCarousel ? safeIdx : 0) }}>
          <div className="ca-card-title">{ad.adName}</div>
          <div className="ca-card-tags">
            {showBrandTag && brandColor && (
              <span className="ca-tag ca-tag-brand" style={{ background: brandColor.bg, color: brandColor.text, borderLeft: `3px solid ${brandColor.border}` }}>
                {ad.pageName}
              </span>
            )}
            {ad.variantCount > 1 && (
              <span className="ca-tag ca-tag-variants" title={`${ad.variantCount} variants across ${ad.uniqueAdIds} ad${ad.uniqueAdIds !== 1 ? 's' : ''}`}>
                {ad.variantCount} variants
              </span>
            )}
            <span className={`ca-tag ${ad.isVideo ? 'video' : 'image'}`}>
              {ad.displayFormat === 'DCO' ? (ad.isVideo ? '\u25B6 DCO' : 'DCO') : ad.isVideo ? '\u25B6 video' : 'image'}
            </span>
            <span className="ca-tag days">{ad.daysActive}d</span>
            <span className={`ca-tag status-${ad.status}`}>{ad.status}</span>
          </div>
          {showBrandTag && (
            <div className="ca-card-velocity">
              {ad.velocity > 0 ? (
                <>
                  <span className="ca-velocity-label">Velocity</span>
                  <span className="ca-velocity-value">{formatNumber(Math.round(ad.velocity))}/day</span>
                  {ad.impressionsText && (
                    <>
                      <span className="ca-velocity-sep">&middot;</span>
                      <span className="ca-velocity-imp">{ad.impressionsText} imp</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="ca-velocity-label">Running</span>
                  <span className="ca-velocity-value">{ad.daysActive} days</span>
                  <span className="ca-velocity-sep">&middot;</span>
                  <span className="ca-velocity-imp">{ad.status === 'active' ? 'Still active' : 'Ended'}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ca-container">
      <div className="ca-header">
        <h1>Competitor Ads</h1>
        <div className="ca-header-actions">
          <div className="ca-view-tabs">
            <button className={`ca-view-tab ${viewMode === 'library' ? 'active' : ''}`} onClick={() => setViewMode('library')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Library
            </button>
            <button className={`ca-view-tab ${viewMode === 'top' ? 'active' : ''}`} onClick={() => setViewMode('top')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
              Top Performers
            </button>
          </div>
          <button className="ca-btn-add-competitor" onClick={() => setShowAddForm(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Competitor
          </button>
          <div className="ca-token-row">
            <input type="password" placeholder="Meta token (optional)..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="ca-token-input" />
            {hasKey && <span className="ca-token-ok">Connected</span>}
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="ca-add-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) { setShowAddForm(false); setAddInput(''); setAddError(null) } }}>
          <div className="ca-add-modal" onClick={e => e.stopPropagation()}>
            <h3>Add Competitor</h3>
            <p className="ca-add-modal-desc">Enter a Facebook Page ID or Ad Library URL</p>
            <input
              type="text"
              placeholder="e.g. 187701838409772 or facebook.com/ads/library/?view_all_page_id=..."
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              className="ca-add-modal-input"
              disabled={addLoading}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleAddBrand()}
            />
            {addError && <p className="ca-add-err">{addError}</p>}
            <div className="ca-add-modal-btns">
              <button onClick={() => { setShowAddForm(false); setAddInput(''); setAddError(null) }} className="ca-btn-ghost">Cancel</button>
              <button onClick={handleAddBrand} disabled={addLoading || !addInput.trim()} className="ca-btn-primary">{addLoading ? 'Resolving name...' : 'Add Competitor'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="ca-layout">
        <aside className="ca-sidebar">
          <div className="ca-sidebar-title">Brands ({followedBrands.length})</div>

          {viewMode === 'library' && (
            <div className="ca-brand-list">
              {followedBrands.map(b => (
                <div key={b.pageId} className={`ca-brand-row ${activeBrand?.pageId === b.pageId ? 'active' : ''}`}
                  onClick={() => { setActiveBrand(b); fetchBrandAds(b.pageId, b.pageName) }}>
                  <div className="ca-brand-row-info">
                    <span className="ca-brand-row-name">{b.pageName}</span>
                    <span className="ca-brand-row-count">{b.adCount} ads</span>
                  </div>
                  <button className="ca-brand-row-x" onClick={e => { e.stopPropagation(); handleRemoveBrand(b.pageId) }}>x</button>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'top' && (
            <>
              <div className="ca-top-brand-actions">
                <button className="ca-top-select-btn" onClick={selectAllTopBrands}>Select all</button>
                <button className="ca-top-select-btn" onClick={clearTopBrands}>Clear</button>
              </div>
              <div className="ca-brand-list">
                {followedBrands.map(b => {
                  const color = brandColorMap[b.pageId]
                  const isSelected = selectedTopBrands.has(b.pageId)
                  return (
                    <div key={b.pageId} className={`ca-brand-row ca-brand-check-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleTopBrand(b.pageId)}>
                      <div className="ca-brand-check" style={isSelected ? { background: color?.border, borderColor: color?.border } : {}}>
                        {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20,6 9,17 4,12"/></svg>}
                      </div>
                      <div className="ca-brand-row-info">
                        <span className="ca-brand-row-name" style={isSelected ? { color: color?.text } : {}}>
                          {b.pageName}
                        </span>
                        <span className="ca-brand-row-count">{b.adCount} ads</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button
                className="ca-btn-load-top"
                onClick={loadTopPerformers}
                disabled={selectedTopBrands.size === 0 || topLoading}
              >
                {topLoading ? topLoadingStatus || 'Loading...' : `Analyse ${selectedTopBrands.size} brand${selectedTopBrands.size !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          <button className="ca-btn-add" onClick={() => setShowAddForm(true)}>+ Add Brand</button>
        </aside>

        <main className="ca-main">
          {viewMode === 'library' && (
            <>
              {activeBrand && (
                <div className="ca-brand-bar">
                  <h2 className="ca-brand-bar-name">{activeBrand.pageName}</h2>
                  <span className="ca-brand-bar-stats">{allAds.length} total, {videoCount} videos, {imageCount} images, {activeCount} active</span>
                </div>
              )}

              {allAds.length > 0 && (
                <div className="ca-filters">
                  <div className="ca-filter-pills">
                    {[['all', 'All'], ['video', `Video (${videoCount})`], ['image', `Image (${imageCount})`]].map(([val, label]) => (
                      <button key={val} className={`ca-pill ${typeFilter === val ? 'active' : ''}`} onClick={() => setTypeFilter(val)}>{label}</button>
                    ))}
                    <span className="ca-filter-sep">|</span>
                    {[['all', 'All status'], ['active', `Active (${activeCount})`], ['ended', 'Ended']].map(([val, label]) => (
                      <button key={val} className={`ca-pill ${statusFilter === val ? 'active' : ''}`} onClick={() => setStatusFilter(val)}>{label}</button>
                    ))}
                  </div>
                  <div className="ca-filter-right">
                    <input type="text" placeholder="Search copy..." value={searchText} onChange={e => setSearchText(e.target.value)} className="ca-search" />
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="ca-sort-select">
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="longest">Longest running</option>
                      <option value="shortest">Shortest running</option>
                    </select>
                  </div>
                </div>
              )}

              {allAds.length > 0 && (
                <div className="ca-date-range">
                  <span className="ca-date-label">Date range</span>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="ca-date-input" />
                  <span className="ca-date-to">to</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="ca-date-input" />
                  {(dateFrom || dateTo) && <button className="ca-date-clear" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</button>}
                  {(dateFrom || dateTo) && <span className="ca-date-count">{filteredAds.length} ads in range</span>}
                </div>
              )}

              {isLoading && <div className="ca-loading"><div className="ca-spin"></div><span>{loadingStatus}</span></div>}
              {error && <div className="ca-error-msg">{error} <button onClick={() => fetchBrandAds(activeBrand.pageId, activeBrand.pageName)}>Retry</button></div>}

              {!isLoading && filteredAds.length > 0 && (
                <>
                  <div className="ca-showing">Showing {Math.min(showCount, filteredAds.length)} of {filteredAds.length}</div>
                  <div className="ca-grid">
                    {pageAds.map(ad => renderAdCard(ad, false))}
                  </div>
                  {remaining > 0 && (
                    <button className="ca-load-more" onClick={() => setShowCount(c => c + GRID_PAGE)}>
                      Load more ({remaining > 0 ? remaining : 0} remaining)
                    </button>
                  )}
                </>
              )}

              {!isLoading && filteredAds.length === 0 && allAds.length > 0 && <div className="ca-empty">No ads match your filters</div>}
              {!isLoading && allAds.length === 0 && !error && !activeBrand && <div className="ca-empty">Select a brand to view their ads</div>}
              {!isLoading && allAds.length === 0 && !error && activeBrand && <div className="ca-empty">No ads found for {activeBrand.pageName}</div>}
            </>
          )}

          {viewMode === 'top' && (
            <>
              <div className="ca-brand-bar">
                <h2 className="ca-brand-bar-name">Top Performers</h2>
                <span className="ca-brand-bar-stats">
                  {topAds.length > 0
                    ? `${topFiltered.length} unique creatives from top ${topPercentile}% per brand (${topRawCutoff} of ${topRawEligible} ads) across ${selectedTopBrands.size} brand${selectedTopBrands.size !== 1 ? 's' : ''}`
                    : `Select brands and click Analyse to find top performing ads`
                  }
                </span>
              </div>

              {topAds.length > 0 && (
                <div className="ca-filters">
                  <div className="ca-filter-pills">
                    {[['all', `All (${topBrandAds.length})`], ['video', `Video (${topVideoCount})`], ['image', `Image (${topImageCount})`]].map(([val, label]) => (
                      <button key={val} className={`ca-pill ${topTypeFilter === val ? 'active' : ''}`} onClick={() => setTopTypeFilter(val)}>{label}</button>
                    ))}
                    <span className="ca-filter-sep">|</span>
                    {[1, 2.5, 5, 10, 20].map(pct => (
                      <button key={pct} className={`ca-pill ${topPercentile === pct ? 'active' : ''}`} onClick={() => setTopPercentile(pct)}>Top {pct}%</button>
                    ))}
                  </div>
                  <div className="ca-filter-right">
                    <select value={topSortBy} onChange={e => setTopSortBy(e.target.value)} className="ca-sort-select">
                      <option value="days">Days running (longevity)</option>
                      {topHasImpressions && <option value="velocity">Impressions/day (velocity)</option>}
                      {topHasImpressions && <option value="impressions">Total impressions</option>}
                    </select>
                  </div>
                </div>
              )}

              {topAds.length > 0 && (
                <div className="ca-top-explainer">
                  Ranked by {topSortBy === 'days' ? 'total days running — longer-running ads signal sustained performance' : topSortBy === 'velocity' ? 'impressions per day (higher = more spend sustained over time)' : 'total estimated impressions'}. Showing top {topPercentile}% of {topTypeFilter === 'all' ? 'all formats' : topTypeFilter + ' ads'}.{!topHasImpressions && ' Impression data not available — using longevity as the performance signal.'}
                </div>
              )}

              {/* AI Analysis button — pinned above grid for visibility */}
              {!topLoading && topFiltered.length > 0 && (
                <div className="ca-analysis-trigger">
                  <button
                    className="ca-btn-analyse"
                    onClick={runCreativeAnalysis}
                    disabled={analysisLoading || topFiltered.filter(a => !a.isVideo && a.hasMedia).length === 0}
                  >
                    {analysisLoading ? (
                      <><span className="ca-spin-sm"></span> {analysisStep === 1 ? `Analysing (${batchSummary?.step1_completed || 0}/${batchSummary?.total || '?'} images)...` : analysisStep === 1.5 ? 'Consolidating insights...' : 'Saving analysis...'}</>

                    ) : (
                      <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Analyse top creatives with AI ({(() => {
                        const seen = new Set()
                        let count = 0
                        for (const ad of topFiltered.filter(a => !a.isVideo && a.hasMedia)) {
                          for (const v of (ad.variants || [ad])) {
                            const url = v.mediaUrl || v.thumbnailUrl || ''
                            if (url && !seen.has(url) && !v.isVideo) { seen.add(url); count++ }
                          }
                        }
                        return count
                      })()} images from {topFiltered.filter(a => !a.isVideo && a.hasMedia).length} top ads)</>
                    )}
                  </button>
                  {analysisResult && !showAnalysis && (
                    <button className="ca-btn-show-analysis" onClick={() => setShowAnalysis(true)}>
                      Show previous analysis
                    </button>
                  )}
                  <button
                    className="ca-btn-history"
                    onClick={() => { if (onNavigate) onNavigate('gallery') }}
                    title="View saved ads in the Ad Library"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    Ad Library
                  </button>
                  <button
                    className="ca-btn-history"
                    onClick={() => { setShowHistory(!showHistory); if (!showHistory && !pastAnalyses.length) fetchAnalysisHistory() }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Past Runs
                  </button>
                  {showHistory && (
                    <div className="ca-history-panel">
                      <div className="ca-history-header">
                        <h4>Analysis History</h4>
                        <button className="ca-history-close" onClick={() => setShowHistory(false)}>×</button>
                      </div>
                      {historyLoading && <div className="ca-history-loading"><span className="ca-spin-sm"></span> Loading...</div>}
                      {!historyLoading && pastAnalyses.length === 0 && <div className="ca-history-empty">No past analyses found.</div>}
                      {pastAnalyses.map(a => (
                        <button
                          key={a.id}
                          className={`ca-history-item ${analysisResult?.analysis_id === a.id ? 'active' : ''}`}
                          onClick={() => loadPastAnalysis(a.id, a._source || 'competitive_analyses')}
                        >
                          <div className="ca-history-item-top">
                            <span className="ca-history-date">{new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span className={`ca-history-version ${a.pipeline_version || 'v1'}`} title={a.pipeline_version === 'v2' ? 'Consolidated pipeline' : 'Pre-consolidation pipeline'}>{a.pipeline_version || 'v1'}</span>
                              <span className={`ca-history-status ${a.status}`}>{a.status}</span>
                            </span>
                          </div>
                          <div className="ca-history-item-meta">
                            <span>{(a.brands_analysed || []).join(', ')}</span>
                            <span>Top {a.percentile}%</span>
                            <span>{a.ads_sent} ads</span>
                            <span>{a.type_filter}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Library Queue Banner */}
              {libraryQueue.length > 0 && (
                <div className="ca-library-queue-banner">
                  <div className="ca-library-queue-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    <span>{libraryQueue.length} {libraryQueue.length === 1 ? 'ad' : 'ads'} selected for Ad Library</span>
                  </div>
                  <div className="ca-library-queue-actions">
                    <button className="ca-btn-queue-view" onClick={() => { if (onNavigate) onNavigate('gallery') }}>
                      Open Ad Library
                    </button>
                    <button className="ca-btn-queue-clear" onClick={() => setLibraryQueue([])}>
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Analysis Results Panel */}
              {showAnalysis && (
                <div className="ca-analysis-panel">
                  <div className="ca-analysis-header">
                    <h3>Creative Intelligence Report</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {analysisResult && !analysisLoading && (
                        <button
                          className="ca-btn-secondary"
                          style={{ fontSize: '12px', padding: '5px 12px' }}
                          onClick={() => {
                            const r = analysisResult
                            const brands = (r._brands || []).join(', ') || 'Unknown'
                            const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                            let md = `# Creative Intelligence Report\n\n**Brands:** ${brands}  \n**Date:** ${date}  \n**Ads analysed:** ${r.adAnalyses?.length || 0}\n\n`

                            if (r.consolidation_summary) {
                              const cs = r.consolidation_summary
                              md += `## Consolidation Summary\n\n`
                              if (cs.dominantSignals?.length) md += `**Dominant signals:** ${cs.dominantSignals.join('; ')}\n\n`
                              if (cs.emergingSignals?.length) md += `**Emerging signals:** ${cs.emergingSignals.join('; ')}\n\n`
                              if (cs.formatInsights?.length) md += `**Format insights:** ${cs.formatInsights.join('; ')}\n\n`
                            }

                            if (r.themes?.length) {
                              md += `## Themes (${r.themes.length})\n\n`
                              for (const t of [...r.themes].sort((a, b) => (b.weight || 0) - (a.weight || 0))) {
                                md += `### ${t.name}${t.momentum ? ` (${t.momentum})` : ''}${t.weight ? ` — weight: ${t.weight}` : ''}\n\n${t.description || ''}\n\n`
                                if (t.brandCount) md += `Brands: ${t.brandCount} · `
                                if (t.totalDaysActive) md += `Days active: ${t.totalDaysActive}`
                                md += `\n\n`
                              }
                            }

                            if (r.personas?.length) {
                              md += `## Target Personas (${r.personas.length})\n\n`
                              for (const p of [...r.personas].sort((a, b) => (b.weight || 0) - (a.weight || 0))) {
                                md += `### ${p.name}${p.momentum ? ` (${p.momentum})` : ''}\n\n${p.description || ''}\n\n`
                                if (p.painPoints?.length) md += `**Pain points:** ${p.painPoints.join(', ')}\n\n`
                              }
                            }

                            if (r.creativePillars?.length) {
                              md += `## Creative Pillars (${r.creativePillars.length})\n\n`
                              for (const p of [...r.creativePillars].sort((a, b) => (b.weight || 0) - (a.weight || 0))) {
                                md += `### ${p.name}${p.momentum ? ` (${p.momentum})` : ''}\n\n${p.description || ''}\n\n`
                                if (p.whyItWorks) md += `**Why it works:** ${p.whyItWorks}\n\n`
                              }
                            }

                            if (r.creativeFormats?.length) {
                              md += `## Creative Formats (${r.creativeFormats.length})\n\n`
                              for (const f of [...r.creativeFormats].sort((a, b) => (b.avgDaysActive || 0) - (a.avgDaysActive || 0))) {
                                md += `### ${f.name}${f.momentum ? ` (${f.momentum})` : ''}\n\n${f.description || ''}\n\n`
                                md += `Avg days active: ${f.avgDaysActive || 0} · Max: ${f.maxDaysActive || 0} · Count: ${f.count || 0}\n\n`
                                if (f.brands?.length) md += `Brands: ${f.brands.join(', ')}\n\n`
                              }
                            }

                            const blob = new Blob([md], { type: 'text/markdown' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `creative-intel-${brands.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`
                            a.click()
                            URL.revokeObjectURL(url)
                          }}
                        >
                          ↓ Export .md
                        </button>
                      )}
                      <button className="ca-analysis-close" onClick={() => setShowAnalysis(false)}>×</button>
                    </div>
                  </div>

                  {analysisResult?._loaded_from_history && (
                    <div className="ca-history-banner">
                      Loaded from {new Date(analysisResult._loaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      &nbsp;— {(analysisResult._brands || []).join(', ')} · Top {analysisResult._percentile}% · {analysisResult._ads_sent} ads
                    </div>
                  )}

                  {analysisLoading && (
                    <div className="ca-analysis-loading">
                      <div className="ca-spin"></div>
                      {analysisStep === 1 ? (() => {
                        const completed = batchSummary?.step1_completed || 0
                        const failed = batchSummary?.step1_failed || 0
                        const total = batchSummary?.total || 0
                        const processing = batchSummary?.step1_processing || 0
                        const pct = total > 0 ? Math.round((completed / total) * 100) : 0
                        const batchSize = 3
                        const remaining = total - completed - failed
                        const currentBatch = Math.floor(completed / batchSize) + 1
                        const totalBatches = Math.ceil(total / batchSize)
                        return (
                          <>
                            <p>Step 1 — Vision analysis: {completed} / {total} images ({pct}%)</p>
                            <div className="ca-batch-progress">
                              <div className="ca-batch-bar" style={{ width: `${pct}%` }}></div>
                            </div>
                            {(batchSummary?.reused_step1 > 0) && (
                              <p className="ca-analysis-loading-sub" style={{ color: '#4ade80' }}>Reused {batchSummary.reused_step1} cached {batchSummary.reused_step1 === 1 ? 'analysis' : 'analyses'} from previous runs</p>
                            )}
                            {processing > 0 && (
                              <p className="ca-analysis-loading-sub">Analysing batch {currentBatch} of {totalBatches} ({processing} {processing === 1 ? 'image' : 'images'} in progress)...</p>
                            )}
                            {failed > 0 && (
                              <p className="ca-analysis-loading-sub" style={{ color: '#f87171' }}>{failed} {failed === 1 ? 'image' : 'images'} failed. Will continue with remaining images.</p>
                            )}
                            <p className="ca-analysis-loading-sub" style={{ opacity: 0.5 }}>Opus is performing forensic visual analysis in batches of {batchSize}. Extracting layout grids, typography specs, colour palettes, camera angles, and lighting. ~30 to 60s per batch.</p>
                          </>
                        )
                      })() : analysisStep === 1.5 ? (
                        <>
                          <p>Consolidating insights...</p>
                          <div className="ca-batch-progress">
                            <div className="ca-batch-bar ca-batch-bar-pulse" style={{ width: '60%' }}></div>
                          </div>
                          <p className="ca-analysis-loading-sub">Merging duplicate themes, personas, and pillars across batches into a clean, non-overlapping set. One-time step, ~15 to 30s.</p>
                        </>
                      ) : (
                        <>
                          <p>Saving intelligence report...</p>
                          <p className="ca-analysis-loading-sub">Storing {batchSummary?.step1_completed || batchSummary?.total || ''} image analyses to your history.</p>
                        </>
                      )}
                    </div>
                  )}

                  {analysisError && (
                    <div className="ca-analysis-error">
                      <strong>Analysis failed:</strong> {analysisError}
                      <button className="ca-btn-retry" onClick={runCreativeAnalysis}>Retry</button>
                    </div>
                  )}

                  {analysisResult && !analysisLoading && (
                    <>
                      <div className="ca-analysis-tabs">
                        <button className={`ca-analysis-tab ${analysisTab === 'overview' ? 'active' : ''}`} onClick={() => setAnalysisTab('overview')}>Themes & Pillars</button>
                        <button className={`ca-analysis-tab ${analysisTab === 'trends' ? 'active' : ''}`} onClick={() => { setAnalysisTab('trends'); loadTrendsData() }}>Market Trends</button>
                        <button className={`ca-analysis-tab ${analysisTab === 'ads' ? 'active' : ''}`} onClick={() => setAnalysisTab('ads')}>Per-Ad Breakdown ({analysisResult.adAnalyses?.length || 0})</button>
                      </div>

                      {analysisTab === 'overview' && (
                        <div className="ca-analysis-overview">
                          {analysisResult.themes?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Themes <span className="ca-section-count">{analysisResult.themes.length}</span></h4>
                              <div className="ca-ranked-list">
                                {[...analysisResult.themes].sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((t, i) => (
                                  <div key={i} className={`ca-ranked-card ca-card-theme ${t.momentum ? 'ca-momentum-' + t.momentum : ''}`}>
                                    <div className="ca-ranked-rank">#{i + 1}</div>
                                    <div className="ca-ranked-content">
                                      <div className="ca-ranked-header">
                                        <h5>{t.name}</h5>
                                        {t.momentum && <span className={`ca-momentum-tag ca-tag-${t.momentum}`}>{t.momentum}</span>}
                                      </div>
                                      <p>{t.description}</p>
                                      {t.weight != null && (
                                        <div className="ca-weight-row">
                                          <div className="ca-weight-bar-bg">
                                            <div className="ca-weight-bar ca-weight-bar-theme" style={{ width: `${Math.min(t.weight, 100)}%` }}></div>
                                          </div>
                                          <span className="ca-weight-val">{Math.round(t.weight)}</span>
                                        </div>
                                      )}
                                      <div className="ca-ranked-meta">
                                        {t.brandCount && <span className="ca-meta-chip">{t.brandCount} brand{t.brandCount !== 1 ? 's' : ''}</span>}
                                        {t.totalDaysActive && <span className="ca-meta-chip">{t.totalDaysActive}d active</span>}
                                        {!t.weight && t.frequency && <span className="ca-meta-chip">{t.frequency}</span>}
                                        {t.topAds?.length > 0 && <span className="ca-meta-chip ca-meta-chip-subtle">Top: {t.topAds.slice(0, 2).map(a => a.page_name || a.headline || 'Ad').join(', ')}</span>}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.personas?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Target Personas <span className="ca-section-count">{analysisResult.personas.length}</span></h4>
                              <div className="ca-ranked-list">
                                {[...analysisResult.personas].sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((p, i) => (
                                  <div key={i} className={`ca-ranked-card ca-card-persona ${p.momentum ? 'ca-momentum-' + p.momentum : ''}`}>
                                    <div className="ca-ranked-rank">#{i + 1}</div>
                                    <div className="ca-ranked-content">
                                      <div className="ca-ranked-header">
                                        <h5>{p.name}</h5>
                                        {p.momentum && <span className={`ca-momentum-tag ca-tag-${p.momentum}`}>{p.momentum}</span>}
                                      </div>
                                      <p>{p.description}</p>
                                      {p.weight != null && (
                                        <div className="ca-weight-row">
                                          <div className="ca-weight-bar-bg">
                                            <div className="ca-weight-bar ca-weight-bar-persona" style={{ width: `${Math.min(p.weight, 100)}%` }}></div>
                                          </div>
                                          <span className="ca-weight-val">{Math.round(p.weight)}</span>
                                        </div>
                                      )}
                                      <div className="ca-ranked-meta">
                                        {p.brandCount && <span className="ca-meta-chip">{p.brandCount} brand{p.brandCount !== 1 ? 's' : ''}</span>}
                                        {p.totalDaysActive && <span className="ca-meta-chip">{p.totalDaysActive}d active</span>}
                                        {!p.weight && p.frequency && <span className="ca-meta-chip">{p.frequency}</span>}
                                      </div>
                                      {p.painPoints?.length > 0 && (
                                        <div className="ca-card-pills">
                                          {p.painPoints.map((pp, j) => <span key={j} className="ca-pill-pain">{pp}</span>)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.creativePillars?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Creative Pillars <span className="ca-section-count">{analysisResult.creativePillars.length}</span></h4>
                              <div className="ca-ranked-list">
                                {[...analysisResult.creativePillars].sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((cp, i) => (
                                  <div key={i} className={`ca-ranked-card ca-card-pillar ${cp.momentum ? 'ca-momentum-' + cp.momentum : ''}`}>
                                    <div className="ca-ranked-rank">#{i + 1}</div>
                                    <div className="ca-ranked-content">
                                      <div className="ca-ranked-header">
                                        <h5>{cp.name}</h5>
                                        {cp.momentum && <span className={`ca-momentum-tag ca-tag-${cp.momentum}`}>{cp.momentum}</span>}
                                      </div>
                                      <p>{cp.description}</p>
                                      {cp.weight != null && (
                                        <div className="ca-weight-row">
                                          <div className="ca-weight-bar-bg">
                                            <div className="ca-weight-bar ca-weight-bar-pillar" style={{ width: `${Math.min(cp.weight, 100)}%` }}></div>
                                          </div>
                                          <span className="ca-weight-val">{Math.round(cp.weight)}</span>
                                        </div>
                                      )}
                                      <div className="ca-ranked-meta">
                                        {cp.brandCount && <span className="ca-meta-chip">{cp.brandCount} brand{cp.brandCount !== 1 ? 's' : ''}</span>}
                                        {cp.totalDaysActive && <span className="ca-meta-chip">{cp.totalDaysActive}d active</span>}
                                        {!cp.weight && cp.frequency && <span className="ca-meta-chip">{cp.frequency}</span>}
                                      </div>
                                      {cp.whyItWorks && <p className="ca-card-why"><strong>Why it works:</strong> {cp.whyItWorks}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.creativeFormats?.length > 0 && (
                            <div className="ca-analysis-section">
                              <h4>Creative Formats <span className="ca-section-count">{analysisResult.creativeFormats.length}</span></h4>
                              <div className="ca-ranked-list">
                                {[...analysisResult.creativeFormats].sort((a, b) => (b.weight || b.avgDaysActive || 0) - (a.weight || a.avgDaysActive || 0)).map((f, i) => (
                                  <div key={i} className={`ca-ranked-card ca-card-format ${f.momentum ? 'ca-momentum-' + f.momentum : ''}`}>
                                    <div className="ca-ranked-rank">#{i + 1}</div>
                                    <div className="ca-ranked-content">
                                      <div className="ca-ranked-header">
                                        <h5>{f.name}</h5>
                                        {f.momentum && <span className={`ca-momentum-tag ca-tag-${f.momentum}`}>{f.momentum}</span>}
                                        {f.longevityRank && <span className="ca-meta-chip" style={{ marginLeft: 8, background: '#6366f120', color: '#818cf8' }}>longevity #{f.longevityRank}</span>}
                                      </div>
                                      <p>{f.description}</p>
                                      {f.weight != null && (
                                        <div className="ca-weight-row">
                                          <div className="ca-weight-bar-bg">
                                            <div className="ca-weight-bar" style={{ width: `${Math.min(f.weight, 100)}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)' }}></div>
                                          </div>
                                          <span className="ca-weight-val">{Math.round(f.weight)}</span>
                                        </div>
                                      )}
                                      <div className="ca-ranked-meta">
                                        {f.count && <span className="ca-meta-chip">{f.count} ad{f.count !== 1 ? 's' : ''}</span>}
                                        {f.brandCount && <span className="ca-meta-chip">{f.brandCount} brand{f.brandCount !== 1 ? 's' : ''}</span>}
                                        {f.avgDaysActive && <span className="ca-meta-chip" style={{ background: '#22c55e20', color: '#4ade80' }}>avg {f.avgDaysActive}d</span>}
                                        {f.maxDaysActive && <span className="ca-meta-chip" style={{ background: '#f9731620', color: '#fb923c' }}>max {f.maxDaysActive}d</span>}
                                      </div>
                                      {f.brands?.length > 0 && (
                                        <div className="ca-card-pills">
                                          {f.brands.map((b, j) => <span key={j} className="ca-pill-pain" style={{ background: '#3b82f620', color: '#60a5fa', borderColor: '#3b82f640' }}>{b}</span>)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Market Trends tab ── */}
                      {analysisTab === 'trends' && (
                        <div className="ca-analysis-overview ca-trends-tab">
                          {trendsLoading && (
                            <div className="ca-trends-loading">
                              <div className="ca-batch-bar-pulse" style={{ width: 120, height: 4, background: '#6366f1', borderRadius: 2 }}></div>
                              <p style={{ color: '#71717a', fontSize: 13, marginTop: 10 }}>Loading trend data across all v2 runs...</p>
                            </div>
                          )}
                          {trendsData && !trendsLoading && trendsData.runs.length === 0 && (
                            <div className="ca-trends-empty">
                              <p style={{ color: '#71717a', fontSize: 14, textAlign: 'center', padding: '40px 20px' }}>
                                No v2 pipeline runs found yet. Run a new analysis to start tracking trends over time.
                              </p>
                            </div>
                          )}
                          {trendsData && !trendsLoading && trendsData.runs.length === 1 && (
                            <div className="ca-trends-single">
                              <p style={{ color: '#a0a0b0', fontSize: 14, textAlign: 'center', padding: '30px 20px' }}>
                                One v2 run found ({trendsData.runs[0].date}). Run another analysis to start seeing trend comparisons.
                              </p>
                            </div>
                          )}
                          {trendsData && !trendsLoading && trendsData.runs.length >= 1 && (
                            <>
                              <div className="ca-trends-header">
                                <h4>Market Trends</h4>
                                <p className="ca-trends-sub">{trendsData.runs.length} run{trendsData.runs.length !== 1 ? 's' : ''} tracked: {trendsData.runs.map(r => r.date).join(' → ')}</p>
                              </div>

                              {trendsData.themes.length > 0 && (
                                <div className="ca-analysis-section">
                                  <h4>Theme Trends <span className="ca-section-count">{trendsData.themes.length}</span></h4>
                                  <div className="ca-trends-list">
                                    {trendsData.themes.map((t, i) => (
                                      <div key={i} className="ca-trend-row">
                                        <div className="ca-trend-name">
                                          <span className="ca-trend-rank">#{i + 1}</span>
                                          <span>{t.name}</span>
                                          <span className={`ca-trend-dir ca-trend-${t.trend}`}>
                                            {t.trend === 'rising' ? '↑' : t.trend === 'declining' ? '↓' : t.trend === 'new' ? '★' : '→'}
                                            {t.trend !== 'new' && t.trendDelta !== 0 && ` ${t.trendDelta > 0 ? '+' : ''}${Math.round(t.trendDelta)}`}
                                          </span>
                                        </div>
                                        <div className="ca-trend-sparkline">
                                          {t.points.map((pt, j) => (
                                            <div key={j} className="ca-spark-bar-wrap" title={`${pt.date}: weight ${Math.round(pt.weight)}`}>
                                              <div className="ca-spark-bar ca-spark-theme" style={{ height: `${Math.max(pt.weight, 4)}%` }}></div>
                                              <span className="ca-spark-label">{pt.date}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="ca-trend-latest">
                                          <span className="ca-trend-weight">{Math.round(t.points[t.points.length - 1]?.weight || 0)}</span>
                                          <span className={`ca-momentum-tag ca-tag-${t.points[t.points.length - 1]?.momentum || 'niche'}`}>{t.points[t.points.length - 1]?.momentum || 'niche'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {trendsData.personas.length > 0 && (
                                <div className="ca-analysis-section">
                                  <h4>Persona Trends <span className="ca-section-count">{trendsData.personas.length}</span></h4>
                                  <div className="ca-trends-list">
                                    {trendsData.personas.map((p, i) => (
                                      <div key={i} className="ca-trend-row">
                                        <div className="ca-trend-name">
                                          <span className="ca-trend-rank">#{i + 1}</span>
                                          <span>{p.name}</span>
                                          <span className={`ca-trend-dir ca-trend-${p.trend}`}>
                                            {p.trend === 'rising' ? '↑' : p.trend === 'declining' ? '↓' : p.trend === 'new' ? '★' : '→'}
                                            {p.trend !== 'new' && p.trendDelta !== 0 && ` ${p.trendDelta > 0 ? '+' : ''}${Math.round(p.trendDelta)}`}
                                          </span>
                                        </div>
                                        <div className="ca-trend-sparkline">
                                          {p.points.map((pt, j) => (
                                            <div key={j} className="ca-spark-bar-wrap" title={`${pt.date}: weight ${Math.round(pt.weight)}`}>
                                              <div className="ca-spark-bar ca-spark-persona" style={{ height: `${Math.max(pt.weight, 4)}%` }}></div>
                                              <span className="ca-spark-label">{pt.date}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="ca-trend-latest">
                                          <span className="ca-trend-weight">{Math.round(p.points[p.points.length - 1]?.weight || 0)}</span>
                                          <span className={`ca-momentum-tag ca-tag-${p.points[p.points.length - 1]?.momentum || 'niche'}`}>{p.points[p.points.length - 1]?.momentum || 'niche'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {trendsData.pillars.length > 0 && (
                                <div className="ca-analysis-section">
                                  <h4>Pillar Trends <span className="ca-section-count">{trendsData.pillars.length}</span></h4>
                                  <div className="ca-trends-list">
                                    {trendsData.pillars.map((pl, i) => (
                                      <div key={i} className="ca-trend-row">
                                        <div className="ca-trend-name">
                                          <span className="ca-trend-rank">#{i + 1}</span>
                                          <span>{pl.name}</span>
                                          <span className={`ca-trend-dir ca-trend-${pl.trend}`}>
                                            {pl.trend === 'rising' ? '↑' : pl.trend === 'declining' ? '↓' : pl.trend === 'new' ? '★' : '→'}
                                            {pl.trend !== 'new' && pl.trendDelta !== 0 && ` ${pl.trendDelta > 0 ? '+' : ''}${Math.round(pl.trendDelta)}`}
                                          </span>
                                        </div>
                                        <div className="ca-trend-sparkline">
                                          {pl.points.map((pt, j) => (
                                            <div key={j} className="ca-spark-bar-wrap" title={`${pt.date}: weight ${Math.round(pt.weight)}`}>
                                              <div className="ca-spark-bar ca-spark-pillar" style={{ height: `${Math.max(pt.weight, 4)}%` }}></div>
                                              <span className="ca-spark-label">{pt.date}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="ca-trend-latest">
                                          <span className="ca-trend-weight">{Math.round(pl.points[pl.points.length - 1]?.weight || 0)}</span>
                                          <span className={`ca-momentum-tag ca-tag-${pl.points[pl.points.length - 1]?.momentum || 'niche'}`}>{pl.points[pl.points.length - 1]?.momentum || 'niche'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Chefly Prompts tab removed in v3 — prompt writing happens in Cowork */}

                      {analysisTab === 'ads' && (
                        <div className="ca-analysis-ads">
                          {analysisResult.adAnalyses?.map((ad, i) => {
                            // Find matching source image from batch data
                            const batchImg = analysisResult._batch_images?.find(img => img.step1_analysis?.adIndex === ad.adIndex)
                            return (
                            <div key={i} className="ca-ad-analysis-card">
                              <div className="ca-ad-analysis-header">
                                <span className="ca-ad-index">Ad {ad.adIndex}</span>
                                <span className="ca-ad-brand">{ad.brand}</span>
                                {ad.visualCluster && <span className="ca-ad-cluster">{ad.visualCluster}</span>}
                                <span className="ca-ad-score" style={{ background: ad.strengthScore >= 7 ? 'rgba(34,197,94,0.15)' : ad.strengthScore >= 5 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)', color: ad.strengthScore >= 7 ? '#22c55e' : ad.strengthScore >= 5 ? '#eab308' : '#ef4444' }}>
                                  {ad.strengthScore}/10
                                </span>
                              </div>

                              {/* Source image thumbnail */}
                              {batchImg?.image_url && (
                                <div className="ca-ad-source-thumb">
                                  <img src={batchImg.image_url} alt="" loading="lazy" onError={handleImgError} />
                                  <div className="ca-img-fallback" style={{ display: 'none' }}><span className="ca-fallback-text">Image unavailable</span></div>
                                </div>
                              )}

                              <div className="ca-ad-analysis-body">
                                <div className="ca-ad-meta-row">
                                  <span><strong>Format:</strong> {ad.format}</span>
                                  <span><strong>Days:</strong> {ad.daysRunning}</span>
                                </div>

                                {/* Layout (v15 nested or v14 flat) */}
                                {ad.layout ? (
                                  <details className="ca-ad-detail-section">
                                    <summary>Layout & Composition</summary>
                                    {ad.layout.grid && <p><strong>Grid:</strong> {ad.layout.grid}</p>}
                                    {ad.layout.aspectRatio && <p><strong>Aspect ratio:</strong> {ad.layout.aspectRatio}</p>}
                                    {ad.layout.visualHierarchy && <p><strong>Hierarchy:</strong> {ad.layout.visualHierarchy}</p>}
                                    {ad.layout.whitespace && <p><strong>Whitespace:</strong> {ad.layout.whitespace}</p>}
                                    {ad.layout.composition && <p className="ca-ad-long-text">{ad.layout.composition}</p>}
                                  </details>
                                ) : ad.visualLayout && (
                                  <p><strong>Layout:</strong> {ad.visualLayout}</p>
                                )}

                                {/* Typography (v15 nested or v14 flat) */}
                                {ad.typography && typeof ad.typography === 'object' ? (
                                  <details className="ca-ad-detail-section">
                                    <summary>Typography</summary>
                                    {ad.typography.headlineFont && <p><strong>Headline:</strong> {ad.typography.headlineFont}</p>}
                                    {ad.typography.subheadFont && ad.typography.subheadFont !== 'none' && <p><strong>Subhead:</strong> {ad.typography.subheadFont}</p>}
                                    {ad.typography.bodyFont && ad.typography.bodyFont !== 'none' && <p><strong>Body/CTA:</strong> {ad.typography.bodyFont}</p>}
                                    {ad.typography.textPlacement && <p><strong>Placement:</strong> {ad.typography.textPlacement}</p>}
                                    {ad.typography.textEffects && <p><strong>Effects:</strong> {ad.typography.textEffects}</p>}
                                  </details>
                                ) : ad.typography && (
                                  <p><strong>Typography:</strong> {ad.typography}</p>
                                )}

                                {/* Colour palette (v15 nested or v14 flat) */}
                                {ad.colour ? (
                                  <details className="ca-ad-detail-section">
                                    <summary>Colour</summary>
                                    {ad.colour.dominantColour && <p><strong>Dominant:</strong> {ad.colour.dominantColour}</p>}
                                    {ad.colour.accentColour && <p><strong>Accent:</strong> {ad.colour.accentColour}</p>}
                                    {ad.colour.colourTemperature && <p><strong>Temperature:</strong> {ad.colour.colourTemperature}</p>}
                                    {ad.colour.contrast && <p><strong>Contrast:</strong> {ad.colour.contrast}</p>}
                                    {ad.colour.palette?.length > 0 && (
                                      <div className="ca-ad-colors">
                                        {ad.colour.palette.map((c, j) => {
                                          const hex = typeof c === 'string' ? c.match(/#[0-9a-fA-F]{3,6}/)?.[0] : null
                                          return <span key={j} className="ca-color-swatch-label">{hex && <span className="ca-color-swatch" style={{ background: hex }}></span>}{typeof c === 'string' ? c : JSON.stringify(c)}</span>
                                        })}
                                      </div>
                                    )}
                                  </details>
                                ) : ad.dominantColors?.length > 0 && (
                                  <div className="ca-ad-colors">
                                    {ad.dominantColors.map((c, j) => (
                                      <span key={j} className="ca-color-swatch" style={{ background: c }} title={c}></span>
                                    ))}
                                  </div>
                                )}

                                {/* Photography (v15 only) */}
                                {ad.photography && (
                                  <details className="ca-ad-detail-section">
                                    <summary>Photography</summary>
                                    {ad.photography.subjectMatter && <p><strong>Subject:</strong> {ad.photography.subjectMatter}</p>}
                                    {ad.photography.cameraAngle && <p><strong>Camera angle:</strong> {ad.photography.cameraAngle}</p>}
                                    {ad.photography.focalLength && <p><strong>Focal length:</strong> {ad.photography.focalLength}</p>}
                                    {ad.photography.depthOfField && <p><strong>Depth of field:</strong> {ad.photography.depthOfField}</p>}
                                    {ad.photography.lighting && <p><strong>Lighting:</strong> {ad.photography.lighting}</p>}
                                    {ad.photography.postProcessing && <p><strong>Post-processing:</strong> {ad.photography.postProcessing}</p>}
                                  </details>
                                )}

                                {/* Product (v15 only) */}
                                {ad.product && (
                                  <details className="ca-ad-detail-section">
                                    <summary>Product</summary>
                                    {ad.product.visibility && <p><strong>Visibility:</strong> {ad.product.visibility}</p>}
                                    {ad.product.packagingDetails && <p><strong>Packaging:</strong> {ad.product.packagingDetails}</p>}
                                    {ad.product.foodStyling && <p><strong>Food styling:</strong> {ad.product.foodStyling}</p>}
                                    {ad.product.proportion && <p><strong>Frame proportion:</strong> {ad.product.proportion}</p>}
                                  </details>
                                )}

                                {/* Offer (v15 nested or v14 flat) */}
                                {ad.offer && typeof ad.offer === 'object' ? (
                                  <details className="ca-ad-detail-section">
                                    <summary>Offer & CTA</summary>
                                    {ad.offer.structure && <p><strong>Structure:</strong> {ad.offer.structure}</p>}
                                    {ad.offer.urgency && <p><strong>Urgency:</strong> {ad.offer.urgency}</p>}
                                    {ad.offer.pricePresentation && <p><strong>Price:</strong> {ad.offer.pricePresentation}</p>}
                                    {ad.offer.cta && <p><strong>CTA:</strong> {ad.offer.cta}</p>}
                                  </details>
                                ) : (
                                  <>
                                    {ad.heroElement && <p><strong>Hero element:</strong> {ad.heroElement}</p>}
                                    {ad.offerStructure && <p><strong>Offer/CTA:</strong> {ad.offerStructure}</p>}
                                  </>
                                )}

                                <p><strong>Emotional hook:</strong> {ad.emotionalHook}</p>
                                <p className="ca-ad-why">{ad.whyItWorks}</p>
                                {ad.howToAdapt && <p className="ca-ad-adapt"><strong>How to adapt:</strong> {ad.howToAdapt}</p>}
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {topLoading && <div className="ca-loading"><div className="ca-spin"></div><span>{topLoadingStatus}</span></div>}
              {topError && <div className="ca-error-msg">{topError}</div>}

              {!topLoading && topFiltered.length > 0 && (
                <>
                  <div className="ca-showing">
                    Showing {Math.min(topShowCount, topFiltered.length)} of {topFiltered.length} top performers
                    <div className="ca-top-legend">
                      {followedBrands.filter(b => selectedTopBrands.has(b.pageId)).map(b => {
                        const color = brandColorMap[b.pageId]
                        const count = topFiltered.filter(a => a.pageId === b.pageId).length
                        return (
                          <span key={b.pageId} className="ca-legend-item" style={{ color: color?.text }}>
                            <span className="ca-legend-dot" style={{ background: color?.border }}></span>
                            {b.pageName} ({count})
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  {/* Video analysis notification banner */}
                  {videoAnalysisNotice && (
                    <div className={`ca-video-notice ca-video-notice-${videoAnalysisNotice.type}`}>
                      <span>{videoAnalysisNotice.message}</span>
                      <button onClick={() => setVideoAnalysisNotice(null)}>&times;</button>
                    </div>
                  )}

                  {/* Bulk video analysis toolbar */}
                  {selectedVideoIds.size > 0 && (
                    <div className="ca-bulk-toolbar">
                      <span className="ca-bulk-count">{selectedVideoIds.size} video{selectedVideoIds.size !== 1 ? 's' : ''} selected</span>
                      <button className="ca-bulk-analyse-btn" onClick={handleBulkAnalyse}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                        Analyse {selectedVideoIds.size} Video{selectedVideoIds.size !== 1 ? 's' : ''}
                      </button>
                      <button className="ca-bulk-clear-btn" onClick={() => setSelectedVideoIds(new Set())} title="Clear selection">&times;</button>
                    </div>
                  )}

                  <div className="ca-grid">
                    {topPageAds.map(ad => renderAdCard(ad, true))}
                  </div>
                  {topRemaining > 0 && (
                    <button className="ca-load-more" onClick={() => setTopShowCount(c => c + GRID_PAGE)}>
                      Load more ({topRemaining} remaining)
                    </button>
                  )}

                </>
              )}

              {!topLoading && topAds.length > 0 && topFiltered.length === 0 && (
                <div className="ca-empty">No ads match the current filters. Try widening the percentile or changing the format filter.</div>
              )}

              {!topLoading && topAds.length === 0 && !topError && selectedTopBrands.size === 0 && (
                <div className="ca-empty ca-empty-top">
                  <div className="ca-empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a4a" strokeWidth="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
                  </div>
                  <div className="ca-empty-title">Select brands to compare</div>
                  <div className="ca-empty-desc">Tick one or more brands in the sidebar, then click Analyse to see their top performing ads ranked by velocity.</div>
                </div>
              )}

              {!topLoading && topAds.length === 0 && !topError && selectedTopBrands.size > 0 && (
                <div className="ca-empty ca-empty-top">
                  <div className="ca-empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a4a" strokeWidth="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
                  </div>
                  <div className="ca-empty-title">Ready to analyse</div>
                  <div className="ca-empty-desc">{selectedTopBrands.size} brand{selectedTopBrands.size !== 1 ? 's' : ''} selected. Click <strong>Analyse</strong> in the sidebar to load and rank their ads.</div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {modalAd && (() => {
        const variants = modalAd.variants || [modalAd]
        // Deduplicate by unique image URL so we only cycle distinct creatives
        const seen = new Set()
        const uniqueVariants = variants.filter(v => {
          const key = v.mediaUrl || v.adId
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        const hasMultiple = uniqueVariants.length > 1
        const current = uniqueVariants[variantIndex % uniqueVariants.length] || modalAd
        const goNext = () => setVariantIndex(i => (i + 1) % uniqueVariants.length)
        const goPrev = () => setVariantIndex(i => (i - 1 + uniqueVariants.length) % uniqueVariants.length)

        return (
        <div className="ca-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setModalAd(null) }}>
          <div className="ca-modal" onClick={e => e.stopPropagation()}>
            <button className="ca-modal-x" onClick={() => setModalAd(null)}>x</button>
            <div className="ca-modal-media">
              {hasMultiple && (
                <button className="ca-variant-arrow ca-variant-prev" onClick={goPrev} title="Previous variant">&lsaquo;</button>
              )}
              {current.isVideo && (current.videoUrl || current.mediaUrl) ? (
                <video
                  key={current.adId}
                  src={current.videoUrl || current.mediaUrl}
                  controls
                  playsInline
                  webkit-playsinline="true"
                  x-webkit-airplay="allow"
                  autoPlay
                  muted
                  className="ca-modal-video"
                />
              ) : current.mediaUrl ? (
                <img key={current.adId} src={current.mediaUrl} alt="" className="ca-modal-img" />
              ) : null}
              {hasMultiple && (
                <button className="ca-variant-arrow ca-variant-next" onClick={goNext} title="Next variant">&rsaquo;</button>
              )}
              {hasMultiple && (
                <div className="ca-variant-counter">{(variantIndex % uniqueVariants.length) + 1} / {uniqueVariants.length} variants</div>
              )}
            </div>
            <div className="ca-modal-detail">
              <h3 className="ca-modal-title">{current.adName}</h3>
              {current.adBody && <div className="ca-modal-body">{current.adBody}</div>}
              {current.adCaption && <div className="ca-modal-caption">{current.adCaption}</div>}
              {hasMultiple && (
                <div className="ca-variant-dots">
                  {uniqueVariants.map((v, i) => (
                    <button
                      key={v.adId}
                      className={`ca-variant-dot ${i === variantIndex % uniqueVariants.length ? 'active' : ''}`}
                      onClick={() => setVariantIndex(i)}
                      title={`Variant ${i + 1}: ${v.adName}`}
                    />
                  ))}
                </div>
              )}
              <div className="ca-modal-meta-grid">
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Brand</span><span>{modalAd.pageName}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Ad ID</span><span>{current.adId}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Type</span><span>{modalAd.displayFormat || modalAd.creativeType}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Running</span><span>{modalAd.daysActive} days</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Dates</span><span>{modalAd.startDate} to {modalAd.endDate || 'now'}</span></div>
                <div className="ca-modal-meta-item"><span className="ca-modal-label">Status</span><span className={`ca-status-dot ${modalAd.status}`}>{modalAd.status}</span></div>
                {modalAd.impressionsText && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Impressions</span><span>{modalAd.impressionsText}</span></div>
                )}
                {modalAd.velocity > 0 && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Velocity</span><span>{formatNumber(Math.round(modalAd.velocity))} imp/day</span></div>
                )}
                {modalAd.platforms.length > 0 && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Platforms</span><span>{modalAd.platforms.join(', ')}</span></div>
                )}
                {modalAd.creativeTargeting && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">Targeting</span><span>{modalAd.creativeTargeting}</span></div>
                )}
                {modalAd.ctaType && (
                  <div className="ca-modal-meta-item"><span className="ca-modal-label">CTA</span><span>{modalAd.ctaType}</span></div>
                )}
              </div>
              <div className="ca-modal-actions">
                <a href={modalAd.url} target="_blank" rel="noopener noreferrer" className="ca-btn-primary">View on Meta</a>
              </div>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
