# Synthesiser — Architecture

> **This document reflects what is actually built — not what is planned.** It is the source of truth for the current state of the system. It is updated *after* every change that modifies file structure, routes, services, database tables, or environment variables. Read this before making any changes.
>
> For planned features and requirements, see the PRD and TRD in `docs/`.

## Overview

Synthesiser is a web application for teams to capture structured client session notes and view a live synthesis dashboard of cross-client themes, signal strength, and roadmap gaps.

**Tech Stack:**
- Frontend & API: Next.js (App Router, TypeScript)
- Database: Supabase (PostgreSQL + Row-Level Security)
- Authentication: Google OAuth via Supabase Auth
- AI: Vercel AI SDK (server-side only) — supports Anthropic, OpenAI, Google via env-var-driven provider selection
- Hosting: Vercel
- Styling: Tailwind CSS + shadcn/ui

---

## Current State

**Status:** PRD-002 through PRD-010 implemented. PRD-013 Parts 1–2 (File Upload Infrastructure + Persistence & Signal Extraction Integration) implemented. The app is a fully functional team-capable client feedback capture and synthesis platform. Google OAuth login (open to any Google account), working capture form with AI signal extraction and file attachment upload with server-side persistence, past sessions table with filters/inline editing/soft delete, master signal page with AI synthesis and PDF download, prompt editor with version history, and team access with role-based permissions.

**Core features live:**
- Session capture with AI signal extraction (Vercel AI SDK, multi-provider) and file attachment upload (TXT, PDF, CSV, DOCX, JSON) with server-side parsing and chat format detection (WhatsApp, Slack)
- Master signal synthesis (cold start + incremental, tainted flag on deletion)
- Per-user prompt editor with version history and revert
- Team workspaces with role-based access (owner, admin, sales)
- Email invitations via provider-agnostic email service (Resend)
- Workspace switcher (personal ↔ team contexts)
- Team-scoped sessions, clients, master signals, and prompts
- Team management (members, roles, ownership transfer, rename, delete)
- Data retention on member departure

**Database tables:** `clients`, `sessions`, `session_attachments`, `master_signals`, `profiles`, `prompt_versions`, `teams`, `team_members`, `team_invitations` — all with RLS.

---

## File Map

```
synthesiser/
├── ARCHITECTURE.md              # This file — reflects current state
├── CLAUDE.md                    # Development rules and conventions
├── CHANGELOG.md                 # Change log grouped by PRD/part
├── README.md                    # Product overview and setup guide
├── .env.example                 # Template for required env vars
├── middleware.ts                # Route protection + active_team_id cookie validation
├── next.config.ts               # Next.js config — image remote patterns (Google avatars)
├── app/
│   ├── globals.css              # Global CSS tokens (brand colours, typography, surfaces)
│   ├── layout.tsx               # Root layout — AuthProvider + AppHeader + AppFooter + Toaster
│   ├── page.tsx                 # Root redirect → /capture
│   ├── favicon.ico
│   ├── api/
│   │   ├── ai/
│   │   │   ├── extract-signals/
│   │   │   │   └── route.ts     # POST — extract signals from raw notes via AI model
│   │   │   └── generate-master-signal/
│   │   │       └── route.ts     # POST — generate/regenerate master signal (team admin check)
│   │   ├── clients/
│   │   │   └── route.ts         # GET (search, hasSession filter) and POST (create) — team-scoped
│   │   ├── files/
│   │   │   └── parse/
│   │   │       └── route.ts     # POST — stateless file parse (multipart/form-data) — returns parsed content + source format
│   │   ├── invite/
│   │   │   └── [token]/
│   │   │       └── accept/
│   │   │           └── route.ts # POST — accept team invitation, create team_members entry
│   │   ├── master-signal/
│   │   │   └── route.ts         # GET — fetch current master signal + staleness count — team-scoped
│   │   ├── prompts/
│   │   │   └── route.ts         # GET/POST — prompt CRUD (team admin check) — workspace-scoped
│   │   ├── sessions/
│   │   │   ├── _helpers.ts      # Shared helpers — checkSessionWriteAccess (auth + session ownership + team role)
│   │   │   ├── route.ts         # GET/POST — session list and create — team-scoped
│   │   │   └── [id]/
│   │   │       ├── route.ts     # PUT/DELETE — update/soft-delete session (uses _helpers)
│   │   │       └── attachments/
│   │   │           ├── route.ts         # POST — upload single attachment to session (multipart/form-data)
│   │   │           └── [attachmentId]/
│   │   │               └── route.ts     # DELETE — soft-delete attachment + hard-delete from storage
│   │   └── teams/
│   │       ├── route.ts         # GET (list user's teams) and POST (create team)
│   │       └── [teamId]/
│   │           ├── route.ts     # GET/PATCH/DELETE — team details, rename, soft-delete
│   │           ├── leave/
│   │           │   └── route.ts # POST — current user leaves team
│   │           ├── transfer/
│   │           │   └── route.ts # POST — transfer ownership to another member
│   │           ├── invitations/
│   │           │   ├── route.ts # GET (pending) and POST (send invitations)
│   │           │   └── [invitationId]/
│   │           │       ├── route.ts     # DELETE — revoke invitation
│   │           │       └── resend/
│   │           │           └── route.ts # POST — resend invitation email
│   │           └── members/
│   │               ├── route.ts # GET — list team members with profiles
│   │               └── [userId]/
│   │                   ├── route.ts     # DELETE — remove member from team
│   │                   └── role/
│   │                       └── route.ts # PATCH — change member role
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts         # OAuth callback — code exchange, pending invite auto-accept
│   ├── capture/
│   │   ├── page.tsx             # Capture tab — server component, renders CapturePageContent
│   │   └── _components/
│   │       ├── attachment-list.tsx          # Attachment chips — file name, size, format badge, remove button
│   │       ├── capture-page-content.tsx    # Client wrapper — manages refreshKey between form and table
│   │       ├── client-combobox.tsx         # Type-to-create text input with existing client suggestions
│   │       ├── client-filter-combobox.tsx  # Client combobox for filters (hasSession, no create-new)
│   │       ├── date-picker.tsx            # Styled native date input (max: today, optional min/max)
│   │       ├── expanded-session-row.tsx   # Expanded row with side-by-side raw/structured notes, edit/read-only
│   │       ├── file-upload-zone.tsx      # Drag-and-drop file upload zone with client-side validation and server parse
│   │       ├── markdown-panel.tsx         # Reusable markdown view/edit panel with rendered preview and raw edit toggle
│   │       ├── past-sessions-table.tsx    # Past sessions table with expand/collapse, inline edit, delete, "Captured by" column
│   │       ├── session-capture-form.tsx   # Capture form — client, date, notes, file attachments, extract signals, save
│   │       ├── session-filters.tsx        # Filter bar — client combobox + date range with auto-sync
│   │       └── unsaved-changes-dialog.tsx # Save/Discard/Cancel prompt for dirty expanded rows
│   ├── invite/
│   │   └── [token]/
│   │       ├── page.tsx                   # Invite acceptance page — server component
│   │       └── _components/
│   │           └── invite-page-content.tsx # Client component — validate token, accept/sign-in flow
│   ├── login/
│   │   └── page.tsx             # Login page with "Sign in with Google" button
│   ├── m-signals/
│   │   ├── page.tsx             # Master Signals tab — server component
│   │   └── _components/
│   │       ├── master-signal-page-content.tsx  # Fetch, generate, display, staleness, PDF, team role awareness
│   │       └── master-signal-pdf.ts            # Client-side PDF generation via pdf-lib
│   └── settings/
│       ├── page.tsx             # Settings page — renders SettingsPageContent
│       └── _components/
│           ├── invite-bulk-dialog.tsx          # Bulk invite dialog (CSV/paste, max 20 emails)
│           ├── invite-single-form.tsx          # Single email invite form
│           ├── pending-invitations-table.tsx   # Table of pending invitations with revoke/resend
│           ├── prompt-editor-page-content.tsx  # Prompt editor with tabs, dirty tracking, version history
│           ├── prompt-editor.tsx               # Monospace textarea with loading skeleton
│           ├── settings-page-content.tsx       # Orchestrator — tabs for Prompts + Team Settings
│           ├── team-danger-zone.tsx            # Rename + delete team (owner only)
│           ├── team-members-table.tsx          # Members list with role change, remove, transfer, leave
│           ├── team-settings.tsx               # Team settings orchestrator — members, invites, danger zone
│           ├── version-history-panel.tsx       # Collapsible version history with view/revert
│           └── version-view-dialog.tsx         # Read-only dialog for viewing past prompt versions
├── components/
│   ├── providers/
│   │   └── auth-provider.tsx    # AuthProvider context — user, isAuthenticated, isLoading, canCreateTeam, signOut
│   ├── layout/
│   │   ├── app-footer.tsx       # Footer — developer contact (name, email, GitHub, LinkedIn)
│   │   ├── app-header.tsx       # Top bar — TabNav + WorkspaceSwitcher + UserMenu
│   │   ├── create-team-dialog.tsx # Controlled team creation dialog (opened from workspace switcher)
│   │   ├── tab-nav.tsx          # Route-based tab navigation with active indicator
│   │   ├── user-menu.tsx        # Auth-aware user menu — avatar, email, sign-out dropdown
│   │   └── workspace-switcher.tsx # Always-visible workspace dropdown — switch, create team, CTA
│   └── ui/                      # shadcn/ui primitives (do not modify)
│       ├── badge.tsx
│       ├── button.tsx
│       ├── command.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── popover.tsx
│       ├── select.tsx
│       ├── sonner.tsx
│       ├── tabs.tsx
│       └── textarea.tsx
├── lib/
│   ├── constants.ts             # Shared constants (file upload limits, accepted types)
│   ├── utils.ts                 # cn() utility (clsx + tailwind-merge)
│   ├── email-templates/
│   │   └── invite-email.ts      # HTML email template for team invitations
│   ├── prompts/
│   │   ├── master-signal-synthesis.ts # System prompts (cold start + incremental) and user message builder
│   │   └── signal-extraction.ts # System prompt and user message template for signal extraction
│   ├── services/
│   │   ├── ai-service.ts        # AI service — extractSignals(), synthesiseMasterSignal(), provider-agnostic via Vercel AI SDK
│   │   ├── attachment-service.ts # Attachment CRUD — upload to Storage, DB persist, soft-delete + storage cleanup, signed URLs
│   │   ├── client-service.ts    # Client search and creation — team-scoped via getActiveTeamId()
│   │   ├── email-service.ts     # Provider-agnostic email sending — sendEmail(), resolveEmailProvider(), Resend adapter
│   │   ├── file-parser-service.ts # File parsing — TXT, PDF, CSV, DOCX, JSON + WhatsApp/Slack chat detection
│   │   ├── invitation-service.ts # Invitation CRUD — create, list pending, revoke, resend, accept, getByToken
│   │   ├── master-signal-service.ts # Master signal CRUD — team-scoped via getActiveTeamId()
│   │   ├── profile-service.ts   # Server-side profile fetch (getCurrentProfile)
│   │   ├── prompt-service.ts    # Prompt CRUD — workspace-scoped (user or team)
│   │   ├── session-service.ts   # Session CRUD — team-scoped via getActiveTeamId()
│   │   └── team-service.ts      # Team CRUD — create, list, members, rename, delete, roles, transfer, leave
│   ├── utils/
│   │   ├── format-file-size.ts    # File size formatting (bytes → "1.2 KB", "3.4 MB")
│   │   └── format-relative-time.ts # Relative time formatting ("just now", "5m ago", "3d ago")
│   └── supabase/
│       ├── server.ts            # Server-side Supabase clients (anon + service role) + getActiveTeamId()
│       └── client.ts            # Browser-side Supabase client factory
└── docs/
    ├── master-prd/
    │   └── prd.md               # Master PRD — full product scope
    ├── 001-foundation/
    │   ├── prd.md               # PRD-001 — Foundation (implemented)
    │   └── trd.md               # TRD-001 — Foundation
    ├── 002-capture-tab/
    │   ├── prd.md               # PRD-002 — Capture Tab (implemented)
    │   └── trd.md               # TRD-002 — Capture Tab
    ├── 003-signal-extraction/
    │   ├── prd.md               # PRD-003 — Signal Extraction (implemented)
    │   └── trd.md               # TRD-003 — Signal Extraction
    ├── 004-master-signals/
    │   ├── prd.md               # PRD-004 — Master Signal View (implemented)
    │   ├── trd.md               # TRD-004 — Master Signal View
    │   └── 001-create-master-signals-table.sql
    ├── 005-prompt-editor/
    │   ├── prd.md               # PRD-005 — System Prompt Editor (implemented)
    │   ├── trd.md               # TRD-005 — System Prompt Editor
    │   ├── 002-create-prompt-versions-table.sql
    │   └── 003-seed-prompt-versions.sql
    ├── 006-master-signal-cleanup/
    │   ├── prd.md               # PRD-006 — Master Signal Cleanup (implemented)
    │   └── trd.md               # TRD-006 — Master Signal Cleanup
    ├── 007-prompt-editor-toggle/
    │   ├── prd.md               # PRD-007 — Prompt Editor Toggle (implemented)
    │   └── trd.md               # TRD-007 — Prompt Editor Toggle
    ├── 008-open-access/
    │   ├── prd.md               # PRD-008 — Open Access (implemented)
    │   └── trd.md               # TRD-008 — Open Access
    ├── 009-ai-provider-abstraction/
    │   ├── prd.md               # PRD-009 — AI Provider Abstraction (implemented)
    │   └── trd.md               # TRD-009 — AI Provider Abstraction
    └── 010-team-access/
        ├── prd.md               # PRD-010 — Team Access (implemented)
        └── trd.md               # TRD-010 — Team Access (Parts 1–8)
```

> This map is updated after each increment ships. Only files that exist in the codebase are listed here.

---

## Data Model

### `clients`

Stores known client names for autocomplete and cross-session querying. Scoped to a user (personal workspace) or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | Unique per user or team (case-insensitive) among non-deleted rows |
| `created_by` | UUID | NOT NULL, default `auth.uid()` — owning user |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `clients_name_unique` — unique on `(LOWER(name), created_by)` where `deleted_at IS NULL AND team_id IS NULL`. Team-scoped unique index on `(LOWER(name), team_id)` where `deleted_at IS NULL AND team_id IS NOT NULL`.
**RLS:** Personal: users can SELECT/UPDATE their own non-deleted clients. Team: members can SELECT/UPDATE/INSERT team clients.

### `sessions`

Stores captured client feedback sessions. Scoped to a user or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `client_id` | UUID (FK → clients) | NOT NULL |
| `session_date` | DATE | NOT NULL |
| `raw_notes` | TEXT | NOT NULL, supports markdown |
| `structured_notes` | TEXT | Nullable. Markdown-formatted signal extraction output. |
| `created_by` | UUID | Default `auth.uid()` — Supabase Auth user ID |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `sessions_client_id_idx` (filtered), `sessions_session_date_idx` (desc, filtered).
**RLS:** Personal: users SELECT/UPDATE own sessions. Team: members SELECT all team sessions; admins UPDATE/DELETE any team session; sales UPDATE/DELETE only own team sessions. INSERT allowed for authenticated users.

### `session_attachments`

Stores uploaded file metadata and parsed content for session attachments. Original files are stored in the `session-attachments` Supabase Storage bucket.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `session_id` | UUID (FK → sessions) | NOT NULL |
| `file_name` | TEXT | NOT NULL, original upload file name |
| `file_type` | TEXT | NOT NULL, MIME type |
| `file_size` | INTEGER | NOT NULL, file size in bytes |
| `storage_path` | TEXT | NOT NULL, path in Storage bucket (`{ownerId}/{sessionId}/{uuid}.{ext}`) |
| `parsed_content` | TEXT | NOT NULL, extracted text from file |
| `source_format` | TEXT | NOT NULL, detected format (`generic`, `whatsapp`, `slack`) |
| `created_by` | UUID | Default `auth.uid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `session_attachments_session_id_idx` — on `session_id` where `deleted_at IS NULL`.
**RLS:** Personal: users SELECT/INSERT their own attachments. Team: members SELECT team attachments; INSERT allowed for authenticated users. Service role handles DELETE (soft-delete + storage cleanup).
**Storage bucket:** `session-attachments` — private, max 10 MB per file. Files stored at `{ownerId}/{sessionId}/{uuid}.{ext}`. All operations via service role client.

### `master_signals`

Stores immutable snapshots of the AI-synthesised master signal document. Scoped to a user or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `content` | TEXT | NOT NULL. Markdown content of the generated master signal |
| `generated_at` | TIMESTAMPTZ | NOT NULL. When this generation completed |
| `sessions_included` | INTEGER | NOT NULL. Total number of sessions that contributed |
| `is_tainted` | BOOLEAN | NOT NULL, default `false`. Forces cold-start on next generation. |
| `created_by` | UUID | NOT NULL. `auth.uid()` — who triggered the generation |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `master_signals_generated_at_idx` — DESC on `generated_at`.
**RLS:** Personal: users SELECT own master signals. Team: members SELECT team master signals. INSERT allowed for authenticated users. No UPDATE or DELETE (except service role sets `is_tainted`).

### `profiles`

Stores user metadata, auto-created by a trigger on `auth.users`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK, FK → auth.users.id) | CASCADE on delete |
| `email` | TEXT | NOT NULL, copied from auth.users |
| `is_admin` | BOOLEAN | NOT NULL, default `false` |
| `can_create_team` | BOOLEAN | NOT NULL, default `false`. Developer-set flag to enable team creation. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

**RLS:** Authenticated users can SELECT their own row only.
**Trigger:** `on_auth_user_created` — fires `AFTER INSERT` on `auth.users`, creates a `profiles` row with `id` and `email`.

### `teams`

Stores team workspaces. Team creation is gated by `profiles.can_create_team`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | NOT NULL, 1–100 characters |
| `owner_id` | UUID (FK → auth.users.id) | NOT NULL — team creator and current owner |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**RLS:** Team members can SELECT their own teams. Owner can SELECT immediately after creation.

### `team_members`

Junction table linking users to teams with roles.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | NOT NULL |
| `user_id` | UUID (FK → auth.users.id) | NOT NULL |
| `role` | TEXT | NOT NULL, CHECK: `admin`, `sales` |
| `joined_at` | TIMESTAMPTZ | Default `now()` |
| `removed_at` | TIMESTAMPTZ | Nullable. Set when member leaves/removed. |

**Indexes:** Unique on `(team_id, user_id)` where `removed_at IS NULL`.
**RLS:** Members can SELECT their own team's membership list.

### `team_invitations`

Stores pending and historical team invitations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | NOT NULL |
| `email` | TEXT | NOT NULL |
| `role` | TEXT | NOT NULL, CHECK: `admin`, `sales` |
| `token` | TEXT | NOT NULL, unique. Used in invite URL. |
| `invited_by` | UUID (FK → auth.users.id) | NOT NULL |
| `accepted_at` | TIMESTAMPTZ | Nullable. Set when invitation is accepted. |
| `expires_at` | TIMESTAMPTZ | NOT NULL. Invite expiry (7 days from creation). |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Team admins can SELECT/INSERT/UPDATE their team's invitations.

### `prompt_versions`

Stores versioned AI system prompts per user or team workspace. Each save/reset/revert creates a new row. Only one row per `(prompt_key, created_by)` or `(prompt_key, team_id)` can be active at a time.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `prompt_key` | TEXT | NOT NULL, CHECK: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental` |
| `content` | TEXT | NOT NULL, full prompt body |
| `author_id` | UUID (FK → auth.users.id) | Nullable. NULL for system-seeded rows. |
| `author_email` | TEXT | NOT NULL, default `'system'`. Denormalised for display. |
| `is_active` | BOOLEAN | NOT NULL, default `false`. |
| `created_by` | UUID (FK → auth.users.id) | Nullable. Default `auth.uid()`. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** Partial unique index enforces one active per key per workspace scope.
**RLS:** Users can SELECT/INSERT/UPDATE their own prompt versions. Team members can access team-scoped prompts.

### Shared functions and triggers

- `update_updated_at()` — BEFORE UPDATE trigger on `clients`, `sessions`, `profiles`, and `teams` tables, sets `updated_at = now()`.
- `handle_new_user()` — SECURITY DEFINER function, triggered AFTER INSERT on `auth.users`, creates a `profiles` row.
- `is_admin()` — SECURITY DEFINER function, returns `true` if the current user's profile has `is_admin = true`. Retained in database.
- `is_team_member(team_uuid)` — SECURITY DEFINER function, returns `true` if the current user is an active member of the given team.
- `get_team_role(team_uuid)` — SECURITY DEFINER function, returns the current user's role in the given team (or NULL).
- `is_team_admin(team_uuid)` — SECURITY DEFINER function, returns `true` if the current user's role is `admin` in the given team.

---

## Authentication Flow

**Provider:** Google OAuth via Supabase Auth. Open to any Google account.

**Standard flow:**

1. **Middleware** (`middleware.ts`) runs on every request. It refreshes the Supabase session via `getUser()`, redirects unauthenticated users to `/login`, and validates the `active_team_id` cookie (clears if user is no longer a member). Public routes (`/login`, `/auth/callback`, `/invite`) are excluded.
2. User visits `/login` and clicks "Sign in with Google."
3. `supabase.auth.signInWithOAuth({ provider: 'google' })` redirects to Google consent screen.
4. Google redirects back to `/auth/callback?code=...`.
5. The callback route handler exchanges the code for a session via `supabase.auth.exchangeCodeForSession(code)`.
6. On success: redirect to `/capture`. On failure: redirect to `/login?error=exchange_failed`.
7. **AuthProvider** (`components/providers/auth-provider.tsx`) wraps the app in `layout.tsx`. It reads the initial session on mount and subscribes to `onAuthStateChange`. Exposes `user`, `isAuthenticated`, `isLoading`, `canCreateTeam`, and `signOut` via React context.
8. **UserMenu** consumes the auth context. Shows a loading skeleton while `isLoading`, a "Sign in" link when unauthenticated, and the user's Google avatar + email with a sign-out dropdown when authenticated.

**Invite acceptance flow:**

1. User receives an email with a link to `/invite/[token]`.
2. If authenticated: page shows team name, role, and "Accept & Join Team" button. Accepting calls `POST /api/invite/[token]/accept`, which creates a `team_members` entry and sets `active_team_id` cookie.
3. If unauthenticated: page shows "Sign in with Google to join" button. A `pending_invite_token` cookie is set before redirecting to OAuth.
4. After OAuth callback, if `pending_invite_token` exists, the callback auto-accepts the invitation, sets `active_team_id`, and clears the pending token cookie.

**Workspace context:**

- The `active_team_id` cookie determines the current workspace (personal or team). Absence = personal workspace.
- The **WorkspaceSwitcher** component in the header lets users switch between workspaces by setting/clearing this cookie.
- All data services read the active team ID via `getActiveTeamId()` from `lib/supabase/server.ts`.

---

## API Routes

### Core Data

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| POST | `/api/ai/extract-signals` | Extract signals from raw notes via AI model. Body: `{ rawNotes }`. Returns `{ structuredNotes }`. | Yes |
| POST | `/api/ai/generate-master-signal` | Generate/regenerate master signal. Team: admin only (403 for sales). | Yes |
| GET | `/api/master-signal` | Fetch current master signal + staleness count. Workspace-scoped. | Yes |
| POST | `/api/files/parse` | Stateless file parse. Body: `multipart/form-data` with `file`. Returns `{ parsed_content, file_name, file_type, file_size, source_format }`. | Yes |
| GET | `/api/clients?q=&hasSession=` | Search clients. Workspace-scoped. | Yes (RLS) |
| POST | `/api/clients` | Create client. Workspace-scoped. | Yes (RLS) |
| GET | `/api/sessions?clientId=&dateFrom=&dateTo=&offset=&limit=` | List sessions. Workspace-scoped. Includes `created_by_email` for team context. | Yes (RLS) |
| POST | `/api/sessions` | Create session. Workspace-scoped. | Yes (RLS) |
| PUT | `/api/sessions/[id]` | Update session. Team: admin can edit any, sales own only. | Yes (RLS) |
| DELETE | `/api/sessions/[id]` | Soft-delete session. Team: admin can delete any, sales own only. | Yes (RLS) |
| POST | `/api/sessions/[id]/attachments` | Upload single attachment (multipart). Validates file size/type/count. | Yes (RLS) |
| DELETE | `/api/sessions/[id]/attachments/[attachmentId]` | Soft-delete attachment + hard-delete from Storage. | Yes |
| GET | `/api/prompts?key=` | Fetch active prompt + history. Workspace-scoped. | Yes (RLS) |
| POST | `/api/prompts` | Save new prompt version. Team: admin only. | Yes (RLS) |

### Teams

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/teams` | List user's teams with roles. | Yes |
| POST | `/api/teams` | Create team. Requires `can_create_team = true`. | Yes |
| GET | `/api/teams/[teamId]` | Get team details. Members only. | Yes |
| PATCH | `/api/teams/[teamId]` | Rename team. Owner only. Body: `{ name }`. | Yes |
| DELETE | `/api/teams/[teamId]` | Soft-delete team. Owner only. | Yes |
| POST | `/api/teams/[teamId]/leave` | Current user leaves team. Owner auto-transfers or blocked. | Yes |
| POST | `/api/teams/[teamId]/transfer` | Transfer ownership. Owner only. Body: `{ newOwnerId }`. | Yes |
| GET | `/api/teams/[teamId]/members` | List team members with profiles. | Yes |
| DELETE | `/api/teams/[teamId]/members/[userId]` | Remove member. Owner: any. Admin: sales only. | Yes |
| PATCH | `/api/teams/[teamId]/members/[userId]/role` | Change role. Owner only. Body: `{ role }`. | Yes |
| GET | `/api/teams/[teamId]/invitations` | List pending invitations. Admin+ only. | Yes |
| POST | `/api/teams/[teamId]/invitations` | Send invitations. Admin+ only. Body: `{ emails, role }`. | Yes |
| DELETE | `/api/teams/[teamId]/invitations/[invitationId]` | Revoke invitation. Admin+ only. | Yes |
| POST | `/api/teams/[teamId]/invitations/[invitationId]/resend` | Resend invitation email. Admin+ only. | Yes |
| POST | `/api/invite/[token]/accept` | Accept invitation. Creates team_members entry. | Yes |

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Client + Server | Supabase publishable key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase service role key (bypasses RLS) |
| `AI_PROVIDER` | Server only | AI provider (`anthropic`, `openai`, `google`) |
| `AI_MODEL` | Server only | Provider-specific model identifier |
| `ANTHROPIC_API_KEY` | Server only | Anthropic API key (required when `AI_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | Server only | OpenAI API key (required when `AI_PROVIDER=openai`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Server only | Google AI API key (required when `AI_PROVIDER=google`) |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Application base URL |
| `EMAIL_PROVIDER` | Server only | Email provider (`resend`, `brevo`) |
| `RESEND_API_KEY` | Server only | Resend API key (required when `EMAIL_PROVIDER=resend`) |
| `BREVO_API_KEY` | Server only | Brevo API key (required when `EMAIL_PROVIDER=brevo`) |
| `EMAIL_FROM` | Server only | Sender email address for outbound emails |

See `.env.example` for the full template.

---

## Key Design Decisions

1. **Standalone app.** Separate deployment, separate auth, separate database. No shared components.
2. **Supabase for auth and database.** Provides Google OAuth, PostgreSQL, RLS, and auto-generated types out of the box. Reduces infrastructure overhead.
3. **Server-side AI calls only, provider-agnostic.** API keys never touch the browser. All AI operations go through Next.js API routes. The AI service uses the Vercel AI SDK (`generateText()`) and supports multiple providers (Anthropic, OpenAI, Google) via `AI_PROVIDER` and `AI_MODEL` env vars.
4. **Manual theme tagging (not AI-driven).** Users explicitly link sessions to themes. Automatic theme extraction is deferred to backlog.
5. **Clients as a first-class entity.** Separate `clients` table (not derived from unique session values) to support future enrichment and enterprise features.
6. **Architecture follows code, not the other way around.** This document is updated after implementation, never speculatively. If it's in this file, it exists in the codebase.
7. **AI prompts are DB-first with hardcoded fallback.** Active prompts are read from `prompt_versions` at runtime. If the DB is unreachable, the AI service falls back to the hardcoded constants in `lib/prompts/`.
8. **Team workspaces with personal fallback.** Users operate in either a personal workspace (no team) or a team workspace. The `active_team_id` cookie determines context. All data tables have a nullable `team_id` column — NULL means personal workspace. Data services read the active team ID and scope queries accordingly.
9. **Role-based access within teams.** Three roles: owner (one per team, full control), admin (manage members and content), sales (capture sessions, view data). Owner is a database concept (`teams.owner_id`), not a role value — the owner always has `role = 'admin'` in `team_members`.
10. **Team creation is a paid feature.** The `can_create_team` flag on `profiles` gates team creation. Developers enable this per user. No self-service payment gateway.
11. **Data retention on member departure.** When a member is removed or leaves, their sessions and other data remain in the team (owned by `team_id`). The `team_members.removed_at` timestamp records the departure. Re-inviting a departed member restores full access.
12. **Provider-agnostic email service.** Email sending is abstracted via `email-service.ts` with `resolveEmailProvider()` — supports Resend and Brevo, extensible to SMTP and others via `EMAIL_PROVIDER` env var.
