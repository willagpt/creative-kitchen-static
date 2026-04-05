// Creative Kitchen — Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('supabase-url');
  const keyInput = document.getElementById('supabase-key');
  const falKeyInput = document.getElementById('fal-key');
  const saveBtn = document.getElementById('save-config');
  const testBtn = document.getElementById('test-connection');
  const saveFalBtn = document.getElementById('save-fal');
  const statusEl = document.getElementById('connection-status');
  const falStatusEl = document.getElementById('fal-status');
  const totalAds = document.getElementById('total-ads');
  const totalPrompts = document.getElementById('total-prompts');
  const galleryLink = document.getElementById('gallery-link');

  // ─── Load existing config ─────────────────────────────────────
  const configRes = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (configRes.success && configRes.config) {
    urlInput.value = configRes.config.supabaseUrl || '';
    keyInput.value = configRes.config.supabaseAnonKey || '';
    falKeyInput.value = configRes.config.falApiKey || '';
  }

  // ─── Load stats ───────────────────────────────────────────
  async function loadStats() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_ADS' });
      if (res.success && res.ads) {
        totalAds.textContent = res.ads.length;
        const withPrompts = res.ads.filter(ad => ad.generated_prompt).length;
        totalPrompts.textContent = withPrompts;
      }
    } catch {
      totalAds.textContent = '—';
      totalPrompts.textContent = '—';
    }
  }

  loadStats();

  // ─── Save Supabase config ────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const config = {
      supabaseUrl: urlInput.value.trim().replace(/\/$/, ''),
      supabaseAnonKey: keyInput.value.trim()
    };

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      showStatus(statusEl, 'Please fill in both fields', 'error');
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      config
    });

    if (res.success) {
      showStatus(statusEl, 'Supabase config saved', 'success');
    } else {
      showStatus(statusEl, res.error, 'error');
    }
  });

  // ─── Save fal.ai key ────────────────────────────────────────
  saveFalBtn.addEventListener('click', async () => {
    const falApiKey = falKeyInput.value.trim();
    if (!falApiKey) {
      showStatus(falStatusEl, 'Enter your fal.ai API key', 'error');
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      config: { falApiKey }
    });

    if (res.success) {
      showStatus(falStatusEl, 'fal.ai key saved ✓', 'success');
    } else {
      showStatus(falStatusEl, res.error, 'error');
    }
  });

  // ─── Test connection ────────────────────────────────────────
  testBtn.addEventListener('click', async () => {
    showStatus(statusEl, 'Testing connection...', 'info');

    const res = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });

    if (res.success) {
      showStatus(statusEl, 'Connected to Supabase ✓', 'success');
      loadStats();
    } else {
      showStatus(statusEl, `Connection failed: ${res.error}`, 'error');
    }
  });

  // ─── Open gallery ───────────────────────────────────────────
  galleryLink.addEventListener('click', async () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('gallery/gallery.html')
    });
  });

  // ─── Status helper ───────────────────────────────────────────
  function showStatus(el, message, type) {
    el.className = `status status-${type}`;
    el.textContent = message;
  }
});
