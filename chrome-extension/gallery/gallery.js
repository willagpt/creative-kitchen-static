// Creative Kitchen — Ad Comparison Gallery
// Save ads, generate prompts (Claude), generate images (fal.ai nano-banana-2), compare

(() => {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────
  let allAds = [];
  let currentFilter = 'all';
  let selectedAd = null;
  let supabaseConfig = null;

  const FAL_MODEL = 'fal-ai/nano-banana-2';

  // ─── DOM refs ─────────────────────────────────────────────────────
  const gallery = document.getElementById('gallery');
  const emptyState = document.getElementById('empty-state');
  const loading = document.getElementById('loading');
  const modalOverlay = document.getElementById('modal-overlay');
  const refreshBtn = document.getElementById('refresh-btn');

  const statTotal = document.getElementById('stat-total');
  const statPrompts = document.getElementById('stat-prompts');
  const statCompared = document.getElementById('stat-compared');
  const statBrands = document.getElementById('stat-brands');

  const modalBrand = document.getElementById('modal-brand');
  const modalDate = document.getElementById('modal-date');
  const modalOriginalImg = document.getElementById('modal-original-img');
  const modalOriginalCopy = document.getElementById('modal-original-copy');
  const modalGeneratedImg = document.getElementById('modal-generated-img');
  const modalNoGenerated = document.getElementById('modal-no-generated');
  const modalGeneratedNotes = document.getElementById('modal-generated-notes');
  const modalPrompt = document.getElementById('modal-prompt');
  const modalLibraryId = document.getElementById('modal-library-id');
  const modalPlatform = document.getElementById('modal-platform');
  const modalRunningDate = document.getElementById('modal-running-date');
  const modalStatus = document.getElementById('modal-status');
  const generatePlaceholderText = document.getElementById('generate-placeholder-text');

  // ─── Config helper ────────────────────────────────────────────────
  async function getConfig() {
    if (supabaseConfig) return supabaseConfig;
    const { config } = await chrome.storage.local.get('config');
    supabaseConfig = config || {};
    return supabaseConfig;
  }

  // ─── Safe JSON parse helper ─────────────────────────────────────
  async function safeJson(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('JSON parse failed for:', text.substring(0, 200));
      throw new Error('Invalid JSON response from server');
    }
  }

  // ─── Direct Supabase REST call ───────────────────────────────────
  async function supabaseRest(path, { method = 'GET', body } = {}) {
    const config = await getConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase not configured. Open extension settings.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'apikey': config.supabaseAnonKey,
      'Authorization': `Bearer ${config.supabaseAnonKey}`
    };

    if (method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = 'return=representation';
    }

    const res = await fetch(`${config.supabaseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    return safeJson(res);
  }

  // ─── Direct Edge Function call (prompt generation) ──────────────
  async function callGeneratePrompt(ad) {
    const config = await getConfig();
    const res = await fetch(`${config.supabaseUrl}/functions/v1/generate-ad-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`
      },
      body: JSON.stringify({
        saved_ad_id: ad.id,
        advertiser_name: ad.advertiser_name,
        ad_copy: ad.ad_copy,
        image_url: ad.image_url,
        media_type: ad.media_type
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Prompt generation failed: ${res.status} — ${text}`);
    }

    return safeJson(res);
  }

  // ─── fal.ai image generation (queue → poll → result) ───────────
  async function generateImageWithFal(prompt, onStatus) {
    const config = await getConfig();
    if (!config.falApiKey) {
      throw new Error('fal.ai API key not set. Open extension settings (popup) and add it.');
    }

    const headers = {
      'Authorization': 'Key ' + config.falApiKey,
      'Content-Type': 'application/json'
    };

    // 1. Submit job to fal.ai queue
    onStatus('Submitting to nano-banana-2...');
    const submitRes = await fetch('https://queue.fal.run/' + FAL_MODEL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        num_images: 1,
        image_size: 'portrait_4_3',
        enable_safety_checker: false
      })
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`fal.ai submit failed (${submitRes.status}): ${errText}`);
    }

    const submitData = await safeJson(submitRes);
    if (!submitData || !submitData.request_id) {
      throw new Error('fal.ai did not return a request_id. Check your API key.');
    }
    const requestId = submitData.request_id;

    // 2. Poll for completion
    const statusUrl = 'https://queue.fal.run/' + FAL_MODEL + '/requests/' + requestId + '/status';
    let attempts = 0;
    const maxAttempts = 120;

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1500));
      attempts++;

      try {
        const pollRes = await fetch(statusUrl, { headers });
        const pollData = await safeJson(pollRes);

        if (!pollData) {
          onStatus(`Waiting for fal.ai... (${Math.round(attempts * 1.5)}s)`);
          continue;
        }

        if (pollData.status === 'COMPLETED') {
          onStatus('Downloading image...');
          break;
        } else if (pollData.status === 'FAILED') {
          throw new Error('fal.ai generation failed: ' + (pollData.error || 'Unknown error'));
        } else {
          onStatus(`Generating image... (${Math.round(attempts * 1.5)}s)`);
        }
      } catch (pollErr) {
        if (pollErr.message.includes('fal.ai generation failed')) throw pollErr;
        // Network hiccup — retry
        onStatus(`Retrying... (${Math.round(attempts * 1.5)}s)`);
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error('Image generation timed out after 3 minutes');
    }

    // 3. Fetch the result
    const resultUrl = 'https://queue.fal.run/' + FAL_MODEL + '/requests/' + requestId;
    const resultRes = await fetch(resultUrl, { headers });
    const resultData = await safeJson(resultRes);

    if (!resultData || !resultData.images || !resultData.images[0]) {
      console.error('fal.ai result:', resultData);
      throw new Error('fal.ai returned no images');
    }

    return resultData.images[0].url;
  }

  // ─── Load ads ─────────────────────────────────────────────────────
  async function loadAds() {
    loading.classList.remove('hidden');
    gallery.classList.add('hidden');
    emptyState.classList.add('hidden');

    try {
      const ads = await supabaseRest('/rest/v1/saved_ads?select=*&order=created_at.desc');
      allAds = ads || [];
      updateStats();
      renderGallery();
    } catch (err) {
      console.error('Failed to load ads:', err);
      emptyState.classList.remove('hidden');
      emptyState.querySelector('p').textContent = `Error: ${err.message}. Check your Supabase connection in the extension popup.`;
    } finally {
      loading.classList.add('hidden');
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────
  function updateStats() {
    statTotal.textContent = allAds.length;
    statPrompts.textContent = allAds.filter(a => a.generated_prompt).length;
    statCompared.textContent = allAds.filter(a => a.generated_image_url).length;
    const brands = new Set(allAds.map(a => a.advertiser_name).filter(Boolean));
    statBrands.textContent = brands.size;
  }

  // ─── Filter ───────────────────────────────────────────────────────
  function getFilteredAds() {
    switch (currentFilter) {
      case 'with-prompt': return allAds.filter(a => a.generated_prompt);
      case 'pending': return allAds.filter(a => !a.generated_prompt);
      case 'compared': return allAds.filter(a => a.generated_image_url);
      default: return allAds;
    }
  }

  // ─── Render gallery grid ──────────────────────────────────────────
  function renderGallery() {
    const ads = getFilteredAds();

    if (ads.length === 0) {
      gallery.classList.add('hidden');
      emptyState.classList.remove('hidden');
      if (allAds.length > 0) {
        emptyState.querySelector('h2').textContent = 'No ads match this filter';
        emptyState.querySelector('p').textContent = 'Try a different filter or capture more ads.';
      }
      return;
    }

    gallery.classList.remove('hidden');
    emptyState.classList.add('hidden');

    gallery.innerHTML = ads.map(ad => {
      const hasPrompt = !!ad.generated_prompt;
      const hasGenerated = !!ad.generated_image_url;
      const badgeClass = hasGenerated ? 'badge-compared' : hasPrompt ? 'badge-prompt' : 'badge-pending';
      const badgeText = hasGenerated ? 'Compared' : hasPrompt ? 'Prompt Ready' : 'Pending';

      return `
        <div class="ad-card" data-ad-id="${ad.id}">
          <div class="ad-card-image">
            ${ad.image_url
              ? `<img src="${ad.image_url}" alt="${ad.advertiser_name || 'Ad'}" loading="lazy" />`
              : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-2)">No image</div>`
            }
            <span class="ad-card-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="ad-card-body">
            <div class="ad-card-brand">${ad.advertiser_name || 'Unknown Brand'}</div>
            <div class="ad-card-copy">${ad.ad_copy || 'No copy captured'}</div>
            <div class="ad-card-meta">
              <span class="ad-card-platform">${ad.platform || 'Unknown'}</span>
              <span>${ad.started_running || formatDate(ad.created_at)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    gallery.querySelectorAll('.ad-card').forEach(card => {
      card.addEventListener('click', () => {
        const ad = allAds.find(a => a.id === card.dataset.adId);
        if (ad) openModal(ad);
      });
    });
  }

  // ─── Open modal ───────────────────────────────────────────────────
  function openModal(ad) {
    selectedAd = ad;

    modalBrand.textContent = ad.advertiser_name || 'Unknown Brand';
    modalDate.textContent = `Captured ${formatDate(ad.created_at)}`;

    // Original ad
    if (ad.image_url) {
      modalOriginalImg.src = ad.image_url;
      modalOriginalImg.classList.remove('hidden');
    } else {
      modalOriginalImg.classList.add('hidden');
    }
    modalOriginalCopy.textContent = ad.ad_copy || 'No ad copy captured';

    // Generated image
    if (ad.generated_image_url) {
      modalGeneratedImg.src = ad.generated_image_url;
      modalGeneratedImg.classList.remove('hidden');
      modalNoGenerated.classList.add('hidden');
    } else {
      modalGeneratedImg.classList.add('hidden');
      modalNoGenerated.classList.remove('hidden');
      const generateBtn = document.getElementById('modal-generate-btn');
      if (ad.generated_prompt) {
        generatePlaceholderText.textContent = 'Prompt ready — generate the image';
        generateBtn.textContent = 'Generate Image';
        generateBtn.disabled = false;
      } else {
        generatePlaceholderText.textContent = 'Waiting for prompt generation...';
        generateBtn.textContent = 'Generate Image';
        generateBtn.disabled = true;
      }
    }
    modalGeneratedNotes.textContent = ad.generation_notes || '';

    // Prompt
    modalPrompt.textContent = ad.generated_prompt || 'Prompt generating in background... Hit Refresh to check.';

    // Metadata
    modalLibraryId.textContent = ad.library_id || '—';
    modalPlatform.textContent = ad.platform || '—';
    modalRunningDate.textContent = ad.started_running || '—';
    modalStatus.textContent = ad.metadata?.status || '—';

    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // ─── Close modal ──────────────────────────────────────────────────
  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    selectedAd = null;
  }

  // ─── REGENERATE PROMPT (Claude via Edge Function) ───────────────
  async function regeneratePrompt() {
    if (!selectedAd) return;

    const btn = document.getElementById('modal-regenerate-btn');
    btn.textContent = 'Generating Prompt...';
    btn.disabled = true;
    modalPrompt.textContent = 'Generating prompt — this takes 10–15 seconds...';

    try {
      const result = await callGeneratePrompt(selectedAd);

      if (result && result.success && result.prompt) {
        selectedAd.generated_prompt = result.prompt;
        const idx = allAds.findIndex(a => a.id === selectedAd.id);
        if (idx >= 0) allAds[idx] = selectedAd;

        modalPrompt.textContent = selectedAd.generated_prompt;

        const generateBtn = document.getElementById('modal-generate-btn');
        if (generateBtn) {
          generateBtn.disabled = false;
          generatePlaceholderText.textContent = 'Prompt ready — generate the image';
        }

        updateStats();
        renderGallery();
      } else {
        throw new Error((result && result.error) || 'Generation failed');
      }
    } catch (err) {
      modalPrompt.textContent = `Error: ${err.message}`;
    } finally {
      btn.textContent = 'Regenerate Prompt';
      btn.disabled = false;
    }
  }

  // ─── GENERATE IMAGE (fal.ai nano-banana-2) ──────────────────────
  async function generateImage() {
    if (!selectedAd) return;

    if (!selectedAd.generated_prompt) {
      alert('No prompt available yet. Click "Regenerate Prompt" first, or wait for the auto-generated prompt.');
      return;
    }

    const btn = document.getElementById('modal-generate-btn');
    btn.textContent = 'Starting...';
    btn.disabled = true;

    try {
      const imageUrl = await generateImageWithFal(
        selectedAd.generated_prompt,
        (status) => {
          generatePlaceholderText.textContent = status;
        }
      );

      // Save the generated image URL to Supabase
      await supabaseRest(`/rest/v1/saved_ads?id=eq.${selectedAd.id}`, {
        method: 'PATCH',
        body: {
          generated_image_url: imageUrl,
          image_generated_at: new Date().toISOString()
        }
      });

      // Update local state
      selectedAd.generated_image_url = imageUrl;
      const idx = allAds.findIndex(a => a.id === selectedAd.id);
      if (idx >= 0) allAds[idx] = selectedAd;

      // Show the image in the comparison panel
      modalGeneratedImg.src = imageUrl;
      modalGeneratedImg.classList.remove('hidden');
      modalNoGenerated.classList.add('hidden');

      updateStats();
      renderGallery();
    } catch (err) {
      console.error('Image generation error:', err);
      generatePlaceholderText.textContent = `Error: ${err.message}`;
      btn.textContent = 'Retry';
      btn.disabled = false;
      return;
    }

    btn.textContent = 'Generate Image';
    btn.disabled = false;
  }

  // ─── Delete ad ────────────────────────────────────────────────────
  async function deleteSelectedAd() {
    if (!selectedAd) return;
    if (!confirm(`Delete this ${selectedAd.advertiser_name || ''} ad? This can't be undone.`)) return;

    const btn = document.getElementById('modal-delete-btn');
    btn.textContent = 'Deleting...';
    btn.disabled = true;

    try {
      const config = await getConfig();
      const res = await fetch(`${config.supabaseUrl}/rest/v1/saved_ads?id=eq.${selectedAd.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        }
      });

      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);

      allAds = allAds.filter(a => a.id !== selectedAd.id);
      closeModal();
      updateStats();
      renderGallery();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      btn.textContent = 'Delete';
      btn.disabled = false;
    }
  }

  // ─── Copy prompt ──────────────────────────────────────────────────
  function copyPrompt() {
    const text = modalPrompt.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-prompt-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  }

  // ─── Format date ──────────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch { return dateStr; }
  }

  // ─── Event listeners ──────────────────────────────────────────────

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.filter-btn.active').classList.remove('active');
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGallery();
    });
  });

  refreshBtn.addEventListener('click', loadAds);

  document.getElementById('modal-close').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Modal actions — SEPARATE functions
  document.getElementById('modal-regenerate-btn').addEventListener('click', regeneratePrompt);
  document.getElementById('modal-generate-btn').addEventListener('click', generateImage);
  document.getElementById('copy-prompt-btn').addEventListener('click', copyPrompt);
  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd?.page_url) window.open(selectedAd.page_url, '_blank');
  });
  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();
