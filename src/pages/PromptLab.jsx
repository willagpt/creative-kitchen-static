import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TEMPLATES, buildPrompt } from '../lib/templates'

export default function PromptLab() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [prompts, setPrompts] = useState([])
  const [expandedTemplate, setExpandedTemplate] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const brandDNA = sessionStorage.getItem('brandDNA')
    const selectedTemplates = sessionStorage.getItem('selectedTemplates')
    if (!brandDNA || !selectedTemplates) { navigate('/templates'); return }

    try {
      const templates = JSON.parse(selectedTemplates)
      const dna = JSON.parse(brandDNA)
      const brandSetup = JSON.parse(sessionStorage.getItem('brandSetup'))

      const generatedPrompts = templates.map((template) => {
        const prompt = buildPrompt(template, {
          brand_name: brandSetup.brand_name,
          colors: dna.colors,
          style: dna.style,
          photography_style: dna.photography_style,
          claims: dna.claims,
        }, '')
        return {
          template_id: template.id,
          template_name: template.name,
          category: template.category,
          dimensions: `${template.width}x${template.height}`,
          prompt,
          custom_text: '',
        }
      })
      setPrompts(generatedPrompts)
    } catch (err) {
      console.error('Error building prompts:', err)
      setError('Failed to load prompts')
    }
  }, [navigate])

  const handlePromptChange = (index, newPrompt) => {
    const updated = [...prompts]
    updated[index].prompt = newPrompt
    setPrompts(updated)
  }

  const handleCustomTextChange = (index, customText) => {
    const updated = [...prompts]
    updated[index].custom_text = customText
    setPrompts(updated)
  }

  const handleRegenerate = (index) => {
    const selectedTemplates = JSON.parse(sessionStorage.getItem('selectedTemplates'))
    const dna = JSON.parse(sessionStorage.getItem('brandDNA'))
    const brandSetup = JSON.parse(sessionStorage.getItem('brandSetup'))
    const template = selectedTemplates.find((t) => t.id === prompts[index].template_id)
    if (!template) return
    const newPrompt = buildPrompt(template, {
      brand_name: brandSetup.brand_name, colors: dna.colors, style: dna.style,
      photography_style: dna.photography_style, claims: dna.claims,
    }, prompts[index].custom_text)
    const updated = [...prompts]
    updated[index].prompt = newPrompt
    setPrompts(updated)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      sessionStorage.setItem('generatedPrompts', JSON.stringify(prompts))
      navigate('/generate')
    } catch (err) {
      setError(err.message || 'Failed to prepare prompts')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Prompt Lab</h1>
          <p className="text-zinc-400 text-sm">Step 4 \u2014 Customize AI image prompts</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {prompts.length === 0 ? (
            <div className="card text-center py-8 text-zinc-500">No prompts to display.</div>
          ) : (
            prompts.map((item, index) => (
              <div key={index} className="card space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{item.template_name}</h3>
                    <div className="flex gap-3 text-[11px] text-zinc-500">
                      <span>{item.category}</span>
                      <span>{item.dimensions}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setExpandedTemplate(expandedTemplate === index ? null : index)} className="text-[11px] text-orange-400 hover:text-orange-300">
                    {expandedTemplate === index ? 'Collapse' : 'Edit'}
                  </button>
                </div>

                {expandedTemplate === index ? (
                  <div className="space-y-3 pt-3 border-t border-[var(--border)]">
                    <div>
                      <label className="label">AI Generated Prompt</label>
                      <textarea value={item.prompt} onChange={(e) => handlePromptChange(index, e.target.value)} rows={4} className="textarea-field font-mono text-xs" disabled={loading} />
                      <button type="button" onClick={() => handleRegenerate(index)} className="mt-1 text-[10px] text-zinc-500 hover:text-zinc-400" disabled={loading}>\u21BB Regenerate from Brand DNA</button>
                    </div>
                    <div>
                      <label className="label">Additional Details (Optional)</label>
                      <textarea value={item.custom_text} onChange={(e) => handleCustomTextChange(index, e.target.value)} placeholder="Add specific instructions..." rows={2} className="textarea-field" disabled={loading} />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 line-clamp-2 font-mono">{item.prompt}</p>
                )}
              </div>
            ))
          )}

          <div className="flex items-center justify-between pt-4">
            <span className="text-sm text-zinc-400">{prompts.length} prompts ready</span>
            <button type="submit" disabled={loading || prompts.length === 0} className="btn btn-primary">
              {loading ? 'Preparing...' : 'Continue to Generate'}
            </button>
          </div>

          {error && <div className="card border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}
        </form>
      </div>
    </div>
  )
}
