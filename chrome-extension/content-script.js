// Creative Kitchen — Ad Library Content Script
// Injects "Save to Creative Kitchen" buttons on Facebook Ad Library ad cards

(() => {
  'use strict';

  const ICON_SAVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const ICON_SPINNER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ck-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

  // ─── Toast notification ─────────────────────────────────────────
  let toastTimeout;
  function showToast(title, body, type = 'success') {
    let toast = document.querySelector('.ck-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'ck-toast';
      document.body.appendChild(toast);
    }
    toast.className = `ck-toast ck-toast-${type}`;
    toast.innerHTML = `
      <div class="ck-toast-title">${title}</div>
      ${body ? `<div class="ck-toast-body">${body}</div>` : ''}
    `;
    clearTimeout(toastTimeout);
    requestAnimationFrame(() => {
      toast.classList.add('ck-toast-visible');
    });
    toastTimeout = setTimeout(() => {
      toast.classList.remove('ck-toast-visible');
    }, 4000);
  }

  // ─── Extract ad data from a card element ────────────────────────
  function extractAdData(cardEl) {
    const data = {};
    const allText = cardEl.innerText || '';

    // Library ID
    const libraryMatch = allText.match(/Library ID:\s*(\d+)/);
    data.libraryId = libraryMatch ? libraryMatch[1] : null;

    // Advertiser name — from the Facebook page link (e.g. facebook.com/drinkAG1/)
    // These links contain the brand name as their text content
    const pageLinks = cardEl.querySelectorAll('a[href*="facebook.com/"]');
    let advertiserName = '';
    pageLinks.forEach(link => {
      const name = link.innerText?.trim();
      const href = link.href || '';
      // Skip Ad Library links, external links — we want the Page link
      if (name && name.length > 1 && name.length < 80
          && !href.includes('/ads/library')
          && !href.includes('l.facebook.com')
          && !name.includes('See ad details')
          && !name.includes('See summary details')) {
        advertiserName = name;
      }
    });
    data.advertiserName = advertiserName;

    // Ad copy — Facebook puts the ad text in spans and role="button" divs
    // The copy appears after "Sponsored" label. Look for long spans first,
    // then fall back to role="button" elements with substantial text.
    const candidates = [
      ...cardEl.querySelectorAll('span'),
      ...cardEl.querySelectorAll('[role="button"]'),
      ...cardEl.querySelectorAll('button')
    ];
    let longestCopy = '';
    candidates.forEach(el => {
      const text = el.innerText?.trim();
      if (text && text.length > 40 && text.length > longestCopy.length
          && !text.includes('Library ID')
          && !text.includes('Started running')
          && !text.includes('See ad details')
          && !text.includes('See summary details')
          && !text.includes('Play video')
          && !text.includes('Menu')
          && !text.includes('Platforms')
          && !text.includes('multiple versions')
          && !text.includes('use this creative')) {
        longestCopy = text;
      }
    });
    data.adCopy = longestCopy;

    // Image URL — profile pics are 60x60 with alt="Brand Name"
    // Actual ad images are larger (600+) with empty alt=""
    const imgs = cardEl.querySelectorAll('img');
    let bestImg = null;
    let bestArea = 0;
    imgs.forEach(img => {
      const w = img.naturalWidth || img.offsetWidth || 0;
      const h = img.naturalHeight || img.offsetHeight || 0;
      const area = w * h;
      // Skip profile pics (small, have alt text matching brand name)
      // and tiny icons. Real ad images are 600x600+ with empty alt
      const isProfilePic = (w <= 60 && h <= 60) || (img.alt && img.alt === advertiserName);
      if (!isProfilePic && area > bestArea && w > 80) {
        bestArea = area;
        bestImg = img.src;
      }
    });
    // If no large image found, try getting any image that isn't the profile pic
    if (!bestImg) {
      imgs.forEach(img => {
        const w = img.offsetWidth || 0;
        if (w > 100 && !bestImg) {
          bestImg = img.src;
        }
      });
    }
    data.imageUrl = bestImg;

    // Video URL — check for video elements
    const video = cardEl.querySelector('video');
    data.videoUrl = video?.src || null;

    // Platform — the platform icons are presentation divs, not easily readable
    // Default to facebook since we're on Facebook Ad Library
    data.platform = 'facebook';

    // Started running date
    const dateMatch = allText.match(/Started running on\s+(.+?)(?:\n|$)/);
    data.startedRunning = dateMatch ? dateMatch[1].trim() : null;

    // Current page URL
    data.pageUrl = window.location.href;

    // Status + metadata
    data.metadata = {
      status: allText.includes('Active') ? 'Active' : allText.includes('Inactive') ? 'Inactive' : 'Unknown',
      capturedAt: new Date().toISOString(),
      hasMultipleVersions: allText.includes('multiple versions')
    };

    return data;
  }

  // ─── Find all ad card containers ────────────────────────────────
  function findAdCards() {
    // Facebook Ad Library renders ads in distinct card containers
    // These typically have a "Library ID" and "See ad details" link
    const allDivs = document.querySelectorAll('div');
    const cards = [];

    allDivs.forEach(div => {
      const text = div.innerText || '';
      // A card must have a Library ID and either "See ad details" or "See summary details"
      const hasDetails = text.includes('See ad details') || text.includes('See summary details');
      if (
        text.includes('Library ID:') &&
        hasDetails &&
        div.offsetHeight > 200 &&
        div.offsetWidth > 250 &&
        !div.querySelector('.ck-save-btn') // don't double-inject
      ) {
        // Only one Library ID = this is a single card (not a parent container)
        if (text.split('Library ID:').length === 2) {
          cards.push(div);
        }
      }
    });

    return cards;
  }

  // ─── Inject save buttons ────────────────────────────────────────
  function injectButtons() {
    const cards = findAdCards();

    cards.forEach(card => {
      if (card.querySelector('.ck-save-btn')) return; // already injected

      const btn = document.createElement('button');
      btn.className = 'ck-save-btn';
      btn.innerHTML = `${ICON_SAVE} Save to Creative Kitchen`;

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Set saving state
        btn.className = 'ck-save-btn ck-saving';
        btn.innerHTML = `${ICON_SPINNER} Saving...`;

        try {
          const adData = extractAdData(card);

          if (!adData.imageUrl && !adData.videoUrl) {
            throw new Error('No image or video found in this ad');
          }

          const response = await chrome.runtime.sendMessage({
            type: 'SAVE_AD',
            data: adData
          });

          if (response.success) {
            btn.className = 'ck-save-btn ck-saved';
            btn.innerHTML = `${ICON_CHECK} Saved`;

            let toastBody = 'Ad saved to your collection.';
            if (response.prompt) {
              toastBody = 'Ad saved + prompt generated!';
            } else if (response.promptError) {
              toastBody = `Ad saved. Prompt will generate when Edge Function is deployed.`;
            }
            showToast('Creative Kitchen', toastBody, 'success');
          } else {
            throw new Error(response.error || 'Save failed');
          }
        } catch (err) {
          btn.className = 'ck-save-btn ck-error';
          btn.innerHTML = `${ICON_SAVE} Failed — Retry`;
          showToast('Save Failed', err.message, 'error');

          // Reset after 3 seconds
          setTimeout(() => {
            btn.className = 'ck-save-btn';
            btn.innerHTML = `${ICON_SAVE} Save to Creative Kitchen`;
          }, 3000);
        }
      });

      // Insert button — try to place it near "See ad/summary details"
      const seeDetails = Array.from(card.querySelectorAll('a, div[role="button"], button')).find(
        el => el.innerText?.includes('See ad details') || el.innerText?.includes('See summary details')
      );

      if (seeDetails && seeDetails.parentElement) {
        seeDetails.parentElement.insertBefore(btn, seeDetails);
      } else {
        // Fallback: append to card
        card.appendChild(btn);
      }
    });
  }

  // ─── CSS animation for spinner ──────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ck-spin {
      to { transform: rotate(360deg); }
    }
    .ck-spin {
      animation: ck-spin 0.8s linear infinite;
    }
  `;
  document.head.appendChild(style);

  // ─── Run on page load and observe for new ads (infinite scroll) ─
  function init() {
    injectButtons();

    // Observe DOM changes for infinite scroll / filter changes
    const observer = new MutationObserver(() => {
      // Debounce
      clearTimeout(observer._timeout);
      observer._timeout = setTimeout(injectButtons, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to let Facebook's JS render the ad cards
    setTimeout(init, 1500);
  }
})();
