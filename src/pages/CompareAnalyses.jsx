import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const MOMENTUM_COLORS = {
  dominant: 'bg-orange-500',
  strong: 'bg-blue-500',
  emerging: 'bg-green-500',
  niche: 'bg-zinc-500',
}

const MOMENTUM_TEXT = {
  dominant: 'text-orange-400',
  strong: 'text-blue-400',
  emerging: 'text-green-400',
  niche: 'text-zinc-400',
}

function CompareBar({ items, maxWeight }) {
  return (
    <div className="flex items-center gap-1">
      {items.map((item, i) => (
        <div
          key={i}
          className={`h-3 rounded-sm ${MOMENTUM_COLORS[item?.momentum] || 'bg-zinc-700'}`}
          style={{ width: `${((item?.weight || 0) / (maxWeight || 100)) * 100}%`, minWidth: item ? '4px' : '0' }}
          title={item ? `${item.name}: ${item.weight}` : 'Not present'}
        />
      ))}
    </div>
  )
}

export default function CompareAnalyses() {
  const [jobs, setJobs] = useState([])
  const [selectedJobs, setSelectedJobs] = useState([])
  const [compareData, setCompareData] = useState(null)
  const [compareTab, setCompareTab] = useState('themes')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadJobs()
  }, [])

  const loadJobs = async () => {
    const { data } = await supabase
      .from('analysis_jobs')
      .select('id, brands_analysed, total_images, completed_step1, pipeline_version, merged_themes, merged_personas, merged_pillars, merged_clusters, consolidation_summary, created_at, status')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
    if (data) setJobs(data)
    setLoading(false)
  }

  const toggleJob = (job) => {
    setSelectedJobs(prev => {
      const exists = prev.find(j => j.id === job.id)
      if (exists) return prev.filter(j => j.id !== job.id)
      return [...prev, job]
    })
  }

  const runComparison = () => {
    if (selectedJobs.length < 2) return

    // Build comparison data structure
    const allThemes = new Map()
    const allPersonas = new Map()
    const allPillars = new Map()
    const allClusters = new Map()

    for (const job of selectedJobs) {
      const brandLabel = (job.brands_analysed || []).join(', ') || 'Unknown'

      for (const theme of (job.merged_themes || [])) {
        const key = theme.name?.toLowerCase() || ''
        if (!allThemes.has(key)) allThemes.set(key, { name: theme.name, byBrand: {} })
        allThemes.get(key).byBrand[brandLabel] = theme
      }

      for (const persona of (job.merged_personas || [])) {
        const key = persona.name?.toLowerCase() || ''
        if (!allPersonas.has(key)) allPersonas.set(key, { name: persona.name, byBrand: {} })
        allPersonas.get(key).byBrand[brandLabel] = persona
      }

      for (const pillar of (job.merged_pillars || [])) {
        const key = pillar.name?.toLowerCase() || ''
        if (!allPillars.has(key)) allPillars.set(key, { name: pillar.name, byBrand: {} })
        allPillars.get(key).byBrand[brandLabel] = pillar
      }

      for (const cluster of (job.merged_clusters || [])) {
        const key = cluster.name?.toLowerCase() || ''
        if (!allClusters.has(key)) allClusters.set(key, { name: cluster.name, byBrand: {} })
        allClusters.get(key).byBrand[brandLabel] = cluster
      }
    }

    // Sort by max weight across brands
    const sortByMaxWeight = (map) => {
      return Array.from(map.values()).sort((a, b) => {
        const maxA = Math.max(...Object.values(a.byBrand).map(v => v.weight || 0))
        const maxB = Math.max(...Object.values(b.byBrand).map(v => v.weight || 0))
        return maxB - maxA
      })
    }

    setCompareData({
      brands: selectedJobs.map(j => (j.brands_analysed || []).join(', ') || 'Unknown'),
      themes: sortByMaxWeight(allThemes),
      personas: sortByMaxWeight(allPersonas),
      pillars: sortByMaxWeight(allPillars),
      clusters: sortByMaxWeight(allClusters),
    })
  }

  const TABS = [
    { key: 'themes', label: 'Themes' },
    { key: 'personas', label: 'Personas' },
    { key: 'pillars', label: 'Pillars' },
    { key: 'clusters', label: 'Clusters' },
  ]

  const currentItems = compareData ? compareData[compareTab] || [] : []

  // Brand colors for the comparison chart
  const BRAND_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#eab308']

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Compare Analyses</h1>
        <p className="text-xs text-zinc-500 mt-1">Select 2 or more completed analysis jobs to compare themes, personas, and pillars across brands.</p>
      </div>

      {!compareData ? (
        <>
          {/* Job selection */}
          {loading ? (
            <div className="flex items-center gap-3 py-10">
              <span className="spinner text-orange-500" />
              <span className="text-sm text-zinc-400">Loading jobs...</span>
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-zinc-500">No completed analysis jobs found. Run an analysis from the Competitor Ads page first.</p>
          ) : (
            <>
              <div className="space-y-2 mb-6">
                {jobs.map(job => {
                  const isSelected = selectedJobs.find(j => j.id === job.id)
                  const brandLabel = (job.brands_analysed || []).join(', ') || 'Unknown'
                  return (
                    <div
                      key={job.id}
                      onClick={() => toggleJob(job)}
                      className={`card-sm flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? 'border-orange-500 ring-1 ring-orange-500/20'
                          : 'hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          isSelected ? 'bg-orange-500 border-orange-500' : 'border-zinc-600'
                        }`}>
                          {isSelected && <span className="text-white text-[10px]">\u2713</span>}
                        </div>
                        <div>
                          <div className="text-sm text-white">{brandLabel}</div>
                          <div className="text-xs text-zinc-500">
                            {job.total_images} images \u00b7 {(job.merged_themes || []).length} themes \u00b7 {(job.merged_pillars || []).length} pillars \u00b7 {new Date(job.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <span className="badge badge-success text-xs">{job.pipeline_version}</span>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={runComparison}
                disabled={selectedJobs.length < 2}
                className="btn btn-primary text-sm"
              >
                Compare {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {/* Comparison view */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {compareData.brands.map((brand, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: BRAND_COLORS[i % BRAND_COLORS.length] }} />
                  <span className="text-xs text-zinc-300">{brand}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setCompareData(null); setSelectedJobs([]) }}
              className="btn btn-ghost text-xs"
            >
              \u2190 Back to selection
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-6 border-b border-[var(--border)]">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setCompareTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  compareTab === t.key ? 'border-orange-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t.label}
                <span className="ml-1 text-zinc-600">{(compareData[t.key] || []).length}</span>
              </button>
            ))}
          </div>

          {/* Comparison grid */}
          <div className="space-y-3">
            {currentItems.map((item, idx) => (
              <div key={idx} className="card-sm">
                <h4 className="text-sm font-semibold text-white mb-3">{item.name}</h4>

                {/* Brand bars */}
                <div className="space-y-2">
                  {compareData.brands.map((brand, bi) => {
                    const brandData = item.byBrand[brand]
                    return (
                      <div key={bi} className="flex items-center gap-3">
                        <div className="w-24 shrink-0">
                          <span className="text-[11px] text-zinc-400 truncate block">{brand}</span>
                        </div>
                        <div className="flex-1">
                          {brandData ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-4 bg-[var(--bg-2)] rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${brandData.weight || 0}%`,
                                    backgroundColor: BRAND_COLORS[bi % BRAND_COLORS.length],
                                  }}
                                />
                              </div>
                              <span className="text-xs text-zinc-400 w-8 text-right">{brandData.weight || 0}</span>
                              <span className={`text-[10px] ${MOMENTUM_TEXT[brandData.momentum] || 'text-zinc-500'}`}>
                                {brandData.momentum || '\u2014'}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-4 bg-[var(--bg-2)] rounded-full" />
                              <span className="text-[10px] text-zinc-600 italic">not present</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Description from highest-weight brand */}
                {(() => {
                  const best = Object.values(item.byBrand).sort((a, b) => (b.weight || 0) - (a.weight || 0))[0]
                  return best?.description ? (
                    <p className="text-xs text-zinc-500 mt-3 line-clamp-3">{best.description}</p>
                  ) : null
                })()}
              </div>
            ))}

            {currentItems.length === 0 && (
              <p className="text-sm text-zinc-500">No {compareTab} data available in the selected jobs.</p>
            )}
          </div>

          {/* Gap analysis */}
          <div className="card mt-6 border-blue-500/20">
            <h3 className="text-sm font-medium text-blue-400 mb-3">Gap Analysis</h3>
            <p className="text-xs text-zinc-500 mb-3">Items only present in one brand's analysis \u2014 potential gaps or unique strategies.</p>
            <div className="space-y-2">
              {currentItems
                .filter(item => {
                  const presentBrands = Object.keys(item.byBrand)
                  return presentBrands.length === 1
                })
                .map((item, i) => {
                  const brand = Object.keys(item.byBrand)[0]
                  const data = item.byBrand[brand]
                  const brandIdx = compareData.brands.indexOf(brand)
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: BRAND_COLORS[brandIdx % BRAND_COLORS.length] }} />
                      <span className="text-xs text-zinc-300">{item.name}</span>
                      <span className="text-[10px] text-zinc-500">\u2014 only {brand}</span>
                      <span className={`text-[10px] ${MOMENTUM_TEXT[data.momentum] || 'text-zinc-500'}`}>
                        weight: {data.weight || 0}
                      </span>
                    </div>
                  )
                })}
              {currentItems.filter(item => Object.keys(item.byBrand).length === 1).length === 0 && (
                <p className="text-xs text-zinc-600">All {compareTab} are shared across multiple brands.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
