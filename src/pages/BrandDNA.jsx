import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function BrandDNA() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [dna, setDna] = useState({
    colors: ['#000000', '#FFFFFF'],
    style: 'modern',
    photography_style: 'professional',
    claims: [],
  })
  const [newClaim, setNewClaim] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const setupData = sessionStorage.getItem('brandSetup')
    if (!setupData) navigate('/')
  }, [navigate])

  const handleColorChange = (index, value) => {
    const newColors = [...dna.colors]
    newColors[index] = value
    setDna({ ...dna, colors: newColors })
  }

  const handleAddColor = () => {
    if (dna.colors.length < 5) setDna({ ...dna, colors: [...dna.colors, '#808080'] })
  }

  const handleRemoveColor = (index) => {
    if (dna.colors.length > 1) setDna({ ...dna, colors: dna.colors.filter((_, i) => i !== index) })
  }

  const handleAddClaim = () => {
    if (newClaim.trim() && dna.claims.length < 5) {
      setDna({ ...dna, claims: [...dna.claims, newClaim.trim()] })
      setNewClaim('')
    }
  }

  const handleRemoveClaim = (index) => {
    setDna({ ...dna, claims: dna.claims.filter((_, i) => i !== index) })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const runId = sessionStorage.getItem('currentRunId')
      if (!runId) throw new Error('Run ID not found')

      const { error: updateError } = await supabase
        .from('static_runs')
        .update({ brand_dna: dna })
        .eq('id', runId)

      if (updateError) throw updateError

      sessionStorage.setItem('brandDNA', JSON.stringify(dna))
      navigate('/templates')
    } catch (err) {
      console.error('Error updating brand DNA:', err)
      setError(err.message || 'Failed to save brand DNA')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Brand DNA</h1>
          <p className="text-gray-400">Step 2: Define Your Visual Identity</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label className="block text-sm font-medium mb-3">Brand Colors</label>
            <div className="space-y-3">
              {dna.colors.map((color, index) => (
                <div key={index} className="flex items-center gap-3">
                  <input type="color" value={color} onChange={(e) => handleColorChange(index, e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-gray-700" disabled={loading} />
                  <input type="text" value={color} onChange={(e) => handleColorChange(index, e.target.value)} className="input-field flex-1" disabled={loading} />
                  {dna.colors.length > 1 && (
                    <button type="button" onClick={() => handleRemoveColor(index)} className="px-3 py-2 text-sm bg-red-900/30 border border-red-700 rounded hover:bg-red-900/50" disabled={loading}>Remove</button>
                  )}
                </div>
              ))}
            </div>
            {dna.colors.length < 5 && (
              <button type="button" onClick={handleAddColor} className="mt-3 px-4 py-2 text-sm bg-gray-800 border border-gray-700 rounded hover:bg-gray-700" disabled={loading}>Add Color</button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Design Style</label>
            <select value={dna.style} onChange={(e) => setDna({ ...dna, style: e.target.value })} className="input-field w-full" disabled={loading}>
              <option value="modern">Modern</option>
              <option value="minimalist">Minimalist</option>
              <option value="vintage">Vintage</option>
              <option value="playful">Playful</option>
              <option value="elegant">Elegant</option>
              <option value="bold">Bold</option>
              <option value="rustic">Rustic</option>
              <option value="tech">Tech</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Photography Style</label>
            <select value={dna.photography_style} onChange={(e) => setDna({ ...dna, photography_style: e.target.value })} className="input-field w-full" disabled={loading}>
              <option value="professional">Professional</option>
              <option value="lifestyle">Lifestyle</option>
              <option value="product">Product</option>
              <option value="editorial">Editorial</option>
              <option value="candid">Candid</option>
              <option value="artistic">Artistic</option>
              <option value="documentary">Documentary</option>
              <option value="flat-lay">Flat Lay</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Brand Claims & Values</label>
            <div className="flex gap-2 mb-3">
              <input type="text" value={newClaim} onChange={(e) => setNewClaim(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddClaim())} placeholder="e.g., Sustainable, Premium Quality" className="input-field flex-1" disabled={loading} />
              <button type="button" onClick={handleAddClaim} className="btn btn-primary" disabled={loading || dna.claims.length >= 5}>Add</button>
            </div>
            {dna.claims.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {dna.claims.map((claim, index) => (
                  <div key={index} className="badge badge-accent">
                    <span>{claim}</span>
                    <button type="button" onClick={() => handleRemoveClaim(index)} className="ml-1 hover:text-red-400" disabled={loading}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>}

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 text-base font-medium">
            {loading ? 'Saving DNA...' : 'Continue to Templates'}
          </button>
        </form>
      </div>
    </div>
  )
}
