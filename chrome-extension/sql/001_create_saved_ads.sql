-- ============================================================
-- Creative Kitchen — Ad Capture Extension
-- Migration: Create saved_ads table
-- ============================================================

-- Table for ads captured from Facebook Ad Library
CREATE TABLE IF NOT EXISTS saved_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ad content
  advertiser_name text,
  ad_copy text,
  image_url text,
  video_url text,
  media_type text DEFAULT 'image' CHECK (media_type IN ('image', 'video')),

  -- Ad Library metadata
  library_id text,
  platform text DEFAULT 'facebook',
  started_running text,
  page_url text,
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Generated prompt (populated by Edge Function)
  generated_prompt text,
  prompt_generated_at timestamptz,
  prompt_model text,

  -- Generated comparison image (populated when user generates via Creative Kitchen)
  generated_image_url text,
  generation_notes text,

  -- Workspace scoping (matches existing pattern)
  workspace_id uuid REFERENCES workspaces(id),

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_saved_ads_workspace
  ON saved_ads(workspace_id);

CREATE INDEX IF NOT EXISTS idx_saved_ads_library_id
  ON saved_ads(library_id);

CREATE INDEX IF NOT EXISTS idx_saved_ads_advertiser
  ON saved_ads(advertiser_name);

CREATE INDEX IF NOT EXISTS idx_saved_ads_created_at
  ON saved_ads(created_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────
ALTER TABLE saved_ads ENABLE ROW LEVEL SECURITY;

-- For the extension (using anon key without auth), allow all operations
-- In production, you'd scope this to workspace_id via auth
-- For now, keep it simple — the extension uses the anon key

CREATE POLICY "Allow read saved_ads" ON saved_ads
  FOR SELECT USING (true);

CREATE POLICY "Allow insert saved_ads" ON saved_ads
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update saved_ads" ON saved_ads
  FOR UPDATE USING (true);

-- When you add auth to the extension later, replace with:
-- CREATE POLICY "Members can view saved_ads" ON saved_ads
--   FOR SELECT USING (
--     workspace_id IN (
--       SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
--     )
--   );

-- ─── Updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_saved_ads_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER saved_ads_updated_at
  BEFORE UPDATE ON saved_ads
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_ads_updated_at();

-- ─── Verification ─────────────────────────────────────────────────
-- Run this after migration to verify:
-- SELECT count(*) FROM saved_ads;
-- Should return 0 rows
