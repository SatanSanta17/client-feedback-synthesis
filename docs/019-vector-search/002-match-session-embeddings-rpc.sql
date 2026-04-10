-- ============================================================
-- PRD-019 Part 3: Similarity search RPC function
-- ============================================================

CREATE OR REPLACE FUNCTION match_session_embeddings(
  query_embedding vector(1536),
  match_count INT,
  similarity_threshold FLOAT DEFAULT 0.3,
  filter_team_id UUID DEFAULT NULL,
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
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    se.id,
    se.session_id,
    se.chunk_text,
    se.chunk_type,
    se.metadata,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM session_embeddings se
  INNER JOIN sessions s ON s.id = se.session_id AND s.deleted_at IS NULL
  WHERE
    -- Team scoping: match team_id or both null (personal workspace)
    (filter_team_id IS NULL AND se.team_id IS NULL
     OR se.team_id = filter_team_id)
    -- Optional chunk type filter
    AND (filter_chunk_types IS NULL
     OR se.chunk_type = ANY(filter_chunk_types))
    -- Optional client name filter (from metadata jsonb)
    AND (filter_client_name IS NULL
     OR se.metadata->>'client_name' = filter_client_name)
    -- Optional date range filters (from metadata jsonb)
    AND (filter_date_from IS NULL
     OR (se.metadata->>'session_date')::date >= filter_date_from)
    AND (filter_date_to IS NULL
     OR (se.metadata->>'session_date')::date <= filter_date_to)
    -- Similarity threshold
    AND 1 - (se.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
