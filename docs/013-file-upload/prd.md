# PRD-013: File Upload and Signal Extraction

> **Status:** Draft
> **Depends on:** PRD-003 (Signal Extraction — implemented)
> **Deliverable:** Users can upload files (TXT, PDF, CSV, DOCX, JSON) alongside raw notes. The system parses file content and feeds it into the existing signal extraction pipeline, enabling richer and more diverse input sources.

## Purpose

Currently Synthesiser only accepts manually pasted raw notes as input. This limits adoption and perceived value — teams already have client feedback in chat exports, meeting transcripts, PDF decks, survey CSVs, and email threads. Asking users to manually copy-paste from these sources adds friction and reduces fidelity (context is lost during copy-paste).

File upload eliminates this friction. Users drag-and-drop or select files directly in the capture form. The system parses the file into text and feeds it — alongside any manually typed notes — into the existing signal extraction pipeline. No new AI logic is needed; the extraction prompt receives richer input automatically.

This also lays the groundwork for future platform integrations (Slack, Teams, WhatsApp API) by establishing a generic file ingestion architecture. Adding a new source becomes a matter of writing a parser, not rebuilding the pipeline.

## User Story

As a team member, I want to upload client-related files (chat exports, PDFs, transcripts) so that the signal extraction AI can analyse real conversation data — not just my paraphrased notes — and surface insights I might have missed.

---

## Part 1: File Upload Infrastructure

**Scope:** Upload zone UI, server-side file parsing, client-side state management for parsed content, and the stateless parse API endpoint.

### Requirements

**P1.R1 — Upload zone on capture form.** A file upload zone appears on the capture form below the raw notes textarea. It supports drag-and-drop and a file picker button. Accepted formats: `.txt`, `.pdf`, `.csv`, `.docx`, `.json`. Maximum file size: 10MB. Multiple files can be uploaded (one at a time or multiple at once). The upload zone shows accepted formats and the size limit.

**P1.R2 — Client-side validation.** Before uploading, the client validates file type and size. Invalid files show an inline error ("Unsupported file format" or "File exceeds 10MB limit"). Valid files are sent to the server for parsing immediately.

**P1.R3 — Stateless parse endpoint.** A new API route `POST /api/files/parse` accepts a file via `multipart/form-data` and returns `{ parsed_content: string, file_name: string, file_type: string, file_size: number, source_format: string }`. The `source_format` field indicates the detected chat format (`"whatsapp"`, `"slack"`, or `"generic"`). This endpoint does not persist anything — it only parses the file and returns the extracted text. It requires authentication (401 for unauthenticated requests).

**P1.R4 — Format-specific parsers.** A new service `lib/services/file-parser-service.ts` contains parser functions for each supported format:
- `.txt` — read as UTF-8 string
- `.pdf` — extract text using a PDF parsing library
- `.csv` — parse rows and concatenate into human-readable text
- `.docx` — extract raw text from Word documents
- `.json` — parse JSON and flatten into readable text

Each parser returns a plain text string. If a parser fails (corrupt file, unreadable content), it throws a descriptive error. The service is extensible — adding a new format is adding a new parser function.

**P1.R5 — Client-side state management.** After the parse endpoint returns, the client stores the parsed result in React state: `{ file: File, parsed_content: string, file_name: string, file_type: string, file_size: number, source_format: string }`. The original `File` object is retained in memory for later upload to storage. Nothing is persisted to the database until the user saves the session.

**P1.R6 — Attachments list UI.** Uploaded files appear in an attachments list below the upload zone. Each attachment shows: file name, file type icon, file size, and a remove button. Clicking remove clears the attachment from client state. A loading indicator shows while the file is being parsed.

**P1.R7 — Parse failure handling.** If the parse endpoint returns an error (corrupt file, unsupported encoding), an error toast is shown with a user-friendly message. The file is not added to the attachments list. Other successfully parsed attachments are unaffected.

**P1.R8 — Combined input character counter.** The capture form displays a character counter that accounts for both raw notes and all parsed attachment content combined: `2,450 / 50,000 characters used`. If the combined input exceeds the limit, the "Extract Signals" button is disabled with a message: "Input exceeds the maximum length. Remove an attachment or shorten your notes."

**P1.R9 — Chat format detection.** After parsing a file, the parser service attempts to detect known chat export formats. Supported formats:
- **WhatsApp text export** — lines matching `[DD/MM/YY, HH:MM] Sender: message`. When detected, the parsed content is restructured into sender-labelled messages (`[Sender]: message`), one per line, with timestamps stripped for cleaner AI input.
- **Slack JSON export** — JSON with a `messages` array containing objects with `user` and `text` fields. When detected, messages are restructured into `[Username]: message` format.

If a known format is detected, the `source_format` field is set accordingly (`"whatsapp"`, `"slack"`). If no format is detected, content is treated as generic text (`"generic"`). The detection runs automatically — no user action required. The restructured content replaces the raw parsed text to give the AI richer, sender-attributed context.

### Acceptance Criteria

- [ ] P1.AC1 — Upload zone appears below the raw notes textarea with drag-and-drop and file picker
- [ ] P1.AC2 — Only accepted file types (TXT, PDF, CSV, DOCX, JSON) can be uploaded
- [ ] P1.AC3 — Files exceeding 10MB are rejected with an inline error
- [ ] P1.AC4 — `POST /api/files/parse` parses each format and returns extracted text
- [ ] P1.AC5 — Parsed content is held in client state, not persisted until session save
- [ ] P1.AC6 — Attachments list shows uploaded files with name, type, size, and remove button
- [ ] P1.AC7 — Removing an attachment clears it from client state
- [ ] P1.AC8 — Parse failures show an error toast without affecting other attachments
- [ ] P1.AC9 — Character counter reflects combined raw notes + attachment content
- [ ] P1.AC10 — Extract Signals is disabled when combined input exceeds the limit
- [ ] P1.AC11 — Parse endpoint returns 401 for unauthenticated requests
- [ ] P1.AC12 — WhatsApp text exports are detected and restructured into sender-labelled messages
- [ ] P1.AC13 — Slack JSON exports are detected and restructured into sender-labelled messages
- [ ] P1.AC14 — Unrecognised formats are treated as generic text without error

---

## Part 2: Persistence and Signal Extraction Integration

**Scope:** Database schema for attachments, file storage in Supabase Storage, persisting attachments on session save, and feeding attachment content into the signal extraction pipeline.

### Requirements

**P2.R1 — Session attachments table.** A new `session_attachments` table stores file metadata and parsed content:

| Column | Type | Description |
|---|---|---|
| `id` | uuid, PK | Attachment identifier |
| `session_id` | uuid, FK → sessions | Parent session |
| `file_name` | text, not null | Original file name |
| `file_type` | text, not null | MIME type |
| `file_size` | integer, not null | File size in bytes |
| `storage_path` | text, not null | Path in Supabase Storage bucket |
| `parsed_content` | text, not null | Extracted text from the file |
| `source_format` | text, nullable | Detected format (e.g., "whatsapp", "slack", "generic") — for future use |
| `created_at` | timestamptz | Row creation time |
| `deleted_at` | timestamptz, nullable | Soft delete timestamp |

RLS policies mirror the sessions table — users can only access attachments belonging to their own sessions (or team sessions in team context).

**P2.R2 — Supabase Storage bucket.** A new `session-attachments` storage bucket holds original files. Files are stored at path `/{owner_id}/{session_id}/{uuid}-{filename}` where `owner_id` is the user ID or team ID depending on workspace context. Storage policies restrict access to the file owner or team members.

**P2.R3 — Persist attachments on session save.** When the user saves a session (new or existing), attachments held in client state are persisted:
1. Original file uploaded to Supabase Storage → returns `storage_path`
2. Attachment metadata + `parsed_content` inserted into `session_attachments`
3. Session and attachments are saved together — if attachment upload fails, the error is shown and the user can retry

**P2.R4 — Signal extraction includes attachment content.** When the user clicks "Extract Signals", the API composes the AI input by combining raw notes with all attachment parsed content, clearly labelled:

```
--- Manual Notes ---
{raw_notes}

--- Attachment: quarterly-deck.pdf ---
{parsed_content_1}

--- Attachment: client-chat-export.txt ---
{parsed_content_2}
```

The existing signal extraction prompt and output schema are unchanged. The AI simply receives more context.

**P2.R5 — Attachment deletion.** Users can remove an attachment from a saved session. Deletion is:
- **Soft delete** in `session_attachments` — row gets `deleted_at = now()`, `parsed_content` is preserved for audit trail
- **Hard delete** in Supabase Storage — original file is removed to reclaim storage
- Signals previously extracted from this content persist unchanged

**P2.R6 — Parsed content is view-only.** Users can view the parsed content of an attachment (e.g., to verify what the parser extracted) but cannot edit it. If the parsed content is incorrect, the user should re-upload a corrected file or add corrections in the raw notes textarea.

### Acceptance Criteria

- [ ] P2.AC1 — `session_attachments` table exists with the specified schema
- [ ] P2.AC2 — RLS policies restrict attachment access to session owners / team members
- [ ] P2.AC3 — `session-attachments` storage bucket is created with appropriate policies
- [ ] P2.AC4 — Saving a session uploads files to Storage and inserts attachment rows
- [ ] P2.AC5 — Signal extraction combines raw notes + attachment content with clear labels
- [ ] P2.AC6 — Existing signal extraction prompt and output are unchanged
- [ ] P2.AC7 — Deleting an attachment soft-deletes the DB row and hard-deletes the blob
- [ ] P2.AC8 — Parsed content is viewable but not editable
- [ ] P2.AC9 — Previously extracted signals persist after attachment deletion

---

## Part 3: Past Sessions — Attachment Display and Management

**Scope:** Show attachments in past session views, allow download of original files, and support adding/removing attachments on existing sessions.

### Requirements

**P3.R1 — Attachment indicator in session list.** The collapsed session row in the past sessions table shows a paperclip icon with a count (e.g., "📎 2") if the session has attachments. Sessions without attachments show no indicator.

**P3.R2 — Attachments list in expanded view.** When a session row is expanded, the attachments list appears below the notes panels. Each attachment shows: file name, file type icon, file size, a "View content" toggle (to expand/collapse the parsed text), and a download button for the original file. A remove button allows deletion (with confirmation if signals have been extracted).

**P3.R3 — Download original file.** Clicking the download button generates a signed URL from Supabase Storage and initiates a browser download. If the file has been deleted from storage (orphaned soft-delete row), the download button is disabled with a tooltip "Original file no longer available."

**P3.R4 — Upload from expanded view.** The expanded session view includes the same upload zone as the capture form. Users can add attachments to existing sessions. New attachments are parsed and stored on save.

**P3.R5 — Re-extraction with attachments.** When re-extracting signals from an expanded past session, the input includes raw notes + all non-deleted attachment content. The same confirmation prompt applies if structured notes have been manually edited.

### Acceptance Criteria

- [ ] P3.AC1 — Collapsed session rows show attachment count with paperclip icon
- [ ] P3.AC2 — Expanded view shows attachments list with file details
- [ ] P3.AC3 — "View content" toggle shows/hides the parsed text (view-only)
- [ ] P3.AC4 — Download button generates signed URL and downloads the original file
- [ ] P3.AC5 — Download is disabled for deleted-from-storage attachments
- [ ] P3.AC6 — Upload zone in expanded view allows adding attachments to existing sessions
- [ ] P3.AC7 — Re-extraction includes all non-deleted attachment content
- [ ] P3.AC8 — Remove button deletes attachment (soft in DB, hard in Storage)

---

## Part 4: Edge Cases and Limits

**Scope:** Handle error states, limits, and unusual file scenarios.

### Requirements

**P4.R1 — Empty file.** If a file is empty or the parser extracts no content, the parse endpoint returns a 422 with message "No content could be extracted from this file." The file is not added to the attachments list.

**P4.R2 — Corrupt or unreadable file.** If the parser fails (corrupt PDF, invalid encoding), the parse endpoint returns a 422 with a descriptive message. An error toast is shown. Other attachments are unaffected.

**P4.R3 — Maximum attachments per session.** A session can have a maximum of 5 attachments. Attempting to add more shows an inline error: "Maximum 5 attachments per session." This prevents unbounded storage and AI input growth.

**P4.R4 — Combined input limit.** The combined character count of raw notes + all attachment parsed content must not exceed 50,000 characters. The character counter and Extract Signals button state enforce this on the client. The server also validates this limit before calling the AI.

**P4.R5 — Session without raw notes.** A session can have attachments without raw notes. The signal extraction input would contain only the attachment content sections. The raw notes textarea remains optional.

**P4.R6 — Concurrent upload handling.** If a user uploads multiple files simultaneously, each file is parsed independently. Parse failures for one file do not block or cancel other files being parsed.

### Acceptance Criteria

- [ ] P4.AC1 — Empty files are rejected with a descriptive 422 error
- [ ] P4.AC2 — Corrupt files are rejected with a descriptive 422 error
- [ ] P4.AC3 — Maximum 5 attachments per session is enforced
- [ ] P4.AC4 — Combined 50,000 character limit is enforced on client and server
- [ ] P4.AC5 — Sessions can be saved with only attachments (no raw notes)
- [ ] P4.AC6 — Multiple simultaneous uploads are handled independently

---

## Backlog

- **Additional chat format detection** — detect more chat export formats beyond WhatsApp and Slack (e.g., Telegram, Discord, Google Chat). Each new format is a detection function + restructurer in the parser service.
- **Audio/video file transcription** — accept audio (MP3, WAV, M4A) and video (MP4) files, transcribe via Whisper/AssemblyAI/Deepgram, and feed the transcript into signal extraction.
- **Slack integration** — OAuth-based integration to pull messages from specific Slack channels directly into sessions.
- **Microsoft Teams integration** — Graph API integration to import Teams channel and chat messages.
- **WhatsApp Business API** — real-time integration for business accounts (requires Meta approval).
- **Email forwarding** — generate a unique per-client email address to forward client email threads directly into sessions.
- **Optical Character Recognition (OCR)** — extract text from scanned PDFs and images.
- **Attachment versioning** — re-upload a file to replace an existing attachment while preserving the previous version.
- **Bulk upload** — upload multiple files across multiple sessions in a single batch operation.
