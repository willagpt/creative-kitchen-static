export function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

export function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

export function fmtImpressions(lower, upper) {
  if (!lower && !upper) return null
  if (lower && upper) return formatNumber(lower) + ' to ' + formatNumber(upper)
  return formatNumber(upper || lower)
}

export function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm')
}

export function mapDbAd(ad, pageId, pageName) {
  const mediaUrl = ad.thumbnail_url || null
  const videoUrl = ad.video_url || null
  const displayFormat = (ad.display_format || '').toUpperCase()

  let isVideo = false
  let creativeType = 'unknown'
  if (displayFormat === 'VIDEO') {
    isVideo = true
    creativeType = 'video'
  } else if (displayFormat === 'IMAGE') {
    isVideo = false
    creativeType = 'image'
  } else if (displayFormat === 'DCO') {
    isVideo = isVideoUrl(mediaUrl) || !!videoUrl
    creativeType = isVideo ? 'video' : 'image'
  } else {
    isVideo = isVideoUrl(mediaUrl)
    creativeType = !mediaUrl ? 'unknown' : isVideo ? 'video' : 'image'
  }

  const hasMedia = !!mediaUrl
  const impMid = ((ad.impressions_lower || 0) + (ad.impressions_upper || 0)) / 2
  const daysActive = ad.days_active || 0
  const velocity = daysActive > 0 ? impMid / daysActive : 0

  return {
    adId: ad.id,
    adName: ad.creative_title || 'Untitled Ad',
    adBody: ad.creative_body || '',
    adCaption: ad.creative_caption || '',
    adDescription: ad.creative_description || '',
    pageId: ad.page_id || pageId,
    pageName: ad.page_name || pageName,
    displayFormat,
    creativeType,
    mediaUrl,
    videoUrl: videoUrl || (isVideo ? mediaUrl : null),
    isVideo,
    hasMedia,
    impressionsText: fmtImpressions(ad.impressions_lower, ad.impressions_upper),
    impressionsLower: ad.impressions_lower || 0,
    impressionsUpper: ad.impressions_upper || 0,
    impressionsMid: impMid,
    velocity,
    startDate: formatDate(ad.start_date),
    endDate: formatDate(ad.end_date),
    rawStartDate: ad.start_date || null,
    rawEndDate: ad.end_date || null,
    daysActive,
    status: ad.is_active ? 'active' : 'ended',
    platforms: ad.platforms || [],
    creativeTargeting: ad.creative_targeting || null,
    emotionalDrivers: ad.emotional_drivers || null,
    ctaType: ad.cta_type || null,
    cardIndex: ad.card_index,
    url: `https://www.facebook.com/ads/library/?ad_type=all&view_all_page_id=${ad.page_id || pageId}`,
  }
}

export function extractPageId(input) {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const m = trimmed.match(/view_all_page_id=(\d+)/) || trimmed.match(/[?&]id=(\d+)/) || trimmed.match(/facebook\.com\/pages\/[^/]+\/(\d+)/) || trimmed.match(/profile\.php\?id=(\d+)/)
  return m ? m[1] : null
}

export function mostCommonPageName(rows) {
  const counts = {}
  for (const row of rows) {
    const name = (row.page_name || '').trim()
    if (!name || /^\d+$/.test(name)) continue
    counts[name] = (counts[name] || 0) + 1
  }
  let best = null, bestCount = 0
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) { best = name; bestCount = count }
  }
  return best
}
