-- ============================================================
-- PRD-026 Part 2: fetch_theme_stats RPC
-- Returns per-theme signal-volume snapshot (assignment count, distinct
-- sessions, distinct clients, last-assigned timestamp) for an arbitrary
-- set of theme ids. theme-candidate-service.refreshCandidates calls this
-- once per refresh — one round trip vs. fetching the raw rows and
-- aggregating in JS.
--
-- Intentionally NOT scoped by workspace at the RPC level — the caller
-- already collects theme_ids from a workspace-scoped pair list, so
-- adding scoping here would be redundant work. The service-role client
-- is the only legitimate caller (mirrors find_theme_candidate_pairs).
-- ============================================================

CREATE OR REPLACE FUNCTION fetch_theme_stats(theme_ids UUID[])
RETURNS TABLE (
  theme_id           UUID,
  assignment_count   INTEGER,
  distinct_sessions  INTEGER,
  distinct_clients   INTEGER,
  last_assigned_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    st.theme_id,
    COUNT(*)::INTEGER                                   AS assignment_count,
    COUNT(DISTINCT se.session_id)::INTEGER              AS distinct_sessions,
    COUNT(DISTINCT (se.metadata->>'client_name'))::INTEGER AS distinct_clients,
    MAX(st.created_at)                                  AS last_assigned_at
  FROM signal_themes st
  INNER JOIN session_embeddings se ON st.embedding_id = se.id
  WHERE st.theme_id = ANY(theme_ids)
  GROUP BY st.theme_id;
$$;
