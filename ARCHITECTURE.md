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
- AI: Claude API (server-side only) for note structuring
- Hosting: Vercel
- Styling: Tailwind CSS + shadcn/ui

---

## Current State

**Status:** PRD-002 Parts 1, 2, and 3 (Database Schema, Client Management, Session Capture Form, Past Sessions Table) implemented. PRD-003 Parts 1, 2, 3, and 4 (Database Schema Update, Signal Extraction via Claude API, Capture Form Extract Signals UX, Past Sessions Side-by-Side View) implemented. PRD-004 Part 1 Increments 1.1–1.5 (Master Signal database table, service layer, AI prompts, synthesis function, API routes, frontend page, tab navigation, and PDF download) implemented. PRD-005 Parts 1–4 (Admin Role System, Prompt Storage & Versioning, Prompt Editor UI, Version History & Revert) implemented. PRD-006 Part 1 Increments 1.1–1.3 (Master Signal Cleanup on Session Deletion — tainted flag, auto cold-start, frontend banners, settings prompt selection) implemented. PRD-007 Part 1 (Prompt Editor — contextual note, inline toggle between cold-start and incremental prompts, active badge, dirty-state guard) implemented. PRD-008 Part 1 (Remove Email Domain Restriction — open authentication) implemented. The app shell is live with tab navigation, Google OAuth login (open to any Google account), a working capture form with signal extraction, and a full past sessions table with filters, expandable inline editing, signal extraction, and soft delete. Database tables (`clients`, `sessions`, `master_signals`, `profiles`, `prompt_versions`) are live with RLS. The `sessions` table includes `structured_notes` (TEXT, nullable) for storing signal extraction output. The `master_signals` table stores immutable snapshots of AI-synthesised master signal documents — each generation inserts a new row, latest by `generated_at` is the current one. The `master_signals` table includes an `is_tainted` flag (BOOLEAN, default false) that is set when a session with extracted signals is soft-deleted; when tainted, the next master signal generation forces a cold-start rebuild instead of an incremental merge, ensuring deleted session data is purged. The `profiles` table stores user metadata with an `is_admin` flag, auto-created via a trigger on `auth.users`. The `prompt_versions` table stores versioned AI system prompts with `is_active` flag, partial unique index, and full version history. The Master Signal page (`/m-signals`) displays the latest AI-synthesised cross-client analysis, supports cold start and incremental generation via Claude, shows a staleness banner when new sessions exist, shows a tainted banner when a session with signals has been deleted, and offers a client-side PDF download powered by pdf-lib. The capture form includes an "Extract Signals" button that calls Claude to generate a structured markdown signal report, displayed in a renderable/editable markdown panel. Both raw notes and structured notes are saved together. Expanded rows in the past sessions table show a side-by-side view of raw notes and structured notes using MarkdownPanel, with inline signal extraction and re-extraction support. The Settings page (`/settings`) is admin-only and provides a prompt editor UI with two tabs — Signal Extraction and Master Signal — full dirty tracking, save/reset-to-default, a collapsible version history panel, and a version view dialog with revert capability. The Master Signal tab dynamically resolves to the cold start or incremental prompt based on whether a master signal already exists and whether it is tainted (tainted = cold start). A contextual note above the editor explains which prompt variant is loaded and when it's used, with an inline toggle link to switch to the alternate variant (e.g., view the cold-start prompt while the incremental prompt is auto-selected). Both variants are fully editable, and the auto-selected prompt shows an "(active)" badge. Toggling respects the existing dirty-state guard. The AI service reads active prompts from the database with hardcoded fallback.

---

## File Map

```
synthesiser/
├── ARCHITECTURE.md              # This file — reflects current state
├── CLAUDE.md                    # Development rules and conventions
├── CHANGELOG.md                 # Change log grouped by PRD/part
├── .env.example                 # Template for required env vars
├── middleware.ts                # Route protection — redirects unauthenticated users to /login
├── next.config.ts               # Next.js config — image remote patterns (Google avatars)
├── app/
│   ├── globals.css              # Global CSS tokens (brand colours, typography, surfaces)
│   ├── layout.tsx               # Root layout — renders AuthProvider + AppHeader + Toaster, sets metadata
│   ├── page.tsx                 # Root redirect → /capture
│   ├── favicon.ico
│   ├── api/
│   │   ├── ai/
│   │   │   ├── extract-signals/
│   │   │   │   └── route.ts     # POST — extract signals from raw notes via Claude API
│   │   │   └── generate-master-signal/
│   │   │       └── route.ts     # POST — generate/regenerate master signal via Claude AI synthesis
│   │   ├── clients/
│   │   │   └── route.ts         # GET (search, optional hasSession filter) and POST (create) for clients
│   │   ├── master-signal/
│   │   │   └── route.ts         # GET — fetch current master signal + staleness count
│   │   ├── prompts/
│   │   │   └── route.ts         # GET (active + history by key, admin-only) and POST (save new version, admin-only)
│   │   └── sessions/
│   │       ├── route.ts         # GET (list with filters/pagination) and POST (create session)
│   │       └── [id]/
│   │           └── route.ts     # PUT (update session) and DELETE (soft delete session)
│   ├── capture/
│   │   ├── page.tsx             # Capture tab — server component, renders CapturePageContent
│   │   └── _components/
│   │       ├── capture-page-content.tsx    # Client wrapper — manages refreshKey between form and table
│   │       ├── client-combobox.tsx         # Type-to-create text input with existing client suggestions
│   │       ├── client-filter-combobox.tsx  # Client combobox for filters (hasSession, no create-new)
│   │       ├── date-picker.tsx            # Styled native date input (max: today, optional min/max)
│   │       ├── markdown-panel.tsx         # Reusable markdown view/edit panel with rendered preview and raw edit toggle
│   │       ├── past-sessions-table.tsx    # Past sessions table with expand/collapse, inline edit, delete
│   │       ├── session-capture-form.tsx   # Capture form — client, date, notes, extract signals, save
│   │       ├── session-filters.tsx        # Filter bar — client combobox + date range with auto-sync
│   │       └── unsaved-changes-dialog.tsx # Save/Discard/Cancel prompt for dirty expanded rows
│   ├── m-signals/
│   │   ├── page.tsx             # Master Signals tab — server component, renders MasterSignalPageContent
│   │   └── _components/
│   │       ├── master-signal-page-content.tsx  # Client component — fetch, generate, display, staleness, PDF download
│   │       └── master-signal-pdf.ts            # Client-side PDF generation via pdf-lib — parses markdown, renders styled A4 PDF with branded header
│   ├── settings/
│   │   ├── page.tsx             # Settings page — server component with admin gate, renders PromptEditorPageContent
│   │   └── _components/
│   │       ├── prompt-editor-page-content.tsx  # Client component — dynamic tabs (Signal Extraction + Master Signal), fetch, save, dirty tracking, version history, dialogs
│   │       ├── prompt-editor.tsx               # Monospace textarea with loading skeleton
│   │       ├── version-history-panel.tsx       # Collapsible version history list with view/revert actions
│   │       └── version-view-dialog.tsx         # Read-only dialog for viewing past prompt versions
│   ├── login/
│   │   └── page.tsx             # Login page with "Sign in with Google" button
│   └── auth/
│       └── callback/
│           └── route.ts         # OAuth callback — code exchange, redirect to /capture
├── components/
│   ├── providers/
│   │   └── auth-provider.tsx    # AuthProvider context — user, isAuthenticated, isLoading, isAdmin, signOut
│   ├── layout/
│   │   ├── app-header.tsx       # Top bar — TabNav (left) + UserMenu (right)
│   │   ├── tab-nav.tsx          # Route-based tab navigation with active indicator (Settings tab for admins)
│   │   └── user-menu.tsx        # Auth-aware user menu — avatar, email, sign-out dropdown
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
│   ├── utils.ts                 # cn() utility (clsx + tailwind-merge)
│   ├── prompts/
│   │   ├── master-signal-synthesis.ts # System prompts (cold start + incremental) and user message builder for master signal
│   │   └── signal-extraction.ts # System prompt and user message template for signal extraction
│   ├── hooks/
│   │   └── use-profile.ts       # Client-side hook for fetching admin flag from profiles table
│   ├── services/
│   │   ├── ai-service.ts        # Claude API wrapper — extractSignals(), synthesiseMasterSignal(), shared retry logic, typed error classes; reads active prompts from DB with hardcoded fallback
│   │   ├── client-service.ts    # Client search (with hasSession filter) and creation (searchClients, createNewClient)
│   │   ├── master-signal-service.ts # Master signal CRUD — get latest, stale count, fetch signal sessions, save
│   │   ├── profile-service.ts   # Server-side profile fetch (getCurrentProfile) and admin check (isCurrentUserAdmin)
│   │   ├── prompt-service.ts    # Prompt CRUD — getActivePrompt (service role), getPromptHistory (anon), savePromptVersion (service role, atomic swap)
│   │   └── session-service.ts   # Session CRUD — create, list with filters/pagination, update, soft delete
│   ├── utils/
│   │   └── format-relative-time.ts # Relative time formatting ("just now", "5m ago", "3d ago")
│   └── supabase/
│       ├── server.ts            # Server-side Supabase client factories (anon + service role)
│       └── client.ts            # Browser-side Supabase client factory
└── docs/
    ├── master-prd/
    │   └── prd.md               # Master PRD — full product scope (5 sections)
    ├── 001-foundation/
    │   ├── prd.md               # Section 1 PRD — Foundation (approved)
    │   └── trd.md               # Section 1 TRD — Foundation
    ├── 002-capture-tab/
    │   ├── prd.md               # Section 2 PRD — Capture Tab (approved)
    │   └── trd.md               # Section 2 TRD — Capture Tab (Parts 1–3 implemented)
    ├── 003-signal-extraction/
    │   ├── prd.md               # Section 3 PRD — Signal Extraction (draft)
    │   └── trd.md               # Section 3 TRD — Signal Extraction (Parts 1–3 implemented)
    ├── 004-master-signals/
    │   ├── prd.md               # Section 4 PRD — Master Signal View (approved)
    │   ├── trd.md               # Section 4 TRD — Master Signal View (Part 1 Increments 1.1–1.6 implemented)
    │   └── 001-create-master-signals-table.sql  # SQL migration for master_signals table
    ├── 005-prompt-editor/
    │   ├── prd.md               # PRD-005 — System Prompt Editor (Parts 1–4 implemented)
    │   ├── trd.md               # TRD-005 — System Prompt Editor (Parts 1–4 implemented)
    │   ├── 002-create-prompt-versions-table.sql  # SQL migration for prompt_versions table + is_admin() function
    │   └── 003-seed-prompt-versions.sql          # Seed SQL for initial prompt versions
    ├── 006-master-signal-cleanup/
    │   ├── prd.md               # PRD-006 — Master Signal Cleanup on Session Deletion (Part 1 implemented)
    │   └── trd.md               # TRD-006 — Master Signal Cleanup on Session Deletion (Part 1 implemented)
    └── 007-prompt-editor-toggle/
        ├── prd.md               # PRD-007 — Prompt Editor: View Alternate Master Signal Prompt (Part 1 implemented)
        └── trd.md               # TRD-007 — Prompt Editor: View Alternate Master Signal Prompt (Part 1 implemented)
```

> This map is updated after each increment ships. Only files that exist in the codebase are listed here.

---

## Data Model

### `clients`

Stores known client names for the autocomplete and cross-session querying.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | Unique (case-insensitive) among non-deleted rows |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `clients_name_unique` — unique on `LOWER(name)` where `deleted_at IS NULL`.
**RLS:** Authenticated users can SELECT (non-deleted), INSERT, and UPDATE.

### `sessions`

Stores captured client feedback sessions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `client_id` | UUID (FK → clients) | NOT NULL |
| `session_date` | DATE | NOT NULL |
| `raw_notes` | TEXT | NOT NULL, supports markdown |
| `structured_notes` | TEXT | Nullable. Markdown-formatted signal extraction output. NULL = not enriched. |
| `created_by` | UUID | Default `auth.uid()` — Supabase Auth user ID |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `sessions_client_id_idx` (filtered), `sessions_session_date_idx` (desc, filtered).
**RLS:** Authenticated users can SELECT (non-deleted), INSERT, and UPDATE.

### `master_signals`

Stores immutable snapshots of the AI-synthesised master signal document. Each generation inserts a new row — previous rows are never updated or deleted. The latest row (by `generated_at` DESC) is the current master signal displayed to users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `content` | TEXT | NOT NULL. Markdown content of the generated master signal |
| `generated_at` | TIMESTAMPTZ | NOT NULL. When this generation completed |
| `sessions_included` | INTEGER | NOT NULL. Total number of sessions that contributed |
| `is_tainted` | BOOLEAN | NOT NULL, default `false`. Set to `true` when a session with structured notes is deleted. Forces cold-start on next generation. Cleared implicitly when a new (non-tainted) row is inserted. |
| `created_by` | UUID | NOT NULL. `auth.uid()` — who triggered the generation |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `master_signals_generated_at_idx` — DESC on `generated_at`.
**RLS:** Authenticated users can SELECT and INSERT. No UPDATE or DELETE (except service role client sets `is_tainted` on the latest row).

### `profiles`

Stores user metadata, auto-created by a trigger on `auth.users`. Used for admin role gating.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK, FK → auth.users.id) | CASCADE on delete |
| `email` | TEXT | NOT NULL, copied from auth.users |
| `is_admin` | BOOLEAN | NOT NULL, default `false` |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

**RLS:** Authenticated users can SELECT their own row only. No admin-reads-all policy (avoided due to recursive RLS — uses `SECURITY DEFINER` function `is_admin()` in other tables instead).
**Trigger:** `on_auth_user_created` — fires `AFTER INSERT` on `auth.users`, creates a `profiles` row with `id` and `email`.

### `prompt_versions`

Stores versioned AI system prompts. Each save/reset/revert creates a new row. Only one row per `prompt_key` can be active at a time.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `prompt_key` | TEXT | NOT NULL, CHECK: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental` |
| `content` | TEXT | NOT NULL, full prompt body |
| `author_id` | UUID (FK → auth.users.id) | Nullable. NULL for system-seeded rows. SET NULL on user delete. |
| `author_email` | TEXT | NOT NULL, default `'system'`. Denormalised for display. |
| `is_active` | BOOLEAN | NOT NULL, default `false`. Partial unique index enforces one active per key. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `prompt_versions_active_unique` — unique on `(prompt_key) WHERE is_active = true`. `prompt_versions_key_created_idx` — on `(prompt_key, created_at DESC)`.
**RLS:** Authenticated users can SELECT active prompts. Admins (via `is_admin()`) can SELECT all, INSERT, and UPDATE.

### Shared functions and triggers

- `update_updated_at()` — BEFORE UPDATE trigger on `clients`, `sessions`, and `profiles` tables, sets `updated_at = now()`.
- `handle_new_user()` — SECURITY DEFINER function, triggered AFTER INSERT on `auth.users`, creates a `profiles` row.
- `is_admin()` — SECURITY DEFINER function, returns `true` if the current user's profile has `is_admin = true`. Used in RLS policies for `prompt_versions` to avoid recursive self-referencing on `profiles`.

---

## Authentication Flow

**Provider:** Google OAuth via Supabase Auth.

**Flow:**

1. **Middleware** (`middleware.ts`) runs on every request. It refreshes the Supabase session via `getUser()` and redirects unauthenticated users to `/login`. Public routes (`/login`, `/auth/callback`) are excluded. Authenticated users visiting `/login` are redirected to `/capture`.
2. User visits `/login` and clicks "Sign in with Google."
3. `supabase.auth.signInWithOAuth({ provider: 'google' })` redirects to Google consent screen.
4. Google redirects back to `/auth/callback?code=...`.
5. The callback route handler exchanges the code for a session via `supabase.auth.exchangeCodeForSession(code)`.
6. On success: redirect to `/capture`. On failure: redirect to `/login?error=exchange_failed`.
8. **AuthProvider** (`components/providers/auth-provider.tsx`) wraps the app in `layout.tsx`. It reads the initial session on mount and subscribes to `onAuthStateChange`. Exposes `user`, `isAuthenticated`, `isLoading`, `isAdmin`, and `signOut` via React context. The `isAdmin` flag is fetched from the `profiles` table via the `useProfile` hook on auth state change. `isLoading` includes the profile fetch to prevent UI flicker.
9. **UserMenu** consumes the auth context. Shows a loading skeleton while `isLoading`, a "Sign in" link when unauthenticated, and the user's Google avatar + email with a sign-out dropdown when authenticated.

---

## API Routes

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| POST | `/api/ai/extract-signals` | Extract signals from raw notes via Claude. Body: `{ rawNotes }`. Returns `{ structuredNotes }` (markdown string). Retries transient failures. | Yes (401 if unauthenticated) |
| POST | `/api/ai/generate-master-signal` | Generate/regenerate the master signal. No body. Cold start synthesises from all sessions; incremental merges new sessions into existing master signal. Returns `{ masterSignal, unchanged? }`. | Yes (401 if unauthenticated) |
| GET | `/api/master-signal` | Fetch the current master signal and staleness count. Returns `{ masterSignal: {...} \| null, staleCount: number }`. | Yes (401 if unauthenticated) |
| GET | `/api/clients?q=<search>&hasSession=true` | Search clients by name. Optional `hasSession` filter returns only clients with sessions. Returns `{ clients: Array<{ id, name }> }`. | Yes (RLS) |
| POST | `/api/clients` | Create a new client. Body: `{ name }`. Returns 201 or 409 (duplicate). | Yes (RLS) |
| GET | `/api/sessions?clientId=&dateFrom=&dateTo=&offset=&limit=` | List sessions with optional filters and pagination. Returns `{ sessions: Array<{ id, client_id, client_name, session_date, raw_notes, structured_notes, created_at }>, total }`. | Yes (RLS) |
| POST | `/api/sessions` | Create a session. Body: `{ clientId, clientName, sessionDate, rawNotes, structuredNotes? }`. Creates client first if `clientId` is null. Returns 201. | Yes (RLS) |
| PUT | `/api/sessions/[id]` | Update a session. Body: `{ clientId, clientName, sessionDate, rawNotes, structuredNotes? }`. Omitting `structuredNotes` preserves existing value; `null` clears it. Returns 200 or 404/409. | Yes (RLS) |
| DELETE | `/api/sessions/[id]` | Soft-delete a session (sets `deleted_at`). Returns 200 or 404. | Yes (RLS) |
| GET | `/api/prompts?key=<prompt_key>` | Fetch active prompt and full version history for the given key. Returns `{ active, history }`. | Yes (admin-only, 403 for non-admins) |
| POST | `/api/prompts` | Save a new prompt version and make it active. Body: `{ promptKey, content }`. Returns `{ version }`. | Yes (admin-only, 403 for non-admins) |

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Client + Server | Supabase publishable key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase service role key (bypasses RLS) |
| `ANTHROPIC_API_KEY` | Server only | Claude API key |
| `CLAUDE_MODEL` | Server only | Claude model identifier |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Application base URL |

See `.env.example` for the full template.

---

## Key Design Decisions

1. **Standalone app.** Separate deployment, separate auth, separate database. No shared components.
2. **Supabase for auth and database.** Provides Google OAuth, PostgreSQL, RLS, and auto-generated types out of the box. Reduces infrastructure overhead.
3. **Server-side Claude calls only.** API key never touches the browser. All AI operations go through Next.js API routes.
4. **Manual theme tagging (not AI-driven).** Users explicitly link sessions to themes. Automatic theme extraction is deferred to backlog.
5. **Clients as a first-class entity.** Separate `clients` table (not derived from unique session values) to support future enrichment and enterprise features.
6. **Architecture follows code, not the other way around.** This document is updated after implementation, never speculatively. If it's in this file, it exists in the codebase.
7. **AI prompts are DB-first with hardcoded fallback.** Active prompts are read from `prompt_versions` at runtime. If the DB is unreachable, the AI service falls back to the hardcoded constants in `lib/prompts/`. This ensures signal extraction and master signal synthesis never break due to a prompt storage issue.
8. **Admin gating at page and API level, not middleware.** Middleware checks authentication only. Admin checks happen in server components (settings page) and API route handlers (prompts API) via `isCurrentUserAdmin()`. This avoids a Supabase round-trip on every navigation.
