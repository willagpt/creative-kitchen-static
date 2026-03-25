import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TEMPLATES, CATEGORIES } from '../lib/templates'

export default function Templates() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [selectedTemplates, setSelectedTemplates] = useState([])
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0] || 'comparison')
  const [error, setError] = useState('')

  useEffect(() => {
    const brandDNA = sessionStorage.getItem('brandDNA')
    if (!brandDNA) navigate('/brand-dna')
  }, [navigate])

  const handleTemplateToggle = (templateId) => {
    setSelectedTemplates((prev) =>
      prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]
    )
  }

  const handleSelectAll = () => {
    const catTemplates = TEMPLATES.filter((t) => t.category === activeCategory).map((t) => t.id)
    const allSelected = catTemplates.every((id) => selectedTemplates.includes(id))
    if (allSelected) {
      setSelectedTemplates((prev) => prev.filter((id) => !catTemplates.includes(id)))
    } else {
      setSelectedTemplates((prev) => [...new Set([...prev, ...catTemplates])])
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (selectedTemplates.length === 0) { setError('Please select at least one template'); return }
    setLoading(true)
    try {
      const templates = TEMPLATES.filter((t) => selectedTemplates.includes(t.id))
      sessionStorage.setItem('selectedTemplates', JSON.stringify(templates))
      navigate('/prompt-lab')
    } catch (err) {
      setError(err.message || 'Failed to select templates')
    } finally {
      setLoading(false)
    }
  }

  const currentCategoryTemplates = TEMPLATES.filter((t) => t.category === activeCategory)
  const categorySelectedCount = currentCategoryTemplates.filter((t) => selectedTemplates.includes(t.id)).length

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Template Selection</h1>
          <p className="text-zinc-400 text-sm">Step 3 — Choose marketing templates</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="card">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => {
                const count = TEMPLATES.filter((t) => t.category === category).length
                const selected = TEMPLATES.filter((t) => t.category === category && selectedTemplates.includes(t.id)).length
                return (
                  <button key={category} type="button" onClick={() => setActiveCategory(category)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      activeCategory === category ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}>
                    {category} <span className="opacity-75">({selected}/{count})</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">{activeCategory}</h3>
            <button type="button" onClick={handleSelectAll} className="btn btn-secondary text-xs">
              {categorySelectedCount === currentCategoryTemplates.length && currentCategoryTemplates.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {currentCategoryTemplates.map((template) => (
              <button key={template.id} type="button" onClick={() => handleTemplateToggle(template.id)}
                className={`card-sm text-left transition-all ${
                  selectedTemplates.includes(template.id) ? 'border-orange-500 bg-orange-500/10' : 'hover:border-zinc-600'
                }`}>
                <h4 className="font-medium text-sm mb-1">{template.name}</h4>
                <p className="text-[11px] text-zinc-500">{template.category}</p>
                {selectedTemplates.includes(template.id) && <div className="mt-2 text-xs text-orange-400 font-medium">\u2713 Selected</div>}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">{selectedTemplates.length} templates selected</span>
            <button type="submit" disabled={loading || selectedTemplates.length === 0} className="btn btn-primary">
              {loading ? 'Preparing...' : 'Continue to Prompt Lab'}
            </button>
          </div>

          {error && <div className="card border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}
        </form>
      </div>
    </div>
  )
}
