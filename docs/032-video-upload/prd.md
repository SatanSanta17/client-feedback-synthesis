# PRD-032: Video Upload and Transcription

> **Status:** Draft
> **Depends on:** PRD-013 (File Upload — implemented)
> **Deliverable:** Users can upload video files in the capture form. The video is processed in the user's browser to extract compressed audio, which is then transcribed server-side. Only the transcript is stored — the video and audio files are never retained. Transcripts feed into the same signal extraction pipeline as other attachments.

## Purpose

Today, the highest-fidelity feedback sources — discovery calls, customer interviews, account reviews — are video-first (Zoom, Meet, Teams recordings). To use Synthesiser, users must manually transcribe these recordings or paste rough notes, losing fidelity in both directions. Adding video upload closes the gap between where conversations actually happen and where signals get extracted.

To keep storage cost and privacy footprint minimal, we never retain the video or the extracted audio. Audio extraction happens entirely on the user's device; the server only sees compressed audio long enough to transcribe it, then discards. The transcript becomes a regular text attachment — indistinguishable from existing `parsed_content` for downstream signal extraction.

This is deliberately scoped narrower than the PRD-013 pattern: existing file types (TXT, PDF, CSV, DOCX, JSON) continue to retain their original blobs in Supabase Storage. Only video introduces the transcript-only attachment shape.

## User Story

As a team member, I want to upload a recorded client meeting (Zoom export, screen recording, GoPro footage) and have Synthesiser automatically transcribe it, so the AI can analyse the actual conversation — not my paraphrased recollection — without me first transcribing it by hand.

---

## Part 1: Client-side audio extraction and upload

**Scope:** Accept video uploads in the capture form, extract compressed audio in the browser, upload only the audio to a transcription endpoint. No server-side video handling.

### Requirements

**P1.R1 — Video formats accepted.** The upload zone (capture form and expanded session view) accepts the existing file types plus video formats: `.mp4`, `.mov`, `.webm`. The accepted-formats hint in the upload zone is updated to include these.

**P1.R2 — Caps on video input.** A video upload is accepted only if it meets BOTH:
- Raw file size ≤ 500 MB
- Duration ≤ 2 hours

If the file size cap fails, an inline error is shown immediately on file selection: "Video files must be 500 MB or smaller." If the duration cap fails (only detectable after metadata read), the same kind of error is shown: "Video must be 2 hours or shorter." In both cases, the file is not added to the attachments list.

**P1.R3 — Client-side audio extraction.** When a user adds a video file, audio is extracted in the user's browser. The audio is encoded as mono, 16 kHz, ~32 kbps — a format optimised for speech transcription, not playback. Extraction runs in a background thread so the UI remains responsive. Extraction is fully local — the original video never leaves the user's device.

**P1.R4 — Extraction in-progress UI.** While audio is being extracted, the attachment list shows a per-file progress state ("Processing video locally…") with a percentage where available. A persistent banner in the capture form reminds the user: "Processing video — please keep this tab open." All other capture form interactions remain available; only this one attachment is in a pending state.

**P1.R5 — Wake lock during processing.** While extraction or upload is in progress, the app requests a screen wake lock to prevent the device from sleeping. If the wake lock API is unavailable or denied by the browser, processing continues but the UI surfaces an additional warning to keep the device active.

**P1.R6 — Tab-close guard.** If the user attempts to close the tab or navigate away during extraction or upload, the browser's native confirmation prompt is triggered. The guard is removed once the transcript has been received (or the attachment is removed).

**P1.R7 — Audio upload to server.** Once extraction completes, the audio file is uploaded to a new transcription endpoint along with the original video metadata (file name, file size in bytes, duration in seconds, MIME type). The video file itself is never uploaded. The user sees a "Transcribing…" state for that attachment until the server returns the transcript.

**P1.R8 — Browser compatibility.** If the user's browser lacks the capabilities required for client-side video processing, video files cannot be selected and a tooltip explains: "Your browser doesn't support video upload. Use Chrome, Edge, or Firefox on desktop." All other file types remain available with no degradation.

**P1.R9 — Cancel during processing.** The remove (×) button is available throughout extraction, upload, and transcription. Clicking it immediately cancels the in-progress work, releases any resources held in the browser, and removes the attachment from client state.

### Acceptance Criteria

- [ ] P1.AC1 — Video files (.mp4, .mov, .webm) appear as accepted formats in the upload zone
- [ ] P1.AC2 — Files >500 MB are rejected with an inline error before any processing
- [ ] P1.AC3 — Videos >2 hr in duration are rejected with an inline error after metadata read
- [ ] P1.AC4 — Audio extraction runs in the browser and does not freeze the UI
- [ ] P1.AC5 — A progress indicator shows during extraction
- [ ] P1.AC6 — A persistent banner warns the user to keep the tab open
- [ ] P1.AC7 — Wake lock is requested while extraction or upload is in progress
- [ ] P1.AC8 — Closing the tab during processing triggers a browser confirmation prompt
- [ ] P1.AC9 — Audio (not video) is what reaches the server
- [ ] P1.AC10 — The original video file never leaves the user's device
- [ ] P1.AC11 — Unsupported browsers cannot select video files; a clear message is shown
- [ ] P1.AC12 — Cancelling at any stage removes the attachment cleanly with no leaked state

---

## Part 2: Server-side transcription and persistence

**Scope:** New transcription endpoint, integration with a speech-to-text provider via the existing AI provider abstraction, and persisting transcripts as attachments without storing any blob.

### Requirements

**P2.R1 — Transcription endpoint.** A new authenticated API route accepts the uploaded audio plus original video metadata and returns `{ parsed_content: string, file_name: string, file_type: string, file_size: number, duration_seconds: number, source_format: "video_transcript" }`. The endpoint enforces session/team access checks consistent with other capture endpoints. Unauthenticated requests return 401.

**P2.R2 — Provider-agnostic transcription.** Transcription uses the configured speech-to-text provider via the codebase's AI provider abstraction (extended for transcription where needed). Provider and model are environment variables, never hardcoded. No raw provider keys leave the server.

**P2.R3 — No blob retention, ever.** The audio file received by the transcription endpoint is held in memory only. After transcription completes (or fails), it is discarded. No part of the video, audio, or any intermediate artefact is written to Supabase Storage, the filesystem, or any persistent store.

**P2.R4 — Transcript persisted as an attachment.** When the user saves the session, the video transcript is persisted as a row in `session_attachments` with:
- `parsed_content` = the transcript text
- `source_format` = `"video_transcript"`
- `file_name` = original video file name
- `file_type` = original video MIME type
- `file_size` = original video size in bytes (kept for display only)
- `storage_path` = NULL

The `session_attachments.storage_path` column is made nullable to support transcript-only attachments. Existing rows (with stored blobs) are unaffected.

**P2.R5 — Transcript counts toward combined input limit.** The combined character counter and `MAX_COMBINED_CHARS` limit (PRD-013) include video transcripts the same way as other parsed content. If a transcript would push combined input over the limit, the standard "Input exceeds the maximum length" message applies.

**P2.R6 — Transcription failures.** If the speech-to-text provider returns an error (timeout, rate limit, malformed response, unprocessable audio), the user sees a clear toast: "Could not transcribe video — please try again." The attachment is removed from client state. Transient errors (rate limit, network, 5xx) trigger the existing retry logic (up to 3 attempts with exponential backoff).

**P2.R7 — Tab-close behaviour.** Once audio reaches the server, the transcription job completes regardless of whether the client stays connected. Two cases for what happens to the result:
- **Existing saved session**: the transcript is persisted server-side as soon as it returns from the provider, attaches to that session, and appears on the user's next visit.
- **New unsaved session**: the user must keep the tab open until the transcript returns and the session is saved. Closing the tab earlier loses the transcript. The in-progress UI makes this distinction clear.

**P2.R8 — Empty transcript handling.** If the speech-to-text provider returns an empty or whitespace-only transcript (silent video, music-only, fully unintelligible audio), the response is treated as a parse failure with the message "No speech could be transcribed from this video." The attachment is not added to the session.

### Acceptance Criteria

- [ ] P2.AC1 — Transcription endpoint exists and requires authentication
- [ ] P2.AC2 — Transcription uses the existing AI provider abstraction with environment-configured provider/model
- [ ] P2.AC3 — Audio is held only in memory and discarded after transcription (success or failure)
- [ ] P2.AC4 — `session_attachments.storage_path` is nullable; existing rows unchanged
- [ ] P2.AC5 — Saving a session persists the transcript as a `video_transcript` attachment with `storage_path = NULL`
- [ ] P2.AC6 — Combined input limit includes transcript characters
- [ ] P2.AC7 — Transcription failures show a clear toast and remove the attachment
- [ ] P2.AC8 — Transient transcription errors retry up to 3 times before surfacing
- [ ] P2.AC9 — Empty transcripts are rejected with a descriptive message
- [ ] P2.AC10 — Transcripts for already-saved sessions persist even if the client tab closes mid-transcription
- [ ] P2.AC11 — Server-side logs record entry, exit, duration, and any provider errors for every transcription request

---

## Part 3: Video transcript UX in sessions

**Scope:** How video transcripts appear in the capture form, in past sessions, and in re-extraction — visually distinct from blob-backed attachments because there's no original to download.

### Requirements

**P3.R1 — Visual differentiation in attachments list.** Video transcripts in the attachments list show a distinct video icon (instead of the document icon used for other formats). A short label below the file name reads "Transcript only — original video not stored" so the user clearly understands what's been kept.

**P3.R2 — No download button for video transcripts.** Video transcript attachments do not show a download button (there's no original blob, and the transcript is shown inline). The remove button is unchanged.

**P3.R3 — Inline transcript view.** Clicking the "View content" toggle on a video transcript attachment expands the transcript text inline using the same component used for other parsed content. The transcript is read-only.

**P3.R4 — Past session display.** In the past sessions view (collapsed and expanded), video transcript attachments are counted in the paperclip indicator alongside other attachments. The expanded view shows the transcript using the same inline component as the capture form.

**P3.R5 — Re-extraction includes video transcripts.** Re-extracting signals on a session pulls in transcript text the same way it pulls in any other attachment's `parsed_content`. There is no separate code path for video transcripts in the extraction pipeline.

**P3.R6 — Adding video to existing sessions.** The expanded session view's upload zone accepts video uploads using the same flow as the capture form (extract → transcribe → persist on save). The session-already-saved branch of P2.R7 applies — transcripts auto-attach if the tab closes mid-transcription.

**P3.R7 — Editable video transcripts.** Video transcript attachments include an "Edit" affordance alongside the "View content" toggle. Activating it opens an inline editor (textarea) pre-filled with the current transcript. The user can correct transcription errors (proper nouns, jargon, mishears) and save. Saved edits replace `parsed_content` and are persisted with the session.

Editing is available at any time — before save, after save, before extraction, after extraction. Re-extraction picks up edited transcript content the same way it picks up edited raw notes today.

A small "edited" badge appears on the attachment whenever the transcript has been modified from its original transcription. Hovering the badge shows a tooltip with the last-edited timestamp.

Editability is **exclusive to `source_format = "video_transcript"` attachments**. Parsed content for other formats (PDF, CSV, DOCX, JSON, TXT) remains view-only — users can re-upload a corrected source file for those formats. Video has no equivalent recovery path because the original is intentionally not retained.

### Acceptance Criteria

- [ ] P3.AC1 — Video transcript attachments show a video icon and "Transcript only" label
- [ ] P3.AC2 — Video transcript attachments have no download button
- [ ] P3.AC3 — Transcript is viewable inline via "View content" toggle (read-only by default)
- [ ] P3.AC4 — Past session attachment count includes video transcripts
- [ ] P3.AC5 — Re-extracting a past session includes transcript content in the AI input
- [ ] P3.AC6 — Video uploads work from the expanded past session view
- [ ] P3.AC7 — "Edit" affordance is shown only for `video_transcript` attachments, not for other formats
- [ ] P3.AC8 — Editing a transcript updates `parsed_content` on save and persists with the session
- [ ] P3.AC9 — Re-extraction after an edit uses the edited transcript content
- [ ] P3.AC10 — An "edited" badge with last-edited tooltip appears on modified transcripts

---

## Part 4: Edge cases and limits

**Scope:** Failure modes, device limitations, concurrent uploads.

### Requirements

**P4.R1 — Out-of-memory during extraction.** If audio extraction fails because the device runs out of memory, the user sees: "Your device couldn't process this video. Try a shorter clip or a different device." The attachment is not added.

**P4.R2 — Extraction failure (non-memory).** If extraction fails for any other reason (corrupt video, unsupported codec, malformed container), the user sees: "This video format couldn't be processed. Try converting to MP4 or use a different recording." The attachment is not added.

**P4.R3 — Maximum attachments per session.** The existing `MAX_ATTACHMENTS = 5` limit applies. Video transcripts count as attachments alongside other file types.

**P4.R4 — Concurrent video uploads.** If a user adds multiple videos to one session, each is processed sequentially in the browser (one extraction at a time, to avoid memory pressure). Other file types continue to be processed in parallel as today. A queue indicator shows which video is currently processing and which are waiting.

**P4.R5 — Audio-only files not accepted in this PRD.** Audio-only files (`.mp3`, `.m4a`, `.wav`) are NOT accepted in this release. Listed in backlog for a follow-up PRD where the same transcription endpoint can be reused without browser-side extraction.

**P4.R6 — Empty transcript edit.** If the user edits a video transcript and attempts to save it empty or whitespace-only, the save is rejected with an inline error: "Transcript can't be empty. Use Remove if you want to discard this attachment." The edit stays open so the user can either restore content or cancel.

### Acceptance Criteria

- [ ] P4.AC1 — Out-of-memory failures show a device-specific error message
- [ ] P4.AC2 — Codec/corruption failures show a format-specific error message
- [ ] P4.AC3 — `MAX_ATTACHMENTS` limit is enforced and counts video transcripts
- [ ] P4.AC4 — Concurrent video uploads are processed sequentially with a visible queue indicator
- [ ] P4.AC5 — Audio-only files are rejected as unsupported in this release
- [ ] P4.AC6 — Empty / whitespace-only transcript edits are rejected with a clear inline error

---

## Backlog

- **Audio-only file uploads** — accept `.mp3`, `.m4a`, `.wav` files. Reuses the transcription endpoint without browser-side extraction.
- **Long-video chunking** — for videos >2 hr, split extracted audio into segments and transcribe each in parallel; stitch back together with timestamp markers.
- **Speaker diarisation** — identify and label distinct speakers in the transcript ("[Speaker 1]: …" / "[Speaker 2]: …") for richer signal-extraction context.
- **Multi-threaded browser-side extraction** — switch to the multi-threaded extraction variant (~2× faster) once required cross-origin headers are audited against existing third-party integrations.
- **Server-side fallback for weak devices** — for users on devices that can't handle browser-side extraction, offer an opt-in server-side audio extraction path (with a different cost model and explicit consent).
- **Revert edited transcript to original** — preserve the original Whisper output (in a separate column) so users can revert their edits back to the auto-generated transcript. Skipped in v1 to keep the schema clean; add only if users actually request revert.
- **Cloud meeting integrations** — pull recordings directly from Zoom, Google Meet, and Microsoft Teams via OAuth, removing the manual download/upload step.
- **In-browser recording** — record meetings directly in the app and transcribe live, instead of uploading after the fact.
- **Per-team transcription quota** — track minutes-of-video transcribed per team to manage provider API cost.
- **Auto-save draft session on first attachment** — eliminate the "new session" branch of P2.R7 by creating a draft session as soon as the first attachment upload starts, so transcripts never depend on the client tab staying open.
