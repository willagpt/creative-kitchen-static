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

export default function CompareAnalyses() {
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobData, setJobData] = useState(null)
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('matrix')
  const [analysis, setAnalysis] = useState(null)

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const params = new URLSearchParams({
          status: 'eq.completed',
          order: 'created_at.desc',
          select: 'id,brands_analysed,total_images,completed_step1,pipeline_version,merged_themes,merged_personas,merged_pillars,merged_clusters,merged_formats,consolidation_summary,created_at'
        })
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/analysis_jobs?${params}`,
          { headers: supabaseHeaders }
        )
        if (res.ok) {
          const data = await res.json()
          setJobs(data)
        }
      } catch (err) {
        console.error('Error fetching jobs:', err)
      }
    }
    fetchJobs()
  }, [])

  useEffect(() => {
    if (!selectedJob) return

    const fetchData = async () => {
      setLoading(true)
      try {
        const jobRes = await fetch(
          `${SUPABASE_URL}/rest/v1/analysis_jobs?id=eq.${selectedJob}`,
          { headers: supabaseHeaders }
        )
        const jobArray = await jobRes.json()
        if (jobArray.length > 0) {
          setJobData(jobArray[0])
        }

        const params = new URLSearchParams({
          job_id: `eq.${selectedJob}`,
          step1_status: 'eq.completed',
          select: 'ad_index,page_name,days_active,visual_cluster,creative_format',
          order: 'ad_index.asc'
        })
        const imgRes = await fetch(
          `${SUPABASE_URL}/rest/v1/analysis_job_images?${params}`,
          { headers: supabaseHeaders }
        )
        if (imgRes.ok) {
          const imgData = await imgRes.json()
          setImages(imgData)
        }
      } catch (err) {
        console.error('Error fetching job data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [selectedJob])

  useEffect(() => {
    if (!jobData || images.length === 0) return

    const processed = processAnalysis(jobData, images)
    setAnalysis(processed)
  }, [jobData, images])

  const processAnalysis = (job, imgList) => {
    const brands = [...new Set(imgList.map(img => img.page_name))].sort()

    const brandFormatMatrix = {}
    brands.forEach(brand => {
      brandFormatMatrix[brand] = {}
      FORMAT_TAXONOMY.forEach(format => {
        brandFormatMatrix[brand][format] = {
          count: 0,
          totalDaysActive: 0,
          ads: []
        }
      })
    })

    imgList.forEach(img => {
      const format = img.creative_format || 'Unknown'
      if (brandFormatMatrix[img.page_name] && brandFormatMatrix[img.page_name][format]) {
        brandFormatMatrix[img.page_name][format].count += 1
        brandFormatMatrix[img.page_name][format].totalDaysActive += img.days_active || 0
        brandFormatMatrix[img.page_name][format].ads.push(img.ad_index)
      }
    })

    Object.keys(brandFormatMatrix).forEach(brand => {
      Object.keys(brandFormatMatrix[brand]).forEach(format => {
        const cell = brandFormatMatrix[brand][format]
        if (cell.count > 0) {
          cell.avgDaysActive = Math.round(cell.totalDaysActive / cell.count)
        }
      })
    })

    const themes = processItems(job.merged_themes || [], imgList, brands)
    const personas = processItems(job.merged_personas || [], imgList, brands)
    const pillars = processItems(job.merged_pillars || [], imgList, brands)

    const workingThemes = themes.filter(t => t.brandCount >= 2).sort((a, b) => b.totalDaysActive - a.totalDaysActive)
    const workingPersonas = personas.filter(p => p.brandCount >= 2).sort((a, b) => b.totalDaysActive - a.totalDaysActive)
    const workingPillars = pillars.filter(p => p.brandCount >= 2).sort((a, b) => b.totalDaysActive - a.totalDaysActive)

    const whiteSpaceFormats = FORMAT_TAXONOMY.filter(format => {
      const count = brands.filter(b => brandFormatMatrix[b][format].count > 0).length
      return count <= 1
    })

    const whiteSpaceThemes = themes.filter(t => t.brandCount <= 1)
    const whiteSpacePersonas = personas.filter(p => p.brandCount <= 1)
    const whiteSpacePillars = pillars.filter(p => p.brandCount <= 1)

    return {
      brands,
      brandFormatMatrix,
      themes,
      personas,
      pillars,
      workingThemes,
      workingPersonas,
      workingPillars,
      whiteSpaceFormats,
      whiteSpaceThemes,
      whiteSpacePersonas,
      whiteSpacePillars,
      job
    }
  }

  const processItems = (items, imgList, brands) => {
    if (!Array.isArray(items)) return []

    return items.map(item => {
      const adIndices = item.adIndices || []
      const relatedBrands = new Set()
      let totalDaysActive = 0

      adIndices.forEach(idx => {
        const img = imgList.find(i => i.ad_index === idx)
        if (img) {
          relatedBrands.add(img.page_name)
          totalDaysActive += img.days_active || 0
        }
      })

      return {
        name: item.name,
        description: item.description,
        adIndices,
        weight: item.weight || 0,
        momentum: item.momentum || 'niche',
        brandCount: relatedBrands.size,
        totalDaysActive,
        relatedBrands: Array.from(relatedBrands)
      }
    })
  }

  const exportMarkdown = () => {
    if (!analysis) return

    const { brands, job, workingThemes, workingPersonas, workingPillars, whiteSpaceFormats, whiteSpaceThemes } = analysis
    const now = new Date().toLocaleDateString()

    let md = `# Competitive Intelligence Analysis\n\n`
    md += `**Date:** ${now}\n`
    md += `**Brands:** ${brands.join(', ')}\n`
    md += `**Total Images Analyzed:** ${images.length}\n\n`

    md += `## What's Working\n\n`
    md += `### Themes (Consensus Tactics)\n`
    if (workingThemes.length > 0) {
      workingThemes.forEach(t => {
        md += `- **${t.name}** (${t.brandCount} brands, ${t.totalDaysActive} total days)\n`
        md += `  - Brands: ${t.relatedBrands.join(', ')}\n`
      })
    } else {
      md += `No themes shared across 2+ brands.\n`
    }

    md += `\n### Personas\n`
    if (workingPersonas.length > 0) {
      workingPersonas.forEach(p => {
        md += `- **${p.name}** (${p.brandCount} brands)\n`
      })
    } else {
      md += `No personas shared across 2+ brands.\n`
    }

    md += `\n### Pillars\n`
    if (workingPillars.length > 0) {
      workingPillars.forEach(p => {
        md += `- **${p.name}** (${p.brandCount} brands)\n`
      })
    } else {
      md += `No pillars shared across 2+ brands.\n`
    }

    md += `\n## White Space (Opportunities)\n\n`
    md += `### Untapped or Rare Formats\n`
    if (whiteSpaceFormats.length > 0) {
      whiteSpaceFormats.forEach(f => {
        md += `- ${f}\n`
      })
    } else {
      md += `All formats are used by 2+ brands.\n`
    }

    md += `\n### Rare Themes\n`
    if (whiteSpaceThemes.length > 0) {
      whiteSpaceThemes.slice(0, 5).forEach(t => {
        md += `- **${t.name}** (${t.brandCount} brand${t.brandCount === 1 ? '' : 's'})\n`
      })
    } else {
      md += `All themes are represented.\n`
    }

    md += `\n## Per-Brand Breakdown\n\n`
    brands.forEach(brand => {
      const brandFormats = FORMAT_TAXONOMY.filter(f => analysis.brandFormatMatrix[brand][f].count > 0)
      md += `### ${brand}\n`
      md += `- Active Formats: ${brandFormats.join(', ')}\n`
      md += `- Total Ads: ${images.filter(i => i.page_name === brand).length}\n`
      const avgDays = images.filter(i => i.page_name === brand).length > 0
        ? Math.round(images.filter(i => i.page_name === brand).reduce((sum, i) => sum + (i.days_active || 0), 0) / images.filter(i => i.page_name === brand).length)
        : 0
      md += `- Avg Days Active: ${avgDays}\n\n`
    })

    md += `## Format Heatmap\n\n`
    md += `| Brand | ${FORMAT_TAXONOMY.join(' | ')} |\n`
    md += `|${Array(FORMAT_TAXONOMY.length + 1).fill('---|').join('')}\n`
    brands.forEach(brand => {
      const row = [brand]
      FORMAT_TAXONOMY.forEach(format => {
        const cell = analysis.brandFormatMatrix[brand][format]
        row.push(cell.count > 0 ? `${cell.count} (${cell.avgDaysActive}d)` : '-')
      })
      md += `| ${row.join(' | ')} |\n`
    })

    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `competitive-analysis-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: '24px', color: '#fff', minHeight: '100vh' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>Competitive Analysis</h1>
        <p style={{ fontSize: '14px', color: '#a1a1a1' }}>DTC Brand Intelligence Matrix</p>
      </div>

      {!selectedJob ? (
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '24px'
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Select an Analysis Job</h2>
          {jobs.length === 0 ? (
            <p style={{ fontSize: '14px', color: '#71717a' }}>No completed analysis jobs found.</p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {jobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => setSelectedJob(job.id)}
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#0a0a0a',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.target.style.borderColor = '#f97316'
                    e.target.style.backgroundColor = '#1a1a1a'
                  }}
                  onMouseLeave={e => {
                    e.target.style.borderColor = '#333'
                    e.target.style.backgroundColor = '#0a0a0a'
                  }}
                >
                  <div style={{ fontWeight: '600' }}>
                    {job.brands_analysed ? job.brands_analysed.join(', ') : 'Unknown Brands'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
                    {job.total_images} images · v{job.pipeline_version || '1'} · {new Date(job.created_at).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
            paddingBottom: '16px',
            borderBottom: '1px solid #333'
          }}>
            <div>
              <button
                onClick={() => {
                  setSelectedJob(null)
                  setJobData(null)
                  setImages([])
                  setAnalysis(null)
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'transparent',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#a1a1a1',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginBottom: '12px'
                }}
              >
                ← Back to Jobs
              </button>
              <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>
                {analysis ? analysis.brands.join(' vs ') : 'Loading...'}
              </h2>
              <p style={{ fontSize: '13px', color: '#71717a' }}>
                {images.length} ads analyzed across {analysis ? analysis.brands.length : 0} brands
              </p>
            </div>
            <button
              onClick={exportMarkdown}
              disabled={!analysis}
              style={{
                padding: '10px 16px',
                backgroundColor: '#f97316',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: analysis ? 'pointer' : 'not-allowed',
                opacity: analysis ? 1 : 0.5
              }}
            >
              Export Markdown
            </button>
          </div>

          {analysis && (
            <>
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '24px',
                borderBottom: '1px solid #333',
                paddingBottom: '12px'
              }}>
                {['matrix', 'working', 'whitespace'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: activeTab === tab ? '2px solid #f97316' : '2px solid transparent',
                      color: activeTab === tab ? '#f97316' : '#a1a1a1',
                      fontSize: '13px',
                      fontWeight: activeTab === tab ? '600' : '400',
                      cursor: 'pointer'
                    }}
                  >
                    {tab === 'matrix' ? 'Matrix' : tab === 'working' ? "What's Working" : 'White Space'}
                  </button>
                ))}
              </div>

              {activeTab === 'matrix' && (
                <div style={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  padding: '16px',
                  overflowX: 'auto'
                }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>Creative Format Heatmap</h3>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '12px'
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        <th style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          color: '#a1a1a1',
                          fontWeight: '600',
                          minWidth: '140px'
                        }}>Brand</th>
                        {FORMAT_TAXONOMY.map(format => (
                          <th
                            key={format}
                            style={{
                              padding: '8px 6px',
                              textAlign: 'center',
                              color: '#a1a1a1',
                              fontWeight: '600',
                              fontSize: '11px',
                              minWidth: '80px',
                              borderRight: '1px solid #333'
                            }}
                          >
                            {format.substring(0, 15)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.brands.map(brand => (
                        <tr key={brand} style={{ borderBottom: '1px solid #333' }}>
                          <td style={{
                            padding: '8px 12px',
                            fontWeight: '500',
                            color: '#f97316'
                          }}>
                            {brand}
                          </td>
                          {FORMAT_TAXONOMY.map(format => {
                            const cell = analysis.brandFormatMatrix[brand][format]
                            const intensity = cell.count > 0 ? Math.min(cell.count / 3, 1) : 0
                            return (
                              <td
                                key={`${brand}-${format}`}
                                style={{
                                  padding: '8px 6px',
                                  textAlign: 'center',
                                  backgroundColor: intensity > 0 ? `rgba(249, 115, 22, ${0.1 + intensity * 0.4})` : 'transparent',
                                  borderRight: '1px solid #333',
                                  color: intensity > 0 ? '#f97316' : '#71717a'
                                }}
                              >
                                {cell.count > 0 ? `${cell.count}` : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{
                    fontSize: '11px',
                    color: '#71717a',
                    marginTop: '12px'
                  }}>
                    Cell value = ad count. Color intensity indicates adoption strength.
                  </p>
                </div>
              )}

              {activeTab === 'working' && (
                <div style={{ display: 'grid', gap: '16px' }}>
                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#22c55e' }}>
                      Proven Themes ({analysis.workingThemes.length})
                    </h3>
                    {analysis.workingThemes.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.workingThemes.map((theme, idx) => (
                          <div key={idx} style={{
                            padding: '10px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #22c55e`,
                            borderRadius: '4px'
                          }}>
                            <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>
                              {theme.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '4px' }}>
                              {theme.description}
                            </div>
                            <div style={{ fontSize: '11px', color: '#71717a' }}>
                              {theme.brandCount} brands · {theme.totalDaysActive} total days · Momentum: {theme.momentum}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>No themes shared across multiple brands.</p>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#3b82f6' }}>
                      Personas ({analysis.workingPersonas.length})
                    </h3>
                    {analysis.workingPersonas.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.workingPersonas.map((persona, idx) => (
                          <div key={idx} style={{
                            padding: '10px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #3b82f6`,
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            <strong>{persona.name}</strong> — {persona.brandCount} brands
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>No personas shared across multiple brands.</p>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#a855f7' }}>
                      Pillars ({analysis.workingPillars.length})
                    </h3>
                    {analysis.workingPillars.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.workingPillars.map((pillar, idx) => (
                          <div key={idx} style={{
                            padding: '10px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #a855f7`,
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            <strong>{pillar.name}</strong> — {pillar.brandCount} brands
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>No pillars shared across multiple brands.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'whitespace' && (
                <div style={{ display: 'grid', gap: '16px' }}>
                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                      Untapped or Rare Formats ({analysis.whiteSpaceFormats.length})
                    </h3>
                    {analysis.whiteSpaceFormats.length > 0 ? (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: '8px'
                      }}>
                        {analysis.whiteSpaceFormats.map((format, idx) => (
                          <div key={idx} style={{
                            padding: '10px 12px',
                            backgroundColor: '#0a0a0a',
                            border: '1px dashed #f97316',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            {format}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>All formats are being used by 2+ brands.</p>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                      Rare Themes ({analysis.whiteSpaceThemes.length})
                    </h3>
                    {analysis.whiteSpaceThemes.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.whiteSpaceThemes.slice(0, 10).map((theme, idx) => (
                          <div key={idx} style={{
                            padding: '10px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #f97316`,
                            borderRadius: '4px'
                          }}>
                            <div style={{ fontWeight: '600', fontSize: '12px', marginBottom: '2px' }}>
                              {theme.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#71717a' }}>
                              {theme.brandCount === 0 ? 'No brands' : `${theme.relatedBrands.join(', ')}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>All themes are being used by multiple brands.</p>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                      Rare Personas ({analysis.whiteSpacePersonas.length})
                    </h3>
                    {analysis.whiteSpacePersonas.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.whiteSpacePersonas.slice(0, 10).map((persona, idx) => (
                          <div key={idx} style={{
                            padding: '8px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #f97316`,
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            <strong>{persona.name}</strong> — {persona.brandCount === 0 ? 'no brands' : persona.relatedBrands.join(', ')}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>All personas are well-represented.</p>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#f97316' }}>
                      Rare Pillars ({analysis.whiteSpacePillars.length})
                    </h3>
                    {analysis.whiteSpacePillars.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {analysis.whiteSpacePillars.slice(0, 10).map((pillar, idx) => (
                          <div key={idx} style={{
                            padding: '8px 12px',
                            backgroundColor: '#0a0a0a',
                            borderLeft: `3px solid #f97316`,
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            <strong>{pillar.name}</strong> — {pillar.brandCount === 0 ? 'no brands' : pillar.relatedBrands.join(', ')}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#71717a' }}>All pillars are well-represented.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {loading && (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              color: '#a1a1a1'
            }}>
              <p>Loading analysis...</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
