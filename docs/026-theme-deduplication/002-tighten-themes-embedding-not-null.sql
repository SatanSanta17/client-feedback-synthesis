-- ============================================================
-- PRD-026 Part 1: Tighten themes.embedding to NOT NULL.
-- Increment 1.4 — runs AFTER the backfill script populates every row.
--
-- Pre-flight check (must return 0 before applying this migration):
--   SELECT count(*) FROM themes WHERE embedding IS NULL;
-- ============================================================

ALTER TABLE themes
  ALTER COLUMN embedding SET NOT NULL;
