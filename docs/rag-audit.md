# RAG Pipeline Audit — Synthesiser

> Identified 2026-05-04. Grounded in code review of the full RAG flow:
> session create/update → chunking → embedding → storage → similarity search →
> chat tool → LLM response.
> Issues marked ✅ are already fixed in this branch.

Numbered with `R` prefix to keep separate from `gap-analysis.md`'s `E` series.

---

## Already fixed in this session

### R0a — Case-sensitive `client_name` match in similarity RPC ✅ Fixed
**File:** `docs/019-vector-search/002-match-session-embeddings-rpc.sql`

The RPC compared `metadata->>'client_name' = filter_client_name` exactly. The chat LLM passes whatever casing the user typed (e.g. `"feedbackers"`), but the embedded metadata stores the canonical client name (e.g. `"Feedbackers"`). Every search with a client filter silently returned zero rows — the model then fell back to `queryDatabase` and reported aggregate sentiment counts as if they were the answer to a qualitative question.

**Fix applied (2026-05-04):** changed comparison to `LOWER(TRIM(...)) = LOWER(TRIM(...))`. Requires `CREATE OR REPLACE FUNCTION` against Supabase to take effect.

### R0b — OpenAI strict-mode rejects `extractionSchema` ✅ Fixed
**File:** `lib/schemas/extraction-schema.ts`

OpenAI strict structured-outputs requires every property in `properties` to be in `required`. Zod's `.default([])` translates to optional, so OpenAI rejected the schema with `"Missing 'painPoints'"`. Worked on Anthropic/Google because they don't enforce the constraint; surfaced when `AI_PROVIDER=openai`.

**Fix applied:** removed `.default([])` from the eight array fields. Inferred TS types unchanged.

### R0c — Follow-up suggestions leak into chat bubbles ✅ Fixed
**File:** `lib/utils/chat-helpers.ts`

The model occasionally drifts and emits `<!--follow-ups":[...]-->` (stray quote, JSON-key style) instead of `<!--follow-ups:[...]-->`. The regex was anchored to the canonical form, so the parser failed silently and the raw HTML comment streamed into the message bubble.

**Fix applied:** widened both regexes to tolerate optional whitespace and surrounding `"`.

---

## Outstanding loose ends

### R1 — Non-extraction PUT trashes structured embeddings
**File:** `app/api/sessions/[id]/route.ts:120-122`, `lib/services/session-orchestrator.ts:71-73`
**Priority: High**

```ts
const chainStructuredJson = parsed.data.isExtraction
  ? ((parsed.data.structuredJson as ExtractedSignals | null) ?? null)
  : null;
```

Combined with `isReExtraction: true` hard-coded on every PUT, any non-extraction edit (date change, client change, raw-notes edit without re-extracting) deletes all existing embeddings and re-runs the chain with `structuredJson=null`. The chain falls back to `chunkRawNotes`, which produces only `chunk_type='raw'` paragraph chunks.

Symptom: every chunk-typed search filter (`pain_point`, `requirement`, `positive_signal`, etc.) silently misses that session until the user clicks re-extract. The structured JSON stays in the DB row but the embeddings no longer reflect it.

**Proposed fix:** when `inputChanged === false` (raw notes unchanged), pass through the existing `structured_json` from the updated session row to the chain. Only fall back to raw chunks when raw notes actually changed and the JSON is now stale. Manual JSON edits should be treated like extractions for chain purposes.

### R2 — Stale `client_name` in metadata after rename
**File:** `lib/services/chunking-service.ts:18-21`, `docs/019-vector-search/002-match-session-embeddings-rpc.sql:50-56`
**Priority: High**

`metadata.client_name` is captured once at chunk time. If the client is later renamed (e.g. "Feedbackers" → "Feedbackers Inc"), every existing embedding still carries the old name. R0a's case-insensitive match doesn't help — the strings genuinely differ.

**Proposed fix:** stop storing `client_name` in metadata. Resolve it at search time by extending the RPC's existing `INNER JOIN sessions` to also join `clients` and filter on `c.name`. Cheap (already joining sessions) and makes rename a no-op. Migration: existing metadata can stay; just stop reading it.

### R3 — Personal-workspace search is fail-open when `userId` is omitted
**File:** `docs/019-vector-search/002-match-session-embeddings-rpc.sql:41-45`, `lib/repositories/supabase/supabase-embedding-repository.ts:24-28`
**Priority: Medium (defense-in-depth)**

```sql
(filter_team_id IS NULL AND se.team_id IS NULL
 AND (filter_user_id IS NULL OR s.created_by = filter_user_id))
```

When both `filter_team_id` and `filter_user_id` are null, this clause returns true for every personal embedding regardless of owner. Today the only personal-search caller (`app/api/chat/send/route.ts:97`) passes `user.id`, so no actual leak — but `userId` is *optional* in the repository factory signature. One careless future caller and this becomes a P0 cross-tenant data leak.

**Proposed fix:** make the RPC fail-closed when `filter_team_id IS NULL AND filter_user_id IS NULL` (return zero rows). Optionally also tighten the TS signature so `userId` is required for personal-workspace contexts.

### R4 — searchInsights doesn't tell the LLM why a result was empty
**File:** `lib/services/chat-stream-service.ts:508-561`
**Priority: Medium (UX)**

When `searchInsights` returns 0 rows the model can't tell whether (a) the data genuinely doesn't exist, (b) the filters were too tight / invalid, or (c) embeddings haven't been generated yet. With (b) being the most common cause (R0a showed exactly this pattern) the model's natural fallback — "let me try `queryDatabase` instead" — produces a confidently wrong quantitative answer instead of retrying without filters.

**Proposed fix:** when `searchInsights` returns zero rows but had any filters applied, return a structured payload like `{ results: [], filtersApplied: { clientName: "..." }, hint: "no matches with these filters; consider retrying without them" }`. Lets the model self-correct.

### R5 — Embedding "provider abstraction" is OpenAI-only
**File:** `lib/services/embedding-service.ts:71-76`
**Priority: Low**

`PROVIDER_MAP` has one entry. Setting `EMBEDDING_PROVIDER=anthropic` errors at boot. The shape implies optionality that doesn't exist; CLAUDE.md's "provider-agnostic" framing is honoured for the LLM layer (`ai-service.ts`) but not for embeddings.

**Proposed fix:** either drop the abstraction (single provider, simpler code) or wire a real second provider when there's a use case.

### R6 — `upsertChunks` is named upsert but does insert
**File:** `lib/repositories/supabase/supabase-embedding-repository.ts:30-49`
**Priority: Low**

No conflict handling. Today the orchestrator always `delete → insert` so this is fine — but the name lies. A future caller who trusts the upsert semantic (e.g. retry-safe re-runs) will get duplicates.

**Proposed fix:** rename to `insertChunks`, or add `.onConflict()` handling that matches the implied semantic.

### R7 — Soft-deleted sessions: embeddings linger forever
**File:** session delete flow + `session_embeddings` table
**Priority: Low (storage hygiene, not correctness)**

The match RPC excludes soft-deleted sessions via `INNER JOIN sessions ... WHERE deleted_at IS NULL`, so search results are clean. But `session_embeddings` rows are never deleted on session soft-delete. Vector index keeps growing; pgvector indexes get slower and more expensive over time.

**Proposed fix:** either hard-delete embeddings on session soft-delete (one DELETE in the soft-delete code path), or run a periodic cleanup job that purges embeddings whose session has been soft-deleted past N days. PRD-025 (soft-delete-purge) may already cover this — check before implementing.

### R8 — Date metadata cast is unsafe
**File:** `docs/019-vector-search/002-match-session-embeddings-rpc.sql:53-56`
**Priority: Very low**

`(se.metadata->>'session_date')::date` will throw on a malformed value. Currently the only writer (`chunking-service.ts:21`) uses validated request data, so safe in practice. Worth a note in case future writers (bulk import, manual SQL) feed less-trusted data.

**Proposed fix:** wrap in `SAFE_CAST`-style guard if/when ingestion broadens, or (more durable) move `session_date` out of `metadata` jsonb into a typed column on `session_embeddings`.

---

## Recommended grouping for follow-up work

- **PR 1 (high-impact correctness):** R1 + R2 + R3. All touch the embedding storage / search path; bundling them keeps the RPC migration to one round.
- **PR 2 (chat UX):** R4. Independent; makes the chat noticeably more truthful when data is sparse.
- **PR 3 (hygiene):** R5–R8 individually as time permits.
