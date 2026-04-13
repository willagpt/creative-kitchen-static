import { FOREPLAY_FN_URL, sbHeaders, sbReadHeaders } from './config'
import { mostCommonPageName } from './utils'

export async function resolvePageName(pageId, supabaseUrlParam, metaToken) {
  try {
    const res = await fetch(
      `${supabaseUrlParam}/rest/v1/competitor_ads?page_id=eq.${pageId}&page_name=not.is.null&select=page_name&limit=200`,
      { headers: sbReadHeaders }
    )
    if (res.ok) {
      const rows = await res.json()
      const name = mostCommonPageName(rows)
      if (name) return name
    }
  } catch {}

  if (metaToken) {
    try {
      const r = await fetch(`https://graph.facebook.com/${pageId}?access_token=${metaToken}&fields=name`)
      if (r.ok) { const d = await r.json(); if (d.name) return d.name }
    } catch {}
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${pageId}?fields=name`)
    if (r.ok) { const d = await r.json(); if (d.name) return d.name }
  } catch {}

  return null
}

export async function fetchAllAds(pageId, supabaseUrl) {
  const PAGE_SIZE = 1000
  let allRows = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/competitor_ads?page_id=eq.${pageId}&order=start_date.desc&offset=${offset}&limit=${PAGE_SIZE}`,
      { headers: sbReadHeaders }
    )
    if (!res.ok) throw new Error(`Failed to load (${res.status})`)
    const rows = await res.json()
    allRows = allRows.concat(rows)
    hasMore = rows.length === PAGE_SIZE
    offset += PAGE_SIZE
  }
  return allRows
}

export async function fetchFollowedBrands(supabaseUrl) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/followed_brands?order=created_at.desc`, { headers: sbReadHeaders })
    if (!res.ok) return []
    const data = await res.json()
    return data.map(row => ({
      pageId: row.page_id, pageName: row.page_name, platforms: row.platforms || [],
      byline: row.byline || '', adCount: row.total_ads || 0, country: row.country || 'GB',
      lastFetchedAt: row.last_fetched_at || null, thumbnailUrl: row.thumbnail_url || null,
    }))
  } catch { return [] }
}

export async function saveBrand(brand, supabaseUrl) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/followed_brands`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({ page_id: brand.pageId, page_name: brand.pageName, platforms: brand.platforms || ['meta'], byline: '', country: 'GB' }),
    })
    return res.ok
  } catch { return false }
}

export async function updateBrand(pageId, updates, supabaseUrl) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/followed_brands?page_id=eq.${pageId}`, {
      method: 'PATCH', headers: sbHeaders,
      body: JSON.stringify(updates),
    })
    return res.ok
  } catch { return false }
}

export async function deleteBrand(pageId, supabaseUrl) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/followed_brands?page_id=eq.${pageId}`, { method: 'DELETE', headers: sbHeaders })
    return res.ok
  } catch { return false }
}
