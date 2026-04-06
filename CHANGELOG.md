# Changelog — Synthesiser

All notable changes to this project are documented here, grouped by PRD and part number.

---

## [Unreleased]

### PRD-012 Part 2: DRY — Shared Utilities and Patterns — 2026-04-07
- Created `lib/cookies/active-team.ts` — single source of truth for client-side `active_team_id` cookie operations (`getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie`), replacing 7+ inline implementations
- Added reactive `activeTeamId` and `setActiveTeam()` to AuthProvider context — workspace switching now updates React state instead of calling `window.location.reload()`, enabling reactive data refetching across all consuming components
- Extracted `fetchCanCreateTeam` helper within `auth-provider.tsx` — deduplicated profile query used by both auth paths
- Created `lib/hooks/use-signal-extraction.ts` — shared extraction state machine hook (`ExtractionState`, re-extract confirmation flow, `resetExtraction`) consumed by `session-capture-form.tsx` and `expanded-session-row.tsx`
- Created `components/capture/reextract-confirm-dialog.tsx` — shared presentational re-extract confirmation dialog
- Created `components/auth/auth-form-shell.tsx` — shared centered auth card layout (`title`, `subtitle`, `children`), replacing 4× duplicated full-screen centering markup in login, signup, forgot-password, and reset-password forms
- Created `components/auth/email-confirmation-panel.tsx` — shared "Check your email" success panel (`children`, `linkText`, `linkHref`), replacing 2× duplicated confirmation UI in signup and forgot-password forms
- Created `lib/utils/map-ai-error.ts` — `mapAIErrorToResponse()` shared AI error-to-HTTP mapper handling 5 error types + unexpected fallback, replacing 2× duplicated ~70-line catch blocks in `extract-signals/route.ts` and `generate-master-signal/route.ts`
- Created `components/settings/role-picker.tsx` — controlled `RolePicker` component with exported `Role` type, replacing 3× duplicated role select + type definitions in `invite-single-form.tsx`, `invite-bulk-dialog.tsx`, and `pending-invitations-table.tsx`

### PRD-012 Part 1: Design Tokens and Typography — 2026-04-07
- Added 14 status colour tokens (`--status-error`, `--status-success`, `--status-warning`, `--status-info` with `-light`, `-border`, `-text` variants) and 4 AI action tokens (`--ai-action`, `--ai-action-foreground`, `--ai-action-hover`, `--ai-action-light`) to `globals.css` using oklch colour space
- Added `ai` button variant (warm gold) to `button.tsx` CVA config
- Applied `variant="ai"` to Extract Signals, Re-extract Signals, and Generate Master Signal buttons
- Replaced all hardcoded Tailwind status colours (`text-red-500`, `bg-red-50`, `bg-green-50`, `text-green-500`, `bg-amber-*`, `text-amber-*`, `bg-blue-*`, `text-blue-*`) with CSS custom property tokens across 14 files
- Migrated `invite-shell.tsx` StatusIcon colour map from hardcoded Tailwind classes to token references
- Replaced `window.location.href = "/capture"` with `router.push("/capture")` in `login-form.tsx` and `reset-password-form.tsx`
- Replaced all `text-[10px]` arbitrary font sizes with `text-xs` across 5 files

### PRD-013 Part 4: Edge Cases & Limits — 2026-04-06
- Replaced hardcoded `.max(50000)` with `MAX_COMBINED_CHARS` constant in `extract-signals/route.ts`, `sessions/route.ts`, `sessions/[id]/route.ts`, and `session-capture-form.tsx` — server and client now reference the same shared limit
- Added input length logging to the extract-signals route before AI calls

### PRD-013 UI Polish — 2026-04-06
- Made the entire file upload zone clickable (not just the "browse" link) — added `onClick` on the container div, `cursor-pointer` styling, and hover feedback
- Moved the attachments section (upload zone, saved/pending lists, character counter) below raw notes inside the left column of the expanded session row grid
- Made saved attachment rows fully clickable to toggle expand/collapse — added `e.stopPropagation()` on download/delete buttons to prevent unintended toggles

### Bug Fix: PDF Parsing — 2026-04-06
- Downgraded `pdf-parse` from v2.4.5 to v1.1.1 — v2 depends on `DOMMatrix` and other browser APIs unavailable in Vercel's serverless runtime
- Fixed import to `pdf-parse/lib/pdf-parse` to bypass v1's test-file-loading entrypoint (`ENOENT: ./test/data/05-versions-space.pdf`)
- Removed `@types/pdf-parse` (v2 types); added custom type declaration in `types/pdf-parse.d.ts`

### Docs: Storage Bucket Name Correction — 2026-04-06
- Updated ARCHITECTURE.md, CHANGELOG.md, PRD-013, and TRD-013 to reference the actual Supabase Storage bucket name (`SYNTHESISER_FILE_UPLOAD`) instead of the previously documented `session-attachments`

### PRD-013 Part 3: Past Sessions — Attachment Display & Management — 2026-04-02
- Added `attachment_count` to `SessionWithClient` with batch-fetch in `getSessions()` — displays paperclip icon with count in collapsed session rows
- Created `GET /api/sessions/[id]/attachments` — returns non-deleted attachments for a session
- Created `GET /api/sessions/[id]/attachments/[attachmentId]/download` — generates signed download URL
- Created `saved-attachment-list.tsx` — displays persisted attachments with download, delete (with confirmation when signals exist), and view parsed content toggle
- Updated `expanded-session-row.tsx` — full attachment management: fetch saved attachments on mount, upload new via `FileUploadZone`, delete existing, compose AI input from all attachments, two-step save flow
- Relaxed `PUT /api/sessions/[id]` validation to allow empty `rawNotes` when `hasAttachments` is true
- **Code quality audit:**
  - Extracted `FILE_ICONS` to `lib/constants/file-icons.ts` — shared by `attachment-list.tsx` and `saved-attachment-list.tsx`
  - Extracted `composeAIInput()` to `lib/utils/compose-ai-input.ts` — shared by `session-capture-form.tsx` and `expanded-session-row.tsx`
  - Extracted `uploadAttachmentsToSession()` to `lib/utils/upload-attachments.ts` — shared by `session-capture-form.tsx` and `expanded-session-row.tsx`
  - Renamed `checkSessionWriteAccess` → `checkSessionAccess` — accurately reflects its use for both read and write operations

### PRD-013 Part 2: Persistence & Signal Extraction Integration — 2026-04-02
- Created `session_attachments` table with RLS (personal + team-scoped) and `SYNTHESISER_FILE_UPLOAD` Storage bucket
- Created `lib/services/attachment-service.ts` — `uploadAndCreateAttachment`, `getAttachmentsBySessionId`, `deleteAttachment` (soft-delete DB + hard-delete Storage), `getSignedDownloadUrl`, `getAttachmentCountForSession`
- Created `POST /api/sessions/[id]/attachments` — multipart upload endpoint with file size/type/count validation
- Created `DELETE /api/sessions/[id]/attachments/[attachmentId]` — soft-delete attachment + hard-delete from Storage
- Updated `POST /api/sessions` — relaxed `rawNotes` to allow empty when `hasAttachments` is true
- Updated `session-capture-form.tsx` — two-step save flow (save session JSON → upload attachments via multipart)
- Updated `attachment-list.tsx` — added "View content" toggle showing parsed text read-only
- Extracted `checkSessionWriteAccess` shared helper to `app/api/sessions/_helpers.ts` — eliminates duplicated auth/permission checks across `[id]/route.ts`, attachments POST, and attachments DELETE routes
- Extracted `formatFileSize` to `lib/utils/format-file-size.ts` — shared by `file-upload-zone.tsx` and `attachment-list.tsx`
- Removed unused `getActiveTeamId` import from `attachment-service.ts`

### PRD-013 Part 1: File Upload Infrastructure — 2026-04-02
- Created `lib/constants.ts` with file upload limits (`MAX_FILE_SIZE_BYTES`, `MAX_COMBINED_CHARS`, `MAX_ATTACHMENTS`, `ACCEPTED_FILE_TYPES`, `ACCEPTED_EXTENSIONS`)
- Created `lib/services/file-parser-service.ts` with parsers for TXT, PDF, CSV, DOCX, JSON files and WhatsApp/Slack chat format detection and restructuring
- Created `POST /api/files/parse` stateless API route — accepts `multipart/form-data`, validates file, returns parsed content with `source_format`
- Created `file-upload-zone.tsx` — drag-and-drop upload zone with inline validation, multi-file support, and server-side parse calls
- Created `attachment-list.tsx` — displays attached files with type icon, size, format badge, and remove button
- Integrated file attachments into `session-capture-form.tsx` — combined character counter (notes + attachments vs 50k limit), composed AI input merges raw notes with attachment content, attachments sent in save payload, form reset clears attachments
- Installed `pdf-parse`, `mammoth`, `papaparse` npm packages with TypeScript type definitions

### PRD-011: Email + Password Authentication — 2026-04-02
- **Part 1 — Sign-Up & Sign-In:** Created `/signup` page with email/password form (Zod validation: 8+ chars, 1 digit, 1 special char), email confirmation flow via Supabase, and Google OAuth button. Updated `/login` with email/password form alongside existing Google OAuth. Added shared `PasswordInput` component (toggleable show/hide) and `passwordField` Zod schema in `lib/schemas/password-schema.ts`. Created `GoogleIcon` shared component.
- **Part 2 — Password Reset:** Created `/forgot-password` page (sends reset email via `supabase.auth.resetPasswordForEmail` with `type=recovery` redirect). Created `/reset-password` page (new password + confirm, calls `supabase.auth.updateUser`). Auth callback handles `type=recovery` and redirects to reset page.
- **Part 3 — Invite Flow:** Updated `/invite/[token]` with four states: authenticated + email match (accept card), authenticated + mismatch (warning + sign-out option), unauthenticated + existing user (sign-in form with pre-filled email), unauthenticated + new user (sign-up form with pre-filled email). Email match verification in auth callback prevents wrong-account acceptance. Created `invite-sign-in-form.tsx`, `invite-sign-up-form.tsx`, `invite-accept-card.tsx`, `invite-mismatch-card.tsx`, `invite-shell.tsx`, `invite-helpers.ts`.
- **Part 4 — Middleware:** Added `/signup`, `/forgot-password`, and `/invite/*` to public routes. `/reset-password` requires authentication (user arrives via recovery link which establishes session). Authenticated users redirected away from auth pages to `/capture`.

### Workspace Switcher: Always Visible + Create Team in Dropdown — 2026-04-02
- Workspace switcher now renders for all authenticated users (not just those with teams)
- Shows a skeleton shimmer while loading instead of disappearing
- "Create Team" option moved inside the dropdown (gated by `canCreateTeam`)
- Non-paid users see a disabled "Team workspaces — contact us" hint (passive CTA)
- Standalone "Create Team" button removed from app header
- `CreateTeamDialog` converted to controlled component (`open`/`onOpenChange` props)
- Fixed `router.refresh()` → `window.location.reload()` in both workspace switcher and create team dialog

### Email Provider: Add Brevo Adapter — 2026-04-02
- Added Brevo adapter to `email-service.ts` using `@getbrevo/brevo` SDK
- `EMAIL_PROVIDER` now supports `resend` and `brevo` — switch via env var
- Added `BREVO_API_KEY` env var; only the active provider's key is required
- Added `parseFromAddress()` helper to extract name/email from `EMAIL_FROM` format
- Resend adapter unchanged

### PRD-010 Part 7: Team Management — Members, Roles, and Ownership — 2026-04-02
- Added team management service functions: `renameTeam`, `deleteTeam`, `removeMember`, `changeMemberRole`, `transferOwnership`, `leaveTeam` (with `LeaveBlockedError`)
- Created API routes: `GET/PATCH/DELETE /api/teams/[teamId]`, `GET /api/teams/[teamId]/members`, `DELETE /api/teams/[teamId]/members/[userId]`, `PATCH /api/teams/[teamId]/members/[userId]/role`, `POST /api/teams/[teamId]/transfer`, `POST /api/teams/[teamId]/leave`
- Owner can rename/delete team, remove any member, change roles, transfer ownership
- Admin can remove sales members; sales have no management actions (except leave)
- Owner leaving auto-transfers ownership to the oldest admin; blocked if no other admins exist
- Created `team-members-table.tsx`: member list with contextual actions (remove, role change, transfer, leave) and confirmation dialogs
- Created `team-danger-zone.tsx`: rename input + delete button with type-to-confirm safety dialog (owner only)
- Updated `team-settings.tsx` to integrate members table and danger zone
- Updated `settings-page-content.tsx` to resolve and pass `ownerId`, `isOwner` to team settings

### PRD-010 Part 6: Team-Scoped Master Signal and Prompts — 2026-04-02
- Scoped all `master-signal-service.ts` functions by `team_id` via `getActiveTeamId()`: `getLatestMasterSignal`, `getStaleSessionCount`, `getAllSignalSessions`, `getSignalSessionsSince`, `saveMasterSignal`
- Scoped all `prompt-service.ts` functions by `team_id`: `getActivePrompt`, `getPromptHistory`, `savePromptVersion` (deactivation scoped to workspace)
- Added admin role check to `POST /api/ai/generate-master-signal` and `POST /api/prompts` in team context (403 for sales)
- Master signal page hides generate button for non-admin team members, shows info banner
- Prompt editor accepts `readOnly` prop — sales members see prompts in view-only mode with info banner
- `VersionHistoryPanel` and `VersionViewDialog` hide revert buttons when `onRevert` is not provided
- `SettingsPageContent` passes `readOnly` for non-admin team members

### PRD-010 Part 5: Team-Scoped Data — Sessions and Clients — 2026-04-02
- Scoped `getSessions` and `createSession` by `team_id` via `getActiveTeamId()` in `session-service.ts`
- Scoped `searchClients` and `createNewClient` by `team_id` in `client-service.ts`
- `taintLatestMasterSignal` accepts optional `teamId` for team-scoped tainting
- `deleteSession` passes `team_id` to taint function
- Added `checkTeamSessionPermission` to `PUT/DELETE /api/sessions/[id]` — sales can only modify own sessions, admins can modify any
- Added "Captured by" column in past sessions table (team context only, shows email local part)
- `SessionRow` interface includes `created_by` and `created_by_email`
- `ExpandedSessionRow` accepts `canEdit` — read-only view with "View only" message for non-permitted users
- `MarkdownPanel` accepts `readOnly` prop to hide edit toggle
- Resolved creator emails via `profiles` table in `getSessions` for team attribution

### PRD-010 Part 4: Workspace Switcher and Context Management — 2026-04-02
- Added `getActiveTeamId()` to `lib/supabase/server.ts` for reading the `active_team_id` cookie server-side
- Middleware validates `active_team_id` cookie on every request — clears if user is no longer a team member
- Created `workspace-switcher.tsx`: dropdown showing Personal + all teams with roles, sets/clears cookie on switch
- Integrated workspace switcher into `app-header.tsx` (visible only when user has team memberships)
- Created `GET /api/teams` route to list user's teams with roles

### PRD-010 Part 3: Invite Acceptance and Join Flow — 2026-04-02
- Created `/invite/[token]` server page with `InvitePageContent` client component
- Handles four states: valid (join), expired, already accepted, invalid — with appropriate UI for each
- Authenticated users see "Accept & Join Team" button (calls `POST /api/invite/[token]/accept`)
- Unauthenticated users see "Sign in with Google to join" (sets `pending_invite_token` cookie, redirects through OAuth)
- Auth callback (`/auth/callback`) checks for `pending_invite_token` cookie, auto-accepts invitation and sets `active_team_id`
- Added `getInvitationByToken` and `acceptInvitation` to `invitation-service.ts` (service role client for RLS bypass)
- Middleware allows `/invite` as a public route

### PRD-010 Part 2: Team Creation and Invite Flow — 2026-04-02
- Created `team-service.ts` with `createTeam`, `getTeamsForUser`, `getTeamById`, `getTeamMember`, `getActiveTeamMembers`
- Created `invitation-service.ts` with `createInvitations`, `getPendingInvitations`, `revokeInvitation`, `resendInvitation`
- Created invite email template in `lib/email-templates/invite-email.ts`
- Created API routes: `POST /api/teams`, `GET/POST /api/teams/[teamId]/invitations`, `DELETE/POST .../[invitationId]`, `.../[invitationId]/resend`
- Created `create-team-dialog.tsx` for team creation (visible when `can_create_team = true`)
- Created `team-settings.tsx`, `invite-single-form.tsx`, `invite-bulk-dialog.tsx`, `pending-invitations-table.tsx`
- Created `settings-page-content.tsx` wrapping prompt editor and team settings in tabs (admin only)

### PRD-010 Part 1: Database Schema and Email Service — 2026-04-02
- Created `teams`, `team_members`, `team_invitations` tables with RLS policies
- Added `can_create_team` to `profiles` table
- Added nullable `team_id` column to `sessions`, `clients`, `master_signals`, `prompt_versions`
- Created helper functions: `is_team_member()`, `get_team_role()`, `is_team_admin()` (SECURITY DEFINER)
- Created provider-agnostic `email-service.ts` with `sendEmail()`, `resolveEmailProvider()`, Resend adapter
- Added `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` env vars

### PRD-009 Part 1: AI Provider Abstraction — 2026-04-02
- Replaced `@anthropic-ai/sdk` with the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`)
- Replaced `callClaude()` with provider-agnostic `callModel()` using `generateText()` from the Vercel AI SDK
- Added `resolveModel()` factory that reads `AI_PROVIDER` and `AI_MODEL` env vars and returns the correct SDK model instance
- Supports Anthropic, OpenAI, and Google providers at launch — switching is a one-line env var change
- Replaced Anthropic-specific error class checks with generic `APICallError` status code inspection for retry logic
- Replaced `CLAUDE_MODEL` env var with `AI_PROVIDER` + `AI_MODEL`
- Public API (`extractSignals`, `synthesiseMasterSignal`) unchanged — no caller modifications
- Updated `.env.example`, `ARCHITECTURE.md`, `CLAUDE.md`

### PRD-008 Part 3: Remove Admin Role System — 2026-04-02
- Removed admin gate from Settings page — all authenticated users can access `/settings` and customise their prompts
- Settings tab now visible in navigation for all users
- Removed `isCurrentUserAdmin()` checks from `GET /api/prompts` and `POST /api/prompts` — access control handled by RLS
- Removed `isAdmin` from `AuthProvider` context and `AuthContextValue` interface
- Deleted `lib/hooks/use-profile.ts` (only fetched the admin flag)
- Removed `isCurrentUserAdmin()` from `profile-service.ts` — `getCurrentProfile()` retained
- `is_admin` column on `profiles` and `is_admin()` SQL function retained in database for potential future use

### PRD-008 Part 2: Per-User Data Isolation — 2026-04-02
- Added `created_by` column to `clients` table with per-user RLS policies and unique index `(LOWER(name), created_by)`
- Updated RLS policies on `sessions` — SELECT and UPDATE now scoped to `created_by = auth.uid()`
- Updated RLS policy on `master_signals` — SELECT now scoped to `created_by = auth.uid()`
- Added `created_by` column to `prompt_versions` table with per-user RLS policies and unique index `(prompt_key, created_by)`
- `taintLatestMasterSignal` now accepts a `userId` parameter to target the correct user's master signal
- `deleteSession` passes the session's `created_by` to the taint function
- `getActivePrompt` and `savePromptVersion` switched from service role client to user-scoped `createClient()` — RLS handles per-user scoping
- System-seeded prompt rows (`created_by = NULL`) are no longer visible via RLS; users fall back to hardcoded defaults

### PRD-008 Part 1: Remove Email Domain Restriction — 2026-04-02
- Removed `ALLOWED_EMAIL_DOMAIN` environment variable and email domain check from the OAuth callback — any Google account can now sign in
- Simplified `app/auth/callback/route.ts` — after successful code exchange, redirects straight to `/capture`
- Removed `domain_restricted` error block from the login page
- Deleted `lib/constants.ts` (its only export was `ALLOWED_EMAIL_DOMAIN`)
- Removed unused `useSearchParams` / `Suspense` from login page
- Updated `.env.example`, `ARCHITECTURE.md`, `CLAUDE.md`

### Rebrand: Accelerate Synthesis → Synthesiser — 2026-04-02
- Renamed product from "Accelerate Synthesis" to "Synthesiser" across all UI, metadata, and PDF output
- Removed InMobi and ad-tech specific context from all AI prompts (signal extraction, master signal cold start, master signal incremental) — prompts are now industry-agnostic
- Made login page domain restriction error message generic ("Access restricted to authorised email domains") instead of hardcoded "@inmobi.com"
- Updated package name from "accelerate-synthesis" to "synthesiser"
- Updated all documentation (ARCHITECTURE.md, CLAUDE.md, master PRD, section PRDs/TRDs, seed SQL)

### PRD-007 Part 1: Prompt Editor — View Alternate Master Signal Prompt — 2026-03-30
- Added contextual note above the editor on the Master Signal tab explaining which prompt variant is loaded (cold-start or incremental) and when it's used
- Added inline toggle link to switch between cold-start and incremental prompts without leaving the tab
- Both prompt variants are fully editable — save, reset to default, version history, and revert all work on the toggled variant
- Auto-selected prompt (based on app state) shows an "(active)" badge; alternate prompt does not
- Toggle respects the existing dirty-state guard — switching with unsaved changes triggers the discard confirmation dialog
- Toggle resets when switching between top-level tabs (Signal Extraction ↔ Master Signal)
- New state (`isViewingAlternate`) and derived keys (`autoSelectedMasterKey`, `alternateMasterKey`, `displayedMasterKey`, `effectiveKey`) in `prompt-editor-page-content.tsx`

### PRD-006 Part 1 Increments 1.1–1.3: Master Signal Cleanup on Session Deletion — 2026-03-30
- Added `is_tainted` (BOOLEAN, default false) column to `master_signals` table
- When a session with `structured_notes` is soft-deleted, the latest master signal is marked as tainted via `taintLatestMasterSignal()` in `master-signal-service.ts` (best-effort, doesn't fail the deletion)
- `deleteSession()` in `session-service.ts` now selects `structured_notes` and conditionally taints the master signal
- `POST /api/ai/generate-master-signal` checks `isTainted` on the latest master signal — if tainted, forces a cold-start rebuild (all active sessions) instead of incremental merge, purging deleted session data
- `GET /api/master-signal` response now includes `isTainted` flag
- Master Signal page (`/m-signals`) shows a tainted-specific amber banner: "A session with extracted signals was deleted — regenerate to remove its data from the master signal." (takes priority over standard staleness banner; combines both messages when both conditions are true)
- Settings page (`/settings`) prompt editor now resolves the Master Signal tab to the cold-start prompt when the master signal is tainted, since that's the prompt that will be used on the next generation
- `MasterSignal` TypeScript interface updated with `isTainted: boolean` across service, API, and frontend layers

### PRD-005 UX Improvement: Dynamic Master Signal Tab — 2026-03-27
- Consolidated three prompt tabs into two: "Signal Extraction" and "Master Signal"
- The Master Signal tab dynamically resolves to the cold start or incremental prompt by checking `GET /api/master-signal` on mount — if a master signal exists, edits the incremental prompt; otherwise edits the cold start prompt
- Removed the confusing cold start / incremental distinction from the UI; the system selects the correct prompt automatically

### PRD-005 Part 4 Increment 4.2: Version View Dialog + Revert Wiring — 2026-03-27
- Created `version-view-dialog.tsx`: read-only dialog showing full prompt content for any past version, with version number, active badge, author email, relative timestamp in the header, and "Revert to this version" button (hidden for active version)
- Wired "View" button in version history panel to open the dialog with the selected version's content
- Wired "Revert" button in both the history panel and the dialog to POST the old content as a new active version and refetch history
- Dialog closes automatically after a successful revert

### PRD-005 Part 4 Increment 4.1: Version History Panel — 2026-03-27
- Created `format-relative-time.ts` utility for relative timestamps ("just now", "5m ago", "3h ago", "2d ago", or formatted date for older entries)
- Created `version-history-panel.tsx`: collapsible panel below the editor action bar showing all prompt versions newest-first, with computed version numbers (oldest = v1), "Active" badge, author email, relative timestamp, 100-char content preview, and View/Revert buttons
- Modified `prompt-editor-page-content.tsx` to store history from API response, render the panel, toggle open/closed, and handle revert via existing POST endpoint

### PRD-005 Part 3 Increments 3.1–3.2: Prompt Editor UI — 2026-03-27
- Created `prompt-editor.tsx`: monospace textarea component with full-height flex layout, loading skeleton, and spellcheck disabled
- Created `prompt-editor-page-content.tsx`: main client component with tab layout (signal extraction, master signal cold start, master signal incremental), API fetch on tab switch, dirty tracking (originalContent vs currentContent), save handler (POST to /api/prompts), reset-to-default handler (POST hardcoded default), character count, unsaved changes dialog on tab switch, and `beforeunload` guard for browser navigation
- Updated `app/settings/page.tsx` to render `PromptEditorPageContent` for admin users
- Full-width/full-height editor layout using flex column chain from layout → page → tabs → textarea

### PRD-005 Part 2 Increment 2.3: Prompt API Routes — 2026-03-27
- Created `GET /api/prompts?key=<prompt_key>`: returns active prompt and full version history, admin-only (403 for non-admins)
- Created `POST /api/prompts`: saves a new prompt version and makes it active, Zod-validated input, admin-only
- Both routes use `isCurrentUserAdmin()` guard and return appropriate HTTP status codes

### PRD-005 Part 2 Increment 2.2: Prompt Service + AI Service Integration — 2026-03-27
- Created `lib/services/prompt-service.ts` with `getActivePrompt()` (service role client), `getPromptHistory()` (anon client), and `savePromptVersion()` (service role client, atomic deactivate + insert)
- Modified `lib/services/ai-service.ts` to read active prompts from the database with hardcoded fallback — `extractSignals()` reads `signal_extraction`, `synthesiseMasterSignal()` reads `master_signal_cold_start` or `master_signal_incremental`
- Hardcoded prompt constants in `lib/prompts/` retained as fallback defaults

### PRD-005 Part 1 Increments 1.2–1.3: Admin Role System — 2026-03-27
- Created `lib/services/profile-service.ts` with `getCurrentProfile()` and `isCurrentUserAdmin()` (server-side, anon client respecting RLS)
- Created `lib/hooks/use-profile.ts` with `useProfile()` hook for fetching admin flag from the browser client
- Extended `AuthProvider` with `isAdmin` via `useProfile` hook; `isLoading` now includes profile fetch to prevent UI flicker
- Modified `tab-nav.tsx` to conditionally show Settings tab for admin users
- Created `app/settings/page.tsx` with server-side admin gate (access-denied state for non-admins)

### PRD-005 Part 1 Increment 1.1 + Part 2 Increment 2.1: Database Migrations — 2026-03-27
- Created `profiles` table with FK to `auth.users`, `is_admin` flag, RLS (users can read own profile), auto-create trigger on signup, backfill for existing users, initial admin seed
- Created `prompt_versions` table with CHECK constraint on `prompt_key`, `is_active` flag, partial unique index (one active per key), RLS via `SECURITY DEFINER` `is_admin()` function
- Seeded three initial prompt versions (signal extraction, master signal cold start, master signal incremental) from hardcoded defaults

### PRD-004 Part 1 Increment 1.5: PDF Download — 2026-03-26
- Installed `pdf-lib` for client-side PDF generation (no server round-trip needed)
- Implemented `master-signal-pdf.ts` using pdf-lib: parses master signal markdown into headings, paragraphs, bullets, and numbered lists, renders them as a styled A4 PDF with branded header, metadata bar, word wrapping, and automatic page breaks
- "Download PDF" button dynamically imports pdf-lib to avoid bloating the initial bundle, generates the PDF in-browser, and triggers a file download
- PDF includes: indigo-branded title bar, generation timestamp + session count, all markdown sections with proper heading hierarchy, bullet/numbered lists, and horizontal rules

### PRD-004 Part 1 Increment 1.4: Frontend Page + Tab Navigation — 2026-03-26
- Created `/m-signals` page with server component and `MasterSignalPageContent` client component
- Page states: loading spinner, empty (no sessions), empty (ready to generate with session count), has master signal (rendered markdown)
- Staleness banner: amber warning showing count of new/updated sessions since last generation
- Generate button: "Generate Master Signal" (cold start) / "Re-generate" (incremental), Loader2 spinner during generation, disabled during processing
- Download PDF button: initially used browser print-to-PDF, replaced in Increment 1.5 with client-side pdf-lib generation
- Metadata bar below header shows generation timestamp and session count
- Master signal content rendered with `react-markdown` + `remark-gfm` + prose styling
- Error handling: toast on API failure, previous master signal preserved on screen
- Added "Master Signals" tab (BarChart3 icon) to `tab-nav.tsx` at `/m-signals`

### PRD-004 Part 1 Increment 1.3: API Routes — 2026-03-26
- Created `POST /api/ai/generate-master-signal` route: triggers cold start or incremental master signal generation via Claude, persists result, returns unchanged if no new sessions since last generation, maps AI errors to user-friendly HTTP responses
- Created `GET /api/master-signal` route: returns the latest master signal and a staleness count (number of sessions updated since last generation)
- Both routes include auth checks (401 if unauthenticated)
- Failed generation never overwrites a good previous master signal

### PRD-004 Part 1 Increment 1.2: AI Prompt + Synthesis Function — 2026-03-26
- Created `lib/prompts/master-signal-synthesis.ts` with two system prompts: cold start (full synthesis from all sessions) and incremental (merge new sessions into existing master signal), plus a user message builder that formats sessions as labeled blocks
- Added `synthesiseMasterSignal()` to `lib/services/ai-service.ts`: accepts sessions + optional previous master signal, selects the appropriate prompt, returns synthesised markdown
- Refactored `ai-service.ts` to extract shared retry logic into a private `callClaude()` helper — both `extractSignals()` and `synthesiseMasterSignal()` use it, eliminating duplicated retry code
- Master signal uses `max_tokens: 8192` (vs 4096 for individual extraction) to accommodate the larger synthesised output

### PRD-004 Part 1 Increment 1.1: Master Signal Database Table + Service Layer — 2026-03-26
- Created `master_signals` table in Supabase: immutable rows, each generation inserts a new snapshot, latest by `generated_at` is the current one
- RLS: authenticated users can SELECT and INSERT (no UPDATE/DELETE — rows are immutable)
- Index: `master_signals_generated_at_idx` (DESC) for fast "get latest" queries
- Created `lib/services/master-signal-service.ts` with five functions: `getLatestMasterSignal`, `getStaleSessionCount`, `getAllSignalSessions`, `getSignalSessionsSince`, `saveMasterSignal`
- SQL migration script saved at `docs/004-master-signals/001-create-master-signals-table.sql`

### Bug Fix: Session Delete + Client Combobox UX — 2026-03-26
- Fixed soft-delete failing due to RLS `WITH CHECK (deleted_at IS NULL)` blocking updates that set `deleted_at`: `deleteSession()` now uses a service role client to bypass RLS for this server-only admin operation
- Added `createServiceRoleClient()` factory to `lib/supabase/server.ts`
- Revamped `ClientCombobox` from a popover/combobox pattern to a type-to-create-first text input: typing defaults to "create new client", existing matches appear as suggestions below, "Create" option is always listed first when the name doesn't exactly match an existing client
- Removed dependency on `cmdk` Command/Popover components from the client combobox (now uses a plain input with a custom dropdown)

### PRD-003 Part 4: Past Sessions — Side-by-Side View with Signal Extraction — 2026-03-26
- Restructured expanded rows in `PastSessionsTable` with a two-column CSS grid layout (`grid-cols-1 md:grid-cols-2`)
- Left column: raw notes displayed in a read-only-by-default `MarkdownPanel` (rendered markdown with edit toggle)
- Right column: structured notes panel with Extract Signals / Re-extract button, empty state, loading spinner, and `MarkdownPanel` for viewing/editing extracted signals
- Added Sparkles icon indicator on collapsed rows for sessions that have structured notes (enriched sessions)
- Signal extraction in expanded rows mirrors the capture form: calls `POST /api/ai/extract-signals`, icon progression (Sparkles → Loader2 → RefreshCw), re-extraction confirmation dialog when structured notes have been edited
- Updated dirty tracking to include `structuredNotes` comparison against the original session value
- Save payload from expanded rows now includes `structuredNotes` (preserves existing value if unchanged, sends updated value if modified or newly extracted)
- Replaced raw `Textarea` import with `MarkdownPanel` for both raw notes and structured notes display

### PRD-003 Part 3: Capture Form — Extract Signals UX — 2026-03-26
- Added `react-markdown`, `remark-gfm`, and `@tailwindcss/typography` dependencies for markdown rendering
- Configured `@tailwindcss/typography` plugin via `@plugin` directive in `globals.css`
- Created `MarkdownPanel` component (`markdown-panel.tsx`) — reusable view/edit panel with rendered markdown preview (prose styling) and raw markdown textarea edit mode, toggled via Eye/Pencil icons
- Added "Extract Signals" button to `SessionCaptureForm` with icon progression: Sparkles (idle) → Loader2 spinner (extracting) → RefreshCw (re-extract)
- Extraction calls `POST /api/ai/extract-signals`, displays structured output in a `MarkdownPanel` below the notes field
- Structured notes are editable in the panel — users can reword, add, or remove signals before saving
- Re-extraction with dirty (edited) structured notes shows a confirmation dialog before overwriting
- Save payload now includes `structuredNotes` (null if not extracted); extraction state resets on successful save
- Signal extraction is optional — sessions can be saved with only raw notes

### PRD-003 Part 2: Signal Extraction via Claude API — 2026-03-26
- Added `POST /api/ai/extract-signals` endpoint that accepts raw session notes and returns a structured markdown signal report via Claude
- Created `lib/prompts/signal-extraction.ts` with the system prompt defining all signal categories (Pain Points, Must-Haves, Aspirations, Competitive Mentions, Blockers, Platforms & Channels, Current Stack, Other/Uncategorised) plus session-level attributes (Summary, Sentiment, Urgency, Decision Timeline) and Client Profile
- Created `lib/services/ai-service.ts` with `extractSignals()` function, exponential backoff retry (up to 3 retries for 429/500/timeout), and typed error classes (`AIServiceError`, `AIEmptyResponseError`, `AIRequestError`, `AIConfigError`)
- Route validates auth (401), input via Zod (400), and maps AI errors to user-friendly HTTP responses (400/422/500/503)

### PRD-003 Part 1: Database Schema Update for Signal Extraction — 2026-03-26
- Added `structured_notes` (TEXT, nullable) column to `sessions` table for storing markdown-formatted signal extraction output
- Updated `GET /api/sessions` response to include `structured_notes` field
- Updated `POST /api/sessions` and `PUT /api/sessions/[id]` to accept optional `structuredNotes` in request body
- PUT supports "omit = preserve" semantics: omitting `structuredNotes` preserves existing value, sending `null` clears it
- Updated service layer interfaces (`Session`, `CreateSessionInput`, `UpdateSessionInput`) and query functions

### PRD-002 Part 3 Increment 3.4: Expandable Rows with Inline Editing — 2026-03-25
- Added expandable row inline editing to `PastSessionsTable`: click a row to expand it with editable client combobox, date picker, and textarea pre-populated with session data
- Added Save, Cancel, and Delete actions in expanded rows: Save calls `PUT /api/sessions/[id]`, Delete shows inline confirmation then calls `DELETE /api/sessions/[id]`
- Added dirty state tracking: compares current form values to original session snapshot
- Created `UnsavedChangesDialog` component: Save/Discard/Cancel prompt when switching rows with unsaved changes (P3.R9)
- Moved expand/collapse state management fully into `PastSessionsTable` (simplified `CapturePageContent`)
- Delete confirmation uses inline confirm/cancel buttons (no modal) for faster interaction

### PRD-002 Part 3 Increment 3.3: Past Sessions Table UI — 2026-03-25
- Created `ClientFilterCombobox` component: searches clients with `hasSession=true`, no "create new" option, includes clear button
- Created `SessionFilters` component: horizontal filter bar with client combobox and date range pickers (From/To), individual clear buttons, date auto-sync (From adjusts To if past it, and vice versa)
- Created `PastSessionsTable` component: fetches sessions with server-side filters and offset-based pagination, "Load more" button, empty state
- Created `CapturePageContent` client wrapper: manages `refreshKey` between form and table
- Updated `SessionCaptureForm` to accept `onSessionSaved` callback prop
- Updated `DatePicker` to accept optional `min`/`max` props

### PRD-002 Part 3 Increment 3.2: Session Update and Delete API — 2026-03-25
- Added `updateSession()` and `deleteSession()` to `session-service.ts`: update supports client change (including new client creation), delete sets `deleted_at`
- Created `PUT /api/sessions/[id]` route handler: Zod validation, handles 404/409 errors
- Created `DELETE /api/sessions/[id]` route handler: soft-delete with 404 handling

### PRD-002 Part 3 Increment 3.1: Session List API and Service — 2026-03-25
- Added `getSessions()` to `session-service.ts`: joins sessions with clients, supports clientId/dateFrom/dateTo filters, offset-based pagination with total count
- Added `GET /api/sessions` route handler: Zod-validated query params, returns `{ sessions, total }`
- Extended `searchClients()` with optional `hasSession` filter: queries distinct client_ids from sessions table
- Updated `GET /api/clients` route handler to support `hasSession=true` query param

### PRD-002 Part 2 Increment 2.2: Session Capture Form and Page Update — 2026-03-25
- Created `DatePicker` component (`app/capture/_components/date-picker.tsx`): styled native date input, future dates blocked via `max` attribute
- Created `SessionCaptureForm` component (`app/capture/_components/session-capture-form.tsx`): react-hook-form + zod, three fields (client combobox, date picker, notes textarea), disabled-until-valid submit, toast on success/failure, form reset on save
- Replaced capture page placeholder with the real `SessionCaptureForm`
- Added `Toaster` from sonner to root layout for toast notifications

### PRD-002 Part 2 Increment 2.1: Session Service and API Route — 2026-03-25
- Created `session-service.ts` (`lib/services/session-service.ts`): orchestrates client creation (if new) and session insertion in a single flow
- Created `POST /api/sessions` route handler: Zod validation with conditional `clientName` requirement via `refine()`, 201 on success, 409 for duplicate clients, 400 for validation errors

### PRD-002 Part 1 Increment 1.3: Client Combobox Component — 2026-03-25
- Created `command.tsx` and `popover.tsx` shadcn/ui primitives (cmdk + radix popover)
- Created `ClientCombobox` component (`app/capture/_components/client-combobox.tsx`): debounced search (300ms), keyboard navigation, "Create new client" option with inline confirmation text
- Installed `cmdk` package

### PRD-002 Part 1 Increment 1.2: Client API Routes and Service — 2026-03-25
- Created `client-service.ts` (`lib/services/client-service.ts`): `searchClients()` with case-insensitive partial match, `createNewClient()` with duplicate detection via `ClientDuplicateError`
- Created `GET /api/clients` route handler: search by query param `q`, returns up to 50 matches
- Created `POST /api/clients` route handler: Zod validation, 201 on success, 409 on duplicate name

### PRD-002 Part 1 Increment 1.1: Database Schema — 2026-03-25
- Created `clients` table: UUID PK, name (case-insensitive unique), timestamps, soft delete
- Created `sessions` table: UUID PK, FK to clients, session_date, raw_notes, created_by (auth.uid()), timestamps, soft delete
- Added RLS policies on both tables (authenticated users only, soft-delete filtering on SELECT)
- Created `update_updated_at()` shared trigger function for both tables
- Added indexes: `clients_name_unique`, `sessions_client_id_idx`, `sessions_session_date_idx`

### PRD-001 Part 2 Increment 2.2: Middleware, AuthProvider, and User Menu — 2026-03-25
- Created route protection middleware (`middleware.ts`): redirects unauthenticated users to `/login`, refreshes sessions via `getUser()`, redirects authenticated users away from `/login`
- Created `AuthProvider` context (`components/providers/auth-provider.tsx`): exposes `user`, `isAuthenticated`, `isLoading`, `signOut` via React context with `onAuthStateChange` subscription
- Wrapped root layout with `AuthProvider`
- Wired `UserMenu` to auth context: loading skeleton, sign-in link when unauthenticated, Google avatar + email + sign-out dropdown when authenticated
- Added `lh3.googleusercontent.com` to `next.config.ts` image remote patterns for Google avatars

### PRD-001 Part 2 Increment 2.1: Supabase Clients, Login Page, OAuth Callback — 2026-03-25
- Created server-side Supabase client factory (`lib/supabase/server.ts`) using `@supabase/ssr` with cookie helpers
- Created browser-side Supabase client factory (`lib/supabase/client.ts`)
- Created shared constants file (`lib/constants.ts`) with `ALLOWED_EMAIL_DOMAIN`
- Created `/login` page with "Sign in with Google" button and domain-restricted error display
- Created `/auth/callback` route handler: exchanges OAuth code, verifies email domain, redirects accordingly

### PRD-001 Part 1: App Shell and Navigation — 2026-03-25
- Added brand CSS tokens to `globals.css` (indigo/purple primary, surface and text tokens)
- Created `AppHeader` component with app name, `TabNav`, and `UserMenu`
- Created `TabNav` with route-based active state and indigo underline indicator
- Created placeholder `UserMenu` (avatar + "Sign in" text)
- Created `/capture` placeholder page ("Coming soon")
- Updated root layout with proper metadata ("Synthesiser") and `AppHeader`
- Root `/` now redirects to `/capture`

### Project Setup — 2026-03-23
- Created project structure: `CLAUDE.md`, `ARCHITECTURE.md`, `CHANGELOG.md`
- Created Master PRD (`docs/master-prd/prd.md`) with 5 sections covering the full product scope
- Established development conventions and process in `CLAUDE.md`
- Initialized Next.js app with TypeScript, Tailwind, shadcn/ui
- Restructured doc hierarchy: Master PRD (sections) → Section PRDs (parts) → TRDs (increments) → PRs
- Created Foundation PRD (`docs/001-foundation/prd.md`) with 3 parts: App Shell, Authentication, Database Schema
