# Gap Analysis — Synthesiser

> Identified 2026-04-22. Grounded in code review of architecture, services, API routes, and components.
> Issues marked ✅ are already fixed.

---

## Engineering Gaps

### E1 — `signOut()` doesn't clear `active_team_id` cookie ✅ Fixed
**File:** `components/providers/auth-provider.tsx`
`signOut()` called `supabase.auth.signOut()` and cleared React state but never called `clearActiveTeamCookie()`. The browser cookie persisted after logout, leaking workspace context to the next session on the same machine.
**Fix applied:** Added `clearActiveTeamCookie()` call inside `signOut()`.

---

### E2 — Fire-and-forget chain is unsafe on Vercel free tier ✅ Fixed
**File:** `app/api/sessions/route.ts` (POST), `app/api/sessions/[id]/route.ts` (PUT)
**Priority: Critical**

The `generateSessionEmbeddings().then(assignSessionThemes).then(maybeRefreshDashboardInsights).catch()` chain is started before `return NextResponse.json()`. On Vercel's serverless runtime, once the response is sent the execution context can be frozen or terminated — background microtasks are not guaranteed to complete. The failure mode is invisible: the session saves correctly but has no embeddings, no themes, and stale dashboard/chat data.

Vercel exposes `waitUntil()` from `@vercel/functions` for exactly this use case.

Additionally, the `catch` block emits a console warning only in `NODE_ENV === 'development'`. In production, total chain failures are silently swallowed.

**Fix applied (2026-04-25).** Wrapped the chain in `after()` from `next/server` (Next.js 16 native — same effect as `@vercel/functions` `waitUntil()` without the extra dependency) and set `export const maxDuration = 60` on both routes, raising the Hobby-tier ceiling from the 10s default. Per-stage timing logs (`chain timing — embeddings/themes/insights`) and an unconditional error log (with sessionId + elapsed ms + stack) now run in every environment, so production failures and slow chains are visible in Vercel function logs. The user-perceived latency is unchanged — the response is still sent right after the DB insert.

**Deferred follow-up.** The 60s ceiling is a floor, not a final answer. When p95 chain duration (visible in the new timing logs) approaches 60s — or any stage's failure rate becomes non-trivial — move the chain off the request lifecycle into a queue worker (Inngest / QStash / Supabase queues) for retries, replay, and unbounded execution time. Tracked in ARCHITECTURE.md Key Design Decision #19 and as a deferred section in `gap-analysis-trd.md` E2.

---

### E3 — No rate limiting on AI endpoints
**Files:** `app/api/ai/extract-signals/route.ts`, `app/api/ai/generate-master-signal/route.ts`
**Priority: High**

Both routes have auth checks but no per-user or per-team rate limits. A client-side retry bug or a user batch-processing many sessions can exhaust AI provider quota with no circuit breaker.

---

### E4 — `queryDatabase` chat tool frozen at 7 actions; service has 17 ✅ Fixed
**Files:** `lib/services/chat-stream-service.ts`, `lib/services/database-query-service.ts`
**Priority: High**

`QUERY_ACTIONS` in `chat-stream-service.ts` is a separate hardcoded constant, not derived from `database-query-service.ts`. The service has grown to 17 actions (themes, competitive mentions, client health, drill-downs, insights); the chat tool still exposes only the original 7. These lists will continue drifting with every new dashboard feature.

The fix is to derive the tool's action enum from the `QueryAction` union type already defined in the service.

**Fix (planned, 2026-04-25; scope expanded same-day) — single source of truth + dashboard-equivalent expressivity in chat + severity made real across surfaces.**

Goal: when this ships, a user asking the chat "what are our top themes for Acme this quarter, only high-confidence high-severity assignments?" gets a real answer (not a hallucination or an unfiltered result). Theme, competitive-mention, client-health, sessions-over-time, and insight-history questions all become answerable. This also resolves P3 ("Chat can't answer theme or competitive questions") — that gap is the user-visible symptom of E4.

Approach:

1. **Single registry in `database-query-service.ts`.** Add `ACTION_METADATA: Record<QueryAction, { llmToolExposed: boolean; description: string }>`. Every existing action (and every future one) gets one entry. From this registry, export a derived `CHAT_TOOL_ACTIONS` tuple and the matching `ChatToolAction` type. New actions added to `QueryAction` will produce a TypeScript error in `ACTION_METADATA` until classified — drift is structurally prevented.

2. **Drop the parallel list in `chat-stream-service.ts`.** Replace the hardcoded `QUERY_ACTIONS` array with the derived `CHAT_TOOL_ACTIONS`. The chat tool's Zod enum is built from this, and the LLM-facing tool description string is generated from the registry's per-action `description` field.

3. **Expand the chat tool's `filters` input schema** from the current 3 fields (`dateFrom`, `dateTo`, `clientName`) to the full chat-relevant subset of `QueryFilters` — adds `clientIds[]`, `severity`, `urgency`, `granularity`, and `confidenceMin`. The service's `executeQuery` already accepts these; this just exposes them to the LLM.

4. **Make `severity` a real filter (scope expansion).** Pre-fix, `severity` was accepted by the API/service signature but never consumed by any handler — both dashboard and chat treated it as a silent no-op. Implement actual severity filtering in every handler where it makes semantic sense, with per-action descriptions in the registry that honestly state which actions honor it. Pattern: severity is per-chunk in `structured_json` (painPoints, requirements, aspirations, blockers, custom.signals), so filtering is a post-filter on session JSON via `sessionHasSignalWithSeverity()`. Theme handlers pre-resolve matching session IDs and add an `IN (...)` clause to the join. Honor matrix:

  | Action | Severity honored? | Mechanism |
  |---|---|---|
  | `count_sessions`, `sessions_per_client` | ✅ | path-switch when `severity` set: fetch+filter |
  | `sentiment_distribution`, `urgency_distribution`, `recent_sessions` | ✅ | inline post-filter on already-fetched `structured_json` |
  | `client_health_grid` | ✅ | adds severity check next to existing urgency check |
  | `top_themes`, `theme_trends`, `theme_client_matrix` | ✅ | pre-resolve session IDs in `fetchSignalThemeRows` and constrain join |
  | `sessions_over_time` | ❌ deferred | RPC-based; needs RPC change. Registry description states this. |
  | `count_clients`, `client_list`, `competitive_mention_frequency`, `insights_*` | ❌ N/A | severity isn't meaningful at these levels |

  Side effect: the dashboard URL `severity=` param starts working too — same handlers, same call path. The dashboard never advertised severity as no-op, so this is a quiet upgrade for dashboard users.

Two actions stay LLM-unexposed (`llmToolExposed: false`):
- `drill_down` — requires a structured `DrillDownContext` payload the LLM can't construct from a user question; only used by dashboard widget click handlers.
- `session_detail` — needs a specific `sessionId`. Critically, **this action remains actively used by the chat citation dialog** (`SessionPreviewDialog` fetches `/api/dashboard?action=session_detail&sessionId=...` when the user clicks "View full session" on a citation chip). The flag only governs LLM tool exposure — UI-driven and direct-API uses are unaffected.

---

### E5 — No dev/prod database separation
**Priority: High**

All environments share one Supabase instance. Schema migrations applied during development run against live data. A mistaken `ALTER TABLE`, test data seed, or RLS policy error during development immediately affects all users.

---

### E6 — Supabase storage not cleaned on session soft-delete
**Files:** `app/api/sessions/[id]/route.ts` (DELETE), `lib/services/attachment-service.ts`
**Priority: Medium-High**

Attachments are hard-deleted from storage when explicitly removed via the UI. But when a parent session is soft-deleted, only the `session_attachments` DB rows are soft-deleted — the files in `SYNTHESISER_FILE_UPLOAD` remain. No cascade, no cleanup job. On Supabase free tier (1GB), orphaned files accumulate silently.

---

### E7 — `MAX_COMBINED_CHARS` is a single static value for every model
**File:** `lib/constants.ts` (value: `MAX_COMBINED_CHARS = 50_000`, enforced in the capture form and `POST /api/ai/extract-signals`)
**Priority: Medium-High**

The combined-input limit is currently a single constant applied uniformly regardless of `AI_PROVIDER`/`AI_MODEL`. This is a correctness and quality problem in both directions:

- **Under-utilising capable models.** Frontier models (Claude Sonnet/Opus, GPT-4o, Gemini 2.0) handle much larger inputs comfortably. Capping at 50K chars forces users with long transcripts to truncate or split unnecessarily when the active model could have handled the full corpus in one extraction.
- **Over-feeding weaker models.** Smaller/cheaper models (Haiku-class, Flash-class, mini-class) degrade well before their advertised context window — not from hitting the limit, but from attention dilution on long inputs. A single 50K limit doesn't protect these models either.

The fix is to make the limit model-aware. Define a per-model "best-performance input budget" (in characters or tokens) and select it at runtime from `AI_MODEL`, with a sensible default when the model is unknown. This should drive the character counter on the capture UI, the Zod `.max()` on the extraction endpoint, and the chunking/context-budget logic in chat (`buildContextMessages`). Source the budgets from measured extraction quality, not advertised context windows — the two diverge sharply for most models.

---

### E8 — `stopWhen: stepCountIs(3)` limits complex chat queries
**File:** `lib/services/chat-stream-service.ts:131`
**Priority: Medium**

3 total LLM steps. A question requiring both `searchInsights` and `queryDatabase` consumes 2 steps before the final generation. Complex multi-hop questions return incomplete answers without indicating why.

---

### E9 — Re-extraction race condition within teams
**File:** `lib/services/embedding-orchestrator.ts`
**Priority: Medium**

The flow is `deleteBySessionId()` then `upsertChunks()` with no advisory lock. Two team members re-extracting the same session concurrently could interleave: both delete old embeddings, both generate new ones, potentially creating duplicate embeddings, duplicate theme assignments, and double-counted signals in dashboard widgets.

---

### E10 — Theme taxonomy grows noisy with no deduplication
**Files:** `lib/services/theme-service.ts`, `lib/repositories/supabase/supabase-theme-repository.ts`
**Priority: Medium**

Theme reuse is determined by case-insensitive name matching (`ilike`). Semantically equivalent themes with different wording ("API Performance", "API Speed", "API Latency") are treated as distinct and accumulate over time. No embedding-based deduplication or merge strategy exists. The `top_themes` and `theme_trends` dashboard widgets fragment signal across near-duplicate rows.

---

### E11 — No observability layer
**Priority: Medium**

No error tracking (Sentry or equivalent), no structured log aggregation, no uptime monitoring, no `/api/health` endpoint. Vercel Function Logs don't persist or alert. Silent failures in the fire-and-forget chain, AI provider outages, and DB timeout errors are only discoverable by actively tailing logs.

---

### E12 — Embedding dimension migration has no documented path
**File:** `lib/repositories/supabase/supabase-embedding-repository.ts`
**Priority: Low-Medium**

`session_embeddings.embedding` is `vector(1536)`. Switching to a different embedding model with different output dimensions would cause all new inserts to fail silently. No migration script exists and the constraint is undocumented.

---

### E13 — No automated test suite
**Priority: Low**

`MockSessionRepository` exists (`lib/repositories/mock/`) but no test runner, no test files, no CI test step. The repository pattern and service layer are cleanly structured for testability but that investment is unrealized.

---

### E14 — Chat message IDs: client uses temp IDs; cancel/error paths leak orphan rows ✅ Fixed
**Files:** `app/api/chat/send/route.ts`, `lib/services/chat-stream-service.ts`, `lib/hooks/use-chat.ts`
**Priority: High**

Three coupled symptoms of the same root cause — server is sole UUID generator and the client/server lifecycles for messages aren't aligned.

1. **Optimistic user messages have temp IDs (`temp-user-${Date.now()}`).** The server inserts the user message with its own UUID; the client never receives that UUID until the next conversation reload. Within the active session, the client cannot reference a specific user message — blocking any future feature that targets a turn (edit, delete, branch, `parent_message_id` threading already in the schema, reaction, citation back-link). Today's retry sidesteps this by re-sending content rather than referencing IDs.

2. **Cancelled streams produce a `temp-cancelled-${Date.now()}` message in the client list with no DB counterpart.** The cancelled bubble shows the partial content the user saw, but the placeholder assistant row in `messages` table stays at `status: "streaming"` with empty content. Different IDs, different states, no reconciliation. Reload the page → the cancelled bubble disappears, the orphan placeholder reappears as a never-completing streaming bubble.

3. **Failed streams (network error, AI provider error) leave the placeholder row at `status: "failed"` with no content saved.** The outer `try/catch` in `chat-stream-service.ts:213-243` updates `status: "failed"` but doesn't preserve the partial `fullText` accumulated before the error. The inline `error` part-type handler (line 150-165) does save partial content, but the outer fatal-error path drops it.

The unifying fix is **identifier ownership symmetry**: client owns the user message UUID end-to-end (no temp), server owns the assistant message UUID and surfaces it via response header so the client has it before/during the stream (not just at completion), and the server's stream finalization paths (success / error / abort) all update the placeholder row consistently with status + partial content. Plumbing `request.signal` into `streamText()` makes user-aborts visible to the server so the placeholder gets flipped to `cancelled` instead of left as `streaming`.

This also delivers idempotent retries on transient network failures: the DB primary-key constraint blocks duplicate user-message inserts, and the server returns 409 instead of creating a duplicate row.

---

### E15 — Conversation ID is server-generated, forcing a brittle null→just-created lifecycle ✅ Fixed
**Files:** `app/api/chat/send/route.ts`, `app/chat/_components/chat-page-content.tsx`, `lib/hooks/use-chat.ts`
**Priority: High**

The new-conversation handshake today: client sends with `conversationId: null` → server creates the conversations row → server returns the new ID via `X-Conversation-Id` response header → client calls `setActiveConversationId(newId)` → re-renders → `useChat` re-runs with the new prop → the load-messages effect fires because `conversationId` changed → it would normally `setMessages([])` and refetch, wiping the just-streamed messages → producing a visible "wipe and reload" flicker.

We patched the flicker symptom in `lib/hooks/use-chat.ts:155-159` with `prevConversationIdRef`, which detects the `null → just-created` transition and skips one fetch. That patch works, but it's defensive plumbing on top of an underlying contract that's structurally fragile. Any future addition to the conversation lifecycle (URL deep-linking to a conversation, parallel "new chat" tabs, conversation pre-warming, server-driven conversation suggestion) re-introduces ambiguity about who owns the ID and when.

The cleaner contract: **client generates the conversation UUID** at the moment a new chat is started, sends it in the POST body, and the server uses it (creating the conversations row only on first POST, idempotently — if a row with that UUID already exists, reuse it). This eliminates the `null → just-created` transition entirely. The conversation has its real ID from the first render. The `X-Conversation-Id` header becomes informational and could be dropped. The `prevConversationIdRef` patch becomes vestigial (and can be removed in this fix or a follow-up).

A subtle UX consideration the fix has to handle: today, `activeConversationId === null` is the UI signal for "fresh chat / show empty state." Switching to client-generated UUIDs needs a different signal for "fresh chat with a UUID assigned but no messages and no DB row yet." The cleanest design: the conversations row is created server-side only on the first `sendMessage` (using the client-provided UUID), and the client-side fresh-chat state is detected by the activeConversationId not being present in the conversations sidebar list (or by a local `freshConversationIds` set). Either is straightforward; details land in the TRD.

---

## Product Gaps

### P1 — Master Signals page (`/m-signals`) is a zombie ✅ UI retired; backend intentionally retained

`/m-signals` folder deleted and the nav link removed. The marketing surface (landing page, README prose) has been cleaned of master-signal references.

**Backend is intentionally retained** as of this audit: `master_signals` table, `master-signal-service.ts` (`generateOrUpdateMasterSignal` with cold-start vs incremental variants and `is_tainted` propagation on session delete), `master-signal-repository.ts` + Supabase adapter, `master-signal-synthesis.ts` prompt, `GET /api/master-signal`, `POST /api/ai/generate-master-signal`, and the two `prompt_versions.prompt_key` values (`master_signal_cold_start`, `master_signal_incremental`) all remain wired. Rationale: dashboards + chat are the replacement UX, but the backend is kept as an optional re-entry point and to preserve historical data. See ARCHITECTURE.md "Key Design Decisions → Master Signal (retained backend, retired UI)." A future cleanup PRD should either bring back a minimal UI or remove the backend end-to-end (including a data migration for `master_signals`); the current in-between state is deliberate but not indefinite.

---

### P2 — Post-login redirect lands on Capture, not Dashboard ✅ Fixed

Added `DEFAULT_AUTH_ROUTE = "/dashboard"` and `ONBOARDING_ROUTE = "/capture"` constants to `lib/constants.ts`. Auth callback now checks session count after login — redirects to `/dashboard` if sessions exist, `/capture` if the account is new. Middleware and landing page also updated to use the constants.

---

### P3 — Chat can't answer theme or competitive questions ✅ Fixed (resolved by E4)
**File:** `lib/services/chat-stream-service.ts`
**Priority: High**

Directly related to E4. The `queryDatabase` tool exposes only 7 actions. Users asking "what are our top themes?" or "which competitors come up most?" get either a hallucinated answer or an admission of ignorance.

**Resolved by E4 (2026-04-25).** The chat tool now exposes 15 actions (including `top_themes`, `theme_trends`, `theme_client_matrix`, `competitive_mention_frequency`, `client_health_grid`, and the dashboard insight history) plus the dashboard's full filter dimensions. Theme and competitive questions are now answerable. See E4 above for the full fix.

---

### P4 — Starter questions are hardcoded and workspace-blind
**File:** `app/chat/_components/starter-questions.tsx`
**Priority: Medium**

4 static strings shown to every user regardless of their data. A returning user with 50 sessions sees the same generic prompts as a brand-new user.

---

### P5 — No shared filter-persistence pattern across surfaces ✅ Fixed
**Files:** `app/dashboard/_components/filter-bar.tsx`, `app/capture/_components/past-sessions-table.tsx`, `lib/hooks/use-filter-storage.ts`, `components/providers/auth-provider.tsx`

Filter state is URL-encoded per surface (good for sharing) but navigating away and returning wipes it. Every filtered surface re-implements its own filter shape and loses state on unmount. Users with consistent analysis habits must re-apply on every navigation.

**Fix applied (2026-04-25) — scoped sessionStorage mirror with user+workspace keying.** Introduce a shared filter-persistence utility that every filtered surface (dashboard, capture past-sessions table, future filtered views) plugs into. The URL remains the source of truth for rendering and sharing; `sessionStorage` is a rehydration layer keyed by `filters:<surface>:<userId>:<workspaceId ?? "personal">`.

Contract:

| Trigger | Action |
|---|---|
| Filter change on a surface | Write params to URL (source of truth) + mirror to `sessionStorage[filters:<surface>:<userId>:<workspace>]` |
| Surface mounts with no URL filter params | If the key has a value, `router.replace()` to the URL with those params |
| Workspace switch | `router.replace(pathname)` to strip URL filter params (sessionStorage untouched — per-workspace keys keep each workspace's filters isolated) |
| Sign out | No filter-specific cleanup needed — the `userId` segment in the key isolates users on shared tabs |
| Tab close | Browser auto-clears `sessionStorage` |

Why the combined `userId + workspaceId` key:
- **`userId`** isolates users on a shared tab — User B reading their own key never sees User A's filters (different userId segment).
- **`workspaceId`** gives per-workspace memory — switching between workspaces restores each workspace's last filter state.
- **`"personal"`** sentinel for `null` workspaceId is safe because `userId` already disambiguates personal-workspace-of-A from personal-workspace-of-B.

Residual caveat: stale keys from logged-out users remain in `sessionStorage` (visible only in devtools) until tab close. Filter values are low-sensitivity; accepted tradeoff for zero cleanup code.

Implementation sketch:
- One shared `useFilterStorage(surface)` hook in `lib/hooks/` that derives the key from `useAuth()` and reads/writes `sessionStorage`, synchronised with `useRouter` / `useSearchParams`.
- `setActiveTeam()` in `components/providers/auth-provider.tsx` adds a `router.replace(pathname)` call to strip stale URL filter params on workspace switch.
- No changes required in `signOut()` — existing `clearActiveTeamCookie()` cleanup is sufficient.

---

### P7 — No feedback loop from manual signal edits
**Files:** `lib/services/session-service.ts`, `app/api/sessions/[id]/route.ts`
**Priority: Low-Medium**

`structured_notes_edited` is tracked and surfaced as a UI warning, but it's never used to improve anything — no prompt refinement trigger, no quality trend on the prompts page.

---

### P8 — Master Signal cold-start corpus is unbounded ⏸ Not currently active
**File:** `lib/services/master-signal-service.ts`
**Priority: Deferred** — depends on Master Signal UI being reinstated (see P1). With the UI retired, cold-start synthesis is not user-triggered, so the unbounded-prompt risk is dormant. Revisit if/when a future PRD brings back the master-signal surface or removes the backend.

`getAllSignalSessions()` fetches every non-deleted session. As the corpus grows, cold-start synthesis sends an increasingly large prompt. A `is_tainted` flag or manual "regenerate all" forces cold-start regardless of corpus size.
