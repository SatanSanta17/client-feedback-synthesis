# PRD-012: Code Quality — SOLID, DRY, and Design Consistency

> **Status:** Draft

## Purpose

A full codebase audit revealed systematic violations of the project's own CLAUDE.md rules: scattered inline Tailwind colors instead of centralised CSS tokens, duplicated logic across files, and monolithic components with 400+ lines handling 5–7 responsibilities each. These issues slow development — every change requires understanding unrelated concerns in the same file, and a single-line style update (e.g., changing the error colour) requires editing 10+ files.

This PRD addresses three categories:
1. **Design token consistency** — centralise status colours and eliminate arbitrary font sizes per the styling rules.
2. **DRY extraction** — remove duplicated logic (cookie helpers, auth form patterns, signal extraction, AI error mapping).
3. **SRP decomposition** — split oversized components and routes into focused, single-responsibility units.

This is a refactoring effort. No user-visible features change. No database changes. No API contract changes. The product behaves identically before and after.

## User Story

As a developer, I want each file in the codebase to have a single reason to change and shared patterns to live in one place, so that I can modify features confidently without hunting through unrelated code or risking inconsistencies.

---

## Part 1: Design Tokens and Typography

### Requirements

**P1.R1 — Centralise status colours in globals.css.** Define CSS custom properties for error, success, warning, and info status colours (both text and light background variants). These replace the scattered Tailwind utility colours (`text-red-500`, `bg-green-50`, `border-amber-200`, etc.) used across components.

**P1.R2 — Replace inline status colours with tokens.** Every component currently using hardcoded Tailwind colour classes for status indication (errors, success states, warning banners, info banners) must switch to the new CSS custom properties. No hardcoded `red-500`, `green-50`, `amber-*`, or `blue-*` classes for status purposes.

**P1.R3 — Fix arbitrary font sizes.** Replace the `text-[10px]` in `workspace-switcher.tsx` with a standard Tailwind type scale class. No arbitrary `text-[Npx]` values in the codebase.

### Acceptance Criteria

- [ ] P1.AC1 — `globals.css` contains `--status-error`, `--status-error-light`, `--status-success`, `--status-success-light`, `--status-warning`, `--status-warning-light`, `--status-info`, `--status-info-light` (plus text variants as needed)
- [ ] P1.AC2 — No component uses `text-red-500`, `bg-red-50`, `text-green-500`, `bg-green-50`, `text-amber-*`, `bg-amber-*`, `text-blue-*`, or `bg-blue-*` for status styling — all reference CSS custom properties
- [ ] P1.AC3 — No arbitrary `text-[Npx]` font sizes exist in any component
- [ ] P1.AC4 — Visual appearance of all error messages, success panels, warning banners, and info banners is unchanged

---

## Part 2: DRY — Shared Utilities and Patterns

### Requirements

**P2.R1 — Team cookie helpers.** Extract `getActiveTeamId()`, `setActiveTeamCookie()`, and `clearActiveTeamCookie()` into a single shared module. All consumers import from this module. Remove all inline/local implementations.

**P2.R2 — Signal extraction hook.** Extract the duplicated AI signal extraction flow from `session-capture-form.tsx` and `expanded-session-row.tsx` into a shared custom hook (`useSignalExtraction` or similar). The hook encapsulates `ExtractionState`, `performExtraction`, re-extract confirmation state, and toast/error handling. Both components consume the hook instead of duplicating the logic.

**P2.R3 — Re-extract confirmation dialog.** Extract the inline re-extract confirmation overlay (duplicated in both capture form and expanded row) into a shared component.

**P2.R4 — Auth form shell.** Extract the repeated auth card layout (centred page, bordered card, padding, heading/subtitle) used by login, signup, forgot-password, and reset-password into a shared layout component. Each auth form composes this shell instead of duplicating the wrapper markup.

**P2.R5 — Email confirmation panel.** Extract the "Check your email" success state (green circle, CheckCircle2 icon, email copy, "Back to sign in" link) shared between signup and forgot-password into a single component.

**P2.R6 — AI error response mapper.** Extract the duplicated AI error-to-HTTP-response mapping logic from `api/ai/extract-signals/route.ts` and `api/ai/generate-master-signal/route.ts` into a shared helper.

**P2.R7 — Invite role picker.** Extract the `Role` type and Admin/Sales `<Select>` block duplicated between `invite-single-form.tsx` and `invite-bulk-dialog.tsx` into a shared component.

**P2.R8 — Auth provider profile query.** Deduplicate the `profiles.select("can_create_team")` query that appears twice in `auth-provider.tsx` (after `getUser` and inside `onAuthStateChange`) into a single helper function within the file.

### Acceptance Criteria

- [ ] P2.AC1 — `getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie` exist in one file under `lib/`; no other file contains inline implementations of these
- [ ] P2.AC2 — Signal extraction state, API call, and re-extract flow exist in one custom hook; `session-capture-form.tsx` and `expanded-session-row.tsx` import and use the hook
- [ ] P2.AC3 — Re-extract confirmation UI exists as one shared component; both capture form and expanded row render it
- [ ] P2.AC4 — Auth forms (login, signup, forgot-password, reset-password) use a shared card shell component; no four-way duplication of the centred card layout
- [ ] P2.AC5 — "Check your email" success state exists as one component; signup and forgot-password import it
- [ ] P2.AC6 — AI error mapping exists in one helper; both AI route handlers import it
- [ ] P2.AC7 — Role type and select block exist in one component; both invite forms import it
- [ ] P2.AC8 — `auth-provider.tsx` has no duplicated profile query — one helper, called from both paths
- [ ] P2.AC9 — All existing functionality works identically after extraction — no behavioural changes

---

## Part 3: SRP — Component Decomposition

### Requirements

**P3.R1 — Split `expanded-session-row.tsx`.** Decompose the 432-line component into focused subcomponents. Editing state, signal extraction (via Part 2 hook), deletion flow, and presentational layout should each be a distinct unit. The parent becomes a thin coordinator.

**P3.R2 — Split `prompt-editor-page-content.tsx`.** Decompose the 497-line component. Extract the prompt API orchestration (load, save, reset, revert) into a custom hook. Extract the master-signal tab notice and the unsaved-changes flow into separate components. The page content becomes a composition of focused parts.

**P3.R3 — Split `master-signal-page-content.tsx`.** Decompose the 335-line component. Extract data fetching (master signal load, team admin check) into a custom hook. Extract the warning/stale/info banners into a shared banner component pattern. The page content composes hook output with presentational components.

**P3.R4 — Split `past-sessions-table.tsx`.** Extract the nested `SessionTableRow` into its own file. Separate the pagination/fetch logic from the expand/dirty coordination and the presentational table.

### Acceptance Criteria

- [ ] P3.AC1 — `expanded-session-row.tsx` is split into ≥3 focused files, none exceeding ~150 lines, each with a single responsibility
- [ ] P3.AC2 — `prompt-editor-page-content.tsx` is split into ≥3 focused files; API orchestration lives in a custom hook
- [ ] P3.AC3 — `master-signal-page-content.tsx` is split into ≥2 focused files; data fetching lives in a custom hook
- [ ] P3.AC4 — `SessionTableRow` lives in its own file; `past-sessions-table.tsx` is reduced in scope
- [ ] P3.AC5 — All session capture, editing, prompt management, and master signal flows work identically after decomposition

---

## Part 4: SRP — API Route and Service Layer Cleanup

### Requirements

**P4.R1 — Extract generate-master-signal orchestration.** Move the full cold-start/tainted/incremental workflow from the `api/ai/generate-master-signal/route.ts` route handler into a service function. The route becomes auth check + service call + error mapping.

**P4.R2 — Extract team members data assembly.** Move the multi-query team members + profiles join from `api/teams/[teamId]/members/route.ts` into a service function in `team-service.ts`.

**P4.R3 — Extract session permission check.** Move `checkTeamSessionPermission` (and its direct Supabase reads) from `api/sessions/[id]/route.ts` into the service layer.

**P4.R4 — Add Zod validation to GET routes.** Add Zod query parameter validation to `GET /api/clients` (for `q` and `hasSession`) and `GET /api/prompts` (for `key`), matching the pattern already used by `GET /api/sessions`.

**P4.R5 — Decouple prompt templates from service layer.** Move the `SignalSession` type from `master-signal-service.ts` to a shared location (e.g., `lib/types/`) so that `master-signal-synthesis.ts` (prompts layer) does not import from the service layer.

### Acceptance Criteria

- [ ] P4.AC1 — `generate-master-signal` route handler is ≤50 lines; orchestration lives in a service function
- [ ] P4.AC2 — Team members data assembly lives in `team-service.ts`; the route handler only validates and delegates
- [ ] P4.AC3 — Session permission logic lives in the service layer; the route does not make direct Supabase queries for permission checks
- [ ] P4.AC4 — `GET /api/clients` and `GET /api/prompts` validate query params with Zod schemas
- [ ] P4.AC5 — `master-signal-synthesis.ts` does not import from `lib/services/`; shared types live in `lib/types/`
- [ ] P4.AC6 — All API endpoints return identical responses before and after

---

## Backlog

- Add missing entry logs to GET route handlers (low impact, consistency improvement)
- Extract shared table shell component for team-members-table and pending-invitations-table (similar bordered table header styling)
- Extract `ConfirmDialog` from `team-members-table.tsx` into `components/ui/` for reuse
- Replace `router.push("/login")` in auth provider sign-out with a configurable redirect path
- Consider injectable data-access layer for services (testability improvement, high effort)
