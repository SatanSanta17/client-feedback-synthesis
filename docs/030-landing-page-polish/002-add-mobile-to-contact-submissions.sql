-- ============================================================
-- PRD-030 follow-up: add mobile column to contact_submissions
-- ============================================================
-- Adds an optional mobile (phone) number to contact form submissions.
-- Free text — international formats vary too widely for a useful regex.
-- The 30-char cap matches the Zod validator and bounds payload abuse.
-- ============================================================

ALTER TABLE contact_submissions
  ADD COLUMN mobile TEXT
  CHECK (mobile IS NULL OR char_length(mobile) <= 30);
