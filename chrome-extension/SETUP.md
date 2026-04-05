# Creative Kitchen — Ad Capture Chrome Extension

## What This Does

A Chrome extension that adds "Save to Creative Kitchen" buttons to every ad on the Facebook Ad Library. When you save an ad, it:

1. Captures the ad image, copy, metadata, and Library ID
2. Saves it to a `saved_ads` table in your Supabase database
3. Sends the ad data to a Supabase Edge Function that calls Claude to generate an image prompt
4. Displays everything in a comparison gallery (original ad vs. your AI-generated version)

## Setup (3 Steps)

### Step 1: Run the Database Migration

Run the SQL in `sql/001_create_saved_ads.sql` on your Supabase project (`ifrxylvoufncdxyltgqt`).

You can do this via:
- Supabase Dashboard → SQL Editor → paste and run
- Or via CLI: `supabase db push`

### Step 2: Deploy the Edge Function

```bash
# From the project root
cd supabase-edge-function

# Set your Claude API key as a secret
supabase secrets set CLAUDE_API_KEY=sk-ant-xxxxx

# Deploy the function
supabase functions deploy generate-ad-prompt
```

The Edge Function uses `claude-sonnet-4-20250514` to reverse-engineer ads into image generation prompts. Your Claude API key stays server-side — it never touches the browser.

### Step 3: Load the Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder
5. Click the extension icon → enter your Supabase URL and anon key → Save
6. Click **Test Connection** to verify

## Usage

1. Go to [Facebook Ad Library](https://www.facebook.com/ads/library)
2. Search for any brand (e.g., "AG1 by Athletic Greens")
3. You'll see an orange **Save to Creative Kitchen** button on each ad card
4. Click it — the ad is saved and a prompt is generated automatically
5. Open the gallery (via extension popup → "Open Gallery") to see all captured ads
6. Click any ad to see the full comparison view with the generated prompt

## File Structure

```
chrome-extension/
├── manifest.json              # Extension config (Manifest V3)
├── background.js              # Service worker (Supabase + Claude comms)
├── content-script.js          # Injects save buttons on Ad Library
├── popup.html / popup.js      # Settings popup (Supabase config)
├── gallery/
│   ├── gallery.html           # Comparison gallery page
│   ├── gallery.css            # Dark theme styles
│   └── gallery.js             # Gallery logic
├── styles/
│   └── content.css            # Injected button + toast styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── sql/
│   └── 001_create_saved_ads.sql   # Database migration
└── supabase-edge-function/
    └── generate-ad-prompt.ts      # Claude prompt generation
```

## Architecture

```
Facebook Ad Library (browser)
       │
       ▼
Content Script → injects "Save" buttons
       │
       ▼ (on click)
Background Service Worker
       │
       ├── POST /rest/v1/saved_ads → Supabase (saves ad data)
       │
       └── POST /functions/v1/generate-ad-prompt → Edge Function
              │
              └── Claude API (Sonnet) → generates prompt
                     │
                     └── Updates saved_ads row with prompt
```

## Gallery Features

- Grid view of all captured ads with status badges (Pending / Prompt Ready / Compared)
- Filter by status
- Click to open comparison modal:
  - Original ad (left) vs. AI-generated version (right)
  - Generated prompt in monospace view with copy button
  - Ad metadata (Library ID, platform, run date, status)
  - Regenerate prompt button
- Stats bar (total ads, prompts generated, comparisons, brands tracked)

## Next Steps

- Connect the generated prompts to your fal.ai image generation pipeline
- Add the gallery as a page within Creative Kitchen Static (`#/ad-library`)
- Add workspace scoping once the main app has auth
- Add "Generate Image" button that sends the prompt to fal.ai and saves the result back to `generated_image_url`
