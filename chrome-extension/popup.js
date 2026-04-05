// Creative Kitchen — Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('supabase-url');
  const keyInput = document.getElementById('supabase-key');
  const saveBtn = document.getElementById('save-config');
  const testBtn = document.getElementById('test-connection');
  const statusEl = document.getElementById('connection-status');
  const totalAds = document.getElementById('total-ads');
  const totalPrompts = document.getElementById('total-prompts');
  const galleryLink = document.getElementById('gallery-link');

  // ─── Load existing config ───────────────────────────────────────
  const configRes = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (configRes.success && configRes.config) {
    urlInput.value = configRes.config.supabaseUrl || '';
    keyInput.value = configRes.config.supabaseAnonKey || '';
  }

  // ─── Load stats ─────────────────────────────────────────────────
  async function loadStats() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_ADS' });
      if (res.success && res.ads) {
        totalAds.textContent = res.ads.length;
        const withPrompts = res.ads.filter(ad => ad.generated_prompt).length;
        totalPrompts.textContent = withPrompts;
      }
    } catch {
      // Config not set yet
      totalAds.textContent = '—';
      totalPrompts.textContent = '—';
    }
  }

  loadStats();

  // ─── Save config ────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const config = {
      supabaseUrl: urlInput.value.trim().replace(/\/$/, ''),
      supabaseAnonKey: keyInput.value.trim()
    };

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      showStatus('Please fill in both fields', 'error');
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      config
    });

    if (res.success) {
      showStatus('Configuration saved', 'success');
    } else {
      showStatus(res.error, 'error');
    }
  });

  // ─── Test connection ────────────────────────────────────────────
  testBtn.addEventListener('click', async () => {
    showStatus('Testing connection...', 'info');

    const res = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });

    if (res.success) {
      showStatus('Connected to Supabase ✓', 'success');
      loadStats();
    } else {
      showStatus(`Connection failed: ${res.error}`, 'error');
    }
  });

  // ─── Open gallery in side panel ─────────────────────────────────
  galleryLink.addEventListener('click', async () => {
    // Try to open the gallery as a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('gallery/gallery.html')
    });
  });

  // ─── Status helper ──────────────────────────────────────────────
  function showStatus(message, type) {
    statusEl.className = `status status-${type}`;
    statusEl.textContent = message;
  }
});
