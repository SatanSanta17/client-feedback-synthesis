-- ============================================================================
-- Migration: Create prompt_versions table (TRD-005, Increment 2.1)
-- ============================================================================

-- Create the is_admin() helper function for RLS policies.
-- Uses SECURITY DEFINER to bypass RLS on the profiles table,
-- avoiding infinite recursion when used in other tables' policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Create prompt_versions table
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key TEXT NOT NULL CHECK (
    prompt_key IN ('signal_extraction', 'master_signal_cold_start', 'master_signal_incremental')
  ),
  content TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email TEXT NOT NULL DEFAULT 'system',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce: only one active version per prompt_key
CREATE UNIQUE INDEX prompt_versions_active_unique
  ON prompt_versions (prompt_key)
  WHERE is_active = true;

-- Index for fetching version history by prompt_key (newest first)
CREATE INDEX prompt_versions_key_created_idx
  ON prompt_versions (prompt_key, created_at DESC);

-- RLS
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active prompts (needed by AI service via anon client)
CREATE POLICY "Authenticated users can read active prompts"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can read all versions (history view)
CREATE POLICY "Admins can read all prompt versions"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admins can insert new versions
CREATE POLICY "Admins can insert prompt versions"
  ON prompt_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Admins can update (deactivate) existing versions
CREATE POLICY "Admins can update prompt versions"
  ON prompt_versions FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
