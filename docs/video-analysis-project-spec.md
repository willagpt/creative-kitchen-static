# Video Analysis Engine — Project Specification

## 1. What We're Building

A video analysis pipeline for Creative Kitchen Static that:
- Selects top N% of competitor videos by `days_active` (1%, 2%, 5%, 10%, 20%)
- Extracts the full script (audio transcription via Whisper + on-screen text via OCR)
- Extracts all shots with reference frames
- Generates a contact sheet (visual grid of all shots)
- Computes edit metrics: shot count, duration, total cuts, avg shot duration, cuts/sec, pacing profile
- Runs AI analysis on script + shot list + metrics
- Compares video analysis against static image analysis for the same brand

## 2. Data Landscape

### Source: `competitor_ads` table
- ~9,900 rows of enriched competitor ads
- Key filters: `display_format IN ('VIDEO', 'DCO')` and `video_url IS NOT NULL`
- Ranking metric: `days_active` (higher = more successful)
- Brands tracked via `followed_brands` table

### Test Videos
| ID | Brand | Duration | Shots | Resolution |
|----|-------|----------|-------|-----------|
| 3324195914449903 | Simmer | 12.7s | 8 | 720x900 |
| 33860239276954284 | Huel | 21.4s | 17 | 720x1280 |
| 1440540640941645 | Frive | 31.4s | 17 | 720x1280 |

## 3. Architecture

### New Database Tables
1. **`video_analyses`** — Primary record for each video analysis
2. **`video_shots`** — Individual shot records (FK → video_analyses)
3. **`video_analysis_runs`** — Batch analysis runs

### New Storage Bucket
- **`video-processing`** — Stores frames, contact sheets, audio files

### Processing Architecture
- **Railway microservice** (`video-worker/`) — Express + FFmpeg for heavy processing
- **Supabase Edge Functions** — Orchestration, querying, AI analysis

### New Edge Functions
1. **`analyse-video`** — Orchestrator: creates DB record → calls Railway worker → stores results
2. **`list-video-analyses`** — Query analyses with filters (status, run_id, competitor_ad_id)
3. **`get-video-analysis`** — Get single analysis with shots joined
4. **`transcribe-video`** — (Phase 2) Audio → Whisper API transcription
5. **`ocr-video-frames`** — (Phase 2) Frame OCR via Claude Vision
6. **`analyse-video-content`** — (Phase 3) AI analysis of script + shots + metrics
7. **`start-video-analysis-run`** — (Phase 5) Batch: select top N% videos → queue analyses
8. **`get-video-analysis-run`** — (Phase 5) Get batch run status and results

## 4. UI Design

### Per-Video (Phase 4)
- "Analyse" button on competitor ad cards (video only)
- Script panel (transcript + on-screen text)
- Filmstrip view (horizontal scrollable shots)
- Contact sheet viewer (full grid)
- Metrics card (shot count, duration, pacing, cuts/sec)
- AI analysis panel

### Dashboard (Phase 5)
- Brand selector + percentile picker
- Batch analysis trigger
- Summary stats across all analysed videos
- Sort/filter by metrics

### Cross-Format (Phase 6)
- Side-by-side video vs static analysis
- Pattern comparison (what works in video vs static)

## 5. Phased Delivery

### Phase 1: Foundation ✅
- [x] Database tables + RLS policies
- [x] Storage bucket
- [x] Processing approach evaluation
- [x] Video worker (shot detection, frame extraction, audio extraction, contact sheet)
- [x] Edge functions: analyse-video, list-video-analyses, get-video-analysis

### Phase 2: Script Extraction
- [ ] Whisper API integration for audio transcription
- [ ] Claude Vision OCR for on-screen text
- [ ] Combined script assembly

### Phase 3: AI Analysis
- [ ] Claude analysis of script + shots + metrics
- [ ] Structured output (hooks, CTAs, pacing insights, recommendations)

### Phase 4: UI — Single Video
- [ ] Analyse button on competitor ad cards
- [ ] Analysis results view (script, filmstrip, metrics, AI insights)

### Phase 5: Batch + Dashboard
- [ ] Top N% selection logic
- [ ] Batch processing with progress tracking
- [ ] Dashboard with summary stats

### Phase 6: Cross-Format Comparison
- [ ] Video vs static analysis comparison
- [ ] Pattern extraction across formats

## 6. Testing Protocol

Every phase must be tested end-to-end before marking complete:
1. **curl verification** — Hit edge functions directly
2. **SQL verification** — Query DB to confirm data written correctly
3. **Log verification** — Check Supabase logs for errors

## 7. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Facebook video URLs expire | Videos can't be downloaded | Cache video on first access |
| FFmpeg OOM on long videos | Worker crashes | Set max duration (60s), memory limits on Railway |
| Whisper API costs | Budget overrun | Batch processing with configurable limits |
| Contact sheet fails for many shots | Missing visual output | Row-by-row approach (implemented) |

## 8. Session Handoff Checklist

- [ ] Update CLAUDE.md with any architecture changes
- [ ] Push all code to GitHub (source of truth)
- [ ] Update Asana tasks with evidence
- [ ] Note any untested changes
