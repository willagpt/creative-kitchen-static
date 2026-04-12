(function() {
  // State
  let ads = [];
  let batches = [];
  let brandGuidelines = null;
  let isLoadingAds = false;
  let lastFilteredResults = [];

  // DOM References
  const adGalleryContainer = document.getElementById('ad-gallery');
  const galleryViewToggle = document.getElementById('gallery-view-toggle');
  const batchesViewToggle = document.getElementById('batches-view-toggle');
  const filterInput = document.getElementById('filter-input');
  const viewToggleButtons = document.querySelectorAll('[data-view-toggle]');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const versionHistoryModal = document.getElementById('version-history-modal');
  const versionHistoryTable = document.getElementById('version-history-table');
  const brandGuidelinesModal = document.getElementById('brand-guidelines-modal');
  const brandGuidelinesImage = document.getElementById('brand-guidelines-image');
  const brandGuidelinesText = document.getElementById('brand-guidelines-text');
  const uploadBrandGuidelinesBtn = document.getElementById('upload-brand-guidelines');
  const brandGuidelinesUploadInput = document.getElementById('brand-guidelines-upload-input');

  const SUPABASE_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmcnh5bHZvdWZuY2R4eWx0Z3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzkwNDgsImV4cCI6MjA4OTQxNTA0OH0.ZsyGK_jdxjTrO3Ji8zgoyHz6VxW5hR36JWr1sgmmAFA';
  const EDGE_FUNCTION_URL = 'https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1';

  function getConfig() {
    const storedConfig = localStorage.getItem('creativeKitchenConfig');
    return storedConfig ? JSON.parse(storedConfig) : {};
  }

  function saveConfig(config) {
    localStorage.setItem('creativeKitchenConfig', JSON.stringify(config));
  }

  async function supabaseRequest(method, table, options = {}) {
    const config = getConfig();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    if (options.select) url += `?select=${encodeURIComponent(options.select)}`;
    if (options.eq) {
      const eqParams = Object.entries(options.eq)
        .map(([key, value]) => `${key}=eq.${encodeURIComponent(value)}`)
        .join('&');
      url += url.includes('?') ? `&${eqParams}` : `?${eqParams}`;
    }
    if (options.filter) {
      url += url.includes('?') ? `&${options.filter}` : `?${options.filter}`;
    }
    if (options.order) {
      url += url.includes('?') ? `&order=${options.order}` : `?order=${options.order}`;
    }

    const fetchOptions = {
      method,
      headers,
    };
    if (options.body) fetchOptions.body = JSON.stringify(options.body);

    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`Supabase request failed: ${response.statusText}`);
    return response.json();
  }

  async function loadAds() {
    isLoadingAds = true;
    const config = getConfig();
    try {
      ads = await supabaseRequest('GET', 'static_images', {
        select: '*',
        order: 'created_at.desc',
      });
      console.log('Loaded ads:', ads);
    } catch (error) {
      console.error('Failed to load ads:', error);
    } finally {
      isLoadingAds = false;
    }
  }

  async function filterAds(searchTerm) {
    if (!searchTerm) {
      lastFilteredResults = ads;
    } else {
      const term = searchTerm.toLowerCase();
      lastFilteredResults = ads.filter(ad => 
        (ad.prompt && ad.prompt.toLowerCase().includes(term)) ||
        (ad.template_name && ad.template_name.toLowerCase().includes(term)) ||
        (ad.category && ad.category.toLowerCase().includes(term))
      );
    }
    renderGallery();
  }

  function renderGallery() {
    adGalleryContainer.innerHTML = '';
    const displayAds = lastFilteredResults.length > 0 ? lastFilteredResults : ads;
    
    displayAds.forEach(ad => {
      const adElement = document.createElement('div');
      adElement.className = 'ad-item';
      adElement.innerHTML = `
        <img src="${ad.image_url}" alt="${ad.template_name}" class="ad-thumbnail">
        <div class="ad-info">
          <h4>${ad.template_name}</h4>
          <p class="ad-category">${ad.category}</p>
          <p class="ad-version">v${ad.version}</p>
          <button class="view-details-btn" data-ad-id="${ad.id}">View Details</button>
          <button class="version-history-btn" data-ad-id="${ad.id}">Version History</button>
        </div>
      `;
      adGalleryContainer.appendChild(adElement);
    });
  }

  function openModal(modal) {
    modal.classList.add('open');
    modalBackdrop.classList.add('open');
  }

  function closeModal(modal) {
    modal.classList.remove('open');
    modalBackdrop.classList.remove('open');
  }

  async function loadVersionHistory(adId) {
    try {
      const versions = await supabaseRequest('GET', 'static_prompt_versions', {
        eq: { template_id: adId },
        order: 'version.desc',
      });
      
      versionHistoryTable.innerHTML = '';
      versions.forEach(version => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>v${version.version}</td>
          <td><textarea readonly>${version.prompt}</textarea></td>
          <td><img src="${version.image_url}" alt="v${version.version}" class="version-thumbnail"></td>
          <td><button class="preview-btn" data-image-url="${version.image_url}">Preview</button></td>
        `;
        versionHistoryTable.appendChild(row);
      });
      
      openModal(versionHistoryModal);
    } catch (error) {
      console.error('Failed to load version history:', error);
    }
  }

  async function regeneratePrompt(templateId) {
    const config = getConfig();
    const ad = ads.find(a => a.id === templateId);
    
    if (!ad) {
      console.error('Ad not found');
      return;
    }

    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/generate-ad-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          template_id: templateId,
          template_name: ad.template_name,
          brand_dna: config.brandDNA || {},
          category: ad.category,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate prompt');
      const result = await response.json();
      
      ad.prompt = result.prompt;
      renderGallery();
    } catch (error) {
      console.error('Prompt regeneration failed:', error);
    }
  }

  async function refineAndRegenerate(templateId, feedback) {
    const config = getConfig();
    const ad = ads.find(a => a.id === templateId);
    
    if (!ad) {
      console.error('Ad not found');
      return;
    }

    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/refine-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          template_id: templateId,
          current_prompt: ad.prompt,
          feedback: feedback,
          brand_dna: config.brandDNA || {},
        }),
      });

      if (!response.ok) throw new Error('Failed to refine prompt');
      const result = await response.json();
      
      ad.prompt = result.prompt;
      renderGallery();
    } catch (error) {
      console.error('Prompt refinement failed:', error);
    }
  }

  async function generateImage(templateId) {
    const ad = ads.find(a => a.id === templateId);
    
    if (!ad || !ad.prompt) {
      console.error('Ad or prompt not found');
      return;
    }

    const button = document.querySelector(`button[data-generate-image="${templateId}"]`);
    button.disabled = true;
    button.textContent = 'Generating...';

    try {
      const fal = await import('https://cdn.jsdelivr.net/npm/@fal-ai/serverless-client/dist/index.js');
      
      fal.default.config({
        credentials: 'sk-fal-123456789', // Placeholder - actual key should be in backend
      });

      const aspectRatio = ad.aspect_ratio || '1:1';
      const [width, height] = aspectRatio.split(':').map(Number);
      const size = width > height ? 'landscape' : height > width ? 'portrait' : 'square';

      const result = await fal.default.run('fal-ai/nano-banana-2', {
        input: {
          prompt: ad.prompt,
          image_size: size,
          num_inference_steps: 4,
        },
      });

      ad.image_url = result.images[0].url;
      ad.version = (ad.version || 0) + 1;

      await supabaseRequest('POST', 'static_prompt_versions', {
        body: {
          template_id: templateId,
          version: ad.version,
          prompt: ad.prompt,
          image_url: ad.image_url,
          brand_dna_snapshot: getConfig().brandDNA || {},
        },
      });

      renderGallery();
    } catch (error) {
      console.error('Image generation failed:', error);
      button.textContent = 'Generate Image';
      button.disabled = false;
    }
  }

  async function uploadReferenceImage(file, templateId) {
    const config = getConfig();
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/reference-images/${templateId}/${file.name}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: file,
      });

      if (!response.ok) throw new Error('Failed to upload reference image');
      
      const data = await response.json();
      console.log('Reference image uploaded:', data);
    } catch (error) {
      console.error('Reference image upload failed:', error);
    }
  }

  async function templatizeBatch(batchName, mealNames) {
    const config = getConfig();
    const newBatch = {
      id: Date.now(),
      name: batchName,
      items: mealNames.map(meal => ({
        id: Date.now() + Math.random(),
        meal: meal,
        variables: {},
      })),
      status: 'pending',
    };

    batches.push(newBatch);
    console.log('Batch created:', newBatch);
    return newBatch;
  }

  async function generateBatchImages(batchId) {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) {
      console.error('Batch not found');
      return;
    }

    batch.status = 'processing';
    const concurrentLimit = 2;
    let processed = 0;

    for (let i = 0; i < batch.items.length; i += concurrentLimit) {
      const chunk = batch.items.slice(i, i + concurrentLimit);
      await Promise.all(chunk.map(async (item) => {
        // Generate image for each item
        // Use fal.ai or other image generation service
        processed++;
        batch.progress = (processed / batch.items.length) * 100;
      }));
    }

    batch.status = 'completed';
    console.log('Batch generation completed');
  }

  async function createBatchJob(jobData) {
    try {
      await supabaseRequest('POST', 'static_runs', {
        body: jobData,
      });
      console.log('Batch job created');
    } catch (error) {
      console.error('Failed to create batch job:', error);
    }
  }

  async function compareVersions(adId) {
    try {
      const versions = await supabaseRequest('GET', 'static_prompt_versions', {
        eq: { template_id: adId },
        order: 'version.desc',
      });

      if (versions.length < 2) {
        alert('Need at least 2 versions to compare');
        return;
      }

      const v1 = versions[0];
      const v2 = versions[1];

      const response = await fetch(`${EDGE_FUNCTION_URL}/compare-prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          prompt_1: v1.prompt,
          prompt_2: v2.prompt,
        }),
      });

      if (!response.ok) throw new Error('Failed to compare prompts');
      const comparison = await response.json();
      
      alert(`Changes:\n${comparison.summary}`);
    } catch (error) {
      console.error('Version comparison failed:', error);
    }
  }

  async function extractBrandGuidelines(imageFile) {
    const formData = new FormData();
    formData.append('file', imageFile);

    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/extract-brand-guidelines`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to extract brand guidelines');
      const guidelines = await response.json();
      
      brandGuidelines = guidelines;
      const config = getConfig();
      config.brandDNA = guidelines;
      saveConfig(config);

      console.log('Brand guidelines extracted:', guidelines);
    } catch (error) {
      console.error('Brand guidelines extraction failed:', error);
    }
  }

  async function autoGenerateVariables(mealName) {
    const config = getConfig();
    
    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/generate-variables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          meal_name: mealName,
          brand_dna: config.brandDNA || {},
        }),
      });

      if (!response.ok) throw new Error('Failed to generate variables');
      const variables = await response.json();
      
      return variables;
    } catch (error) {
      console.error('Variable generation failed:', error);
      return {};
    }
  }

  async function matchReferenceImages(templateId) {
    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/match-reference-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          template_id: templateId,
        }),
      });

      if (!response.ok) throw new Error('Failed to match reference images');
      const matches = await response.json();
      
      return matches;
    } catch (error) {
      console.error('Reference image matching failed:', error);
      return [];
    }
  }

  async function generatePerField(templateId, field, value) {
    const config = getConfig();
    const ad = ads.find(a => a.id === templateId);
    
    if (!ad) {
      console.error('Ad not found');
      return;
    }

    try {
      const response = await fetch(`${EDGE_FUNCTION_URL}/generate-field`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          template_id: templateId,
          field: field,
          value: value,
          brand_dna: config.brandDNA || {},
        }),
      });

      if (!response.ok) throw new Error('Failed to generate field');
      const result = await response.json();
      
      return result;
    } catch (error) {
      console.error('Field generation failed:', error);
      return null;
    }
  }

  // Event Listeners
  filterInput?.addEventListener('input', (e) => {
    filterAds(e.target.value);
  });

  viewToggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.target.dataset.viewToggle;
      document.querySelectorAll('[data-view]').forEach(el => {
        el.classList.remove('active');
      });
      document.querySelector(`[data-view="${view}"]`).classList.add('active');
    });
  });

  adGalleryContainer?.addEventListener('click', (e) => {
    if (e.target.classList.contains('version-history-btn')) {
      const adId = e.target.dataset.adId;
      loadVersionHistory(adId);
    }
    if (e.target.classList.contains('preview-btn')) {
      const imageUrl = e.target.dataset.imageUrl;
      alert(`Preview: ${imageUrl}`);
    }
    if (e.target.classList.contains('view-details-btn')) {
      const adId = e.target.dataset.adId;
      const ad = ads.find(a => a.id === adId);
      alert(`Template: ${ad.template_name}\nPrompt: ${ad.prompt}`);
    }
    if (e.target.classList.contains('regenerate-prompt-btn')) {
      const adId = e.target.dataset.adId;
      regeneratePrompt(adId);
    }
    if (e.target.classList.contains('generate-image-btn')) {
      const adId = e.target.dataset.adId;
      generateImage(adId);
    }
    if (e.target.classList.contains('refine-prompt-btn')) {
      const adId = e.target.dataset.adId;
      const feedback = prompt('Enter feedback:');
      if (feedback) {
        refineAndRegenerate(adId, feedback);
      }
    }
  });

  modalBackdrop?.addEventListener('click', () => {
    closeModal(versionHistoryModal);
    closeModal(brandGuidelinesModal);
  });

  uploadBrandGuidelinesBtn?.addEventListener('click', () => {
    brandGuidelinesUploadInput.click();
  });

  brandGuidelinesUploadInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await extractBrandGuidelines(file);
      brandGuidelinesImage.src = URL.createObjectURL(file);
      brandGuidelinesText.textContent = JSON.stringify(brandGuidelines, null, 2);
      openModal(brandGuidelinesModal);
    }
  });

  // Initialize
  loadAds();
  renderGallery();
})();
