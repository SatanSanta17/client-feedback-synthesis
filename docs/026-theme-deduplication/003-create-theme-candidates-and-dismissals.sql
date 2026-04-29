-- ============================================================
-- PRD-026 Part 2: Platform-suggested merge candidates.
-- Increment 2.1 — schema + RLS only. The service + API + UI ship in
-- subsequent increments and write through the service-role client.
--
-- Idempotent — every object guarded with IF NOT EXISTS so re-applying
-- against an already-migrated environment is safe.
-- ============================================================

-- ------------------------------------------------------------
-- theme_merge_candidates
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS theme_merge_candidates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_a_id                  UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  theme_b_id                  UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  similarity_score            REAL NOT NULL,
  volume_score                REAL NOT NULL,
  recency_score               REAL NOT NULL,
  combined_score              REAL NOT NULL,
  theme_a_assignment_count    INTEGER NOT NULL DEFAULT 0,
  theme_a_distinct_sessions   INTEGER NOT NULL DEFAULT 0,
  theme_a_distinct_clients    INTEGER NOT NULL DEFAULT 0,
  theme_a_last_assigned_at    TIMESTAMPTZ,
  theme_b_assignment_count    INTEGER NOT NULL DEFAULT 0,
  theme_b_distinct_sessions   INTEGER NOT NULL DEFAULT 0,
  theme_b_distinct_clients    INTEGER NOT NULL DEFAULT 0,
  theme_b_last_assigned_at    TIMESTAMPTZ,
  shared_keywords             TEXT[] NOT NULL DEFAULT '{}',
  refresh_batch_id            UUID NOT NULL,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Decision 11: normalized pair ordering means (A, B) and (B, A) are the
  -- same logical candidate. Application enforces ordering at insert time;
  -- this CHECK is the schema-level invariant.
  CHECK (theme_a_id < theme_b_id)
);

-- Unique candidate per workspace (team + personal scoped separately)
CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_candidates_unique_pair_team
  ON theme_merge_candidates (theme_a_id, theme_b_id, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_candidates_unique_pair_personal
  ON theme_merge_candidates (theme_a_id, theme_b_id, initiated_by)
  WHERE team_id IS NULL;

-- Primary read path: "top N by combined_score per workspace"
CREATE INDEX IF NOT EXISTS theme_merge_candidates_team_score_idx
  ON theme_merge_candidates (team_id, combined_score DESC)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS theme_merge_candidates_personal_score_idx
  ON theme_merge_candidates (initiated_by, combined_score DESC)
  WHERE team_id IS NULL;

-- Refresh-batch lookup (for the transactional replace flow)
CREATE INDEX IF NOT EXISTS theme_merge_candidates_batch_idx
  ON theme_merge_candidates (refresh_batch_id);

ALTER TABLE theme_merge_candidates ENABLE ROW LEVEL SECURITY;

-- Read policies — visibility is workspace-scoped via existing helpers.
-- Admin gating happens at the API layer; RLS enforces workspace membership
-- so cross-workspace leakage is structurally impossible regardless of the
-- API's role checks.
DROP POLICY IF EXISTS "team members read team candidates" ON theme_merge_candidates;
CREATE POLICY "team members read team candidates"
  ON theme_merge_candidates FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

DROP POLICY IF EXISTS "users read own personal candidates" ON theme_merge_candidates;
CREATE POLICY "users read own personal candidates"
  ON theme_merge_candidates FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());

-- INSERT/UPDATE/DELETE: service-role only (no policy means denied for
-- authenticated/anon, but the service-role client bypasses RLS).

-- ------------------------------------------------------------
-- theme_merge_dismissals
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS theme_merge_dismissals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_a_id      UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  theme_b_id      UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  dismissed_by    UUID NOT NULL REFERENCES auth.users(id),
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (theme_a_id < theme_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_dismissals_unique_pair_team
  ON theme_merge_dismissals (theme_a_id, theme_b_id, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_dismissals_unique_pair_personal
  ON theme_merge_dismissals (theme_a_id, theme_b_id, initiated_by)
  WHERE team_id IS NULL;

ALTER TABLE theme_merge_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team members read team dismissals" ON theme_merge_dismissals;
CREATE POLICY "team members read team dismissals"
  ON theme_merge_dismissals FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

DROP POLICY IF EXISTS "users read own personal dismissals" ON theme_merge_dismissals;
CREATE POLICY "users read own personal dismissals"
  ON theme_merge_dismissals FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());
