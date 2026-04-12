import React, { useState, useEffect } from 'react'

const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA'

const FORMAT_TAXONOMY = [
  'Product Hero',
  'Lifestyle In-Context',
  'Before/After Split',
  'Side-by-Side Comparison',
  'Testimonial/Quote Card',
  'Stat/Claim Card',
  'Ingredient Spotlight',
  'Multi-Product Grid',
  'Meme/Trend-Jack',
  'Text-Heavy Offer/Promo',
  'Editorial/Magazine',
  'Infographic/Explainer',
  'Screenshot/Social Proof',
  'UGC-Style Static',
  'Founder/Team Story',
  'Carousel Card'
]

const supabaseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
}

// ── Styles ──
const S = {
  page: { padding: '24px', color: '#fff', minHeight: '100vh' },
  heading: { fontSize: '28px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#a1a1a1' },
  card: { backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '20px' },
  sectionTitle: { fontSize: '16px', fontWeight: '600', marginBottom: '16px' },
  muted: { fontSize: '13px', color: '#71717a' },
  orangeBtn: {
    padding: '10px 16px', backgroundColor: '#f97316', color: '#fff',
    border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
  },
  ghostBtn: {
    padding: '8px 12px', backgroundColor: 'transparent', border: '1px solid #333',
    borderRadius: '4px', color: '#a1a1a1', fontSize: '12px', cursor: 'pointer'
  },
  tab: (active) => ({
    padding: '8px 16px', backgroundColor: 'transparent', border: 'none',
    borderBottom: active ? '2px solid #f97316' : '2px solid transparent',
    color: active ? '#f97316' : '#a1a1a1',
    fontSize: '13px', fontWeight: active ? '600' : '400', cursor: 'pointer'
  }),
  itemCard: (color) => ({
    padding: '10px 12px', backgroundColor: '#0a0a0a',
    borderLeft: `3px solid ${color}`, borderRadius: '4px'
  }),
  dashedCard: {
    padding: '10px 12px', backgroundColor: '#0a0a0a',
    border: '1px dashed #f97316', borderRadius: '4px', fontSize: '12px'
  }
}

export default function CompareAnalyses() {
  // ── State ──
  const [allBrands, setAllBrands] = useState([])      // brands from competitor_ads
  const [allJobs, setAllJobs] = useState([])           // completed analysis jobs
  const [latestJobByBrand, setLatestJobByBrand] = useState({}) // brand -> latest job
  const [selectedBrands, setSelectedBrands] = useState(new Set())
  const [brandImages, setBrandImages] = useState({})   // brand -> images array
  const [loading, setLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [activeTab, setActiveTab] = useState('matrix')
  const [analysis, setAnalysis] = useState(null)

  // ── Load brands and jobs on mount ──
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Get distinct brands from competitor_ads with counts
      const brandsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_brand_summary`,
        { method: 'POST', headers: supabaseHeaders, body: '{}' }
      )

      // Fallback: fetch distinct page_names manually if RPC doesn't exist
      let brandList = []
      if (brandsRes.ok) {
        brandList = await brandsRes.json()
      } else {
        // Manual approach: get all competitor_ads grouped by page_name
        const adsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/competitor_ads?select=page_name&limit=50000`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
        )
        if (adsRes.ok) {
          const adsData = await adsRes.json()
          const counts = {}
          adsData.forEach(a => {
            const name = a.page_name || 'Unknown'
            counts[name] = (counts[name] || 0) + 1
          })
          brandList = Object.entries(counts)
            .map(([name, count]) => ({ page_name: name, ad_count: count }))
            .sort((a, b) => b.ad_count - a.ad_count)
        }
      }

      // Only show brands with 50+ ads (filter out influencer pages)
      const majorBrands = brandList.filter(b => b.ad_count >= 50)
      setAllBrands(majorBrands)

      // Get completed analysis jobs
      const jobsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs?status=eq.completed&order=created_at.desc&select=id,brands_analysed,total_images,pipeline_version,merged_themes,merged_personas,merged_pillars,merged_clusters,merged_formats,consolidation_summary,created_at`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      )
      const jobsData = jobsRes.ok ? await jobsRes.json() : []
      setAllJobs(jobsData)

      // Build latest job per brand
      const latest = {}
      jobsData.forEach(job => {
        (job.brands_analysed || []).forEach(brand => {
          if (!latest[brand] || new Date(job.created_at) > new Date(latest[brand].created_at)) {
            latest[brand] = job
          }
        })
      })
      setLatestJobByBrand(latest)

    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Toggle brand selection ──
  function toggleBrand(brandName) {
    setSelectedBrands(prev => {
      const next = new Set(prev)
      if (next.has(brandName)) next.delete(brandName)
      else next.add(brandName)
      return next
    })
  }

  // ── Run comparison ──
  async function runComparison() {
    const brands = Array.from(selectedBrands)
    if (brands.length === 0) return

    setComparing(true)
    setAnalysis(null)

    try {
      // Load images for each selected brand's job
      const imagesByBrand = {}
      const jobsByBrand = {}

      for (const brand of brands) {
        const job = latestJobByBrand[brand]
        if (!job) continue
        jobsByBrand[brand] = job

        const params = new URLSearchParams({
          job_id: `eq.${job.id}`,
          step1_status: 'eq.completed',
          select: 'ad_index,page_name,days_active,visual_cluster,creative_format',
          order: 'ad_index.asc'
        })
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/analysis_job_images?${params}`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
        )
        if (res.ok) {
          imagesByBrand[brand] = await res.json()
        }
      }

      setBrandImages(imagesByBrand)

      // Process the combined analysis
      const result = processComparison(brands, jobsByBrand, imagesByBrand)
      setAnalysis(result)

    } catch (err) {
      console.error('Comparison failed:', err)
    } finally {
      setComparing(false)
    }
  }

  // ── Process comparison data ──
  function processComparison(brands, jobsByBrand, imagesByBrand) {
    // Build format matrix: brand → format → { count, totalDaysActive, avgDaysActive }
    const brandFormatMatrix = {}
    brands.forEach(brand => {
      brandFormatMatrix[brand] = {}
      FORMAT_TAXONOMY.forEach(format => {
        brandFormatMatrix[brand][format] = { count: 0, totalDaysActive: 0, ads: [] }
      })

      const imgs = imagesByBrand[brand] || []
      imgs.forEach(img => {
        const format = img.creative_format || 'Unknown'
        if (brandFormatMatrix[brand][format]) {
          brandFormatMatrix[brand][format].count += 1
          brandFormatMatrix[brand][format].totalDaysActive += img.days_active || 0
          brandFormatMatrix[brand][format].ads.push(img.ad_index)
        }
      })

      // Compute averages
      FORMAT_TAXONOMY.forEach(format => {
        const cell = brandFormatMatrix[brand][format]
        if (cell.count > 0) cell.avgDaysActive = Math.round(cell.totalDaysActive / cell.count)
      })
    })

    // Collect themes/personas/pillars/formats across all brands with brand attribution
    const allThemes = collectItemsAcrossBrands(brands, jobsByBrand, imagesByBrand, 'merged_themes')
    const allPersonas = collectItemsAcrossBrands(brands, jobsByBrand, imagesByBrand, 'merged_personas')
    const allPillars = collectItemsAcrossBrands(brands, jobsByBrand, imagesByBrand, 'merged_pillars')
    const allFormats = collectItemsAcrossBrands(brands, jobsByBrand, imagesByBrand, 'merged_formats')

    const isSingleBrand = brands.length === 1
    const minBrands = isSingleBrand ? 1 : 2

    // What's Working: for single brand show all, for multi show 2+ brands
    const workingThemes = allThemes.filter(t => t.brandCount >= minBrands).sort((a, b) => b.totalDaysActive - a.totalDaysActive)
    const workingPersonas = allPersonas.filter(p => p.brandCount >= minBrands).sort((a, b) => b.totalDaysActive - a.totalDaysActive)
    const workingPillars = allPillars.filter(p => p.brandCount >= minBrands).sort((a, b) => b.totalDaysActive - a.totalDaysActive)
    const workingFormats = allFormats.filter(f => f.brandCount >= minBrands).sort((a, b) => b.totalDaysActive - a.totalDaysActive)

    // White Space: formats used by 0-1 brands (only meaningful with 2+ brands)
    const whiteSpaceFormats = isSingleBrand
      ? FORMAT_TAXONOMY.filter(format => brands.every(b => brandFormatMatrix[b][format].count === 0))
      : FORMAT_TAXONOMY.filter(format => {
          const usedBy = brands.filter(b => brandFormatMatrix[b][format].count > 0).length
          return usedBy <= 1
        })

    const whiteSpaceThemes = isSingleBrand ? [] : allThemes.filter(t => t.brandCount <= 1)
    const whiteSpacePersonas = isSingleBrand ? [] : allPersonas.filter(p => p.brandCount <= 1)
    const whiteSpacePillars = isSingleBrand ? [] : allPillars.filter(p => p.brandCount <= 1)

    // Consolidation summary from latest job
    const consolidationSummary = brands.map(b => jobsByBrand[b]?.consolidation_summary).find(Boolean) || null

    return {
      brands,
      isSingleBrand,
      brandFormatMatrix,
      allThemes,
      allPersonas,
      allPillars,
      allFormats,
      workingThemes,
      workingPersonas,
      workingPillars,
      workingFormats,
      whiteSpaceFormats,
      whiteSpaceThemes,
      whiteSpacePersonas,
      whiteSpacePillars,
      consolidationSummary,
      jobsByBrand,
      imagesByBrand
    }
  }

  // ── Collect items (themes/personas/pillars) across brands with fuzzy matching ──
  function collectItemsAcrossBrands(brands, jobsByBrand, imagesByBrand, field) {
    // Gather items per brand
    const perBrand = {} // brand -> items array with brand info
    brands.forEach(brand => {
      const job = jobsByBrand[brand]
      if (!job || !job[field]) return
      const items = job[field]
      if (!Array.isArray(items)) return

      const imgs = imagesByBrand[brand] || []

      perBrand[brand] = items.map(item => {
        const adIndices = item.adIndices || []
        let totalDays = 0
        adIndices.forEach(idx => {
          const img = imgs.find(i => i.ad_index === idx)
          if (img) totalDays += img.days_active || 0
        })
        return { ...item, brand, totalDaysActive: totalDays }
      })
    })

    // Merge items across brands by fuzzy name matching
    const merged = []

    Object.entries(perBrand).forEach(([brand, items]) => {
      items.forEach(item => {
        // Try to find existing merged item with similar name
        const existing = merged.find(m => nameSimilarity(m.name, item.name) > 0.5)
        if (existing) {
          if (!existing.brands.includes(brand)) {
            existing.brands.push(brand)
            existing.brandCount = existing.brands.length
          }
          existing.totalDaysActive += item.totalDaysActive
          // Prefer longer description
          if (item.description && (!existing.description || item.description.length > existing.description.length)) {
            existing.description = item.description
          }
        } else {
          merged.push({
            name: item.name,
            description: item.description || '',
            weight: item.weight || 0,
            momentum: item.momentum || 'niche',
            brands: [brand],
            brandCount: 1,
            totalDaysActive: item.totalDaysActive
          })
        }
      })
    })

    return merged
  }

  // ── Fuzzy name similarity (Jaccard on words) ──
  function nameSimilarity(a, b) {
    if (!a || !b) return 0
    const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
    const wordsA = new Set(norm(a).split(/\s+/).filter(w => w.length > 2))
    const wordsB = new Set(norm(b).split(/\s+/).filter(w => w.length > 2))
    if (wordsA.size === 0 || wordsB.size === 0) return 0
    let intersection = 0
    wordsA.forEach(w => { if (wordsB.has(w)) intersection++ })
    const union = new Set([...wordsA, ...wordsB]).size
    const jaccard = intersection / union
    // Also check containment
    const containment = Math.max(intersection / wordsA.size, intersection / wordsB.size)
    return Math.max(jaccard, containment * 0.9)
  }

  // ── Export as Markdown ──
  function exportMarkdown() {
    if (!analysis) return
    const { brands, workingThemes, workingPersonas, workingPillars, workingFormats, whiteSpaceFormats, whiteSpaceThemes, brandFormatMatrix, imagesByBrand } = analysis
    const now = new Date().toLocaleDateString()

    let md = `# Cross-Brand Competitive Analysis\n\n`
    md += `**Date:** ${now}\n`
    md += `**Brands Compared:** ${brands.join(', ')}\n\n`

    // Per-brand summary
    md += `## Brand Overview\n\n`
    brands.forEach(brand => {
      const imgs = imagesByBrand[brand] || []
      const formats = FORMAT_TAXONOMY.filter(f => brandFormatMatrix[brand][f].count > 0)
      const avgDays = imgs.length > 0
        ? Math.round(imgs.reduce((s, i) => s + (i.days_active || 0), 0) / imgs.length)
        : 0
      md += `### ${brand}\n`
      md += `- Images Analyzed: ${imgs.length}\n`
      md += `- Active Formats: ${formats.length > 0 ? formats.join(', ') : 'None analyzed'}\n`
      md += `- Avg Days Active: ${avgDays}\n\n`
    })

    md += `## What's Working${analysis.isSingleBrand ? '' : ' (Consensus)'}\n\n`
    md += `### Formats\n`
    workingFormats.length > 0
      ? workingFormats.forEach(f => { md += `- **${f.name}** — ${f.brands.join(', ')} (${f.totalDaysActive} total days, weight: ${f.weight})\n` })
      : (md += `No format data.\n`)

    md += `\n### Themes\n`
    workingThemes.length > 0
      ? workingThemes.forEach(t => { md += `- **${t.name}** — ${t.brands.join(', ')} (${t.totalDaysActive} total days)\n` })
      : (md += `No themes shared across 2+ brands yet.\n`)

    md += `\n### Personas\n`
    workingPersonas.length > 0
      ? workingPersonas.forEach(p => { md += `- **${p.name}** — ${p.brands.join(', ')}\n` })
      : (md += `No personas shared across 2+ brands yet.\n`)

    md += `\n### Pillars\n`
    workingPillars.length > 0
      ? workingPillars.forEach(p => { md += `- **${p.name}** — ${p.brands.join(', ')}\n` })
      : (md += `No pillars shared across 2+ brands yet.\n`)

    md += `\n## White Space (Opportunities)\n\n`
    md += `### Untapped Formats\n`
    whiteSpaceFormats.length > 0
      ? whiteSpaceFormats.forEach(f => { md += `- ${f}\n` })
      : (md += `All formats used by 2+ brands.\n`)

    md += `\n### Rare Themes\n`
    whiteSpaceThemes.slice(0, 8).forEach(t => { md += `- **${t.name}** (${t.brands.join(', ') || 'none'})\n` })

    md += `\n## Format Heatmap\n\n`
    md += `| Format | ${brands.join(' | ')} |\n`
    md += `|---|${brands.map(() => '---|').join('')}\n`
    FORMAT_TAXONOMY.forEach(format => {
      const cells = brands.map(b => {
        const c = brandFormatMatrix[b][format]
        return c.count > 0 ? `${c.count} (${c.avgDaysActive}d)` : '-'
      })
      md += `| ${format} | ${cells.join(' | ')} |\n`
    })

    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `competitive-analysis-${brands.join('-vs-')}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Total analyzed images across selected brands ──
  const totalImages = analysis
    ? analysis.brands.reduce((sum, b) => sum + (analysis.imagesByBrand[b] || []).length, 0)
    : 0

  // ── Render ──
  return (
    <div style={S.page}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={S.heading}>Compare Brands</h1>
        <p style={S.sub}>Cross-brand competitive intelligence</p>
      </div>

      {!analysis ? (
        <>
          {/* Brand selection */}
          <div style={S.card}>
            <h2 style={S.sectionTitle}>Select Brands to Compare</h2>
            {loading ? (
              <p style={S.muted}>Loading brands...</p>
            ) : allBrands.length === 0 ? (
              <p style={S.muted}>No brands found in competitor ads.</p>
            ) : (
              <>
                <p style={{ ...S.muted, marginBottom: '16px' }}>
                  Tick the brands you want to compare. Brands need a completed analysis to be included.
                </p>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {allBrands.map(brand => {
                    const hasJob = !!latestJobByBrand[brand.page_name]
                    const job = latestJobByBrand[brand.page_name]
                    const isSelected = selectedBrands.has(brand.page_name)

                    return (
                      <label
                        key={brand.page_name}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 16px',
                          backgroundColor: isSelected ? 'rgba(249, 115, 22, 0.08)' : '#0a0a0a',
                          border: `1px solid ${isSelected ? '#f97316' : '#333'}`,
                          borderRadius: '6px',
                          cursor: hasJob ? 'pointer' : 'not-allowed',
                          opacity: hasJob ? 1 : 0.5,
                          transition: 'all 0.15s'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!hasJob}
                          onChange={() => toggleBrand(brand.page_name)}
                          style={{ accentColor: '#f97316', width: '16px', height: '16px' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', fontSize: '14px', color: '#fff' }}>
                            {brand.page_name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
                            {brand.ad_count.toLocaleString()} ads in library
                            {hasJob && (
                              <span style={{ color: '#22c55e', marginLeft: '8px' }}>
                                ✓ Analyzed ({job.total_images} images, {job.pipeline_version})
                              </span>
                            )}
                            {!hasJob && (
                              <span style={{ color: '#f59e0b', marginLeft: '8px' }}>
                                ⏳ Not yet analyzed — run analysis from Competitor Ads tab first
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>

                <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button
                    onClick={runComparison}
                    disabled={selectedBrands.size === 0 || comparing}
                    style={{
                      ...S.orangeBtn,
                      opacity: selectedBrands.size === 0 || comparing ? 0.5 : 1,
                      cursor: selectedBrands.size === 0 || comparing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {comparing ? 'Loading...' : `Compare ${selectedBrands.size} Brand${selectedBrands.size !== 1 ? 's' : ''}`}
                  </button>
                  {selectedBrands.size === 1 && (
                    <span style={{ fontSize: '12px', color: '#f59e0b' }}>
                      You can compare a single brand — but cross-brand insights need 2+
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Comparison results header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #333'
          }}>
            <div>
              <button
                onClick={() => { setAnalysis(null); setBrandImages({}) }}
                style={S.ghostBtn}
              >
                ← Back to Brand Selection
              </button>
              <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px', marginTop: '12px' }}>
                {analysis.brands.join(' vs ')}
              </h2>
              <p style={S.muted}>
                {totalImages} ads analyzed across {analysis.brands.length} brand{analysis.brands.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={exportMarkdown} style={S.orangeBtn}>
              Export Markdown
            </button>
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex', gap: '8px', marginBottom: '24px',
            borderBottom: '1px solid #333', paddingBottom: '12px'
          }}>
            {[
              { key: 'matrix', label: 'Matrix' },
              { key: 'working', label: "What's Working" },
              { key: 'whitespace', label: 'White Space' }
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={S.tab(activeTab === t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Matrix Tab ── */}
          {activeTab === 'matrix' && (
            <div style={{ ...S.card, overflowX: 'auto' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>Creative Format Heatmap</h3>

              {analysis.isSingleBrand && (
                <div style={{
                  padding: '16px', backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', marginBottom: '16px'
                }}>
                  <p style={{ fontSize: '13px', color: '#f59e0b' }}>
                    Single-brand view — analyze more brands from the Competitor Ads tab to see side-by-side format comparison.
                  </p>
                </div>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#a1a1a1', fontWeight: '600', minWidth: '160px' }}>
                      Format
                    </th>
                    {analysis.brands.map(brand => (
                      <th key={brand} style={{
                        padding: '8px 10px', textAlign: 'center', color: '#f97316',
                        fontWeight: '600', fontSize: '12px', minWidth: '100px'
                      }}>
                        {brand}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FORMAT_TAXONOMY.map(format => {
                    const maxCount = Math.max(...analysis.brands.map(b => analysis.brandFormatMatrix[b][format].count), 1)
                    return (
                      <tr key={format} style={{ borderBottom: '1px solid #222' }}>
                        <td style={{ padding: '8px 12px', fontWeight: '500', color: '#e5e5e5', fontSize: '12px' }}>
                          {format}
                        </td>
                        {analysis.brands.map(brand => {
                          const cell = analysis.brandFormatMatrix[brand][format]
                          const intensity = cell.count > 0 ? Math.min(cell.count / Math.max(maxCount, 3), 1) : 0
                          return (
                            <td key={`${brand}-${format}`} style={{
                              padding: '8px 10px', textAlign: 'center',
                              backgroundColor: intensity > 0 ? `rgba(249, 115, 22, ${0.08 + intensity * 0.35})` : 'transparent',
                              color: intensity > 0 ? '#f97316' : '#555',
                              borderLeft: '1px solid #222'
                            }}>
                              {cell.count > 0 ? (
                                <span>
                                  <strong>{cell.count}</strong>
                                  <span style={{ fontSize: '10px', color: '#999', marginLeft: '3px' }}>
                                    {cell.avgDaysActive}d
                                  </span>
                                </span>
                              ) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: '11px', color: '#555', marginTop: '12px' }}>
                Count = number of ads using that format. Days = average days active.
              </p>
            </div>
          )}

          {/* ── What's Working Tab ── */}
          {activeTab === 'working' && (
            <div style={{ display: 'grid', gap: '16px' }}>
              {analysis.isSingleBrand && (
                <div style={{
                  padding: '16px', backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px'
                }}>
                  <p style={{ fontSize: '13px', color: '#f59e0b' }}>
                    Single-brand view — showing all {analysis.brands[0]}'s proven tactics.
                    Analyze more brands to see cross-brand consensus patterns.
                  </p>
                </div>
              )}

              {/* Consolidation Summary */}
              {analysis.consolidationSummary && (
                <div style={{ ...S.card, borderColor: '#444' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#e5e5e5' }}>
                    Key Signals
                  </h3>
                  {analysis.consolidationSummary.dominantSignals && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dominant</div>
                      <div style={{ display: 'grid', gap: '4px' }}>
                        {analysis.consolidationSummary.dominantSignals.map((s, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#d4d4d4', paddingLeft: '8px', borderLeft: '2px solid #22c55e' }}>{s}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysis.consolidationSummary.emergingSignals && (
                    <div>
                      <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Emerging</div>
                      <div style={{ display: 'grid', gap: '4px' }}>
                        {analysis.consolidationSummary.emergingSignals.map((s, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#a1a1a1', paddingLeft: '8px', borderLeft: '2px solid #f59e0b' }}>{s}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Formats */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                  {analysis.isSingleBrand ? 'Proven Formats' : 'Shared Formats'} ({analysis.workingFormats.length})
                </h3>
                {analysis.workingFormats.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.workingFormats.map((fmt, idx) => (
                      <div key={idx} style={S.itemCard('#f97316')}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>{fmt.name}</div>
                            <div style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '4px' }}>{fmt.description?.substring(0, 200)}{fmt.description?.length > 200 ? '...' : ''}</div>
                          </div>
                          {fmt.weight > 0 && (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                              backgroundColor: 'rgba(249, 115, 22, 0.15)', color: '#f97316', whiteSpace: 'nowrap', marginLeft: '8px'
                            }}>
                              weight: {fmt.weight}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#71717a' }}>
                          {fmt.brands.join(', ')} · {fmt.totalDaysActive} total days · {fmt.momentum}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>No format data available.</p>
                )}
              </div>

              {/* Themes */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#22c55e' }}>
                  {analysis.isSingleBrand ? 'Proven Themes' : 'Shared Themes'} ({analysis.workingThemes.length})
                </h3>
                {analysis.workingThemes.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.workingThemes.map((theme, idx) => (
                      <div key={idx} style={S.itemCard('#22c55e')}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>{theme.name}</div>
                          {theme.weight > 0 && (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', whiteSpace: 'nowrap', marginLeft: '8px'
                            }}>
                              weight: {theme.weight}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '4px' }}>{theme.description?.substring(0, 250)}{theme.description?.length > 250 ? '...' : ''}</div>
                        <div style={{ fontSize: '11px', color: '#71717a' }}>
                          {theme.brands.join(', ')} · {theme.totalDaysActive} total days · {theme.momentum}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>No themes found.</p>
                )}
              </div>

              {/* Personas */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#3b82f6' }}>
                  {analysis.isSingleBrand ? 'Target Personas' : 'Shared Personas'} ({analysis.workingPersonas.length})
                </h3>
                {analysis.workingPersonas.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.workingPersonas.map((p, idx) => (
                      <div key={idx} style={S.itemCard('#3b82f6')}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>{p.name}</div>
                          {p.weight > 0 && (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                              backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', whiteSpace: 'nowrap', marginLeft: '8px'
                            }}>
                              weight: {p.weight}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '4px' }}>{p.description?.substring(0, 250)}{p.description?.length > 250 ? '...' : ''}</div>
                        <div style={{ fontSize: '11px', color: '#71717a' }}>
                          {p.brands.join(', ')} · {p.totalDaysActive} total days · {p.momentum}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>No personas found.</p>
                )}
              </div>

              {/* Pillars */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#a855f7' }}>
                  {analysis.isSingleBrand ? 'Content Pillars' : 'Shared Pillars'} ({analysis.workingPillars.length})
                </h3>
                {analysis.workingPillars.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.workingPillars.map((p, idx) => (
                      <div key={idx} style={S.itemCard('#a855f7')}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>{p.name}</div>
                          {p.weight > 0 && (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                              backgroundColor: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', whiteSpace: 'nowrap', marginLeft: '8px'
                            }}>
                              weight: {p.weight}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '4px' }}>{p.description?.substring(0, 250)}{p.description?.length > 250 ? '...' : ''}</div>
                        <div style={{ fontSize: '11px', color: '#71717a' }}>
                          {p.brands.join(', ')} · {p.totalDaysActive} total days · {p.momentum}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>No pillars found.</p>
                )}
              </div>
            </div>
          )}

          {/* ── White Space Tab ── */}
          {activeTab === 'whitespace' && (
            <div style={{ display: 'grid', gap: '16px' }}>
              {analysis.isSingleBrand && (
                <div style={{
                  padding: '16px', backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px'
                }}>
                  <p style={{ fontSize: '13px', color: '#f59e0b' }}>
                    Single-brand view — showing formats {analysis.brands[0]} isn't using.
                    Cross-brand white space analysis (rare themes/personas) requires 2+ brands.
                  </p>
                </div>
              )}

              {/* Untapped Formats */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                  {analysis.isSingleBrand ? 'Untapped Formats' : 'Untapped or Rare Formats'} ({analysis.whiteSpaceFormats.length})
                </h3>
                {analysis.whiteSpaceFormats.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                    {analysis.whiteSpaceFormats.map((f, idx) => (
                      <div key={idx} style={S.dashedCard}>{f}</div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>All formats used by 2+ brands.</p>
                )}
              </div>

              {/* Rare Themes */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                  Rare Themes ({analysis.whiteSpaceThemes.length})
                </h3>
                {analysis.whiteSpaceThemes.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.whiteSpaceThemes.slice(0, 10).map((t, idx) => (
                      <div key={idx} style={S.itemCard('#f97316')}>
                        <div style={{ fontWeight: '600', fontSize: '12px', marginBottom: '2px' }}>{t.name}</div>
                        <div style={{ fontSize: '11px', color: '#71717a' }}>
                          {t.brands.length === 0 ? 'No brands' : t.brands.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>All themes well-represented.</p>
                )}
              </div>

              {/* Rare Personas */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                  Rare Personas ({analysis.whiteSpacePersonas.length})
                </h3>
                {analysis.whiteSpacePersonas.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.whiteSpacePersonas.slice(0, 10).map((p, idx) => (
                      <div key={idx} style={{ ...S.itemCard('#f97316'), fontSize: '12px' }}>
                        <strong>{p.name}</strong> — {p.brands.length === 0 ? 'no brands' : p.brands.join(', ')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>All personas well-represented.</p>
                )}
              </div>

              {/* Rare Pillars */}
              <div style={S.card}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                  Rare Pillars ({analysis.whiteSpacePillars.length})
                </h3>
                {analysis.whiteSpacePillars.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {analysis.whiteSpacePillars.slice(0, 10).map((p, idx) => (
                      <div key={idx} style={{ ...S.itemCard('#f97316'), fontSize: '12px' }}>
                        <strong>{p.name}</strong> — {p.brands.length === 0 ? 'no brands' : p.brands.join(', ')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.muted}>All pillars well-represented.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
