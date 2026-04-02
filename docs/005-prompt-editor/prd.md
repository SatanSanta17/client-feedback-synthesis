# PRD 005: System Prompt Editor

> **Status:** Implemented — Parts 1–4 complete (2026-03-27)
> **Section:** 005-prompt-editor

---

## Purpose

The AI prompts that drive signal extraction and master signal synthesis are currently hardcoded in TypeScript files. When team members want to tweak extraction behaviour — adjusting signal categories, changing output formatting rules, or tuning synthesis instructions — they need a developer to modify code, review, and deploy.

This feature gives admin users a browser-based editor to modify system prompts without touching code. It includes full version history so the team can track who changed what, compare versions, and revert safely if a prompt change produces worse results.

## User Story

As an admin user, I want to edit the AI system prompts from a settings page in the app, so that I can iterate on extraction and synthesis quality without waiting for a code deployment.

As an admin user, I want to see the history of prompt changes with author and timestamp, so that I can understand what changed and revert to a known-good version if needed.

As a non-admin user, I expect the app to work the same way — the active prompts are used for extraction and synthesis — but I cannot access or modify them.

---

## Part 1: Admin Role System

### Requirements

- **P1.R1** Create a `profiles` table in the `public` schema with `id` (uuid, PK, FK to `auth.users.id`), `email` (text), `is_admin` (boolean, default `false`), `created_at` (timestamptz), and `updated_at` (timestamptz). A database trigger automatically creates a profile row when a new user signs up via Supabase Auth.
- **P1.R2** Seed initial admin(s) by setting `is_admin = true` for designated email addresses in the migration (e.g., `burhanuddin.c@inmobi.com`).
- **P1.R3** Middleware and API routes that serve admin-only resources must check `is_admin` and return 403 if false.
- **P1.R4** The navigation bar conditionally shows a "Settings" link only for admin users.
- **P1.R5** Non-admin users who navigate directly to `/settings` see a "You don't have access" message and are not shown any admin content.

### Acceptance Criteria

- [x] An admin user sees the Settings link in the nav bar.
- [x] A non-admin user does not see the Settings link.
- [x] A non-admin user who hits `/settings` directly sees an access-denied state.
- [x] API routes for prompt management return 403 for non-admin callers.

---

## Part 2: Prompt Storage & Versioning

### Requirements

- **P2.R1** Create a `prompt_versions` table that stores every version of every prompt. Schema must include: `id` (uuid, PK), `prompt_key` (text, one of: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental`), `content` (text, the full prompt body), `author_id` (uuid, FK to auth.users), `author_email` (text, denormalised for display), `created_at` (timestamptz), `is_active` (boolean, only one row per `prompt_key` can be active at a time).
- **P2.R2** Seed the table with the current hardcoded prompts as the initial active versions (author: "system", created_at: migration timestamp).
- **P2.R3** When a new version is saved, the previously active version for that `prompt_key` is set to `is_active = false` and the new row is set to `is_active = true`. This must be atomic (single transaction).
- **P2.R4** The AI service layer reads the active prompt from the database instead of the hardcoded constant. Fall back to the hardcoded default if the database query fails (graceful degradation).
- **P2.R5** RLS policies: only authenticated users with `is_admin = true` can insert into `prompt_versions`. All authenticated users can read active prompts (needed by the AI service). Only admins can read the full version history.

### Acceptance Criteria

- [x] The `prompt_versions` table exists with the correct schema and RLS policies.
- [x] Initial migration seeds the three current prompts as active versions.
- [x] Signal extraction and master signal synthesis use the database-stored active prompt.
- [x] If the database is unreachable, the app falls back to the hardcoded defaults without error.
- [x] Saving a new prompt version atomically deactivates the old one and activates the new one.

---

## Part 3: Prompt Editor UI

### Requirements

- **P3.R1** A `/settings` page accessible only to admins, linked from the nav bar.
- **P3.R2** The page displays two tabs: "Signal Extraction" and "Master Signal". The Master Signal tab dynamically resolves to the cold start or incremental prompt based on whether a master signal already exists (no master signal = cold start prompt, existing master signal = incremental prompt). The user sees a single "Master Signal" tab — the system selects the correct underlying prompt automatically.
- **P3.R3** Each prompt tab shows:
  - A monospace text editor pre-filled with the currently active prompt content.
  - A "Save" button that creates a new version and makes it active.
  - A "Reset to Default" button that creates a new version using the original hardcoded prompt content (this is a version event, not a deletion — the history is preserved).
- **P3.R4** The text editor must be a simple, functional textarea or lightweight code editor. It does not need syntax highlighting, but must:
  - Preserve whitespace and line breaks exactly.
  - Be tall enough to see substantial portions of the prompt without excessive scrolling (minimum ~20 lines visible).
  - Show a character count.
- **P3.R5** On save, show a success toast. On error, show an error toast with a user-friendly message.
- **P3.R6** Unsaved changes trigger a confirmation dialog if the user tries to navigate away or switch prompt tabs.

### Acceptance Criteria

- [x] Admin can navigate to `/settings` and see the two prompt tabs (Signal Extraction, Master Signal).
- [x] Admin can edit a prompt and save it. The new version is immediately active.
- [x] Admin can reset a prompt to the hardcoded default.
- [x] Unsaved changes prompt a confirmation before navigating away.
- [x] Character count updates in real time as the user types.
- [x] Non-admin users cannot access the page.

---

## Part 4: Version History & Revert

### Requirements

- **P4.R1** Each prompt tab includes a "Version History" panel (collapsible or in a side drawer) showing all past versions for that prompt, ordered newest-first.
- **P4.R2** Each history entry shows: version number (sequential per prompt_key), author email, date/time (relative, e.g., "3 days ago"), and a truncated preview of the first ~100 characters.
- **P4.R3** Clicking a history entry opens a read-only view of that version's full content.
- **P4.R4** Each history entry has a "Revert to this version" button. Reverting creates a new version with the old content (preserving full history — no deletions). The revert is attributed to the admin who clicked the button.
- **P4.R5** The currently active version is visually distinguished in the history list (e.g., badge, highlight).

### Acceptance Criteria

- [x] Version history lists all past versions for each prompt, newest first.
- [x] Admin can view the full content of any past version.
- [x] Admin can revert to a past version. This creates a new active version, does not delete history.
- [x] The active version is visually marked in the history list.
- [x] History entries show author, timestamp, and content preview.

---

## Backlog (out of scope for this PRD)

- Diff view: side-by-side comparison between any two prompt versions.
- Prompt testing sandbox: "test this prompt" against a sample session before activating.
- Prompt templates/library: pre-built prompt variants for different session types.
- Audit log: admin action log beyond version history (e.g., "admin X granted admin role to user Y").
- User message template editing (the `buildSignalExtractionUserMessage` and `buildMasterSignalUserMessage` functions are currently not editable — only the system prompts are).
- Per-user prompt overrides (all users share the same active prompts in V1).
