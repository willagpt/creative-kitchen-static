// Creative Kitchen — Ad Comparison Gallery (v3)
// Integrated pipeline: save ad → generate Chefly prompt → generate image → refine → compare
// All Supabase + fal.ai calls are DIRECT (no service worker middleman)

(() => {
  'use strict';

  const FAL_MODEL = 'fal-ai/nano-banana-2';

  // ─── State ────────────────────────────────────────────────────────
  let allAds = [];
  let currentFilter = 'all';
  let selectedAd = null;
  let currentVersions = [];
  let selectedAspectRatio = '1:1';

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
  const downloadBtn = document.getElementById('modal-download-btn');
  const versionsSection = document.getElementById('versions-section');
  const versionsStrip = document.getElementById('versions-strip');
  const versionsCount = document.getElementById('versions-count');

  // Feedback / Refine elements
  const feedbackSection = document.getElementById('feedback-section');
  const feedbackInput = document.getElementById('feedback-input');
  const refineBtn = document.getElementById('refine-btn');

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

    // Reset aspect ratio to default
    setAspectRatio('1:1');

    // Download button — show only if there's a generated image
    if (ad.generated_image_url) {
      downloadBtn.classList.remove('hidden');
    } else {
      downloadBtn.classList.add('hidden');
    }

    // Reset feedback
    feedbackInput.value = '';
    // Show feedback section only if there's already a generated image to refine
    if (ad.generated_image_url) {
      feedbackSection.classList.remove('hidden');
    } else {
      feedbackSection.classList.add('hidden');
    }

    // Load version history
    loadVersions(ad.id);

    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // ─── Close modal ──────────────────────────────────────────────────
  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    selectedAd = null;
    currentVersions = [];
  }

  // ─── Download image ───────────────────────────────────────────────
  async function downloadImage() {
    const url = modalGeneratedImg.src;
    if (!url) return;

    downloadBtn.textContent = '↓ Saving...';
    downloadBtn.disabled = true;

    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      const brand = (selectedAd?.advertiser_name || 'chefly').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `${brand}-${ts}-v${currentVersions.length || 1}.${ext}`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      downloadBtn.textContent = '✓ Saved';
      setTimeout(() => { downloadBtn.textContent = '↓ Download'; }, 2000);
    } catch (err) {
      console.error('Download failed:', err);
      downloadBtn.textContent = '↓ Download';
    } finally {
      downloadBtn.disabled = false;
    }
  }

  // ─── Load versions for an ad ──────────────────────────────────────
  async function loadVersions(adId) {
    try {
      const versions = await supabaseRest(
        `/rest/v1/generated_versions?saved_ad_id=eq.${adId}&select=*&order=created_at.desc`
      );
      currentVersions = versions || [];
      renderVersions();
    } catch (err) {
      console.error('Failed to load versions:', err);
      currentVersions = [];
      renderVersions();
    }
  }

  // ─── Save a new version ───────────────────────────────────────────
  async function saveVersion(adId, imageUrl, prompt, creativeDirection, aspectRatio, userFeedback) {
    try {
      const result = await supabaseRest('/rest/v1/generated_versions', {
        method: 'POST',
        body: {
          saved_ad_id: adId,
          image_url: imageUrl,
          prompt: prompt,
          creative_direction: creativeDirection || null,
          aspect_ratio: aspectRatio || '1:1',
          user_feedback: userFeedback || null
        }
      });
      // Reload versions to show the new one
      await loadVersions(adId);
    } catch (err) {
      console.error('Failed to save version:', err);
    }
  }

  // ─── Render version thumbnails ────────────────────────────────────
  function renderVersions() {
    if (currentVersions.length === 0) {
      versionsSection.classList.add('hidden');
      return;
    }

    versionsSection.classList.remove('hidden');
    versionsCount.textContent = `${currentVersions.length} version${currentVersions.length !== 1 ? 's' : ''}`;

    versionsStrip.innerHTML = currentVersions.map((v, i) => {
      const num = currentVersions.length - i;
      const isActive = modalGeneratedImg.src === v.image_url;
      const date = new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const ratio = v.aspect_ratio || '—';
      const isRefined = !!v.user_feedback;
      const refinedClass = isRefined ? ' refined' : '';
      const label = isRefined ? `v${num} · ${ratio} · refined` : `v${num} · ${ratio}`;
      return `
        <div class="version-thumb${refinedClass} ${isActive ? 'active' : ''}" data-version-idx="${i}" title="${date} · ${ratio}${isRefined ? ' · feedback: ' + v.user_feedback.slice(0, 60) : ''} · ${v.rating || 'unrated'}">
          <img src="${v.image_url}" alt="Version ${num}" loading="lazy" />
          <span class="version-thumb-label">${label}</span>
        </div>
      `;
    }).join('');

    // Click to swap the displayed image + prompt
    versionsStrip.querySelectorAll('.version-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const idx = parseInt(thumb.dataset.versionIdx);
        const v = currentVersions[idx];
        if (!v) return;

        modalGeneratedImg.src = v.image_url;
        modalGeneratedImg.classList.remove('hidden');
        modalNoGenerated.classList.add('hidden');
        modalPrompt.value = v.prompt || '';
        downloadBtn.classList.remove('hidden');

        // Show feedback section now that we have a generated image
        feedbackSection.classList.remove('hidden');

        // Set the aspect ratio pill to match this version
        if (v.aspect_ratio) {
          setAspectRatio(v.aspect_ratio);
        }

        // Update active state
        versionsStrip.querySelectorAll('.version-thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
      });
    });
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
  // REFINE PROMPT — sends current prompt + user feedback to Claude
  // Claude makes surgical edits, then auto-generates a new image
  // ═══════════════════════════════════════════════════════════════════
  async function refineAndRegenerate() {
    if (!selectedAd) return;

    const feedback = feedbackInput.value.trim();
    if (!feedback) {
      generateStatus.textContent = 'Type your feedback first — what should change?';
      return;
    }

    const currentPrompt = modalPrompt.value.trim();
    if (!currentPrompt) {
      generateStatus.textContent = 'No prompt to refine — generate one first.';
      return;
    }

    refineBtn.disabled = true;
    refineBtn.textContent = 'Refining prompt...';
    generateStatus.textContent = 'Sending feedback to Claude...';

    try {
      const config = await getConfig();

      // Step 1: Call refine-prompt edge function
      const res = await fetch(`${config.supabaseUrl}/functions/v1/refine-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({
          current_prompt: currentPrompt,
          user_feedback: feedback
        })
      });

      const data = await safeJson(res);

      if (!data || !data.refined_prompt) {
        throw new Error(data?.error || 'Empty response from refine function');
      }

      // Step 2: Update the prompt textarea with refined version
      modalPrompt.value = data.refined_prompt;
      generateStatus.textContent = 'Prompt refined — now generating image...';

      // Step 3: Auto-generate the image with the refined prompt
      refineBtn.textContent = 'Generating image...';
      await generateImageWithPrompt(data.refined_prompt, feedback);

      // Clear the feedback input for next round
      feedbackInput.value = '';

    } catch (err) {
      generateStatus.textContent = `Refine error: ${err.message}`;
    } finally {
      refineBtn.textContent = '↻ Refine & Regenerate';
      refineBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GENERATE IMAGE — calls fal.ai directly with nano-banana-2
  // Shared between Generate Image button and Refine flow
  // ═══════════════════════════════════════════════════════════════════
  async function generateImageWithPrompt(prompt, userFeedback) {
    if (!selectedAd) return;

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
    generateStatus.textContent = `Submitting to fal.ai (${selectedAspectRatio})...`;

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
          aspect_ratio: selectedAspectRatio,
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
            generated_prompt: prompt
          }
        });
      } catch (dbErr) {
        console.error('Failed to save image URL to DB:', dbErr);
      }

      // 6. Save as version (with feedback if this was a refine)
      const direction = creativeDirectionInput.value.trim();
      await saveVersion(selectedAd.id, imageUrl, prompt, direction, selectedAspectRatio, userFeedback || null);

      // 7. Show download + feedback sections
      downloadBtn.classList.remove('hidden');
      feedbackSection.classList.remove('hidden');

      // 8. Update local state
      selectedAd.generated_image_url = imageUrl;
      selectedAd.generated_prompt = prompt;
      const idx = allAds.findIndex(a => a.id === selectedAd.id);
      if (idx >= 0) allAds[idx] = selectedAd;
      updateStats();
      renderGallery();

      const statusLabel = userFeedback ? 'refined' : 'saved';
      generateStatus.textContent = `Done — v${currentVersions.length} ${statusLabel} (${selectedAspectRatio}).`;

    } catch (err) {
      generateStatus.textContent = `Error: ${err.message}`;
    } finally {
      generateImageBtn.textContent = '⚡ Regenerate Image';
      generateImageBtn.disabled = false;
    }
  }

  // ─── Generate Image (button click — no feedback) ──────────────────
  async function generateImage() {
    const prompt = modalPrompt.value.trim();
    await generateImageWithPrompt(prompt, null);
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

  // ─── Aspect ratio helper ─────────────────────────────────────────
  function setAspectRatio(ratio) {
    selectedAspectRatio = ratio;
    document.querySelectorAll('.aspect-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.ratio === ratio);
    });
  }

  // ─── Event listeners ──────────────────────────────────────────────

  // Aspect ratio pills
  document.querySelectorAll('.aspect-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      setAspectRatio(pill.dataset.ratio);
    });
  });

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

  // === THE THREE KEY BUTTONS ===
  // Regenerate Prompt = Claude via Edge Function (Chefly brand DNA)
  regenerateBtn.addEventListener('click', regeneratePrompt);
  // Generate Image = fal.ai nano-banana-2 (uses whatever is in the textarea)
  generateImageBtn.addEventListener('click', generateImage);
  // Refine & Regenerate = feedback → Claude edits prompt → auto-generate
  refineBtn.addEventListener('click', refineAndRegenerate);

  // Download
  downloadBtn.addEventListener('click', downloadImage);

  // Copy & other actions
  document.getElementById('copy-prompt-btn').addEventListener('click', copyPrompt);
  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd?.page_url) window.open(selectedAd.page_url, '_blank');
  });
  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();