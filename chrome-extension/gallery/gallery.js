// Creative Kitchen — Ad Comparison Gallery
// Shows saved ads with before/after comparison and generated prompts

(() => {
  'use strict';

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
  const modalGeneratedImage = document.getElementById('modal-generated-image');
  const modalNoGenerated = document.getElementById('modal-no-generated');
  const modalGeneratedNotes = document.getElementById('modal-generated-notes');
  const modalPrompt = document.getElementById('modal-prompt');
  const modalLibraryId = document.getElementById('modal-library-id');
  const modalPlatform = document.getElementById('modal-platform');
  const modalRunningDate = document.getElementById('modal-running-date');
  const modalStatus = document.getElementById('modal-status');

  // ─── Message helper ───────────────────────────────────────────────
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, resolve);
    });
  }

  // ─── Load ads ─────────────────────────────────────────────────────
  async function loadAds() {
    loading.classList.remove('hidden');
    gallery.classList.add('hidden');
    emptyState.classList.add('hidden');

    try {
      const res = await sendMessage({ type: 'FETCH_ADS' });

      if (res.success && res.ads) {
        allAds = res.ads;
        updateStats();
        renderGallery();
      } else {
        throw new Error(res.error || 'Failed to fetch ads');
      }
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
      case 'with-prompt':
        return allAds.filter(a => a.generated_prompt);
      case 'pending':
        return allAds.filter(a => !a.generated_prompt);
      case 'compared':
        return allAds.filter(a => a.generated_image_url);
      default:
        return allAds;
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

    // Attach click handlers
    gallery.querySelectorAll('.ad-card').forEach(card => {
      card.addEventListener('click', () => {
        const adId = card.dataset.adId;
        const ad = allAds.find(a => a.id === adId);
        if (ad) openModal(ad);
      });
    });
  }

  // ─── Open comparison modal ────────────────────────────────────────
  function openModal(ad) {
    selectedAd = ad;

    // Header
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

    // Prompt
    modalPrompt.textContent = ad.generated_prompt || 'No prompt generated yet. Click "Generate Prompt" to create one.';

    // Metadata
    modalLibraryId.textContent = ad.library_id || '—';
    modalPlatform.textContent = ad.platform || '—';
    modalRunningDate.textContent = ad.started_running || '—';
    modalStatus.textContent = ad.metadata?.status || '—';

    // Show modal
    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // ─── Close modal ──────────────────────────────────────────────────
  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    selectedAd = null;
  }

  // ─── Generate prompt for selected ad ──────────────────────────────
  async function generatePromptForAd() {
    if (!selectedAd) return;

    const btn = document.getElementById('modal-regenerate-btn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      const res = await sendMessage({
        type: 'GENERATE_PROMPT',
        ad: selectedAd
      });

      if (res.success && res.prompt) {
        // Update local state
        selectedAd.generated_prompt = res.prompt.prompt || res.prompt;
        const idx = allAds.findIndex(a => a.id === selectedAd.id);
        if (idx >= 0) allAds[idx] = selectedAd;

        // Update modal
        modalPrompt.textContent = selectedAd.generated_prompt;
        updateStats();
        renderGallery();
      } else {
        throw new Error(res.error || 'Generation failed');
      }
    } catch (err) {
      modalPrompt.textContent = `Error: ${err.message}`;
    } finally {
      btn.textContent = 'Regenerate Prompt';
      btn.disabled = false;
    }
  }

  // ─── Delete ad ────────────────────────────────────────────────────
  async function deleteSelectedAd() {
    if (!selectedAd) return;
    if (!confirm(`Delete this ${selectedAd.advertiser_name || ''} ad? This can't be undone.`)) return;

    const btn = document.getElementById('modal-delete-btn');
    btn.textContent = 'Deleting...';
    btn.disabled = true;

    try {
      const res = await sendMessage({
        type: 'DELETE_AD',
        adId: selectedAd.id
      });

      if (res.success) {
        allAds = allAds.filter(a => a.id !== selectedAd.id);
        closeModal();
        updateStats();
        renderGallery();
      } else {
        throw new Error(res.error || 'Delete failed');
      }
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
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
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

  // Modal actions
  document.getElementById('modal-regenerate-btn').addEventListener('click', generatePromptForAd);
  document.getElementById('modal-generate-btn')?.addEventListener('click', generatePromptForAd);
  document.getElementById('copy-prompt-btn').addEventListener('click', copyPrompt);
  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd?.page_url) {
      window.open(selectedAd.page_url, '_blank');
    }
  });
  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();
