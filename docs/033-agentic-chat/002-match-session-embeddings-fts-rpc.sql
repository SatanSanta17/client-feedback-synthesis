-- ===========================================================================
-- PRD-033 Part 1 / Increment 1.1
-- match_session_embeddings_fts — keyword (full-text) search RPC mirroring
-- match_session_embeddings's signature. Returns ranked rows by ts_rank_cd.
-- TRD § 1.1.
-- ===========================================================================

CREATE OR REPLACE FUNCTION match_session_embeddings_fts(
  query_text TEXT,
  match_count INT DEFAULT 30,
  filter_team_id UUID DEFAULT NULL,
  filter_user_id UUID DEFAULT NULL,
  filter_chunk_types TEXT[] DEFAULT NULL,
  filter_client_name TEXT DEFAULT NULL,
  filter_date_from DATE DEFAULT NULL,
  filter_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  chunk_text TEXT,
  chunk_type TEXT,
  metadata JSONB,
  fts_rank REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts_query tsquery;
BEGIN
  -- websearch_to_tsquery handles user-friendly input (quoted phrases, OR, -term).
  ts_query := websearch_to_tsquery('english', query_text);

  -- Empty query string would produce an empty tsquery and match nothing;
  -- short-circuit explicitly so callers can rely on a sensible response shape.
  IF ts_query IS NULL OR ts_query::text = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.session_id,
    e.chunk_text,
    e.chunk_type,
    e.metadata,
    ts_rank_cd(e.chunk_text_tsv, ts_query) AS fts_rank
  FROM session_embeddings e
  JOIN sessions s ON s.id = e.session_id
  WHERE e.chunk_text_tsv @@ ts_query
    -- Workspace scoping — mirrors match_session_embeddings exactly.
    AND (
      (filter_team_id IS NOT NULL AND e.team_id = filter_team_id)
      OR (filter_team_id IS NULL AND e.team_id IS NULL
          AND filter_user_id IS NOT NULL AND s.created_by = filter_user_id)
    )
    AND (filter_chunk_types IS NULL OR e.chunk_type = ANY(filter_chunk_types))
    AND (filter_client_name IS NULL
         OR EXISTS (SELECT 1 FROM clients c
                    WHERE c.id = s.client_id
                      AND lower(c.name) = lower(filter_client_name)))
    AND (filter_date_from IS NULL OR s.session_date >= filter_date_from)
    AND (filter_date_to IS NULL OR s.session_date <= filter_date_to)
  ORDER BY fts_rank DESC
  LIMIT match_count;
END;
$$;
