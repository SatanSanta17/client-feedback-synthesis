# PRD-008: Open Access — Remove Domain Restriction and Per-User Data Isolation

> **Master PRD Section:** Section 1 — Foundation (amendment)
> **Status:** Implemented (2026-04-02)
> **Deliverable:** Any Google account can sign in. Each user's sessions, master signals, and prompts are fully isolated. Every user controls their own AI prompts.
> **Context:** This is a temporary access model to allow multiple individual users to onboard and use the product independently. A proper team/workspace-based access model will replace this in a future PRD.

## Purpose

The product currently restricts sign-in to a single email domain, shows all sessions to all users, and limits prompt editing to admins. All three assumptions break the moment a second organisation or external user tries the product.

This PRD makes three changes to unblock multi-user onboarding:

1. **Remove the email domain gate** — any Google account can sign in.
2. **Isolate all data per user** — each user only sees their own sessions, master signals, and prompts.
3. **Give every user prompt control** — the admin role system is removed. Every user can customise the AI prompts that govern their own signal extraction and master signal synthesis.

This is not a multi-tenancy solution. There are no teams, no workspaces, no shared access. It is the simplest possible setup that lets individual users onboard, capture their own sessions, extract signals with their own prompts, and generate their own master signal — completely independently of other users.

## User Story

As a new user, I want to sign in with any Google account and have a fully private workspace — my sessions, my signals, my master signal, my prompts — so that I can evaluate the product and tune the AI to my needs without needing an invitation or admin approval.

---

## Part 1: Remove Email Domain Restriction

**Scope:** Remove the `ALLOWED_EMAIL_DOMAIN` gate from the OAuth callback. Any Google account can sign in.

### Requirements

- **P1.R1** The OAuth callback no longer checks the user's email domain. After a successful code exchange, the user is redirected to `/capture` regardless of email domain.
- **P1.R2** The `ALLOWED_EMAIL_DOMAIN` environment variable is removed from the codebase. The `lib/constants.ts` file is deleted (its only export was this constant).
- **P1.R3** The login page no longer displays a "domain restricted" error message.
- **P1.R4** `.env.example` is updated to remove `ALLOWED_EMAIL_DOMAIN`.
- **P1.R5** Documentation (`ARCHITECTURE.md`, `CLAUDE.md`) is updated to reflect open authentication.

### Acceptance Criteria

- [ ] A user with any Google-linked email can sign in and reach `/capture`
- [ ] No reference to `ALLOWED_EMAIL_DOMAIN` exists in the codebase or env config
- [ ] The login page shows no domain-related error states
- [ ] `lib/constants.ts` no longer exists

---

## Part 2: Per-User Data Isolation

**Scope:** Restrict all user-facing data via RLS so each user operates in complete isolation. Sessions, master signals, and prompts are all scoped to the individual user.

### Requirements

#### Sessions

- **P2.R1** The RLS SELECT policy on `sessions` adds `created_by = auth.uid()`. Users can only read their own sessions.
- **P2.R2** The RLS UPDATE policy on `sessions` adds `created_by = auth.uid()`. Users can only edit their own sessions.
- **P2.R3** INSERT and DELETE behaviour is unchanged. INSERT auto-sets `created_by` via the database default. DELETE uses the service role client.

#### Master Signals

- **P2.R4** The RLS SELECT policy on `master_signals` is modified to add `created_by = auth.uid()`. Each user only sees their own generated master signals.
- **P2.R5** Master signal generation reads only the current user's sessions. The existing `createClient()` (publishable key + user cookies) is used — RLS on `sessions` automatically scopes the query to the current user's data.
- **P2.R6** Stale session count is scoped to the current user's sessions only.
- **P2.R7** The tainted flag on a master signal is only set when the current user deletes one of their own sessions with extracted signals. Since `deleteSession` uses the service role client, the taint function must explicitly target the latest master signal belonging to the user who triggered the deletion.

#### Prompts

- **P2.R8** The `prompt_versions` table gets a `created_by` column (UUID, FK to `auth.users`, default `auth.uid()`) so each prompt version belongs to a user.
- **P2.R9** The partial unique index on `prompt_versions` is updated from `(prompt_key) WHERE is_active = true` to `(prompt_key, created_by) WHERE is_active = true` — each user can have one active prompt per key.
- **P2.R10** RLS policies on `prompt_versions` are replaced: the `is_admin()` checks are removed and replaced with `created_by = auth.uid()`. Each user reads and writes only their own prompt versions.
- **P2.R11** The `getActivePrompt()` service function uses `createClient()` instead of the service role client, so RLS scopes the query to the current user's prompts. The hardcoded fallback in `lib/prompts/` continues to serve as the default for users who have not customised their prompts.
- **P2.R12** New users do not need seeded prompt rows. The existing fallback mechanism (hardcoded prompts in `lib/prompts/`) serves as the default. The prompt editor shows the fallback content as the starting point when no user-specific prompt exists.

#### Clients

- **P2.R13** The `clients` table gets a `created_by` column (UUID, FK to `auth.users`, default `auth.uid()`) so each client record belongs to a user.
- **P2.R14** The RLS SELECT policy on `clients` adds `created_by = auth.uid()`. Users can only see their own clients.
- **P2.R15** The RLS UPDATE policy on `clients` adds `created_by = auth.uid()`. Users can only edit their own clients.
- **P2.R16** The unique index on `LOWER(name)` is updated to include `created_by` — two users can independently create a client with the same name without conflict.
- **P2.R17** INSERT behaviour is unchanged — `created_by` is auto-set via the database default.

#### General

- **P2.R18** No frontend changes are required for data isolation. The UI works identically — it just sees less data per user.
- **P2.R19** No service layer changes are needed for session, client, or master signal queries — RLS handles the scoping. The only service change is ensuring `taintLatestMasterSignal` targets the correct user's master signal.

### Acceptance Criteria

- [ ] User A creates a session — only User A sees it in the past sessions table
- [ ] User B signs in — cannot see User A's sessions
- [ ] User A cannot edit or delete User B's sessions
- [ ] User A generates a master signal — only User A sees it on the Master Signals page
- [ ] User B generates a master signal — it is built only from User B's sessions, not User A's
- [ ] User A's stale session count only reflects User A's sessions
- [ ] Deleting a session only taints the deleting user's own master signal
- [ ] User A creates a client — only User A sees it in the client combobox
- [ ] User B cannot see or edit User A's clients
- [ ] User A and User B can both create a client named "Acme Corp" without conflict
- [ ] User A saves a custom prompt — only User A sees it; User B still sees the default
- [ ] User A's signal extraction uses User A's custom prompt, not User B's

---

## Part 3: Remove Admin Role System

**Scope:** Remove the `is_admin` gating. Every user has full access to their own prompts via the Settings page.

### Requirements

- **P3.R1** The Settings page (`app/settings/page.tsx`) removes the `isCurrentUserAdmin()` check and the access-denied state. All authenticated users can access `/settings`.
- **P3.R2** The Settings tab in `tab-nav.tsx` is visible to all users (remove the `isAdmin` conditional).
- **P3.R3** The `GET /api/prompts` and `POST /api/prompts` route handlers remove the `isCurrentUserAdmin()` guard. Access control is handled by RLS (each user can only read/write their own prompts).
- **P3.R4** The `isAdmin` flag is removed from `AuthProvider`. The `useProfile` hook is removed or simplified (no admin fetch needed).
- **P3.R5** The `isCurrentUserAdmin()` function in `profile-service.ts` is removed.
- **P3.R6** The `is_admin()` SQL function is retained in the database (no migration to drop it) but is no longer referenced by any RLS policy or application code. It can be cleaned up in a future migration.
- **P3.R7** The `is_admin` column on `profiles` is retained but no longer checked. It may be repurposed for a future team admin role.

### Acceptance Criteria

- [ ] Any authenticated user can access `/settings` and see the prompt editor
- [ ] The Settings tab appears in the navigation for all users
- [ ] The prompt API routes accept requests from any authenticated user
- [ ] No reference to `isCurrentUserAdmin`, `isAdmin`, or `is_admin()` exists in application code (services, routes, components, hooks)
- [ ] The `AuthProvider` no longer exposes an `isAdmin` flag

---

## Backlog (Future — Not Part of This PRD)

- **Team/workspace model:** Group users into organisations with shared session visibility, shared clients, shared prompts, and per-org master signals.
- **Workspace admin role:** Reintroduce admin as a per-workspace role for managing team settings, prompts, and member access.
- **Session sharing:** Explicitly share a session with another user or team.
- **Invite system:** Email-based invitations to join a workspace.
- **Per-user prompt templates:** Industry-specific starter prompts (fintech, SaaS, healthcare) that users can select during onboarding.
