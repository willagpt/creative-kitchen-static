import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Gallery from './components/Gallery'
import AdDetail from './components/AdDetail'
import BrandDNA from './components/BrandDNA'
import PhotoLibrary from './components/PhotoLibrary'
import Generator from './components/Generator'
import Review from './components/Review'

const TABS = [
  { key: 'gallery', label: 'Ad Library' },
  { key: 'brand', label: 'Brand DNA' },
  { key: 'photos', label: 'Photo Library' },
  { key: 'generator', label: 'Generator' },
  { key: 'review', label: 'Review' },
]

export default function App() {
  const [tab, setTab] = useState('gallery')

  // Gallery state
  const [ads, setAds] = useState([])
  const [versions, setVersions] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedAdId, setSelectedAdId] = useState(null)
  const [filter, setFilter] = useState('all')

  // Shared state
  const [brands, setBrands] = useState([])
  const [activeBrandId, setActiveBrandId] = useState(null)

  async function loadAds() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('saved_ads')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setAds(data || [])

      const { data: allVersions } = await supabase
        .from('generated_versions')
        .select('*')
        .order('created_at', { ascending: false })

      const versionMap = {}
      for (const v of (allVersions || [])) {
        if (!versionMap[v.saved_ad_id]) versionMap[v.saved_ad_id] = []
        versionMap[v.saved_ad_id].push(v)
      }
      setVersions(versionMap)
    } catch (err) {
      console.error('Failed to load ads:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadBrands() {
    const { data } = await supabase.from('brands').select('*').order('name')
    setBrands(data || [])
    if (data?.length && !activeBrandId) setActiveBrandId(data[0].id)
  }

  useEffect(() => { loadAds(); loadBrands() }, [])

  useEffect(() => {
    const channel = supabase
      .channel('ads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_ads' }, () => loadAds())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'generated_versions' }, () => loadAds())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const selectedAd = ads.find(a => a.id === selectedAdId)
  const selectedVersions = selectedAdId ? (versions[selectedAdId] || []) : []

  const filteredAds = ads.filter(ad => {
    if (filter === 'all') return true
    if (filter === 'with-prompt') return !!ad.generated_prompt
    if (filter === 'with-image') return !!ad.generated_image_url || (versions[ad.id]?.length > 0)
    if (filter === 'pending') return !ad.generated_prompt
    return true
  })

  const stats = {
    total: ads.length,
    withPrompt: ads.filter(a => a.generated_prompt).length,
    withImages: ads.filter(a => a.generated_image_url || versions[a.id]?.length > 0).length,
  }

  // Navigation helper: jump to generator with a specific ad pre-selected
  function goToGenerator(adId) {
    setSelectedAdId(null)
    setTab('generator')
    // The Generator component will handle loading the ad + template
    window.__ckGeneratorAdId = adId
  }

  return (
    <>
      <header>
      <nav className="nav" aria-label="Main navigation">
        <div className="nav-left">
          <span className="nav-logo">CK</span>
          <span className="nav-title">Creative Kitchen</span>
        </div>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`nav-tab ${tab === t.key ? 'active' : ''}`}
              data-tab={t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <button className="btn btn-ghost btn-sm" onClick={() => { loadAds(); loadBrands() }} aria-label="Refresh data" title="Refresh">
            &#x21bb;
          </button>
        </div>
      </nav>
      </header>

      <main className="container">
        {tab === 'gallery' && (
          <Gallery
            ads={filteredAds}
            versions={versions}
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            stats={stats}
            onSelectAd={setSelectedAdId}
          />
        )}

        {tab === 'brand' && (
          <BrandDNA
            brands={brands}
            activeBrandId={activeBrandId}
            setActiveBrandId={setActiveBrandId}
            onRefresh={loadBrands}
          />
        )}

        {tab === 'photos' && (
          <PhotoLibrary
            brands={brands}
            activeBrandId={activeBrandId}
          />
        )}

        {tab === 'generator' && (
          <Generator
            ads={ads}
            versions={versions}
            brands={brands}
            activeBrandId={activeBrandId}
          />
        )}

        {tab === 'review' && (
          <Review
            brands={brands}
            activeBrandId={activeBrandId}
          />
        )}
      </main>

      {selectedAd && (
        <AdDetail
          ad={selectedAd}
          versions={selectedVersions}
          onClose={() => setSelectedAdId(null)}
          onRefresh={loadAds}
          onTemplatize={goToGenerator}
        />
      )}
    </>
  )
}
