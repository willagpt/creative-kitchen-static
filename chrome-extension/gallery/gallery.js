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

  // Batch refs
  const batchSection = document.getElementById('batch-section');
  const batchBtn = document.getElementById('modal-batch-btn');
  const batchTemplatizeBtn = document.getElementById('batch-templatize-btn');
  const batchTemplate = document.getElementById('batch-template');
  const batchTemplateStatus = document.getElementById('batch-template-status');
  const refUploadArea = document.getElementById('ref-upload-area');
  const refDropzone = document.getElementById('ref-dropzone');
  const refFileInput = document.getElementById('ref-file-input');
  const refGrid = document.getElementById('ref-grid');
  const batchListsGrid = document.getElementById('batch-lists-grid');
  const batchStepTemplate = document.getElementById('batch-step-template');
  const batchStepRefs = document.getElementById('batch-step-refs');
  const batchStepLists = document.getElementById('batch-step-lists');
  const batchStepGenerate = document.getElementById('batch-step-generate');
  const batchComboCount = document.getElementById('batch-combo-count');
  const batchGenerateBtn = document.getElementById('batch-generate-btn');
  const batchCancelBtn = document.getElementById('batch-cancel-btn');
  const batchProgress = document.getElementById('batch-progress');
  const batchProgressFill = document.getElementById('batch-progress-fill');
  const batchProgressText = document.getElementById('batch-progress-text');
  const batchResults = document.getElementById('batch-results');
  const batchResultsGrid = document.getElementById('batch-results-grid');

  // Filter handlers
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGallery();
    });
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
  });

  // Refresh ads
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⟳ Loading...';
    try {
      await loadAds();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Refresh';
    }
  });

  // Batch button toggle
  batchBtn.addEventListener('click', () => {
    batchSection.classList.toggle('hidden');
    batchBtn.classList.toggle('active');
    if (!batchSection.classList.contains('hidden')) {
      resetBatchForm();
    }
  });

  // Reference image upload handlers
  setupRefImageUpload();

  // Templatize button
  batchTemplatizeBtn.addEventListener('click', async () => {
    if (!selectedAd) return;
    const prompt = modalPrompt.value.trim();
    if (!prompt) {
      batchTemplateStatus.textContent = 'Please generate a prompt first';
      return;
    }

    try {
      batchTemplateStatus.textContent = 'Creating template...';
      const template = await generatePromptTemplate(prompt);
      batchTemplate.value = template;
      batchTemplate.classList.remove('hidden');
      batchTemplateStatus.textContent = 'Template created!';
      batchStepRefs.classList.remove('hidden');
      setTimeout(() => {
        batchTemplateStatus.textContent = '';
      }, 2000);
    } catch (err) {
      batchTemplateStatus.textContent = 'Error: ' + err.message;
    }
  });

  // Variable list handlers
  setupBatchVariableLists();

  // Generate batch
  batchGenerateBtn.addEventListener('click', async () => {
    if (!batchTemplate.value || referenceImages.length === 0) {
      alert('Please create a template and upload reference images');
      return;
    }

    const ratio = document.querySelector('.batch-ratio-pill.active').dataset.ratio;
    await generateBatchVariations(ratio);
  });

  batchCancelBtn.addEventListener('click', () => {
    batchCancelled = true;
  });

  // Modal buttons
  document.getElementById('modal-regenerate-btn').addEventListener('click', async () => {
    if (!selectedAd) return;
    await generateNewPrompt(selectedAd);
  });

  document.getElementById('modal-generate-image-btn').addEventListener('click', async () => {
    if (!selectedAd) return;
    const prompt = modalPrompt.value.trim();
    if (!prompt) {
      alert('Please generate or enter a prompt first');
      return;
    }
    await generateImageFromPrompt(selectedAd, prompt);
  });

  document.getElementById('copy-prompt-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(modalPrompt.value);
  });

  document.getElementById('refine-btn').addEventListener('click', async () => {
    if (!selectedAd) return;
    const feedback = document.getElementById('feedback-input').value.trim();
    if (!feedback) {
      alert('Please enter refinement feedback');
      return;
    }
    await refineImage(selectedAd, feedback);
  });

  document.getElementById('modal-open-ad-btn').addEventListener('click', () => {
    if (selectedAd && selectedAd.library_id) {
      window.open(`https://www.facebook.com/ads/library/?ad_type=all&id=${selectedAd.library_id}`, '_blank');
    }
  });

  document.getElementById('modal-delete-btn').addEventListener('click', deleteSelectedAd);

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();