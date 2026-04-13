import { supabaseUrl, supabaseAnonKey } from '../../lib/supabase'

export const FOREPLAY_FN_URL = `${supabaseUrl}/functions/v1/fetch-competitor-ads`
export const ANALYSE_FN_URL = `${supabaseUrl}/functions/v1/analyse-competitor-creatives`
export const BATCH_FN_URL = `${supabaseUrl}/functions/v1/process-analysis-batch`

export const sbHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
}

export const sbReadHeaders = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
}

export const GRID_PAGE = 50

export const BRAND_COLORS = [
  { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', border: '#6366f1' },
  { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: '#ec4899' },
  { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', border: '#22c55e' },
  { bg: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24', border: '#f59e0b' },
  { bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8', border: '#0ea5e9' },
  { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: '#a855f7' },
  { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: '#f43f5e' },
  { bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf', border: '#14b8a6' },
]
