-- ============================================================
-- PRD-026 Part 2: find_theme_candidate_pairs RPC
-- Returns every active-theme pair within a workspace whose embedding
-- cosine similarity meets or exceeds the provided threshold.
--
-- Pair ordering is normalized via the t1.id < t2.id self-join condition
-- (Decision 11) — each unique pair appears exactly once, regardless of
-- iteration order.
-- ============================================================

CREATE OR REPLACE FUNCTION find_theme_candidate_pairs(
  filter_team_id       UUID,
  filter_user_id       UUID,
  similarity_threshold FLOAT DEFAULT 0.80
)
RETURNS TABLE (
  theme_a_id UUID,
  theme_b_id UUID,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    t1.id AS theme_a_id,
    t2.id AS theme_b_id,
    1 - (t1.embedding <=> t2.embedding) AS similarity
  FROM themes t1
  INNER JOIN themes t2
    ON t1.id < t2.id
  WHERE
    t1.is_archived = false
    AND t2.is_archived = false
    -- Workspace scope:
    --   team workspace  → both themes share filter_team_id
    --   personal        → both team_id NULL, both owned by filter_user_id
    AND (
      (filter_team_id IS NOT NULL
       AND t1.team_id = filter_team_id
       AND t2.team_id = filter_team_id)
      OR
      (filter_team_id IS NULL
       AND t1.team_id IS NULL
       AND t2.team_id IS NULL
       AND t1.initiated_by = filter_user_id
       AND t2.initiated_by = filter_user_id)
    )
    AND 1 - (t1.embedding <=> t2.embedding) >= similarity_threshold
  ORDER BY similarity DESC;
$$;
