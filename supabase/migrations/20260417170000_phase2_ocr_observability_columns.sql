-- Phase 2 (VAE) OCR per-shot observability.
-- Mirrors the transcript observability columns added in
-- 20260417141000_phase2_whisper_observability_columns.sql: adds per-phase
-- status/attempt/error tracking to video_analyses for the Claude vision
-- OCR pass, so the frontend retry loop has something to read and the UI
-- can surface partial failures (e.g. some shot batches timed out).
-- Keeps the existing ocr_text aggregate contract untouched.

ALTER TABLE public.video_analyses
  ADD COLUMN IF NOT EXISTS ocr_status text
    CHECK (ocr_status IS NULL OR ocr_status IN ('pending', 'running', 'partial', 'success', 'error')),
  ADD COLUMN IF NOT EXISTS ocr_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_error text,
  ADD COLUMN IF NOT EXISTS ocr_completed_at timestamptz;

-- Backfill existing rows so observability reads are consistent.
-- Any analysis with a populated ocr_text is considered success. Analyses
-- that have status='complete' but no ocr_text (e.g. no on-screen text
-- detected, or legacy rows) stay NULL so we can distinguish "done" from
-- "not yet attempted".
UPDATE public.video_analyses
SET ocr_status = 'success',
    ocr_attempts = 1,
    ocr_completed_at = COALESCE(updated_at, created_at)
WHERE ocr_text IS NOT NULL
  AND ocr_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_analyses_ocr_status
  ON public.video_analyses (ocr_status)
  WHERE ocr_status IS NOT NULL;

COMMENT ON COLUMN public.video_analyses.ocr_status IS
  'Per-phase status for Claude vision OCR. NULL = not yet attempted. Values: pending | running | partial | success | error.';
COMMENT ON COLUMN public.video_analyses.ocr_attempts IS
  'Count of OCR attempts (full invocations of ocr-video-frames) for this analysis. Not batch-level.';
COMMENT ON COLUMN public.video_analyses.ocr_error IS
  'Last error message from ocr-video-frames. NULL on success. Includes upstream Claude/Anthropic errors.';
COMMENT ON COLUMN public.video_analyses.ocr_completed_at IS
  'Timestamp of the last terminal OCR outcome (success, partial, or error after max retries).';
