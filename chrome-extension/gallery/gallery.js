// Creative Kitchen — Ad Comparison Gallery (v2)
// Integrated pipeline: save ad → generate Chefly prompt → generate image → compare
// All Supabase + fal.ai calls are DIRECT (no service worker middleman)

(() => {
  'use strict';

  const FAL_MODEL = 'fal-ai/nano-banana-2';

  // ─── State ────────────────────────────────────────────────────────
  let allAds = [];
  let currentFilter = 'all';
  let selectedAd = null;

  // ─── DOM refs ─────────────────────────────────────────────────────
  const gallery = document.getElementById('gallery');
  const emptyState = document.getElementById('empty-state');
  const loading = document.getElementById('loading');
  const modalOverlay = document.getElementById('modal-overlay');
  const refreshBtn = document.getElementById('refresh-btn');

  // Stats
  const statTotal = document.getElementById('stat-total');
  const statPrompts = document.getElementById('stat-prompts');
  const statCompared = document.getElementById('stat-compared');
  const statBrands = document.getElementById('stat-brands');

  // Modal elements
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
  const generateImageBtn = document.getElementById('modal-generate-image-btn');
  const generateStatus = document.getElementById('generate-status');
  const regenerateBtn = document.getElementById('modal-regenerate-btn');
  const creativeDirectionInput = document.getElementById('creative-direction');

  // ─── Config helper (reads directly from chrome.storage.local) ─────
  function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get('config', ({ config }) => {
        resolve(config || {});
      });
    });
  }

  // ─── Safe JSON parser (handles empty responses) ───────────────────
  async function safeJson(res) {
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  }

  // ─── Direct Supabase REST call ────────────────────────────────────
  async function supabaseRest(path, { method = 'GET', body } = {}) {
    const config = await getConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase not configured — open extension settings.');
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
      throw new Error(`Supabase ${res.status}: ${text}`);
    }

    return safeJson(res);
  }

  // ─── Load ads (direct) ────────────────────────────────────────────
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

  // ─── Update stats ─────────────────────────────────────────────────
  function updateStats() {
    statTotal.textContent = allAds.length;
    statPrompts.textContent = allAds.filter(a => a.generated_prompt).length;
    statCompared.textContent = allAds.filter(a => a.generated_image_url).length;
    const brands = new Set(allAds.map(a => a.advertiser_name).filter(Boolean));
    statBrands.textContent = brands.size;
  }

  // ─── Filter ads ───────────────────────────────────────────────────
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

  // ─── Open comparison modal ────────────────────────────────────────
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

    // Generated version
    if (ad.generated_image_url) {
      modalGeneratedImg.src = ad.generated_image_url;
      modalGeneratedImg.classList.remove('hidden');
      modalNoGenerated.classList.add('hidden');
    } else {
      modalGeneratedImg.classList.add('hidden');
      modalNoGenerated.classList.remove('hidden');
    }
    modalGeneratedNotes.textContent = ad.generation_notes || '';

    // Prompt (editable textarea)
    modalPrompt.value = ad.generated_prompt || '';

    // Metadata
    modalLibraryId.textContent = ad.library_id || '—';
    modalPlatform.textContent = ad.platform || '—';
    modalRunningDate.textContent = ad.started_running || '—';
    modalStatus.textContent = ad.metadata?.status || '—';

    // Reset status and creative direction
    generateStatus.textContent = '';
    generateImageBtn.disabled = false;
    generateImageBtn.textContent = ad.generated_image_url ? '⚡ Regenerate Image' : '⚡ Generate Image';
    regenerateBtn.disabled = false;
    regenerateBtn.textContent = '↻ New Prompt';
    creativeDirectionInput.value = '';

    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // ─── Close modal ──────────────────────────────────────────────────
  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    selectedAd = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // REGENERATE PROMPT — calls the Chefly Edge Function via Supabase
  // ═══════════════════════════════════════════════════════════════════
  async function regeneratePrompt() {
    if (!selectedAd) return;

    regenerateBtn.textContent = 'Generating prompt...';
    regenerateBtn.disabled = true;
    generateStatus.textContent = 'Calling Claude (Opus)...';

    try {
      const config = await getConfig();
      const direction = creativeDirectionInput.value.trim();
      const res = await fetch(`${config.supabaseUrl}/functions/v1/generate-ad-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({
          saved_ad_id: selectedAd.id,
          advertiser_name: selectedAd.advertiser_name,
          ad_copy: selectedAd.ad_copy,
          image_url: selectedAd.image_url,
          media_type: selectedAd.media_type,
          creative_direction: direction || undefined
        })
      });

      const data = await safeJson(res);

      if (data && data.prompt) {
        // Update textarea with new prompt
        modalPrompt.value = data.prompt;
        // Update local state
        selectedAd.generated_prompt = data.prompt;
        const idx = allAds.findIndex(a => a.id === selectedAd.id);
        if (idx >= 0) allAds[idx] = selectedAd;
        updateStats();
        renderGallery();
        generateStatus.textContent = 'Prompt ready — edit it or hit Generate Image.';
      } else {
        throw new Error(data?.error || 'Empty response from Edge Function');
      }
    } catch (err) {
      generateStatus.textContent = `Prompt error: ${err.message}`;
    } finally {
      regenerateBtn.textContent = '↻ New Prompt';
      regenerateBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GENERATE IMAGE — calls fal.ai directly with nano-banana-2
  // Queue → Poll → Result pattern
  // ═══════════════════════════════════════════════════════════════════
  async function generateImage() {
    if (!selectedAd) return;

    // Use whatever is currently in the textarea (could be edited)
    const prompt = modalPrompt.value.trim();
    if (!prompt) {
      generateStatus.textContent = 'No prompt — regenerate one first or type your own.';
      return;
    }

    const config = await getConfig();
    if (!config.falApiKey) {
      generateStatus.textContent = 'fal.ai API key not set — add it in extension settings.';
      return;
    }

    generateImageBtn.textContent = 'Generating...';
    generateImageBtn.disabled = true;
    generateStatus.textContent = 'Submitting to fal.ai queue...';

    try {
      const headers = {
        'Authorization': 'Key ' + config.falApiKey,
        'Content-Type': 'application/json'
      };

      // 1. Submit to queue
      const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt,
          num_images: 1,
          image_size: 'portrait_4_3',
          enable_safety_checker: false
        })
      });

      const submitData = await safeJson(submitRes);
      if (!submitData || !submitData.request_id) {
        throw new Error('Failed to queue request — no request_id returned');
      }

      const requestId = submitData.request_id;
      generateStatus.textContent = `Queued (${requestId.slice(0, 8)}...) — polling...`;

      // 2. Poll for completion
      let imageUrl = null;
      const maxAttempts = 60; // 90 seconds max
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1500));

        const statusRes = await fetch(
          `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/status`,
          { headers }
        );
        const statusData = await safeJson(statusRes);

        if (!statusData) continue;

        if (statusData.status === 'COMPLETED') {
          generateStatus.textContent = 'Completed — fetching result...';
          break;
        } else if (statusData.status === 'FAILED') {
          throw new Error('fal.ai generation failed');
        } else {
          generateStatus.textContent = `Status: ${statusData.status} (${i + 1}/${maxAttempts})...`;
        }
      }

      // 3. Fetch the result
      const resultRes = await fetch(
        `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}`,
        { headers }
      );
      const resultData = await safeJson(resultRes);

      if (resultData && resultData.images && resultData.images.length > 0) {
        imageUrl = resultData.images[0].url;
      } else {
        throw new Error('No image in fal.ai result');
      }

      // 4. Show the generated image
      modalGeneratedImg.src = imageUrl;
      modalGeneratedImg.classList.remove('hidden');
      modalNoGenerated.classList.add('hidden');

      // 5. Save image URL back to Supabase
      try {
        await supabaseRest(`/rest/v1/saved_ads?id=eq.${selectedAd.id}`, {
          method: 'PATCH',
          body: {
            generated_image_url: imageUrl,
            image_generated_at: new Date().toISOString(),
            // Also save the prompt that was used (in case user edited it)
            generated_prompt: prompt
          }
        });
      } catch (dbErr) {
        console.error('Failed to save image URL to DB:', dbErr);
      }

      // 6. Update local state
      selectedAd.generated_image_url = imageUrl;
      selectedAd.generated_prompt = prompt;
      const idx = allAds.findIndex(a => a.id === selectedAd.id);
      if (idx >= 0) allAds[idx] = selectedAd;
      updateStats();
      renderGallery();

      generateStatus.textContent = 'Done — image generated with nano-banana-2.';

    } catch (err) {
      generateStatus.textContent = `Error: ${err.message}`;
    } finally {
      generateImageBtn.textContent = '⚡ Regenerate Image';
      generateImageBtn.disabled = false;
    }
  }

  // ─── Delete ad (direct) ───────────────────────────────────────────
  async function deleteSelectedAd() {
    if (!selectedAd) return;
    if (!confirm(`Delete this ${selectedAd.advertiser_name || ''} ad? This can't be undone.`)) return;

    const btn = document.getElementById('modal-delete-btn');
    btn.textContent = 'Deleting...';
    btn.disabled = true;

    try {
      const config = await getConfig();
      await fetch(`${config.supabaseUrl}/rest/v1/saved_ads?id=eq.${selectedAd.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        }
      });

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
    const text = modalPrompt.value;
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

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.filter-btn.active').classList.remove('active');
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGallery();
    });
  });

  // Refresh
  refreshBtn.addEventListener('click', loadAds);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // === THE TWO KEY BUTTONS ===
  // Regenerate Prompt = Claude via Edge Function (Chefly brand DNA)
  regenerateBtn.addEventListener('click', regeneratePrompt);
  // Generate Image = fal.ai nano-banana-2 (uses whatever is in the textarea)
  generateImageBtn.addEventListener('click', generateImage);

  // Copy & other actions
  document.getElementById('copy-prompt-btn').addEventListener('click', copyPrompt);
  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd?.page_url) window.open(selectedAd.page_url, '_blank');
  });
  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();
