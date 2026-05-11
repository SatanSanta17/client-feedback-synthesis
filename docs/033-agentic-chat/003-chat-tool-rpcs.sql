-- ===========================================================================
-- PRD-033 post-cutover audit fixes (2026-05-11)
--
-- Three RPCs + two partial indexes that move the chat tools' filter logic
-- from in-process TS into SQL. Closes three correctness / scale bugs:
--
--   #1 (aggregation-service.ts) — `aggregate(entity=signals, groupBy=client)`
--      was silently misrouted to `competitive_mention_frequency`. The new
--      `aggregate_signals_per_client` RPC provides the correct generic
--      per-client signal counts.
--
--   #2 (supabase-embedding-repository.ts listSignals) — `fetch_signals` was
--      applying `.limit()` BEFORE in-memory client/date/severity/urgency
--      filtering, breaking the PRD § P1.R5 completeness guarantee. The new
--      `match_signals_filtered` RPC applies every filter at SQL level so the
--      `limit` caps the final filtered set, not an arbitrary pre-filter slice.
--
--   #11 (supabase-chat-query-repository.ts listClients) — `list_clients`
--      pulled every session row in the workspace into Node to compute counts.
--      The new `list_clients_with_session_counts` RPC does the GROUP BY in
--      Postgres.
--
-- Indexes accelerate the JSONB metadata predicates used by fix #3
-- (resolveSignalLevelFilters) — that one stays in the TS query builder but
-- now filters via `metadata->>'severity'` at SQL instead of pulling all rows
-- into Node.
--
-- All three RPCs follow the existing `match_session_embeddings_fts` pattern:
--   - SECURITY DEFINER + SET search_path = public (prevents search_path attacks)
--   - Workspace scoping mirrors match_session_embeddings exactly
--   - Joins to `sessions` for date / client filtering (single source of truth,
--     not denormalised metadata)
--   - LANGUAGE sql STABLE where possible for query planner optimisation
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. match_signals_filtered — backs fetch_signals (PRD-033 P1.R2 completeness)
--
-- Strictly schema-filtered (no query string). Joins session_embeddings to
-- sessions and optionally clients / signal_themes so the limit caps the
-- correctly-filtered set, not an arbitrary pre-filter slice.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_signals_filtered(
  filter_team_id UUID DEFAULT NULL,
  filter_user_id UUID DEFAULT NULL,
  filter_client_name TEXT DEFAULT NULL,
  filter_theme_name TEXT DEFAULT NULL,
  filter_chunk_types TEXT[] DEFAULT NULL,
  filter_severity TEXT DEFAULT NULL,
  filter_urgency TEXT DEFAULT NULL,
  filter_date_from DATE DEFAULT NULL,
  filter_date_to DATE DEFAULT NULL,
  match_limit INT DEFAULT 200
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  chunk_text TEXT,
  chunk_type TEXT,
  metadata JSONB,
  client_name TEXT,
  session_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.session_id,
    e.chunk_text,
    e.chunk_type,
    e.metadata,
    c.name AS client_name,
    s.session_date
  FROM session_embeddings e
  INNER JOIN sessions s ON s.id = e.session_id AND s.deleted_at IS NULL
  LEFT JOIN clients c ON c.id = s.client_id
  WHERE
    -- Workspace scoping (mirrors match_session_embeddings).
    (
      (filter_team_id IS NOT NULL AND e.team_id = filter_team_id)
      OR (filter_team_id IS NULL AND e.team_id IS NULL
          AND filter_user_id IS NOT NULL AND s.created_by = filter_user_id)
    )
    AND (filter_chunk_types IS NULL OR e.chunk_type = ANY(filter_chunk_types))
    -- Client filter via sessions/clients join (single source of truth — not
    -- the denormalised metadata copy on session_embeddings).
    AND (filter_client_name IS NULL
         OR LOWER(TRIM(c.name)) = LOWER(TRIM(filter_client_name)))
    -- Theme filter via signal_themes junction. EXISTS keeps row uniqueness.
    AND (filter_theme_name IS NULL
         OR EXISTS (
           SELECT 1 FROM signal_themes st
           INNER JOIN themes t ON t.id = st.theme_id
           WHERE st.embedding_id = e.id
             AND t.is_archived = false
             AND LOWER(TRIM(t.name)) = LOWER(TRIM(filter_theme_name))
             AND (
               (filter_team_id IS NOT NULL AND t.team_id = filter_team_id)
               OR (filter_team_id IS NULL AND t.team_id IS NULL)
             )
         ))
    -- Date filter via sessions (canonical), not metadata.
    AND (filter_date_from IS NULL OR s.session_date >= filter_date_from)
    AND (filter_date_to IS NULL OR s.session_date <= filter_date_to)
    -- Severity / urgency live inside metadata JSONB; case-insensitive match.
    AND (filter_severity IS NULL
         OR LOWER(e.metadata->>'severity') = LOWER(filter_severity))
    AND (filter_urgency IS NULL
         OR LOWER(e.metadata->>'urgency') = LOWER(filter_urgency))
  ORDER BY s.session_date DESC, e.id
  LIMIT match_limit;
$$;

-- ---------------------------------------------------------------------------
-- 2. aggregate_signals_per_client — backs aggregate(entity=signals,
--    groupBy=client). Fixes the #1 misrouting bug; provides the correct
--    generic "signals per client" count that the old surface had no action
--    for. Honours chunkTypes / severity / urgency / date / client filters.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION aggregate_signals_per_client(
  filter_team_id UUID DEFAULT NULL,
  filter_user_id UUID DEFAULT NULL,
  filter_chunk_types TEXT[] DEFAULT NULL,
  filter_severity TEXT DEFAULT NULL,
  filter_urgency TEXT DEFAULT NULL,
  filter_date_from DATE DEFAULT NULL,
  filter_date_to DATE DEFAULT NULL,
  filter_client_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  client_name TEXT,
  signal_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.name AS client_name,
    COUNT(*)::BIGINT AS signal_count
  FROM session_embeddings e
  INNER JOIN sessions s ON s.id = e.session_id AND s.deleted_at IS NULL
  INNER JOIN clients c ON c.id = s.client_id
  WHERE
    (
      (filter_team_id IS NOT NULL AND e.team_id = filter_team_id)
      OR (filter_team_id IS NULL AND e.team_id IS NULL
          AND filter_user_id IS NOT NULL AND s.created_by = filter_user_id)
    )
    AND (filter_chunk_types IS NULL OR e.chunk_type = ANY(filter_chunk_types))
    AND (filter_severity IS NULL
         OR LOWER(e.metadata->>'severity') = LOWER(filter_severity))
    AND (filter_urgency IS NULL
         OR LOWER(e.metadata->>'urgency') = LOWER(filter_urgency))
    AND (filter_date_from IS NULL OR s.session_date >= filter_date_from)
    AND (filter_date_to IS NULL OR s.session_date <= filter_date_to)
    AND (filter_client_name IS NULL
         OR LOWER(TRIM(c.name)) = LOWER(TRIM(filter_client_name)))
  GROUP BY c.name
  ORDER BY signal_count DESC;
$$;

-- ---------------------------------------------------------------------------
-- 3. list_clients_with_session_counts — backs list_clients (PRD-033 P1.R1).
-- Computes session count and last-session date per client in SQL instead of
-- pulling every session row into Node.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_clients_with_session_counts(
  filter_team_id UUID DEFAULT NULL,
  filter_user_id UUID DEFAULT NULL,
  filter_name_search TEXT DEFAULT NULL,
  filter_has_sessions BOOLEAN DEFAULT FALSE,
  match_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  session_count BIGINT,
  last_session_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    COALESCE(agg.session_count, 0)::BIGINT AS session_count,
    agg.last_session_date
  FROM clients c
  LEFT JOIN (
    SELECT
      s.client_id,
      COUNT(*)::BIGINT AS session_count,
      MAX(s.session_date) AS last_session_date
    FROM sessions s
    WHERE s.deleted_at IS NULL
      AND (
        (filter_team_id IS NOT NULL AND s.team_id = filter_team_id)
        OR (filter_team_id IS NULL AND s.team_id IS NULL
            AND filter_user_id IS NOT NULL AND s.created_by = filter_user_id)
      )
    GROUP BY s.client_id
  ) agg ON agg.client_id = c.id
  WHERE
    (
      (filter_team_id IS NOT NULL AND c.team_id = filter_team_id)
      OR (filter_team_id IS NULL AND c.team_id IS NULL)
    )
    AND (filter_name_search IS NULL OR c.name ILIKE '%' || filter_name_search || '%')
    AND (filter_has_sessions = FALSE OR agg.session_count > 0)
  ORDER BY c.name ASC
  LIMIT match_limit;
$$;

-- ---------------------------------------------------------------------------
-- 4. Partial indexes for severity/urgency JSONB filters
-- Accelerates fix #3 (chat-query-repository resolveSignalLevelFilters) and
-- the new match_signals_filtered RPC's severity/urgency predicates.
--
-- Pattern: (team_id, (metadata->>'<field>')) — composite so the team-scope
-- filter narrows first, then the JSONB lookup applies on the narrowed set.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_session_embeddings_team_severity
  ON session_embeddings (team_id, (metadata->>'severity'));

CREATE INDEX IF NOT EXISTS idx_session_embeddings_team_urgency
  ON session_embeddings (team_id, (metadata->>'urgency'));
