import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const V3_FN_URL = 'https://ajpxzifhoohjkyoyktsi.supabase.co/functions/v1/static-launcher'

/* ── Column config ──────────────────────────────────── */
const COLUMNS = [
  { key: 'checkbox', label: '', defaultWidth: 40 },
  { key: 'status', label: 'Status', defaultWidth: 80 },
  { key: 'image', label: 'Image', defaultWidth: 64 },
  { key: 'account', label: 'Account', defaultWidth: 130 },
  { key: 'ad_name', label: 'Ad Name', defaultWidth: 160 },
  { key: 'headline', label: 'Headline', defaultWidth: 220 },
  { key: 'primary_text', label: 'Primary Text', defaultWidth: 300 },
  { key: 'cta_type', label: 'CTA', defaultWidth: 100 },
  { key: 'destination_url', label: 'URL', defaultWidth: 180 },
  { key: 'campaign', label: 'Campaign', defaultWidth: 160 },
  { key: 'adset', label: 'Ad Set', defaultWidth: 160 },
  { key: 'budget', label: 'Budget', defaultWidth: 80 },
  { key: 'actions', label: 'Actions', defaultWidth: 110 },
]

function getDefaultColWidths() {
  const widths = {}
  COLUMNS.forEach(c => { widths[c.key] = c.defaultWidth })
  return widths
}

function loadColWidths() {
  try {
    const saved = localStorage.getItem('static-launch-col-widths')
    return saved ? { ...getDefaultColWidths(), ...JSON.parse(saved) } : getDefaultColWidths()
  } catch { return getDefaultColWidths() }
}

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

const STATUS_COLORS = {
  draft: { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
  ready: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  pushing: { bg: 'rgba(168,225,12,0.15)', color: '#a8e10c' },
  live: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  paused: { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  error: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
}

function validateRow(launch) {
  const errors = []
  if (!launch.ad_name) errors.push('Ad name required')
  if (!launch.headline) errors.push('Headline required')
  if (!launch.primary_text) errors.push('Primary text required')
  if (!launch.destination_url) errors.push('URL required')
  if (!launch.platform_campaign_id) errors.push('Campaign required')
  if (!launch.platform_adset_id) errors.push('Ad set required')
  if (!launch.image_url) errors.push('No image attached')
  return { valid: errors.length === 0, errors }
}

/* Editable cell: click to edit inline, V3-quality */
function EditableCell({ value, onChange, placeholder = '', maxLength, multiline = false, showCharCount = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value || ''))
  const inputRef = useRef(null)

  function commit() {
    setEditing(false)
    if (draft !== String(value || '')) onChange(draft)
  }

  if (!editing) {
    const charLen = String(value || '').length
    const isOver = maxLength && charLen > maxLength
    return (
      <div>
        <div
          className={`launch-cell-value ${multiline ? 'multiline' : ''}`}
          onClick={() => { setDraft(String(value || '')); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          title={String(value || '')}
        >
          {value || <span className="launch-cell-placeholder">{placeholder}</span>}
        </div>
        {showCharCount && value && (
          <div className={`launch-charcount ${isOver ? 'over' : ''}`}>{charLen}{maxLength ? `/${maxLength}` : ''}</div>
        )}
      </div>
    )
  }

  if (multiline) {
    return (
      <div>
        <textarea
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() } if (e.key === 'Escape') { setDraft(String(value || '')); setEditing(false) } }}
          maxLength={maxLength}
          placeholder={placeholder}
          className="launch-cell-input launch-cell-textarea"
          rows={3}
        />
        {maxLength && <div className={`launch-charcount ${draft.length > maxLength ? 'over' : ''}`}>{draft.length}/{maxLength}</div>}
      </div>
    )
  }

  return (
    <div>
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value || '')); setEditing(false) } }}
        maxLength={maxLength}
        placeholder={placeholder}
        className="launch-cell-input"
      />
      {maxLength && <div className={`launch-charcount ${draft.length > maxLength ? 'over' : ''}`}>{draft.length}/{maxLength}</div>}
    </div>
  )
}

export default function Launcher({ brands, activeBrandId }) {
  // Launches from v3 edge function
  const [launches, setLaunches] = useState([])
  const [loading, setLoading] = useState(true)

  // Winners from local supabase (for "add from winners" flow)
  const [winners, setWinners] = useState([])
  const [showWinnerPicker, setShowWinnerPicker] = useState(false)

  // Meta config
  const [accounts, setAccounts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [adsets, setAdsets] = useState([])
  const [campaignCache, setCampaignCache] = useState({})
  const [adsetCache, setAdsetCache] = useState({})

  // Defaults from active account
  const [activeAccountId, setActiveAccountId] = useState('')
  const [defaults, setDefaults] = useState({})

  // Push state
  const [pushing, setPushing] = useState(false)
  const [showPushModal, setShowPushModal] = useState(false)

  // Tab filter
  const [tab, setTab] = useState('all')

  // Selected rows
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Resizable columns
  const [colWidths, setColWidths] = useState(loadColWidths)
  const resizingRef = useRef(null)

  const onResizeStart = useCallback((colKey, e) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { col: colKey, startX: e.clientX, startW: colWidths[colKey] }

    const onMove = (ev) => {
      if (!resizingRef.current) return
      const diff = ev.clientX - resizingRef.current.startX
      const newW = Math.max(50, resizingRef.current.startW + diff)
      setColWidths(prev => ({ ...prev, [resizingRef.current.col]: newW }))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setColWidths(prev => {
        try { localStorage.setItem('static-launch-col-widths', JSON.stringify(prev)) } catch {}
        return prev
      })
      resizingRef.current = null
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [colWidths])

  const tableMinWidth = useMemo(() =>
    Object.values(colWidths).reduce((a, b) => a + b, 0),
  [colWidths])

  // Load launches
  async function loadLaunches() {
    setLoading(true)
    const { launches: data } = await callLauncher('list-launches')
    setLaunches(data || [])
    setLoading(false)
  }

  // Load ad accounts
  async function loadAccounts() {
    const { accounts: data } = await callLauncher('list-accounts')
    setAccounts(data || [])
    if (data?.length) {
      const acct = data[0]
      setActiveAccountId(acct.id)
      setDefaults({
        headline: acct.default_headline || '',
        primary_text: acct.default_primary_text || '',
        cta_type: acct.default_cta_type || 'SHOP_NOW',
        destination_url: buildDestUrl(acct),
        display_link: acct.default_display_link || '',
        daily_budget: acct.default_daily_budget || 0,
      })
    }
  }

  function buildDestUrl(acct) {
    let url = acct.default_destination_url || ''
    if (acct.default_utm_params && url) {
      url += (url.includes('?') ? '&' : '?') + acct.default_utm_params
    }
    return url
  }

  // Load campaigns for an account
  async function loadCampaigns(accountId) {
    if (!accountId) return []
    if (campaignCache[accountId]) return campaignCache[accountId]
    const { campaigns: data } = await callLauncher('list-campaigns', { ad_account_id: accountId })
    const list = data || []
    setCampaignCache(prev => ({ ...prev, [accountId]: list }))
    return list
  }

  // Load adsets for a campaign
  async function loadAdsets(accountId, campaignId) {
    if (!accountId || !campaignId) return []
    const key = accountId + '__' + campaignId
    if (adsetCache[key]) return adsetCache[key]
    const { adsets: data } = await callLauncher('list-adsets', { ad_account_id: accountId, campaign_id: campaignId })
    const list = data || []
    setAdsetCache(prev => ({ ...prev, [key]: list }))
    return list
  }

  // Load winners from local supabase
  async function loadWinners() {
    const { data } = await supabase
      .from('gen_images')
      .select('*')
      .eq('is_winner', true)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
    setWinners(data || [])
  }

  useEffect(() => { loadLaunches(); loadAccounts(); loadWinners() }, [])

  // Pre-fetch campaigns for active account
  useEffect(() => {
    if (activeAccountId) loadCampaigns(activeAccountId)
  }, [activeAccountId])

  // Inline cell edit: update locally + via edge function
  async function handleCellEdit(launchId, field, value) {
    // Optimistic update
    setLaunches(prev => prev.map(l =>
      l.id === launchId ? { ...l, [field]: field === 'daily_budget' ? Number(value) : value } : l
    ))
    // Persist via edge function
    await callLauncher('update-launch', {
      launch_id: launchId,
      updates: { [field]: field === 'daily_budget' ? Number(value) : value },
    })
  }

  // Account change: apply defaults + clear campaign/adset
  async function handleAccountChange(launchId, accountId) {
    setActiveAccountId(accountId)
    const acct = accounts.find(a => a.id === accountId)
    const updates = {
      ad_account_id: accountId,
      platform_campaign_id: '',
      campaign_name: '',
      platform_adset_id: '',
      ad_set_name: '',
      headline: acct?.default_headline || '',
      primary_text: acct?.default_primary_text || '',
      cta_type: acct?.default_cta_type || 'SHOP_NOW',
      destination_url: acct ? buildDestUrl(acct) : '',
      display_link: acct?.default_display_link || '',
      daily_budget: acct?.default_daily_budget || 0,
    }
    setLaunches(prev => prev.map(l => l.id === launchId ? { ...l, ...updates } : l))
    await callLauncher('update-launch', { launch_id: launchId, updates })
    loadCampaigns(accountId)
  }

  // Campaign select
  async function handleCampaignSelect(launchId, campaignId, campaigns) {
    const campaign = campaigns.find(c => c.id === campaignId)
    const updates = {
      platform_campaign_id: campaignId,
      campaign_name: campaign?.name || '',
      platform_adset_id: '',
      ad_set_name: '',
    }
    setLaunches(prev => prev.map(l => l.id === launchId ? { ...l, ...updates } : l))
    await callLauncher('update-launch', { launch_id: launchId, updates })
    if (campaignId) {
      const launch = launches.find(l => l.id === launchId)
      loadAdsets(launch?.ad_account_id || activeAccountId, campaignId)
    }
  }

  // AdSet select
  async function handleAdSetSelect(launchId, adsetId, adsets) {
    const adset = adsets.find(a => a.id === adsetId)
    const updates = {
      platform_adset_id: adsetId,
      ad_set_name: adset?.name || '',
    }
    setLaunches(prev => prev.map(l => l.id === launchId ? { ...l, ...updates } : l))
    await callLauncher('update-launch', { launch_id: launchId, updates })
  }

  // Add row (blank or from winner image)
  async function addRow(imageUrl = '', adName = '') {
    const { launch, error } = await callLauncher('create-launch', {
      image_url: imageUrl,
      ad_name: adName || 'Static ' + (launches.length + 1),
      headline: defaults.headline || '',
      primary_text: defaults.primary_text || '',
      cta_type: defaults.cta_type || 'SHOP_NOW',
      destination_url: defaults.destination_url || '',
      display_link: defaults.display_link || '',
      daily_budget: defaults.daily_budget || 0,
      ad_account_id: activeAccountId,
      platform_campaign_id: '',
      campaign_name: '',
      platform_adset_id: '',
      ad_set_name: '',
    })
    if (launch) {
      setLaunches(prev => [launch, ...prev])
    }
    if (error) console.error('Failed to create launch:', error)
  }

  // Delete row
  async function handleDelete(id) {
    await callLauncher('delete-launch', { launch_id: id })
    setLaunches(prev => prev.filter(l => l.id !== id))
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  // Duplicate row
  async function handleDuplicate(launch) {
    const { launch: newLaunch } = await callLauncher('create-launch', {
      image_url: launch.image_url || '',
      ad_name: launch.ad_name + ' (copy)',
      headline: launch.headline || '',
      primary_text: launch.primary_text || '',
      cta_type: launch.cta_type || 'SHOP_NOW',
      destination_url: launch.destination_url || '',
      display_link: launch.display_link || '',
      daily_budget: launch.daily_budget || 0,
      ad_account_id: launch.ad_account_id || activeAccountId,
      platform_campaign_id: launch.platform_campaign_id || '',
      campaign_name: launch.campaign_name || '',
      platform_adset_id: launch.platform_adset_id || '',
      ad_set_name: launch.ad_set_name || '',
    })
    if (newLaunch) setLaunches(prev => [newLaunch, ...prev])
  }

  // Push to Meta
  async function handlePush(ids) {
    setPushing(true)
    setLaunches(prev => prev.map(l => ids.includes(l.id) ? { ...l, status: 'pushing' } : l))
    setShowPushModal(false)

    const result = await callLauncher('push', { launch_ids: ids })
    if (result.error) console.error('Push error:', result.error)

    setPushing(false)
    setTimeout(loadLaunches, 2000)
  }

  // Auto-validate: promote draft to ready when valid
  useEffect(() => {
    const updates = []
    launches.forEach(l => {
      const { valid } = validateRow(l)
      if (l.status === 'draft' && valid) updates.push({ id: l.id, status: 'ready' })
      if (l.status === 'ready' && !valid) updates.push({ id: l.id, status: 'draft' })
    })
    if (updates.length) {
      setLaunches(prev => prev.map(l => {
        const u = updates.find(x => x.id === l.id)
        return u ? { ...l, status: u.status } : l
      }))
      updates.forEach(u => callLauncher('update-launch', { launch_id: u.id, updates: { status: u.status } }))
    }
  }, [launches])

  // Filter
  const filtered = useMemo(() => {
    if (tab === 'all') return launches
    return launches.filter(l => l.status === tab)
  }, [launches, tab])

  const tabCounts = useMemo(() => ({
    all: launches.length,
    draft: launches.filter(l => l.status === 'draft').length,
    ready: launches.filter(l => l.status === 'ready').length,
    live: launches.filter(l => l.status === 'live').length,
    error: launches.filter(l => l.status === 'error').length,
  }), [launches])

  const readyLaunches = launches.filter(l => l.status === 'ready')

  // Toggle row selection
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(l => l.id)))
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Launcher</h2>
          <p className="page-subtitle">Build and push static ads to Meta. Each row is one ad.</p>
        </div>
        <div className="launch-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={loadLaunches}>refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setColWidths(getDefaultColWidths()); localStorage.removeItem('static-launch-col-widths') }} title="Reset column widths">reset cols</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { loadWinners(); setShowWinnerPicker(true) }}>
            + from winners
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => addRow()}>
            + add row
          </button>
          {readyLaunches.length > 0 && (
            <button
              className="btn btn-sm"
              style={{ background: 'var(--electric-green)', color: 'var(--bg-0)' }}
              onClick={() => setShowPushModal(true)}
              disabled={pushing}
            >
              {pushing ? 'pushing...' : `push ${readyLaunches.length} to Meta`}
            </button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="launch-tabs">
        {['all', 'draft', 'ready', 'live', 'error'].map(t => (
          <button
            key={t}
            className={`launch-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}{' '}
            <span style={{ opacity: 0.6 }}>({tabCounts[t] || 0})</span>
          </button>
        ))}
      </div>

      {/* Connected account indicator */}
      {accounts.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-md)',
          padding: '6px 12px', background: 'rgba(168, 225, 12, 0.06)', borderRadius: 'var(--radius)',
          border: '1px solid rgba(168, 225, 12, 0.15)', fontSize: 11, color: 'var(--text-2)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--electric-green)', flexShrink: 0 }} />
          Connected: <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{accounts.map(a => a.account_name).join(', ')}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-2)', fontSize: 10 }}>defaults auto-fill on new rows</span>
        </div>
      )}

      {/* Spreadsheet table */}
      {loading ? (
        <div className="empty-state"><p>Loading launches...</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h3>{tab === 'all' ? 'No launches yet' : `No ${tab} launches`}</h3>
          <p style={{ maxWidth: 420, margin: '0 auto var(--space-lg)' }}>
            Each row becomes one ad on Meta. Add a winner image from Review or Prompt Tester, or start with a blank row.
            Account defaults (headline, primary text, CTA, URL, budget) auto-fill when you have a connected account.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { loadWinners(); setShowWinnerPicker(true) }}>
              + from winners
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => addRow()}>
              + add blank row
            </button>
          </div>
          {accounts.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 'var(--space-lg)' }}>
              No ad accounts connected. Set up Meta accounts in V3 Settings to enable defaults and campaign sync.
            </p>
          )}
        </div>
      ) : (
        <div className="launch-table-wrap">
          <table className="launch-table" style={{ minWidth: tableMinWidth }}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`launch-th ${col.key === 'checkbox' ? 'launch-th-check' : ''}`}
                    style={{ width: colWidths[col.key], position: 'relative' }}
                  >
                    {col.key === 'checkbox' ? (
                      <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} />
                    ) : (
                      col.label
                    )}
                    {col.key !== 'checkbox' && col.key !== 'actions' && (
                      <div
                        className="launch-resize-handle"
                        onMouseDown={e => onResizeStart(col.key, e)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(launch => (
                <LaunchRow
                  key={launch.id}
                  launch={launch}
                  accounts={accounts}
                  campaignCache={campaignCache}
                  adsetCache={adsetCache}
                  activeAccountId={activeAccountId}
                  selected={selectedIds.has(launch.id)}
                  onToggleSelect={() => toggleSelect(launch.id)}
                  onCellEdit={handleCellEdit}
                  onAccountChange={handleAccountChange}
                  onCampaignSelect={handleCampaignSelect}
                  onAdSetSelect={handleAdSetSelect}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onPush={handlePush}
                  loadCampaigns={loadCampaigns}
                  loadAdsets={loadAdsets}
                  pushing={pushing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="launch-bulk-bar">
          <span>{selectedIds.size} selected</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { [...selectedIds].forEach(id => handleDelete(id)); setSelectedIds(new Set()) }}
          >
            delete
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSelectedIds(new Set())}
          >
            deselect
          </button>
        </div>
      )}

      {/* Winner picker overlay */}
      {showWinnerPicker && (
        <div className="launcher-overlay" onClick={e => { if (e.target === e.currentTarget) setShowWinnerPicker(false) }}>
          <div className="launcher-build-panel" style={{ maxWidth: 600 }}>
            <div className="detail-header">
              <span className="font-heading">Pick a Winner Image</span>
              <button className="detail-close" onClick={() => setShowWinnerPicker(false)}>&times;</button>
            </div>
            {winners.length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <p>No winners yet. Mark images as winners in the Review tab, or promote from the Prompt Tester.</p>
              </div>
            ) : (
              <div className="launcher-grid" style={{ padding: 'var(--space-lg)' }}>
                {winners.map(img => (
                  <div
                    key={img.id}
                    className="launcher-card"
                    onClick={() => {
                      const mealName = img.variables_used?.MEAL_NAME || img.variables_used?.SOURCE || 'Static'
                      addRow(img.image_url, 'S-' + String(mealName).slice(0, 20))
                      setShowWinnerPicker(false)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="launcher-card-image">
                      <img src={img.image_url} alt="" loading="lazy" />
                      <span className="launcher-card-ratio">{img.aspect_ratio}</span>
                    </div>
                    <div className="launcher-card-body">
                      <span className="launcher-card-name">{img.variables_used?.MEAL_NAME || 'Image'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Push confirmation modal */}
      {showPushModal && (
        <div className="launcher-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPushModal(false) }}>
          <div className="launcher-build-panel" style={{ maxWidth: 520 }}>
            <div className="detail-header">
              <span className="font-heading">Launch Validation</span>
              <button className="detail-close" onClick={() => setShowPushModal(false)}>&times;</button>
            </div>
            <div style={{ padding: 'var(--space-lg)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-lg)' }}>
                {readyLaunches.map(l => {
                  const { valid, errors } = validateRow(l)
                  return (
                    <div key={l.id} className="launch-validate-row">
                      {valid
                        ? <span style={{ color: 'var(--electric-green)', fontWeight: 700 }}>&#10003;</span>
                        : <span style={{ color: 'var(--error)', fontWeight: 700 }}>&#10005;</span>
                      }
                      <span className="launch-validate-name">{l.ad_name || 'Unnamed'}</span>
                      {!valid && <span className="launch-validate-error">{errors[0]}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="launch-validate-summary">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ready to launch</span>
                  <span style={{ color: 'var(--electric-green)', fontWeight: 600 }}>{readyLaunches.length} ads</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Est. daily spend</span>
                  <span style={{ fontWeight: 600 }}>{'\u00A3'}{readyLaunches.reduce((s, l) => s + Number(l.daily_budget || 0), 0).toFixed(2)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPushModal(false)}>Cancel</button>
                <button
                  className="btn"
                  style={{ flex: 1, background: 'var(--electric-green)', color: 'var(--bg-0)', fontWeight: 600 }}
                  onClick={() => handlePush(readyLaunches.map(l => l.id))}
                  disabled={pushing}
                >
                  {pushing ? 'Pushing...' : `Launch ${readyLaunches.length} Ads`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Individual Launch Row ───────────────────────────── */
function LaunchRow({
  launch, accounts, campaignCache, adsetCache, activeAccountId,
  selected, onToggleSelect, onCellEdit, onAccountChange,
  onCampaignSelect, onAdSetSelect, onDelete, onDuplicate, onPush,
  loadCampaigns, loadAdsets, pushing,
}) {
  const [rowCampaigns, setRowCampaigns] = useState([])
  const [rowAdsets, setRowAdsets] = useState([])
  const { valid, errors } = validateRow(launch)
  const statusStyle = STATUS_COLORS[launch.status] || STATUS_COLORS.draft

  // Load campaigns when row's account is set
  useEffect(() => {
    const acctId = launch.ad_account_id || activeAccountId
    if (acctId && campaignCache[acctId]) {
      setRowCampaigns(campaignCache[acctId])
    } else if (acctId) {
      loadCampaigns(acctId).then(list => setRowCampaigns(list))
    }
  }, [launch.ad_account_id, activeAccountId, campaignCache])

  // Load adsets when campaign is set
  useEffect(() => {
    const acctId = launch.ad_account_id || activeAccountId
    const campId = launch.platform_campaign_id
    if (acctId && campId) {
      const key = acctId + '__' + campId
      if (adsetCache[key]) {
        setRowAdsets(adsetCache[key])
      } else {
        loadAdsets(acctId, campId).then(list => setRowAdsets(list))
      }
    } else {
      setRowAdsets([])
    }
  }, [launch.ad_account_id, launch.platform_campaign_id, activeAccountId, adsetCache])

  return (
    <tr className={`launch-row ${selected ? 'selected' : ''} ${!valid && launch.status === 'draft' ? 'has-errors' : ''}`}>
      {/* Checkbox */}
      <td className="launch-td launch-td-check">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>

      {/* Status */}
      <td className="launch-td" style={{ verticalAlign: 'middle' }}>
        <span
          className={`launch-status-badge status-${launch.status}`}
          style={{ background: statusStyle.bg, color: statusStyle.color }}
          title={errors.length ? errors.join(' \u00B7 ') : launch.status}
        >
          <span className="status-dot" />
          {launch.status}
        </span>
      </td>

      {/* Image */}
      <td className="launch-td" style={{ verticalAlign: 'middle' }}>
        {launch.image_url ? (
          <div className="launch-img-cell">
            <img src={launch.image_url} alt="" loading="lazy" />
          </div>
        ) : (
          <div className="launch-img-cell launch-img-empty">no img</div>
        )}
      </td>

      {/* Account */}
      <td className="launch-td">
        <select
          className="launch-cell-select"
          value={launch.ad_account_id || ''}
          onChange={e => onAccountChange(launch.id, e.target.value)}
        >
          <option value="">Select account...</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
      </td>

      {/* Ad Name */}
      <td className="launch-td">
        <EditableCell value={launch.ad_name} onChange={v => onCellEdit(launch.id, 'ad_name', v)} placeholder="Ad name..." />
      </td>

      {/* Headline */}
      <td className="launch-td">
        <EditableCell value={launch.headline} onChange={v => onCellEdit(launch.id, 'headline', v)} placeholder="Headline..." maxLength={40} multiline showCharCount />
      </td>

      {/* Primary Text */}
      <td className="launch-td">
        <EditableCell value={launch.primary_text} onChange={v => onCellEdit(launch.id, 'primary_text', v)} placeholder="Primary text..." maxLength={125} multiline showCharCount />
      </td>

      {/* CTA */}
      <td className="launch-td">
        <select
          className="launch-cell-select"
          value={launch.cta_type || 'SHOP_NOW'}
          onChange={e => onCellEdit(launch.id, 'cta_type', e.target.value)}
        >
          {CTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* URL */}
      <td className="launch-td">
        <EditableCell value={launch.destination_url} onChange={v => onCellEdit(launch.id, 'destination_url', v)} placeholder="https://..." />
      </td>

      {/* Campaign */}
      <td className="launch-td">
        <select
          className="launch-cell-select"
          value={launch.platform_campaign_id || ''}
          onChange={e => onCampaignSelect(launch.id, e.target.value, rowCampaigns)}
          disabled={!launch.ad_account_id && !activeAccountId}
        >
          <option value="">{rowCampaigns.length ? 'Select campaign...' : 'No campaigns'}</option>
          {rowCampaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.status.toLowerCase()})</option>
          ))}
        </select>
      </td>

      {/* Ad Set */}
      <td className="launch-td">
        <select
          className="launch-cell-select"
          value={launch.platform_adset_id || ''}
          onChange={e => onAdSetSelect(launch.id, e.target.value, rowAdsets)}
          disabled={!launch.platform_campaign_id}
        >
          <option value="">{launch.platform_campaign_id ? (rowAdsets.length ? 'Select ad set...' : 'No ad sets') : 'Pick campaign first'}</option>
          {rowAdsets.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.status.toLowerCase()})</option>
          ))}
        </select>
      </td>

      {/* Budget */}
      <td className="launch-td" style={{ verticalAlign: 'middle' }}>
        <div className="launch-budget-display">
          <EditableCell
            value={launch.daily_budget ? `\u00A3${Number(launch.daily_budget).toFixed(0)}` : '\u00A30'}
            onChange={v => onCellEdit(launch.id, 'daily_budget', v.replace(/[^0-9.]/g, ''))}
            placeholder="\u00A30/day"
          />
        </div>
      </td>

      {/* Actions */}
      <td className="launch-td launch-td-actions">
        {launch.status === 'ready' && (
          <button
            className="launch-action-btn push-btn"
            onClick={() => onPush([launch.id])}
            disabled={pushing}
            title="Push to Meta"
          >
            push
          </button>
        )}
        <button
          className="launch-action-btn"
          onClick={() => onDuplicate(launch)}
          title="Duplicate row"
        >
          dup
        </button>
        {(launch.status === 'draft' || launch.status === 'error') && (
          <button
            className="launch-action-btn launch-action-delete"
            onClick={() => onDelete(launch.id)}
            title="Delete row"
          >
            del
          </button>
        )}
      </td>
    </tr>
  )
}
