-- positioning_feedback: shared notes from named reviewers (Kaja / James / etc.)
-- on any positioning doc identified by doc_slug. One row per (doc, section, reviewer);
-- updates upsert in place so each reviewer always has a single current note per section.

CREATE TABLE IF NOT EXISTS public.positioning_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_slug    text        NOT NULL,
  section_id  text        NOT NULL,
  reviewer    text        NOT NULL,
  mood        text        CHECK (mood IS NULL OR mood IN ('love','ok','needs')),
  note        text,
  doc_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS positioning_feedback_doc_section_reviewer_idx
  ON public.positioning_feedback(doc_slug, section_id, reviewer);

CREATE INDEX IF NOT EXISTS positioning_feedback_doc_updated_idx
  ON public.positioning_feedback(doc_slug, updated_at DESC);

-- Auto-touch updated_at on any UPDATE
CREATE OR REPLACE FUNCTION public.touch_positioning_feedback_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positioning_feedback_touch_updated_at ON public.positioning_feedback;
CREATE TRIGGER positioning_feedback_touch_updated_at
  BEFORE UPDATE ON public.positioning_feedback
  FOR EACH ROW EXECUTE FUNCTION public.touch_positioning_feedback_updated_at();

ALTER TABLE public.positioning_feedback ENABLE ROW LEVEL SECURITY;

-- Anon + authenticated can do everything (internal collaborative doc).
DROP POLICY IF EXISTS "positioning_feedback_select" ON public.positioning_feedback;
CREATE POLICY "positioning_feedback_select"
  ON public.positioning_feedback FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "positioning_feedback_insert" ON public.positioning_feedback;
CREATE POLICY "positioning_feedback_insert"
  ON public.positioning_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "positioning_feedback_update" ON public.positioning_feedback;
CREATE POLICY "positioning_feedback_update"
  ON public.positioning_feedback FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "positioning_feedback_delete" ON public.positioning_feedback;
CREATE POLICY "positioning_feedback_delete"
  ON public.positioning_feedback FOR DELETE
  TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.positioning_feedback IS 'Shared, persisted feedback notes on positioning HTML docs. One row per (doc_slug, section_id, reviewer). Updates upsert in place. RLS allows anon + authenticated full access, internal collaborative doc.';
