import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FOREPLAY_API_KEY = "w92zyktDrXMVDtRrbMm0TQUamBmOxEIMTTToEvRvf5aD0nzgBkj9r4PPh-MX-bx9UBGGJ6v1SdSKf9SNo2S3WA";
const FOREPLAY_BASE = "https://public.api.foreplay.co";
const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Meta Ad Library auto-auth.
// Preference order (only consulted when META_AD_LIBRARY_ENABLED is true):
//   1. META_SYSTEM_USER_TOKEN — Business Manager System User token. Never
//      expires when configured with "Never" expiration. Inherits user-context
//      permissions (ads_read).
//   2. META_APP_ID|META_APP_SECRET — app access token. Never expires but only
//      works for political/electoral/issue ads in transparency-required
//      countries.
//   3. body-supplied user token — legacy per-request path.
//
// META_AD_LIBRARY_ENABLED is the master gate. Default OFF because the Ad
// Library /ads_archive endpoint requires Meta app review approval ("Ads
// Archive API" use case). Without that approval, every token type returns
// HTTP 400 with error_subcode 2332002 / 2332004 ("Application does not
// have permission for this action"). Flip this to "true" once the Meta
// app has been approved. Until then we surface a direct Meta Ad Library
// link to the user instead of attempting the API call.
const META_AD_LIBRARY_ENABLED = (Deno.env.get("META_AD_LIBRARY_ENABLED") || "false").toLowerCase() === "true";
const META_SYSTEM_USER_TOKEN = Deno.env.get("META_SYSTEM_USER_TOKEN") || "";
const META_APP_ID = Deno.env.get("META_APP_ID") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";

// SAFEGUARDS
const DEFAULT_CREDIT_BUDGET = 500;
const DEFAULT_START_DATE = "2025-12-23";

function metaAdLibraryUrl(pageId: string): string {
  return (
    "https://www.facebook.com/ads/library/" +
    `?active_status=all&ad_type=all&country=GB&view_all_page_id=${pageId}`
  );
}

type MetaAuthSource = "system_user_token" | "app_token" | "user_token" | "none";

function resolveMetaToken(bodyToken: string): { token: string; source: MetaAuthSource } {
  if (META_SYSTEM_USER_TOKEN) {
    return { token: META_SYSTEM_USER_TOKEN, source: "system_user_token" };
  }
  if (META_APP_ID && META_APP_SECRET) {
    // App access token format: "{APP_ID}|{APP_SECRET}".
    return { token: `${META_APP_ID}|${META_APP_SECRET}`, source: "app_token" };
  }
  if (bodyToken) {
    return { token: bodyToken, source: "user_token" };
  }
  return { token: "", source: "none" };
}

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

async function logCredits(
  pageId: string,
  brandId: string,
  adsFetched: number,
  creditsUsed: number,
  creditBudget: number,
  startDate: string,
  stoppedReason: string,
) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/foreplay_credit_log`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        page_id: pageId || null,
        brand_id: brandId || null,
        ads_fetched: adsFetched,
        credits_used: creditsUsed,
        credit_budget: creditBudget,
        start_date: startDate || null,
        stopped_reason: stoppedReason || null,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`foreplay_credit_log insert failed: ${res.status} ${errText}`);
    }
  } catch (err) {
    console.error(`foreplay_credit_log insert threw: ${String(err)}`);
  }
}

// =====================================================================
// Meta Ad Library fallback (used when Foreplay has zero coverage for a page)
// =====================================================================

interface MetaAd {
  id?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  page_id?: string;
  page_name?: string;
  publisher_platforms?: string[];
  impressions?: { lower_bound?: string; upper_bound?: string };
  languages?: string[];
  target_locations?: Array<Record<string, unknown>>;
}

async function fetchFromMeta(
  pageId: string,
  metaToken: string,
  startDate: string,
): Promise<{ ads: MetaAd[]; pages: number; stoppedReason: string }> {
  const fields = [
    "id",
    "ad_creation_time",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "ad_creative_bodies",
    "ad_creative_link_titles",
    "ad_creative_link_descriptions",
    "ad_creative_link_captions",
    "ad_snapshot_url",
    "page_id",
    "page_name",
    "publisher_platforms",
    "impressions",
    "languages",
    "target_locations",
  ].join(",");

  const baseUrl = "https://graph.facebook.com/v19.0/ads_archive";
  const params = new URLSearchParams({
    access_token: metaToken,
    search_page_ids: `[${pageId}]`,
    ad_active_status: "ALL",
    ad_type: "ALL",
    ad_reached_countries: "['GB']",
    fields,
    limit: "100",
  });

  let url: string | undefined = `${baseUrl}?${params}`;
  const all: MetaAd[] = [];
  let pages = 0;
  const cutoffMs = startDate ? Date.parse(startDate) : 0;
  let stoppedReason = "complete";

  // Hard cap to avoid runaway loops, ~10 pages = ~1000 ads
  const MAX_PAGES = 12;

  while (url && pages < MAX_PAGES) {
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meta Ad Library ${res.status}: ${errText.slice(0, 400)}`);
    }
    const json = await res.json();
    const batch: MetaAd[] = Array.isArray(json.data) ? json.data : [];
    pages++;

    let hitCutoff = false;
    for (const ad of batch) {
      if (cutoffMs && ad.ad_delivery_start_time) {
        const ts = Date.parse(ad.ad_delivery_start_time);
        if (!isNaN(ts) && ts < cutoffMs) {
          hitCutoff = true;
          continue; // skip pre-cutoff ad but keep scanning the rest of this page
        }
      }
      all.push(ad);
    }

    if (hitCutoff) {
      stoppedReason = "reached_start_date";
      break;
    }

    url = json.paging?.next;
  }

  if (pages >= MAX_PAGES && url) stoppedReason = "max_pages_reached";

  return { ads: all, pages, stoppedReason };
}

function mapMetaAdToRows(ad: MetaAd, pageId: string): Array<Record<string, unknown>> {
  const adId = ad.id || String(Math.random()).slice(2);
  const startIso = ad.ad_delivery_start_time
    ? new Date(ad.ad_delivery_start_time).toISOString()
    : null;
  const endIso = ad.ad_delivery_stop_time
    ? new Date(ad.ad_delivery_stop_time).toISOString()
    : null;
  const isActive = !ad.ad_delivery_stop_time;
  const daysActive = startIso
    ? Math.max(
        0,
        Math.floor(
          ((endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso)) /
            86400000,
        ),
      )
    : 0;

  const platforms = (ad.publisher_platforms || []).map((p) => String(p).toLowerCase());
  const impressionsLower = ad.impressions?.lower_bound
    ? Number(ad.impressions.lower_bound)
    : null;
  const impressionsUpper = ad.impressions?.upper_bound
    ? Number(ad.impressions.upper_bound)
    : null;

  return [
    {
      id: String(adId),
      page_id: pageId,
      page_name: ad.page_name || "Unknown",
      brand_id: null,
      display_format: "IMAGE", // Meta Ad Library does not expose creative type reliably
      start_date: startIso,
      end_date: endIso,
      days_active: daysActive,
      is_active: isActive,
      platforms,
      impressions_lower: impressionsLower,
      impressions_upper: impressionsUpper,
      snapshot_url: ad.ad_snapshot_url || null,
      thumbnail_url: null, // snapshot iframe is the only preview Meta gives
      video_url: null,
      card_index: null,
      creative_title: (ad.ad_creative_link_titles || [])[0] || "",
      creative_body: (ad.ad_creative_bodies || [])[0] || "",
      creative_caption: (ad.ad_creative_link_captions || [])[0] || "",
      creative_description: (ad.ad_creative_link_descriptions || [])[0] || "",
      link_url: null,
      cta_type: null,
      emotional_drivers: null,
      content_filter: null,
      creative_targeting: null,
      categories: null,
      persona: null,
      languages: ad.languages || null,
      market_target: null,
      niches: null,
    },
  ];
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
    let metaToken = "";

    if (req.method === "GET") {
      const url = new URL(req.url);
      page_id = url.searchParams.get("page_id") || "";
      brand_id = url.searchParams.get("brand_id") || "";
      mode = url.searchParams.get("mode") || "test";
      creditBudget = parseInt(url.searchParams.get("credit_budget") || String(DEFAULT_CREDIT_BUDGET));
      startDate = url.searchParams.get("start_date") || DEFAULT_START_DATE;
      metaToken = url.searchParams.get("meta_token") || "";
    } else {
      const body = await req.json();
      page_id = body.page_id || "";
      brand_id = body.brand_id || "";
      mode = body.mode || "fetch";
      creditBudget = body.credit_budget || DEFAULT_CREDIT_BUDGET;
      startDate = body.start_date || DEFAULT_START_DATE;
      metaToken = body.meta_token || "";
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
      await logCredits(page_id, brand_id, ads.length, ads.length, creditBudget, startDate, "test_mode");
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

    await logCredits(page_id, brand_id, allAds.length, creditsUsed, creditBudget, startDate, stoppedReason);

    // -----------------------------------------------------------------
    // Meta Ad Library fallback
    // Master gate: META_AD_LIBRARY_ENABLED. Default OFF because the
    // /ads_archive endpoint requires Meta app review approval. Until the
    // app is approved, we surface a direct Meta Ad Library link instead
    // of attempting a doomed API call.
    //
    // When enabled, token resolution prefers the System User token
    // (never expires, full ad library access), falls back to the app
    // access token (political ads only), then to the per-request body
    // token. Lets us cover brands Foreplay's Spyder index does not
    // track without ever asking the user to paste a token.
    // -----------------------------------------------------------------
    let metaFallback: Record<string, unknown> | null = null;
    const resolvedMeta = resolveMetaToken(metaToken);
    if (rows.length === 0 && page_id && META_AD_LIBRARY_ENABLED && resolvedMeta.token) {
      try {
        console.log(
          `Foreplay returned 0 ads for page_id ${page_id}. Falling back to Meta Ad Library (auth: ${resolvedMeta.source}).`,
        );
        const metaResult = await fetchFromMeta(page_id, resolvedMeta.token, startDate);
        const metaRows = metaResult.ads.flatMap((ad) => mapMetaAdToRows(ad, page_id));
        let metaUpsertErrors = 0;
        if (metaRows.length > 0) {
          metaUpsertErrors = await upsertToSupabase(metaRows, page_id);
        } else {
          // Still update last_fetched_at so the UI does not look stuck
          await fetch(`${SUPABASE_URL}/rest/v1/followed_brands?page_id=eq.${page_id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              last_fetched_at: new Date().toISOString(),
              total_ads: 0,
              ad_count: 0,
            }),
          });
        }
        metaFallback = {
          attempted: true,
          authSource: resolvedMeta.source,
          pages: metaResult.pages,
          stoppedReason: metaResult.stoppedReason,
          rawAds: metaResult.ads.length,
          totalRows: metaRows.length,
          upsertErrors: metaUpsertErrors,
          metaAdLibraryUrl: metaAdLibraryUrl(page_id),
        };
        console.log(`Meta fallback: ${metaRows.length} rows upserted (${metaUpsertErrors} errors)`);
      } catch (metaErr) {
        metaFallback = {
          attempted: true,
          authSource: resolvedMeta.source,
          error: String(metaErr),
          metaAdLibraryUrl: metaAdLibraryUrl(page_id),
        };
        console.error(`Meta fallback failed: ${String(metaErr)}`);
      }
    } else if (rows.length === 0 && page_id && !META_AD_LIBRARY_ENABLED) {
      metaFallback = {
        attempted: false,
        reason: "meta_app_review_pending",
        metaAdLibraryUrl: metaAdLibraryUrl(page_id),
      };
    } else if (rows.length === 0 && page_id && !resolvedMeta.token) {
      metaFallback = {
        attempted: false,
        reason: "no_meta_credentials_available",
        metaAdLibraryUrl: metaAdLibraryUrl(page_id),
      };
    }

    const totalRows = rows.length + Number((metaFallback?.totalRows as number) || 0);
    const source =
      rows.length === 0 && metaFallback && Number(metaFallback.totalRows || 0) > 0
        ? "meta_ad_library"
        : "foreplay";

    const withMedia = rows.filter(r => r.thumbnail_url);

    return new Response(JSON.stringify({
      success: true,
      source,
      creditsUsed,
      creditBudget,
      startDate,
      stoppedReason,
      apiPages: pages,
      rawAds: allAds.length,
      filtered_non_english: filteredNonEnglish,
      englishAds: englishAds.length,
      totalRows,
      foreplayRows: rows.length,
      withMedia: withMedia.length,
      formatBreakdown: formatCounts,
      upsertErrors,
      metaFallback,
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