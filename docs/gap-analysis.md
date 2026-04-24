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

The `generateSessionEmbeddings().then(assignSessionThemes).then(maybeRefreshDashboardInsights).catch()` chain is started before `return NextResponse.json()`. On Vercel's serverless runtime, once the response is sent the execution context can be frozen or terminated — background microtasks are not guaranteed to complete. The failure mode is invisible: the session saves correctly but has no embeddings, no themes, and stale dashboard/chat data.

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

## Product Gaps

### P1 — Master Signals page (`/m-signals`) is a zombie ✅ UI retired; backend intentionally retained

`/m-signals` folder deleted and the nav link removed. The marketing surface (landing page, README prose) has been cleaned of master-signal references.

**Backend is intentionally retained** as of this audit: `master_signals` table, `master-signal-service.ts` (`generateOrUpdateMasterSignal` with cold-start vs incremental variants and `is_tainted` propagation on session delete), `master-signal-repository.ts` + Supabase adapter, `master-signal-synthesis.ts` prompt, `GET /api/master-signal`, `POST /api/ai/generate-master-signal`, and the two `prompt_versions.prompt_key` values (`master_signal_cold_start`, `master_signal_incremental`) all remain wired. Rationale: dashboards + chat are the replacement UX, but the backend is kept as an optional re-entry point and to preserve historical data. See ARCHITECTURE.md "Key Design Decisions → Master Signal (retained backend, retired UI)." A future cleanup PRD should either bring back a minimal UI or remove the backend end-to-end (including a data migration for `master_signals`); the current in-between state is deliberate but not indefinite.

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

### P8 — Master Signal cold-start corpus is unbounded
**File:** `lib/services/master-signal-service.ts`
**Priority: Low-Medium**

`getAllSignalSessions()` fetches every non-deleted session. As the corpus grows, cold-start synthesis sends an increasingly large prompt. A `is_tainted` flag or manual "regenerate all" forces cold-start regardless of corpus size.
