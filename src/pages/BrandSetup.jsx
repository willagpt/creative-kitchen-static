import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function BrandSetup() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    brand_name: '',
    brand_url: '',
    brand_product: '',
  })
  const [error, setError] = useState('')

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!formData.brand_name.trim()) throw new Error('Brand name is required')
      if (!formData.brand_url.trim()) throw new Error('Brand URL is required')
      if (!formData.brand_product.trim()) throw new Error('Brand product is required')

      const { data, error: insertError } = await supabase
        .from('static_runs')
        .insert([{
          brand_name: formData.brand_name.trim(),
          brand_url: formData.brand_url.trim(),
          brand_product: formData.brand_product.trim(),
          brand_dna: null,
        }])
        .select()

      if (insertError) throw insertError
      if (!data || data.length === 0) throw new Error('Failed to create run')

      const runId = data[0].id
      sessionStorage.setItem('currentRunId', runId)
      sessionStorage.setItem('brandSetup', JSON.stringify({
        brand_name: formData.brand_name,
        brand_url: formData.brand_url,
        brand_product: formData.brand_product,
      }))

      navigate('/brand-dna')
    } catch (err) {
      console.error('Error creating run:', err)
      setError(err.message || 'Failed to create brand run')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Creative Kitchen Static</h1>
          <p className="text-gray-400">Step 1: Brand Setup</p>
        </div>

        <div className="mb-10 p-6 bg-gray-900 rounded-lg border border-gray-800">
          <h2 className="text-xl font-semibold mb-3">Let's start with your brand</h2>
          <p className="text-gray-300 leading-relaxed">
            Tell us about your brand so we can generate marketing images tailored to your identity.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Brand Name</label>
            <input type="text" name="brand_name" value={formData.brand_name} onChange={handleChange} placeholder="e.g., Artisan Coffee Co." className="input-field w-full" disabled={loading} />
            <p className="text-xs text-gray-500 mt-1">Your brand name as it should appear in generated content</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Brand Website</label>
            <input type="url" name="brand_url" value={formData.brand_url} onChange={handleChange} placeholder="https://example.com" className="input-field w-full" disabled={loading} />
            <p className="text-xs text-gray-500 mt-1">Your website URL (for brand analysis)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Primary Product/Service</label>
            <input type="text" name="brand_product" value={formData.brand_product} onChange={handleChange} placeholder="e.g., Premium coffee beans and espresso machines" className="input-field w-full" disabled={loading} />
            <p className="text-xs text-gray-500 mt-1">What does your brand sell or offer?</p>
          </div>

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 text-base font-medium">
            {loading ? 'Creating run...' : 'Continue to Brand DNA'}
          </button>
        </form>
      </div>
    </div>
  )
}
