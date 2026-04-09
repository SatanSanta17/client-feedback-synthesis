# PRD 017: Bulk Re-extraction

> **Status:** Draft
> **Section:** 017-bulk-re-extraction
> **Depends on:** PRD-014 (Prompt Traceability & Extraction Staleness) — fully implemented

---

## Purpose

When a team refines their extraction prompt over time, older sessions remain linked to the prompt version that originally produced their structured notes. This creates a consistency gap: the master signal synthesis aggregates structured data from sessions extracted with different prompts, producing uneven or contradictory results. Today, the only remedy is to open each session individually, click re-extract, confirm, and save — a tedious, error-prone process when dozens of sessions need updating.

Bulk re-extraction solves this by letting users select multiple past sessions and re-extract them all with the current active prompt in a single operation. Combined with the prompt version filter (PRD-014 P4.R7), users can precisely target sessions extracted with a specific older prompt, review the selection, and bring them all up to date.

This is the single most impactful feature for maintaining data consistency in workspaces where the extraction prompt evolves over time.

## User Story

As a team admin reviewing past sessions, I want to select multiple sessions that were extracted with an older prompt version and re-extract them all with the current active prompt, so that the structured notes across my workspace are consistent and the master signal synthesis produces coherent results.

As a personal workspace user, I want to bulk re-extract sessions after refining my prompt, so that I don't have to open and re-extract each session one by one.

---

## Constraints & Design Decisions

### Access Control

- **Team context:** Bulk re-extraction is an **admin-only** action. Sales role users can see the button but it is disabled with a tooltip explaining that only admins can perform bulk operations. This prevents a sales user from overwriting structured notes across the team's entire session history.
- **Personal context:** The workspace owner (the only user) can always perform bulk re-extraction.

### Rate Limits & Cost

- Each re-extraction makes one AI API call (same as a single extraction). A bulk operation on 30 sessions means 30 API calls.
- Sessions are processed **sequentially**, not in parallel, to respect AI provider rate limits and avoid overwhelming the server with concurrent requests.
- A **per-operation cap** limits the maximum number of sessions that can be re-extracted in a single bulk operation. The initial cap is **50 sessions**. If the user's selection exceeds this, the UI prevents submission and displays a message: "Select up to 50 sessions per batch. Use filters to narrow your selection."
- The cap is a constant defined in the codebase, easy to adjust as usage patterns emerge.

### Long-running Operation Model

- Bulk re-extraction is a **server-side job**. The client submits the list of session IDs, and the server processes them one at a time.
- The client **polls** for progress updates at a regular interval (every 2–3 seconds) while the job is running. This avoids the complexity of WebSockets or Server-Sent Events for an MVP.
- The server maintains job state in-memory (not persisted to the database). If the server restarts mid-job, the job is lost — this is acceptable for MVP since re-extraction is idempotent and the user can simply re-run.
- Future enhancement: persist job state to the database for resilience and cross-instance support.

### Idempotency & Safety

- Re-extraction is **idempotent**. Running it twice on the same session produces the same result (assuming the prompt hasn't changed between runs). There is no risk of data corruption from duplicate runs.
- **Optimistic locking** via `updated_at`: before processing each session, the server checks that the session's `updated_at` matches the value captured at job start. If another user modified the session while the job was running, that session is **skipped** with a "modified by another user" failure reason. This prevents overwriting concurrent edits.
- **Soft-deleted sessions** are excluded. If a session is deleted between job creation and processing, it is skipped with a "session deleted" failure reason.

---

## Part 1: Bulk Re-extraction Backend (Job Engine)

### Requirements

- **P1.R1** Create a new API endpoint `POST /api/sessions/bulk-re-extract` that accepts a list of session IDs and initiates a bulk re-extraction job. Request body: `{ sessionIds: string[] }`. Returns `{ jobId: string }` with status 202 (Accepted).
- **P1.R2** Validate the request:
  - The user must be authenticated.
  - In team context, the user must have the `admin` role. Sales users receive 403.
  - In personal context, no role check is needed.
  - The `sessionIds` array must be non-empty and must not exceed the per-operation cap (50).
  - All session IDs must be valid UUIDs.
- **P1.R3** On job creation, the server captures a snapshot of each session's `updated_at` timestamp. This snapshot is used for optimistic locking during processing.
- **P1.R4** Create a new API endpoint `GET /api/sessions/bulk-re-extract/[jobId]` that returns the current state of a bulk re-extraction job. Response shape:

  ```
  {
    status: "running" | "completed" | "cancelled",
    total: number,
    processed: number,
    succeeded: number,
    failed: number,
    failures: Array<{
      sessionId: string,
      clientName: string,
      reason: "ai_error" | "modified" | "deleted" | "no_input" | "server_error"
    }>,
    cancelledAt?: number
  }
  ```

- **P1.R5** The job processes sessions **sequentially** in the order they were submitted. For each session:
  1. Fetch the session from the database (including raw notes, attachments, and `updated_at`).
  2. Check optimistic lock: if `updated_at` differs from the snapshot, skip with reason `"modified"`.
  3. Check that the session is not soft-deleted. If deleted, skip with reason `"deleted"`.
  4. Check that the session has raw notes or attachments. If the combined input is empty, skip with reason `"no_input"`.
  5. Compose the AI input (raw notes + attachment parsed content) using the existing `composeAIInput()` utility.
  6. Call `extractSignals()` with the workspace's active prompt (same function used for single extraction).
  7. On success: update the session via the repository with the new `structured_notes`, `prompt_version_id`, `extraction_stale = false`, `structured_notes_edited = false`, and `updated_by = userId`.
  8. On AI failure (timeout, rate limit after retries, malformed response): record the session as failed with reason `"ai_error"`.
  9. On unexpected error: record the session as failed with reason `"server_error"`.
  10. Update the job's progress counters after each session.

- **P1.R6** Create a new API endpoint `POST /api/sessions/bulk-re-extract/[jobId]/cancel` that cancels a running job. The server stops processing new sessions after the current one completes. Sessions already processed (succeeded or failed) retain their results. The job status transitions to `"cancelled"`.
- **P1.R7** Job state is stored in a server-side in-memory map keyed by `jobId`. Jobs are automatically cleaned up 10 minutes after completion or cancellation (to allow the client to fetch final results).
- **P1.R8** Only one bulk re-extraction job can be active per workspace at a time. If a job is already running for the same workspace (user or team), the `POST` endpoint returns 409 Conflict with message "A bulk re-extraction is already in progress."
- **P1.R9** The job fetches the active prompt version **once** at job start (not per-session). All sessions in the batch are re-extracted with the same prompt version for consistency.
- **P1.R10** The job engine lives in a new service file `lib/services/bulk-extraction-service.ts`. It depends on `SessionRepository`, `PromptRepository`, `AttachmentRepository`, and the `extractSignals()` function from `ai-service.ts`. It does not import from `next/server` — it is framework-agnostic.
- **P1.R11** All job lifecycle events are logged: job start (with session count, workspace context), each session processed (success/failure with reason), job completion (summary), and job cancellation.

### Acceptance Criteria

- [ ] `POST /api/sessions/bulk-re-extract` creates a job and returns a `jobId` with 202.
- [ ] Role validation: admins and personal workspace owners can create jobs; sales users receive 403.
- [ ] The session ID array is validated (non-empty, max 50, valid UUIDs).
- [ ] `GET /api/sessions/bulk-re-extract/[jobId]` returns accurate progress and failure details.
- [ ] Sessions are processed sequentially with correct optimistic locking.
- [ ] Modified, deleted, and empty-input sessions are skipped with appropriate failure reasons.
- [ ] AI failures are caught and recorded per-session without aborting the entire job.
- [ ] `POST /api/sessions/bulk-re-extract/[jobId]/cancel` stops processing and preserves completed results.
- [ ] Only one job per workspace can run at a time (409 on duplicate).
- [ ] The active prompt is fetched once at job start and reused for all sessions.
- [ ] Job state is cleaned up 10 minutes after completion/cancellation.
- [ ] All lifecycle events are logged with appropriate context.

---

## Part 2: Session Selection UI

### Requirements

- **P2.R1** Add a **selection mode** to the past sessions table. When activated, each row in the table displays a checkbox in the leftmost column. Clicking the checkbox toggles the session's selection state without expanding the row.
- **P2.R2** Selection mode is entered via a "Select" button in the table's toolbar area (above the table, near the filter bar). When in selection mode, the button changes to "Cancel" which exits selection mode and clears all selections.
- **P2.R3** Add a **"Select all" checkbox** in the table header that toggles all currently loaded (visible) sessions. A subtitle indicates the count: "X selected". If more sessions exist beyond what's loaded (pagination), a link appears: "Select all Y sessions matching filters" which fetches all matching session IDs from the server.
- **P2.R4** When sessions are selected, a **sticky action bar** appears at the bottom of the table (or as a floating bar) showing: the count of selected sessions, a "Re-extract selected" button (AI-styled, gold variant), and a "Clear selection" link.
- **P2.R5** The "Re-extract selected" button is **disabled** in team context for non-admin users, with a tooltip: "Only admins can perform bulk re-extraction."
- **P2.R6** The "Re-extract selected" button is disabled when the selection exceeds the per-operation cap (50), with a message: "Select up to 50 sessions per batch."
- **P2.R7** Only sessions with existing structured notes (non-null `structured_notes`) can be selected for re-extraction. Sessions without structured notes have their checkboxes disabled with a tooltip: "No structured notes to re-extract." This prevents running extraction on sessions that were intentionally left without structured notes.
- **P2.R8** The selection state is **client-side only** — it does not persist across page navigations or refreshes.
- **P2.R9** Entering selection mode collapses any expanded session row and disables row expansion clicks. This avoids UX conflict between "click to expand" and "click to select."
- **P2.R10** Selection mode works with all existing filters (client, date range, prompt version). Changing filters clears the current selection and reloads the table.

### Acceptance Criteria

- [ ] A "Select" button appears in the table toolbar and activates selection mode.
- [ ] Each row shows a checkbox in selection mode.
- [ ] "Select all" toggles all loaded sessions, with an option to select all matching sessions beyond the current page.
- [ ] A sticky action bar shows the selection count and "Re-extract selected" button.
- [ ] The button is disabled for non-admin users in team context with a tooltip.
- [ ] The button is disabled when selection exceeds 50 sessions.
- [ ] Sessions without structured notes have disabled checkboxes.
- [ ] Selection is cleared when filters change or selection mode is exited.
- [ ] Expanded rows collapse when selection mode is entered.

---

## Part 3: Confirmation Dialog & Pre-flight Checks

### Requirements

- **P3.R1** When the user clicks "Re-extract selected", a **confirmation dialog** appears before the job is submitted. The dialog performs a pre-flight analysis of the selected sessions and presents a breakdown.
- **P3.R2** The pre-flight breakdown categorises selected sessions into three groups:
  1. **Clean sessions** — `extraction_stale = false` and `structured_notes_edited = false`. These have unmodified structured notes that will be replaced with a fresh extraction. Count displayed.
  2. **Input-changed sessions** — `extraction_stale = true` and `structured_notes_edited = false`. The raw notes or attachments changed since the last extraction. Re-extraction is expected and low-risk. Count displayed.
  3. **Manually-edited sessions** — `structured_notes_edited = true`. A user manually refined the structured notes after extraction. Re-extraction will **overwrite these manual edits**. Count displayed with a warning colour.
- **P3.R3** The dialog shows the total count and the breakdown, for example:
  > "You are about to re-extract **24 sessions** with the current active prompt."
  >
  > - 15 sessions — clean (will be re-extracted)
  > - 6 sessions — input changed since last extraction (will be re-extracted)
  > - 3 sessions — manually edited (⚠ manual edits will be lost)
  >
  > This action cannot be undone.

- **P3.R4** The dialog offers three action buttons:
  1. **"Re-extract all"** — proceeds with all selected sessions, including manually-edited ones. This is the primary action.
  2. **"Skip manually edited"** — proceeds but excludes sessions where `structured_notes_edited = true`. The count updates to reflect the reduced total.
  3. **"Cancel"** — closes the dialog without starting the job.
- **P3.R5** If no manually-edited sessions exist in the selection, the dialog simplifies: only "Re-extract all" and "Cancel" are shown (no "Skip manually edited" option since it's irrelevant).
- **P3.R6** The dialog shows the name of the current active prompt version (e.g., "Prompt v5") so the user knows which prompt will be used for re-extraction.
- **P3.R7** The breakdown data is computed client-side from the session data already loaded in the table (using `extraction_stale` and `structured_notes_edited` fields from the session list response). No additional API call is needed for the pre-flight check.

### Acceptance Criteria

- [ ] Clicking "Re-extract selected" opens a confirmation dialog with a session breakdown.
- [ ] The breakdown correctly categorises sessions into clean, input-changed, and manually-edited groups.
- [ ] The dialog shows the current active prompt version name.
- [ ] "Re-extract all" submits all selected sessions (including manually-edited).
- [ ] "Skip manually edited" excludes `structured_notes_edited = true` sessions from the submission.
- [ ] "Cancel" closes the dialog without side effects.
- [ ] When no manually-edited sessions exist, "Skip manually edited" is not shown.
- [ ] The dialog states that the action cannot be undone.

---

## Part 4: Progress UI & Results

### Requirements

- **P4.R1** After the user confirms and the job is submitted, the confirmation dialog transitions into a **progress view** (same dialog, different content). The dialog becomes non-dismissable while the job is running — the user cannot close it by clicking outside or pressing Escape.
- **P4.R2** The progress view shows:
  - A progress bar (determinate, based on `processed / total`).
  - Text: "Re-extracting session X of Y..." with the current session's client name if available.
  - Counts: succeeded, failed (updated in real-time via polling).
  - A "Cancel" button that sends the cancel request and transitions the UI to the cancelled state.
- **P4.R3** The client polls `GET /api/sessions/bulk-re-extract/[jobId]` every 2 seconds while the job status is `"running"`. Polling stops when the status is `"completed"` or `"cancelled"`.
- **P4.R4** When the job completes (or is cancelled), the progress view transitions to a **results summary**:
  - Total processed, succeeded, failed counts.
  - If there are failures, a collapsible list showing each failed session with its client name and failure reason (human-readable):
    - `"ai_error"` → "AI extraction failed"
    - `"modified"` → "Modified by another user during re-extraction"
    - `"deleted"` → "Session was deleted"
    - `"no_input"` → "No notes or attachments to extract from"
    - `"server_error"` → "Unexpected server error"
  - A "Done" button that closes the dialog and refreshes the sessions table to reflect updated data.
  - If there are failures, an additional "Retry failed" button that pre-selects the failed sessions and re-opens the confirmation dialog for just those sessions.
- **P4.R5** If the user navigates away from the page while a job is running, the job continues server-side. When the user returns to the capture page, if a job is still running for their workspace, the progress dialog automatically re-opens and resumes polling. This is achieved by checking for an active job on page mount via a lightweight `GET /api/sessions/bulk-re-extract/active` endpoint that returns the active job ID (or null).
- **P4.R6** After the job completes and the user dismisses the results dialog, the sessions table refreshes automatically (resets to offset 0 and re-fetches) to show updated structured notes, prompt versions, and staleness indicators.
- **P4.R7** Add a `GET /api/sessions/bulk-re-extract/active` endpoint that returns `{ jobId: string | null }` for the current workspace. This is used by the client to detect and resume tracking of in-flight jobs.

### Acceptance Criteria

- [ ] The dialog transitions to a progress view with a determinate progress bar after job submission.
- [ ] Progress updates in real-time via polling every 2 seconds.
- [ ] The "Cancel" button stops the job and shows results for sessions already processed.
- [ ] The results summary shows success/failure counts with a breakdown of failure reasons.
- [ ] "Retry failed" pre-selects failed sessions for another attempt.
- [ ] "Done" closes the dialog and refreshes the sessions table.
- [ ] Navigating away and returning re-opens the progress dialog if a job is still running.
- [ ] The `active` endpoint correctly returns the running job ID or null.

---

## Part 5: Concurrency Guards & Edge Cases

### Requirements

- **P5.R1** If two team admins attempt to start bulk re-extraction at the same time for the same workspace, the second request receives 409 Conflict. The UI shows a toast: "A bulk re-extraction is already in progress. Please wait for it to complete."
- **P5.R2** If a user starts a bulk re-extraction and another user (or the same user in another tab) modifies a session that is queued for re-extraction, the optimistic lock catches this: the session is skipped with reason `"modified"` and appears in the failure list. No data is lost.
- **P5.R3** If the active prompt is changed while a bulk re-extraction job is running, the job continues using the prompt it captured at start. The new prompt takes effect only for future extractions (single or bulk). This is by design — consistency within a batch is more important than picking up mid-run prompt changes.
- **P5.R4** If a session in the batch has attachments, the re-extraction includes the attachment parsed content (same as single extraction). The `composeAIInput()` utility handles this. Attachments are **not** re-parsed — only their existing `parsed_content` is used. If an attachment was added or removed since the last extraction, the re-extraction picks up the current state.
- **P5.R5** If the AI provider is unavailable (prolonged outage), the job continues processing remaining sessions. Each call that fails after retry exhaustion is recorded as `"ai_error"`. The user can retry failed sessions later via the "Retry failed" button.
- **P5.R6** The job engine must be resilient to individual session failures. A failure on session 5 of 30 must not abort sessions 6–30. Each session is processed independently within a try/catch.
- **P5.R7** If a session's `updated_at` snapshot was captured but the session is then modified by the bulk job itself (because the job updates `updated_at` when it saves new structured notes), subsequent re-processing of the same session in the same batch must not conflict. Since each session appears at most once in a batch, this is structurally prevented — but the implementation must ensure no duplicate session IDs are accepted in the request.
- **P5.R8** Validate that the submitted session IDs contain no duplicates. If duplicates are detected, deduplicate silently (no error) and process each unique session once.

### Acceptance Criteria

- [ ] Concurrent bulk re-extraction attempts for the same workspace return 409.
- [ ] Sessions modified during the job are skipped with reason `"modified"` — not overwritten.
- [ ] The prompt captured at job start is used for all sessions, even if the prompt changes mid-run.
- [ ] Sessions with attachments include attachment content in the re-extraction input.
- [ ] Individual session failures do not abort the remaining batch.
- [ ] AI provider outages result in per-session `"ai_error"` failures, not job-level failure.
- [ ] Duplicate session IDs in the request are deduplicated.

---

## Backlog (out of scope for this PRD)

- **Scheduled bulk re-extraction.** Automatically re-extract all sessions using an older prompt version when a new prompt is saved. Requires a background job system (e.g., Supabase Edge Functions or a queue).
- **Prompt diff view before bulk re-extraction.** Side-by-side comparison of the old prompt (used by selected sessions) and the current active prompt, so the user understands what will change before confirming.
- **Selective field preservation.** Allow users to mark specific fields in structured notes as "pinned" so they survive re-extraction (e.g., a manually added insight that the AI missed). Requires structured output parsing, not just raw markdown replacement.
- **Bulk re-extraction progress notifications.** Push notifications or email when a long-running bulk re-extraction completes, so users don't need to keep the tab open.
- **Cross-prompt-version bulk re-extraction.** Currently the selection is expected to target sessions from a single old prompt version (via the filter). A future enhancement could allow selecting sessions across multiple prompt versions and show a per-version breakdown in the confirmation dialog.
- **Persistent job state.** Store job state in the database instead of in-memory, enabling resilience across server restarts and multi-instance deployments.
