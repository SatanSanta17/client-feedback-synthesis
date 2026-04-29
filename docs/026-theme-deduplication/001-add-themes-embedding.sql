-- ============================================================
-- PRD-026 Part 1: Embedding-based prevention on themes
-- Increment 1.1 — runs before the backfill script.
-- ============================================================

-- P1.R1: vector embedding column on themes.
-- Nullable during rollout; tightened to NOT NULL in 002 after backfill.
ALTER TABLE themes
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- P3.R4 forward-compat: pointer from archived theme → canonical theme.
-- Populated in Part 3's merge transaction; NULL for all rows until then.
ALTER TABLE themes
  ADD COLUMN IF NOT EXISTS merged_into_theme_id UUID
    REFERENCES themes(id) ON DELETE SET NULL;

-- P1.R5 / Part 2 forward-compat: HNSW index for cosine similarity.
-- Built once now; Part 2's candidate generation reads through it.
CREATE INDEX IF NOT EXISTS themes_embedding_hnsw_idx
  ON themes
  USING hnsw (embedding vector_cosine_ops);

-- Index supporting Part 3's audit-log query ("recent merges target X")
-- and the merged-pointer joins. Cheap and forward-compatible.
CREATE INDEX IF NOT EXISTS themes_merged_into_theme_id_idx
  ON themes (merged_into_theme_id)
  WHERE merged_into_theme_id IS NOT NULL;
