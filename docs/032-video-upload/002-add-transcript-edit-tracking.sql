-- ---------------------------------------------------------------------------
-- Migration: Add transcript edit tracking column
-- PRD: 032-video-upload, Part 3
--
-- Track when a video transcript was last edited. NULL means "never edited"
-- (the default for newly transcribed rows). The "edited" badge in the UI is
-- shown when this column is non-null; the tooltip shows the timestamp via the
-- existing format-relative-time helper.
--
-- Application-layer rule: editing is exclusive to source_format = 'video_transcript'.
-- The PATCH route enforces this server-side; the client gates the Edit button
-- on the same condition. No CHECK constraint — coupling the schema to the
-- source-format vocabulary would be brittle (audio_transcript rows in the
-- backlog would also be editable in the same way).
-- ---------------------------------------------------------------------------

ALTER TABLE session_attachments
  ADD COLUMN last_edited_at TIMESTAMPTZ NULL;
