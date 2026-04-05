// Creative Kitchen — Ad Capture Background Service Worker
// Handles Supabase communication and Claude prompt generation

const SUPABASE_FUNCTIONS_PATH = '/functions/v1/generate-ad-prompt';

// ─── Storage helpers ────────────────────────────────────────────────
async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return config || {};
}

async function saveConfig(updates) {
  const current = await getConfig();
  await chrome.storage.local.set({ config: { ...current, ...updates } });
}

// ─── Supabase helpers ───────────────────────────────────────────────
async function supabaseRequest(path, { method = 'GET', body, config } = {}) {
  const cfg = config || await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('Supabase not configured. Open extension settings.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': cfg.supabaseAnonKey,
    'Authorization': `Bearer ${cfg.supabaseAnonKey}`
  };

  const res = await fetch(`${cfg.supabaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} failed: ${res.status} — ${text}`);
  }

  return res.json();
}

// ─── Save ad to Supabase ────────────────────────────────────────────
async function saveAd(adData) {
  const config = await getConfig();

  // 1. Insert the saved ad
  const [saved] = await supabaseRequest('/rest/v1/saved_ads', {
    method: 'POST',
    body: {
      advertiser_name: adData.advertiserName,
      ad_copy: adData.adCopy,
      image_url: adData.imageUrl,
      video_url: adData.videoUrl || null,
      library_id: adData.libraryId,
      platform: adData.platform,
      started_running: adData.startedRunning,
      page_url: adData.pageUrl,
      media_type: adData.videoUrl ? 'video' : 'image',
      metadata: adData.metadata || {}
    },
    config
  });

  return saved;
}

// ─── Generate prompt via Edge Function ──────────────────────────────
async function generatePrompt(savedAd) {
  const config = await getConfig();

  const res = await fetch(`${config.supabaseUrl}${SUPABASE_FUNCTIONS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.supabaseAnonKey}`
    },
    body: JSON.stringify({
      saved_ad_id: savedAd.id,
      advertiser_name: savedAd.advertiser_name,
      ad_copy: savedAd.ad_copy,
      image_url: savedAd.image_url,
      media_type: savedAd.media_type
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prompt generation failed: ${res.status} — ${text}`);
  }

  return res.json();
}

// ─── Fetch all saved ads ────────────────────────────────────────────
async function fetchSavedAds() {
  return supabaseRequest(
    '/rest/v1/saved_ads?select=*&order=created_at.desc'
  );
}

// ─── Fetch a single saved ad with its generated prompt ──────────────
async function fetchAdWithPrompt(adId) {
  const [ad] = await supabaseRequest(
    `/rest/v1/saved_ads?id=eq.${adId}&select=*`
  );
  return ad;
}

// ─── Message handler ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    try {
      switch (message.type) {
        case 'SAVE_AD': {
          const saved = await saveAd(message.data);
          // Auto-generate prompt after saving
          try {
            const promptResult = await generatePrompt(saved);
            return { success: true, ad: saved, prompt: promptResult };
          } catch (promptErr) {
            // Ad saved but prompt failed — still return success
            return {
              success: true,
              ad: saved,
              promptError: promptErr.message
            };
          }
        }

        case 'FETCH_ADS': {
          const ads = await fetchSavedAds();
          return { success: true, ads };
        }

        case 'FETCH_AD': {
          const ad = await fetchAdWithPrompt(message.adId);
          return { success: true, ad };
        }

        case 'GENERATE_PROMPT': {
          const result = await generatePrompt(message.ad);
          return { success: true, prompt: result };
        }

        case 'GET_CONFIG': {
          const config = await getConfig();
          return { success: true, config };
        }

        case 'SAVE_CONFIG': {
          await saveConfig(message.config);
          return { success: true };
        }

        case 'TEST_CONNECTION': {
          const config = await getConfig();
          await supabaseRequest('/rest/v1/saved_ads?select=count&limit=0', { config });
          return { success: true, message: 'Connected to Supabase' };
        }

        default:
          return { success: false, error: `Unknown message type: ${message.type}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  handle().then(sendResponse);
  return true; // keep message channel open for async response
});

// ─── Open side panel on extension icon click (when on Ad Library) ───
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('facebook.com/ads/library')) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ─── Enable side panel only on Ad Library pages ─────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;

  if (tab.url.includes('facebook.com/ads/library')) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'gallery/gallery.html',
      enabled: true
    });
  } else {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
});
