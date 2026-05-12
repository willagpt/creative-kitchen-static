import { useState, useEffect, useRef } from 'react'
import './CompetitorAds.css'
import { supabaseUrl } from '../lib/supabase'
import {
  FOREPLAY_FN_URL, ANALYSE_FN_URL, BATCH_FN_URL,
  sbHeaders, sbReadHeaders, fnHeaders, GRID_PAGE, BRAND_COLORS
} from './competitor/config'
import {
  formatDate, formatNumber, fmtImpressions, isVideoUrl,
  mapDbAd, extractPageId, mostCommonPageName
} from './competitor/utils'
import {
  resolvePageName, fetchAllAds, fetchFollowedBrands,
  saveBrand, updateBrand, deleteBrand
} from './competitor/api'
import InlineVideoCard from './competitor/InlineVideoCard'
import PaidCadence from './PaidCadence'


// ── Component ──
export default function CompetitorAds({ onNavigate, onAdLibraryRefresh }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('metaAdLibraryToken') || '')
  const [allAds, setAllAds] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followedBrands, setFollowedBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [addStatus, setAddStatus] = useState('')
  const [addLink, setAddLink] = useState(null) // { href, label } when a Meta Ad Library link should be shown
  const [showAddForm, setShowAddForm] = useState(false)
  const [modalAd, setModalAd] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [showCount, setShowCount] = useState(GRID_PAGE)

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ── Top Performers state ──
  const [viewMode, setViewMode] = useState('library')
  const [selectedTopBrands, setSelectedTopBrands] = useState(new Set())
  const [topAds, setTopAds] = useState([])
  const [topLoading, setTopLoading] = useState(false)
  const [topError, setTopError] = useState(null)
  const [topPercentile, setTopPercentile] = useState(2.5)
  const [topTypeFilter, setTopTypeFilter] = useState('all')
  const [topSortBy, setTopSortBy] = useState('days')
  const [topShowCount, setTopShowCount] = useState(GRID_PAGE)
  const [topLoadingStatus, setTopLoadingStatus] = useState('')

  // The JSX file is too large to inline in one go. Continuing in part 2.
