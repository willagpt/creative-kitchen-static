import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { supabaseV3 } from '../lib/supabase-v3'

const V3_FN_URL = 'https://ajpxzifhoohjkyoyktsi.supabase.co/functions/v1/static-launcher'

async function callLauncher(action, body = {}) {
  const res = await fetch(V3_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  return res.json()
}

const CTA_OPTIONS = [
  { value: 'LEARN_MORE', label: 'Learn More' },
  { value: 'SHOP_NOW', label: 'Shop Now' },
  { value: 'ORDER_NOW', label: 'Order Now' },
  { value: 'SIGN_UP', label: 'Sign Up' },
  { value: 'GET_OFFER', label: 'Get Offer' },
  { value: 'BUY_NOW', label: 'Buy Now' },
]

const STATUS_STYLES = {
  draft: { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
  ready: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  pushing: { bg: 'rgba(168,225,12,0.15)', color: '#a8e10c' },
  live: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  paused: { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  error: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
}

export default function Launcher({ brands, activeBrandId }) {
  // Winner images from local supabase
  const [winners, setWinners] = useState([])
  const [loadingWinners, setLoadingWinners] = useState(true)

  // Launches from v3
  const [launches, setLaunches] = useState([])
  const [loadingLaunches, setLoadingLaunches] = useState(true)

  // Meta config
  const [accounts, setAccounts] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [adsets, setAdsets] = useState([])

  // Build form
  const [selectedWinners, setSelectedWinners] = useState(new Set())
  const [showBuildPanel, setShowBuildPanel] = useState(false)
  const [buildForm, setBuildForm] = useState({
    headline: '',
    primary_text: '',
    cta_type: 'SHOP_NOW',
    destination_url: '',
    display_link: '',
    daily_budget: 0,
    campaign_id: '',
    campaign_name: '',
    adset_id: '',
    adset_name: '',
  })
  const [creating, setCreating] = useState(false)
  const [pushing, setPushing] = useState(false)

  // Tab: winners | launches
  const [view, setView] = useState('winners')

  // Load winner images
  async function loadWinners() {
    setLoadingWinners(true)
    let query = supabase
      .from('gen_images')
      .select('*')
      .eq('is_winner', true)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })

    const { data } = await query
    setWinners(data || [])
    setLoadingWinners(false)
  }

  // Load existing launches
  async function loadLaunches() {
    setLoadingLaunches(true)
    const { launches: data } = await callLauncher('list-launches')
    setLaunches(data || [])
    setLoadingLaunches(false)
  }

  // Load ad accounts
  async function loadAccounts() {
    const { accounts: data } = await callLauncher('list-accounts')
    setAccounts(data || [])
    if (data?.length) {
      setSelectedAccountId(data[0].id)
      // Apply defaults
      const acct = data[0]
      setBuildForm(f => ({
        ...f,
        headline: acct.default_headline || f.headline,
        primary_text: acct.default_primary_text || f.primary_text,
        cta_type: acct.default_cta_type || f.cta_type,
        destination_url: buildDestUrl(acct),
        display_link: acct.default_display_link || f.display_link,
        daily_budget: acct.default_daily_budget || f.daily_budget,
      }))
    }
  }

  function buildDestUrl(acct) {
    let url = acct.default_destination_url || ''
    if (acct.default_utm_params && url) {
      url += (url.includes('?') ? '&' : '?') + acct.default_utm_params
    }
    return url
  }

  // Load campaigns when account changes
  async function loadCampaigns(accountId) {
    if (!accountId) { setCampaigns([]); return }
    const { campaigns: data } = await callLauncher('list-campaigns', { ad_account_id: accountId })
    setCampaigns(data || [])
  }

  // Load adsets when campaign changes
  async function loadAdsets(accountId, campaignId) {
    if (!accountId || !campaignId) { setAdsets([]); return }
    const { adsets: data } = await callLauncher('list-adsets', { ad_account_id: accountId, campaign_id: campaignId })
    setAdsets(data || [])
  }

  useEffect(() => { loadWinners(); loadLaunches(); loadAccounts() }, [])
  useEffect(() => { loadCampaigns(selectedAccountId) }, [selectedAccountId])
  useEffect(() => { loadAdsets(selectedAccountId, buildForm.campaign_id) }, [selectedAccountId, buildForm.campaign_id])

  // Toggle winner selection
  function toggleWinner(id) {
    setSelectedWinners(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selectedWinners.size === winners.length) {
      setSelectedWinners(new Set())
    } else {
      setSelectedWinners(new Set(winners.map(w => w.id)))
    }
  }

  // Create launches from selected winners
  async function createLaunches() {
    if (selectedWinners.size === 0) return
    setCreating(true)

    const selectedImages = winners.filter(w => selectedWinners.has(w.id))
    const created = []

    for (const img of selectedImages) {
      const mealName = img.variables_used?.MEAL_NAME || 'Static Ad'
      const ratio = img.aspect_ratio || '4:5'
      const adName = `S-${mealName.slice(0, 20)}-${ratio}`

      const { launch, error } = await callLauncher('create-launch', {
        image_url: img.image_url,
        ad_name: adName,
        headline: buildForm.headline,
        primary_text: buildForm.primary_text,
        description: '',
        cta_type: buildForm.cta_type,
        destination_url: buildForm.destination_url,
        display_link: buildForm.display_link,
        daily_budget: buildForm.daily_budget,
        ad_account_id: selectedAccountId,
        platform_campaign_id: buildForm.campaign_id,
        campaign_name: buildForm.campaign_name,
        platform_adset_id: buildForm.adset_id,
        ad_set_name: buildForm.adset_name,
      })

      if (launch) created.push(launch)
      if (error) console.error('Failed to create launch:', error)
    }

    setCreating(false)
    setSelectedWinners(new Set())
    setShowBuildPanel(false)

    if (created.length) {
      setView('launches')
      loadLaunches()
    }
  }

  // Push selected launches to Meta
  async function pushLaunches(ids) {
    setPushing(true)
    setLaunches(prev => prev.map(l => ids.includes(l.id) ? { ...l, status: 'pushing' } : l))

    const result = await callLauncher('push', { launch_ids: ids })

    if (result.error) {
      console.error('Push error:', result.error)
    }

    setPushing(false)
    // Reload after a moment to catch status updates
    setTimeout(loadLaunches, 2000)
  }

  // Delete a launch
  async function deleteLaunch(id) {
    await callLauncher('delete-launch', { launch_id: id })
    setLaunches(prev => prev.filter(l => l.id !== id))
  }

  // Draft launches ready to push
  const readyLaunches = launches.filter(l => {
    if (l.status !== 'draft') return false
    return l.image_url && l.headline && l.primary_text && l.destination_url && l.platform_campaign_id && l.platform_adset_id
  })

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Launcher</h2>
          <p className="page-subtitle">Send winner images to Meta as static ads.</p>
        </div>
      </div>

      {/* View toggle */}
      <div className="launcher-tabs">
        <button
          className={`launcher-tab ${view === 'winners' ? 'active' : ''}`}
          onClick={() => setView('winners')}
        >
          Winners ({winners.length})
        </button>
        <button
          className={`launcher-tab ${view === 'launches' ? 'active' : ''}`}
          onClick={() => setView('launches')}
        >
          Launches ({launches.length})
        </button>
      </div>

      {/* Winners view */}
      {view === 'winners' && (
        <>
          {/* Selection toolbar */}
          {winners.length > 0 && (
            <div className="launcher-toolbar">
              <button className="btn btn-ghost btn-sm" onClick={selectAll}>
                {selectedWinners.size === winners.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="launcher-toolbar-count">
                {selectedWinners.size} selected
              </span>
              {selectedWinners.size > 0 && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowBuildPanel(true)}
                >
                  Build Ads ({selectedWinners.size})
                </button>
              )}
            </div>
          )}

          {/* Winner grid */}
          {loadingWinners ? (
            <div className="empty-state"><p>Loading winners...</p></div>
          ) : winners.length === 0 ? (
            <div className="empty-state">
              <h3>No winners yet</h3>
              <p>Mark images as winners in the Review tab, then come back here to launch them.</p>
            </div>
          ) : (
            <div className="launcher-grid">
              {winners.map(img => (
                <div
                  key={img.id}
                  className={`launcher-card ${selectedWinners.has(img.id) ? 'selected' : ''}`}
                  onClick={() => toggleWinner(img.id)}
                >
                  <div className="launcher-card-image">
                    <img src={img.image_url} alt={img.variables_used?.MEAL_NAME || 'Winner'} loading="lazy" />
                    <span className="launcher-card-ratio">{img.aspect_ratio}</span>
                    {selectedWinners.has(img.id) && (
                      <span className="launcher-card-check">&#10003;</span>
                    )}
                  </div>
                  <div className="launcher-card-body">
                    <span className="launcher-card-name">{img.variables_used?.MEAL_NAME || 'Image'}</span>
                    {img.rating && (
                      <span className="launcher-card-rating" data-rating={img.rating}>{img.rating}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Launches view */}
      {view === 'launches' && (
        <>
          {readyLaunches.length > 0 && (
            <div className="launcher-toolbar">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => pushLaunches(readyLaunches.map(l => l.id))}
                disabled={pushing}
              >
                {pushing ? 'Pushing...' : `Push ${readyLaunches.length} Ready Ads to Meta`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={loadLaunches}>Refresh</button>
            </div>
          )}

          {loadingLaunches ? (
            <div className="empty-state"><p>Loading launches...</p></div>
          ) : launches.length === 0 ? (
            <div className="empty-state">
              <h3>No launches yet</h3>
              <p>Select winners and build ads to see them here.</p>
            </div>
          ) : (
            <div className="launches-list">
              {launches.map(launch => {
                const style = STATUS_STYLES[launch.status] || STATUS_STYLES.draft
                return (
                  <div key={launch.id} className="launch-row">
                    <div className="launch-row-image">
                      {launch.image_url ? (
                        <img src={launch.image_url} alt="" />
                      ) : (
                        <div className="launch-row-placeholder">IMG</div>
                      )}
                    </div>
                    <div className="launch-row-info">
                      <span className="launch-row-name">{launch.ad_name}</span>
                      <span className="launch-row-meta">
                        {launch.headline && <span>{launch.headline}</span>}
                        {launch.campaign_name && <span> | {launch.campaign_name}</span>}
                        {launch.ad_set_name && <span> | {launch.ad_set_name}</span>}
                      </span>
                    </div>
                    <span
                      className="launch-row-status"
                      style={{ background: style.bg, color: style.color }}
                      title={launch.push_error || ''}
                    >
                      {launch.status}
                    </span>
                    <div className="launch-row-actions">
                      {launch.status === 'draft' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => pushLaunches([launch.id])}
                          disabled={pushing}
                          title="Push to Meta"
                        >
                          &#x1F680;
                        </button>
                      )}
                      {(launch.status === 'draft' || launch.status === 'error') && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => deleteLaunch(launch.id)}
                          title="Delete"
                        >
                          &#x2715;
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Build panel overlay */}
      {showBuildPanel && (
        <div className="launcher-overlay" onClick={e => { if (e.target === e.currentTarget) setShowBuildPanel(false) }}>
          <div className="launcher-build-panel">
            <div className="detail-header">
              <span className="font-heading">Build {selectedWinners.size} Static Ads</span>
              <button className="detail-close" onClick={() => setShowBuildPanel(false)}>&times;</button>
            </div>

            <div className="launcher-build-body">
              {/* Preview strip */}
              <div className="launcher-preview-strip">
                {winners.filter(w => selectedWinners.has(w.id)).map(w => (
                  <div key={w.id} className="launcher-preview-thumb">
                    <img src={w.image_url} alt="" />
                  </div>
                ))}
              </div>

              {/* Account */}
              <label className="field-label">Ad Account</label>
              <select
                className="select-input"
                value={selectedAccountId}
                onChange={e => {
                  setSelectedAccountId(e.target.value)
                  const acct = accounts.find(a => a.id === e.target.value)
                  if (acct) {
                    setBuildForm(f => ({
                      ...f,
                      headline: acct.default_headline || '',
                      primary_text: acct.default_primary_text || '',
                      cta_type: acct.default_cta_type || 'SHOP_NOW',
                      destination_url: buildDestUrl(acct),
                      display_link: acct.default_display_link || '',
                      daily_budget: acct.default_daily_budget || 0,
                      campaign_id: '',
                      campaign_name: '',
                      adset_id: '',
                      adset_name: '',
                    }))
                  }
                }}
              >
                <option value="">Select account...</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
              </select>

              {/* Campaign */}
              <label className="field-label mt-md">Campaign</label>
              <select
                className="select-input"
                value={buildForm.campaign_id}
                onChange={e => {
                  const campaign = campaigns.find(c => c.id === e.target.value)
                  setBuildForm(f => ({
                    ...f,
                    campaign_id: e.target.value,
                    campaign_name: campaign?.name || '',
                    adset_id: '',
                    adset_name: '',
                  }))
                }}
                disabled={!selectedAccountId}
              >
                <option value="">{selectedAccountId ? 'Select campaign...' : 'Set account first'}</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.status.toLowerCase()})</option>
                ))}
              </select>

              {/* Ad Set */}
              <label className="field-label mt-md">Ad Set</label>
              <select
                className="select-input"
                value={buildForm.adset_id}
                onChange={e => {
                  const adset = adsets.find(a => a.id === e.target.value)
                  setBuildForm(f => ({
                    ...f,
                    adset_id: e.target.value,
                    adset_name: adset?.name || '',
                  }))
                }}
                disabled={!buildForm.campaign_id}
              >
                <option value="">{buildForm.campaign_id ? 'Select ad set...' : 'Set campaign first'}</option>
                {adsets.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.status.toLowerCase()})</option>
                ))}
              </select>

              <div className="launcher-build-divider" />

              {/* Headline */}
              <label className="field-label">Headline (40 chars)</label>
              <input
                className="text-input"
                type="text"
                value={buildForm.headline}
                onChange={e => setBuildForm(f => ({ ...f, headline: e.target.value }))}
                maxLength={40}
                placeholder="Your headline..."
              />

              {/* Primary text */}
              <label className="field-label mt-md">Primary Text (125 chars)</label>
              <textarea
                className="prompt-textarea"
                value={buildForm.primary_text}
                onChange={e => setBuildForm(f => ({ ...f, primary_text: e.target.value }))}
                maxLength={125}
                placeholder="Your primary text..."
                rows={3}
                style={{ minHeight: 60 }}
              />

              {/* CTA */}
              <label className="field-label mt-md">CTA</label>
              <select
                className="select-input"
                value={buildForm.cta_type}
                onChange={e => setBuildForm(f => ({ ...f, cta_type: e.target.value }))}
              >
                {CTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              {/* URL */}
              <label className="field-label mt-md">Destination URL</label>
              <input
                className="text-input"
                type="text"
                value={buildForm.destination_url}
                onChange={e => setBuildForm(f => ({ ...f, destination_url: e.target.value }))}
                placeholder="https://..."
              />

              {/* Budget */}
              <label className="field-label mt-md">Daily Budget (GBP)</label>
              <input
                className="text-input"
                type="number"
                value={buildForm.daily_budget}
                onChange={e => setBuildForm(f => ({ ...f, daily_budget: Number(e.target.value) }))}
                min={0}
                step={1}
              />

              {/* Actions */}
              <div className="launcher-build-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowBuildPanel(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={createLaunches}
                  disabled={creating || !selectedAccountId}
                >
                  {creating ? 'Creating...' : `Create ${selectedWinners.size} Ad Launches`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
