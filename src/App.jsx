import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Gallery from './components/Gallery'
import AdDetail from './components/AdDetail'

export default function App() {
  const [ads, setAds] = useState([])
  const [versions, setVersions] = useState({}) // { adId: [versions] }
  const [loading, setLoading] = useState(true)
  const [selectedAdId, setSelectedAdId] = useState(null)
  const [filter, setFilter] = useState('all')

  async function loadAds() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('saved_ads')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setAds(data || [])

      // Load versions for all ads in one query
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

  useEffect(() => { loadAds() }, [])

  // Subscribe to realtime changes on saved_ads
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

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <span style={{ fontSize: 20 }}>&#x1F373;</span>
          <span className="nav-title">Creative Kitchen</span>
          <span className="nav-divider">|</span>
          <span className="nav-subtitle">Ad Studio</span>
        </div>
        <div className="nav-right">
          <button className="btn btn-ghost btn-sm" onClick={loadAds}>
            &#x21bb; Refresh
          </button>
        </div>
      </nav>

      <div className="container">
        <Gallery
          ads={filteredAds}
          versions={versions}
          loading={loading}
          filter={filter}
          setFilter={setFilter}
          stats={stats}
          onSelectAd={setSelectedAdId}
        />
      </div>

      {selectedAd && (
        <AdDetail
          ad={selectedAd}
          versions={selectedVersions}
          onClose={() => setSelectedAdId(null)}
          onRefresh={loadAds}
        />
      )}
    </>
  )
}
