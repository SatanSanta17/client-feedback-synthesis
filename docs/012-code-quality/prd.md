# PRD-012: Code Quality — SOLID, DRY, and Design Consistency

> **Status:** Complete

## Purpose

A full codebase audit revealed systematic violations of the project's own CLAUDE.md rules: scattered inline Tailwind colors instead of centralised CSS tokens, duplicated logic across files, and monolithic components with 400+ lines handling 5–7 responsibilities each. These issues slow development — every change requires understanding unrelated concerns in the same file, and a single-line style update (e.g., changing the error colour) requires editing 10+ files.

This PRD addresses five categories:
1. **Design token consistency** — centralise status colours, AI action colours, and eliminate arbitrary font sizes per the styling rules.
2. **Convention compliance** — fix navigation and type safety violations against the project's own CLAUDE.md rules.
3. **DRY extraction** — remove duplicated logic (cookie helpers, auth form patterns, signal extraction, AI error mapping).
4. **SRP decomposition** — split oversized components and routes into focused, single-responsibility units.
5. **Dependency Inversion** — introduce an injectable data-access layer so services depend on interfaces, not Supabase internals.

This is a refactoring effort. The only user-visible change is the AI action buttons gaining a gold/amber colour treatment. No database changes. No API contract changes.

## User Story

As a developer, I want each file in the codebase to have a single reason to change and shared patterns to live in one place, so that I can modify features confidently without hunting through unrelated code or risking inconsistencies.

---

## Part 1: Design Tokens and Typography

### Requirements

**P1.R1 — Centralise status colours in globals.css.** Define CSS custom properties for error, success, warning, and info status colours (both text and light background variants). These replace the scattered Tailwind utility colours (`text-red-500`, `bg-green-50`, `border-amber-200`, etc.) used across components.

**P1.R2 — Replace inline status colours with tokens.** Every component currently using hardcoded Tailwind colour classes for status indication (errors, success states, warning banners, info banners) must switch to the new CSS custom properties. No hardcoded `red-500`, `green-50`, `amber-*`, or `blue-*` classes for status purposes. This includes the hardcoded colour map object in `invite-shell.tsx` (lines 57–62) where status colours are stored as string literals (`"bg-red-50"`, `"text-amber-500"`, etc.) inside a JS object — these must also migrate to CSS custom property references so that a theme-wide colour change is a single-file edit.

**P1.R3 — Fix arbitrary font sizes.** Replace the `text-[10px]` in `workspace-switcher.tsx` with a standard Tailwind type scale class. No arbitrary `text-[Npx]` values in the codebase.

**P1.R4 — Define AI action colour tokens in globals.css.** Add CSS custom properties for a warm gold/amber AI action palette: `--ai-action` (primary gold for button backgrounds), `--ai-action-foreground` (text colour on gold backgrounds), `--ai-action-hover` (darker gold for hover state), and `--ai-action-light` (subtle gold tint for secondary/outline AI uses). The gold should complement the existing indigo/purple primary — warm amber in the `oklch(0.75–0.82, 0.14–0.18, 75–85)` range, not a flat bright yellow.

**P1.R5 — Add an `ai` variant to the Button component.** Create a new `"ai"` variant in `button.tsx` that uses the `--ai-action` tokens. The variant should have a warm gold background with legible foreground text, a visible hover state, and the same disabled/focus patterns as existing variants. Apply this variant to all AI-powered action buttons: "Extract Signals" / "Re-extract Signals" in `session-capture-form.tsx`, "Extract Signals" / "Re-extract" in `expanded-session-row.tsx`, and "Generate Master Signal" / "Re-generate" in `master-signal-page-content.tsx`.

### Acceptance Criteria

- [x] P1.AC1 — `globals.css` contains `--status-error`, `--status-error-light`, `--status-success`, `--status-success-light`, `--status-warning`, `--status-warning-light`, `--status-info`, `--status-info-light` (plus text variants as needed)
- [x] P1.AC2 — No component uses `text-red-500`, `bg-red-50`, `text-green-500`, `bg-green-50`, `text-amber-*`, `bg-amber-*`, `text-blue-*`, or `bg-blue-*` for status styling — all reference CSS custom properties, including JS objects that store colour class strings (e.g., `invite-shell.tsx` colour map)
- [x] P1.AC3 — No arbitrary `text-[Npx]` font sizes exist in any component
- [x] P1.AC4 — Visual appearance of all error messages, success panels, warning banners, and info banners is unchanged
- [x] P1.AC5 — `globals.css` contains `--ai-action`, `--ai-action-foreground`, `--ai-action-hover`, and `--ai-action-light` CSS custom properties with warm gold/amber values
- [x] P1.AC6 — `button.tsx` has an `"ai"` variant that uses the `--ai-action` tokens for background, text, and hover states
- [x] P1.AC7 — All three AI action buttons (Extract Signals in capture form, Extract Signals in expanded row, Generate Master Signal) use the `"ai"` button variant instead of `"outline"` or `"default"`
- [x] P1.AC8 — AI buttons are visually distinct from standard actions — gold/amber background with clear hover feedback, readable text, and consistent disabled/focus states

**P1.R6 — Replace `window.location.href` navigation with Next.js router.** Two components use `window.location.href` for page transitions instead of `useRouter().push()`: `login-form.tsx` (`window.location.href = "/capture"`) and `reset-password-form.tsx` (`window.location.href = "/capture"`). These are plain navigation — no reactivity gap — so a simple `router.push("/capture")` replacement is sufficient. Note: `window.location.origin` usage in OAuth redirect URLs is acceptable — those construct external callback URLs, not client-side navigation.

- [x] P1.AC9 — No component uses `window.location.href` for client-side page transitions — `login-form.tsx` and `reset-password-form.tsx` use `useRouter().push()` from `next/navigation` (OAuth `window.location.origin` for callback URL construction is exempt)

---

## Part 2: DRY — Shared Utilities and Patterns

### Requirements

**P2.R1 — Reactive team context and shared cookie helpers.** The active team ID is currently read from `document.cookie` via inline `getActiveTeamId()` functions scattered across 3+ components. Because cookie reads are not reactive, `workspace-switcher.tsx`, `create-team-dialog.tsx`, and `invite-mismatch-card.tsx` use `window.location.reload()` to force the UI to reflect the new team — the sessions table has no way to know the cookie changed. Fix this in two parts: (a) Extract `getActiveTeamId()`, `setActiveTeamCookie()`, and `clearActiveTeamCookie()` into a single shared client module under `lib/`. Remove all inline/local implementations. (b) Add a reactive `activeTeamId` value to the existing `AuthProvider` context (or a dedicated `useActiveTeam` hook/context). When workspace-switcher or create-team-dialog changes the active team, the context value updates, which triggers re-renders in consuming components (`PastSessionsTable`, `MasterSignalPageContent`, etc.). This eliminates every `window.location.reload()` call — the cookie is still set for server-side reads, but client-side components react to the context change instead of needing a hard reload.

**P2.R2 — Signal extraction hook.** Extract the duplicated AI signal extraction flow from `session-capture-form.tsx` and `expanded-session-row.tsx` into a shared custom hook (`useSignalExtraction` or similar). The hook encapsulates `ExtractionState`, `performExtraction`, re-extract confirmation state, and toast/error handling. Both components consume the hook instead of duplicating the logic.

**P2.R3 — Re-extract confirmation dialog.** Extract the inline re-extract confirmation overlay (duplicated in both capture form and expanded row) into a shared component.

**P2.R4 — Auth form shell.** Extract the repeated auth card layout (centred page, bordered card, padding, heading/subtitle) used by login, signup, forgot-password, and reset-password into a shared layout component. Each auth form composes this shell instead of duplicating the wrapper markup.

**P2.R5 — Email confirmation panel.** Extract the "Check your email" success state (green circle, CheckCircle2 icon, email copy, "Back to sign in" link) shared between signup and forgot-password into a single component.

**P2.R6 — AI error response mapper.** Extract the duplicated AI error-to-HTTP-response mapping logic from `api/ai/extract-signals/route.ts` and `api/ai/generate-master-signal/route.ts` into a shared helper.

**P2.R7 — Invite role picker.** Extract the `Role` type and Admin/Sales `<Select>` block duplicated between `invite-single-form.tsx` and `invite-bulk-dialog.tsx` into a shared component.

**P2.R8 — Auth provider profile query.** Deduplicate the `profiles.select("can_create_team")` query that appears twice in `auth-provider.tsx` (after `getUser` and inside `onAuthStateChange`) into a single helper function within the file.

### Acceptance Criteria

- [x] P2.AC1a — `getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie` exist in one file under `lib/`; no other file contains inline implementations of these
- [x] P2.AC1b — A reactive `activeTeamId` is available via context or hook; `PastSessionsTable` and other team-dependent components consume it and refetch when it changes
- [x] P2.AC1c — `workspace-switcher.tsx`, `create-team-dialog.tsx`, and `invite-mismatch-card.tsx` no longer call `window.location.reload()` — team switch and team creation update the reactive context and the cookie, and the UI updates without a hard reload
- [x] P2.AC1d — Switching workspace correctly updates the sessions table to show the new workspace's sessions; creating a new team redirects to that team's workspace with the correct sessions displayed
- [x] P2.AC2 — Signal extraction state, API call, and re-extract flow exist in one custom hook; `session-capture-form.tsx` and `expanded-session-row.tsx` import and use the hook
- [x] P2.AC3 — Re-extract confirmation UI exists as one shared component; both capture form and expanded row render it
- [x] P2.AC4 — Auth forms (login, signup, forgot-password, reset-password) use a shared card shell component; no four-way duplication of the centred card layout
- [x] P2.AC5 — "Check your email" success state exists as one component; signup and forgot-password import it
- [x] P2.AC6 — AI error mapping exists in one helper; both AI route handlers import it
- [x] P2.AC7 — Role type and select block exist in one component; both invite forms import it
- [x] P2.AC8 — `auth-provider.tsx` has no duplicated profile query — one helper, called from both paths
- [x] P2.AC9 — All existing functionality works identically after extraction — no behavioural changes

---

## Part 3: SRP — Component Decomposition

### Requirements

**P3.R1 — Split `expanded-session-row.tsx`.** Decompose the 432-line component into focused subcomponents. Editing state, signal extraction (via Part 2 hook), deletion flow, and presentational layout should each be a distinct unit. The parent becomes a thin coordinator.

**P3.R2 — Split `prompt-editor-page-content.tsx`.** Decompose the 497-line component. Extract the prompt API orchestration (load, save, reset, revert) into a custom hook. Extract the master-signal tab notice and the unsaved-changes flow into separate components. The page content becomes a composition of focused parts.

**P3.R3 — Split `master-signal-page-content.tsx`.** Decompose the 335-line component. Extract data fetching (master signal load, team admin check) into a custom hook. Extract the warning/stale/info banners into a shared banner component pattern. The page content composes hook output with presentational components.

**P3.R4 — Split `past-sessions-table.tsx`.** Extract the nested `SessionTableRow` into its own file. Separate the pagination/fetch logic from the expand/dirty coordination and the presentational table.

**P3.R5 — Split `session-capture-form.tsx`.** Decompose the 382-line component. It currently handles form state (react-hook-form), file upload/attachment parsing, AI signal extraction, structured notes editing, and the full submit flow — all in one file. Extract the file upload section, the signal extraction section (via the Part 2 shared hook), and the structured notes panel into focused subcomponents. The parent becomes a form coordinator that composes these sections.

### Acceptance Criteria

- [x] P3.AC1 — `expanded-session-row.tsx` is split into ≥3 focused files, none exceeding ~150 lines, each with a single responsibility
- [x] P3.AC2 — `prompt-editor-page-content.tsx` is split into ≥3 focused files; API orchestration lives in a custom hook
- [x] P3.AC3 — `master-signal-page-content.tsx` is split into ≥2 focused files; data fetching lives in a custom hook
- [x] P3.AC4 — `SessionTableRow` lives in its own file; `past-sessions-table.tsx` is reduced in scope
- [x] P3.AC5 — `session-capture-form.tsx` is split into ≥3 focused files; file upload, extraction, and structured notes are separate components
- [x] P3.AC6 — All session capture, editing, prompt management, and master signal flows work identically after decomposition

---

## Part 4: SRP — API Route and Service Layer Cleanup

### Requirements

**P4.R1 — Extract generate-master-signal orchestration.** Move the full cold-start/tainted/incremental workflow from the `api/ai/generate-master-signal/route.ts` route handler into a service function. The route becomes auth check + service call + error mapping.

**P4.R2 — Extract team members data assembly.** Move the multi-query team members + profiles join from `api/teams/[teamId]/members/route.ts` into a service function in `team-service.ts`.

**P4.R3 — Extract session permission check.** Move `checkTeamSessionPermission` (and its direct Supabase reads) from `api/sessions/[id]/route.ts` into the service layer.

**P4.R4 — Add Zod validation to GET routes.** Add Zod query parameter validation to `GET /api/clients` (for `q` and `hasSession`) and `GET /api/prompts` (for `key`), matching the pattern already used by `GET /api/sessions`.

**P4.R5 — Decouple prompt templates from service layer.** Move the `SignalSession` type from `master-signal-service.ts` to a shared location (e.g., `lib/types/`) so that `master-signal-synthesis.ts` (prompts layer) does not import from the service layer.

### Acceptance Criteria

- [x] P4.AC1 — `generate-master-signal` route handler is ≤50 lines; orchestration lives in a service function
- [x] P4.AC2 — Team members data assembly lives in `team-service.ts`; the route handler only validates and delegates
- [x] P4.AC3 — Session permission logic lives in the service layer; the route does not make direct Supabase queries for permission checks
- [x] P4.AC4 — `GET /api/clients` and `GET /api/prompts` validate query params with Zod schemas
- [x] P4.AC5 — `master-signal-synthesis.ts` does not import from `lib/services/`; shared types live in `lib/types/`
- [x] P4.AC6 — All API endpoints return identical responses before and after

---

## Part 5: Dependency Inversion — Injectable Data-Access Layer

### Requirements

**P5.R1 — Define a data-access interface for each service domain.** Every service file (`session-service.ts`, `client-service.ts`, `team-service.ts`, `master-signal-service.ts`, `invitation-service.ts`, `prompt-service.ts`, `profile-service.ts`, `attachment-service.ts`) currently imports `createClient` / `createServiceRoleClient` from `@/lib/supabase/server` and makes direct Supabase queries inline. This violates Dependency Inversion — high-level business logic depends on low-level database implementation details. Define a TypeScript interface (or set of functions) for each domain's data operations (e.g., `SessionRepository` with `getById`, `list`, `create`, `update`, `softDelete`). These interfaces describe *what* data is needed, not *how* it's fetched.

**P5.R2 — Implement Supabase adapters for each repository interface.** Create concrete implementations of each repository interface that use the existing Supabase client calls. These adapters live in a dedicated directory (e.g., `lib/repositories/supabase/`). The adapters contain all Supabase-specific query logic — no other file imports from `@/lib/supabase/server` except the adapter layer and middleware.

**P5.R3 — Refactor services to accept injected repositories.** Service functions receive their data-access dependency via parameter injection (factory function or direct argument) rather than importing Supabase clients. In production, API routes wire services to Supabase adapters. In tests, mock implementations can be injected without touching the database. Service files no longer import from `@/lib/supabase/server`.

### Acceptance Criteria

- [x] P5.AC1 — Each service domain has a corresponding repository interface in `lib/repositories/` (or equivalent location) defining its data operations
- [x] P5.AC2 — Each repository interface has a Supabase adapter implementation that contains all Supabase-specific query logic
- [x] P5.AC3 — No service file under `lib/services/` imports from `@/lib/supabase/server` — all data access goes through injected repository interfaces
- [x] P5.AC4 — API route handlers wire services to Supabase adapters; the wiring is explicit and visible
- [x] P5.AC5 — At least one service has a mock repository implementation demonstrating testability (e.g., `session-service` with an in-memory mock)
- [x] P5.AC6 — All API endpoints return identical responses before and after — this is a pure structural refactor

---

## Backlog

- ~~Add missing entry logs to GET route handlers (low impact, consistency improvement)~~ ✓ Done
- ~~Extract shared table shell component for team-members-table and pending-invitations-table (similar bordered table header styling)~~ ✓ Done
- ~~Extract `ConfirmDialog` from `team-members-table.tsx` into `components/ui/` for reuse~~ ✓ Done
- Replace `router.push("/login")` in auth provider sign-out with a configurable redirect path
- Replace `as unknown as` type casts in `session-service.ts` (line 121) and `invitation-service.ts` (line 260) with proper Supabase type inference or `satisfies` — these force-cast Supabase join results instead of handling the types correctly
