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

### E8 — `stopWhen: stepCountIs(3)` limits complex chat queries ✅ Fixed

**Scope.** The chat stream cap is a step budget — `stopWhen: stepCountIs(N)` ends the agent loop after the Nth step, regardless of whether the model wanted another tool call. Two changes that together close the gap:
1. **Raise the cap from 3 to 5.** Typical multi-hop questions need ≤ 4 steps (`searchInsights` + `queryDatabase` + final synthesis = 3; cross-check / re-search adds 1–2 more). 5 is a deliberate ceiling — bounded latency and token cost.
2. **Surface truncation explicitly.** When the cap fires mid-tool-calling, the SDK's `result.finishReason` resolves to `"tool-calls"`. The service detects this after the for-await loop and appends a one-line italic notice to the streamed and persisted message so the user knows the answer may be incomplete. Today the user sees a cut-off answer that reads like a final answer — the silent-truncation UX is the real bug.

Adaptive budgets (re-invoke `streamText` to extend) and loop-detection custom `stopWhen` predicates are out of scope. Neither is justified until telemetry shows the cap matters in practice.

**Approach.**

- **Step-budget value.** 5 covers the long tail of legitimate multi-hop queries without removing the safety ceiling. A misbehaving model that wants to call tools indefinitely is still bounded; the user still pays bounded latency. If telemetry shows >10% of streams hit the cap, bump to 7.
- **Detection signal.** `streamText()` returns a result whose `finishReason` is a Promise. Awaiting it after the for-await loop drains gives us the SDK's terminal verdict: `"stop"` (model finished naturally), `"tool-calls"` (cap fired mid-tool-calling), `"length"` (token cap), `"content-filter"`, `"error"`, etc. `"tool-calls"` is the truncation signal.
- **User-visible notice.** Appending the notice to `fullText` before `parseFollowUps` runs ensures it survives into `cleanContent` (the saved + re-rendered text). The follow-ups marker is matched by an HTML-comment regex anywhere in the text, so the notice's position relative to the marker doesn't matter — `parseFollowUps` strips the marker either way and the notice survives.
- **Real-time delivery.** Emitting the notice as a final `delta` SSE event makes it appear in the live UI; the user doesn't need to refetch the message to see it. The client already renders deltas as-is.
- **Telemetry.** The existing `stream complete — content: …` log line gains two prefix fields (`steps`, `finishReason`) and a trailing `(truncated)` suffix when the cap fires. Cheap; tells us within a week whether 5 is enough.

**Files changed.**

- **Modified:** `lib/services/chat-stream-service.ts`
  - Cap bumped from `stepCountIs(3)` to `stepCountIs(5)`.
  - After the `for await (const part of result.fullStream)` loop, await `result.finishReason` and `result.steps`.
  - When `finishReason === "tool-calls"`: append the italic notice (literal: `"\n\n_Note: this answer may be incomplete — I reached my reasoning step limit before finishing. Try a follow-up to dig deeper._"`) to `fullText`, emit a final `delta` SSE event with that notice.
  - Extend the `stream complete` log line with `steps`, `finishReason`, and a `(truncated)` suffix.

**No DB schema change. No API contract change.** The notice is part of the assistant message body (existing `messages.content` column). The SSE event types (`delta`, `status`, `done`, etc.) are unchanged — the truncation signal rides on a regular `delta` event.

**No client change.** The notice is plain markdown that the existing markdown renderer handles. The client already loops over `delta` events and appends to the visible content.

**Implementation.** Single change set, single file:

1. `stopWhen: stepCountIs(3)` → `stopWhen: stepCountIs(5)`.
2. After the for-await loop:
   ```ts
   const finishReason = await result.finishReason;
   const stepCount = (await result.steps).length;
   const wasTruncated = finishReason === "tool-calls";

   if (wasTruncated) {
     const warning =
       "\n\n_Note: this answer may be incomplete — I reached my reasoning step limit before finishing. Try a follow-up to dig deeper._";
     fullText += warning;
     controller.enqueue(encoder.encode(sseEvent("delta", { text: warning })));
   }
   ```
3. Update the complete log line:
   ```ts
   console.log(
     `${LOG_PREFIX} stream complete — steps: ${stepCount}, finishReason: ${finishReason}, content: ${cleanContent.length} chars, sources: ${uniqueSources.length}, followUps: ${followUps.length}${wasTruncated ? " (truncated)" : ""}`
   );
   ```

**End-of-fix audit.**

- **SRP.** The detection lives next to the rest of the stream-finalization logic in the service; doesn't leak into the route or the client.
- **DRY.** The notice text is a single literal in one place. Should the wording change, edit the literal.
- **Logging.** The `stream complete` log line is the canonical observability surface — extending it (additive new fields, additive `(truncated)` suffix) preserves backward-compat for any log parser keying on the existing fields.
- **Dead code.** None introduced.
- **Convention compliance.** Italic markdown via underscores; no new dependencies; `LOG_PREFIX` re-used.

**Verification.**

- `npx tsc --noEmit` passes.
- Manual smoke (after a multi-hop question that triggers ≥ 5 tool calls):
  1. Ask a question that requires multiple `searchInsights` + `queryDatabase` cycles.
  2. Observe the notice arrive as the last delta in the UI.
  3. Refresh the page; verify the saved message includes the notice.
  4. `grep "stream complete" .vercel-logs` (or equivalent) shows `steps: 5, finishReason: tool-calls, … (truncated)`.
- Manual smoke (normal multi-hop, ≤ 5 steps):
  1. Ask a question that resolves naturally.
  2. No notice in the UI; saved message has no notice.
  3. Log shows `finishReason: stop`, no `(truncated)` suffix.

**Documentation updates after the fix.**
- `gap-analysis.md` — mark E8 ✅ Fixed; add Fix Applied paragraph describing both parts (cap raise + truncation notice + telemetry).
- `gap-analysis-trd.md` — flip "TRD pending" to "✅ Fixed" (this entry).
- No `ARCHITECTURE.md` update — no architectural decision changes; the cap is a tuning parameter, not a contract.
- No `CHANGELOG.md` entry under PRD-023 (this is a gap fix, not a cleanup increment).

**Forward-compat.** If telemetry shows truncation is rare (say <2% of streams), leave at 5. If it's frequent (>10%), bump to 7 and revisit. If it's frequent AND the same questions consistently hit it, that's the signal to invest in adaptive budgets or loop-detection — but only then.

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

### E14 — Chat message IDs: client uses temp IDs; cancel/error paths leak orphan rows ✅ Fixed

**Scope.** Align client and server lifecycles for chat messages. Three changes that together close the gap:
1. **Client-generated UUIDs for user messages** — sent in the POST body, used as the optimistic message ID, persisted as the DB primary key. No more `temp-user-…`.
2. **Server-generated UUID for assistant messages, surfaced via response header** — `X-Assistant-Message-Id` available at fetch-response time so the client has it during streaming, not just at completion. No more `temp-cancelled-…`.
3. **Stream finalization fixes server-side** — propagate `request.signal` into `streamText()`; differentiate abort from error in the outer catch; in both paths update the placeholder row with the accumulated partial content. No more orphan rows stuck at `status: "streaming"`.

The userMessageId is **required** in the POST body (not optional with server fallback) — single-tenant internal beta, brief deploy-window blip is acceptable, code stays clean.

**Approach.**

- **Identifier ownership.** User messages: client owns. Assistant messages: server owns but surfaces via header. Conversation IDs: out of scope here — see E15.
- **Idempotency via DB constraint.** Postgres primary key rejects duplicate `messages.id` inserts. Server catches the unique-violation, returns 409 — signals "request was already accepted, this is a retry," client can safely ignore the duplicate. No application-level dedup logic needed.
- **Abort propagation.** The Vercel AI SDK's `streamText()` accepts an `abortSignal` option. Wiring `request.signal` to it: (a) cancels the upstream AI provider call when the user aborts (saves cost/compute), (b) makes the for-await loop throw an `AbortError` we can catch and handle distinctly from a stream error.
- **Symmetry of completion / error / abort.** All three terminal states update the same placeholder row with the same fields (`content`, `status`, optionally `sources`/`metadata`). Consistent contract simplifies the client's load-messages flow on next refetch.

**Files changed.**

- **Modified:** `app/api/chat/send/route.ts`
  - Zod schema: add `userMessageId: z.string().uuid()` (required).
  - Pass `id: userMessageId` to `chatService.createMessage` for the user message insert.
  - Catch unique-violation on user message insert → return 409 `{ message: "Already received" }`.
  - Add `X-Assistant-Message-Id: assistantMessage.id` to the SSE response headers.
  - Pass `request.signal` through to `createChatStream`.

- **Modified:** `lib/services/chat-stream-service.ts`
  - Accept `abortSignal: AbortSignal` in `ChatStreamDeps`.
  - Pass `abortSignal` to the `streamText({ ... })` call.
  - Restructure the outer `try/catch` so `fullText` is in the catch's scope.
  - In the catch: if `err instanceof DOMException && err.name === "AbortError"` → update placeholder to `status: "cancelled", content: fullText`; else → update placeholder to `status: "failed", content: fullText` (currently doesn't preserve `fullText`).
  - The inline `error` part-type handler stays as-is (already preserves partial content).

- **Modified:** `lib/services/chat-service.ts` and the underlying `MessageRepository`
  - `createMessage()` accepts an optional `id?: string`; when provided, the INSERT uses it explicitly (overrides the column default `gen_random_uuid()`).
  - Surface unique-violation errors as a typed error class (e.g. `MessageDuplicateError`) so the route handler can map it to 409 cleanly.

- **Modified:** `lib/hooks/use-chat.ts`
  - In `sendMessage`: `const userMessageId = crypto.randomUUID();` — use as the optimistic message ID and in the POST body.
  - Read `X-Assistant-Message-Id` from the response headers; store in a local closure variable accessible to both the success path and the cancel path.
  - In `cancelStream`: when constructing the cancelled message, use the header-supplied assistant UUID instead of `temp-cancelled-${Date.now()}`. To make it accessible from the cancel callback, lift the variable into a ref (`assistantMessageIdRef`) populated when headers arrive.
  - The `done` SSE event still emits `assistantMessageId`. Keep reading it as a fallback (paranoid defense), but the header is the authoritative source going forward.

**No DB schema change.** The `messages.id` column already accepts UUIDs and has `gen_random_uuid()` as the default — providing an explicit value just overrides the default.

**No API contract breakage for existing flows beyond the deploy-window blip:** clients refresh, get the new bundle, send `userMessageId` in subsequent requests. Server returns 400 (Zod validation) for any in-flight request from a stale tab. Acceptable for an internal beta.

**Implementation increments.**

**Increment 1 — Server-side orphan cleanup (independently deployable, fixes the data integrity issue first).**
- Add `abortSignal` plumbing through `route.ts` → `createChatStream` → `streamText`.
- Restructure the outer catch in `chat-stream-service.ts` to differentiate abort vs error, save partial `fullText` in both.
- Smoke-verify: cancel a stream mid-flight; check the DB row shows `status: "cancelled"` with the partial content.
- Smoke-verify: force an error (break AI key); check the DB row shows `status: "failed"` with the partial content.

**Increment 2 — Server emits X-Assistant-Message-Id header.**
- Purely additive; client doesn't read it yet.
- One-line change in the response constructor.

**Increment 3 — Server accepts client-supplied userMessageId.**
- Update Zod schema (required).
- Update repository's `createMessage` signature to accept optional `id`.
- Map unique-violation to 409 via typed error.
- Smoke-verify with a curl/Postman call sending `userMessageId`.

**Increment 4 — Client uses crypto.randomUUID() and reads the assistant header.**
- `sendMessage`: generate UUID; use as optimistic ID + POST body.
- Read `X-Assistant-Message-Id`; store in `assistantMessageIdRef`.
- `cancelStream`: use the ref's value for the cancelled message ID.
- Smoke-verify: send a message — DB user-message row's id matches the optimistic message id from React DevTools. Cancel mid-stream — DB row updated to `cancelled`, client list shows the same UUID.

**End-of-part audit.**
- **SRP.** Route validates and delegates; service handles streaming + finalization; client hook handles UI/optimistic state. No new responsibilities crossed.
- **DRY.** Single placeholder-update pattern across success/error/abort. Inline `error` part-type handler unchanged because it's a different scope (mid-stream provider error vs outer-catch network/abort error); confirm they don't double-update the same row (they won't — the inline handler `return`s after writing).
- **Logging.** Add entry/exit logs for the abort and error catch branches with the elapsed stream time and accumulated content length.
- **Dead code.** Remove the `temp-cancelled-${Date.now()}` codepath. The `temp-assistant-${Date.now()}` fallback in `use-chat.ts:404` can stay as a paranoid fallback for now (header missing) or be removed once we trust the header.
- **Convention compliance.** UUID provided to repository as a method argument, not a magic property. Typed error class for the unique-violation case.

**Verification.**
- `npx tsc --noEmit` passes.
- Manual smoke (in order):
  1. Send a fresh message → user bubble shows the real UUID end-to-end (DevTools React tree, server logs, DB row all match).
  2. Cancel mid-stream → cancelled bubble has the assistant UUID from headers; DB row at `status: "cancelled"` with partial content matching the bubble.
  3. Force an error (e.g. throw inside a tool) → streaming bubble flips to error UI; DB row at `status: "failed"` with whatever partial content accumulated.
  4. Replay the same POST twice (manually via curl with the same `userMessageId`) → second response is 409, no duplicate row.
  5. Reload the page after each scenario → message list matches the DB exactly (no ghosts).

**Documentation updates after the fix.**
- `gap-analysis.md` — mark E14 ✅ Fixed.
- `gap-analysis-trd.md` — flip "TRD locked" to "✅ Fixed".
- `ARCHITECTURE.md` — Key Design Decision #14 (chat data isolation) gets one extra sentence noting the identifier ownership contract: client owns user message + conversation UUIDs (after E15); server owns assistant message UUID, surfaced via response header.
- `CHANGELOG.md` — entry under `[Unreleased]`: "Chat: client-generated UUIDs for user messages, server-generated UUIDs for assistant messages surfaced via `X-Assistant-Message-Id` header. Stream cancellation and errors now correctly update the assistant placeholder row with partial content + final status, eliminating orphan `streaming`-status rows."

---

### E15 — Conversation ID is server-generated, forcing a brittle null→just-created lifecycle ✅ Fixed

**Scope.** Move conversation UUID generation to the client. Eliminate the `null → just-created` transition (and the `prevConversationIdRef` defensive patch sitting on top of it). The conversation has its real ID from the first render of any new chat session. Server creates the conversations row idempotently on first POST using the client-provided UUID.

**Depends on E14** for ergonomic reasons (parallel pattern: client owns user IDs and conversation IDs symmetrically) but technically independent — could ship in either order. Recommended order: E14 first (smaller blast radius), E15 second.

**Approach.**

- **Conversation UUID generation point.** When the user clicks "New chat" (or the page mounts with no active conversation), `ChatPageContent` generates a UUID via `crypto.randomUUID()` and sets it as `activeConversationId`. The conversation has its identity from that moment. The DB row is *not* created yet — creation happens server-side on the first `sendMessage` POST.
- **Distinguishing fresh-local from persisted.** Today, `activeConversationId === null` is the UI signal for "fresh chat / no DB row yet / show starter questions." After the change, every `activeConversationId` is a real UUID, so we need another signal. Two options:
  - **Option A — list-membership check.** A conversation is "persisted" iff its UUID appears in `conversationsHook.conversations` or `conversationsHook.archivedConversations`. The load-messages effect uses this to decide whether to fetch.
  - **Option B — local set of fresh IDs.** `ChatPageContent` keeps a `freshConversationIds: Set<string>` populated when "New chat" is clicked, drained when the first POST succeeds (after which the conversation IS persisted). The hook reads this set.
  - **Recommendation: Option A.** Reuses existing state, no new ref/state to manage, naturally self-healing (once the sidebar refetches, the conversation appears in the list).

- **Server-side idempotency.** The POST handler always checks "does conversation with this UUID exist?" If yes, use it. If no, INSERT with the client-supplied UUID. Catch unique-violation → 409 with the existing row reused (same idempotency contract as user messages in E14).

- **Header cleanup.** `X-Conversation-Id` header becomes informational. Could be dropped, but harmless to leave for backward-compatibility / debugging. Recommendation: leave it; remove only if it bothers code review later.

- **`prevConversationIdRef` cleanup.** With the `null → just-created` transition gone, the ref is vestigial. Remove it as part of this fix to keep the hook small. (If we leave it, it harms nothing but adds a comment-explained chunk of unused logic.)

**Files changed.**

- **Modified:** `app/api/chat/send/route.ts`
  - Zod schema: change `conversationId: z.string().uuid().nullable()` → `conversationId: z.string().uuid()` (required).
  - Conversation-resolve logic: query for the conversation by ID. If found, use it. If not found, INSERT with the supplied ID + placeholder title. Catch unique-violation → race-safe re-fetch.
  - Header `X-Conversation-Id` stays (informational only).

- **Modified:** `lib/services/chat-service.ts` and `ConversationRepository`
  - `createConversation()` accepts an optional `id?: string` argument; when provided, the INSERT uses it explicitly.
  - Add a typed error for conversation unique-violation (parallel to `MessageDuplicateError` from E14).

- **Modified:** `app/chat/_components/chat-page-content.tsx`
  - On mount: `useState<string>(() => crypto.randomUUID())` for `activeConversationId` (instead of `null`).
  - `handleNewChat`: `setActiveConversationId(crypto.randomUUID())` (instead of `null`).
  - `handleSelectConversation`: unchanged — sets to the chosen conversation's UUID.
  - The `handleConversationCreated` callback is no longer needed for ID purposes (the client already knows the ID); only used to prepend to sidebar. Rename to `handleFirstMessageSent` or similar, or fold the prepend into the send flow.

- **Modified:** `lib/hooks/use-chat.ts`
  - `conversationId: string` (no longer nullable).
  - `sendMessage`: send `conversationId` directly in body (not via ref unless still needed for stale-closure protection).
  - Drop `onConversationCreated` callback and the supporting `onConversationCreatedRef`.
  - Drop `prevConversationIdRef` and the load-messages effect's null-transition guard.
  - The load-messages effect changes its predicate: instead of "conversationId became non-null," the effect needs to know "is this conversation persisted (worth fetching) or fresh-local (skip fetch)." Consume the conversations list (or a `isFresh: boolean` prop from the parent) to decide.

- **Modified:** `lib/types/chat.ts` (likely)
  - `Message.conversationId` already typed as string. No change.

**No DB schema change.** The `conversations.id` column already accepts UUIDs and has `gen_random_uuid()` as the default.

**Implementation increments.**

**Increment 1 — Server accepts client-supplied conversationId.**
- Update Zod schema (required UUID).
- Update repository's `createConversation` signature to accept optional `id`.
- Idempotent insert with unique-violation → re-fetch fallback.
- Smoke-verify with curl: POST with a fresh UUID — conversation created. POST again with the same UUID — same conversation reused, no duplicate.

**Increment 2 — Client generates conversation UUID on mount and on "New chat".**
- `ChatPageContent`: initialize `activeConversationId` lazily with a UUID; same in `handleNewChat`.
- Pass it down to `useChat` (now strictly `string`).
- Send in POST body.
- Internally still works because the server is idempotent.
- Smoke-verify: type a message into a fresh chat → user bubble appears with conversation UUID shown in DevTools React tree. POST body in network panel includes the conversationId.

**Increment 3 — Drop the null-transition flicker patch and onConversationCreated callback.**
- Remove `prevConversationIdRef` and its guard in the load-messages effect.
- Remove `onConversationCreated` and `onConversationCreatedRef`.
- Replace the parent's "prepend to sidebar on conversation created" logic with "prepend to sidebar on first message sent" using the locally-known conversationId.
- Update the load-messages effect's predicate: only fetch when the conversationId appears in the conversations sidebar list (or via an `isFresh` flag from the parent).
- Smoke-verify: send first message in a fresh chat → no flicker, no wipe-and-reload, no extra fetch in the network panel.

**Increment 4 — End-of-part audit + manual smokes.**
- Send first message in fresh chat → no flicker, real UUID, sidebar entry appears.
- Click between conversations → messages load correctly for each.
- Hard reload the page on a conversation → loads correctly.
- Click "New chat" twice without sending → no DB rows created, both fresh chats have distinct UUIDs.
- Send a message in chat A, switch to B mid-stream, switch back → stream state handling unchanged (out of scope; just verify no regression).

**End-of-part audit.**
- **SRP.** Conversation ID generation is a one-liner in the parent. Server is the idempotent persistence layer. Hook is purely UI state.
- **DRY.** Same pattern as E14: client-generated UUID + server idempotency on unique-violation. The two fixes share the same shape; consider whether the server-side helper should be extracted to a shared `createOrGetById` utility.
- **Dead code.** `prevConversationIdRef`, `onConversationCreated*` machinery removed.
- **Convention compliance.** Lazy `useState` initializer for the UUID; UUID props strictly typed as `string`.

**Verification.**
- `npx tsc --noEmit` passes.
- Smoke matrix above all green.
- Hot path: in-flight conversation while user clicks "New chat" — old chat's stream completes correctly; new chat starts cleanly with its own UUID. (Streaming bubble doesn't "follow" the user across conversations.)

**Documentation updates after the fix.**
- `gap-analysis.md` — mark E15 ✅ Fixed.
- `gap-analysis-trd.md` — flip "TRD locked" to "✅ Fixed".
- `ARCHITECTURE.md` — Key Design Decision #14 sentence (added in E14) becomes "client owns conversation + user message UUIDs; server owns assistant message UUID, surfaced via response header. Server is idempotent on duplicate inserts; conflict returns 409 (messages) or reuses the existing row (conversations)."
- `CHANGELOG.md` — entry under `[Unreleased]`: "Chat: conversation UUIDs are now client-generated. Eliminates the null→just-created transition and the defensive `prevConversationIdRef` patch in `useChat`. New chats have their real ID from the first render."

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

### P9 — Conversation routing: clean URL on fresh chat, history-API navigation, UUID on first send ✅ Fixed

**Scope.** Three coordinated changes to the chat client routing layer:

1. UUID generation moves from "on mount" (today) to "on first send" — `activeConversationId: string | null`, null is a real state.
2. All in-app URL updates use `window.history` API (`pushState` / `replaceState`) rather than Next.js `router.push` / `router.replace` / `<Link>`. Sidebar items become `<button>`s with onClick handlers. The chat shell stays mounted across every in-app navigation.
3. Initial load / refresh / deep-link routes (`app/chat/page.tsx`, `app/chat/[id]/page.tsx`) seed `<ChatPageContent />` with `initialConversationId`. They run once at navigation arrival; from then on, `history` API does everything.

Browser back/forward via `popstate`. 404 UI for inaccessible UUIDs retained with a "start a new chat" nudge.

**Approach.**

- **Why `window.history`, not Next.js router.** `<Link>` and `router.push/replace` traverse Next.js's page boundary. Even when both routes (`/chat` and `/chat/[id]`) render the same client component, they're different page files — switching between them remounts the React tree. `window.history.pushState`/`replaceState` updates the URL without telling Next.js or React anything happened. The chat shell is one persistent client component for the entire session; only `activeConversationId` state changes.
- **Why generate UUID on first send.** Matches the user's mental model and the URL state. `activeConversationId === null` ↔ URL is `/chat` ↔ "no DB row yet." Eliminates the phantom-UUID-in-fresh-chat from E15.
- **Why two route files for initial load.** They're cheap, allow Next.js to validate the URL (UUID shape) and handle SEO/metadata if ever needed, and make the routing intent obvious. Both delegate to the same client component.
- **Why URL update on headers, not on stream completion.** Mid-stream reload preserves the conversation. Response headers arrive synchronously with the first body chunk; the client reads them before processing the SSE stream. So we get the `X-Conversation-Id` early. Same for sidebar prepend — the conversation is "real" the moment the server has created the row.
- **Why a `clearMessages` action on `useChat`.** The popstate handler needs both `setActiveConversationId(newId)` and `setMessages([])` to land in the same React render commit, otherwise the new conversation's header would briefly show the old conversation's messages. `flushSync` is the alternative; `clearMessages` is more discoverable and lets the parent batch multiple state updates atomically by calling them in the same handler.

**Starting state (current code on disk, audited 2026-04-26).** Important context for the increments below — the prior P9 v1 work has already been reverted by the user. The starting point is "E15 Increment 3 done":

- `app/chat/page.tsx` — renders `<ChatPageContent />` with no prop.
- `app/chat/[id]/` — directory exists, **`page.tsx` was deleted**. Hitting `/chat/<uuid>` currently returns the Next.js 404 page.
- `ChatPageContent` — `activeConversationId: string` initialised eagerly via `useState(() => crypto.randomUUID())` at every mount. `isFresh` derived from sidebar list-membership. `handleSendMessage` does the sidebar prepend before delegating to `useChat.sendMessage`. No router/Link/history imports anywhere.
- `useChat` — `conversationId: string` (non-nullable), `isFresh: boolean` prop, `isFreshRef` mirrors it. Load-messages effect reads `isFreshRef.current` and is keyed only on `[conversationId]` (so the lazy-load race from the screenshot bug is still live). E14's `assistantMessageIdRef` and X-headers wiring intact.
- `ConversationItem` — original `<div role="button" onClick={onSelect}>`. No `<Link>`.
- `ConversationSidebar` — original `onSelectConversation` prop chain intact.
- `ChatArea` — no 404 UI panel (was reverted along with the rest of P9 v1).
- `MessageThread` — `if (items.length === 0) return null;` (the flex-1 placeholder that prevents layout collapse was reverted).
- Server side (`app/api/chat/send/route.ts`) — E14 + E15 intact: required `conversationId` and `userMessageId` in body, `getOrCreateConversation`, `X-Conversation-Id` and `X-Assistant-Message-Id` response headers.

**Files changed (target state).**

- **Modified:** `app/chat/page.tsx` — renders `<ChatPageContent initialConversationId={null} />`.
- **Created:** `app/chat/[id]/page.tsx` (recreate; the file is missing) — server component, validates UUID shape with regex, calls `notFound()` for malformed URLs, renders `<ChatPageContent initialConversationId={id} />`.
- **Modified:** `app/chat/_components/chat-page-content.tsx`
  - Accept `initialConversationId?: string` prop.
  - `activeConversationId: string | null` (was `string`). Lazy initializer becomes `useState<string | null>(initialConversationId ?? null)`. No `crypto.randomUUID()` call here.
  - Drop `isFresh` derivation entirely — replaced by direct null vs. non-null checks against `activeConversationId`.
  - Drop the sidebar-prepend logic from `handleSendMessage`. Replace with an `onConversationCreated(id)` callback handler that runs when `useChat` notifies us — does sidebar prepend AND silent URL update.
  - Three navigation primitives using `window.history` API (NOT `router.push`/`<Link>`):
    - `navigateToConversation(id)` — `history.pushState(null, '', `/chat/${id}`)` + `chatHook.clearMessages()` + `setActiveConversationId(id)`.
    - `navigateToFreshChat()` — `history.pushState(null, '', '/chat')` + `chatHook.clearMessages()` + `setActiveConversationId(null)`.
    - `silentlyAssignConversationId(id)` — `history.pushState(null, '', `/chat/${id}`)` + `setActiveConversationId(id)`. (Originally specified `replaceState`; corrected to `pushState` so back from `/chat/<id>` lands on `/chat` rather than skipping it. The history chain becomes the natural `..., /chat, /chat/<id>`.)
  - `handleSelectConversation` → `navigateToConversation(conversation.id)`.
  - `handleNewChat` → `navigateToFreshChat()`.
  - `handleConversationCreated(id)` → `silentlyAssignConversationId(id)` + `prependConversation({...})`.
  - Add a `popstate` listener (`useEffect`) that parses `window.location.pathname`, calls `chatHook.clearMessages()` and `setActiveConversationId(...)` in the same handler so React batches both into one render commit.
- **Modified:** `app/chat/_components/conversation-sidebar.tsx` — no public-API changes. Internal: nothing changes; the existing `onSelectConversation` prop still flows.
- **Modified:** `app/chat/_components/conversation-item.tsx` — no changes. The original `<div role="button" onClick={onSelect}>` markup stays exactly as it is. Confirmed in audit.
- **Modified:** `app/chat/_components/chat-area.tsx`
  - Re-add the 404 UI panel (was reverted). New copy nudges toward a new chat: "This chat doesn't exist or you don't have access to it." + button "Start a new chat" wired to a callback prop.
  - Add `isConversationNotFound: boolean` prop. Branch the main content area: `isConversationNotFound` → 404 panel; otherwise existing empty-state vs. message-thread branching. Hide `ChatInput` in the not-found state.
  - Add `onStartNewChat: () => void` prop for the CTA. Parent maps to `navigateToFreshChat`.
- **Modified:** `app/chat/_components/message-thread.tsx`
  - Replace `if (items.length === 0) return null;` with `<div className={cn("flex-1", className)} aria-hidden="true" />` — keeps the chat panel's flex layout from collapsing when messages are empty (avoids the screenshot symptom of input-at-top with empty space below).
- **Modified:** `lib/hooks/use-chat.ts`
  - `UseChatOptions.conversationId: string | null` (was `string`). Drop `isFresh`. Re-add `onConversationCreated?: (id: string) => void`.
  - Drop `isFreshRef` and its sync `useEffect` — no longer needed, the null vs. non-null check on `conversationId` does the job directly.
  - Add `messagesRef` (mirrors `messages` so the load-messages effect can detect "messages already populated by streaming" without putting `messages` in deps).
  - Add `prevConversationIdRef` (tracks previous-render conversationId, lets the effect tell `null → just-created` from `existing-A → existing-B`).
  - `sendMessage`: when `conversationIdRef.current === null`, generate `crypto.randomUUID()` synchronously, use it for the POST body's `conversationId` and `userMessageId` correlation. After response headers arrive (`X-Conversation-Id`, `X-Assistant-Message-Id`), call `onConversationCreated(generatedId)` exactly once if this was a fresh send.
  - Expose `clearMessages: () => void` in `UseChatReturn`. Implementation: `setMessages([]); setHasMoreMessages(false); setIsConversationNotFound(false);`. Used by the parent's navigation primitives and `popstate` handler so messages and `activeConversationId` updates batch into one render commit.
  - Add `isConversationNotFound: boolean` to `UseChatReturn`. Set true when load-messages fetch returns 404; reset to false on every load attempt. Surfaces the 404 state to `ChatArea`.
  - Load-messages effect — re-derive on `[conversationId]`, with the prev/curr guard:
    - `conversationId === null` → clear messages + reset 404 flag, return.
    - `prevConversationIdRef.current === null && conversationId !== null && messagesRef.current.length > 0` → just-created via send (messages already populated), skip the fetch.
    - All other transitions (`A → B`, `null → existing-from-URL` with no messages) → fetch.
    - 404 response → `setIsConversationNotFound(true)` and bail without throwing.

**No server-side changes.** Server still creates the conversation idempotently on first POST using the client-supplied UUID (E15 contract intact). `X-Conversation-Id` and `X-Assistant-Message-Id` headers continue to do their job.

**Relationship to E15 — explicit superseding note.** P9 supersedes E15's *client mechanism* but preserves E15's *server contract*:
- ✅ Kept from E15: client-owned conversation UUIDs end-to-end; server-side `getOrCreateConversation` idempotency (try-insert → fall-back-to-fetch on unique-violation, code 23505); `ConversationNotAccessibleError` → 404 for cross-user UUIDs; `MessageDuplicateError` → 409.
- ❌ Superseded by P9: lazy `useState(() => crypto.randomUUID())` at component mount → UUID now generated inside `useChat.sendMessage` on first send; `isFresh` prop on `useChat` → `activeConversationId: string | null` replaces it (null *is* fresh); `handleSendMessage` wrapper's pre-POST sidebar prepend → moves into the `onConversationCreated` callback fired after `X-Conversation-Id` arrives.

Once P9 ships, the E15 entry in this doc remains marked ✅ Fixed (its server-side contract is what's protected), but the *client* portions of the E15 implementation are replaced. CHANGELOG entry for P9 will call out the supersedence; ARCHITECTURE.md KDD #14 sentence on conversation routing is rewritten to reflect the new mechanism.

**Sidebar item element choice.** ConversationItem reverts to the original `<div role="button" tabIndex={0} onClick={onSelect} onKeyDown={...}>` pattern — NOT a `<Link>` (P9 v1 mistake) and NOT a shadcn `<Button>` or native `<button>`. Reasons: (1) the row contains a `<DropdownMenuTrigger>` which renders a real `<button>` — wrapping that in another `<button>` is invalid HTML and breaks click handling; (2) WAI-ARIA "button role on non-button element" is the sanctioned pattern when nesting prevents using a real button, and the existing markup already has all the a11y prerequisites (role, tabIndex, keyboard activation); (3) styling stays clean because no default button paddings/borders need to be overridden. The header action buttons (New chat / Search / Archive toggle) remain shadcn `<Button>` — they're standalone with no nesting concerns.

**Implementation increments.**

Each increment leaves the app in a working state. After each, typecheck must pass and the listed smoke checks confirm forward progress without breaking previously-working flows. Four increments total — chunked so the architectural change lands cleanly in one step rather than being staggered through artificial sub-steps.

**Increment 1 — Conversation routing model: `[id]` route + `string | null` state + UUID on first send.**

The architectural change. After this increment, the conversation lifecycle matches the new model: `null` means fresh, the URL drives initial state, the UUID materializes when the conversation does (on first send). No URL updates on send yet — that's Increment 2.

- **Create:** `app/chat/[id]/page.tsx`
  - Server component. `params: Promise<{ id: string }>`.
  - Validates UUID shape via regex (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`); calls `notFound()` on malformed input.
  - Renders `<ChatPageContent initialConversationId={id} />`.
  - Re-uses the existing `metadata` constant from `app/chat/page.tsx` (or duplicates inline — minor copy).
- **Modify:** `app/chat/page.tsx`
  - Renders `<ChatPageContent />` (or `<ChatPageContent initialConversationId={null} />` if we want it explicit). Either works because the prop is optional and defaults to `null`.
- **Modify:** `app/chat/_components/chat-page-content.tsx`
  - Accept `initialConversationId?: string` prop.
  - `activeConversationId: string | null` (was `string`). Lazy initializer: `useState<string | null>(initialConversationId ?? null)`. No `crypto.randomUUID()` call here.
  - Drop the `isFresh = useMemo(...)` derivation — list-membership check is gone; null vs. non-null carries the same signal directly.
  - Drop the `isFresh` prop on `useChat`.
  - Drop the sidebar-prepend logic from `handleSendMessage`. It simplifies to a thin pass-through (`return chatHook.sendMessage(content)`), kept as a wrapper file-structure for Increment 3 additions.
  - Add `handleConversationCreated(id: string)` — prepends the new entry to the sidebar via `prependConversation({...})`. URL update lives in Increment 2; for now this is just sidebar + nothing else.
  - Pass `onConversationCreated={handleConversationCreated}` to `useChat`.
  - `handleNewChat()` → `setActiveConversationId(null)` (was: regenerate UUID). Mobile sidebar close stays.
  - The `activeConversation` `useMemo` already handles `null` gracefully (returns null) — no change.
- **Modify:** `lib/hooks/use-chat.ts`
  - `UseChatOptions.conversationId: string | null` (was `string`). Drop `isFresh`. Re-add `onConversationCreated?: (id: string) => void`.
  - `conversationIdRef` typed as `string | null`.
  - Drop `isFreshRef` and its sync `useEffect`.
  - Add `messagesRef` (mirrors `messages` so the load-messages effect can read `length` without depending on `messages`).
  - Add `prevConversationIdRef` (tracks previous-render conversationId for the `null → just-created` discriminator).
  - Update `sendMessage`: if `conversationIdRef.current === null`, generate `const newId = crypto.randomUUID()` and use it for the POST body's `conversationId` (the existing E14 `userMessageId` generation is unchanged — still its own UUID). After response headers arrive (`X-Conversation-Id`, `X-Assistant-Message-Id`), if `newId` was generated, call `onConversationCreated(newId)` exactly once.
  - Load-messages effect — re-derive on `[conversationId]` only:
    - If `conversationId === null` → `setMessages([]); setHasMoreMessages(false);` and return early (no fetch).
    - Else, capture `prev = prevConversationIdRef.current` and update the ref. If `prev === null && conversationId !== null && messagesRef.current.length > 0` → null→just-created via send (messages already populated), skip the fetch.
    - Else → fetch (and `setMessages([])` at the top of the fetch path to clear the previous conversation's messages).

**Smoke-verify after Increment 1:**
- Land on `/chat` → React DevTools shows `activeConversationId === null`, empty starter-questions panel.
- Hit `/chat/<existing-uuid>` (one from your sidebar) directly — conversation loads, messages render, input at the bottom.
- Hit `/chat/<random-well-formed-uuid>` — currently shows an empty panel (the messages fetch returns 404 and the catch logs; no dedicated 404 UI yet — that's Increment 3). Acceptable for now.
- Hit `/chat/foo` (malformed) — Next.js's 404 page from the route's `notFound()`.
- `/chat`, click "New chat" — UUID stays null, panel still empty.
- Send first message in fresh chat → server creates conversation, sidebar prepends, `activeConversationId` updates to the server-confirmed UUID. URL stays `/chat` for now (Increment 2 fixes that).
- Click a sidebar conversation → messages load (state-based; URL doesn't change yet — Increment 2).
- Cancel mid-stream — E14 behavior intact: DB row → `cancelled` with partial content.

After Increment 1: requirement #1 (`/chat` clean URL on fresh chat) and refresh-preserves-conversation are both true. Requirements #2 (silent URL update on send) and #3 (no remount on in-app nav) come in Increment 2.

---

**Increment 2 — `window.history` API navigation + `clearMessages` + `popstate`.**

This is what makes the chat shell stay mounted across all in-app navigation. URL updates happen via the browser's native history API, completely bypassing Next.js routing.

- **Modify:** `lib/hooks/use-chat.ts`
  - Add `clearMessages: () => void` to `UseChatReturn`. Implementation: `setMessages([]); setHasMoreMessages(false);` (Increment 3 will also reset `isConversationNotFound` here once that state exists — for now just messages and the more flag).
- **Modify:** `app/chat/_components/chat-page-content.tsx`
  - Three navigation primitives:
    - `navigateToConversation(id: string)` — `window.history.pushState(null, '', `/chat/${id}`)` + `chatHook.clearMessages()` + `setActiveConversationId(id)`.
    - `navigateToFreshChat()` — `window.history.pushState(null, '', '/chat')` + `chatHook.clearMessages()` + `setActiveConversationId(null)`.
    - `silentlyAssignConversationId(id: string)` — `window.history.pushState(null, '', `/chat/${id}`)` + `setActiveConversationId(id)`. **No** `clearMessages` (messages are already populated by streaming; clearing would clobber them). Uses `pushState` (not `replaceState`) so the natural history chain is preserved: `..., /chat (the entry), /chat/<id> (after first send)`. Back from `/chat/<id>` lands on `/chat` (empty fresh chat) before exiting the chat surface.
  - Wire `handleSelectConversation(conversation)` → `navigateToConversation(conversation.id)`.
  - Wire `handleNewChat()` → `navigateToFreshChat()`.
  - Wire `handleConversationCreated(id)` → `silentlyAssignConversationId(id)` then `prependConversation({...})`. Order: state+URL first, sidebar prepend after.
  - Add a `popstate` `useEffect`:
    - Mounts once (no deps), registers a `popstate` handler.
    - Handler reads `window.location.pathname`, parses the conversation id with the same regex used in the `[id]` route file. Falls back to `null` if pathname is `/chat` or doesn't match.
    - In the same handler, calls `chatHook.clearMessages()` AND `setActiveConversationId(parsedId)`. Both are React state updates so they batch into one render commit — no flash of stale messages.
    - Also closes the mobile sidebar (`setIsMobileSidebarOpen(false)`).
    - Returns the cleanup that removes the listener.

**Smoke-verify after Increment 2:**
- Click sidebar conversation A → URL becomes `/chat/<A>` via pushState; messages load; no remount (use React DevTools to confirm `ChatPageContent` instance keeps its key/identity).
- Click another conversation B → URL `/chat/<B>`; messages swap; no shell remount.
- Click "New chat" → URL becomes `/chat`; empty panel.
- Send first message in fresh chat → URL silently updates to `/chat/<new-uuid>` (pushState — back returns to `/chat` empty before exiting); sidebar prepends; response streams in.
- Browser back / forward — navigates between conversations and the empty `/chat` correctly; no flash of stale messages.
- Mid-stream reload at `/chat/<uuid>` → conversation persists (URL was updated on headers, before stream completion).

---

**Increment 3 — 404 UI for inaccessible / non-existent conversations.**

- **Modify:** `lib/hooks/use-chat.ts`
  - Add `isConversationNotFound: boolean` state. Expose in `UseChatReturn`.
  - Load-messages effect: detect `res.status === 404` specifically (before the generic `!res.ok` throw); set the flag and return early. Reset to `false` at the start of every load attempt and on the `conversationId === null` early-return.
  - `clearMessages` also resets the flag.
- **Modify:** `app/chat/_components/chat-area.tsx`
  - Add `isConversationNotFound: boolean`, `activeConversationId: string | null`, and `onStartNewChat: () => void` props. Empty-state branch is gated on `activeConversationId === null` (raw id from parent), NOT `activeConversation === null` (looked-up object). The lookup briefly returns null during the conversations-list fetch window after a fresh mount (e.g. forward-navigation into `/chat/<id>` from a different page); using the raw id avoids flashing the "Start a new conversation" starter panel while messages and conversations lists are still loading. (Gap P9)
  - Add icon import: `FileQuestion` from `lucide-react`.
  - Branch the main content area: when `isConversationNotFound`, render a centered panel with the message "This chat doesn't exist or you don't have access to it." and a `<button onClick={onStartNewChat}>Start a new chat</button>`. (Plain `<button>` styled with shadcn `<Button variant="outline" size="sm">`, since this is a standalone CTA with no nesting concerns — no Link.) Hide `ChatInput` in this state.
- **Modify:** `app/chat/_components/chat-page-content.tsx`
  - Pass `isConversationNotFound={chatHook.isConversationNotFound}` and `onStartNewChat={navigateToFreshChat}` to `<ChatArea>`.

**Smoke-verify after Increment 3:**
- Open `/chat/<random-well-formed-uuid>` (no DB row) → 404 panel renders, no input bar. Click "Start a new chat" → URL `/chat`, empty panel.
- Open `/chat/<another-user's-uuid>` (RLS hides) → same 404 panel.
- Click sidebar conversation from the 404 state → conversation loads, 404 panel disappears.

---

**Increment 4 — End-of-part audit + manual smoke matrix.**

- Typecheck (`npx tsc --noEmit`).
- Dead-code grep:
  - `grep -rn "<Link\|next/link" app/chat/_components` — no Link imports anywhere in the chat shell.
  - `grep -rn "useRouter\|usePathname\|router\.push\|router\.replace" app/chat` — none.
  - `grep -rn "isFresh" lib/hooks/use-chat.ts app/chat` — none.
- Smoke matrix:
  1. `/chat` → URL clean, `activeConversationId === null` (DevTools), starter-questions panel.
  2. Send first message in fresh chat → URL silently `/chat/<uuid>` mid-stream, sidebar prepends.
  3. Click sidebar A → click sidebar B → URL pushState each time, messages swap, no shell remount.
  4. Browser back → previous conversation (or `/chat`), no flash of wrong messages.
  5. Browser forward → goes back to where we just left.
  6. Reload `/chat/<uuid>` → conversation loads correctly.
  7. Reload `/chat` → fresh chat.
  8. Open `/chat/<random-well-formed-uuid>` → 404 panel; CTA → `/chat`.
  9. Open `/chat/<not-a-uuid>` → Next.js's 404 page.
  10. Mid-stream reload — conversation persists.
  11. "New chat" while in `/chat/<id>` → URL `/chat`, mobile sidebar closes.
  12. Cancel mid-stream (E14 regression) — DB row → `cancelled` with partial content; client bubble has the real assistant UUID.

**End-of-part audit.**
- **SRP.** Routes own initial-load URL parsing only. `ChatPageContent` owns the in-page state machine + history API. `useChat` owns messages + streaming, exposes `clearMessages` for atomic resets. Sidebar items are presentational.
- **DRY.** `navigateToConversation` / `navigateToFreshChat` / `silentlyAssignConversationId` are three small helpers in the parent — single source of truth for URL changes. The 404 CTA reuses `navigateToFreshChat`.
- **Dead code.** `<Link>` import in `conversation-item.tsx` removed. `useRouter`/`usePathname` removed from `chat-page-content.tsx`. `isFresh` derivation removed.
- **Convention compliance.** `<Link>` is reserved for cross-route navigation outside the chat shell (it stays in 404 CTA actually — or we use an onClick. Either is fine; onClick is consistent with the shell pattern). `useRouter` not used inside the chat shell.
- **Lazy `useState` initializer.** Reads the URL-supplied prop; no UUID generated until first send.

**Verification.**
- `npx tsc --noEmit` passes.
- All 10 smoke-matrix items behave per spec.
- Regression check: E14 cancel/error paths still update placeholder rows correctly. E15 idempotent server creation still works. E14 `X-Assistant-Message-Id` still attached to cancelled bubbles.

**Documentation updates after the fix.**
- `gap-analysis.md` — mark P9 ✅ Fixed.
- `gap-analysis-trd.md` — flip "TRD locked" to "✅ Fixed".
- `ARCHITECTURE.md` — Key Design Decision #14 ("Chat data isolation"): the conversation-routing paragraph (added in earlier P9 work) is rewritten to describe the `history`-API approach: "Conversation routing is `window.history`-driven inside the chat shell — sidebar clicks, new-chat, and first-send URL replace all update the URL without traversing Next.js's page boundary, so the shell stays mounted across all in-app navigation. `app/chat/page.tsx` and `app/chat/[id]/page.tsx` exist only to seed initial state on first arrival, refresh, deep-link, or share."
- `CHANGELOG.md` — entry under `[Unreleased]`: "Chat: routing rewritten to ChatGPT-style. Conversation UUIDs generated on first send (clean URL `/chat` for fresh chats); URL updates via `window.history` API mid-stream so the chat shell never remounts; sidebar items are buttons with onClick (not Links); `popstate` listener handles browser back/forward. Reload preserves the active conversation; mid-stream reload also preserves. Resolves P9."
