# PRD-002: Capture Tab

> **Master PRD Section:** Section 2 — Capture Tab
> **Status:** Implemented — Parts 1–3 complete (2026-03-25)
> **Deliverable:** User can capture client feedback sessions (client, date, notes) and view/edit/delete past sessions from a table.

## Purpose

The team needs a low-friction way to log client feedback sessions into a shared database. Today, notes live in personal documents, Notion pages, and email threads — disconnected and unsearchable. The Capture tab solves the first-mile problem: get the raw material into a structured, queryable store so that synthesis, analysis, and the feature-advisor agent can consume it later.

This is intentionally minimal. Three fields (client, date, notes), a submit button, and a history table. No AI structuring, no theme tagging, no enrichment — those are future layers built on top of the data this tab collects.

## User Story

As a sales or account team member, I want to quickly log a client feedback session — who the client was, when it happened, and what was discussed — so that the team has a shared record of every conversation and can use it for cross-client analysis later.

---

## Part 1: Database Schema and Client Management

**Scope:** Database tables for clients and sessions, client autocomplete with create-new capability.

### Requirements

- **P1.R1** A `clients` table stores known client names. Each client has a unique `id`, a `name` (unique, case-insensitive), `created_at`, `updated_at`, and `deleted_at` (soft delete) columns.
- **P1.R2** A `sessions` table stores captured feedback sessions. Each session has: `id`, `client_id` (FK to clients), `session_date` (date), `raw_notes` (text, supports markdown), `created_by` (user ID from Supabase Auth), `created_at`, `updated_at`, and `deleted_at` (soft delete).
- **P1.R3** Row-Level Security is enabled on both tables. Only authenticated users can read and write. All queries filter `WHERE deleted_at IS NULL` by default.
- **P1.R4** A client autocomplete API endpoint returns matching client names as the user types. It searches case-insensitively against existing (non-deleted) clients.
- **P1.R5** When the user types a client name that does not exist and selects it, a confirmation prompt is shown: "Create new client '[name]'?" On confirmation, the client record is created and used for the session.

### Acceptance Criteria

- [ ] `clients` table exists with `id`, `name`, `created_at`, `updated_at`, `deleted_at` columns
- [ ] `sessions` table exists with `id`, `client_id`, `session_date`, `raw_notes`, `created_by`, `created_at`, `updated_at`, `deleted_at` columns
- [ ] `client_id` on sessions is a foreign key to clients
- [ ] RLS policies allow only authenticated users to read/write both tables
- [ ] Queries on both tables filter out soft-deleted records by default
- [ ] Client name uniqueness is enforced case-insensitively
- [ ] Autocomplete API returns matching clients for partial input
- [ ] Creating a new client from the autocomplete shows a confirmation prompt before persisting

---

## Part 2: Session Capture Form

**Scope:** The form at the top of the Capture tab for logging new sessions.

### Requirements

- **P2.R1** The Capture tab displays a form with three fields: Client (autocomplete combobox), Session Date (date picker), and Notes (textarea).
- **P2.R2** The Client field is a combobox that searches existing clients as the user types. If the typed name has no match, the user can select a "Create [name]" option which triggers the confirmation prompt (P1.R5).
- **P2.R3** The Session Date field defaults to today's date. The user can change it via a date picker.
- **P2.R4** The Notes field is a textarea with reasonable height (minimum 6 rows, resizable). It accepts plain text or markdown. There is no rich-text editor — just a raw textarea.
- **P2.R5** A "Save Session" button submits the form. All three fields are required — the button is disabled until all fields are filled.
- **P2.R6** On successful save, a success toast is shown, the form is cleared (client and notes reset, date returns to today), and the new session appears in the past sessions table.
- **P2.R7** On save failure (network error, server error), an error toast is shown with a user-friendly message. The form data is preserved so the user can retry.
- **P2.R8** The form validates input client-side (required fields) and server-side (Zod schema validation in the API route).

### Acceptance Criteria

- [ ] Form displays Client combobox, Date picker, and Notes textarea
- [ ] Client combobox searches existing clients and allows creating new ones
- [ ] Date picker defaults to today
- [ ] Notes textarea is resizable with a minimum height of 6 rows
- [ ] Save button is disabled when any field is empty
- [ ] Successful save shows a toast, clears the form, and updates the table below
- [ ] Failed save shows an error toast and preserves form data
- [ ] Server-side validation rejects malformed requests with 400 status

---

## Part 3: Past Sessions Table

**Scope:** A table below the form showing previously captured sessions, with filters, expandable rows, inline editing, and soft delete.

### Requirements

- **P3.R1** Below the capture form, a table displays past sessions with three columns: Client (name), Date (formatted), and Notes (truncated to ~100 characters with ellipsis).
- **P3.R2** The table is sorted by session date descending (most recent first) by default.
- **P3.R3** Above the table, two filters are available: a client name combobox with type-to-search (populated from clients with sessions, no "create new" option) and a date range picker (start date / end date). Filters apply immediately on change. Both filters are optional and can be cleared.
- **P3.R4** Clicking a table row expands it inline to show the full session details: client (editable combobox), date (editable date picker), and full notes (editable textarea).
- **P3.R5** The expanded row has three action buttons: "Save" (persists changes), "Cancel" (discards changes and collapses), and "Delete" (soft deletes the session).
- **P3.R6** On save, the row collapses and a success toast is shown. The table reflects the updated data.
- **P3.R7** On cancel, the row collapses with no changes persisted. Any edits are discarded.
- **P3.R8** On delete, a confirmation dialog is shown: "Delete this session? This action can be undone." On confirmation, the session is soft-deleted (sets `deleted_at`), the row disappears from the table, and a success toast is shown.
- **P3.R9** Only one row can be expanded at a time. If the currently expanded row has unsaved changes and the user clicks another row, a confirmation prompt is shown: "You have unsaved changes. Save or discard?" with "Save," "Discard," and "Cancel" options. Save persists changes then expands the new row. Discard drops changes and expands the new row. Cancel keeps the current row expanded. If there are no unsaved changes, the current row collapses silently and the new row expands.
- **P3.R10** If no sessions exist or no sessions match the active filters, an empty state message is shown: "No sessions found."
- **P3.R11** The table paginates or uses infinite scroll if the dataset grows large. For v1, a simple "Load more" button at the bottom is sufficient, loading 20 sessions at a time.

### Acceptance Criteria

- [ ] Table renders below the form with Client, Date, and Notes (truncated) columns
- [ ] Sessions are sorted by date descending
- [ ] Client filter combobox supports type-to-search and lists clients that have sessions
- [ ] Date range filter limits sessions to the selected range
- [ ] Filters can be cleared individually
- [ ] Clicking a row expands it inline with editable fields
- [ ] Expanded row shows Save, Cancel, and Delete buttons
- [ ] Save persists changes, collapses the row, and shows a success toast
- [ ] Cancel collapses the row without saving
- [ ] Delete shows a confirmation dialog, soft-deletes on confirm, removes the row, and shows a toast
- [ ] Only one row is expanded at a time
- [ ] Expanding another row while current row has unsaved changes shows a Save/Discard/Cancel prompt
- [ ] Save in the prompt persists changes and expands the new row
- [ ] Discard in the prompt drops changes and expands the new row
- [ ] Cancel in the prompt keeps the current row expanded
- [ ] Empty state message displays when no sessions match
- [ ] "Load more" button appears when there are more than 20 sessions

---

## Backlog (deferred from this PRD)

- AI-powered structuring ("Structure with AI" button that sends raw notes to Claude and returns extracted fields like attendees, pain points, feature requests, action items)
- Theme tagging on sessions (manual or AI-suggested)
- Session type field (discovery, QBR, check-in, etc.)
- Attendees field
- Markdown preview/rendering in the notes textarea
- Bulk operations on the past sessions table (multi-select, bulk delete)
- Export sessions to CSV
- Full-text search across notes content
