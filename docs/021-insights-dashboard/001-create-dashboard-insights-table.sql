-- ---------------------------------------------------------------------------
-- Migration: Create dashboard_insights table
-- PRD: 021-insights-dashboard, Part 5
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dashboard_insights (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT        NOT NULL,
  insight_type TEXT       NOT NULL CHECK (insight_type IN ('trend', 'anomaly', 'milestone')),
  batch_id    UUID        NOT NULL,
  team_id     UUID        REFERENCES teams (id) ON DELETE CASCADE,
  created_by  UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: batch grouping queries (fetch all rows for a given team + batch)
CREATE INDEX dashboard_insights_team_batch_idx
  ON dashboard_insights (team_id, batch_id);

-- Index: latest-first ordering (most recent insights per team)
CREATE INDEX dashboard_insights_generated_at_idx
  ON dashboard_insights (team_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE dashboard_insights ENABLE ROW LEVEL SECURITY;

-- SELECT: team members can read insights for their team
CREATE POLICY "Team members can read dashboard insights"
  ON dashboard_insights
  FOR SELECT
  USING (
    (
      team_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = dashboard_insights.team_id
          AND team_members.user_id = auth.uid()
      )
    )
    OR
    (
      team_id IS NULL
      AND created_by = auth.uid()
    )
  );

-- INSERT: authenticated users can insert (generation enforced at API layer)
CREATE POLICY "Authenticated users can insert dashboard insights"
  ON dashboard_insights
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
