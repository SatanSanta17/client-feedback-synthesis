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

### E2 — Fire-and-forget chain is unsafe on Vercel free tier
**File:** `app/api/sessions/route.ts` (POST), `app/api/sessions/[id]/route.ts` (PUT)
**Priority: Critical**

The `generateSessionEmbeddings().then(assignSessionThemes).then(maybeRefreshInsights).catch()` chain is started before `return NextResponse.json()`. On Vercel's serverless runtime, once the response is sent the execution context can be frozen or terminated — background microtasks are not guaranteed to complete. The failure mode is invisible: the session saves correctly but has no embeddings, no themes, and stale dashboard/chat data.

Vercel exposes `waitUntil()` from `@vercel/functions` for exactly this use case.

Additionally, the `catch` block emits a console warning only in `NODE_ENV === 'development'`. In production, total chain failures are silently swallowed.

---

### E3 — No rate limiting on AI endpoints
**Files:** `app/api/ai/extract-signals/route.ts`, `app/api/ai/generate-master-signal/route.ts`
**Priority: High**

Both routes have auth checks but no per-user or per-team rate limits. A client-side retry bug or a user batch-processing many sessions can exhaust AI provider quota with no circuit breaker.

---

### E4 — `queryDatabase` chat tool frozen at 7 actions; service has 17
**Files:** `lib/services/chat-stream-service.ts`, `lib/services/database-query-service.ts`
**Priority: High**

`QUERY_ACTIONS` in `chat-stream-service.ts` is a separate hardcoded constant, not derived from `database-query-service.ts`. The service has grown to 17 actions (themes, competitive mentions, client health, drill-downs, insights); the chat tool still exposes only the original 7. These lists will continue drifting with every new dashboard feature.

The fix is to derive the tool's action enum from the `QueryAction` union type already defined in the service.

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

### E7 — `MAX_COMBINED_CHARS = 400_000` is model-agnostic
**File:** `lib/constants.ts`
**Priority: Medium-High**

400,000 chars ≈ 100,000 tokens. The limit is applied uniformly regardless of `AI_MODEL`. GPT-4o performs worse beyond ~64K tokens. No per-model context window validation exists at extraction time — large inputs with GPT-4o may produce silently degraded output.

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

## Product Gaps

### P1 — Master Signals page (`/m-signals`) is a zombie ✅ Fixed

`/m-signals` folder deleted. ARCHITECTURE.md and README.md cleaned of references.

---

### P2 — Post-login redirect lands on Capture, not Dashboard ✅ Fixed

Added `DEFAULT_AUTH_ROUTE = "/dashboard"` and `ONBOARDING_ROUTE = "/capture"` constants to `lib/constants.ts`. Auth callback now checks session count after login — redirects to `/dashboard` if sessions exist, `/capture` if the account is new. Middleware and landing page also updated to use the constants.

---

### P3 — Chat can't answer theme or competitive questions
**File:** `lib/services/chat-stream-service.ts`
**Priority: High**

Directly related to E4. The `queryDatabase` tool exposes only 7 actions. Users asking "what are our top themes?" or "which competitors come up most?" get either a hallucinated answer or an admission of ignorance.

---

### P4 — Starter questions are hardcoded and workspace-blind
**File:** `app/chat/_components/starter-questions.tsx`
**Priority: Medium**

4 static strings shown to every user regardless of their data. A returning user with 50 sessions sees the same generic prompts as a brand-new user.

---

### P5 — Dashboard filters reset on every visit
**File:** `app/dashboard/_components/filter-bar.tsx`
**Priority: Medium**

Filter state is URL-encoded (good for sharing) but navigating away and returning wipes the filters. Users with consistent analysis habits must re-apply on every session.

---

### P6 — Chat conversations ignore workspace switches
**Files:** `app/chat/_components/chat-page-content.tsx`, `lib/hooks/use-conversations.ts`
**Priority: Medium**

Conversations are user-private (`created_by` only), not scoped by active workspace. The conversation list is identical regardless of which workspace is active, but the underlying RAG retrieval respects `teamId`. No visual cue distinguishes which workspace a conversation's data was built from.

---

### P7 — No feedback loop from manual signal edits
**Files:** `lib/services/session-service.ts`, `app/api/sessions/[id]/route.ts`
**Priority: Low-Medium**

`structured_notes_edited` is tracked and surfaced as a UI warning, but it's never used to improve anything — no prompt refinement trigger, no quality trend on the prompts page.

---

### P8 — Master Signal cold-start corpus is unbounded
**File:** `lib/services/master-signal-service.ts`
**Priority: Low-Medium**

`getAllSignalSessions()` fetches every non-deleted session. As the corpus grows, cold-start synthesis sends an increasingly large prompt. A `is_tainted` flag or manual "regenerate all" forces cold-start regardless of corpus size.
