# PRD-023: Codebase Cleanup

## Purpose

The codebase has accumulated structural debt as features have shipped fast: a 2,000-line query service, a 660-line streaming hook, two API routes that duplicate a 50-line orchestration chain, the same auth/team-context boilerplate copy-pasted across ~10 routes, and a sprinkling of dead files, manual className concatenation, hardcoded chart hex codes, and unjustified `any` types. None of this is broken — but each violation makes the next feature slower and riskier. This PRD restores SRP/DRY discipline across the most affected surfaces (services, hooks, API routes, capture/chat components) without changing any user-facing behavior.

## User Story

As a developer maintaining this codebase, I want oversized files split by domain, repeated patterns extracted into shared helpers, dead code removed, and small conventions enforced consistently — so that the next feature can be built without reading 600-line hooks, the next bug can be traced through a single-purpose module, and new contributors can navigate the project without hunting for the canonical implementation of common patterns.

As an end user, I want zero behavior change from this work — every page, route, and flow continues to work exactly as it does today.

---

## Part 1 — Quick Wins

**Severity:** Low — small, isolated edits across unrelated files. No structural risk.

### Requirements

**P1.R1 — Empty `_helpers.ts` file is removed.**
The 0-byte file `app/api/sessions/_helpers.ts` is deleted. No imports anywhere reference it; it has been empty since creation.

**P1.R2 — Theme toggle is consolidated into a single shared component used everywhere.**
Theme toggling currently happens in two places — the authenticated sidebar (`components/layout/app-sidebar.tsx`) and the public landing-page footer (`app/_components/landing-page.tsx`) — each with its own inline `<button>` + `useTheme()` + `Sun`/`Moon` icon swap. The existing shared `ThemeToggle` component (`components/layout/theme-toggle.tsx`) is exported but unused. After this part, both surfaces render the shared `ThemeToggle` (passing only layout props such as `className`); no inline `setTheme(theme === "dark" ? "light" : "dark")` button exists anywhere outside that component. The shared component remains the single source of truth for the icon, the aria-label, and the toggle behaviour.

**P1.R3 — "Role unchanged" surfaces as an explicit warning, not a silent success.**
The role-update route (`PATCH /api/teams/[teamId]/members/[userId]/role`) currently returns an implicit `200` with the generic `{ message: "Role unchanged" }` when the requested role equals the current role. This is misleading — the caller treats it as a successful change. After this part, the route returns a non-2xx status (the TRD pins it to `409 Conflict` — semantic match for "tried to change to a value matching current state") with a descriptive message that names the current role explicitly, e.g., `{ message: "Member already has role 'admin'" }`. The frontend caller (`team-members-table.tsx`) surfaces this as a warning toast (not a success toast and not a silent dismissal), so the user understands no change was made and why.

**P1.R4 — Manual className concatenation is replaced with `cn()`.**
Every component currently using template-literal class strings (e.g., `` `text-sm ${isActive ? "text-primary" : ""}` ``) is migrated to `cn()` so Tailwind class conflicts are resolved consistently. The known offenders are: `app/layout.tsx`, `app/capture/_components/prompt-version-filter.tsx`, `app/capture/_components/session-table-row.tsx`, `app/chat/_components/message-thread.tsx`, and `app/invite/[token]/_components/invite-shell.tsx`. A grep for backtick-interpolated `className` values returns zero matches after this part.

**P1.R5 — Hardcoded chart hex values are centralized.**
Inline hex codes in `app/dashboard/_components/session-volume-widget.tsx` and `app/dashboard/_components/theme-client-matrix-widget.tsx` are moved into the existing `chart-colours.ts` constants module. Widgets reference named constants, never raw hex.

**P1.R6 — Unjustified `any` types are typed or annotated.**
`app/dashboard/_components/top-themes-widget.tsx` (`payload?: any[]`) and `lib/repositories/supabase/scope-by-team.ts` (generic constraint `T extends { eq: any; is: any }`) are either replaced with concrete types or annotated with an `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>` comment that explains why a typed alternative is impractical. A repo-wide grep for `: any` returns only annotated occurrences.

### Acceptance Criteria

- [ ] P1.R1 — `app/api/sessions/_helpers.ts` no longer exists.
- [ ] P1.R2 — `app-sidebar.tsx` and `landing-page.tsx` both render `<ThemeToggle />`; a repo-wide grep for inline `setTheme(theme === "dark" ? "light" : "dark")` returns only the shared component.
- [ ] P1.R3 — Role-update route returns `409 Conflict` with a message that names the current role; frontend surfaces this as a warning toast, not a success toast.
- [ ] P1.R4 — Zero template-literal `className` strings remain; all conditional classes use `cn()`.
- [ ] P1.R5 — Chart widgets reference named constants from `chart-colours.ts`; no inline hex codes remain in widget files.
- [ ] P1.R6 — Every `: any` in the codebase either has a concrete type replacement or an inline justification comment.

---

## Part 2 — Shared Route Helpers (Auth, File Validation, Inline Queries)

**Severity:** High — touches ~12 API routes. Migration must preserve behavior on every endpoint.

### Requirements

**P2.R1 — Auth/team-context boilerplate is extracted into shared helpers.**
The 7-line "create supabase → getUser → 401 → service client → repo → check role" pattern currently duplicated across team and session routes lives in a single module. The module exposes at minimum: `requireAuth()`, `requireTeamAdmin(teamId, user)`, `requireTeamOwner(teamId, user)`, and `requireSessionAccess(sessionId)`. Each helper returns the resolved context (user, teamId, repos) on success and a `NextResponse` on failure — callers either destructure the success result or short-circuit with the failure response.

**P2.R2 — All affected routes are migrated to the shared helpers.**
Every route under `app/api/teams/**`, `app/api/sessions/**`, `app/api/sessions/[id]/attachments/**`, and the AI routes (`/api/ai/extract-signals`, `/api/ai/generate-master-signal`) uses the shared helpers. After migration, no route handler contains the literal sequence `createClient() → auth.getUser() → if (!user) return 401`.

**P2.R3 — File constraint validation is shared.**
File size and MIME-type validation duplicated in `app/api/sessions/[id]/attachments/route.ts` and `app/api/files/parse/route.ts` is extracted into a single helper that returns either `{ valid: true }` or `{ valid: false; message }`. Both routes call the helper.

**P2.R4 — Inline Supabase query is moved into a service.**
`POST /api/teams` currently issues a direct `supabase.from("profiles").select("can_create_team")` query. This becomes a function in `team-service.ts` (e.g., `canUserCreateTeam`); the route only calls the service.

**P2.R5 — Behavior, status codes, and error bodies are unchanged.**
Every migrated route continues to return identical HTTP status codes, identical `{ message }` bodies on failure, and identical happy-path payloads. Logging granularity (entry/exit/error with sessionId/teamId where relevant) is preserved.

### Acceptance Criteria

- [ ] P2.R1 — A single auth-helpers module exists and exposes the four named helpers.
- [ ] P2.R2 — No route handler contains the `auth.getUser()` + 401-check sequence inline; every team/session/AI route calls a helper.
- [ ] P2.R3 — Both file-upload routes call the shared file-validation helper; the inline size/MIME checks are removed.
- [ ] P2.R4 — `POST /api/teams` no longer queries `profiles` directly; the check lives in `team-service.ts`.
- [ ] P2.R5 — Existing API tests / manual flow walkthroughs (login, invite, session create, attachment upload, role change) all pass with no behavioral diff.

---

## Part 3 — Session Orchestration Extracted from Routes

**Severity:** High — affects the most important write paths (session create + re-extract). Background chain failures here are user-visible (missing embeddings/themes/insights).

### Requirements

**P3.R1 — The post-response chain lives in a service, not in the route.**
The 50-line `after()` block currently inlined in `POST /api/sessions` and `PUT /api/sessions/[id]` — which sequences `generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights` — is moved into a single orchestrator function in a service module (e.g., `session-orchestrator.ts` or an exported function from `session-service.ts`). Both routes call the orchestrator with the same arguments shape.

**P3.R2 — Per-stage timing and error logs are preserved verbatim.**
The orchestrator emits the same `chain timing — embeddings/themes/insights` logs and the same unconditional error log (with `sessionId`, `elapsedMs`, error message, and stack) currently produced by the routes. Production observability is unchanged.

**P3.R3 — `after()` registration remains in the route.**
The route still wraps the orchestrator call in `after()` so the function-instance lifetime extension behavior is unchanged; only the *body* of the `after()` callback is the new service call. `export const maxDuration = 60` stays in both route files (Next.js requires it as a literal; this is not regressed by Part 3).

**P3.R4 — Chunk computation deduplicates.**
The `SessionMeta` setup and `chunkStructuredSignals` / `chunkRawNotes` selection currently repeated in both route files is consolidated — either as a helper that the orchestrator owns, or by having the orchestrator accept the inputs and compute chunks once.

**P3.R5 — Both session route files shrink meaningfully.**
After this part, `POST /api/sessions` and `PUT /api/sessions/[id]` are each under 200 LOC and contain only: validation, auth, service call (CRUD), `after(orchestrator(...))`, response. No business orchestration remains in either route.

### Acceptance Criteria

- [ ] P3.R1 — A single orchestrator function exists; both routes call it.
- [ ] P3.R2 — Timing logs and error logs match the pre-cleanup output for a successful session create and a failure-injected run.
- [ ] P3.R3 — `after()` and `maxDuration = 60` remain in the route files; the chain still completes post-response on Vercel.
- [ ] P3.R4 — `SessionMeta` construction and chunk selection appear in exactly one location.
- [ ] P3.R5 — Both session route files are under 200 LOC and contain no inline `.then().then().catch()` chain.

---

## Part 4 — `useChat` Hook Decomposition

**Status:** Deferred to PRD-024 — **delivered**. See PRD-024 Parts 1, 2, and 6.

This part originally proposed a cleanup-only decomposition of `lib/hooks/use-chat.ts` with no behavior change. Planning surfaced two limitations that make a cleanup-only refactor not worth shipping in isolation:

1. The hook owns streaming state in a single instance scoped to the chat page. Switching conversations mid-stream causes the streaming bubble and the final assistant-message append to render against whichever conversation is currently displayed, even when the stream belongs to a different one. The bug is purely client-side (the server persists correctly), but it's user-visible.
2. The same shape lets a user navigate away from a streaming conversation and start a second send in another conversation, which silently orphans the first stream's `AbortController` and interleaves writes to shared state. There is no global signal that "a stream is alive somewhere," so the chat-input cannot be disabled correctly across conversations.

Both issues require lifting streaming state out of the hook into a streaming context keyed by `conversationId`, with per-conversation slices, a global "active streams" set for the sidebar/input gate, and per-conversation cancel/start methods. That architectural change is also the natural enabler of multi-conversation streaming.

**Where the original P4 goals landed in PRD-024:**

- **P4.R1 — `useChat` decomposition / size reduction.** Delivered by PRD-024 **Part 2** (migration: removed streaming internals — refs, abort controllers, SSE loop, state machines — and re-routed them through the new `lib/streaming/` module) and **Part 6** (decomposed the remaining `useChat` into a thin composer wiring `useConversationMessages` + `useChatStreaming`; under-200-LOC ceiling met at ~128 LOC).
- **P4.R2 — Shared SSE parser / follow-up regex.** Delivered by PRD-024 **Part 1 Increment 1** (extracted `parseSSEChunk`, `stripFollowUpBlock`, and the `<!--follow-ups:...-->` regex to `lib/utils/chat-helpers.ts`; both the new streaming module's `runStream` and the server-side `chat-stream-service.ts` import from this single source — repo-wide grep confirms exactly one source file).

The pre-existing UI-bleed bug and the multi-stream concurrency capability were delivered as side-effects of the same architectural lift (PRD-024 Parts 2 + 3). See `ARCHITECTURE.md`'s `## Streaming Context (PRD-024)` section for the full architecture narrative.

No work from Part 4 lands under PRD-023.

---

## Part 5 — `database-query-service` Domain Split

**Severity:** Critical — the 2,036-LOC monolith is the single largest source-of-truth file in the codebase. Every dashboard widget and chat tool depends on it.

### Requirements

**P5.R1 — Action handlers are organized by domain.**
The 18 query actions currently bundled in one file are partitioned by domain (e.g., counts, distributions, themes, drill-downs, insights). Each domain lives in its own module. No new module exceeds ~400 LOC.

**P5.R2 — Severity filtering is one helper, not three.**
`sessionHasSignalWithSeverity`, `applySeverityRowFilter`, and `fetchSessionIdsMatchingSeverity` collapse into a single severity-filter module exposing one cohesive API. The three current call sites use the new module exclusively.

**P5.R3 — Base query builders are extracted.**
The repeated team/date filtering pattern used by `baseSessionQuery`, `baseClientQuery`, and the inline theme-query filters is extracted into a base-query-builder module. No domain handler reimplements team scoping or date filtering inline.

**P5.R4 — Drill-down logic deduplicates.**
`fetchDirectDrillDownRows` and `handleCompetitorDrillDown` currently overlap ~40%. The shared row-fetch + JSON-filter + row-building pattern lives in one helper; the two handlers call it with their type-specific differences.

**P5.R5 — The main file becomes a thin router.**
After this part, `database-query-service.ts` (or its successor) contains only: type definitions, action metadata, the action map, the `executeQuery` entry point, and any shared types. It is under 300 LOC. Domain logic lives in domain modules.

**P5.R6 — Public surface is unchanged.**
The signature of `executeQuery` and the shape of every action's result stay identical. The chat tool definitions, dashboard widget calls, and any other consumers continue to work unchanged.

**P5.R7 — Adding a new action is a single-file change in most cases.**
Adding a new query action to the count domain (for example) requires editing only the count-domain module and the action-map registration. No other domain module is touched.

### Acceptance Criteria

- [ ] P5.R1 — Domain modules exist; each is under ~400 LOC; the 18 actions are distributed across them.
- [ ] P5.R2 — One severity-filter module owns severity logic; the three legacy helpers are gone or are thin re-exports for one release.
- [ ] P5.R3 — A base-query-builder module exists; no inline `.eq("team_id", teamId)` chains remain in domain handlers.
- [ ] P5.R4 — Drill-down row-fetch + filter logic appears in exactly one place.
- [ ] P5.R5 — The router file is under 300 LOC.
- [ ] P5.R6 — Every dashboard widget and the chat `queryDatabase` tool produce identical outputs to pre-cleanup runs on representative inputs.
- [ ] P5.R7 — Walkthrough: adding a hypothetical "count_archived_sessions" action requires editing only the count domain module and the action-map.

---

## Part 6 — Capture Row Decomposition

**Severity:** Medium — `expanded-session-row.tsx` is 418 LOC and is touched whenever the capture form changes; debt here directly slows session-flow features.

### Requirements

**P6.R1 — Form state, attachment state, save logic, and presentation are independent.**
The current single component fuses (a) form fields + dirty tracking + validation, (b) attachment manager (5 state pieces), (c) save handler with error mapping, (d) extraction triggering, and (e) UI rendering. After this part, each concern lives in a dedicated hook or module that the row component composes.

**P6.R2 — A reusable session-form hook owns form state.**
Form values, dirty state, validation outcomes, character-limit checks, and form reset live in one hook. The hook is consumable by any future session editor (bulk edit, CSV import) without modification.

**P6.R3 — A reusable attachment-manager hook owns attachment state.**
Saved attachments, pending attachments, deleted-ids, loading state, fetch, add, remove, and persist logic live in one hook. Mid-fetch unmount is handled cleanly (no React state-update warnings).

**P6.R4 — Save logic + error mapping moves out of the component.**
The HTTP call, response handling, and 404/409/generic error-message mapping live in a service or service-like module. The component dispatches a single `save()` call and renders the result.

**P6.R5 — Extraction is decoupled from save.**
Extraction success or failure does not block save, and a save failure does not silently roll back extraction state. The two concerns coordinate via explicit state, not via implicit ordering inside one handler.

**P6.R6 — Behavior is unchanged.**
The user experience (validation messages, dirty-prompt on cancel, attachment upload progress, error toasts, dashboard refresh on save) is identical to today.

### Acceptance Criteria

- [ ] P6.R1 — `expanded-session-row.tsx` is under ~200 LOC and primarily wires hooks together.
- [ ] P6.R2 — A session-form hook exists and owns form state, dirty tracking, validation, and reset.
- [ ] P6.R3 — An attachment-manager hook exists and owns all attachment state and operations; no fetch-after-unmount warnings.
- [ ] P6.R4 — A save service / module owns the HTTP call and error mapping; the component does not contain `fetch(\`/api/sessions/...\`)`.
- [ ] P6.R5 — Triggering an extraction and immediately closing the row, or failing a save mid-extraction, leaves UI state coherent (verified manually).
- [ ] P6.R6 — Capture flow (create session, edit, add/remove attachments, extract, save, cancel with dirty changes) walks through unchanged.

---

## Part 7 — Optimistic Mutation Hook

**Severity:** Medium — affects two hot paths (conversations sidebar + team members table). Bugs here cause optimistic UI to diverge from server state.

### Requirements

**P7.R1 — A single optimistic-mutation hook replaces ad-hoc patterns.**
The four-fold "optimistic update → API call → rollback fetch on error" pattern in `use-conversations.ts` (rename, pin, archive, unarchive) and the similar pattern in `team-members-table.tsx` (remove, transfer, leave) are subsumed by one shared hook. The hook accepts a mutation function, an optimistic-update function, and a rollback strategy.

**P7.R2 — Both consumers use the new hook.**
`use-conversations.ts` and `team-members-table.tsx` are migrated to the shared hook. The four conversation operations and the three member operations flow through it.

**P7.R3 — Rollback semantics are preserved.**
On API failure, the previous behavior — refetch the affected list(s), surface a toast — continues to work. No silent failures; no stale optimistic state.

**P7.R4 — Race conditions are not introduced.**
Rapidly triggering multiple mutations (e.g., quickly archiving three conversations) does not produce inconsistent optimistic state. The hook handles concurrent invocations correctly.

**P7.R5 — Public API of `useConversations` and `team-members-table` is unchanged.**
Consumers of these are not modified.

### Acceptance Criteria

- [ ] P7.R1 — A single optimistic-mutation hook is defined and exported.
- [ ] P7.R2 — `use-conversations.ts` and `team-members-table.tsx` no longer contain a hand-rolled `try { setX(optimistic); fetch(...); } catch { setX(rollback); }` pattern.
- [ ] P7.R3 — Forcing an API failure (e.g., DevTools network throttle / 500 response) restores the list to the server's truth and shows a toast.
- [ ] P7.R4 — Rapid sequential mutations on the same item do not produce inconsistent UI state.
- [ ] P7.R5 — Consumers of these hooks/components compile and behave identically.

---

## Part 8 — `ai-service` Consolidation

**Severity:** Medium — every AI call in the product flows through this service. Bugs surface as broken extraction, broken master-signal generation, or broken chat title generation.

### Requirements

**P8.R1 — A single generic model-call function replaces text/object duplicates.**
The currently duplicated retry-and-error wrappers around `generateText` and `generateObject` are unified into one generic function (e.g., `callModel<T>`). The text and object call paths reduce to thin specializations.

**P8.R2 — Error subclasses share a single factory.**
The five error subclasses (`AIEmptyResponseError`, `AIRequestError`, etc.) — currently each defined as a near-identical class — are produced by a single error factory or are reduced via shared base behavior. `AIServiceError` remains the public root.

**P8.R3 — Logging is uniform across model calls.**
Entry log, exit log, and error log produce identical structured fields (operation name, model id, provider, latency, retry count) for both text and object calls.

**P8.R4 — Retry policy is identical for both call paths.**
Exponential backoff, max-3-attempts, and 4xx-no-retry (except 429) behavior is enforced by the shared function — not duplicated in two places.

**P8.R5 — Public API is unchanged.**
`extractSignals`, `synthesiseMasterSignal`, `generateConversationTitle`, and any other exported callers continue to work without changes.

### Acceptance Criteria

- [ ] P8.R1 — `ai-service.ts` (or its split form) contains exactly one retry-and-error wrapper used by both text and object calls.
- [ ] P8.R2 — Error class definitions either share a factory or are reduced to thin subclasses; no duplicated bodies.
- [ ] P8.R3 — Logs from a text call and an object call show the same field structure.
- [ ] P8.R4 — A simulated 500 from the model triggers the same retry policy regardless of call type.
- [ ] P8.R5 — All callers of the AI service work without modification.

---

## Part 9 — Smaller Service-Level Cleanups

**Severity:** Low — multiple small, independent fixes. Each is safe in isolation; bundled here for one PR.

### Requirements

**P9.R1 — Prompt version-number computation is a service function.**
The "fetch history → sort by created_at → findIndex" computation duplicated in `app/api/prompts/[id]/route.ts` and `app/api/sessions/prompt-versions/route.ts` lives in `prompt-service.ts`. Both routes call the service.

**P9.R2 — Session enrichment helpers are consolidated.**
Email-resolution and attachment-count enrichment currently duplicated between `getSessions` and `updateSession` in `session-service.ts` collapse into one shared helper. Both code paths use it.

**P9.R3 — `chat-stream-service` tool builders share a factory.**
`buildSearchInsightsTool` and `buildQueryDatabaseTool` — which share ~60% of their bodies — are produced from a common tool-builder factory. Differences live as parameters.

**P9.R4 — Filter normalization is a single utility.**
The "trim strings, drop empty arrays" logic repeated in both tool builders is one utility function.

**P9.R5 — `updateSession` staleness logic is decomposed.**
The complex multi-condition staleness logic in `session-service.ts#updateSession` (P1.R4–R9 from the original session PRD) is extracted into a named decision function. The function returns a typed result describing what is stale. `updateSession` consumes it.

**P9.R6 — Conversation search input is debounced.**
The conversation search filter in `use-conversations.ts` currently runs on every keystroke, causing N re-renders per character typed and (on slower devices or large conversation lists) noticeable input lag. After this part, the search query is debounced before it drives list filtering — the input remains responsive (controlled), but the derived filter only updates after the user stops typing for a short interval. The exact debounce delay and implementation (e.g., a small `useDebouncedValue` utility hook vs. a third-party helper) are pinned in the TRD; the requirement is that no filter computation runs on every keystroke.

### Acceptance Criteria

- [ ] P9.R1 — Both prompt-version routes call a single service function for version-number computation.
- [ ] P9.R2 — Email + attachment-count enrichment appears in exactly one helper.
- [ ] P9.R3 — Tool-builder factory exists; the two tool builders are thin specializations.
- [ ] P9.R4 — Filter normalization is a utility, not inline string-trimming in two tool bodies.
- [ ] P9.R5 — Staleness decision is a named, typed function; `updateSession` reads cleanly top to bottom.
- [ ] P9.R6 — Typing in the conversation search input does not trigger a filter recomputation per keystroke; the debounced value drives the filter.

---

## Part 10 — Documentation Refresh

**Severity:** Low — pure documentation. Must run last so it reflects the post-cleanup state.

### Requirements

**P10.R1 — `ARCHITECTURE.md` "Current State" reflects the cleanup outcome.**
The summary paragraph is updated to describe the new module layout (split query handlers, route helpers, session orchestrator). It is a description of what exists, not a list of changes. (`useChat` decomposition is deferred to PRD-024 and is not part of this cleanup outcome.)

**P10.R2 — `ARCHITECTURE.md` file map matches reality.**
Every new file introduced by Parts 2, 3, and 5–9 is added to the file map. Every removed file (Part 1: `_helpers.ts`, `theme-toggle.tsx`) is removed from the file map. A walk of `app/`, `components/`, and `lib/` and a grep against the file map produces zero diffs.

**P10.R3 — `ARCHITECTURE.md` Key Design Decisions are updated where relevant.**
Decision #19 (post-response chain) is updated to point at the new orchestrator module. Any other decision that named a now-moved file is updated.

**P10.R4 — `CHANGELOG.md` has an entry per completed cleanup part.**
Each completed part (Parts 1, 2, 3, 5, 6, 7, 8, 9) lands its own dated entry summarizing the outcome (e.g., "PRD-023 P5: split `database-query-service.ts` into domain modules"). Entries describe what shipped, not how. Part 4 is deferred to PRD-024 and does not get an entry under PRD-023.

**P10.R5 — No stale references remain.**
A grep for the names of removed files, removed exports, or merged helpers returns zero hits across `ARCHITECTURE.md`, `CHANGELOG.md`, and `CLAUDE.md`. Comments in the codebase that point at moved files are also updated.

### Acceptance Criteria

- [ ] P10.R1 — "Current State" paragraph in `ARCHITECTURE.md` reflects the new module layout.
- [ ] P10.R2 — File map walk returns zero diffs against the actual filesystem.
- [ ] P10.R3 — Key Design Decisions referencing moved files are updated.
- [ ] P10.R4 — `CHANGELOG.md` has dated entries for Parts 1, 2, 3, 5, 6, 7, 8, and 9. Part 4 is excluded (deferred to PRD-024).
- [ ] P10.R5 — A repo-wide grep for removed identifiers returns zero hits in docs.

---

## Backlog

Items deferred from this cleanup — each is a real violation but lower leverage than the work above. They can be picked up as standalone follow-ups.

- **Centralized callback-URL helper.** Six auth/invite forms construct `${window.location.origin}/auth/callback` inline. Extract into `getAuthCallbackUrl(type?)`.
- **Structured logger.** Replace direct `console.log` / `console.error` usage across services and routes with a logger that emits structured fields. Required if/when log aggregation is introduced.
- **Filter schema for dashboard/capture.** The current filter-bar implementation requires editing 4–5 places to add a new filter. A schema-driven config would make new filters a single-file addition.
- **`structured-signal-view` component decomposition.** Four separate badge style maps + four near-identical list components. Centralize badge styles and extract a generic `<SignalList>`.
- **`app-sidebar` data-driven nav.** Current nav items are hardcoded JSX; a data-driven `NAV_CONFIG` would make additions safer.
- **Sidebar accessibility.** Add `aria-current` on active nav links; ensure keyboard-focused navigation expands the collapsed sidebar.
- **`landing-page` extraction.** Extract `<FeatureCard>`, `<StepCard>`, `<PrimaryCTA>` and move `FEATURES` / `STEPS` arrays to a config module.
- **Conversation pagination state shape.** Replace paired `activeHasMore` / `archivedHasMore` style with `hasMoreByView: Record<"active" | "archived", boolean>`.
- **`session-service` access-control consolidation.** `checkSessionAccess` is framework-agnostic but lives next to update logic; move to a dedicated access-control service and enforce at the service boundary, not just the route.
