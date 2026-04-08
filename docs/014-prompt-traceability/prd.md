# PRD 014: Prompt Traceability & Extraction Staleness

> **Status:** Draft
> **Section:** 014-prompt-traceability

---

## Purpose

When a user extracts signals from a session, the output quality depends entirely on two things: the active system prompt at the time of extraction, and the raw input (notes + attachments) that was fed into it. Today there is no record of which prompt produced which session's structured notes, no way to know if the input has changed since extraction, and no way to tell if a user manually refined the AI's output.

This invisible drift causes problems downstream: the master signal synthesis aggregates inconsistently structured data, and users have no way to understand why two sessions look different or whether a session's structured notes are still in sync with its raw input.

This feature solves three problems:

1. **Visibility at capture time.** Users can see the exact prompt that will be used before they click "Extract Signals", so they understand what the AI is about to do — without being able to casually edit it (editing stays in Settings, where it's a deliberate action).
2. **Traceability in past sessions.** Every session records which prompt version produced its structured notes. Users browsing past sessions can view the exact prompt text that was used, explaining why signals are structured the way they are.
3. **Staleness awareness.** Users can see at a glance whether a session's structured notes are potentially outdated — because the raw input changed, the prompt version drifted, or the notes were manually edited — and make informed decisions about re-extraction.

## User Story

As a user capturing a session, I want to preview the active extraction prompt before I extract, so that I understand what the AI will do with my notes and can go to Settings to adjust it if needed.

As a user reviewing past sessions, I want to see which prompt version was used for each session's extraction, so that I can understand why signals from different time periods look different and make informed decisions about re-extraction.

As a user browsing past sessions, I want to see whether a session's structured notes are stale — because I changed the raw notes, added or removed attachments, or manually edited the output — so that I know which sessions need re-extraction.

---

## Part 1: Session Traceability & Staleness Data Model

### Requirements

- **P1.R1** Add a `prompt_version_id` column (UUID, nullable, FK to `prompt_versions.id`) to the `sessions` table. Nullable because existing sessions were created before this feature — they have no linked prompt version.
- **P1.R2** Add an `extraction_stale` column (boolean, NOT NULL, default `false`) to the `sessions` table. This is a single flag that indicates whether the structured notes are potentially out of sync with reality, for any reason.
- **P1.R3** Add an `updated_by` column (UUID, nullable, FK to `auth.users.id`) to the `sessions` table. Records who last modified the session. Set on every update (PUT). Nullable because existing sessions and new sessions at creation time have no "updater."
- **P1.R4** `extraction_stale` is set to `true` when any of the following occurs via a session update (PUT):
  - Raw notes are modified.
  - An attachment is added to the session.
  - An attachment is removed from the session.
  - Structured notes are manually edited (i.e., structured notes change outside of an extraction flow).
- **P1.R5** `extraction_stale` is reset to `false` when a fresh extraction runs and the session is saved with new structured notes and a new `prompt_version_id`.
- **P1.R6** The extract-signals API response includes the `prompt_version_id` of the prompt it used, so the client can pass it along when saving the session.
- **P1.R7** When a session is saved after signal extraction, the API records the `prompt_version_id` of the active `signal_extraction` prompt at the time of extraction. This happens in the session create (`POST /api/sessions`) and session update (`PUT /api/sessions/[id]`) flows — specifically, whenever `structured_notes` is being saved as a result of extraction.
- **P1.R8** If a session's structured notes are cleared (set to null), the `prompt_version_id` should also be cleared and `extraction_stale` should be reset to `false` (no structured notes means nothing to be stale).
- **P1.R9** If a session is re-extracted, the `prompt_version_id` updates to the prompt version used for the new extraction and `extraction_stale` resets to `false`.
- **P1.R10** On initial session creation (POST), `extraction_stale` is `false` regardless of whether the user edited the structured notes in the markdown panel before saving. The flag tracks post-creation drift, not pre-save refinement.
- **P1.R11** Existing sessions (created before this migration) retain `prompt_version_id = NULL`, `extraction_stale = false`, and `updated_by = NULL`. No backfill is required.
- **P1.R12** `updated_by` is set to the authenticated user's ID on every session update (PUT). It is not set on session creation (POST) — `created_by` already covers that.
- **P1.R13** The sessions list API (`GET /api/sessions`) includes `prompt_version_id`, `extraction_stale`, and `updated_by` in the response payload.

### Acceptance Criteria

- [ ] The `sessions` table has `prompt_version_id`, `extraction_stale`, and `updated_by` columns with correct types, defaults, and constraints.
- [ ] Saving a session with structured notes from extraction records the correct `prompt_version_id` and sets `extraction_stale = false`.
- [ ] Editing raw notes, adding/removing attachments, or manually editing structured notes via PUT sets `extraction_stale = true`.
- [ ] Re-extracting and saving resets `extraction_stale` to `false` and updates `prompt_version_id`.
- [ ] Clearing structured notes clears `prompt_version_id` and resets `extraction_stale` to `false`.
- [ ] `updated_by` is set to the current user's ID on every PUT.
- [ ] Existing sessions have `prompt_version_id = NULL`, `extraction_stale = false`, `updated_by = NULL` and continue to function normally.
- [ ] The sessions list API includes all three new fields in the response.

---

## Part 2: View Prompt on Capture Page

### Requirements

- **P2.R1** Add a "View Prompt" button adjacent to the "Extract Signals" button on the capture form. The button is secondary/ghost styled — visually subordinate to the extract button. It uses an eye icon or similar indicator to communicate "preview."
- **P2.R2** Clicking the button opens a dialog showing the full text of the currently active `signal_extraction` prompt. The dialog is read-only — no editing capability.
- **P2.R3** The dialog includes a footer link "Edit in Settings" that navigates to `/settings` (the prompt editor tab). This keeps the editing friction intentionally high — users must leave the capture flow to change the prompt.
- **P2.R4** The prompt content is fetched when the dialog opens (not pre-loaded on page mount). If the fetch fails, the dialog shows a user-friendly error message.
- **P2.R5** The prompt text is rendered as markdown, consistent with the prompt editor's view mode in Settings.

### Acceptance Criteria

- [ ] A "View Prompt" button appears next to the "Extract Signals" button.
- [ ] Clicking it opens a read-only dialog with the active extraction prompt.
- [ ] The dialog includes an "Edit in Settings" link to `/settings`.
- [ ] The prompt is rendered as markdown, consistent with the Settings prompt editor view mode.
- [ ] If the prompt fetch fails, a clear error message is shown instead.

---

## Part 3: Show Prompt Version in Past Sessions

### Requirements

- **P3.R1** In the expanded session row (the inline editor that appears when a user clicks a row in the past sessions table), display a prompt version indicator near the structured notes section. This is only visible when the session has a non-null `prompt_version_id`.
- **P3.R2** The indicator is a small badge or text link (e.g., "Prompt v3" or "View extraction prompt") that communicates which prompt version produced the structured notes. The version number is derived from the prompt version's position in the version history for its `prompt_key` (sequential, 1-based, ordered by `created_at` ascending).
- **P3.R3** Clicking the indicator opens a dialog showing the full prompt text of that specific version. This is the same dialog pattern used in Part 2 — read-only, monospace, preserved whitespace.
- **P3.R4** For sessions with `prompt_version_id = NULL` (pre-migration sessions), no indicator is shown. The absence communicates "prompt version unknown" without cluttering the UI.
- **P3.R5** The dialog title should distinguish this from the "current active prompt" dialog — e.g., "Extraction Prompt Used" or "Prompt Version 3" — so users understand they are looking at a historical prompt, not the current one.
- **P3.R6** The prompt content is not included in the session list response — it is fetched on demand when the user clicks the indicator (to avoid bloating the session list payload).

### Acceptance Criteria

- [ ] Sessions with a linked prompt version show a version indicator in the expanded row.
- [ ] Clicking the indicator opens a read-only dialog with the exact prompt text used for that extraction.
- [ ] Sessions without a linked prompt version show no indicator.
- [ ] The dialog clearly labels this as a historical prompt version, not the current active prompt.
- [ ] Prompt content is fetched on demand, not included in the session list response.

---

## Part 4: Staleness Indicators & Re-extraction Warnings

### Requirements

- **P4.R1** In the expanded session row, when `extraction_stale = true` and structured notes exist, display a visible indicator near the structured notes section — e.g., a warning badge with text like "Extraction may be outdated." The indicator communicates that the raw input or structured notes have changed since the last extraction.
- **P4.R2** The staleness indicator is visually distinct from the prompt version badge (Part 3). Both can appear simultaneously — a session can be stale *and* show which prompt version produced the current structured notes.
- **P4.R3** When a user triggers re-extraction on a single session (via the "Extract Signals" or "Re-extract" button in the expanded row) and the session has `extraction_stale = true` due to manual edits to structured notes, show a confirmation dialog: "You've manually edited the structured notes since the last extraction. Re-extracting will replace your edits. Continue?" This reuses the existing re-extract confirmation dialog pattern but adds the manual-edit context.
- **P4.R4** When a session has `extraction_stale = true` due to input changes only (raw notes or attachments changed, but structured notes were not manually edited), no extra confirmation is needed beyond the standard re-extract confirmation — the user is re-extracting precisely because the input changed.
- **P4.R5** To support P4.R3 and P4.R4's distinction, the API must track *why* extraction is stale. Add a `structured_notes_edited` column (boolean, NOT NULL, default `false`) to the `sessions` table. This flag is set to `true` only when structured notes are manually modified via PUT outside of an extraction flow. It is reset to `false` when extraction produces fresh structured notes. It remains `false` when `extraction_stale` is `true` due to input changes alone. This column is an internal detail that drives the confirmation UX — `extraction_stale` remains the primary user-facing indicator.
- **P4.R6** In the past sessions table (collapsed row view), sessions with `extraction_stale = true` show a small visual hint — e.g., a subtle warning icon next to the sparkles icon (which indicates structured notes exist). This gives users a table-level scan of which sessions need attention without expanding every row.
- **P4.R7** Add a prompt version filter to the past sessions table filter bar. The filter lists all prompt versions used across the user's sessions (derived from distinct `prompt_version_id` values in the session data), displayed as "Prompt v1", "Prompt v2", etc., ordered newest-first. Selecting a version filters the table to only sessions extracted with that version. An additional option — "No prompt version" — filters to pre-migration sessions with `prompt_version_id = NULL`. This filter is essential infrastructure for the future bulk re-extraction feature (PRD-015).
- **P4.R8** The "Last edited by" information (from `updated_by`) is displayed in the expanded session row — showing the email of the user who last modified the session, alongside the existing "Captured by" information. In personal workspace context (no team), this field is not shown since there is only one user.

### Acceptance Criteria

- [ ] Sessions with `extraction_stale = true` and existing structured notes show a staleness indicator in the expanded row.
- [ ] Sessions with `extraction_stale = true` show a subtle warning hint in the collapsed table row.
- [ ] Re-extracting a session with `structured_notes_edited = true` triggers an enhanced confirmation dialog warning about manual edit loss.
- [ ] Re-extracting a session with only input changes (stale but not manually edited) proceeds with the standard confirmation.
- [ ] The `structured_notes_edited` flag is set correctly: `true` on manual structured notes edit, `false` on extraction or when structured notes are cleared.
- [ ] The prompt version filter appears in the filter bar and correctly filters sessions by prompt version.
- [ ] The "No prompt version" filter option works for pre-migration sessions.
- [ ] "Last edited by" is displayed in the expanded row for team workspace sessions.

---

## Backlog (out of scope for this PRD)

- **Bulk re-extraction (PRD-n).** Admin-only action to select multiple past sessions and re-extract them all with the current active prompt. Depends on the prompt version filter (P4.R7) and staleness tracking (P1, P4) built in this PRD. Includes: batch processing with rate limit management, progress indicator, partial failure reporting, confirmation dialog that flags sessions with `structured_notes_edited = true`, optimistic locking via `updated_at` to prevent overwriting concurrent edits, and a per-operation session cap.
- **Prompt drift warning in master synthesis.** When generating a master signal, warn the user if the included sessions were extracted with multiple different prompt versions (e.g., "5 of 12 sessions were extracted with an older prompt version — results may be inconsistent").
- **Prompt diff view.** Side-by-side comparison between the prompt used for a specific session and the current active prompt, highlighting what changed.
