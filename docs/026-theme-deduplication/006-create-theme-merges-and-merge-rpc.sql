-- ============================================================
-- PRD-026 Part 3: Theme merge audit log + atomic merge RPC.
-- Increment 3.1 — schema + function only. The repository, service,
-- API routes, and UI ship in subsequent increments.
--
-- Idempotent — every object guarded with IF NOT EXISTS / OR REPLACE so
-- re-applying against an already-migrated environment is safe.
-- ============================================================

-- ------------------------------------------------------------
-- theme_merges (audit log)
-- ------------------------------------------------------------
--
-- Snapshot row written by merge_themes() on every successful merge.
-- Read by the "Recent merges" admin surface (PRD-026 Part 3 P3.R7) and,
-- in Part 4, the source of `theme.merged` notification payloads.
--
-- Decision 24 (TRD): theme ids are NOT foreign keys. The merge spec
-- archives (not deletes) the theme row, but the audit log must survive
-- any future hard-delete of either side. Names are snapshotted at merge
-- time so renames don't rewrite history.

CREATE TABLE IF NOT EXISTS theme_merges (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  archived_theme_id        UUID NOT NULL,
  canonical_theme_id       UUID NOT NULL,
  archived_theme_name      TEXT NOT NULL,
  canonical_theme_name     TEXT NOT NULL,

  actor_id                 UUID NOT NULL REFERENCES auth.users(id),
  reassigned_count         INTEGER NOT NULL,
  distinct_sessions        INTEGER NOT NULL,
  distinct_clients         INTEGER NOT NULL,

  merged_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recent-merges read pattern: workspace-scoped, ordered by merged_at DESC.
CREATE INDEX IF NOT EXISTS theme_merges_team_merged_at_idx
  ON theme_merges (team_id, merged_at DESC)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS theme_merges_personal_merged_at_idx
  ON theme_merges (initiated_by, merged_at DESC)
  WHERE team_id IS NULL;

ALTER TABLE theme_merges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team members read team merges" ON theme_merges;
CREATE POLICY "team members read team merges"
  ON theme_merges FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

DROP POLICY IF EXISTS "users read own personal merges" ON theme_merges;
CREATE POLICY "users read own personal merges"
  ON theme_merges FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());

-- INSERTs go through merge_themes() under SECURITY DEFINER; no INSERT
-- policy is intentionally needed for the authenticated role.

-- ------------------------------------------------------------
-- merge_themes — atomic merge function (TRD Decision 22)
-- ------------------------------------------------------------
--
-- Single Postgres transaction. Validates → captures stats → re-points
-- signal_themes with conflict-aware delete-then-update (Decision 23) →
-- archives + sets pointer → cleans up stale candidates/dismissals
-- (Decision 25) → writes the audit row → returns the merge result.
--
-- Errors raise PostgreSQL SQLSTATEs the repository translates into typed
-- error classes:
--   '22023' — validation (same theme / archived already / cross-workspace)
--   'P0002' — theme not found
--
-- Concurrent-merge race protection: both theme rows are locked FOR UPDATE
-- before any write, so a second concurrent merge of an overlapping pair
-- blocks until the first commits and then re-reads is_archived = true.

CREATE OR REPLACE FUNCTION merge_themes(
  archived_theme_id  UUID,
  canonical_theme_id UUID,
  acting_user_id     UUID
)
RETURNS TABLE (
  audit_id              UUID,
  reassigned_count      INTEGER,
  distinct_sessions     INTEGER,
  distinct_clients      INTEGER,
  archived_theme_name   TEXT,
  canonical_theme_name  TEXT,
  team_id               UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived            themes%ROWTYPE;
  v_canonical           themes%ROWTYPE;
  v_count               INTEGER;
  v_distinct_sessions   INTEGER;
  v_distinct_clients    INTEGER;
  v_audit_id            UUID;
BEGIN
  -- Lock both theme rows up-front (concurrency guard).
  SELECT * INTO v_archived
    FROM themes WHERE id = archived_theme_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'archived theme not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_canonical
    FROM themes WHERE id = canonical_theme_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical theme not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_archived.id = v_canonical.id THEN
    RAISE EXCEPTION 'cannot merge a theme into itself' USING ERRCODE = '22023';
  END IF;

  IF v_archived.is_archived OR v_canonical.is_archived THEN
    RAISE EXCEPTION 'cannot merge an already-archived theme' USING ERRCODE = '22023';
  END IF;

  -- Workspace-scope check (team or personal).
  IF v_archived.team_id IS DISTINCT FROM v_canonical.team_id THEN
    RAISE EXCEPTION 'themes belong to different workspaces' USING ERRCODE = '22023';
  END IF;
  IF v_archived.team_id IS NULL
     AND v_archived.initiated_by IS DISTINCT FROM v_canonical.initiated_by THEN
    RAISE EXCEPTION 'personal-workspace themes belong to different users'
      USING ERRCODE = '22023';
  END IF;

  -- Capture pre-merge stats (snapshotted on the audit row, Decision 24).
  SELECT
    COUNT(*),
    COUNT(DISTINCT se.session_id),
    COUNT(DISTINCT (se.metadata->>'client_name'))
  INTO v_count, v_distinct_sessions, v_distinct_clients
  FROM signal_themes st
  INNER JOIN session_embeddings se ON st.embedding_id = se.id
  WHERE st.theme_id = archived_theme_id;

  -- Re-point signal_themes (Decision 23: delete-then-update so the
  -- (embedding_id, theme_id) unique index never fires).
  DELETE FROM signal_themes
   WHERE theme_id = archived_theme_id
     AND embedding_id IN (
       SELECT embedding_id FROM signal_themes
        WHERE theme_id = canonical_theme_id
     );

  UPDATE signal_themes
     SET theme_id = canonical_theme_id
   WHERE theme_id = archived_theme_id;

  -- Archive + pointer (P3.R4).
  UPDATE themes
     SET is_archived = true,
         merged_into_theme_id = canonical_theme_id,
         updated_at = now()
   WHERE id = archived_theme_id;

  -- Cleanup stale candidates / dismissals (Decision 25).
  DELETE FROM theme_merge_candidates
   WHERE theme_a_id IN (archived_theme_id, canonical_theme_id)
      OR theme_b_id IN (archived_theme_id, canonical_theme_id);

  DELETE FROM theme_merge_dismissals
   WHERE theme_a_id IN (archived_theme_id, canonical_theme_id)
      OR theme_b_id IN (archived_theme_id, canonical_theme_id);

  -- Audit row.
  INSERT INTO theme_merges (
    team_id, initiated_by,
    archived_theme_id, canonical_theme_id,
    archived_theme_name, canonical_theme_name,
    actor_id, reassigned_count, distinct_sessions, distinct_clients
  ) VALUES (
    v_archived.team_id, v_archived.initiated_by,
    archived_theme_id, canonical_theme_id,
    v_archived.name, v_canonical.name,
    acting_user_id, v_count, v_distinct_sessions, v_distinct_clients
  )
  RETURNING id INTO v_audit_id;

  -- Return one row matching the RETURNS TABLE shape (positional).
  RETURN QUERY SELECT
    v_audit_id,
    v_count,
    v_distinct_sessions,
    v_distinct_clients,
    v_archived.name,
    v_canonical.name,
    v_archived.team_id;
END;
$$;
