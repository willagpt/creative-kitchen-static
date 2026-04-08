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
  const modalCompareBefore = document.getElementById('compare-before');
  const modalCompareAfter = document.getElementById('compare-after');
  const batchSection = document.getElementById('batch-section');
  const batchTemplateInput = document.getElementById('batch-template-input');
  const batchPlaceholdersContainer = document.getElementById('batch-placeholders');
  const batchRatioSelect = document.getElementById('batch-ratio-select');
  const batchReferenceImages = document.getElementById('batch-reference-images');
  const batchUploadZone = document.getElementById('batch-upload-zone');
  const batchGenerateBtn = document.getElementById('batch-generate-btn');
  const batchCancelBtn = document.getElementById('batch-cancel-btn');
  const batchStatus = document.getElementById('batch-status');
  const batchProgressBar = document.getElementById('batch-progress');
  const batchProgressText = document.getElementById('batch-progress-text');
  const batchOutputContainer = document.getElementById('batch-output-container');
  const batchOutputGrid = document.getElementById('batch-output-grid');

  // ─── Init hooks ────────────────────────────────────────────────────
  const openModalBtn = document.getElementById('open-modal-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const genBtn = document.getElementById('gen-btn');
  const refineBtn = document.getElementById('refine-btn');
  const downloadBtn = document.getElementById('download-btn');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const aspectRatioSelect = document.getElementById('aspect-ratio-select');
  const promptInput = document.getElementById('prompt-input');

  // ─── Refs to sub-elements ──────────────────────────────────────────
  const uploadInput = document.getElementById('reference-upload-input');
  const refImageCardTemplate = document.getElementById('ref-image-card-template');

  // ─── Supabase ──────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://bpxqfxdaxazqwdiqklqj.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweHFmeGRheGF6cXdkaXFrbHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU3Nzg2NzMsImV4cCI6MjAyMTM1NDY3M30.NaAcT2dP9KXEQz6IDVQU8aBrMxQz_8vwfLx7H9rU9yY';

  // ─── Load ADs from localstorage ────────────────────────────────────
  function loadAds() {
    const adData = localStorage.getItem('cheflyAds');
    if (adData) {
      try {
        allAds = JSON.parse(adData);
        renderGallery();
        updateStats();
      } catch (e) {
        console.error('Failed to parse ad data:', e);
        emptyState.style.display = 'block';
      }
    } else {
      emptyState.style.display = 'block';
    }
  }

  // ─── Render gallery grid ───────────────────────────────────────────
  function renderGallery() {
    gallery.innerHTML = '';
    
    const filtered = allAds.filter(ad => {
      if (currentFilter === 'all') return true;
      return ad.category === currentFilter;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    filtered.forEach(ad => {
      const card = document.createElement('div');
      card.className = 'ad-card';
      card.innerHTML = `
        <img src="${ad.image || 'placeholder.png'}" alt="${ad.name}" />
        <div class="ad-info">
          <h3>${ad.name}</h3>
          <p class="category">${ad.category}</p>
        </div>
      `;
      card.addEventListener('click', () => openModal(ad));
      gallery.appendChild(card);
    });
  }

  // ─── Open comparison modal ─────────────────────────────────────────
  function openModal(ad) {
    selectedAd = ad;
    modalBrand.textContent = ad.name || 'Unknown';
    modalDate.textContent = new Date(ad.date).toLocaleDateString() || 'N/A';
    modalOriginalImg.src = ad.image || 'placeholder.png';
    modalOriginalCopy.textContent = ad.copy || 'No copy available';
    
    currentVersions = ad.versions || [];
    renderVersions();
    
    modalOverlay.style.display = 'flex';
  }

  function renderVersions() {
    if (currentVersions.length === 0) {
      modalNoGenerated.style.display = 'block';
      modalGeneratedImg.style.display = 'none';
      return;
    }

    const latest = currentVersions[currentVersions.length - 1];
    modalGeneratedImg.src = latest.image || 'placeholder.png';
    modalGeneratedNotes.textContent = latest.notes || '';
    modalNoGenerated.style.display = 'none';
    modalGeneratedImg.style.display = 'block';
  }

  function closeModal() {
    modalOverlay.style.display = 'none';
    selectedAd = null;
    currentVersions = [];
  }

  // ─── Generate image from prompt ────────────────────────────────────
  async function generateImage() {
    if (!selectedAd) return;

    const prompt = promptInput.value.trim();
    if (!prompt) {
      alert('Please enter a prompt');
      return;
    }

    loading.style.display = 'flex';
    genBtn.disabled = true;

    try {
      const response = await fetch('https://api.falai.com/v1/image/generation', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${localStorage.getItem('falApiKey')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_name: FAL_MODEL,
          prompt: prompt,
          image_size: {
            width: 1024,
            height: 1024
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Generation failed: ${response.statusText}`);
      }

      const result = await response.json();
      const imageUrl = result.images[0]?.url;

      if (imageUrl) {
        const version = {
          image: imageUrl,
          prompt: prompt,
          notes: '',
          timestamp: new Date().toISOString()
        };

        selectedAd.versions = selectedAd.versions || [];
        selectedAd.versions.push(version);
        currentVersions = selectedAd.versions;

        localStorage.setItem('cheflyAds', JSON.stringify(allAds));
        renderVersions();
        promptInput.value = '';
      }
    } catch (e) {
      console.error('Generation error:', e);
      alert('Failed to generate image');
    } finally {
      loading.style.display = 'none';
      genBtn.disabled = false;
    }
  }

  // ─── Refine image ──────────────────────────────────────────────────
  async function refineImage() {
    if (!selectedAd || currentVersions.length === 0) return;

    const notes = modalGeneratedNotes.value || '';
    const latest = currentVersions[currentVersions.length - 1];
    
    // In a real refinement, you'd send the notes to an API
    // For now, just update the notes
    latest.notes = notes;
    localStorage.setItem('cheflyAds', JSON.stringify(allAds));
    alert('Notes saved');
  }

  // ─── Download version ──────────────────────────────────────────────
  async function downloadVersion() {
    if (!currentVersions.length) return;
    
    const latest = currentVersions[currentVersions.length - 1];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${selectedAd.name}-${Date.now()}.png`;
      link.click();
    };
    img.src = latest.image;
  }

  // ─── Batch variations ──────────────────────────────────────────────
  function setupBatchUI() {
    // Template input
    batchTemplateInput.addEventListener('input', (e) => {
      batchTemplate = e.target.value;
      updateBatchPlaceholders();
    });

    // Ratio selector
    batchRatioSelect.addEventListener('change', (e) => {
      batchSelectedRatio = e.target.value;
    });

    // Reference image upload
    batchUploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      batchUploadZone.classList.add('dragover');
    });

    batchUploadZone.addEventListener('dragleave', () => {
      batchUploadZone.classList.remove('dragover');
    });

    batchUploadZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      batchUploadZone.classList.remove('dragover');
      
      const files = e.dataTransfer.files;
      for (let file of files) {
        await addReferenceImage(file);
      }
    });

    uploadInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      for (let file of files) {
        await addReferenceImage(file);
      }
    });

    // Generate batch
    batchGenerateBtn.addEventListener('click', generateBatchVariations);

    // Cancel batch
    batchCancelBtn.addEventListener('click', () => {
      batchCancelled = true;
    });
  }

  function updateBatchPlaceholders() {
    const placeholders = batchTemplate.match(/\{(\w+)\}/g) || [];
    batchPlaceholders = {};
    placeholders.forEach(p => {
      const key = p.slice(1, -1);
      batchPlaceholders[key] = '';
    });

    batchPlaceholdersContainer.innerHTML = '';
    Object.keys(batchPlaceholders).forEach(key => {
      const row = document.createElement('div');
      row.className = 'placeholder-row';
      row.innerHTML = `
        <label>${key}:</label>
        <textarea placeholder="Enter ${key} values (one per line)"></textarea>
      `;
      
      const textarea = row.querySelector('textarea');
      textarea.addEventListener('input', (e) => {
        batchPlaceholders[key] = e.target.value.split('\n').filter(v => v.trim());
      });

      batchPlaceholdersContainer.appendChild(row);
    });
  }

  async function addReferenceImage(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      const id = Date.now().toString();
      
      const refImage = {
        id,
        name: file.name,
        label: file.name.replace(/\.[^.]+$/, ''),
        publicUrl: base64,
        filePath: `reference-images/${id}-${file.name}`
      };

      referenceImages.push(refImage);
      renderReferenceImageCard(refImage);
    };
    reader.readAsDataURL(file);
  }

  function renderReferenceImageCard(refImage) {
    const card = document.createElement('div');
    card.className = 'ref-image-card';
    card.innerHTML = `
      <img src="${refImage.publicUrl}" alt="${refImage.label}" />
      <p>${refImage.label}</p>
      <button class="remove-ref" data-id="${refImage.id}">Remove</button>
    `;

    card.querySelector('.remove-ref').addEventListener('click', () => {
      referenceImages = referenceImages.filter(r => r.id !== refImage.id);
      card.remove();
    });

    batchReferenceImages.appendChild(card);
  }

  async function generateBatchVariations() {
    if (!batchTemplate) {
      alert('Please enter a template');
      return;
    }

    const totalValues = Object.values(batchPlaceholders).reduce((sum, arr) => Math.max(sum, arr.length), 0);
    if (totalValues === 0) {
      alert('Please add variable values');
      return;
    }

    batchRunning = true;
    batchCancelled = false;
    batchGenerateBtn.disabled = true;
    batchStatus.style.display = 'block';
    batchOutputContainer.style.display = 'block';
    batchOutputGrid.innerHTML = '';

    for (let i = 0; i < totalValues; i++) {
      if (batchCancelled) break;

      // Build prompt
      let prompt = batchTemplate;
      Object.entries(batchPlaceholders).forEach(([key, values]) => {
        const value = values[i % values.length] || values[0];
        prompt = prompt.replace(`{${key}}`, value);
      });

      // Generate image
      try {
        batchProgressText.textContent = `Generating ${i + 1} of ${totalValues}...`;
        batchProgressBar.style.width = `${(i / totalValues) * 100}%`;

        const response = await fetch('https://api.falai.com/v1/image/generation', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${localStorage.getItem('falApiKey')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model_name: FAL_MODEL,
            prompt: prompt,
            image_size: {
              width: batchSelectedRatio === '1:1' ? 1024 : 1280,
              height: batchSelectedRatio === '1:1' ? 1024 : 1024
            }
          })
        });

        if (response.ok) {
          const result = await response.json();
          const imageUrl = result.images[0]?.url;

          if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = prompt;
            img.title = prompt;
            batchOutputGrid.appendChild(img);
          }
        }
      } catch (e) {
        console.error(`Generation ${i + 1} failed:`, e);
      }
    }

    batchRunning = false;
    batchGenerateBtn.disabled = false;
    batchProgressText.textContent = 'Complete';
    batchProgressBar.style.width = '100%';
  }

  // ─── Filter ads ────────────────────────────────────────────────────
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter || 'all';
      renderGallery();
    });
  });

  // ─── Aspect ratio ──────────────────────────────────────────────────
  aspectRatioSelect.addEventListener('change', (e) => {
    selectedAspectRatio = e.target.value;
  });

  // ─── Modal event listeners ─────────────────────────────────────────
  openModalBtn.addEventListener('click', () => {
    if (gallery.children.length > 0) {
      openModal(allAds[0]);
    }
  });

  closeModalBtn.addEventListener('click', closeModal);
  genBtn.addEventListener('click', generateImage);
  refineBtn.addEventListener('click', refineImage);
  downloadBtn.addEventListener('click', downloadVersion);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  refreshBtn.addEventListener('click', () => {
    loadAds();
  });

  // ─── Init ─────────────────────────────────────────────────────────
  loadAds();
})();