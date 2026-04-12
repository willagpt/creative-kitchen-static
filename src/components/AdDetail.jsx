import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

/**
 * AdDetail — 3-step scan flow + version history:
 * 1. Review brand guidelines (D3)
 * 2. Opus 4.6 visual analysis of the competitor ad
 * 3. Long-format prompt output
 * + Previous generated versions displayed below
 */

export default function AdDetail({ ad, versions = [], onClose, onRefresh, brands, activeBrandId }) {
  const [step, setStep] = useState(0) // 0=idle, 1=guidelines, 2=analysing, 3=done
  const [analysis, setAnalysis] = useState('')
  const [prompt, setPrompt] = useState(ad.generated_prompt || '')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const scanRanRef = useRef(false)

  const activeBrand = brands?.find(b => b.id === activeBrandId)

  // Escape key to close
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Reset when ad changes
  useEffect(() => {
    setPrompt(ad.generated_prompt || '')
    setAnalysis('')
    setStep(0)
    setStatus('')
    setError('')
    setSelectedVersion(null)
    scanRanRef.current = false
  }, [ad.id])

  // Build brand context
  function getBrandContext() {
    if (!activeBrand) return {}
    const activeSleeveMode = activeBrand.active_sleeve || 'primary'
    const sleeveNotes = activeSleeveMode === 'alt'
      ? (activeBrand.sleeve_notes_alt || activeBrand.sleeve_notes || '')
      : (activeBrand.sleeve_notes || '')
    return {
      brand_name: activeBrand.name,
      brand_guidelines: activeBrand.guidelines_text || '',
      tone_of_voice: activeBrand.tone_of_voice || '',
      sleeve_notes: sleeveNotes,
      colour_palette: activeBrand.colour_palette || [],
      typography: activeBrand.typography || {},
      packaging_specs: activeBrand.packaging_specs || {},
    }
  }

  // Fetch photo descriptions
  async function getPhotoDescriptions() {
    try {
      let query = supabase
        .from('photo_library')
        .select('name, type, description, prompt_snippet, meal_name')
        .not('description', 'is', null)
      if (activeBrandId) query = query.eq('brand_id', activeBrandId)
      const { data } = await query
      return data || []
    } catch {
      return []
    }
  }

  // The 3-step scan
  async function runScan() {
    if (scanRanRef.current) return
    scanRanRef.current = true
    setError('')
    setAnalysis('')

    // Step 1: Brand guidelines
    setStep(1)
    setStatus('Reviewing brand guidelines...')
    await new Promise(r => setTimeout(r, 800))

    if (!activeBrand) {
      setError('No brand selected. Go to Brand DNA and select a brand first.')
      setStep(0)
      scanRanRef.current = false
      return
    }

    // Step 2: Opus analysis + prompt generation
    setStep(2)
    setStatus('Opus 4.6 is analysing the ad and writing your prompt...')

    try {
      const photoDescs = await getPhotoDescriptions()
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-ad-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          saved_ad_id: ad.id,
          advertiser_name: ad.advertiser_name,
          ad_copy: ad.ad_copy,
          image_url: ad.image_url,
          media_type: ad.media_type,
          mode: 'scan',
          ...getBrandContext(),
          photo_descriptions: photoDescs.length > 0 ? photoDescs : undefined,
        })
      })

      const data = await res.json()
      if (!res.ok || !data.prompt) throw new Error(data.error || 'No prompt returned')

      setAnalysis(data.analysis || '')
      setPrompt(data.prompt)
      setStep(3)
      setStatus('Scan complete.')
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Scan failed:', err)
      setError(`Scan failed: ${err.message}`)
      setStep(0)
      scanRanRef.current = false
    }
  }

  function copyPrompt() {
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyVersionPrompt(text) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Auto-scan on open if no prompt exists
  useEffect(() => {
    if (!ad.generated_prompt && !scanRanRef.current) {
      runScan()
    }
  }, [ad.id])

  const brandContext = getBrandContext()
  const hasBrandData = !!(brandContext.brand_guidelines || brandContext.tone_of_voice || brandContext.sleeve_notes)

  return (
    <div className="detail-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="detail-panel" style={{ maxWidth: 900 }}>
        {/* Header */}
        <div className="detail-header">
          <div>
            <span className="font-heading">{ad.advertiser_name || 'Unknown brand'}</span>
            <span className="text-xs text-muted" style={{ marginLeft: 'var(--space-sm)' }}>
              {ad.platform} {ad.started_running && `· ${ad.started_running}`}
            </span>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {/* Original ad image */}
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{
            borderRadius: 8, overflow: 'hidden', maxHeight: 400,
            display: 'flex', justifyContent: 'center', background: 'var(--bg-2)',
          }}>
            {ad.image_url ? (
              <img
                src={ad.image_url}
                alt="Original ad"
                style={{ maxHeight: 400, objectFit: 'contain', width: '100%' }}
                onError={e => { e.target.style.display = 'none' }}
              />
            ) : (
              <div className="panel-placeholder" style={{ padding: 40 }}>
                <p>No image captured</p>
              </div>
            )}
          </div>
          {ad.ad_copy && (
            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-sm)', lineHeight: 1.5 }}>
              {ad.ad_copy.length > 300 ? ad.ad_copy.slice(0, 300) + '...' : ad.ad_copy}
            </p>
          )}
        </div>

        {/* 3-Step Progress */}
        <div style={{
          display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)',
          padding: 'var(--space-md)', background: 'var(--bg-2)', borderRadius: 8,
        }}>
          <StepIndicator num={1} label="Brand Guidelines" active={step === 1} done={step > 1} />
          <StepIndicator num={2} label="Opus 4.6 Analysis" active={step === 2} done={step > 2} />
          <StepIndicator num={3} label="Long-Format Prompt" active={step === 3} done={step === 3 && !!prompt} />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: 'var(--space-md)', marginBottom: 'var(--space-lg)',
            background: 'rgba(255,80,80,0.1)', borderRadius: 8, border: '1px solid rgba(255,80,80,0.3)',
          }}>
            <p className="text-sm" style={{ color: '#ff5050' }}>{error}</p>
          </div>
        )}

        {/* Step 1: Brand Guidelines Summary */}
        {step >= 1 && hasBrandData && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Step 1 — Brand Guidelines
              </span>
              {step > 1 && <span style={{ fontSize: 11, color: 'var(--text-success)' }}>✓</span>}
            </div>
            <div style={{
              padding: 'var(--space-md)', background: 'var(--bg-1)', borderRadius: 8,
              border: '1px solid var(--border)', maxHeight: step > 1 ? 120 : 'none',
              overflow: step > 1 ? 'hidden' : 'visible', position: 'relative',
            }}>
              <p className="text-xs text-muted" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                <strong>Brand:</strong> {activeBrand?.name || 'Unknown'}<br />
                {brandContext.brand_guidelines && (
                  <>{brandContext.brand_guidelines.slice(0, step > 1 ? 200 : 500)}{brandContext.brand_guidelines.length > (step > 1 ? 200 : 500) ? '...' : ''}</>
                )}
              </p>
              {step > 1 && brandContext.brand_guidelines?.length > 200 && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
                  background: 'linear-gradient(transparent, var(--bg-1))',
                }} />
              )}
            </div>
          </div>
        )}

        {/* Step 2: Visual Analysis */}
        {step >= 2 && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Step 2 — Opus 4.6 Visual Analysis
              </span>
              {step > 2 && <span style={{ fontSize: 11, color: 'var(--text-success)' }}>✓</span>}
            </div>
            {step === 2 && !analysis && (
              <div style={{
                padding: 'var(--space-lg)', background: 'var(--bg-1)', borderRadius: 8,
                border: '1px solid var(--border)', textAlign: 'center',
              }}>
                <span className="spinner" style={{ marginBottom: 'var(--space-sm)', display: 'inline-block' }} />
                <p className="text-sm text-muted">{status}</p>
              </div>
            )}
            {analysis && (
              <div style={{
                padding: 'var(--space-md)', background: 'var(--bg-1)', borderRadius: 8,
                border: '1px solid var(--border)',
              }}>
                <p className="text-sm" style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                  {analysis}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Long-Format Prompt */}
        {step >= 3 && prompt && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Step 3 — Long-Format Prompt
              </span>
              <button onClick={copyPrompt} className="btn-copy-pill" style={{
                background: copied ? 'var(--accent)' : 'var(--bg-3)',
                color: copied ? 'var(--bg-0)' : 'var(--text-primary)',
                border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease',
              }}>
                {copied ? '✓ Copied' : 'Copy Prompt'}
              </button>
            </div>
            <div style={{
              padding: 'var(--space-md)', background: 'var(--bg-1)', borderRadius: 8,
              border: '1px solid var(--border)', maxHeight: 500, overflowY: 'auto',
            }}>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                lineHeight: 1.7, color: 'var(--text-primary)', margin: 0,
              }}>
                {prompt}
              </pre>
            </div>
            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-xs)' }}>
              {prompt.length.toLocaleString()} characters · {prompt.split(/\s+/).length.toLocaleString()} words · Opus 4.6
            </p>
          </div>
        )}

        {/* Scan / Re-scan button for already-scanned ads */}
        {step === 0 && !error && ad.generated_prompt && (
          <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-md)' }}>
              This ad has been scanned before. Re-scan to get a fresh analysis and prompt.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => { scanRanRef.current = false; runScan() }}
            >
              ↻ Re-scan with Opus 4.6
            </button>
          </div>
        )}

        {/* Show existing prompt if loaded from DB but not re-scanned */}
        {step === 0 && !error && ad.generated_prompt && prompt && (
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Previous Prompt
              </span>
              <button onClick={copyPrompt} style={{
                background: copied ? 'var(--accent)' : 'var(--bg-3)',
                color: copied ? 'var(--bg-0)' : 'var(--text-primary)',
                border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                {copied ? '✓ Copied' : 'Copy Prompt'}
              </button>
            </div>
            <div style={{
              padding: 'var(--space-md)', background: 'var(--bg-1)', borderRadius: 8,
              border: '1px solid var(--border)', maxHeight: 400, overflowY: 'auto',
            }}>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                lineHeight: 1.7, color: 'var(--text-primary)', margin: 0,
              }}>
                {prompt}
              </pre>
            </div>
            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-xs)' }}>
              {prompt.length.toLocaleString()} characters · {prompt.split(/\s+/).length.toLocaleString()} words
            </p>
          </div>
        )}

        {/* ═══ GENERATED VERSIONS ═══ */}
        {versions.length > 0 && (
          <div style={{ marginTop: 'var(--space-xl)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                Generated Versions ({versions.length})
              </span>
            </div>

            {/* Version thumbnails strip */}
            <div style={{
              display: 'flex', gap: 'var(--space-sm)', overflowX: 'auto',
              paddingBottom: 'var(--space-sm)', marginBottom: 'var(--space-md)',
            }}>
              {versions.map((v, i) => {
                const num = versions.length - i
                const isSelected = selectedVersion === i
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVersion(isSelected ? null : i)}
                    style={{
                      flexShrink: 0, cursor: 'pointer',
                      borderRadius: 8, overflow: 'hidden',
                      border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
                      transition: 'border-color 0.2s ease',
                      width: 100,
                    }}
                  >
                    <img
                      src={v.image_url}
                      alt={`v${num}`}
                      style={{ width: 100, height: 120, objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                    <div style={{
                      padding: '4px 6px', background: 'var(--bg-2)',
                      fontSize: 10, color: 'var(--text-muted)', textAlign: 'center',
                    }}>
                      v{num} {v.aspect_ratio || ''}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Expanded version detail */}
            {selectedVersion !== null && versions[selectedVersion] && (
              <div style={{
                background: 'var(--bg-1)', borderRadius: 8,
                border: '1px solid var(--border)', overflow: 'hidden',
              }}>
                {/* Image */}
                <div style={{
                  display: 'flex', justifyContent: 'center', background: 'var(--bg-2)',
                  maxHeight: 500,
                }}>
                  <img
                    src={versions[selectedVersion].image_url}
                    alt={`Version ${versions.length - selectedVersion}`}
                    style={{ maxHeight: 500, objectFit: 'contain', width: '100%' }}
                  />
                </div>

                {/* Version info */}
                <div style={{ padding: 'var(--space-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      v{versions.length - selectedVersion} · {versions[selectedVersion].aspect_ratio || 'unknown'} ·{' '}
                      {new Date(versions[selectedVersion].created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                      {versions[selectedVersion].prompt && (
                        <button
                          onClick={() => copyVersionPrompt(versions[selectedVersion].prompt)}
                          style={{
                            background: 'var(--bg-3)', color: 'var(--text-primary)',
                            border: 'none', borderRadius: 6, padding: '4px 10px',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          Copy Prompt
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(versions[selectedVersion].image_url)
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `chefly-v${versions.length - selectedVersion}-${Date.now()}.png`
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                            URL.revokeObjectURL(url)
                          } catch {
                            window.open(versions[selectedVersion].image_url, '_blank')
                          }
                        }}
                        style={{
                          background: 'var(--bg-3)', color: 'var(--text-primary)',
                          border: 'none', borderRadius: 6, padding: '4px 10px',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        ↓ Download
                      </button>
                    </div>
                  </div>

                  {/* Version prompt */}
                  {versions[selectedVersion].prompt && (
                    <details style={{ marginTop: 'var(--space-sm)' }}>
                      <summary className="text-xs" style={{ cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
                        View prompt used ({versions[selectedVersion].prompt.length.toLocaleString()} chars)
                      </summary>
                      <pre style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                        lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0,
                        marginTop: 'var(--space-sm)', maxHeight: 300, overflowY: 'auto',
                      }}>
                        {versions[selectedVersion].prompt}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StepIndicator({ num, label, active, done }) {
  const bg = done ? 'var(--accent)' : active ? 'var(--bg-3)' : 'transparent'
  const border = done ? 'var(--accent)' : active ? 'var(--accent)' : 'var(--border)'
  const numColor = done ? 'var(--bg-0)' : active ? 'var(--accent)' : 'var(--text-muted)'
  const labelColor = done ? 'var(--text-primary)' : active ? 'var(--text-primary)' : 'var(--text-muted)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: `2px solid ${border}`, background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: numColor,
        transition: 'all 0.3s ease',
      }}>
        {done ? '✓' : num}
      </div>
      <span style={{
        fontSize: 12, fontWeight: active || done ? 600 : 400,
        color: labelColor, transition: 'all 0.3s ease',
      }}>
        {label}
      </span>
      {active && !done && (
        <span className="spinner spinner-inline" style={{ marginLeft: 4 }} />
      )}
    </div>
  )
}
