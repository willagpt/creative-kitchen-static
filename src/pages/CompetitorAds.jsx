import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const BATCH_FN = `${SUPABASE_URL}/functions/v1/process-analysis-batch`

const TABS = ['Ad Library', 'Analysis']
const ANALYSIS_TABS = ['Themes', 'Personas', 'Pillars', 'Clusters', 'Per-Ad Breakdown']

const MOMENTUM_COLORS = {
  dominant: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  strong: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  emerging: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  niche: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', border: 'border-zinc-500/30' },
}

function WeightBar({ weight, momentum }) {
  const colors = MOMENTUM_COLORS[momentum] || MOMENTUM_COLORS.niche
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-[var(--bg-2)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            momentum === 'dominant' ? 'bg-orange-500' :
            momentum === 'strong' ? 'bg-blue-500' :
            momentum === 'emerging' ? 'bg-green-500' : 'bg-zinc-500'
          }`}
          style={{ width: `${weight}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-500 w-8 text-right">{weight}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
        {momentum}
      </span>
    </div>
  )
}

function WeightedCard({ item, type }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="card-sm hover:border-zinc-600 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{item.name}</h4>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.brandCount && (
            <span className="badge badge-neutral text-[10px]">{item.brandCount} brand{item.brandCount !== 1 ? 's' : ''}</span>
          )}
          {item.totalDaysActive && (
            <span className="badge badge-accent text-[10px]">{item.totalDaysActive}d</span>
          )}
        </div>
      </div>
      <WeightBar weight={item.weight || 0} momentum={item.momentum || 'niche'} />
      <p className={`text-xs text-zinc-400 mt-2 ${expanded ? '' : 'line-clamp-3'}`}>
        {item.description}
      </p>
      {item.description && item.description.length > 150 && (
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-orange-400 mt-1 hover:underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {type === 'persona' && item.painPoints && item.painPoints.length > 0 && (
        <div className="mt-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Pain Points</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {item.painPoints.map((p, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
      {type === 'pillar' && item.whyItWorks && (
        <div className={`mt-2 text-[11px] text-zinc-500 ${expanded ? '' : 'line-clamp-2'}`}>
          <span className="text-zinc-600">Why it works:</span> {item.whyItWorks}
        </div>
      )}
      {type === 'cluster' && item.whyBrandsUseThis && (
        <div className={`mt-2 text-[11px] text-zinc-500 ${expanded ? '' : 'line-clamp-2'}`}>
          <span className="text-zinc-600">Why brands use this:</span> {item.whyBrandsUseThis}
        </div>
      )}
      {item.adIndices && item.adIndices.length > 0 && (
        <div className="text-[10px] text-zinc-600 mt-2">{item.adIndices.length} ad{item.adIndices.length !== 1 ? 's' : ''}</div>
      )}
    </div>
  )
}

export default function CompetitorAds() {
  // Library state
  const [brands, setBrands] = useState([])
  const [selectedBrand, setSelectedBrand] = useState('all')
  const [ads, setAds] = useState([])
  const [adsLoading, setAdsLoading] = useState(true)
  const [adsPage, setAdsPage] = useState(0)
  const [adsTotal, setAdsTotal] = useState(0)
  const [selectedAds, setSelectedAds] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const ADS_PER_PAGE = 60

  // Analysis state
  const [tab, setTab] = useState(0)
  const [analysisTab, setAnalysisTab] = useState(0)
  const [jobs, setJobs] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [jobResults, setJobResults] = useState(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineMsg, setPipelineMsg] = useState('')
  const pollRef = useRef(null)

  // Load brands
  useEffect(() => {
    supabase.from('followed_brands').select('*').order('created_at').then(({ data }) => {
      if (data) setBrands(data)
    })
  }, [])

  // Load ads
  useEffect(() => {
    setAdsLoading(true)
    let query = supabase
      .from('competitor_ads')
      .select('id, thumbnail_url, snapshot_url, page_name, creative_title, creative_body, start_date, days_active, display_format, is_active, impressions_lower, impressions_upper, platforms, video_url', { count: 'exact' })
      .order('days_active', { ascending: false })
      .range(adsPage * ADS_PER_PAGE, (adsPage + 1) * ADS_PER_PAGE - 1)

    if (selectedBrand !== 'all') {
      query = query.eq('page_name', selectedBrand)
    }

    // Only show image ads (exclude video)
    query = query.eq('display_format', 'IMAGE')

    query.then(({ data, count }) => {
      setAds(data || [])
      setAdsTotal(count || 0)
      setAdsLoading(false)
    })
  }, [selectedBrand, adsPage])

  // Load completed jobs
  useEffect(() => {
    loadJobs()
  }, [])

  const loadJobs = async () => {
    const { data } = await supabase
      .from('analysis_jobs')
      .select('id, status, brands_analysed, total_images, completed_step1, pipeline_version, consolidation_summary, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setJobs(data)
  }

  // Toggle ad selection
  const toggleAd = (id) => {
    setSelectedAds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selectedAds.size === ads.length) {
      setSelectedAds(new Set())
    } else {
      setSelectedAds(new Set(ads.map(a => a.id)))
    }
  }

  // Run analysis
  const runAnalysis = async () => {
    const selected = ads.filter(a => selectedAds.has(a.id))
    if (selected.length === 0) return

    const brandsInSelection = [...new Set(selected.map(a => a.page_name))]

    const payload = {
      action: 'create',
      ads: selected.map(a => ({
        id: a.id,
        imageUrl: a.thumbnail_url || a.snapshot_url,
        title: a.creative_title || '',
        body: a.creative_body || '',
        daysActive: a.days_active || 0,
        displayFormat: a.display_format || 'IMAGE',
        pageName: a.page_name || '',
        isVideo: false,
      })),
      brands_analysed: brandsInSelection,
    }

    setPipelineRunning(true)
    setPipelineMsg('Creating analysis job...')
    setTab(1)

    try {
      const res = await fetch(BATCH_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setActiveJobId(data.job_id)
      setPipelineMsg(`Job created: ${data.total_images} images (${data.reused_step1} cached). Processing...`)
      startPolling(data.job_id)
    } catch (err) {
      setPipelineMsg(`Error: ${err.message}`)
      setPipelineRunning(false)
    }
  }

  // Poll pipeline
  const startPolling = useCallback((jobId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(BATCH_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ action: 'process_next', job_id: jobId }),
        })
        const data = await res.json()

        if (data.phase === 'step1_running') {
          setPipelineMsg('Step 1: Analysing ads with Opus vision...')
        } else if (data.phase === 'step1_done' || data.phase === 'consolidating') {
          setPipelineMsg('Consolidating themes, personas, and pillars...')
        } else if (data.phase === 'consolidation_done' || data.phase === 'saving') {
          setPipelineMsg('Saving intelligence report...')
        } else if (data.phase === 'completed') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setPipelineRunning(false)
          setPipelineMsg('Analysis complete!')
          loadJobResults(jobId)
          loadJobs()
        } else if (data.phase === 'failed') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setPipelineRunning(false)
          setPipelineMsg(`Failed: ${data.error || 'Unknown error'}`)
        }

        // Also fetch status for progress
        const statusRes = await fetch(BATCH_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ action: 'status', job_id: jobId }),
        })
        const statusData = await statusRes.json()
        setJobStatus(statusData)
      } catch (err) {
        console.error('Poll error:', err)
      }
    }, 5000)
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // Load job results
  const loadJobResults = async (jobId) => {
    const res = await fetch(BATCH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ action: 'results', job_id: jobId }),
    })
    const data = await res.json()
    setJobResults(data)
    setActiveJobId(jobId)
  }

  // View a past job
  const viewJob = (job) => {
    setTab(1)
    if (job.status === 'completed') {
      loadJobResults(job.id)
    } else if (['step1_running', 'consolidating', 'saving'].includes(job.status)) {
      setActiveJobId(job.id)
      setPipelineRunning(true)
      setPipelineMsg(`Resuming: ${job.status}...`)
      startPolling(job.id)
    }
  }

  // Derived data from results
  const themes = jobResults?.analysis?.themes || jobResults?.job?.merged_themes || []
  const personas = jobResults?.analysis?.personas || jobResults?.job?.merged_personas || []
  const pillars = jobResults?.analysis?.pillars || jobResults?.job?.merged_pillars || []
  const clusters = jobResults?.analysis?.clusters || jobResults?.job?.merged_clusters || []
  const consolidationSummary = jobResults?.analysis?.consolidation_summary || jobResults?.job?.consolidation_summary
  const images = jobResults?.images || []

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Competitor Ads</h1>
          <p className="text-xs text-zinc-500 mt-1">{adsTotal.toLocaleString()} ads across {brands.length} brands</p>
        </div>
        <div className="flex items-center gap-2">
          {selectMode && selectedAds.size > 0 && (
            <button onClick={runAnalysis} className="btn btn-primary text-xs" disabled={pipelineRunning}>
              Analyse {selectedAds.size} ads
            </button>
          )}
          <button onClick={() => { setSelectMode(!selectMode); setSelectedAds(new Set()) }} className="btn btn-secondary text-xs">
            {selectMode ? 'Cancel' : 'Select for Analysis'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-[var(--border)]">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === i ? 'border-orange-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
            {i === 1 && jobs.filter(j => j.status === 'completed').length > 0 && (
              <span className="ml-1.5 text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                {jobs.filter(j => j.status === 'completed').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* AD LIBRARY TAB */}
      {tab === 0 && (
        <div>
          {/* Brand filter */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button
              onClick={() => { setSelectedBrand('all'); setAdsPage(0) }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                selectedBrand === 'all'
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                  : 'bg-[var(--bg-1)] text-zinc-400 border-[var(--border)] hover:text-white'
              }`}
            >
              All brands
            </button>
            {brands.map(b => (
              <button
                key={b.id}
                onClick={() => { setSelectedBrand(b.page_name); setAdsPage(0) }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selectedBrand === b.page_name
                    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                    : 'bg-[var(--bg-1)] text-zinc-400 border-[var(--border)] hover:text-white'
                }`}
              >
                {b.page_name}
                <span className="ml-1 text-zinc-600">{b.ad_count?.toLocaleString()}</span>
              </button>
            ))}
          </div>

          {/* Select all */}
          {selectMode && (
            <div className="flex items-center gap-3 mb-3">
              <button onClick={selectAll} className="text-xs text-orange-400 hover:underline">
                {selectedAds.size === ads.length ? 'Deselect all' : `Select all ${ads.length} on this page`}
              </button>
              <span className="text-xs text-zinc-500">{selectedAds.size} selected</span>
            </div>
          )}

          {/* Ad grid */}
          {adsLoading ? (
            <div className="flex items-center justify-center py-20">
              <span className="spinner text-orange-500" />
              <span className="ml-3 text-sm text-zinc-400">Loading ads...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {ads.map(ad => {
                  const isSelected = selectedAds.has(ad.id)
                  return (
                    <div
                      key={ad.id}
                      onClick={() => selectMode && toggleAd(ad.id)}
                      className={`group relative rounded-lg overflow-hidden border transition-all ${
                        selectMode ? 'cursor-pointer' : ''
                      } ${
                        isSelected
                          ? 'border-orange-500 ring-2 ring-orange-500/30'
                          : 'border-[var(--border)] hover:border-zinc-600'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="aspect-square bg-[var(--bg-2)] relative">
                        {ad.thumbnail_url ? (
                          <img
                            src={ad.thumbnail_url}
                            alt={ad.creative_title || ''}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">No image</div>
                        )}
                        {/* Selection checkbox */}
                        {selectMode && (
                          <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            isSelected ? 'bg-orange-500 border-orange-500' : 'border-zinc-500 bg-black/50'
                          }`}>
                            {isSelected && <span className="text-white text-[10px]">\u2713</span>}
                          </div>
                        )}
                        {/* Days active badge */}
                        {ad.days_active > 0 && (
                          <div className="absolute bottom-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-zinc-300">
                            {ad.days_active}d
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-2">
                        <div className="text-[10px] text-zinc-500 truncate">{ad.page_name}</div>
                        {ad.creative_title && (
                          <div className="text-[11px] text-zinc-300 truncate mt-0.5">{ad.creative_title}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {adsTotal > ADS_PER_PAGE && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setAdsPage(p => Math.max(0, p - 1))}
                    disabled={adsPage === 0}
                    className="btn btn-secondary text-xs"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {adsPage + 1} of {Math.ceil(adsTotal / ADS_PER_PAGE)}
                  </span>
                  <button
                    onClick={() => setAdsPage(p => p + 1)}
                    disabled={(adsPage + 1) * ADS_PER_PAGE >= adsTotal}
                    className="btn btn-secondary text-xs"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ANALYSIS TAB */}
      {tab === 1 && (
        <div>
          {/* Pipeline progress */}
          {pipelineRunning && (
            <div className="card-sm mb-6 border-orange-500/30">
              <div className="flex items-center gap-3">
                <span className="spinner text-orange-500" />
                <div>
                  <p className="text-sm text-white">{pipelineMsg}</p>
                  {jobStatus?.summary && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Step 1: {jobStatus.summary.step1_completed}/{jobStatus.summary.total} completed
                      {jobStatus.summary.step1_failed > 0 && `, ${jobStatus.summary.step1_failed} failed`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Past jobs list */}
          {!activeJobId && !pipelineRunning && (
            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Analysis Jobs</h3>
              {jobs.length === 0 ? (
                <p className="text-xs text-zinc-500">No analysis jobs yet. Select ads from the library and run an analysis.</p>
              ) : (
                <div className="space-y-2">
                  {jobs.map(job => (
                    <div
                      key={job.id}
                      onClick={() => viewJob(job)}
                      className="card-sm flex items-center justify-between cursor-pointer hover:border-zinc-600 transition-colors"
                    >
                      <div>
                        <div className="text-sm text-white">
                          {(job.brands_analysed || []).join(', ') || 'Unknown brands'}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {job.total_images} images \u00b7 {job.pipeline_version} \u00b7 {new Date(job.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={`badge text-xs ${
                        job.status === 'completed' ? 'badge-success' :
                        job.status === 'failed' ? 'badge-error' : 'badge-accent'
                      }`}>
                        {job.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Analysis results */}
          {activeJobId && jobResults && (
            <div>
              {/* Job header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-medium text-white">
                    {(jobResults.job?.brands_analysed || []).join(', ')}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {jobResults.job?.total_images} images \u00b7 {new Date(jobResults.job?.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => { setActiveJobId(null); setJobResults(null); setJobStatus(null) }}
                  className="btn btn-ghost text-xs"
                >
                  \u2190 All jobs
                </button>
              </div>

              {/* Consolidation summary */}
              {consolidationSummary && (
                <div className="card-sm mb-4 border-blue-500/20">
                  <h4 className="text-xs font-medium text-blue-400 mb-2">Intelligence Summary</h4>
                  {consolidationSummary.dominantSignals && (
                    <div className="mb-2">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Dominant Signals</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {consolidationSummary.dominantSignals.map((s, i) => (
                          <span key={i} className="text-[11px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {consolidationSummary.emergingSignals && (
                    <div>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Emerging Signals</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {consolidationSummary.emergingSignals.map((s, i) => (
                          <span key={i} className="text-[11px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Analysis sub-tabs */}
              <div className="flex items-center gap-1 mb-4 overflow-x-auto">
                {ANALYSIS_TABS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setAnalysisTab(i)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                      analysisTab === i
                        ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                        : 'bg-[var(--bg-1)] text-zinc-500 border-[var(--border)] hover:text-zinc-300'
                    }`}
                  >
                    {t}
                    <span className="ml-1 text-zinc-600">
                      {i === 0 ? themes.length :
                       i === 1 ? personas.length :
                       i === 2 ? pillars.length :
                       i === 3 ? clusters.length :
                       images.filter(img => img.step1_analysis).length}
                    </span>
                  </button>
                ))}
              </div>

              {/* Themes */}
              {analysisTab === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {themes.sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((t, i) => (
                    <WeightedCard key={i} item={t} type="theme" />
                  ))}
                  {themes.length === 0 && <p className="text-xs text-zinc-500 col-span-2">No themes found. Run an analysis first.</p>}
                </div>
              )}

              {/* Personas */}
              {analysisTab === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {personas.sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((p, i) => (
                    <WeightedCard key={i} item={p} type="persona" />
                  ))}
                  {personas.length === 0 && <p className="text-xs text-zinc-500 col-span-2">No personas found.</p>}
                </div>
              )}

              {/* Pillars */}
              {analysisTab === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pillars.sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((p, i) => (
                    <WeightedCard key={i} item={p} type="pillar" />
                  ))}
                  {pillars.length === 0 && <p className="text-xs text-zinc-500 col-span-2">No pillars found.</p>}
                </div>
              )}

              {/* Clusters */}
              {analysisTab === 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {clusters.sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((c, i) => (
                    <WeightedCard key={i} item={c} type="cluster" />
                  ))}
                  {clusters.length === 0 && <p className="text-xs text-zinc-500 col-span-2">No clusters found.</p>}
                </div>
              )}

              {/* Per-Ad Breakdown */}
              {analysisTab === 4 && (
                <div className="space-y-3">
                  {images.filter(img => img.step1_analysis).map((img, i) => {
                    const analysis = img.step1_analysis || {}
                    return (
                      <div key={i} className="card-sm">
                        <div className="flex gap-4">
                          {/* Thumbnail */}
                          <div className="w-24 h-24 rounded overflow-hidden shrink-0 bg-[var(--bg-2)]">
                            {img.image_url && (
                              <img src={img.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            )}
                          </div>
                          {/* Analysis */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-500">#{img.ad_index}</span>
                              <span className="text-sm text-white font-medium truncate">{img.page_name}</span>
                              {img.visual_cluster && (
                                <span className="badge badge-neutral text-[10px]">{img.visual_cluster}</span>
                              )}
                              {analysis.strengthScore && (
                                <span className={`text-[10px] font-bold ${
                                  analysis.strengthScore >= 8 ? 'text-green-400' :
                                  analysis.strengthScore >= 5 ? 'text-yellow-400' : 'text-red-400'
                                }`}>
                                  {analysis.strengthScore}/10
                                </span>
                              )}
                            </div>
                            {img.headline && <p className="text-xs text-zinc-400 mt-1 truncate">{img.headline}</p>}
                            {analysis.emotionalHook && (
                              <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                                <span className="text-zinc-600">Hook:</span> {analysis.emotionalHook}
                              </p>
                            )}
                            {analysis.format && (
                              <span className="text-[10px] text-zinc-600 mt-1 inline-block">Format: {analysis.format}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {images.filter(img => img.step1_analysis).length === 0 && (
                    <p className="text-xs text-zinc-500">No per-ad analysis available.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
