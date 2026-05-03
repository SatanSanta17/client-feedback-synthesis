-- ---------------------------------------------------------------------------
-- Migration: Make session_attachments.storage_path nullable
-- PRD: 032-video-upload, Part 2
--
-- Video transcripts persist as session_attachments rows with no Storage blob
-- (storage_path = NULL). Existing parsed-file rows are unaffected — they
-- retain their non-null storage paths. The application-layer invariant
-- (enforced in attachment-service.ts) is:
--   - source_format = 'video_transcript'  →  storage_path IS NULL
--   - otherwise                            →  storage_path IS NOT NULL
-- We deliberately do NOT enforce this with a CHECK constraint — coupling the
-- schema to the source-format vocabulary is brittle (future audio_transcript
-- rows would also be NULL-blob), and the application layer is sufficient.
-- ---------------------------------------------------------------------------

ALTER TABLE session_attachments
  ALTER COLUMN storage_path DROP NOT NULL;
