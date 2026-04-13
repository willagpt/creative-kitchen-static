import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FOREPLAY_API_KEY = "w92zyktDrXMVDtRrbMm0TQUamBmOxEIMTTToEvRvf5aD0nzgBkj9r4PPh-MX-bx9UBGGJ6v1SdSKf9SNo2S3WA";
const FOREPLAY_BASE = "https://public.api.foreplay.co";
const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// SAFEGUARDS
const DEFAULT_CREDIT_BUDGET = 500;
const DEFAULT_START_DATE = "2025-12-23";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface ForeplayCard {
  cta_text?: string;
  description?: string;
  headline?: string;
  image?: string | null;
  video?: string | null;
  title?: string;
  type?: string;
  full_transcription?: string;
  video_duration?: number;
}

interface ForeplayAd {
  id?: string;
  ad_id?: string;
  name?: string;
  brand_id?: string;
  description?: string | null;
  headline?: string;
  cta_title?: string;
  cta_type?: string;
  display_format?: string;
  type?: string;
  avatar?: string;
  link_url?: string;
  live?: boolean;
  publisher_platform?: string[];
  started_running?: number;
  thumbnail?: string | null;
  image?: string | null;
  video?: string | null;
  cards?: ForeplayCard[];
  running_duration?: { days?: number };
  video_duration?: number | null;
  emotional_drivers?: Record<string, number>;
  content_filter?: Record<string, number>;
  creative_targeting?: string;
  categories?: string[];
  persona?: Record<string, unknown>;
  languages?: string[];
  market_target?: string;
  niches?: string[];
  [key: string]: unknown;
}

function isEnglishAd(ad: ForeplayAd): boolean {
  const languages = ad.languages;

  // Keep ads where languages is null/undefined/empty (assume English)
  if (!languages || languages.length === 0) {
    return true;
  }

  // Keep ads where languages includes "English"
  if (languages.includes("English")) {
    return true;
  }

  // Filter out all other language-only ads
  return false;
}

async function fetchFromForeplay(
  identifier: { page_id?: string; brand_id?: string },
  limit = 250,
  cursor?: string,
  startDate?: string,
): Promise<{ ads: ForeplayAd[]; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.append("cursor", cursor);
  if (startDate) params.append("start_date", startDate);

  let endpoint: string;
  if (identifier.brand_id) {
    params.append("brand_id", identifier.brand_id);
    endpoint = `/api/spyder/brand/ads`;
  } else if (identifier.page_id) {
    params.append("page_id", identifier.page_id);
    endpoint = `/api/brand/getAdsByPageId`;
  } else {
    throw new Error("Either page_id or brand_id is required");
  }

  const url = `${FOREPLAY_BASE}${endpoint}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${FOREPLAY_API_KEY}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Foreplay API ${res.status}: ${errText}`);
  }

  const json = await res.json();
  let ads: ForeplayAd[] = [];
  let nextCursor: string | undefined;

  if (json.data) {
    if (Array.isArray(json.data)) {
      ads = json.data;
    } else if (Array.isArray(json.data.ads)) {
      ads = json.data.ads;
    }
  } else if (Array.isArray(json.ads)) {
    ads = json.ads;
  } else if (Array.isArray(json)) {
    ads = json;
  }

  nextCursor = json.metadata?.cursor || json.data?.cursor || json.data?.nextCursor || json.cursor;

  return { ads, nextCursor };
}

function mapAdToRows(ad: ForeplayAd, pageId: string): Array<Record<string, unknown>> {
  const adId = ad.ad_id || ad.id || String(Math.random()).slice(2);
  const displayFormat = (ad.display_format || ad.type || "unknown").toUpperCase();

  let daysActive = 0;
  if (ad.running_duration?.days) {
    daysActive = ad.running_duration.days;
  } else if (ad.started_running) {
    const start = new Date(ad.started_running);
    daysActive = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
  }

  const base: Record<string, unknown> = {
    page_id: pageId,
    page_name: ad.name || "Unknown",
    brand_id: ad.brand_id || null,
    display_format: displayFormat,
    start_date: ad.started_running ? new Date(ad.started_running).toISOString() : null,
    end_date: ad.live === false ? new Date().toISOString() : null,
    days_active: daysActive,
    is_active: ad.live ?? true,
    platforms: ad.publisher_platform || [],
    impressions_lower: null,
    impressions_upper: null,
    snapshot_url: null,
    link_url: ad.link_url || null,
    cta_type: ad.cta_type || ad.cta_title || null,
    emotional_drivers: ad.emotional_drivers || null,
    content_filter: ad.content_filter || null,
    creative_targeting: ad.creative_targeting || null,
    categories: ad.categories || null,
    persona: ad.persona || null,
    languages: ad.languages || null,
    market_target: ad.market_target || null,
    niches: ad.niches || null,
  };

  const cards = ad.cards || [];
  const isDcoOrCarousel = displayFormat === "DCO" || displayFormat === "CAROUSEL";

  if (isDcoOrCarousel && cards.length > 0) {
    return cards.map((card, idx) => {
      const thumbnailUrl = card.image || ad.thumbnail || ad.image || null;
      const videoUrl = card.video || null;
      return {
        ...base,
        id: `${adId}_card${idx}`,
        card_index: idx,
        thumbnail_url: thumbnailUrl || videoUrl,
        video_url: videoUrl,
        creative_title: card.headline || ad.headline || "",
        creative_body: card.description || ad.description || "",
        creative_caption: card.cta_text || ad.cta_title || "",
        creative_description: "",
      };
    });
  }

  const thumbnailUrl = ad.thumbnail || ad.image || null;
  const videoUrl = ad.video || (cards[0]?.video) || null;

  return [{
    ...base,
    id: String(adId),
    card_index: null,
    thumbnail_url: thumbnailUrl || videoUrl,
    video_url: videoUrl,
    creative_title: ad.headline || cards[0]?.headline || "",
    creative_body: ad.description || cards[0]?.description || "",
    creative_caption: ad.cta_title || cards[0]?.cta_text || "",
    creative_description: "",
  }];
}

async function upsertToSupabase(rows: Array<Record<string, unknown>>, pageId: string) {
  let errors = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/competitor_ads`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      errors++;
      console.error(`Supabase upsert batch ${Math.floor(i/200)+1} error: ${res.status} ${await res.text()}`);
    }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${pageId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      last_fetched_at: new Date().toISOString(),
      total_ads: rows.length,
      ad_count: rows.length,
    }),
  });

  return errors;
}

async function logCredits(pageId: string, brandId: string, adsFetched: number, creditsUsed: number, creditBudget: number, rowsUpserted: number) {
  await fetch(`${SUPABASE_URL}/rest/v1/foreplay_credit_log`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_id: pageId || null,
      brand_id: brandId || null,
      ads_fetched: adsFetched,
      credits_used: creditsUsed,
      credit_budget: creditBudget,
      rows_upserted: rowsUpserted,
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let page_id = "";
    let brand_id = "";
    let mode = "fetch";
    let creditBudget = DEFAULT_CREDIT_BUDGET;
    let startDate = DEFAULT_START_DATE;

    if (req.method === "GET") {
      const url = new URL(req.url);
      page_id = url.searchParams.get("page_id") || "";
      brand_id = url.searchParams.get("brand_id") || "";
      mode = url.searchParams.get("mode") || "test";
      creditBudget = parseInt(url.searchParams.get("credit_budget") || String(DEFAULT_CREDIT_BUDGET));
      startDate = url.searchParams.get("start_date") || DEFAULT_START_DATE;
    } else {
      const body = await req.json();
      page_id = body.page_id || "";
      brand_id = body.brand_id || "";
      mode = body.mode || "fetch";
      creditBudget = body.credit_budget || DEFAULT_CREDIT_BUDGET;
      startDate = body.start_date || DEFAULT_START_DATE;
    }

    if (!page_id && !brand_id) {
      return new Response(JSON.stringify({ error: "page_id or brand_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const identifier = brand_id ? { brand_id } : { page_id };

    // Test mode: return raw sample (uses 5 credits max)
    if (mode === "test") {
      const { ads } = await fetchFromForeplay(identifier, 5, undefined, startDate);
      const englishAds = ads.filter(isEnglishAd);
      const filteredNonEnglish = ads.length - englishAds.length;
      const rows = englishAds.flatMap(ad => mapAdToRows(ad, page_id || "test"));
      await logCredits(page_id, brand_id, ads.length, ads.length, creditBudget, 0);
      return new Response(JSON.stringify({
        success: true,
        creditsUsed: ads.length,
        creditBudget,
        startDate,
        rawAdsCount: ads.length,
        filtered_non_english: filteredNonEnglish,
        englishAdsCount: englishAds.length,
        rowsGenerated: rows.length,
        sample: rows.slice(0, 6),
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch mode: paginate with CREDIT BUDGET enforcement
    let allAds: ForeplayAd[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let creditsUsed = 0;
    let stoppedReason = "complete";

    do {
      const remaining = creditBudget - creditsUsed;
      if (remaining <= 0) {
        stoppedReason = `credit_budget_reached (${creditBudget})`;
        break;
      }
      const batchLimit = Math.min(250, remaining);

      const result = await fetchFromForeplay(identifier, batchLimit, cursor, startDate);
      allAds = [...allAds, ...result.ads];
      creditsUsed += result.ads.length;
      cursor = result.nextCursor;
      pages++;

      console.log(`Page ${pages}: fetched ${result.ads.length} ads (total: ${allAds.length}, credits: ${creditsUsed}/${creditBudget})`);
    } while (cursor && creditsUsed < creditBudget);

    if (!cursor && stoppedReason === "complete") {
      stoppedReason = "all_ads_fetched";
    }

    // Filter to English ads only
    const englishAds = allAds.filter(isEnglishAd);
    const filteredNonEnglish = allAds.length - englishAds.length;

    if (filteredNonEnglish > 0) {
      console.log(`Language filter: removed ${filteredNonEnglish} non-English ads (kept ${englishAds.length}/${allAds.length})`);
    }

    const rows = englishAds.flatMap(ad => mapAdToRows(ad, page_id));

    const formatCounts: Record<string, number> = {};
    for (const r of rows) {
      const f = (r.display_format as string) || "UNKNOWN";
      formatCounts[f] = (formatCounts[f] || 0) + 1;
    }

    let upsertErrors = 0;
    if (rows.length > 0) {
      upsertErrors = await upsertToSupabase(rows, page_id);
    }

    await logCredits(page_id, brand_id, allAds.length, creditsUsed, creditBudget, rows.length);

    const withMedia = rows.filter(r => r.thumbnail_url);

    return new Response(JSON.stringify({
      success: true,
      source: "foreplay",
      creditsUsed,
      creditBudget,
      startDate,
      stoppedReason,
      apiPages: pages,
      rawAds: allAds.length,
      filtered_non_english: filteredNonEnglish,
      englishAds: englishAds.length,
      totalRows: rows.length,
      withMedia: withMedia.length,
      formatBreakdown: formatCounts,
      upsertErrors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});