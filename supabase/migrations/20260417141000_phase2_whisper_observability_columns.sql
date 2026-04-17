-- Phase 2 (VAE) Whisper transcription observability.
-- Adds per-phase status/attempt/error tracking to video_analyses so the
-- frontend retry loop has something to read and the UI can show partial
-- failures. Keeps the existing transcript_text contract untouched.

ALTER TABLE public.video_analyses
  ADD COLUMN IF NOT EXISTS transcript_status text
    CHECK (transcript_status IS NULL OR transcript_status IN ('pending', 'running', 'partial', 'success', 'error')),
  ADD COLUMN IF NOT EXISTS transcript_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_completed_at timestamptz;

-- Backfill existing rows so observability reads are consistent:
-- any complete analysis with a populated transcript_text is considered success.
UPDATE public.video_analyses
SET transcript_status = 'success',
    transcript_attempts = 1,
    transcript_completed_at = COALESCE(updated_at, created_at)
WHERE transcript_text IS NOT NULL
  AND transcript_status IS NULL;

-- Analyses that errored overall but never got to the transcribe phase stay NULL.

CREATE INDEX IF NOT EXISTS idx_video_analyses_transcript_status
  ON public.video_analyses (transcript_status)
  WHERE transcript_status IS NOT NULL;

COMMENT ON COLUMN public.video_analyses.transcript_status IS
  'Per-phase status for Whisper transcription. NULL = not yet attempted. Values: pending | running | partial | success | error.';
COMMENT ON COLUMN public.video_analyses.transcript_attempts IS
  'Count of Whisper transcription attempts (including retries) for this analysis.';
COMMENT ON COLUMN public.video_analyses.transcript_error IS
  'Last error message from transcribe-video. NULL on success. Includes upstream OpenAI errors.';
COMMENT ON COLUMN public.video_analyses.transcript_completed_at IS
  'Timestamp of the last terminal transcribe outcome (success, partial, or error after max retries).';
