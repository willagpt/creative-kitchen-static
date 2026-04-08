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

  // Batch state
  let batchTemplate = '';
  let batchPlaceholders = {};
  let batchSelectedRatio = '4:5';
  let batchRunning = false;
  let batchCancelled = false;
  let referenceImages = []; // { id, name, label, publicUrl, filePath }
  let activeVersionIdx = 0; // which version thumbnail is currently selected

  // Brand guidelines state
  let brandGuidelinesText = '';
  let brandSleeveNotes = '';
  let brandGuidelineImages = []; // { id, file, base64, media_type, preview }

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

    // Reset batch section
    document.getElementById('batch-section').classList.add('hidden');
    document.getElementById('modal-batch-btn').classList.remove('active');
    document.getElementById('batch-template').value = '';
    document.getElementById('batch-template').classList.add('hidden');
    document.getElementById('batch-template-status').textContent = '';
    document.getElementById('batch-step-refs').classList.add('hidden');
    document.getElementById('batch-step-lists').classList.add('hidden');
    document.getElementById('batch-step-generate').classList.add('hidden');
    document.getElementById('batch-results').classList.add('hidden');
    document.getElementById('batch-results-grid').innerHTML = '';
    document.getElementById('batch-progress').classList.add('hidden');
    document.getElementById('batch-cancel-btn').classList.add('hidden');
    document.querySelectorAll('.batch-list-textarea').forEach(t => { t.value = ''; });
    document.getElementById('ref-grid').innerHTML = '';
    batchTemplate = '';
    batchPlaceholders = {};
    batchRunning = false;
    batchCancelled = false;
    // Keep referenceImages across ads — they're your product photos, not ad-specific

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

    // Show "What changed?" button if 2+ versions
    const compareBtn = document.getElementById('compare-btn');
    if (currentVersions.length >= 2) {
      compareBtn.classList.remove('hidden');
    } else {
      compareBtn.classList.add('hidden');
    }

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
        activeVersionIdx = idx;
        versionsStrip.querySelectorAll('.version-thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');

        // Hide previous compare summary when switching versions
        document.getElementById('compare-summary').classList.add('hidden');
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

  // ═══════════════════════════════════════════════════════════════════
  // REFERENCE IMAGE UPLOAD — upload meal photos to Supabase Storage
  // ═══════════════════════════════════════════════════════════════════

  async function uploadReferenceImage(file) {
    const config = await getConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase not configured');
    }

    // Generate unique filename
    const ext = file.name.split('.').pop().toLowerCase();
    const safeName = file.name.replace(/[^a-z0-9.-]/gi, '-').toLowerCase();
    const timestamp = Date.now();
    const filePath = `meals/${timestamp}-${safeName}`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(
      `${config.supabaseUrl}/storage/v1/object/reference-images/${filePath}`,
      {
        method: 'POST',
        headers: {
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
          'Content-Type': file.type
        },
        body: file
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed: ${errText}`);
    }

    // Get public URL
    const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/reference-images/${filePath}`;

    // Save metadata to reference_images table
    const result = await supabaseRest('/rest/v1/reference_images', {
      method: 'POST',
      body: {
        name: file.name,
        file_path: filePath,
        public_url: publicUrl,
        category: 'meal',
        mime_type: file.type,
        file_size: file.size
      }
    });

    const record = result?.[0] || { id: crypto.randomUUID() };

    return {
      id: record.id,
      name: file.name,
      label: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      publicUrl,
      filePath
    };
  }

  async function handleRefFileUpload(files) {
    const grid = document.getElementById('ref-grid');

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      // Create preview card immediately with loading state
      const tempId = `ref-temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);

      const cardHtml = `
        <div class="ref-card" data-ref-id="${tempId}" id="ref-card-${tempId}">
          <div class="ref-card-image">
            <img src="${previewUrl}" alt="${file.name}" />
          </div>
          <div class="ref-card-uploading"></div>
          <div class="ref-card-meta">
            <div class="ref-card-name">${file.name}</div>
            <input class="ref-card-label" type="text" placeholder="e.g. smoky chipotle chicken" data-ref-id="${tempId}" />
          </div>
          <button class="ref-card-remove" data-ref-id="${tempId}">x</button>
        </div>
      `;
      grid.insertAdjacentHTML('beforeend', cardHtml);

      try {
        const ref = await uploadReferenceImage(file);
        ref.label = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        referenceImages.push(ref);

        // Update card: remove loading, set real ID
        const card = document.getElementById(`ref-card-${tempId}`);
        if (card) {
          card.dataset.refId = ref.id;
          card.id = `ref-card-${ref.id}`;
          const uploading = card.querySelector('.ref-card-uploading');
          if (uploading) uploading.remove();
          const labelInput = card.querySelector('.ref-card-label');
          if (labelInput) {
            labelInput.dataset.refId = ref.id;
            labelInput.value = ref.label;
          }
          const removeBtn = card.querySelector('.ref-card-remove');
          if (removeBtn) removeBtn.dataset.refId = ref.id;
        }
      } catch (err) {
        console.error('Upload failed:', err);
        const card = document.getElementById(`ref-card-${tempId}`);
        if (card) {
          const uploading = card.querySelector('.ref-card-uploading');
          if (uploading) {
            uploading.className = 'batch-result-error';
            uploading.textContent = 'Upload failed';
          }
        }
      }

      URL.revokeObjectURL(previewUrl);
    }
  }

  function removeReferenceImage(refId) {
    referenceImages = referenceImages.filter(r => r.id !== refId);
    const card = document.querySelector(`.ref-card[data-ref-id="${refId}"]`);
    if (card) card.remove();
  }

  function renderExistingRefs() {
    const grid = document.getElementById('ref-grid');
    grid.innerHTML = referenceImages.map(ref => `
      <div class="ref-card" data-ref-id="${ref.id}" id="ref-card-${ref.id}">
        <div class="ref-card-image">
          <img src="${ref.publicUrl}" alt="${ref.name}" loading="lazy" />
        </div>
        <div class="ref-card-meta">
          <div class="ref-card-name">${ref.name}</div>
          <input class="ref-card-label" type="text" value="${ref.label}" placeholder="e.g. smoky chipotle chicken" data-ref-id="${ref.id}" />
        </div>
        <button class="ref-card-remove" data-ref-id="${ref.id}">x</button>
      </div>
    `).join('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // BATCH VARIATIONS — templatize, combine, generate at scale
  // ═══════════════════════════════════════════════════════════════════

  // Toggle batch section visibility
  function toggleBatch() {
    const section = document.getElementById('batch-section');
    const btn = document.getElementById('modal-batch-btn');
    const isVisible = !section.classList.contains('hidden');

    if (isVisible) {
      section.classList.add('hidden');
      btn.classList.remove('active');
    } else {
      section.classList.remove('hidden');
      btn.classList.add('active');
      // If we already have a prompt, show the templatize button as ready
      const prompt = modalPrompt.value.trim();
      if (!prompt) {
        document.getElementById('batch-template-status').textContent = 'Generate a prompt first, then create a template from it.';
      }
    }
  }

  // Call Edge Function to templatize the prompt
  async function templatizePrompt() {
    const prompt = modalPrompt.value.trim();
    if (!prompt) {
      document.getElementById('batch-template-status').textContent = 'No prompt to templatize. Generate one first.';
      return;
    }

    const btn = document.getElementById('batch-templatize-btn');
    const statusEl = document.getElementById('batch-template-status');
    const templateArea = document.getElementById('batch-template');

    btn.disabled = true;
    btn.textContent = 'Templatizing...';
    statusEl.textContent = 'Sending prompt to Claude for template extraction...';

    try {
      const config = await getConfig();
      const res = await fetch(`${config.supabaseUrl}/functions/v1/templatize-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({ prompt })
      });

      const data = await safeJson(res);

      if (!data || !data.template) {
        throw new Error(data?.error || 'Empty response from templatize function');
      }

      batchTemplate = data.template;
      batchPlaceholders = data.placeholders || {};

      // Show the template
      templateArea.value = batchTemplate;
      templateArea.classList.remove('hidden');

      // Pre-fill variable lists with original values
      Object.entries(batchPlaceholders).forEach(([key, value]) => {
        const textarea = document.querySelector(`.batch-list-textarea[data-placeholder="${key}"]`);
        if (textarea && value) {
          textarea.value = value;
        }
      });

      // Show steps 2, 3, and 4
      document.getElementById('batch-step-refs').classList.remove('hidden');
      document.getElementById('batch-step-lists').classList.remove('hidden');
      document.getElementById('batch-step-generate').classList.remove('hidden');

      // Update combination count
      updateBatchComboCount();

      const placeholderCount = Object.keys(batchPlaceholders).length;
      statusEl.textContent = `Template created with ${placeholderCount} placeholder${placeholderCount !== 1 ? 's' : ''}. Edit the lists below and generate.`;

    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Template from Prompt';
    }
  }

  // Get lists from textareas, splitting by newline and using --- as separator for multi-line items
  function getBatchLists() {
    const lists = {};
    document.querySelectorAll('.batch-list-textarea').forEach(textarea => {
      const key = textarea.dataset.placeholder;
      const raw = textarea.value.trim();
      if (!raw) return;

      // For MEAL_DESCRIPTION, split by blank lines (double newline) since descriptions are long
      if (key === 'MEAL_DESCRIPTION') {
        lists[key] = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
      } else {
        lists[key] = raw.split('\n').map(s => s.trim()).filter(Boolean);
      }
    });
    return lists;
  }

  // Calculate all combinations
  function getCombinations(lists) {
    const keys = Object.keys(lists).filter(k => lists[k].length > 0);
    if (keys.length === 0) return [];

    // Start with the first list
    let combos = lists[keys[0]].map(val => ({ [keys[0]]: val }));

    // Cross-product with remaining lists
    for (let i = 1; i < keys.length; i++) {
      const key = keys[i];
      const values = lists[key];
      const newCombos = [];
      for (const combo of combos) {
        for (const val of values) {
          newCombos.push({ ...combo, [key]: val });
        }
      }
      combos = newCombos;
    }

    return combos;
  }

  // Update combination count display
  function updateBatchComboCount() {
    const lists = getBatchLists();
    const combos = getCombinations(lists);
    const multiplier = batchSelectedRatio === 'both' ? 2 : 1;
    const total = combos.length * multiplier;

    document.getElementById('batch-combo-count').textContent = total;
    document.getElementById('batch-generate-btn').disabled = total === 0;
  }

  // Apply a combination to the template
  function applyTemplate(template, combo) {
    let result = template;
    Object.entries(combo).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
    return result;
  }

  // Generate a single image via fal.ai (reuses existing pattern)
  // referenceUrl is optional — if provided, used as image_url for img2img guidance
  async function generateSingleBatchImage(prompt, ratio, referenceUrl) {
    const config = await getConfig();
    if (!config.falApiKey) throw new Error('fal.ai API key not set');

    const headers = {
      'Authorization': 'Key ' + config.falApiKey,
      'Content-Type': 'application/json'
    };

    const payload = {
      prompt,
      num_images: 1,
      aspect_ratio: ratio,
      enable_safety_checker: false
    };

    // If we have a reference image, pass it for image-guided generation
    if (referenceUrl) {
      payload.image_url = referenceUrl;
    }

    // Submit
    const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const submitData = await safeJson(submitRes);
    if (!submitData?.request_id) throw new Error('No request_id');

    // Poll
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const statusRes = await fetch(
        `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}/status`,
        { headers }
      );
      const statusData = await safeJson(statusRes);
      if (statusData?.status === 'COMPLETED') break;
      if (statusData?.status === 'FAILED') throw new Error('Generation failed');
    }

    // Fetch result
    const resultRes = await fetch(
      `https://queue.fal.run/${FAL_MODEL}/requests/${submitData.request_id}`,
      { headers }
    );
    const resultData = await safeJson(resultRes);
    if (resultData?.images?.[0]?.url) return resultData.images[0].url;
    throw new Error('No image in result');
  }

  // Run the full batch
  async function runBatch() {
    if (batchRunning) return;

    const template = document.getElementById('batch-template').value.trim();
    if (!template) return;

    const lists = getBatchLists();
    const combos = getCombinations(lists);
    if (combos.length === 0) return;

    const ratios = batchSelectedRatio === 'both' ? ['4:5', '9:16'] : [batchSelectedRatio];

    // Build reference image lookup: match by label to MEAL_NAME
    // Users label their uploaded photos (e.g. "smoky chipotle chicken")
    // and we match that to the MEAL_NAME variable value
    const refLookup = {};
    referenceImages.forEach(ref => {
      // Update label from the input field in case user edited it
      const labelInput = document.querySelector(`.ref-card-label[data-ref-id="${ref.id}"]`);
      if (labelInput) ref.label = labelInput.value.trim();
      if (ref.label) {
        refLookup[ref.label.toLowerCase()] = ref.publicUrl;
      }
    });

    // Build all jobs
    const jobs = [];
    for (const combo of combos) {
      for (const ratio of ratios) {
        // Try to match a reference image to this combo's meal name
        const mealName = (combo.MEAL_NAME || '').toLowerCase();
        const refUrl = refLookup[mealName] || (referenceImages.length === 1 ? referenceImages[0].publicUrl : null);
        jobs.push({ combo, ratio, prompt: applyTemplate(template, combo), referenceUrl: refUrl });
      }
    }

    batchRunning = true;
    batchCancelled = false;

    const generateBtn = document.getElementById('batch-generate-btn');
    const cancelBtn = document.getElementById('batch-cancel-btn');
    const progressEl = document.getElementById('batch-progress');
    const progressFill = document.getElementById('batch-progress-fill');
    const progressText = document.getElementById('batch-progress-text');
    const resultsEl = document.getElementById('batch-results');
    const resultsGrid = document.getElementById('batch-results-grid');
    const resultsCount = document.getElementById('batch-results-count');

    generateBtn.disabled = true;
    generateBtn.textContent = 'Running...';
    cancelBtn.classList.remove('hidden');
    progressEl.classList.remove('hidden');
    resultsEl.classList.remove('hidden');

    // Pre-render result cards as loading
    resultsGrid.innerHTML = jobs.map((job, i) => {
      const ratioClass = job.ratio === '9:16' ? 'ratio-9-16' : '';
      const varsHtml = Object.entries(job.combo)
        .map(([k, v]) => `<strong>${k}:</strong> ${v.slice(0, 40)}${v.length > 40 ? '...' : ''}`)
        .join('<br>');
      return `
        <div class="batch-result-card" data-job-idx="${i}">
          <div class="batch-result-image ${ratioClass}" id="batch-img-${i}">
            <div class="batch-result-loading"></div>
          </div>
          <div class="batch-result-meta">
            <div class="batch-result-vars">${varsHtml}<br><strong>ratio:</strong> ${job.ratio}</div>
          </div>
          <div class="batch-result-rating">
            <button class="batch-rating-btn" data-rating="great" data-idx="${i}">Great</button>
            <button class="batch-rating-btn" data-rating="good" data-idx="${i}">Good</button>
            <button class="batch-rating-btn" data-rating="needs-work" data-idx="${i}">Meh</button>
            <button class="batch-rating-btn" data-rating="slop" data-idx="${i}">Slop</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire up rating buttons
    resultsGrid.querySelectorAll('.batch-rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.idx;
        const card = resultsGrid.querySelector(`[data-job-idx="${idx}"]`);
        card.querySelectorAll('.batch-rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Process jobs (2 concurrent to avoid rate limits)
    let completed = 0;
    const concurrency = 2;
    const results = new Array(jobs.length);

    async function processJob(idx) {
      if (batchCancelled) return;
      const job = jobs[idx];
      const imgContainer = document.getElementById(`batch-img-${idx}`);

      try {
        const imageUrl = await generateSingleBatchImage(job.prompt, job.ratio, job.referenceUrl);
        results[idx] = { success: true, imageUrl };
        imgContainer.innerHTML = `<img src="${imageUrl}" alt="Variation ${idx + 1}" loading="lazy" />`;

        // Save as generated_version
        if (selectedAd) {
          const comboStr = Object.entries(job.combo).map(([k, v]) => `${k}: ${v.slice(0, 50)}`).join(' | ');
          try {
            await saveVersion(selectedAd.id, imageUrl, job.prompt, `batch: ${comboStr}`, job.ratio, null);
          } catch (e) {
            console.error('Failed to save batch version:', e);
          }
        }
      } catch (err) {
        results[idx] = { success: false, error: err.message };
        imgContainer.innerHTML = `<div class="batch-result-error">${err.message}</div>`;
      }

      completed++;
      const pct = Math.round((completed / jobs.length) * 100);
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${completed} / ${jobs.length}`;
      resultsCount.textContent = `${completed} of ${jobs.length} generated`;
    }

    // Run with controlled concurrency
    const queue = [...Array(jobs.length).keys()];
    const workers = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push((async () => {
        while (queue.length > 0 && !batchCancelled) {
          const idx = queue.shift();
          if (idx !== undefined) await processJob(idx);
        }
      })());
    }

    await Promise.all(workers);

    // Done
    batchRunning = false;
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate All Variations';
    cancelBtn.classList.add('hidden');

    const successCount = results.filter(r => r?.success).length;
    progressText.textContent = batchCancelled
      ? `Cancelled. ${successCount} of ${jobs.length} completed.`
      : `Done. ${successCount} of ${jobs.length} succeeded.`;
  }

  function cancelBatch() {
    batchCancelled = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // COMPARE VERSIONS — "What changed?" between two prompts
  // ═══════════════════════════════════════════════════════════════════

  async function compareVersions() {
    if (currentVersions.length < 2) return;

    // Compare active version with the one after it (older, since sorted desc)
    const currentIdx = activeVersionIdx;
    const previousIdx = currentIdx + 1;

    if (previousIdx >= currentVersions.length) {
      // Active is the oldest version, compare with the one before it (newer)
      return;
    }

    const vCurrent = currentVersions[currentIdx];
    const vPrevious = currentVersions[previousIdx];

    if (!vCurrent?.prompt || !vPrevious?.prompt) {
      document.getElementById('compare-summary-body').textContent = 'One of these versions has no saved prompt.';
      document.getElementById('compare-summary').classList.remove('hidden');
      return;
    }

    const compareBtn = document.getElementById('compare-btn');
    const summaryEl = document.getElementById('compare-summary');
    const summaryBody = document.getElementById('compare-summary-body');
    const summaryTitle = document.getElementById('compare-summary-title');

    compareBtn.classList.add('loading');
    compareBtn.textContent = 'Comparing...';
    summaryBody.textContent = 'Asking Claude what changed...';
    summaryEl.classList.remove('hidden');

    const numCurrent = currentVersions.length - currentIdx;
    const numPrevious = currentVersions.length - previousIdx;
    summaryTitle.textContent = `v${numPrevious} → v${numCurrent}`;

    try {
      const config = await getConfig();
      const res = await fetch(`${config.supabaseUrl}/functions/v1/compare-prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({
          prompt_a: vPrevious.prompt,
          prompt_b: vCurrent.prompt,
          label_a: `v${numPrevious}`,
          label_b: `v${numCurrent}`
        })
      });

      const data = await safeJson(res);
      if (data?.summary) {
        summaryBody.textContent = data.summary;
      } else {
        summaryBody.textContent = data?.error || 'Could not compare these versions.';
      }
    } catch (err) {
      summaryBody.textContent = `Error: ${err.message}`;
    } finally {
      compareBtn.classList.remove('loading');
      compareBtn.textContent = 'What changed?';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BRAND GUIDELINES — load, save, extract from images
  // ═══════════════════════════════════════════════════════════════════

  async function loadBrandGuidelines() {
    try {
      const config = await getConfig();
      const data = await supabaseRest('/rest/v1/brand_guidelines?brand_name=eq.chefly&select=guidelines_text,sleeve_notes&limit=1');
      if (data && data.length > 0) {
        brandGuidelinesText = data[0].guidelines_text || '';
        brandSleeveNotes = data[0].sleeve_notes || '';
        const guideText = document.getElementById('brand-guide-text');
        const sleeveText = document.getElementById('brand-guide-sleeve');
        if (guideText) guideText.value = brandGuidelinesText;
        if (sleeveText) sleeveText.value = brandSleeveNotes;
      }
    } catch (err) {
      console.warn('Could not load brand guidelines:', err);
    }
  }

  async function saveBrandGuidelines() {
    const statusEl = document.getElementById('brand-guide-save-status');
    const guideText = document.getElementById('brand-guide-text');
    const sleeveText = document.getElementById('brand-guide-sleeve');
    brandGuidelinesText = guideText.value.trim();
    brandSleeveNotes = sleeveText.value.trim();

    try {
      statusEl.textContent = 'Saving...';
      const config = await getConfig();
      const res = await fetch(`${config.supabaseUrl}/rest/v1/brand_guidelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({
          brand_name: 'chefly',
          guidelines_text: brandGuidelinesText,
          sleeve_notes: brandSleeveNotes
        })
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      statusEl.textContent = 'Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  }

  function resizeImageToBase64(file, maxDim = 1568) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(url);
        resolve({ base64: dataUrl.split(',')[1], media_type: 'image/jpeg' });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback: read raw file
        const reader = new FileReader();
        reader.onloadend = () => resolve({ base64: reader.result.split(',')[1], media_type: file.type || 'image/jpeg' });
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  function handleBrandGuideImageUpload(files) {
    const previewsEl = document.getElementById('brand-guide-previews');
    const extractBtn = document.getElementById('brand-guide-extract-btn');

    Array.from(files).forEach(async (file) => {
      const id = 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const preview = URL.createObjectURL(file);

      const { base64, media_type } = await resizeImageToBase64(file);
      brandGuidelineImages.push({ id, file, base64, media_type, preview });
      renderBrandGuidePreviews();
      extractBtn.disabled = false;
    });
  }

  function renderBrandGuidePreviews() {
    const previewsEl = document.getElementById('brand-guide-previews');
    previewsEl.innerHTML = brandGuidelineImages.map(img => `
      <div class="brand-guide-preview" data-bg-id="${img.id}">
        <img src="${img.preview}" alt="Brand guide" />
        <button class="brand-guide-preview-remove" data-bg-id="${img.id}">✕</button>
      </div>
    `).join('');

    document.getElementById('brand-guide-extract-btn').disabled = brandGuidelineImages.length === 0;
  }

  async function extractBrandGuidelines() {
    if (brandGuidelineImages.length === 0) return;

    const extractBtn = document.getElementById('brand-guide-extract-btn');
    const statusEl = document.getElementById('brand-guide-extract-status');
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    statusEl.textContent = `Sending ${brandGuidelineImages.length} image${brandGuidelineImages.length !== 1 ? 's' : ''} to Claude Opus for brand analysis...`;

    try {
      const config = await getConfig();
      const images = brandGuidelineImages.map(img => ({ base64: img.base64, media_type: img.media_type }));

      const res = await fetch(`${config.supabaseUrl}/functions/v1/extract-brand-guidelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({ brand_name: 'chefly', images })
      });

      const data = await safeJson(res);
      if (!data || data.error) throw new Error(data?.error || 'Empty response');

      // Fill textareas with extracted guidelines
      brandGuidelinesText = data.guidelines_text || '';
      brandSleeveNotes = data.sleeve_notes || '';
      document.getElementById('brand-guide-text').value = brandGuidelinesText;
      document.getElementById('brand-guide-sleeve').value = brandSleeveNotes;

      statusEl.textContent = 'Extracted and saved! Guidelines will be used in all future generations.';
      // Clear uploaded images since they've been processed
      brandGuidelineImages = [];
      renderBrandGuidePreviews();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      extractBtn.disabled = brandGuidelineImages.length === 0;
      extractBtn.textContent = 'Extract with Claude Opus';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-GENERATE VARIABLES — Claude fills descriptions, headlines etc
  // from just the meal names
  // ═══════════════════════════════════════════════════════════════════

  async function autoGenerateVariables() {
    const mealTextarea = document.querySelector('.batch-list-textarea[data-placeholder="MEAL_NAME"]');
    const mealNames = mealTextarea.value.trim().split('\n').map(s => s.trim()).filter(Boolean);

    if (mealNames.length === 0) {
      document.getElementById('batch-autogen-status').textContent = 'Type at least one meal name first.';
      return;
    }

    const btn = document.getElementById('batch-autogen-btn');
    const statusEl = document.getElementById('batch-autogen-status');

    btn.disabled = true;
    btn.textContent = 'Generating...';

    // Collect reference images matched to meal names by label
    const refImages = [];
    for (let i = 0; i < mealNames.length; i++) {
      const name = mealNames[i].toLowerCase();
      // Match reference image by label
      const ref = referenceImages.find(r => {
        const labelInput = document.querySelector(`.ref-card-label[data-ref-id="${r.id}"]`);
        const label = labelInput ? labelInput.value.trim().toLowerCase() : (r.label || '').toLowerCase();
        return label && label === name;
      }) || (referenceImages.length === 1 ? referenceImages[0] : null);

      if (ref && ref.publicUrl) {
        try {
          statusEl.textContent = `Fetching reference image for "${mealNames[i]}"...`;
          const imgRes = await fetch(ref.publicUrl);
          const blob = await imgRes.blob();
          const base64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });
          refImages.push({ meal_index: i, base64, media_type: blob.type || 'image/jpeg' });
        } catch (e) {
          console.warn(`Could not fetch reference image for ${mealNames[i]}:`, e);
        }
      }
    }

    const imageNote = refImages.length > 0 ? ` (with ${refImages.length} reference photo${refImages.length !== 1 ? 's' : ''})` : '';
    statusEl.textContent = `Asking Claude to write variables for ${mealNames.length} meal${mealNames.length !== 1 ? 's' : ''}${imageNote}...`;

    try {
      const config = await getConfig();
      const res = await fetch(`${config.supabaseUrl}/functions/v1/generate-variables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`
        },
        body: JSON.stringify({
          meal_names: mealNames,
          original_placeholders: batchPlaceholders,
          reference_images: refImages.length > 0 ? refImages : undefined,
          brand_guidelines: brandGuidelinesText || undefined,
          sleeve_notes: brandSleeveNotes || undefined
        })
      });

      const data = await safeJson(res);
      if (!data?.variables?.meals) {
        throw new Error(data?.error || 'No variables returned');
      }

      const vars = data.variables;

      // Fill MEAL_DESCRIPTION textarea
      const descTextarea = document.querySelector('.batch-list-textarea[data-placeholder="MEAL_DESCRIPTION"]');
      if (descTextarea) {
        descTextarea.value = vars.meals.map(m => m.MEAL_DESCRIPTION).join('\n\n');
      }

      // Fill HEADLINE textarea (per-meal array + extras)
      const headlineTextarea = document.querySelector('.batch-list-textarea[data-placeholder="HEADLINE"]');
      if (headlineTextarea) {
        const allHeadlines = [
          ...vars.meals.flatMap(m => Array.isArray(m.HEADLINES) ? m.HEADLINES : (m.HEADLINE ? [m.HEADLINE] : [])),
          ...(vars.extra_headlines || [])
        ];
        headlineTextarea.value = [...new Set(allHeadlines)].join('\n');
      }

      // Fill BACKGROUND_MOOD textarea (per-meal + extras)
      const moodTextarea = document.querySelector('.batch-list-textarea[data-placeholder="BACKGROUND_MOOD"]');
      if (moodTextarea) {
        const allMoods = [
          ...vars.meals.map(m => m.BACKGROUND_MOOD),
          ...(vars.extra_moods || [])
        ];
        moodTextarea.value = [...new Set(allMoods)].join('\n');
      }

      // Fill CTA_TEXT textarea (per-meal array + extras)
      const ctaTextarea = document.querySelector('.batch-list-textarea[data-placeholder="CTA_TEXT"]');
      if (ctaTextarea) {
        const allCtas = [
          ...vars.meals.flatMap(m => Array.isArray(m.CTA_TEXTS) ? m.CTA_TEXTS : (m.CTA_TEXT ? [m.CTA_TEXT] : [])),
          ...(vars.extra_ctas || [])
        ];
        ctaTextarea.value = [...new Set(allCtas)].join('\n');
      }

      // Fill SLEEVE_STYLE textarea
      const sleeveTextarea = document.querySelector('.batch-list-textarea[data-placeholder="SLEEVE_STYLE"]');
      if (sleeveTextarea) {
        const allSleeves = vars.meals.map(m => m.SLEEVE_STYLE);
        sleeveTextarea.value = [...new Set(allSleeves)].join('\n');
      }

      updateBatchComboCount();
      statusEl.textContent = `Done. Generated variables for ${vars.meals.length} meals + bonus headlines and moods.`;

    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Auto-generate from meal names';
    }
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
    if (e.key === 'Escape') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        document.activeElement.blur();
        return;
      }
      closeModal();
    }
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

  // Compare versions
  document.getElementById('compare-btn').addEventListener('click', compareVersions);
  document.getElementById('compare-summary-close').addEventListener('click', () => {
    document.getElementById('compare-summary').classList.add('hidden');
  });

  // Batch Variations
  document.getElementById('modal-batch-btn').addEventListener('click', toggleBatch);
  document.getElementById('batch-templatize-btn').addEventListener('click', templatizePrompt);
  document.getElementById('batch-generate-btn').addEventListener('click', runBatch);
  document.getElementById('batch-cancel-btn').addEventListener('click', cancelBatch);
  document.getElementById('batch-autogen-btn').addEventListener('click', autoGenerateVariables);

  // Reference image upload
  const refDropzone = document.getElementById('ref-dropzone');
  const refFileInput = document.getElementById('ref-file-input');

  refDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    refDropzone.classList.add('dragover');
  });
  refDropzone.addEventListener('dragleave', () => {
    refDropzone.classList.remove('dragover');
  });
  refDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    refDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleRefFileUpload(e.dataTransfer.files);
  });
  refFileInput.addEventListener('change', () => {
    if (refFileInput.files.length) handleRefFileUpload(refFileInput.files);
    refFileInput.value = '';
  });

  // Delegate remove clicks on ref cards
  document.getElementById('ref-grid').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.ref-card-remove');
    if (removeBtn) removeReferenceImage(removeBtn.dataset.refId);
  });

  // Delegate label edits on ref cards
  document.getElementById('ref-grid').addEventListener('input', (e) => {
    if (e.target.classList.contains('ref-card-label')) {
      const refId = e.target.dataset.refId;
      const ref = referenceImages.find(r => r.id === refId);
      if (ref) ref.label = e.target.value.trim();
    }
  });

  // Batch ratio pills
  document.querySelectorAll('.batch-ratio-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.batch-ratio-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      batchSelectedRatio = pill.dataset.ratio;
      updateBatchComboCount();
    });
  });

  // Update combo count when lists change
  document.querySelectorAll('.batch-list-textarea').forEach(textarea => {
    textarea.addEventListener('input', updateBatchComboCount);
  });

  // Copy & other actions
  document.getElementById('copy-prompt-btn').addEventListener('click', copyPrompt);
  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd?.page_url) window.open(selectedAd.page_url, '_blank');
  });
  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Brand Guidelines listeners ────────────────────────────────────
  const brandDropzone = document.getElementById('brand-guide-dropzone');
  const brandFileInput = document.getElementById('brand-guide-file-input');

  brandDropzone.addEventListener('click', () => brandFileInput.click());
  brandDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    brandDropzone.classList.add('dragover');
  });
  brandDropzone.addEventListener('dragleave', () => {
    brandDropzone.classList.remove('dragover');
  });
  brandDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    brandDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleBrandGuideImageUpload(e.dataTransfer.files);
  });
  brandFileInput.addEventListener('change', () => {
    if (brandFileInput.files.length) handleBrandGuideImageUpload(brandFileInput.files);
    brandFileInput.value = '';
  });

  document.getElementById('brand-guide-extract-btn').addEventListener('click', extractBrandGuidelines);
  document.getElementById('brand-guide-save-btn').addEventListener('click', saveBrandGuidelines);

  // Delegate remove clicks on brand guide previews
  document.getElementById('brand-guide-previews').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.brand-guide-preview-remove');
    if (removeBtn) {
      const bgId = removeBtn.dataset.bgId;
      brandGuidelineImages = brandGuidelineImages.filter(img => img.id !== bgId);
      renderBrandGuidePreviews();
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
  loadBrandGuidelines();
})();