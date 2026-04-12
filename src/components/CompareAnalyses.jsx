import { useState, useEffect } from 'react'

// ── Supabase config (matches CompetitorAds.jsx) ──
const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'

const sbHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
}

const BRAND_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#eab308']
const MOMENTUM_TEXT = {
  dominant: '#f97316',
  strong: '#3b82f6',
  emerging: '#22c55e',
  niche: '#71717a',
}

const TABS = [
  { key: 'themes', label: 'Themes' },
  { key: 'personas', label: 'Personas' },
  { key: 'pillars', label: 'Pillars' },
  { key: 'clusters', label: 'Clusters' },
]

export default function CompareAnalyses() {
  const [jobs, setJobs] = useState([])
  const [selectedJobs, setSelectedJobs] = useState([])
  const [compareData, setCompareData] = useState(null)
  const [compareTab, setCompareTab] = useState('themes')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs?status=eq.completed&order=created_at.desc&select=id,brands_analysed,total_images,completed_step1,pipeline_version,merged_themes,merged_personas,merged_pillars,merged_clusters,consolidation_summary,created_at`,
        { headers: sbHeaders }
      )
      if (res.ok) setJobs(await res.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function toggleJob(job) {
    setSelectedJobs(prev => {
      const exists = prev.find(j => j.id === job.id)
      if (exists) return prev.filter(j => j.id !== job.id)
      return [...prev, job]
    })
  }

  function runComparison() {
    if (selectedJobs.length < 2) return

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

    const sortByMaxWeight = (map) =>
      Array.from(map.values()).sort((a, b) => {
        const maxA = Math.max(...Object.values(a.byBrand).map(v => v.weight || 0))
        const maxB = Math.max(...Object.values(b.byBrand).map(v => v.weight || 0))
        return maxB - maxA
      })

    setCompareData({
      brands: selectedJobs.map(j => (j.brands_analysed || []).join(', ') || 'Unknown'),
      themes: sortByMaxWeight(allThemes),
      personas: sortByMaxWeight(allPersonas),
      pillars: sortByMaxWeight(allPillars),
      clusters: sortByMaxWeight(allClusters),
    })
  }

  const currentItems = compareData ? compareData[compareTab] || [] : []

  return (
    <div className="ca-compare">
      <div className="ca-compare-header">
        <h2>Compare Analyses</h2>
        <p className="ca-compare-sub">Select 2+ completed analysis jobs to compare themes, personas, and pillars across brands.</p>
      </div>

      {!compareData ? (
        <>
          {loading ? (
            <div className="ca-loading"><span className="ca-spin"></span> Loading jobs...</div>
          ) : jobs.length === 0 ? (
            <p className="ca-empty">No completed analysis jobs yet. Run an analysis from Competitor Ads first.</p>
          ) : (
            <>
              <div className="ca-compare-jobs">
                {jobs.map(job => {
                  const isSelected = !!selectedJobs.find(j => j.id === job.id)
                  const brandLabel = (job.brands_analysed || []).join(', ') || 'Unknown'
                  return (
                    <div
                      key={job.id}
                      className={`ca-compare-job-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleJob(job)}
                    >
                      <div className="ca-compare-job-check">
                        <div className={`ca-check-box ${isSelected ? 'checked' : ''}`}>
                          {isSelected && '✓'}
                        </div>
                      </div>
                      <div className="ca-compare-job-info">
                        <div className="ca-compare-job-brand">{brandLabel}</div>
                        <div className="ca-compare-job-meta">
                          {job.total_images} images · {(job.merged_themes || []).length} themes · {(job.merged_pillars || []).length} pillars · {new Date(job.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span className="ca-compare-job-version">{job.pipeline_version}</span>
                    </div>
                  )
                })}
              </div>

              <button
                className="ca-btn-compare"
                onClick={runComparison}
                disabled={selectedJobs.length < 2}
              >
                Compare {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {/* Comparison view */}
          <div className="ca-compare-legend">
            <div className="ca-compare-legend-items">
              {compareData.brands.map((brand, i) => (
                <div key={i} className="ca-compare-legend-item">
                  <div className="ca-compare-legend-dot" style={{ backgroundColor: BRAND_COLORS[i % BRAND_COLORS.length] }} />
                  <span>{brand}</span>
                </div>
              ))}
            </div>
            <button className="ca-btn-back" onClick={() => { setCompareData(null); setSelectedJobs([]) }}>
              ← Back
            </button>
          </div>

          {/* Tabs */}
          <div className="ca-compare-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`ca-compare-tab ${compareTab === t.key ? 'active' : ''}`}
                onClick={() => setCompareTab(t.key)}
              >
                {t.label} <span className="ca-tab-count">{(compareData[t.key] || []).length}</span>
              </button>
            ))}
          </div>

          {/* Comparison rows */}
          <div className="ca-compare-rows">
            {currentItems.map((item, idx) => (
              <div key={idx} className="ca-compare-row">
                <h4 className="ca-compare-row-name">{item.name}</h4>

                <div className="ca-compare-bars">
                  {compareData.brands.map((brand, bi) => {
                    const brandData = item.byBrand[brand]
                    return (
                      <div key={bi} className="ca-compare-bar-row">
                        <div className="ca-compare-bar-label">{brand}</div>
                        <div className="ca-compare-bar-track">
                          {brandData ? (
                            <>
                              <div
                                className="ca-compare-bar-fill"
                                style={{
                                  width: `${brandData.weight || 0}%`,
                                  backgroundColor: BRAND_COLORS[bi % BRAND_COLORS.length],
                                }}
                              />
                              <span className="ca-compare-bar-value">{brandData.weight || 0}</span>
                              <span className="ca-compare-bar-momentum" style={{ color: MOMENTUM_TEXT[brandData.momentum] || '#71717a' }}>
                                {brandData.momentum || '—'}
                              </span>
                            </>
                          ) : (
                            <span className="ca-compare-bar-absent">not present</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Best description */}
                {(() => {
                  const best = Object.values(item.byBrand).sort((a, b) => (b.weight || 0) - (a.weight || 0))[0]
                  return best?.description ? (
                    <p className="ca-compare-row-desc">{best.description}</p>
                  ) : null
                })()}
              </div>
            ))}

            {currentItems.length === 0 && (
              <p className="ca-empty">No {compareTab} data in the selected jobs.</p>
            )}
          </div>

          {/* Gap analysis */}
          <div className="ca-compare-gaps">
            <h3>Gap Analysis</h3>
            <p className="ca-compare-gaps-sub">Items only present in one brand — potential gaps or unique strategies.</p>
            <div className="ca-compare-gap-list">
              {currentItems
                .filter(item => Object.keys(item.byBrand).length === 1)
                .map((item, i) => {
                  const brand = Object.keys(item.byBrand)[0]
                  const data = item.byBrand[brand]
                  const brandIdx = compareData.brands.indexOf(brand)
                  return (
                    <div key={i} className="ca-compare-gap-item">
                      <div className="ca-compare-legend-dot" style={{ backgroundColor: BRAND_COLORS[brandIdx % BRAND_COLORS.length] }} />
                      <span className="ca-compare-gap-name">{item.name}</span>
                      <span className="ca-compare-gap-brand">— only {brand}</span>
                      <span className="ca-compare-gap-weight" style={{ color: MOMENTUM_TEXT[data.momentum] || '#71717a' }}>
                        weight: {data.weight || 0}
                      </span>
                    </div>
                  )
                })}
              {currentItems.filter(item => Object.keys(item.byBrand).length === 1).length === 0 && (
                <p className="ca-compare-gap-none">All {compareTab} are shared across multiple brands.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
