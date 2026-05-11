-- ===========================================================================
-- PRD-033 Part 1 / Increment 1.1
-- Adds full-text search infrastructure to session_embeddings so the new
-- semantic_search tool (TRD § 1.3) can fuse vector + keyword retrieval via
-- reciprocal rank fusion (RRF).
-- ===========================================================================

-- 1. Generated tsvector column over chunk_text (English).
--    STORED so the index can be GIN'd; auto-maintained by Postgres.
ALTER TABLE session_embeddings
  ADD COLUMN chunk_text_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_text, ''))) STORED;

-- 2. GIN index for fast tsquery matching.
CREATE INDEX idx_session_embeddings_tsv
  ON session_embeddings USING GIN (chunk_text_tsv);

-- 3. Composite index on (team_id, session_id) — speeds the workspace+session
--    filter that fetch_session_content does. The existing index covers
--    (team_id, chunk_type), not (team_id, session_id). Drop this if a
--    pre-existing redundant index is found during review.
CREATE INDEX IF NOT EXISTS idx_session_embeddings_team_session
  ON session_embeddings (team_id, session_id);
