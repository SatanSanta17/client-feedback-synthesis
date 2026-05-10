# TRD-033: Agentic Chat — Primitive Tool Surface

> **PRD:** [`prd.md`](./prd.md)
> **Status (Part 1):** Draft
> **Mirrors:** PRD Part 1 (Primitive Tool Surface). Parts 2 (Map-Reduce Summarisation) and 3 (Cutover and Ripout) are deferred to follow-on TRD parts but are accounted for in the architecture below.

---

## Architectural Direction

The new chat surface is built as a set of focused tool factories, each in its own file under a new `lib/services/chat-tools/` directory, registered via a single `createChatTools()` registry. Each tool factory takes its dependencies (repos, services, workspace context) by parameter and returns a Vercel AI SDK `Tool` object. The registry returns a `Record<toolName, Tool>` that `chat-stream-service.ts` spreads into `streamText({ tools })`.

This shape is the smallest change consistent with the codebase's existing factory + DI conventions (see `createEmbeddingRepository`, `createChatService`, etc.) and gives Part 2 a one-file extension point for `summarise_sessions` and Part 3 a single deletion target for the old surface.

**Industry-standard patterns adopted:**
- **Tool registry over inline `tool()` calls.** Today's tools are defined inline in [`chat-stream-service.ts`](../../lib/services/chat-stream-service.ts#L467-L681). Moving them to one-tool-per-file is the standard agentic chat layout (LangChain, OpenAI Agents SDK, MCP servers all use this) and makes routing/eval/auditing each tool's contract straightforward.
- **Reciprocal Rank Fusion (RRF)** for hybrid retrieval, with the canonical Cormack et al. formula `score = Σ 1/(k+rank_i)` and `k=60` as the standard default. Per-side weighting is a small extension on top.
- **Two-RPC fusion in TypeScript** for hybrid retrieval (rather than one RPC that fuses server-side). Easier to reason about, easier to log per-side telemetry, easier to swap in a reranker later. Acceptable cost: 2× the round-trips on `semantic_search`. Promote to one-RPC fusion if profiler shows it matters.
- **Subsequence-matching eval runner** in TS, no third-party eval framework. Promptfoo / Braintrust / Phoenix are mature but overkill for ~25 queries; DIY keeps deps lean and the runner readable.
- **Service-layer workspace scoping** consistent with the existing `getActiveTeamId()` cookie pattern. The model never sees `teamId`.

**Forward-compat notes (Parts 2 & 3) called out inline** — search for `[fwd-compat]` markers below.

---

## Part 1: Primitive Tool Surface

### 1.1 Database Changes

#### Migration: `docs/033-agentic-chat/001-fts-on-session-embeddings.sql`

Adds full-text search infrastructure to `session_embeddings` so the new `semantic_search` tool can fuse vector and keyword retrieval.

```sql
-- 1. Generated tsvector column over chunk_text (English).
--    STORED so the index can be GIN'd; auto-maintained by Postgres.
ALTER TABLE session_embeddings
  ADD COLUMN chunk_text_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_text, ''))) STORED;

-- 2. GIN index for fast tsquery matching.
CREATE INDEX idx_session_embeddings_tsv
  ON session_embeddings USING GIN (chunk_text_tsv);

-- 3. Composite index on (team_id, session_id) — speeds the workspace+session
--    filter that fetch_session_content does (existing index covers (team_id, chunk_type),
--    not (team_id, session_id) — verify before merging and drop this if redundant).
CREATE INDEX IF NOT EXISTS idx_session_embeddings_team_session
  ON session_embeddings (team_id, session_id);
```

**Notes:**
- `STORED` (not `VIRTUAL`) is required for GIN indexing in Postgres 16+.
- `'english'` config is consistent with the corpus language. If the product later supports other languages, switch to a config that detects per-row (out of scope here).
- The generated column avoids a trigger, reducing ongoing maintenance.

#### Migration: `docs/033-agentic-chat/002-match-session-embeddings-fts-rpc.sql`

A new RPC that mirrors the signature of the existing `match_session_embeddings` (vector RPC) but takes a query string and uses `ts_rank_cd` for scoring.

```sql
CREATE OR REPLACE FUNCTION match_session_embeddings_fts(
  query_text TEXT,
  match_count INT DEFAULT 30,
  filter_team_id UUID DEFAULT NULL,
  filter_user_id UUID DEFAULT NULL,
  filter_chunk_types TEXT[] DEFAULT NULL,
  filter_client_name TEXT DEFAULT NULL,
  filter_date_from DATE DEFAULT NULL,
  filter_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  chunk_text TEXT,
  chunk_type TEXT,
  metadata JSONB,
  fts_rank REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts_query tsquery;
BEGIN
  -- websearch_to_tsquery handles user-friendly input (quoted phrases, OR, -term).
  ts_query := websearch_to_tsquery('english', query_text);

  RETURN QUERY
  SELECT
    e.id,
    e.session_id,
    e.chunk_text,
    e.chunk_type,
    e.metadata,
    ts_rank_cd(e.chunk_text_tsv, ts_query) AS fts_rank
  FROM session_embeddings e
  JOIN sessions s ON s.id = e.session_id
  WHERE e.chunk_text_tsv @@ ts_query
    -- Workspace scoping mirrors match_session_embeddings.
    AND (
      (filter_team_id IS NOT NULL AND e.team_id = filter_team_id)
      OR (filter_team_id IS NULL AND e.team_id IS NULL
          AND filter_user_id IS NOT NULL AND s.created_by = filter_user_id)
    )
    AND (filter_chunk_types IS NULL OR e.chunk_type = ANY(filter_chunk_types))
    AND (filter_client_name IS NULL
         OR EXISTS (SELECT 1 FROM clients c
                    WHERE c.id = s.client_id
                      AND lower(c.name) = lower(filter_client_name)))
    AND (filter_date_from IS NULL OR s.session_date >= filter_date_from)
    AND (filter_date_to IS NULL OR s.session_date <= filter_date_to)
  ORDER BY fts_rank DESC
  LIMIT match_count;
END;
$$;
```

**Decisions:**
- `websearch_to_tsquery` over `plainto_tsquery` because users type "pricing OR onboarding" or `"exact phrase"` and the websearch parser handles both naturally.
- Returns the same identity column (`id`, the embedding row id) as the vector RPC so RRF fusion in TS is a simple keyed join.
- `SECURITY DEFINER` with `search_path = public` matches the existing RPC's posture.
- No similarity threshold parameter — `ts_rank_cd` doesn't have a meaningful global cutoff; the top-N cap is the relevance gate.

#### No other schema changes in Part 1

The existing `clients`, `sessions`, `themes`, `signal_themes`, `dashboard_insights`, and `session_embeddings` tables already carry every field the new tools need. Filter semantics (P1.R1: signal-level filters match a session if at-least-one chunk satisfies) are enforced at the query layer, not via new columns.

---

### 1.2 New Repository Methods

Repositories are the only layer that talks to Supabase directly (per the existing pattern).

> **Implementation-time deviation (recorded 2026-05-10).** The TRD originally proposed extending `SessionRepository`, `ClientRepository`, and `ThemeRepository` with chat-specific methods (`listForChat`, `fetchHeadersByIds`, `listWithMetadata`). Implementation went a different way: a single dedicated **`ChatQueryRepository`** ([`lib/repositories/chat-query-repository.ts`](../../lib/repositories/chat-query-repository.ts) / [`supabase-chat-query-repository.ts`](../../lib/repositories/supabase/supabase-chat-query-repository.ts)) was created instead. Reasons: (a) the chat tools need shapes (theme-name resolution, at-least-one-chunk EXISTS semantics, lightweight session rows) that none of the existing dashboard / list-page consumers want, so adding them to the shared repos would have violated ISP; (b) the three existing repos have different factory signatures (`(supabase, serviceClient, teamId)` vs `(supabase, teamId)` vs `(supabase, teamId)`), making bulk extension awkward; (c) one new repo with a clear boundary is easier to delete in Part 3 if the chat surface shape changes again. The `EmbeddingRepository` extensions described below (sub-§ 1.2.A) DID land as planned — its data access pattern is genuinely shared with the existing similarity search path. Sections 1.2.B (sessions / clients / themes) below are kept for the historical record but **the actual implementation is in `ChatQueryRepository`** — see CHANGELOG entry for PRD-033 Part 1 (2026-05-10).

#### 1.2.A — `EmbeddingRepository` extensions (as designed, landed)

#### `EmbeddingRepository` extensions ([`lib/repositories/embedding-repository.ts`](../../lib/repositories/embedding-repository.ts))

```ts
export interface EmbeddingRepository {
  // ... existing methods unchanged ...

  /** New: full-text search via match_session_embeddings_fts RPC. */
  fullTextSearch(
    query: string,
    options: SearchOptions & { matchCount?: number }
  ): Promise<SimilarityResult[]>;

  /** New: fetch all chunks for a session id list, workspace-scoped. */
  fetchBySessionIds(sessionIds: string[]): Promise<EmbeddingRow[]>;

  /** New: filter-driven signal listing. */
  listSignals(filters: SignalFilters): Promise<EmbeddingRow[]>;
}
```

`SimilarityResult` and `SearchOptions` already exist; `fullTextSearch` reuses them with `similarity` repurposed as `fts_rank` for the fusion step (or we add a separate `FtsResult` type — cleaner; see § 1.3).

`SignalFilters` is new:
```ts
export interface SignalFilters {
  clientName?: string;
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: 'low' | 'medium' | 'high';
  urgency?: 'low' | 'medium' | 'high';
  dateFrom?: string; // ISO date
  dateTo?: string;
}
```

`listSignals` does a join through `signal_themes` when `themeName` is set, and applies severity/urgency via the existing [`severity-filter.ts`](../../lib/services/database-query/shared/severity-filter.ts) helper.

#### 1.2.B — Session / Client / Theme repository extensions (superseded by `ChatQueryRepository`; kept for historical record)

> The methods described below are the original TRD plan; the actual implementation collapsed all of them into `ChatQueryRepository`. See the deviation note at the top of § 1.2.

#### `SessionRepository` extensions ([`lib/repositories/session-repository.ts`](../../lib/repositories/session-repository.ts))

```ts
export interface SessionListFilters {
  clientId?: string;
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  // Signal-level filters (apply via at-least-one-chunk EXISTS):
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: 'low' | 'medium' | 'high';
  urgency?: 'low' | 'medium' | 'high';
}

export interface SessionRepository {
  // ... existing methods unchanged ...

  /** New: discovery list for the chat tool. Lightweight — no structured_json. */
  listForChat(filters: SessionListFilters, limit: number): Promise<ChatSessionRow[]>;

  /** New: header metadata for fetch_session_content (date, client, themes, etc.). */
  fetchHeadersByIds(ids: string[]): Promise<ChatSessionHeader[]>;
}
```

`ChatSessionRow` (lightweight): `{ id, clientName, sessionDate, sentiment, urgency, themeNames }` — no `structured_json`, no `parsed_content` (P1.AC2 compliance).

**Filter implementation:** session-level fields go in the SELECT's WHERE clause. Signal-level fields each become a separate `EXISTS` subquery against `session_embeddings` (joining `signal_themes` for `themeName`). This honours the AND-across-the-filter-set rule from PRD P1.R1 ("a session matches `severity=high AND theme=pricing` if it has any high-severity chunk **and** any pricing-themed chunk, even if those are different chunks").

#### `ClientRepository` and `ThemeRepository` extensions

Add `listWithMetadata(filters)` to each. For clients: `{ id, name, sessionCount, lastSessionDate }`. For themes: `{ id, name, mentionCount }` with optional date-range filter on the underlying `signal_themes`.

---

### 1.3 New Services

Services orchestrate one or more repositories per tool. They are framework-agnostic (no `next/server` imports) per [CLAUDE.md](../../CLAUDE.md).

#### `lib/services/chat-tool-services/` directory

One file per tool's domain logic:

| File | Purpose |
|---|---|
| `discovery-service.ts` | `listClients()`, `listSessions()`, `listThemes()` |
| `session-content-service.ts` | `fetchSessionContent(ids)` with token-budget enforcement |
| `signals-service.ts` | `fetchSignals(filters)` — filter-only, no query string |
| `aggregation-service.ts` | `aggregate({ entity, groupBy, filters })`, `timeSeries({ entity, granularity, groupBy, filters })` |
| `insights-service.ts` | thin pass-through to existing insights domain module |

Hybrid retrieval lives in the **existing** [`retrieval-service.ts`](../../lib/services/retrieval-service.ts), extended:

```ts
export async function retrieveRelevantChunks(
  query: string,
  filters: RetrievalFilters,
  deps: { embeddingRepo, embeddingService },
): Promise<RetrievedChunk[]> {
  const [vectorHits, ftsHits] = await Promise.all([
    embeddingRepo.similaritySearch(await embeddingService.embed(query), {
      ...filters, matchCount: VECTOR_TOP_N
    }),
    embeddingRepo.fullTextSearch(query, { ...filters, matchCount: FTS_TOP_N }),
  ]);
  return rrfFuse(vectorHits, ftsHits, {
    k: RRF_K,                  // default 60
    vectorWeight: VECTOR_WEIGHT, // default 1.0
    ftsWeight: FTS_WEIGHT,       // default 1.0
    finalTopN: FINAL_TOP_N,      // default 10
  });
}
```

Constants live in `lib/services/retrieval-config.ts` and are env-overridable (`RAG_VECTOR_TOP_N`, `RAG_FTS_TOP_N`, `RAG_RRF_K`, `RAG_VECTOR_WEIGHT`, `RAG_FTS_WEIGHT`, `RAG_FINAL_TOP_N`). The eval set in P1.R9 is the source of truth for tuning.

`rrfFuse()` is a pure function in `lib/services/retrieval-rrf.ts`:

```ts
export function rrfFuse<T extends { id: string }>(
  setA: T[],
  setB: T[],
  cfg: { k: number; vectorWeight: number; ftsWeight: number; finalTopN: number },
): (T & { rrfScore: number; sources: ('vector' | 'fts')[] })[] {
  const scores = new Map<string, { row: T; score: number; sources: Set<...> }>();
  setA.forEach((row, i) => addContribution(scores, row, cfg.vectorWeight / (cfg.k + i + 1), 'vector'));
  setB.forEach((row, i) => addContribution(scores, row, cfg.ftsWeight    / (cfg.k + i + 1), 'fts'));
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.finalTopN)
    .map(({ row, score, sources }) => ({ ...row, rrfScore: score, sources: [...sources] }));
}
```

Returning `sources: ('vector' | 'fts')[]` per chunk is cheap and gives the eval harness a per-side hit-rate metric for tuning.

#### Token-budget enforcement (`session-content-service.ts`)

```ts
const DEFAULT_BUDGET_TOKENS = parseInt(process.env.CHAT_FETCH_CONTENT_BUDGET ?? '50000', 10);

export async function fetchSessionContent(
  ids: string[],
  deps: { sessionRepo, embeddingRepo },
  budgetTokens = DEFAULT_BUDGET_TOKENS,
): Promise<{ sessions: SessionContent[]; fetched: number; requested: number; budgetReached: boolean }> {
  const headers = await deps.sessionRepo.fetchHeadersByIds(ids);
  const chunks = await deps.embeddingRepo.fetchBySessionIds(ids);

  let used = 0;
  const out: SessionContent[] = [];
  for (const id of ids) {
    const session = composeSession(id, headers, chunks);
    const sessionTokens = estimateTokens(session);
    if (out.length > 0 && used + sessionTokens > budgetTokens) break;
    out.push(session);
    used += sessionTokens;
  }
  return { sessions: out, fetched: out.length, requested: ids.length, budgetReached: out.length < ids.length };
}
```

`estimateTokens()` lives in `lib/services/token-estimator.ts`. **Part 1 ships with the chars/4 proxy only:**

```ts
// lib/services/token-estimator.ts
export function estimateTokens(value: unknown): number {
  // chars/4 proxy. Accuracy: ±20% vs the true tokenizer count
  // for English prose. Underestimates for code / symbol-heavy text;
  // overestimates for whitespace-heavy text. The fetch-content
  // token budget is approximate by design — this proxy is the trade-off.
  return Math.ceil(JSON.stringify(value).length / 4);
}
```

**Accuracy implications consumers must know about:**
- The 50,000-token budget for `fetch_session_content` is enforced against this proxy, so the *actual* token count delivered to the chat model can be anywhere from ~40,000 to ~60,000. This is acceptable because the cost circuit breaker (Part 3, 100,000 tool-result tokens per turn) runs at a higher level and catches the worst-case overshoot.
- The proxy biases pessimistically for code-heavy content (we under-count, so we may send more than budgeted). Sessions with verbatim transcript dumps or code snippets in the raw notes are the most likely outliers.
- Real-tokenizer code paths (tiktoken for OpenAI, `client.messages.countTokens()` for Anthropic, Google's helper for Gemini) are intentionally **deferred**. Promote to real tokenizers only when the eval surfaces a budget-mis-estimation issue that costs us either real money (over-fetching) or real coverage (under-fetching).

**[fwd-compat]** Part 2's `summarise_sessions` reuses this estimator for cheap-model context budgeting and inherits the same ±20% characteristic. Part 3's per-turn cost circuit breaker also reads this estimator's output, so its 100,000-token threshold should be set with the proxy's pessimism in mind (i.e. don't set it tight enough that ±20% noise trips it spuriously).

#### `aggregation-service.ts` — implementing the mapping table

Two public functions, each delegating to the existing [`database-query/domains/`](../../lib/services/database-query/domains/) modules — no new SQL is written, only a new orchestration layer:

```ts
type Entity = 'sessions' | 'signals' | 'clients';
type Dim = 'client' | 'theme' | 'sentiment' | 'urgency' | 'severity' | 'chunkType';

export async function aggregate(input: {
  entity: Entity;
  groupBy?: Dim | Dim[];
  filters: AggregateFilters;
}, deps: AggregateDeps): Promise<AggregateResult> { /* ... */ }

export async function timeSeries(input: {
  entity: Entity;
  granularity: 'week' | 'month';
  groupBy?: Dim;            // single-dim only per PRD
  filters: AggregateFilters;
}, deps: AggregateDeps): Promise<TimeSeriesResult> { /* ... */ }
```

The internal dispatch matches the PRD's mapping table — [counts.ts](../../lib/services/database-query/domains/counts.ts), [distributions.ts](../../lib/services/database-query/domains/distributions.ts), [themes.ts](../../lib/services/database-query/domains/themes.ts), and the trends builders all stay in place. The aggregation service is a thin adapter that translates `(entity, groupBy)` into the right domain call. **[fwd-compat]** Part 3 deletes [`action-metadata.ts`](../../lib/services/database-query/action-metadata.ts) and [`execute-query.ts`](../../lib/services/database-query/execute-query.ts) — but only the chat-facing parts. The dashboard's own use is untouched (see PRD § Purpose final paragraph).

Multi-dim `groupBy` (`[theme, client]` for `theme_client_matrix` and `[client, severity]` for `client_health_grid`) is implemented as a Postgres `GROUP BY a, b` returning a flat `{ dimensions: { ... }, count }` array. The model can pivot in its response.

---

### 1.4 Tool Registry Pattern

#### Directory: `lib/services/chat-tools/`

```
lib/services/chat-tools/
├── index.ts                          # createChatTools() registry
├── shared/
│   ├── tool-context.ts               # ChatToolContext type (deps + status emitter)
│   └── status-events.ts              # emitToolStatus() helper
├── list-clients-tool.ts
├── list-sessions-tool.ts
├── list-themes-tool.ts
├── semantic-search-tool.ts
├── fetch-session-content-tool.ts
├── fetch-signals-tool.ts
├── aggregate-tool.ts
├── time-series-tool.ts
├── insights-latest-tool.ts
└── insights-history-tool.ts
```

#### `ChatToolContext` (the DI bag)

```ts
export interface ChatToolContext {
  workspace: WorkspaceCtx;            // { teamId: string | null, userId: string }
  // Repositories
  sessionRepo: SessionRepository;
  clientRepo: ClientRepository;
  themeRepo: ThemeRepository;
  embeddingRepo: EmbeddingRepository;
  insightRepo: InsightRepository;
  // Services
  embeddingService: EmbeddingService;
  // Streaming-side
  emitStatus: (message: string) => void;
}
```

The context is built once per chat turn in [`chat-stream-service.ts`](../../lib/services/chat-stream-service.ts) and threaded into every tool factory. Tools never reach for a Supabase client directly.

**[fwd-compat]** Part 2 adds `cheapModel: LanguageModel` to the context for `summarise_sessions`. Part 3 adds telemetry hooks (`recordToolResultTokens(toolName, n)`) so the per-turn cost circuit breaker can sum across tool calls.

#### One tool factory, end to end

Example: [`list-clients-tool.ts`](../../lib/services/chat-tools/list-clients-tool.ts)

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { ChatToolContext } from './shared/tool-context';
import { listClients } from '../chat-tool-services/discovery-service';

const inputSchema = z.object({
  nameSearch: z.string().optional().describe('Substring match on client name (case-insensitive).'),
  hasSessions: z.boolean().optional().describe('If true, only clients with at least one session.'),
});

export function createListClientsTool(ctx: ChatToolContext) {
  return tool({
    description:
      'List clients in the current workspace with lightweight metadata (id, name, ' +
      'session count, last-session timestamp). Use this to answer "which clients exist?" ' +
      'or as the first step before fetching client-specific content. Does NOT return ' +
      'session content; use fetch_session_content for that.',
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus('Looking up clients…');
      const clients = await listClients(input, {
        clientRepo: ctx.clientRepo,
        sessionRepo: ctx.sessionRepo,
        workspace: ctx.workspace,
      });
      // Name-resolved (no UUIDs the model would mention),
      // ISO date strings, [] for empty.
      return clients;
    },
  });
}
```

Tool descriptions are written for the model, not for human readers — they tell the model **when to use** this tool and **when not to** (with concrete cross-references). This is how to keep tool-routing accuracy high. **[fwd-compat]** Part 3's eval reports tool-routing accuracy; tool descriptions are the primary lever.

#### Registry

```ts
// lib/services/chat-tools/index.ts
export function createChatTools(ctx: ChatToolContext) {
  return {
    list_clients:           createListClientsTool(ctx),
    list_sessions:          createListSessionsTool(ctx),
    list_themes:            createListThemesTool(ctx),
    semantic_search:        createSemanticSearchTool(ctx),
    fetch_session_content:  createFetchSessionContentTool(ctx),
    fetch_signals:          createFetchSignalsTool(ctx),
    aggregate:              createAggregateTool(ctx),
    time_series:            createTimeSeriesTool(ctx),
    insights_latest:        createInsightsLatestTool(ctx),
    insights_history:       createInsightsHistoryTool(ctx),
  } as const;
}
```

**Per P1.AC9, this registry is not yet wired into [`chat-stream-service.ts`](../../lib/services/chat-stream-service.ts) at the end of Part 1.** The old `searchInsights` and `queryDatabase` tools remain the active surface. Part 3 swaps them in one commit.

---

### 1.5 Per-Tool Input Schemas (Summary Table)

Every input is a Zod schema; only the fields the tool actually uses appear (P1.R5). No shared filter bag.

| Tool | Input fields |
|---|---|
| `list_clients` | `nameSearch?`, `hasSessions?` |
| `list_sessions` | `clientName?`, `dateFrom?`, `dateTo?`, `sentiment?`, `themeName?`, `chunkTypes?`, `severity?`, `urgency?`, `limit?` |
| `list_themes` | `nameSearch?`, `dateFrom?`, `dateTo?` |
| `semantic_search` | `query` (required), `clientName?`, `dateFrom?`, `dateTo?`, `chunkTypes?` |
| `fetch_session_content` | `sessionIds` (required, max 100 ids on the schema; the token budget is the real cap) |
| `fetch_signals` | `clientName?`, `themeName?`, `chunkTypes?`, `severity?`, `urgency?`, `dateFrom?`, `dateTo?` |
| `aggregate` | `entity` (required), `groupBy?` (string or array), `clientName?`, `dateFrom?`, `dateTo?`, `themeName?`, `chunkTypes?`, `severity?`, `urgency?`, `confidenceMin?` |
| `time_series` | `entity` (required), `granularity` (required), `groupBy?` (single-dim only), all aggregate filters |
| `insights_latest` | `limit?` |
| `insights_history` | `cursor?`, `limit?` |

No tool exposes `teamId`, `userId`, or `workspaceId` (P1.R6).

---

### 1.6 Tool Result Shapes (P1.R7 / P1.AC8)

Every tool returns a JSON-serialisable object. UUIDs are replaced with names where the model would mention them. Dates are ISO strings. Empty results are `[]`, never `null` / `undefined`.

```ts
// list_clients
type ClientResult = { name: string; sessionCount: number; lastSessionDate: string | null };

// list_sessions
type SessionResult = {
  id: string;       // present so fetch_session_content can be chained
  clientName: string;
  sessionDate: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  urgency: 'low' | 'medium' | 'high' | null;
  themeNames: string[];
};

// semantic_search
type SemanticHit = {
  clientName: string;
  sessionDate: string;
  chunkType: ChunkType;
  text: string;
  score: number;        // RRF score (not raw similarity)
  sources: ('vector' | 'fts')[];
};

// fetch_session_content
type SessionContentResult = {
  sessions: Array<{
    sessionId: string;
    clientName: string;
    sessionDate: string;
    sentiment: string | null;
    urgency: string | null;
    themes: string[];
    rawNotes: string | null;
    chunks: Array<{ type: ChunkType; text: string; severity?: string; urgency?: string }>;
  }>;
  fetched: number;
  requested: number;
  budgetReached: boolean;
};

// aggregate (single-dim and multi-dim)
type AggregateResult =
  | { count: number }
  | { distribution: Array<{ key: string; count: number }> }                     // single-dim
  | { distribution: Array<{ dimensions: Record<string, string>; count: number }> }; // multi-dim

// time_series
type TimeSeriesResult = {
  granularity: 'week' | 'month';
  buckets: Array<{ periodStart: string; key?: string; count: number }>;  // key absent if no groupBy
};
```

`id` is included on `list_sessions` (the model needs it to feed into `fetch_session_content`), but not on `list_clients` or `list_themes` (which the model addresses by name).

---

### 1.7 Eval Harness Foundation (P1.R9)

#### Layout

```
docs/033-agentic-chat/
├── eval/
│   ├── queries.json                  # frozen test set (≥15 queries; +exact-term subset)
│   ├── judge-prompt.ts               # LLM-as-judge system prompt
│   └── reports/                      # gitignored output
└── ...
scripts/
└── run-eval.ts                       # CLI runner (npm run eval:chat -- --surface=new|old)
```

#### `queries.json` shape

```jsonc
[
  {
    "id": "Q-001",
    "category": "quantitative",       // quantitative | qualitative | discovery | hybrid | exact-term
    "query": "How many sessions do we have?",
    "expectedTrajectory": ["aggregate"],
    "rubric": {
      "mustMention": ["session count"],
      "mustNotHallucinate": ["specific client names not in the data"]
    }
  },
  {
    "id": "Q-014",
    "category": "exact-term",
    "query": "Find every pain point that mentions Snowflake",
    "expectedTrajectory": ["semantic_search"],
    "rubric": { "mustMention": ["Snowflake"] }
  }
  // ... ≥15 queries total, with at least 3 in the exact-term category
]
```

#### Runner (`scripts/run-eval.ts`)

For each query:

1. Spin up a fresh chat-turn invocation against the requested surface (`--surface=old|new`).
2. Capture: the model's full message stream, the tool-call sequence (name + input + output token estimate).
3. Score **answer correctness** by sending `(query, answer)` to the judge with the rubric → `{ score: 0..1, justification }`.
4. Score **tool-routing accuracy** by checking whether `expectedTrajectory` is a **subsequence** of the actual tool-call sequence:
   ```ts
   function isSubsequence(expected: string[], actual: string[]): boolean {
     let i = 0;
     for (const a of actual) if (a === expected[i]) i++;
     return i === expected.length;
   }
   ```
5. Write `docs/033-agentic-chat/eval/reports/<ISO-timestamp>-<surface>.json` with per-query results + aggregate counters (pass-rate by category, baseline-vs-new delta, per-side RRF source distribution).

#### Surface-toggle in the runner

Because Part 1 explicitly does **not** wire the new tools into `chat-stream-service.ts` (P1.AC9), the eval runner takes a `--surface` flag:
- `--surface=old` builds the chat stream with the existing two tools.
- `--surface=new` builds the chat stream with the new tool registry, using a **runner-local** copy of the system prompt that names the new tools.

The runner is the only consumer of the new surface in Part 1. End users still see the old surface. **[fwd-compat]** Part 3 deletes the `--surface` flag; the new surface becomes default and only.

#### Judge prompt

A separate model (configured via `EVAL_JUDGE_PROVIDER` / `EVAL_JUDGE_MODEL`, independent of `AI_PROVIDER`) scores each answer against the rubric. The judge prompt is committed at `docs/033-agentic-chat/eval/judge-prompt.ts` and treated as a versioned artifact (changing it invalidates prior reports).

**Industry-standard practice:** the judge should be at least as capable as the chat model, and ideally stronger, to avoid the "judge inherits the chat model's blind spots" failure mode. The PRD's backlog item _"LLM-as-judge model upgrade path"_ codifies the eventual move to multi-judge agreement.

---

### 1.8 Workspace Scope Plumbing (P1.R6)

The chat tool turn's entry point ([`app/api/chat/send/route.ts`](../../app/api/chat/send/route.ts)) already resolves `teamId` via [`getActiveTeamId()`](../../lib/cookies/active-team-server.ts) and the user via Supabase auth. Building the `ChatToolContext`:

```ts
const teamId = await getActiveTeamId();
const { data: { user } } = await supabase.auth.getUser();
const ctx: ChatToolContext = {
  workspace: { teamId, userId: user!.id },
  sessionRepo: createSessionRepository(supabase),
  clientRepo: createClientRepository(supabase),
  themeRepo: createThemeRepository(supabase),
  embeddingRepo: createEmbeddingRepository(serviceClient, teamId, user!.id),
  insightRepo: createInsightRepository(supabase),
  embeddingService,
  emitStatus,
};
const tools = createChatTools(ctx);
// streamText({ ... tools }) — old surface in Part 1, new surface in Part 3.
```

Every repository method that touches workspace data accepts `WorkspaceCtx` (or a `teamId`/`userId` pair derived from it) and applies the same `(team_id = $1) OR (team_id IS NULL AND created_by = $2)` predicate the existing repos use. RLS remains the structural backstop (PRD P1.R6).

---

### 1.9 Files Changed (Part 1)

**New files:**
- `docs/033-agentic-chat/001-fts-on-session-embeddings.sql`
- `docs/033-agentic-chat/002-match-session-embeddings-fts-rpc.sql`
- `docs/033-agentic-chat/eval/queries.json`
- `docs/033-agentic-chat/eval/judge-prompt.ts`
- `docs/033-agentic-chat/eval/.gitignore` (excludes `reports/`)
- `lib/services/chat-tools/index.ts`
- `lib/services/chat-tools/shared/tool-context.ts`
- `lib/services/chat-tools/shared/status-events.ts`
- `lib/services/chat-tools/list-clients-tool.ts`
- `lib/services/chat-tools/list-sessions-tool.ts`
- `lib/services/chat-tools/list-themes-tool.ts`
- `lib/services/chat-tools/semantic-search-tool.ts`
- `lib/services/chat-tools/fetch-session-content-tool.ts`
- `lib/services/chat-tools/fetch-signals-tool.ts`
- `lib/services/chat-tools/aggregate-tool.ts`
- `lib/services/chat-tools/time-series-tool.ts`
- `lib/services/chat-tools/insights-latest-tool.ts`
- `lib/services/chat-tools/insights-history-tool.ts`
- `lib/services/chat-tool-services/discovery-service.ts`
- `lib/services/chat-tool-services/session-content-service.ts`
- `lib/services/chat-tool-services/signals-service.ts`
- `lib/services/chat-tool-services/aggregation-service.ts`
- `lib/services/chat-tool-services/insights-service.ts`
- `lib/services/retrieval-rrf.ts`
- `lib/services/retrieval-config.ts`
- `lib/services/token-estimator.ts`
- `scripts/run-eval.ts`

**Modified files:**
- `lib/repositories/embedding-repository.ts` — add `fullTextSearch`, `fetchBySessionIds`, `listSignals` methods (interface + Supabase impl).
- `lib/repositories/supabase/supabase-embedding-repository.ts` — implementations.
- `lib/repositories/session-repository.ts` — add `listForChat`, `fetchHeadersByIds`.
- `lib/repositories/supabase/supabase-session-repository.ts` — implementations.
- `lib/repositories/client-repository.ts` — add `listWithMetadata`.
- `lib/repositories/supabase/supabase-client-repository.ts` — implementation.
- `lib/repositories/theme-repository.ts` — add `listWithMetadata`.
- `lib/repositories/supabase/supabase-theme-repository.ts` — implementation.
- `lib/services/retrieval-service.ts` — switch from vector-only to hybrid via `rrfFuse`.
- `package.json` — add `eval:chat` script. Optional: add `tiktoken` (only if we decide to use real tokenizer for OpenAI in Part 1; otherwise defer).
- `ARCHITECTURE.md` — update file map, data model (new RPC + tsvector column), and Chat section with new tool registry note.
- `CHANGELOG.md` — Part 1 entry.

**Files explicitly NOT touched in Part 1:**
- `lib/services/chat-stream-service.ts` — old tools remain wired (P1.AC9).
- `lib/services/database-query/action-metadata.ts` and `execute-query.ts` — kept as-is until Part 3.
- `lib/prompts/chat-prompt.ts` — system prompt v2 lands in Part 3.
- `app/api/dashboard/route.ts` — dashboard's action surface unchanged.

---

### 1.10 Implementation Increments

Each increment is one PR. Each is verifiable on its own. Checked one at a time before moving to the next.

#### Increment 1.1 — DB migration: tsvector + FTS RPC

Lands the two SQL files (§ 1.1). Verified by a manual `psql` query against staging:
```sql
SELECT id, chunk_text, fts_rank
FROM match_session_embeddings_fts('snowflake', 5, '<team_id>', NULL, NULL, NULL, NULL, NULL);
```
Smoke test for backfill: `chunk_text_tsv` is non-null on existing rows (the generated column populates synchronously on `ALTER TABLE`).

#### Increment 1.2 — Embedding repo `fullTextSearch` + RRF + retrieval-service hybrid switch

Adds `fullTextSearch()` and `rrfFuse()`, switches `retrieveRelevantChunks()` to hybrid. The old `searchInsights` tool (still wired in Part 1) now silently benefits from hybrid retrieval — this is the only user-visible change in Part 1 that affects production traffic, and it's strictly additive. Verify by hand: an exact-term query like "Snowflake" that previously returned no semantic matches now surfaces the matching chunks. If a regression surfaces post-merge, the rollback is `git revert` of this increment; tuning is via the `RAG_*` env vars in [§ 1.3](#13-new-services).

#### Increment 1.3 — Repository extensions for sessions / clients / themes

Adds `listForChat`, `fetchHeadersByIds`, `listWithMetadata`. Pure data access; verifiable by hand-calling each repo from a one-off Node script.

#### Increment 1.4 — Discovery tool services + tools (`list_*`)

`discovery-service.ts` + the three tool factories. Tools are not yet wired into the chat surface. Verifiable by the eval runner with `--surface=new` (see Increment 1.8) once it lands; until then, by manual invocation.

#### Increment 1.5 — Retrieval tool services + tools (`semantic_search`, `fetch_session_content`, `fetch_signals`)

The hybrid `semantic_search` tool wraps the already-hybrid retrieval-service. `fetch_session_content` enforces the token budget. `fetch_signals` is strictly schema-filtered. All three not yet wired.

#### Increment 1.6 — Aggregation tool services + tools (`aggregate`, `time_series`)

`aggregation-service.ts` + the two tool factories. Internally delegates to existing domain modules. Parity test: for each row of the PRD's mapping table, hand-construct the equivalent old-action call and the new aggregate call, run both, assert results match (this is the basis for P1.AC4).

#### Increment 1.7 — Insights passthrough tools

Smallest increment. Two tools, one service file. Pure pass-through to the existing insights domain module.

#### Increment 1.8 — Eval harness + frozen test set + first reports

`scripts/run-eval.ts`, `queries.json` (≥15 queries, ≥3 exact-term), `judge-prompt.ts`. Run against both surfaces once, commit the two baseline reports as evidence (P1.AC10).

#### Increment 1.9 — End-of-Part-1 audit

Runs the audit checklist from [CLAUDE.md](../../CLAUDE.md#end-of-part-audit) across all files touched. Updates `ARCHITECTURE.md` and `CHANGELOG.md`. No new code; only fixes and doc updates from the audit. Closes Part 1.

---

### 1.11 Acceptance Criteria → Verification Map

Mapping each PRD acceptance criterion to where it's verified in Part 1.

| PRD AC | Verified by |
|---|---|
| P1.AC1 (each tool invocable) | Increments 1.4–1.7 (per-tool manual invocation) + Increment 1.8 (eval) |
| P1.AC2 (`list_sessions` lightweight only) | Increment 1.3: `ChatSessionRow` type does not include `parsed_content` / `structured_json` |
| P1.AC3 (`fetch_session_content` token-budget feedback) | Increment 1.5: explicit `budgetReached` field + `fetched`/`requested` counts |
| P1.AC4 (`aggregate` parity with retired actions) | Increment 1.6: parity test for each row of the mapping table |
| P1.AC5 (`time_series` parity) | Increment 1.6: same parity test for `sessions_over_time` and `theme_trends` |
| P1.AC6 (per-tool filter contracts) | § 1.5 schema table; enforced by Zod + per-tool factory |
| P1.AC7 (no `teamId` in inputs) | § 1.5 schemas; grep test in Increment 1.9 audit |
| P1.AC8 (model-friendly shapes) | § 1.6 result types; spot-checked in eval reports |
| P1.AC9 (old tools still wired) | § 1.9 explicit non-touch on `chat-stream-service.ts` |
| P1.AC10 (eval baseline + parity reports) | Increment 1.8 produces the two baseline JSON reports |
| P1.AC11 (hybrid retrieval works on exact-term queries) | Increment 1.2 manual verification + ≥3 exact-term queries in eval set |
| P1.AC12 (tool-routing accuracy as separate metric) | Increment 1.8: subsequence match in `run-eval.ts` |

---

### 1.12 Open Questions for Implementation

These are the only items where the PRD doesn't fully constrain the choice and the implementer should pick deliberately:

1. **Token estimator accuracy.** Decided: chars/4 proxy in Part 1, ±20% inaccuracy accepted (see [§ 1.3 token-budget enforcement](#13-new-services) for the full implications). Real tokenizers (tiktoken / Anthropic's `countTokens` / Google's helper) are deferred until eval evidence shows the imprecision costs us money or coverage. Architecture is aware: every consumer of `estimateTokens()` (the fetch-content budget in Part 1, the summarise-sessions fan-out in Part 2, the per-turn cost circuit breaker in Part 3) operates with this ±20% characteristic baked in.
2. **Severity / urgency persistence shape on chunks.** The retrieval RPC + `severity-filter.ts` already encode the canonical access pattern; whether the underlying field is `metadata->>'severity'` on `session_embeddings` or a JSONB path through `sessions.structured_json` is verified during Increment 1.3 and not changed by this TRD. If implementation discovers the canonical filter helper isn't reusable for the new `EXISTS` subquery shape, file a follow-up — don't fork the helper.

---

### 1.13 What Part 1 Explicitly Defers

- **System prompt v2** — Part 3.
- **Removal of old tools / `CHAT_TOOL_ACTIONS` / `buildChatToolDescription` / sanitisation layer** — Part 3.
- **Prompt caching** — Part 3.
- **Per-turn cost circuit breaker** — Part 3 (the per-tool-result token estimate from § 1.6 is the data source).
- **Map-reduce summarisation tool** — Part 2.
- **Reranker** — backlog.

End of Part 1.
