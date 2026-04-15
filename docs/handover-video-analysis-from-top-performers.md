# Handover: Video Analysis from Top Performers

**Date:** 15 April 2026
**Status:** Ready to build
**Priority:** Next feature
**Asana project:** Creative Kitchen — Engineering Stabilisation

---

## What was completed this session

Split-screen and tri-screen layout detection shipped end-to-end:

- `ai-analyse-video` v2 deployed — classifies each shot as `full`/`split-2`/`split-3`/`other` via Claude vision, writes `screen_layout` per shot + `layout_summary` aggregate
- `generate-ugc-brief` v6 deployed — layout-aware prompts for split-screen framing
- Frontend updated — `formatLayoutSummary()` helper, Layout StatItem in detail stats, purple shot badges, card meta layout info
- `shareableExport.js` updated — layout metrics row + per-shot layout badges in export
- DB migration applied — `screen_layout` column on `video_shots`, `layout_summary` JSONB on `video_analyses`
- Re-ran sample analysis (Simmer 8-shot video) — detected 5 full + 3 split-2 correctly
- Vercel deployment verified clean
- Commits: `be16336c`, `a0fdcedd`, `0c03b674`, `f92883a4`, `c3f393d9`, `9ac1704`

---

## Feature request

James wants to start video analysis directly from the **Top Performers** tab in the Competitor Ads section. Currently, the only way to analyse a video is by manually entering a competitor ad ID in the Video Analysis tab. The workflow should let him browse top-performing ads, identify the best video ads, and kick off analysis without leaving the screen.

Key requirements from conversation:
- Trigger analysis on individual video ads from the results
- Bulk-select multiple videos (e.g. top 5) and process them together
- Works for both "top one" and "top five" scenarios

---

## Current architecture (what exists)

### CompetitorAds.jsx (111KB, main component)

This single file handles both **Library** and **Top Performers** views. Key state:

| State | Purpose |
|-------|---------|
| `topAds` | All loaded ads from selected brands |
| `topFiltered` | Ranked + filtered results shown in grid |
| `topPercentile` | Cutoff threshold (default 2.5%) |
| `topSortBy` | Sort: `velocity` / `impressions` / `days` |
| `topTypeFilter` | Filter: `all` / `video` / `image` |
| `selectedTopBrands` | Set of brand pageIds to analyse |

### Top Performers ranking flow

1. User selects brands in sidebar, clicks Analyse
2. `loadTopPerformers()` fetches all ads for each brand via `fetchAllAds(pageId)`
3. Ads mapped via `mapDbAd()` (from `competitor/utils.js`) — sets `isVideo`, `displayFormat`, `velocity`, etc.
4. Ranking: top X% of each brand independently, then combined and re-sorted by chosen metric
5. `topTypeFilter` can filter to video-only or image-only

### Existing AI analysis button

There's already an "Analyse top creatives with AI" button pinned above the grid, but it **explicitly excludes videos**:

```javascript
// Only image ads sent to the analysis pipeline
!a.isVideo && a.hasMedia
```

This feeds into `process-analysis-batch` (image vision pipeline), NOT the video analysis pipeline.

### Video ad identification

```javascript
// From mapDbAd() in competitor/utils.js
if (displayFormat === 'VIDEO') isVideo = true
else if (displayFormat === 'IMAGE') isVideo = false
else if (displayFormat === 'DCO') isVideo = isVideoUrl(mediaUrl) || !!videoUrl
else isVideo = isVideoUrl(mediaUrl) // checks .mp4, .mov, .webm
```

Each mapped ad has: `adId` (the competitor_ads.id), `isVideo`, `videoUrl`, `mediaUrl`, `displayFormat`.

### Video analysis pipeline (existing)

The `analyse-video` edge function accepts `{ competitor_ad_id }` and orchestrates:
1. Railway worker: downloads video, FFmpeg scene detection, frame extraction, contact sheet
2. `ai-analyse-video`: Claude analyses contact sheet + script, writes `ai_analysis` JSONB + layout detection
3. Results in `video_analyses` + `video_shots` tables

Currently triggered only from the Video Analysis tab's manual form.

### Card rendering

Cards in Top Performers show: brand tag, format badge (`image` / `▶ video` / `DCO`), velocity metric, days active, status. Actions: click to open modal, "Add to library" (images only), carousel arrows (multi-variant).

No "Analyse" action exists on individual cards.

---

## Decisions needed

These are the design choices to make at the start of the next session:

### 1. Entry point UX

**Option A (recommended): Per-card button + bulk toolbar**
- Each video card gets an "Analyse" icon/button (only on `isVideo` cards)
- Checkboxes for multi-select with a floating "Analyse N Videos" toolbar
- Mirrors existing "Add to library" pattern

**Option B: Bulk-only toolbar**
- Checkboxes + floating action bar, no per-card button
- Forces intentional batch selection

**Option C: "Analyse Top N" auto-button**
- Single button: "Analyse Top 5 Videos" that auto-picks highest-ranking videos
- Most automated, least flexible

### 2. Post-trigger UX

**Option A (recommended): Toast + stay on page**
- Fire-and-forget: call `analyse-video` for each selected ad
- Toast notification: "3 videos queued for analysis"
- User checks Video Analysis tab later for results
- Simplest, no new UI needed

**Option B: Redirect to Video Analysis**
- Navigate to Video Analysis tab after triggering
- Shows progress immediately but interrupts browsing

**Option C: Inline progress on cards**
- Spinner on card while processing, "View Analysis" link when done
- Most seamless but most complex (polling, state management)

### 3. Scope

**Option A (recommended): Single + bulk (up to 5)**
- Per-card button + checkboxes for batch up to 5
- Covers both "analyse this one" and "analyse the top 5" flows

**Option B: Single only**
- Just per-card button, add bulk later

---

## Implementation plan (once decisions made)

### Phase 1: Per-card "Analyse" button

**File:** `src/components/CompetitorAds.jsx`

1. In `renderAdCard()`, add an "Analyse" button visible only when `ad.isVideo && ad.hasMedia`:
   ```jsx
   {ad.isVideo && ad.hasMedia && (
     <button className="ca-card-analyse-btn" onClick={(e) => { e.stopPropagation(); handleAnalyseVideo(ad); }}>
       Analyse Video
     </button>
   )}
   ```

2. Add `handleAnalyseVideo(ad)` function:
   - Calls `POST /functions/v1/analyse-video` with `{ competitor_ad_id: ad.adId }`
   - Shows toast/banner on success
   - Tracks which ads are being analysed (Set in state) to show loading state on card

3. Add state: `analysingAdIds` (Set) to track in-flight analyses

### Phase 2: Bulk selection

1. Add `selectedVideoIds` state (Set) for checkbox tracking
2. Add checkbox UI to video cards (only when `topTypeFilter === 'video'` or when at least one video visible)
3. Add floating action toolbar when `selectedVideoIds.size > 0`:
   ```
   ┌─────────────────────────────────────────┐
   │  3 videos selected   [Analyse All]  [✕] │
   └─────────────────────────────────────────┘
   ```
4. `handleBulkAnalyse()` — iterates selected IDs, calls analyse-video for each, shows toast with count

### Phase 3: Deduplication guard

1. Before calling analyse-video, check if `video_analyses` already has a record for this `competitor_ad_id`:
   ```
   GET /rest/v1/video_analyses?competitor_ad_id=eq.{id}&select=id,status
   ```
2. If exists and `status === 'complete'`, show option: "Already analysed — View Results / Re-analyse"
3. If exists and `status === 'processing'`, show: "Analysis in progress"

### CSS additions

```css
.ca-card-analyse-btn { /* purple accent, matches existing add-to-lib style */ }
.ca-bulk-toolbar { /* fixed bottom bar, animated slide-up */ }
.ca-card-checkbox { /* top-left corner checkbox overlay */ }
.ca-card-analysing { /* pulsing border or spinner overlay */ }
```

---

## Files to modify

| File | Changes |
|------|---------|
| `src/components/CompetitorAds.jsx` | Add analyse button to `renderAdCard()`, add `handleAnalyseVideo()`, add bulk selection state + toolbar, add dedup check |
| `src/components/CompetitorAds.css` (or inline styles in JSX) | New styles for analyse button, bulk toolbar, checkbox, loading state |
| `.claude/CLAUDE.md` | Update with new feature description |

No backend changes needed — the existing `analyse-video` edge function already accepts `competitor_ad_id` and handles the full pipeline.

---

## Edge cases to handle

- **Non-video ads:** "Analyse" button must not appear on image or DCO-image cards
- **Missing video URL:** Some VIDEO-format ads may have broken/missing `video_url` — the analyse-video function already handles this (returns error)
- **Rate limiting:** Bulk-analysing 5 videos fires 5 parallel calls to the Railway worker — may need sequential processing or a queue. Current Railway deployment handles one video at a time. Consider `Promise.allSettled` with a concurrency limit of 2.
- **Already analysed:** Prevent accidental re-analysis of videos that already have results
- **Credit/cost awareness:** Each analysis calls Claude API (costs ~$0.05-0.15 per video depending on contact sheet size). Bulk of 5 = ~$0.50. No hard limit needed but worth a confirmation modal for bulk.

---

## Test plan

1. Select Simmer in brands, click Analyse to load Top Performers
2. Filter to video-only (`topTypeFilter = 'video'`)
3. Verify "Analyse" button appears on video cards, not image cards
4. Click Analyse on a single video card — toast appears, Video Analysis tab shows new entry
5. Select 3 videos via checkboxes — bulk toolbar appears with count
6. Click "Analyse All" — toast shows "3 videos queued", all appear in Video Analysis
7. Try analysing an already-analysed video — dedup prompt appears
8. Verify layout detection runs on all newly analysed videos (layout_summary populated)

---

## Dependencies

- Railway video worker must be running (currently deployed and healthy)
- `analyse-video` edge function active (currently deployed)
- `ai-analyse-video` v2 active (deployed this session with layout detection)
- Supabase service role key configured in edge function env

---

## Session context for next AI session

- **Repo:** github.com/willagpt/creative-kitchen-static (main branch)
- **Main file:** `src/components/CompetitorAds.jsx` (111KB — very large, read in chunks)
- **Supporting files:** `src/components/competitor/utils.js`, `api.js`, `config.js`
- **Edge function to call:** `analyse-video` (not ai-analyse-video — the orchestrator)
- **The `ad.adId` field maps to `competitor_ads.id`** — this is what analyse-video expects as `competitor_ad_id`
- **Push via GitHub MCP** — local src/ may be empty, code lives on GitHub
- **Use engineering skill** at every step (per James's standing instruction)
