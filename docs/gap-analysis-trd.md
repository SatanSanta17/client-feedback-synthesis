# Gap Analysis — TRD

> Technical design for the fixes captured in `docs/gap-analysis.md`.
> Mirrors that doc's Engineering / Product structure 1:1. Parts whose "Fix" section has been locked in the gap file get a full technical plan here; others are placeholders awaiting fix approval in the gap file.
> `gap-analysis.md` is the PRD-equivalent (gap = problem, Fix section = PRD). This file is the TRD.

---

## Engineering Fixes

### E1 — `signOut()` doesn't clear `active_team_id` cookie ✅ Fixed
Implemented. `components/providers/auth-provider.tsx` — `signOut()` calls `clearActiveTeamCookie()` before resolving.

### E2 — Fire-and-forget chain is unsafe on Vercel free tier ✅ Fixed (phase 1)

**Scope.** Stop the embeddings → themes → insights chain from being silently truncated when Vercel freezes the function instance after the response. Out of scope (deferred): moving the chain to a real queue with retries/replay.

**Approach.** Use Next.js's native `after()` from `next/server` instead of installing `@vercel/functions`. `after()` is the framework-canonical wrapper; on Vercel it delegates to `waitUntil()`, locally it runs the callback after the response stream closes. Same semantics, one fewer dependency.

Combine with `export const maxDuration = 60` to raise the Hobby-tier hard ceiling from 10s default to the 60s plan maximum. `after()` alone cannot exceed the function's `maxDuration` — the runtime still terminates at the ceiling. The two changes are paired; neither alone is enough.

**Files changed.**
- `app/api/sessions/route.ts` (POST) — import `after`, add `export const maxDuration = 60`, wrap the chain expression in `after(...)`, add per-stage timing logs and unconditional error log.
- `app/api/sessions/[id]/route.ts` (PUT) — same changes. The `maxDuration` export applies to PUT and DELETE both; DELETE is fast, so the higher ceiling is harmless.

**No database changes. No API contract changes. No prompt changes. No new dependencies.**

**Implementation notes.**
- `after()` accepts either a callback or a promise. We pass the chain promise directly so it kicks off synchronously (same timing as before) and Vercel waits on it.
- Timing logs use a single `chainStart = Date.now()` captured before `after()`, then per-stage `Date.now() - stageStart` deltas. Format: `[POST /api/sessions] chain timing — embeddings: 4321ms — sessionId: …`. The final stage log also reports total chain time.
- Error log uses `console.error` (not `console.warn`) and includes `sessionId`, `elapsedMs`, message, and stack. The previous `NODE_ENV === "development"` gate is removed.
- The `embeddingIds.length === 0` short-circuit is preserved — an empty embedding result still skips theme assignment and falls through to the insights step (where `maybeRefreshDashboardInsights` does its own staleness check).

**End-of-part audit.**
- **SRP.** Routes still validate + delegate; the chain remains composed of the same three service calls.
- **DRY.** The two route files have intentionally parallel chain blocks (POST creates, PUT re-embeds). Not extracted to a helper because the call signatures diverge (`isReExtraction`, `userId` source) and a wrapper would need both as params — net code is similar. Revisit if a third caller emerges.
- **Logging.** Per-stage entry/exit logs and full-stack error log added — satisfies the "log entry, exit, errors" rule for the chain. Existing route handler logs untouched.
- **Dead code.** No removals.
- **Convention compliance.** `maxDuration` is a Next.js route segment config export (correct location: top of route file, not inside the handler).

**Verification.**
- `npx tsc --noEmit` passes.
- Manual smoke (dev): create a session → confirm `chain timing — embeddings/themes/insights` lines appear in server logs and total chain time is reported.
- Manual smoke (dev): force the chain to throw (e.g. break Voyage API key) → confirm the error log fires with sessionId and stack.
- Production observation (post-deploy): tail Vercel function logs for `chain timing — insights; total: …` and `EMBEDDING+THEME+INSIGHTS CHAIN FAILED` to gather p95 and failure rate over a representative session volume.

**Documentation updates (this fix):**
- `ARCHITECTURE.md` — Key Design Decision #19 added describing the `after()` + `maxDuration = 60` pattern and the migration trigger.
- `gap-analysis.md` — E2 marked ✅ Fixed with the deferred-follow-up note.
- `CHANGELOG.md` — entry under `[Unreleased]`: "Sessions create/re-embed: post-response embedding+theme+insights chain now runs under `after()` with `maxDuration = 60`; per-stage timing logs and unconditional error logging emitted in production."

**Deferred follow-up — queue migration.**
_Trigger:_ p95 of the `total: <ms>` log line approaches 60s, or the chain failure rate (failures / extractions) exceeds ~1% over a rolling week. Either signal indicates `after()` is no longer sufficient.

_Approach when triggered:_ move `generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights` into a queue worker. Candidates: Inngest (HTTP-trigger from the route, Vercel-native), QStash (Upstash, simple HTTP-cron + delayed jobs), or Supabase Queues (keeps everything in-Postgres). The route's only responsibility becomes enqueueing a job referencing the new `session.id`. The worker handles retries with exponential backoff, replay on failure, and execution time independent of Vercel function limits. This is a separate PRD with its own data model considerations (job dedup, idempotency on the per-stage operations, observability dashboard).

### E3 — No rate limiting on AI endpoints
_Fix not yet defined in gap file. TRD pending._

### E4 — `queryDatabase` chat tool frozen at 7 actions; service has 17 ✅ Fixed

**Scope.** Eliminate the parallel `QUERY_ACTIONS` array in `chat-stream-service.ts`. Replace it with a single registry in `database-query-service.ts` that drives the chat tool's action enum, the LLM-facing tool description, and the expanded filter input schema. Reach dashboard-equivalent expressivity in chat for every LLM-invocable action.

**Scope expanded same-day** to also implement actual `severity` filtering. Pre-expansion, `severity` was accepted in the API/service signature but no handler consumed it — both dashboard and chat treated it as a silent no-op. Exposing severity to the LLM as a no-op would have been worse than not exposing it (the LLM would narrate "showing high-severity feedback…" while returning unfiltered data), so we implement severity end-to-end in this fix.

This fix also resolves **P3 — "Chat can't answer theme or competitive questions"** (P3 is the user-visible symptom of E4; sharing a `QueryAction` source of truth was P3's stated unblocker).

**Approach.**

- **Registry-driven, not enum-derived.** A simple `Pick`-style derivation off `QueryAction` would only give us the action set; it can't carry per-action descriptions or the `llmToolExposed` flag. Use a typed record `Record<QueryAction, ActionMeta>` so adding a new action to `QueryAction` triggers a TypeScript error until it's classified — making drift structurally impossible.
- **`llmToolExposed`, not `chatSuitable`.** Naming matters here: `session_detail` *is* used in chat (the citation `SessionPreviewDialog` fetches it directly), but it is *not* an action the LLM should pick from a tool menu. The flag governs LLM tool exposure only; UI-side and API-side callers of `executeQuery` are unaffected. The TRD must call this out explicitly so a future reader doesn't strip out `session_detail` thinking it's chat-unused.
- **Filter schema expansion is not optional.** Without it, a registry-derived enum unlocks `top_themes`, `theme_trends`, etc. but the LLM can only filter them by `dateFrom`/`dateTo`/`clientName` — losing access to `severity`, `urgency`, `granularity`, `confidenceMin`, `clientIds[]` that the dashboard exposes. Goal is parity, so the filter schema grows to match.

**Files changed.**

- **Modified:** `lib/services/database-query-service.ts`
  - Add `interface ActionMeta { llmToolExposed: boolean; description: string }`.
  - Add `ACTION_METADATA: Record<QueryAction, ActionMeta>` covering all 17 actions.
  - Export `CHAT_TOOL_ACTIONS` — `as const` tuple derived from entries where `llmToolExposed === true`.
  - Export `ChatToolAction = (typeof CHAT_TOOL_ACTIONS)[number]`.
  - Export `buildChatToolDescription(): string` — composes the LLM-facing tool description from the registry (preamble + bulleted action list with per-action `description`).
- **Modified:** `lib/services/chat-stream-service.ts`
  - Delete `QUERY_ACTIONS` constant.
  - Replace `z.enum(QUERY_ACTIONS)` with `z.enum(CHAT_TOOL_ACTIONS)`.
  - Replace static `description: "Query the database for quantitative data..."` with `description: buildChatToolDescription()`.
  - Expand the `filters` Zod object: add `clientIds: z.array(z.string().uuid()).optional()`, `severity`, `urgency`, `granularity`, `confidenceMin`. Each field gets a `.describe()` string indicating which actions consume it.
  - Forward all filter fields to `executeQuery` (the service already accepts them via `QueryFilters`).
  - Cast `action as QueryAction` continues to typecheck because `ChatToolAction` is a subset.

**Severity implementation (scope expansion).**
- **Modified:** `lib/services/database-query-service.ts`
  - Add three shared helpers: `sessionHasSignalWithSeverity(json, severity)` (predicate scanning `painPoints`/`requirements`/`aspirations`/`blockers`/`custom.signals` chunk arrays), `applySeverityRowFilter(rows, severity)` (inline filter for handlers already fetching `structured_json`), and `fetchSessionIdsMatchingSeverity(supabase, filters)` (returns `Set<string> | null` for handlers that don't fetch JSON natively).
  - `handleSentimentDistribution`, `handleUrgencyDistribution`, `handleRecentSessions` — apply `applySeverityRowFilter` post-fetch (no extra query; they already select `structured_json`).
  - `handleClientHealthGrid` — add a severity check next to the existing urgency check (was already commented as planned).
  - `handleCountSessions`, `handleSessionsPerClient` — switch path when `severity` is set: fetch `structured_json`, post-filter, derive count/group from filtered rows. Server-side count is preserved when severity is unset.
  - `fetchSignalThemeRows` (used by `top_themes`, `theme_trends`, `theme_client_matrix`) — call `fetchSessionIdsMatchingSeverity` first; if returns an empty set, short-circuit `[]`; otherwise add `.in("session_embeddings.session_id", [...])` to the join.
  - `ACTION_METADATA` per-action `description` strings updated to honestly state which filters each action honors. The deferred handler (`sessions_over_time`) explicitly states severity is not honored, with the reason ("RPC-based aggregation").

**No database changes. No API contract changes. No prompt changes (the tool description is in code). No new dependencies.**

**Deferred work — `sessions_over_time` severity support.**
The handler calls a Postgres RPC (`sessions_over_time(p_team_id, p_date_from, p_date_to, p_granularity)`) for time-bucketed aggregation. Adding severity would require either (a) extending the RPC with `p_session_ids` and pre-resolving severity-matching sessions in TypeScript, or (b) re-implementing client-side time bucketing when severity is set. Both are out of scope for E4. The action's registry description states the limitation explicitly so the LLM (and any future reader) is aware.

**Implementation increments.**

**Increment 1 — Action registry in `database-query-service.ts`.**
1. Define `ActionMeta` interface.
2. Add `ACTION_METADATA: Record<QueryAction, ActionMeta>` immediately after the `QueryAction` type (so a developer changing `QueryAction` sees the registry in the same scroll). All 17 entries:

| action | `llmToolExposed` | `description` (LLM-facing summary) |
|---|---|---|
| `count_clients` | true | "Total number of clients in the workspace." |
| `count_sessions` | true | "Total number of sessions in the workspace." |
| `sessions_per_client` | true | "Session count grouped by client." |
| `sentiment_distribution` | true | "Count of signals by sentiment (positive / neutral / negative)." |
| `urgency_distribution` | true | "Count of signals by urgency tier." |
| `recent_sessions` | true | "Most recent sessions, newest first." |
| `client_list` | true | "List of clients with metadata." |
| `sessions_over_time` | true | "Session volume over time, bucketed by `granularity`." |
| `client_health_grid` | true | "Per-client health metrics for scatter-plot rendering." |
| `competitive_mention_frequency` | true | "How often each competitor is mentioned across signals." |
| `top_themes` | true | "Most-common signal themes ranked by mention count. Honors `confidenceMin`." |
| `theme_trends` | true | "Theme mention counts over time. Honors `granularity`, `confidenceMin`." |
| `theme_client_matrix` | true | "Theme × client cross-tabulation. Honors `confidenceMin`, `clientIds`." |
| `drill_down` | false | (not exposed — payload-driven; used by dashboard widget clicks) |
| `session_detail` | false | (not exposed — used by chat citation dialog and dashboard "View Session" via direct API fetch with `sessionId`) |
| `insights_latest` | true | "Most recent batch of AI-generated dashboard insight cards." |
| `insights_history` | true | "Historical batches of AI-generated insight cards (paginated by `batch_id`)." |

3. Export derivation:
```ts
export const CHAT_TOOL_ACTIONS = (Object.entries(ACTION_METADATA) as [QueryAction, ActionMeta][])
  .filter(([, meta]) => meta.llmToolExposed)
  .map(([action]) => action) as readonly ChatToolAction[];
export type ChatToolAction = ...; // narrowed via the same filter; see implementation note
```
Implementation note: the runtime filter doesn't narrow the type. Define `ChatToolAction` via a type-level filter (a const-asserted explicit tuple is simpler). Cleanest pattern:
```ts
const CHAT_TOOL_ACTIONS_TUPLE = [
  "count_clients", "count_sessions", "sessions_per_client", ...
] as const satisfies readonly QueryAction[];
export type ChatToolAction = typeof CHAT_TOOL_ACTIONS_TUPLE[number];
export const CHAT_TOOL_ACTIONS = CHAT_TOOL_ACTIONS_TUPLE;
```
Add a runtime sanity check (in dev) that `CHAT_TOOL_ACTIONS_TUPLE` matches `Object.keys(ACTION_METADATA).filter(k => ACTION_METADATA[k].llmToolExposed)`. Throws on mismatch — converts a future bug ("registry says exposed, tuple forgot to list it") into a startup-time error. Cheap insurance.

4. Export `buildChatToolDescription(): string`:
```ts
export function buildChatToolDescription(): string {
  const lines = CHAT_TOOL_ACTIONS.map(
    (action) => `- ${action}: ${ACTION_METADATA[action].description}`
  );
  return [
    "Query the database for quantitative data about clients, sessions, themes, competitive mentions, and dashboard insights. Use when the question involves counts, lists, distributions, or factual lookups.",
    "",
    "Available actions:",
    ...lines,
  ].join("\n");
}
```

**Increment 2 — Wire `chat-stream-service.ts` to the registry.**
1. Replace import: drop unused `QueryAction` (still used for the cast), import `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `buildChatToolDescription` from the service.
2. Delete the local `QUERY_ACTIONS` constant.
3. In `buildQueryDatabaseTool` (line 355):
   - `description: buildChatToolDescription()`
   - `action: z.enum(CHAT_TOOL_ACTIONS)`
   - The cast `action as QueryAction` stays valid (`ChatToolAction extends QueryAction`).
4. Logging: keep existing `tool:queryDatabase — action: …` log; add `filters: …` to the entry log so diagnostics include the LLM's chosen filter set.

**Increment 3 — Expand the filters input schema.**
Replace the existing 3-field filters object with the full chat-relevant set:
```ts
filters: z.object({
  dateFrom: z.string().optional().describe("Start date (ISO format YYYY-MM-DD)"),
  dateTo: z.string().optional().describe("End date (ISO format YYYY-MM-DD)"),
  clientName: z.string().optional().describe("Single-client convenience: matches by name when no UUID is known"),
  clientIds: z.array(z.string().uuid()).optional().describe("Filter by one or more client UUIDs"),
  severity: z.enum([...service severity values]).optional().describe("Filter signals by severity"),
  urgency: z.enum([...service urgency values]).optional().describe("Filter signals by urgency"),
  granularity: z.enum(["week", "month"]).optional().describe("Time bucketing granularity. Used by sessions_over_time, theme_trends"),
  confidenceMin: z.number().min(0).max(1).optional().describe("Minimum confidence score 0–1. Used by theme actions"),
}).optional()
```
Forward all fields into the `executeQuery` filter object. Trim string fields where the existing code does (`?.trim() || undefined` pattern preserved).

**Severity/urgency enum values:** match the service's `QueryFilters` type exactly. Read the type at implementation time and reuse the same union as the Zod enum.

**Increment 4 — Verify each LLM-exposed handler tolerates the expanded filters.**
Read-only verification step. For each of the 15 `llmToolExposed: true` handlers, confirm:
- Handler runs correctly with no filters set.
- Handler runs correctly when only the legacy 3 filters are set (regression check).
- Handler runs correctly when the new filters are set, including non-applicable cases (e.g., `theme_trends` receiving `confidenceMin` should honor it; `count_clients` receiving `confidenceMin` should ignore it gracefully — confirm no crashes).
No code changes expected here unless a handler throws on unexpected fields.

**Increment 5 — End-of-part audit + manual smoke tests.**
- `npx tsc --noEmit` passes.
- Smoke prompts (manual chat tests):
  - "What are our top themes?" → expects `top_themes` action.
  - "How are themes trending week-over-week?" → `theme_trends` with `granularity: "week"`.
  - "Which competitors come up most often?" → `competitive_mention_frequency`.
  - "Show me high-confidence themes only (above 0.8)" → `top_themes` with `confidenceMin: 0.8`.
  - "Show me high-severity feedback for Acme last month" → composed action+filter.
  - "What's the latest dashboard insights?" → `insights_latest`.
- Confirm server logs show correct `action` + `filters` per call.
- Confirm citation chip → "View full session" still opens `SessionPreviewDialog` correctly (regression check that `session_detail` is unaffected — no code path through it changed).

**End-of-part audit checklist.**
- **SRP.** Registry owns action metadata. Service owns query execution. Chat stream service owns LLM-facing wiring only.
- **DRY.** Single source of truth for action set, descriptions, and (transitively) the LLM tool description.
- **Design tokens.** No style changes.
- **Logging.** Tool entry log enriched with filters payload. No silent failures.
- **Dead code.** `QUERY_ACTIONS` removed. Confirm no other file imported it (grep first).
- **Convention compliance.** Named exports. Camel-case symbols. Registry placed alongside the type it shadows.

**Verification.**
- `npx tsc --noEmit` passes.
- Smoke prompts above all behave correctly.
- Citation dialog regression: open chat, get a response with sources, click chip → preview opens, click "View full session" → session loads. No code path through `session_detail` changed; this is a guardrail.

**Documentation updates after the part.**
- `gap-analysis.md` — mark E4 ✅ Fixed; mark P3 ✅ Fixed (resolved by E4).
- `ARCHITECTURE.md` — Key Design Decision #14 (chat data isolation): append a sentence noting the action enum and filter schema in the `queryDatabase` tool are derived from `ACTION_METADATA` in `database-query-service.ts`; new actions become LLM-invocable by setting `llmToolExposed: true`.
- `CHANGELOG.md` — entry under `[Unreleased]`: "Chat: queryDatabase tool now exposes 15 actions (theme, competitive-mention, client-health, sessions-over-time, insights-history) and dashboard-equivalent filters (`severity`, `urgency`, `granularity`, `clientIds`, `confidenceMin`), derived from a single registry in `database-query-service.ts`. Resolves theme/competitive question gap."
- `gap-analysis-trd.md` — flip P3 from "Blocked on E4" to "Resolved by E4 — see E4 above."

### E5 — No dev/prod database separation
_Fix not yet defined in gap file. TRD pending._

### E6 — Supabase storage not cleaned on session soft-delete
_Fix not yet defined in gap file. TRD pending._

### E7 — `MAX_COMBINED_CHARS` is a single static value for every model
_Fix not yet defined in gap file. TRD pending._

### E8 — `stopWhen: stepCountIs(3)` limits complex chat queries
_Fix not yet defined in gap file. TRD pending._

### E9 — Re-extraction race condition within teams
_Fix not yet defined in gap file. TRD pending._

### E10 — Theme taxonomy grows noisy with no deduplication
_Fix not yet defined in gap file. TRD pending._

### E11 — No observability layer
_Fix not yet defined in gap file. TRD pending._

### E12 — Embedding dimension migration has no documented path
_Fix not yet defined in gap file. TRD pending._

### E13 — No automated test suite
_Fix not yet defined in gap file. TRD pending._

---

## Product Fixes

### P1 — Master Signals page — UI retired; backend intentionally retained ✅ Decided
No further technical work in scope. A future cleanup PRD will either revive the UI or remove the backend (incl. a data migration for `master_signals`).

### P2 — Post-login redirect lands on Capture, not Dashboard ✅ Fixed
Implemented. `DEFAULT_AUTH_ROUTE` + `ONBOARDING_ROUTE` constants in `lib/constants.ts`; auth callback picks based on session count.

### P3 — Chat can't answer theme or competitive questions ✅ Fixed (resolved by E4)
Resolved end-to-end by the E4 fix above — the chat tool's action enum is now derived from the `ACTION_METADATA` registry and exposes `top_themes`, `theme_trends`, `theme_client_matrix`, `competitive_mention_frequency`, and the rest of the dashboard-equivalent action set. No P3-specific TRD needed.

### P4 — Starter questions are hardcoded and workspace-blind
_Fix not yet defined in gap file. TRD pending._

### P5 — No shared filter-persistence pattern across surfaces

**Scope.** A shared sessionStorage-based persistence primitive for filter state, consumable by any filtered surface regardless of whether that surface stores filters in the URL (dashboard) or local React state (capture past-sessions). URL remains source of truth for rendering/sharing where it's used; storage is purely a rehydration layer.

**Key format:** `filters:<surface>:<userId>:<workspaceId ?? "personal">`
- `userId` isolates users on a shared tab.
- `workspaceId` gives per-workspace memory; `"personal"` sentinel for null.
- Both segments present → stale keys from logged-out users are inert (different `userId` = never read by a subsequent user).

**Files changed.**
- **New:** `lib/hooks/use-filter-storage.ts` — the primitive hook.
- **Modified:** `components/providers/auth-provider.tsx` — `setActiveTeam()` calls `router.replace(pathname)` to strip stale URL query params on workspace switch.
- **Modified:** `app/dashboard/_components/filter-bar.tsx` — wires URL ↔ storage via the hook.
- **Modified:** `app/capture/_components/past-sessions-table.tsx` — wires React state ↔ storage via the hook.

**No database changes. No API changes. No prompt changes.**

**Implementation increments.**

**Increment 1 — Primitive hook (`lib/hooks/use-filter-storage.ts`).**
Shape:
```ts
interface UseFilterStorageReturn<T> {
  /** null until user loads, then stable until user or workspace changes */
  key: string | null;
  read: () => T | null;
  write: (value: T) => void;
}

function useFilterStorage<T>(surface: string): UseFilterStorageReturn<T>
```
- Derives key from `useAuth()` — `filters:${surface}:${user.id}:${activeTeamId ?? "personal"}`.
- Returns `key: null` while `user` is not yet loaded; `read`/`write` become no-ops in that state so callers never crash.
- SSR guard: both ops check `typeof window !== "undefined"`.
- JSON parse/stringify for values; caught with a debug warn on failure, returns `null`.
- Logs prefix `[useFilterStorage]` at debug level; no-op on production console clutter.

Why a primitive (not a `usePersistedFilters` state-style hook): the two initial consumers have different source-of-truth models (URL vs. React state). A narrow primitive lets each surface wire its own sync policy without the hook making assumptions. If more surfaces emerge and duplication grows, extract a state-style variant then.

**Increment 2 — Auth provider URL strip on workspace switch.**
Modify `setActiveTeam()` in `components/providers/auth-provider.tsx`:
- After `setActiveTeamId(teamId)`, call `router.replace(pathname)` to drop all query params (requires `usePathname()`).
- Rationale: prevents workspace A's URL filter params from applying to workspace B's refetched data. Per the gap-file contract — "switching workspaces is as good as signing out of one team and into another" — the URL is part of what gets reset.
- Non-filter query params on other pages (if any emerge later) would also be stripped. Accepted tradeoff for a uniform policy; flag if a page needs query-param survival across workspace switches.

**Increment 3 — Wire `filter-bar.tsx` (dashboard, URL-based).**
Use the primitive:
```ts
const filterStorage = useFilterStorage<Record<string, string>>("dashboard");
```
Two effects:
1. **Hydrate on key change with empty URL.** When `filterStorage.key` changes (mount, workspace switch, user change), if the URL has no filter params, read storage; if a stored value exists, `router.replace("/dashboard?<params>")`.
2. **Mirror URL → storage.** Whenever `searchParams` changes, write the current filter param subset to storage.

Filter keys tracked: `clients`, `dateFrom`, `dateTo`, `severity`, `urgency` (what `FilterBar` already reads).

**Increment 4 — Wire `past-sessions-table.tsx` (capture, state-based).**
Use the primitive:
```ts
const filterStorage = useFilterStorage<SessionFiltersState>("capture-sessions");
```
Two effects:
1. **Hydrate on key change.** When `filterStorage.key` changes, read storage; call `setFilters(stored ?? defaultFilters)`. This also covers workspace switch — the key changes, state resets to the new workspace's stored value (or defaults).
2. **Mirror state → storage.** Wrap `handleFiltersChange` to call `filterStorage.write(newFilters)` in addition to `setFilters(newFilters)`.

Default filter value stays `{ dateFrom: "", dateTo: "" }` as currently defined.

**End-of-part audit:**
- **SRP.** Hook owns storage I/O only. Auth provider owns URL strip only. Each surface owns its own sync policy.
- **DRY.** Storage-key derivation and SSR/auth guards live once in the hook. Surfaces share the same primitive.
- **Design tokens.** No style changes.
- **Logging.** Hook logs key read/write failures. Auth provider existing logs untouched.
- **Dead code.** No removals.
- **Convention compliance.** `"use client"`, named export, `use-filter-storage.ts` (kebab-case file), `useFilterStorage` (use-prefix function), returns an object.

**Documentation updates after the part:**
- `ARCHITECTURE.md` — add `use-filter-storage.ts` to the hooks file map; add a "Filter persistence contract" note under Key Design Decisions (key format, workspace-switch behavior, per-surface consumption pattern).
- `CHANGELOG.md` — entry under `[Unreleased]`: "Filter persistence — shared `useFilterStorage` hook with user+workspace-keyed sessionStorage. Dashboard and capture past-sessions now restore filters on return; workspace switch clears URL filter params."
- `gap-analysis.md` — mark P5 with ✅ Fixed.

**Verification:** `npx tsc --noEmit` passes; manual smoke — apply filter on dashboard → navigate away → return → filter restored; switch workspace → filter cleared; log out then log in as different user on same tab → clean slate.

### P7 — No feedback loop from manual signal edits
_Fix not yet defined in gap file. TRD pending._

### P8 — Master Signal cold-start corpus is unbounded
_Fix not yet defined in gap file. TRD pending._
