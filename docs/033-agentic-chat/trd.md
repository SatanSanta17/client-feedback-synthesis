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

---

## Part 2: Map-Reduce Summarisation Tool

> **Status:** Draft. Mirrors PRD Part 2.
> **Depends on:** Part 1 shipped (the new tools, ChatQueryRepository, EmbeddingRepository extensions, hybrid retrieval, and `estimateTokens` are all live; the new tool registry exists but is not yet wired to the chat model — that swap is Part 3).

### Architectural Direction

The `summarise_sessions` tool is the **only new user-facing capability** in Part 2 — every other piece of work in this part exists to support it: a separate cheap-model resolver, a bounded-concurrency primitive, a versioned summarisation prompt, status-event progress updates. The tool fans out per-session summaries to a cheaper model and returns the digest array to the chat model without ever holding all N sessions' content in the chat model's context.

**Industry-standard patterns adopted:**
- **Map-reduce with cheap leaves and premium reduce.** Anthropic's contextual-retrieval reference implementation, OpenAI's deep research mode, and ChatGPT's "summarise this whole document" feature all use the same pattern: small model on the leaves (Haiku / 4o-mini / Gemini Flash), large model on the synthesis. Cost savings on broad queries are typically 10–30× depending on which model pair you pick.
- **Independent provider/model env vars for the cheap step.** Mirroring PRD-032 Part 2 (transcription has its own `AI_TRANSCRIPTION_PROVIDER` / `AI_TRANSCRIPTION_MODEL`); the chat model and the cheap-model are separately wired so each can be tuned in isolation. The PRD explicitly forbids implicit fallback from one to the other (P2.R2).
- **Bounded concurrency via a small DIY semaphore** rather than the `p-limit` npm package. 20 lines of code, no new dependency, no version-skew risk. `p-limit` is a fine library; we just don't need a dependency for this.
- **Per-session error isolation** — one failed leaf does not abort the batch (P2.R5). Returns `{ summary: null, error }` for the failed entry so the chat model can mention partial coverage.
- **Streaming status events** for user-perceived latency. Existing pipeline (`emitStatus` on `ChatToolContext`) handles per-batch progress updates without UI changes (P2.R6 / P2.R8).
- **No persistence of leaf summaries** (P2.R7). Token-usage telemetry only.

**Forward-compat for Part 3:** the cheap-model resolver and per-call telemetry are set up so the per-turn cost circuit breaker (Part 3 P3.R10) sees `summarise_sessions`'s tool-result tokens like any other tool. The `recordToolResultTokens` hook earmarked in Part 1's `ChatToolContext` still applies — `summarise_sessions` returns a small array of digests to the chat model, so its *tool-result* size is small even when N is large.

---

### 2.1 New Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SUMMARY_AI_PROVIDER` | (required) | Cheap-model provider for the map step. Must be configured separately from `AI_PROVIDER` — no fallback. |
| `SUMMARY_AI_MODEL` | (required) | Cheap-model id (e.g. `claude-haiku-4-5-20251001`, `gpt-4o-mini`, `gemini-flash-2.0`). |
| `SUMMARY_AI_MAX_OUTPUT_TOKENS` | `200` | Per-leaf cap. ~3 sentences fits comfortably; raises sets a ceiling on cost per session. |
| `SUMMARY_AI_FANOUT_CAP` | `50` | Max session ids per `summarise_sessions` call (P2.R4). Count cap, not token-budget cap — see PRD § P2.R4 rationale. |
| `SUMMARY_AI_CONCURRENCY` | `5` | Parallel leaves in flight at once (P2.R5). |

`SUMMARY_AI_PROVIDER` and `SUMMARY_AI_MODEL` are required-on-startup *only when* `summarise_sessions` is exercised. We do not fail boot — instead, the resolver throws a clear `SummaryProviderConfigError` the first time the tool runs without these set, mirroring how `EMBEDDING_PROVIDER` is validated lazily in `embedding-service.ts`.

ARCHITECTURE.md env table updated as part of Increment 2.6.

---

### 2.2 New Service: Cheap-Model Resolver

#### `lib/services/cheap-model-service.ts`

Mirrors `resolveModel()` in `ai-service.ts` but reads from `SUMMARY_*` env vars and returns a `LanguageModel` instance plus a label.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export class SummaryProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummaryProviderConfigError";
  }
}

const PROVIDER_MAP: Record<string, (modelId: string) => LanguageModel> = {
  anthropic: (id) => anthropic(id),
  openai: (id) => openai(id),
  google: (id) => google(id),
};

export function resolveCheapModel(): { model: LanguageModel; label: string } {
  const provider = process.env.SUMMARY_AI_PROVIDER;
  const modelId = process.env.SUMMARY_AI_MODEL;
  if (!provider) {
    throw new SummaryProviderConfigError(
      "SUMMARY_AI_PROVIDER is not set — required for summarise_sessions tool. Cheap-model and chat-model env vars are deliberately independent (no fallback)."
    );
  }
  if (!modelId) {
    throw new SummaryProviderConfigError(
      "SUMMARY_AI_MODEL is not set — required for summarise_sessions tool."
    );
  }
  const factory = PROVIDER_MAP[provider];
  if (!factory) {
    throw new SummaryProviderConfigError(
      `Unsupported SUMMARY_AI_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }
  return { model: factory(modelId), label: `${provider}/${modelId}` };
}
```

The chat model (`resolveModel()` in `ai-service.ts`) is **never** used in the map step, and `resolveCheapModel()` is **never** used in the reduce step. PRD P2.R2 — enforced by use site, not by type. Reviewers verify in PR.

#### `withCheapModelRetry` helper (same file)

A retry wrapper for the leaf `generateText` calls, mirroring the existing `withEmbeddingRetry` in [`embedding-service.ts`](../../lib/services/embedding-service.ts):

```ts
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

export async function withCheapModelRetry<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Config errors are non-retryable
      if (err instanceof SummaryProviderConfigError) throw err;

      // The Vercel AI SDK exposes status on its error subclasses
      // (APICallError, RateLimitError); inspect via duck-typing to stay
      // provider-agnostic.
      const statusCode = readStatusCode(err);

      // Don't retry 4xx other than 429
      if (
        statusCode !== undefined &&
        statusCode < 500 &&
        statusCode !== 429
      ) {
        console.error(
          `[cheap-model] ${operationName} — client error (${statusCode}, not retrying):`,
          lastError.message
        );
        throw lastError;
      }

      if (attempt >= MAX_RETRIES) {
        console.error(
          `[cheap-model] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      // Honour Retry-After for 429 when present, otherwise exponential backoff.
      const retryAfterMs =
        statusCode === 429 ? readRetryAfterMs(err) : null;
      const delay =
        retryAfterMs ?? INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);

      console.warn(
        `[cheap-model] ${operationName} — retryable error (status: ${statusCode ?? "?"}, attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`${operationName} failed`);
}
```

`readStatusCode(err)` and `readRetryAfterMs(err)` are small private helpers that duck-type across the AI SDK's error subclasses (`APICallError`, `RateLimitError`, the per-provider error types). Living next to the resolver — not in `ai-service.ts` — because the retry semantics for the cheap model (smaller batches, higher concurrency) may diverge from the chat model's needs over time.

---

### 2.3 New Service: Bounded Concurrency Primitive

#### `lib/services/bounded-concurrency.ts`

A small semaphore. Used to run leaf summaries in parallel while capping in-flight count.

```ts
/**
 * Runs `tasks` in parallel with a max of `concurrency` running at any time.
 * Each task is a function that returns a promise. Results are returned in
 * input order. Errors do NOT abort the batch — they're returned as a
 * `{ ok: false, error }` per-row so the caller can mark partial coverage.
 */
export type TaskResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<TaskResult<T>[]> {
  const results: TaskResult<T>[] = new Array(tasks.length);
  let next = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { ok: true, value };
      } catch (err) {
        results[i] = {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      } finally {
        completed += 1;
        onProgress?.(completed, tasks.length);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
```

Pure function, no Supabase / no AI imports — testable in isolation.

---

### 2.4 New Prompt: `lib/prompts/summarise-session-prompt.ts`

Versioned, committed alongside other prompts. The cheap model receives the session content + an optional focus string, and returns one short summary.

```ts
export const SUMMARISE_SESSION_PROMPT_VERSION = "v1";

export const SUMMARISE_SESSION_SYSTEM_PROMPT = `You produce short summaries of a single client feedback session. You receive structured session content (signals across categories: pain points, requirements, aspirations, positive signals, blockers, competitive mentions, etc.) plus optional client + date metadata. You return a concise summary suitable for downstream synthesis by another model.

Rules:
- Default mode (no focus): return exactly 3 sentences capturing the session's most important pain points, requirements, and overall sentiment. Balanced; do not over-index on any single signal type.
- Focus mode (focus string supplied): extract only content relevant to the focus topic. If no content matches the focus, return the literal sentence: "No content matches focus." — exact wording, no quotation marks added, nothing else.
- Do NOT invent details. If a signal type is empty in the input, do not mention it.
- Do NOT include conversational text, headings, or bullet points. Plain prose only.
- Do NOT exceed 3 sentences in default mode, or 4 sentences in focus mode.
- The output is read by another model — clarity and grounding matter more than rhetorical polish.`;

export const SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT = 200;

/**
 * Renders the user-message body for one leaf invocation.
 * `sessionContent` is the SessionContent object produced by Part 1's
 * fetch_session_content service.
 */
export function renderSummariseSessionUser(
  sessionContent: unknown,
  focus?: string
): string {
  const focusBlock = focus
    ? `\n\nFocus: ${focus}\nReturn only content relevant to this focus, or "No content matches focus." if none.`
    : `\n\nNo focus specified. Return a balanced 3-sentence digest.`;
  return `Session content (JSON):\n${JSON.stringify(sessionContent, null, 2)}${focusBlock}`;
}
```

Versioning rule: changing the system prompt bumps `SUMMARISE_SESSION_PROMPT_VERSION`. The eval harness records the version with each report so behaviour drift is traceable.

---

### 2.5 New Service: Summarise-Sessions

#### `lib/services/chat-tool-services/summarise-sessions-service.ts`

Public function `summariseSessions(input, deps)`. Uses Part 1's `fetchSessionContent` to get the per-session payload (workspace-scoped, deleted-aware) and the new cheap-model resolver to produce per-session summaries.

```ts
import { generateText } from "ai";

import { resolveCheapModel } from "@/lib/services/cheap-model-service";
import { runWithConcurrency } from "@/lib/services/bounded-concurrency";
import {
  SUMMARISE_SESSION_SYSTEM_PROMPT,
  SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT,
  renderSummariseSessionUser,
} from "@/lib/prompts/summarise-session-prompt";
import { fetchSessionContent } from "./session-content-service";
import { estimateTokens } from "@/lib/services/token-estimator";

const FANOUT_CAP = parseInt(process.env.SUMMARY_AI_FANOUT_CAP ?? "50", 10);
const CONCURRENCY = parseInt(process.env.SUMMARY_AI_CONCURRENCY ?? "5", 10);
const MAX_OUTPUT = parseInt(
  process.env.SUMMARY_AI_MAX_OUTPUT_TOKENS ??
    String(SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT),
  10
);

export interface SummariseInput {
  sessionIds: string[];
  focus?: string;
}

export interface SummaryRow {
  sessionId: string;
  clientName: string;
  date: string;
  summary: string | null;
  error?: string;
}

export interface SummariseResult {
  summaries: SummaryRow[];
  summarised: number;
  requested: number;
  /**
   * True when more session ids were passed than this service's fan-out cap
   * (`SUMMARY_AI_FANOUT_CAP`, default 50). The slice that wasn't processed
   * is up to the chat model to paginate.
   */
  capReached: boolean;
  /**
   * True when the upstream `fetchSessionContent` token budget
   * (`CHAT_FETCH_CONTENT_BUDGET`, default 50k) was exhausted before all
   * fan-out-cap-allowed ids could be loaded. Distinct from `capReached`:
   * - `capReached=true, budgetReached=false` → chat model passed > 50 ids
   * - `capReached=false, budgetReached=true`  → < 50 ids but content too big
   * - both true                                → both limits hit
   */
  budgetReached: boolean;
  /**
   * Sessions the chat model asked about that weren't in the active
   * workspace (filtered by RLS / workspace scope). Distinguishes "filtered
   * out before processing" from "leaf summary failed" — the chat model
   * mentions partial coverage differently for each.
   */
  outOfScopeCount: number;
  /** Aggregate cheap-model telemetry — not persisted, logged only. */
  telemetry: {
    cheapModelLabel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    failedCount: number;
    durationMs: number;
  };
}

export async function summariseSessions(
  input: SummariseInput,
  deps: {
    chatQueryRepo: import("@/lib/repositories/chat-query-repository").ChatQueryRepository;
    embeddingRepo: import("@/lib/repositories/embedding-repository").EmbeddingRepository;
    workspace: { teamId: string | null; userId: string };
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<SummariseResult> {
  const requested = input.sessionIds.length;
  const ids = input.sessionIds.slice(0, FANOUT_CAP);
  const capReached = requested > FANOUT_CAP;

  // Fetch full content via Part 1's service. The cheap model receives this
  // payload one session at a time — content never crosses into the chat
  // model's context.
  const contentResult = await fetchSessionContent(ids, {
    chatQueryRepo: deps.chatQueryRepo,
    embeddingRepo: deps.embeddingRepo,
    workspace: deps.workspace,
  });

  const start = Date.now();
  const { model, label } = resolveCheapModel();

  // System prompt is sent on every leaf call. Count it once × N for an
  // honest input-token total; otherwise we'd under-count by ~300 tokens
  // per leaf (15k on a 50-session call).
  const systemTokens = estimateTokens(SUMMARISE_SESSION_SYSTEM_PROMPT);
  let inputTokens = systemTokens * contentResult.sessions.length;
  let outputTokens = 0;

  const tasks = contentResult.sessions.map((session) => async () => {
    const userMsg = renderSummariseSessionUser(session, input.focus);
    inputTokens += estimateTokens(userMsg);
    // Wrap generateText in the same retry pattern used by embedding-service:
    // 3 retries with exponential backoff (1s, 2s, 4s); honour Retry-After
    // for 429s; no retry for 4xx other than 429. Failures after the retry
    // budget propagate to runWithConcurrency, which captures them as
    // per-row TaskResult errors (not aborting the batch).
    const { text, usage } = await withCheapModelRetry(
      `summarise-session ${session.sessionId}`,
      () =>
        generateText({
          model,
          system: SUMMARISE_SESSION_SYSTEM_PROMPT,
          prompt: userMsg,
          maxOutputTokens: MAX_OUTPUT,
        })
    );
    outputTokens += usage?.outputTokens ?? estimateTokens(text);
    return {
      sessionId: session.sessionId,
      clientName: session.clientName,
      date: session.sessionDate,
      summary: text.trim(),
    } satisfies SummaryRow;
  });

  const taskResults = await runWithConcurrency(
    tasks,
    CONCURRENCY,
    deps.onProgress
  );

  const summaries: SummaryRow[] = contentResult.sessions.map((session, i) => {
    const r = taskResults[i];
    if (r?.ok) return r.value;
    // Sanitise: log the raw error server-side, return a generic message to
    // the chat model. Provider-specific details (auth keys, internal URLs,
    // stack traces) must not surface to the LLM context.
    if (r && r.ok === false) {
      console.error(
        `[summarise-sessions-service] leaf failed — session ${session.sessionId}:`,
        r.error
      );
    }
    return {
      sessionId: session.sessionId,
      clientName: session.clientName,
      date: session.sessionDate,
      summary: null,
      error: "summary unavailable for this session",
    };
  });

  const failedCount = summaries.filter((s) => s.summary === null).length;

  // Sessions the chat model asked about that we never even tried to
  // summarise — filtered out by workspace scope inside fetchSessionContent
  // (RLS / personal-workspace check). Distinct from `failedCount` (leaves
  // that ran and failed) and from `capReached` (slice that we deliberately
  // never sent to fetch).
  const outOfScopeCount =
    Math.min(requested, FANOUT_CAP) - contentResult.fetched;

  return {
    summaries,
    summarised: summaries.length,
    requested,
    capReached,
    budgetReached: contentResult.budgetReached,
    outOfScopeCount,
    telemetry: {
      cheapModelLabel: label,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      failedCount,
      durationMs: Date.now() - start,
    },
  };
}
```

**Notes on the implementation:**
- **Cap + budget interaction.** `fetchSessionContent` enforces its own token budget. The result reports four distinct partial-coverage signals: `capReached` (fan-out cap, > 50 ids passed), `budgetReached` (fetch_session_content token budget exhausted before all cap-allowed ids loaded), `outOfScopeCount` (ids filtered out by workspace scope before processing), and per-row `error` (leaf summary failed despite retries). The chat model uses these to phrase partial-coverage messages accurately ("I summarised 30 of the 50 you asked for; 18 were over the per-call cap, 2 weren't in your workspace").
- **Retry wrapper for cheap-model calls.** `withCheapModelRetry(opName, fn)` mirrors the existing `withEmbeddingRetry` pattern in [`lib/services/embedding-service.ts`](../../lib/services/embedding-service.ts): 3 retries with exponential backoff (1s, 2s, 4s); 429s honour the `Retry-After` header when present; 4xx other than 429 do not retry. Implemented as a small helper inside `cheap-model-service.ts` so the AI-SDK error-shape interpretation lives next to the resolver. Retry exhaustion propagates to `runWithConcurrency`, which captures the error as a per-row `TaskResult.error` — the batch keeps going.
- **No content retention (P2.R7).** The `SummaryRow.summary` strings are returned to the caller and never written to a persistent store. Audit logging (`telemetry` field + console.log lines) captures token counts, not content.
- **Per-row `error` is sanitised.** The model-facing `error` field is always a generic message (`"summary unavailable for this session"`). Raw provider errors (auth failures, stack traces, internal URLs) are logged server-side via `console.error`, never sent to the chat model. This is a one-way containment of provider details.
- **System prompt token-count is included.** `inputTokens = estimateTokens(SYSTEM_PROMPT) * N + Σ estimateTokens(userMsg_i)` so cost telemetry doesn't quietly under-count the ~300 tokens of system prompt sent on every leaf call. Still ±20% per the chars/4 proxy, but no longer biased low by an extra ~600 tokens / 30 sessions.
- **[fwd-compat for Part 3]** `telemetry` is the data source for the per-turn cost circuit breaker. It will sum `totalTokens` across all `summarise_sessions` calls in a turn (alongside other tools' result tokens) against the budget.

---

### 2.6 New Tool: `lib/services/chat-tools/summarise-sessions-tool.ts`

```ts
import { tool } from "ai";
import { z } from "zod";

import { summariseSessions } from "@/lib/services/chat-tool-services/summarise-sessions-service";

import type { ChatToolContext } from "./shared/tool-context";

const inputSchema = z.object({
  sessionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(200)
    .describe(
      "List of session ids (UUIDs) to summarise. Get these from list_sessions. The fan-out cap (default 50) caps actual processing — the schema cap of 200 only prevents extreme inputs."
    ),
  focus: z
    .string()
    .optional()
    .describe(
      "Optional topic focus (e.g. 'pricing complaints', 'feature requests'). When set, each per-session summary is scoped to this topic; sessions with no matching content come back with the sentinel 'No content matches focus.'. OMIT for a balanced 3-sentence digest per session."
    ),
});

export function createSummariseSessionsTool(ctx: ChatToolContext) {
  return tool({
    description:
      "Summarise N sessions without holding all N in chat-model context. Fans out per-session summaries to a cheaper model, returns a digest array (sessionId, clientName, date, summary). " +
      "Use this for broad multi-session synthesis: 'summarise everything Acme said this quarter', 'what changed in our top theme between Q1 and Q2'. " +
      "Prefer this over fetch_session_content when N > ~10 — it's cheaper and avoids context bloat. " +
      "Capped at 50 sessions per call (default); pass paged ids for larger sets. " +
      "Sessions whose individual summary fails come back with summary=null + error — partial coverage is normal, mention it in your reply when it happens.",
    inputSchema,
    execute: async (input) => {
      ctx.emitStatus(`Summarising ${input.sessionIds.length} session(s)…`);
      const result = await summariseSessions(input, {
        chatQueryRepo: ctx.chatQueryRepo,
        embeddingRepo: ctx.embeddingRepo,
        workspace: ctx.workspace,
        onProgress: (done, total) => {
          // Throttle progress emits — every 10% or every 5 sessions, whichever
          // is smaller. Avoids hammering the SSE stream on fast batches.
          const stride = Math.max(Math.ceil(total / 10), 5);
          if (done === total || done % stride === 0) {
            ctx.emitStatus(`Summarising sessions… (${done}/${total})`);
          }
        },
      });
      console.log(
        `[summarise-sessions-tool] complete — summarised: ${result.summarised}, failed: ${result.telemetry.failedCount}, model: ${result.telemetry.cheapModelLabel}, tokens(in/out/total): ${result.telemetry.inputTokens}/${result.telemetry.outputTokens}/${result.telemetry.totalTokens}, duration: ${result.telemetry.durationMs}ms`
      );
      // Strip telemetry from the model-facing payload — the chat model
      // gets the digest array + every partial-coverage signal it needs to
      // phrase a partial-coverage message accurately. Telemetry is internal
      // observability only.
      return {
        summaries: result.summaries,
        summarised: result.summarised,
        requested: result.requested,
        capReached: result.capReached,
        budgetReached: result.budgetReached,
        outOfScopeCount: result.outOfScopeCount,
      };
    },
  });
}
```

Tool description leans heavily on **when to use** vs **when to prefer fetch_session_content** — this is the primary lever for keeping tool-routing accuracy high in the eval (P1.R9).

---

### 2.7 Tool Registry Update

#### `lib/services/chat-tools/index.ts`

```ts
import { createSummariseSessionsTool } from "./summarise-sessions-tool";

export function createChatTools(ctx: ChatToolContext) {
  return {
    list_clients: createListClientsTool(ctx),
    list_sessions: createListSessionsTool(ctx),
    list_themes: createListThemesTool(ctx),
    semantic_search: createSemanticSearchTool(ctx),
    fetch_session_content: createFetchSessionContentTool(ctx),
    fetch_signals: createFetchSignalsTool(ctx),
    aggregate: createAggregateTool(ctx),
    time_series: createTimeSeriesTool(ctx),
    summarise_sessions: createSummariseSessionsTool(ctx),  // <-- new
    insights_latest: createInsightsLatestTool(ctx),
    insights_history: createInsightsHistoryTool(ctx),
  } as const;
}
```

`ChatToolContext` is unchanged — `summarise_sessions` reuses the existing `chatQueryRepo` and `embeddingRepo` (via `fetchSessionContent`) and resolves the cheap model lazily inside the service. **No new field is added to the context** because the resolver is pulled from `process.env` at call time, not injected. This is consistent with how `resolveModel()` is used elsewhere (`retrieval-service.ts`'s classification step does the same).

> Earlier TRD § 1.4 said "Part 2 will add `cheapModel: LanguageModel` to the context". That was a forward-compat hypothesis. Implementation lands the resolver inside the service for two reasons: (a) it keeps the context bag small and avoids threading model objects through 11 tools that don't use them; (b) the cheap model is only needed by `summarise_sessions`, so paying the construction cost (one `anthropic(modelId)` factory call per turn) for every turn — even those that never invoke `summarise_sessions` — is wasted work.

---

### 2.8 Telemetry

Per-call log line on tool exit (already in the tool factory above):

```
[summarise-sessions-tool] complete — summarised: 23, failed: 1, model: anthropic/claude-haiku-4-5-20251001, tokens(in/out/total): 18432/4567/22999, duration: 6743ms
```

Three concerns kept distinct:
1. **Cheap-model telemetry** — input / output / total tokens, duration, model label, failed count. Logged on every call (P2.AC7).
2. **Chat-model telemetry** — unchanged; `chat-stream-service.ts` continues to emit its existing `[chat-stream-service] chat-complete` line for the chat-model side.
3. **Eval telemetry** — the `summarised`, `requested`, `capReached`, and per-row `error` fields are visible to the eval runner via the tool result shape.

No persistent store writes (P2.R7). Audit log lines are sufficient because the existing observability surface (Vercel / Supabase logs) captures them.

---

### 2.9 Eval Coverage Extension (P2.R9)

Append 10 new queries to `docs/033-agentic-chat/eval/queries.json`. Each carries the existing fields (`id`, `category`, `query`, `expectedTrajectory`, `rubric`) plus a new optional `partOf: "P2"` flag so the runner can report Part-2-specific pass rate separately from the Part-1 baseline (PRD P2.R9: "the new surface's pass rate on these is tracked separately").

| New ID | Category | What it exercises |
|---|---|---|
| Q-017 | hybrid | Canonical gap-closer: "Summarise everything Acme has told us this quarter" — expectedTrajectory: `list_sessions → summarise_sessions` |
| Q-018 | hybrid | Focus-scoped: "Summarise pricing-related feedback across all clients last 90 days" — expectedTrajectory: `list_sessions → summarise_sessions` (with focus param expected on the call) |
| Q-019 | hybrid | Comparative: "What changed in our top theme between Q1 and Q2?" — expectedTrajectory: `aggregate → list_sessions → summarise_sessions` (×2: once per quarter) |
| Q-020 | hybrid | Broad fan-out (>30 sessions): "Give me a rundown of every session this year" — expectedTrajectory: `list_sessions → summarise_sessions` (cap exercised; expects `capReached: true`) |
| Q-021 | hybrid | Pagination: follow-up to Q-020 — "Show me the rest" — expectedTrajectory: `list_sessions → summarise_sessions` with paged ids |
| Q-022 | hybrid | Small-batch focus: "Summarise the last 5 sessions, focusing on positive feedback only" — small fan-out with focus; exercises the "No content matches focus." sentinel naturally (sessions without positive_signal chunks should produce it) |
| Q-023 | qualitative | Focus + no-match: "What did Acme say about competitor X?" where Acme never mentioned X — expects "No content matches focus." for at least one returned row |
| Q-024 | quantitative | Negative test: "How many sessions do we have?" — expectedTrajectory: `aggregate` (must NOT chain summarise_sessions; routing-accuracy regression if it does) |
| Q-025 | hybrid | Focus rephrasing: "What are the top product complaints across our enterprise clients?" — verifies the model picks `summarise_sessions` (not `semantic_search`) for completeness across many sessions |
| Q-026 | hybrid | Cost test: "Summarise our 50 most recent sessions" — produces a baseline cost report for the broad-summary test (PRD P3.AC6 input) |

> **Partial-failure tolerance (P2.AC5) is verified manually, not in the automated eval.** The TRD originally proposed a synthetic Q-022 that injects a known-bad session id, but in production data there is no deterministic way to make a single leaf fail without adding a debug-only failure-injection mechanism — which itself becomes a test surface to maintain. Cleaner path: hand-verify the partial-failure code path during Increment 2.4 by passing an obviously-malformed input to one leaf (e.g. truncating a session's content to an empty string and confirming the leaf either returns a degenerate summary or fails into a per-row `error: "summary unavailable for this session"` while the batch keeps going). This is recorded in the increment's verification notes; P2.AC5's "without aborting the batch" property is structural and only needs to be verified once. This is a small, deliberate deviation from PRD § P2.R9 ("partial-failure tolerance" listed among the eval exercises), justified by the cost/benefit of adding an injection-only test mechanism vs. one-time manual verification.

Runner update (`scripts/run-eval.ts`):
- Aggregate report gains a `partOfBreakdown: { P1: {...}, P2: {...} }` field that buckets answer-correctness avg + routing-accuracy pct per `partOf` flag (queries without the flag fall under P1).
- The cost-test query (Q-026) writes `tokens(in/out/total)` from the tool's telemetry into the per-query report so the broad-summary cost reduction target (P3.AC6: ≥ 30% vs hypothetical premium-only `fetch_session_content`) is measurable.

---

### 2.10 Files Changed (Part 2)

**New files:**
- `lib/services/cheap-model-service.ts`
- `lib/services/bounded-concurrency.ts`
- `lib/prompts/summarise-session-prompt.ts`
- `lib/services/chat-tool-services/summarise-sessions-service.ts`
- `lib/services/chat-tools/summarise-sessions-tool.ts`

**Modified files:**
- `lib/services/chat-tools/index.ts` — register `summarise_sessions` in `createChatTools()`.
- `docs/033-agentic-chat/eval/queries.json` — add Q-017 through Q-026 (10 new queries).
- `scripts/run-eval.ts` — `partOfBreakdown` aggregation; cost-test telemetry passthrough.
- `ARCHITECTURE.md` — add new env vars (`SUMMARY_*`), file map entries for new files.
- `CHANGELOG.md` — Part 2 entry.

**Files explicitly NOT touched:**
- `lib/services/chat-stream-service.ts` — old surface remains the active wiring through Part 2 (Part 3 cutover).
- `lib/prompts/chat-prompt.ts` — system prompt v2 is Part 3.
- `app/api/dashboard/route.ts` — dashboard surface unchanged.
- Any UI files — P2.R8.

---

### 2.11 Implementation Increments

#### Increment 2.1 — Cheap-model resolver + env vars

`cheap-model-service.ts` + ARCHITECTURE.md env table updates. No call site yet. Verifiable by a one-off script that constructs the model and runs a one-shot `generateText` against a known cheap model; not a permanent test.

#### Increment 2.2 — Bounded-concurrency primitive

`bounded-concurrency.ts`. Pure function, easy to verify by hand: pass an array of `() => sleep(N)` tasks and assert the wall time scales correctly. No tests committed yet (the project has no test infrastructure — see Part 1 § 1.7 note).

#### Increment 2.3 — Summarise-session prompt

`summarise-session-prompt.ts`. Versioned constants. No call site yet — verified by Increment 2.4.

#### Increment 2.4 — Summarise-sessions service

`summarise-sessions-service.ts`. End-to-end: provided test session ids, real cheap-model env vars, real Supabase. Hand-verified by running the service from a one-off script. Confirms:
- token telemetry sums correctly (system prompt × N + user msg × N + cheap-model `usage.outputTokens` per leaf)
- cap + budget + out-of-scope interaction with `fetchSessionContent` produces the four-flag combined feedback expected by § 2.5
- **partial-failure tolerance (P2.AC5)** — manually triggered by truncating one session's content to an empty string before passing to the cheap model (or by deliberately mis-configuring the cheap-model env vars for one in-flight leaf). Confirm the per-row error path: the failing leaf returns `summary: null + error: "summary unavailable for this session"`, the rest of the batch completes, no provider details leak into the chat-model-facing payload, and the raw error is logged server-side. The verification notes for this increment record the exact reproduction recipe so it's repeatable.

#### Increment 2.5 — Summarise-sessions tool + registry

`summarise-sessions-tool.ts` + registry update. Tool is registered but still not exposed to the chat model (the registry is built but `chat-stream-service.ts` doesn't consume it until Part 3). Verifiable by the eval runner with `--surface=new` once Increment 2.6 lands.

#### Increment 2.6 — Eval coverage + cost-test report

10 new queries appended to `queries.json`. `scripts/run-eval.ts` gains `partOfBreakdown` and cost-test telemetry passthrough. Run `npm run eval:chat -- --surface=new` and commit the resulting report alongside the Part 1 baselines (P2.AC9 + cost report for P3.AC6).

#### Increment 2.7 — End-of-Part-2 audit

Run the audit checklist from [CLAUDE.md](../../CLAUDE.md#end-of-part-audit) across all files touched. Update `ARCHITECTURE.md` (file map + env table + Chat tool surface paragraph: add `summarise_sessions` to the registry list). `CHANGELOG.md` Part 2 entry. Verify no regressions in Part 1 increments (run baseline eval against old surface, confirm pass rate unchanged).

---

### 2.12 Acceptance Criteria → Verification Map

| PRD AC | Verified by |
|---|---|
| P2.AC1 (`summarise_sessions` tool exists, returns one summary per id, input order preserved) | Increment 2.5 (tool factory + registry); Increment 2.4 verifies order-preservation by indexing `taskResults` by input position |
| P2.AC2 (cheap model env-controlled, independent of chat) | Increment 2.1: `resolveCheapModel()` reads only `SUMMARY_*`; chat-model env vars never consulted in the map step |
| P2.AC3 (focus-scoped, "no content matches focus" sentinel) | Increment 2.3 (prompt) — sentinel is a literal sentence in the system prompt; Increment 2.6 eval Q-023 exercises it |
| P2.AC4 (per-call cap with "summarised N of M requested" indicator) | Increment 2.4 — `requested` / `summarised` / `capReached` / `budgetReached` / `outOfScopeCount` fields in the result shape; Increment 2.6 eval Q-020 exercises cap |
| P2.AC5 (per-row error without aborting batch) | Increment 2.2 (`runWithConcurrency` returns `TaskResult<T>` not `T[]`) + Increment 2.4 (per-row error mapping + sanitised error message). **Verified manually during Increment 2.4** (see § 2.9 deviation note) — adding an injection-only test surface to the eval was rejected as cost-out-of-line with the structural property being verified |
| P2.AC6 ("Summarising N sessions…" status) | Increment 2.5 — `ctx.emitStatus` at start + throttled progress emits |
| P2.AC7 (per-call telemetry input/output/total tokens) | Increment 2.4 — telemetry field; Increment 2.5 — log line on tool exit |
| P2.AC8 (no persistent store writes) | Increment 2.4 — service is read-only; explicit absence of any Supabase write call (verified by grep in audit) |
| P2.AC9 (10 summarisation queries; new-surface pass rate tracked separately) | Increment 2.6 — `queries.json` extended; runner emits `partOfBreakdown` |

---

### 2.13 Open Implementation Questions

These are the only decisions where the PRD doesn't fully constrain the choice and the implementer should pick deliberately:

1. **Progress event throttling.** The tool factory above throttles to "every 10% or every 5 sessions, whichever is smaller". This is a UX choice — too quiet feels stuck, too chatty floods the SSE stream. If real-traffic feedback shows either failure mode, retune in a follow-up. Default is biased slightly toward chatty (every 5 sessions on small batches).
2. **`generateText` `usage` field availability.** The Vercel AI SDK exposes `usage` per provider; some return `inputTokens` / `outputTokens` directly, others return totals only. The service falls back to `estimateTokens(text)` when `usage.outputTokens` is absent. Input tokens are estimated end-to-end via the `estimateTokens` proxy (system prompt × N + user msg × N) for provider-agnosticism. This means the per-call telemetry inherits the same ±20% characteristic as `fetch_session_content`'s budget. Acceptable for telemetry and rough cost reporting; not for billing reconciliation.
3. **What "balanced 3-sentence digest" means** for sessions whose extraction is sparse (e.g. a session with only one chunk). The prompt says "if a signal type is empty, do not mention it" — for very sparse sessions the leaf may return a 1-sentence summary. The chat model handles this gracefully because it sees the full digest array. No special handling.

#### Resolved during TRD review (2026-05-11)

- **`budgetReached` propagation.** Resolved — `SummariseResult` now carries `budgetReached`, `outOfScopeCount`, plus `capReached`. All four partial-coverage signals are passed through to the chat model. See § 2.5.
- **Rate-limit retry behaviour.** Resolved — `withCheapModelRetry` mirrors the embedding-service retry pattern: 3 retries, exponential backoff, Retry-After honoured for 429. Lives in `cheap-model-service.ts`. See § 2.2.
- **Q-022 partial-failure test mechanism.** Resolved — Q-022 replaced with a small-batch focus query that exercises the "No content matches focus." sentinel naturally. Partial-failure tolerance (P2.AC5) is verified manually during Increment 2.4 with a documented reproduction recipe; rationale in § 2.9 deviation note.
- **System prompt token-count.** Resolved — counted as `estimateTokens(SYSTEM_PROMPT) * N` so cost telemetry doesn't quietly under-count by ~600 tokens / 30 sessions. See § 2.5.
- **Leaf error message sanitisation.** Resolved — model-facing `error` is the generic `"summary unavailable for this session"`; raw provider errors logged server-side via `console.error`. See § 2.5.
- **`requested` vs `outOfScopeCount` distinction.** Resolved — the result now distinguishes "asked but filtered by workspace scope before processing" (`outOfScopeCount`) from "leaf summary failed despite retries" (`telemetry.failedCount` + per-row `summary: null + error`). See § 2.5.

---

### 2.14 What Part 2 Explicitly Defers

- **Streaming the map step.** The current implementation waits for the full batch before returning to the chat model. Streaming per-session summaries as they complete is in the PRD backlog and is a significant UX win on broad queries (the chat model could start writing its synthesis before all leaves return). Deferred — it requires a different chat-stream-service integration shape (sub-stream emission within a tool execute) that's not justified by current usage.
- **Cheap-model fallback to the chat model when the cheap model is unavailable.** Explicitly forbidden by PRD P2.R2. If the cheap model is down, `summarise_sessions` fails for that turn and the model is expected to mention partial coverage / suggest narrowing.
- **User-controllable summarisation depth** ("brief / detailed / verbatim"). Backlog. The model picks depth implicitly via the `focus` parameter and prompt rules.
- **Tool-result memoisation across turns.** Backlog — for "what changed since I last asked" follow-ups. Not in Part 2 scope.

End of Part 2.

---

## Part 3: Cutover and Ripout

> **Status:** Draft. Mirrors PRD Part 3.
> **Depends on:** Parts 1 and 2 shipped. The new tool surface is fully built and dormant; this part wires it to the chat model, deletes the old surface, lands the three production-readiness pieces (prompt caching, per-turn cost circuit breaker, eval gate), and is the final part of PRD-033.

### Architectural Direction

Part 3 is **the cutover commit** — every change lands in one PR. There is no feature flag (PRD § Purpose, decided after discussion); the eval is the safety net, and `git revert` is the rollback lever. The PRD explicitly forbids parallel-runtime cutovers.

Three production-readiness pieces sit alongside the surface swap:

1. **Prompt caching** — the system prompt and tool descriptions are the largest stable input on every chat turn (~2K tokens by Part 1's measurement). Caching them is industry-standard practice for any production chat surface: Anthropic's `cache_control` markers cut input cost ~90% on cache hits; OpenAI does it automatically for prompts ≥1024 tokens; Google requires explicit `createCachedContent` calls. Implementation prioritises Anthropic + OpenAI (the providers Synthesiser most commonly uses); Google falls back to a no-op until the explicit cache path is needed.

2. **Per-turn cost circuit breaker** — caps the total tool-result tokens that can flow into the model's context within a single user turn (default 100,000, env-overridable). When tripped, subsequent tool calls receive an injected "budget exhausted" payload, the model synthesises from what it has, and the user-facing response includes a plain-language "too broad — try narrowing" suggestion. Standard pattern for agentic chat; Anthropic recommends it in their multi-step agent guidance, and OpenAI's Agents SDK ships a similar `max_input_tokens` guard.

3. **Eval gate** — Parts 1 and 2 built the harness. Part 3 fires it: pre-merge, against both surfaces; required to clear both thresholds (≥ 90% answer-correctness AND ≥ 90% tool-routing accuracy, zero regressions on either dimension vs the old-surface baseline) before the cutover commit lands. Documented in the PR description.

**Industry-standard patterns adopted:**
- **Provider-specific cache implementation, no-op fallback.** Anthropic gets explicit `cache_control` markers; OpenAI is automatic with telemetry read from the response; Google falls back. This matches the Vercel AI SDK's stance — each provider adapter handles its own caching semantics.
- **Cost circuit breaker via wrapped tool execute().** Industry pattern: wrap each tool's `execute` in a guard that returns an injected sentinel result when the per-turn budget is exhausted, rather than aborting the stream. The model sees a structured "you have hit the per-turn budget" message and synthesises a partial answer — graceful degradation, not an error.
- **One-shot first call.** Edge case: if the first tool's result itself exceeds the budget, accept it (give the model something to work with), then reject subsequent calls. Better than "budget exceeded before any data was gathered."
- **System prompt v2 structure:** role → tool catalogue → routing guidance → grounding rules → output format → error handling. Standard agentic chat prompt skeleton; mirrors what Anthropic, OpenAI, and Cursor's reference prompts look like.
- **Revert as rollback** for production regressions caught after the cutover ships. Established earlier in this PRD; not a feature flag.

---

### 3.1 System Prompt v2

#### File: `lib/prompts/chat-prompt.ts` (rewritten in place)

The existing system prompt is replaced. Old version is preserved in git history; no backwards-compat shim. The prompt is rewritten — not patched — because the underlying tool surface has changed shape.

Structure:

```
[1. Role + workspace context (1-2 sentences)]
[2. Tool catalogue (10 tools, 1-2 lines each — when to use, when not to)]
[3. Routing patterns:
    - list → fetch → synthesise
    - list → summarise → synthesise
    - When to prefer summarise_sessions over fetch_session_content (N > ~10)
    - Multi-query semantic_search (2-3 calls with rephrased queries for broad/ambiguous questions)]
[4. Grounding rules: cite client name + session date; never invent; partial coverage is OK to mention]
[5. Output format: markdown, follow-up questions block, citation chips]
[6. Error / partial-coverage handling: budget hit, summarise failures, out-of-scope sessions]
```

Targets:
- **~1,800 tokens total** (system prompt + 10 tool descriptions inlined). Smaller is better for cache miss cost; larger is OK because everything after the first turn is a cache hit. Tool descriptions are tuned for routing accuracy, not minimal length.
- **Stable across turns.** Nothing dynamic in the system prompt — date injection (`{{TODAY}}`) is the only template substitution, and it's the same string for the whole turn so the cache stays warm.

Versioning constant `CHAT_PROMPT_VERSION = "v2"` is exported alongside the prompt. Bumping it invalidates eval reports (forces re-run on next eval).

**[fwd-compat note from earlier parts retired.]** The Part 1 / Part 2 hypothesis about adding `cheapModel: LanguageModel` to `ChatToolContext` was retired in Part 2 (resolver moved into the service). Part 3 adds `recordToolResultTokens` instead — see § 3.6.

---

### 3.2 Old Tool Removal

#### `lib/services/chat-stream-service.ts`

Deletions:
- `buildSearchInsightsTool()` function — entire function block (currently lines 459–562 per Part 1 mapping).
- `buildQueryDatabaseTool()` function — entire function block (568–681).
- The cue-matching filter sanitisation layer:
  - `sanitizeSearchInsightsFilters()` and `sanitizeQueryDatabaseFilters()` functions
  - `SEVERITY_CUES`, `URGENCY_CUES`, `GRANULARITY_CUES`, `CONFIDENCE_CUES`, `DATE_CUE_REGEX` constants
  - All in `chat-stream-service.ts` (currently around lines 325–450)
- The `lastUserMessage` plumbing that exists only to feed the sanitiser into the tool builders. Once the sanitiser is gone, the model receives Zod-validated inputs only, and the per-tool filter contracts (PRD § P1.R5) make the cue layer unnecessary.

These deletions are pure subtraction — no replacement code goes in their place. The new tools are wired in § 3.3 below.

#### `lib/services/database-query/action-metadata.ts`

Deletions:
- `CHAT_TOOL_ACTIONS_TUPLE` (and the re-exports `CHAT_TOOL_ACTIONS`, `ChatToolAction`)
- `buildChatToolDescription()` helper
- `assertChatToolActionsInSync()` dev-time check

Retained (dashboard still uses these — PRD § Purpose):
- `ACTION_METADATA` registry
- `QueryAction` union type
- `executeQuery` entry point

The `llmToolExposed` flag on each action metadata entry is also retained — it's harmless once `CHAT_TOOL_ACTIONS_TUPLE` is gone, and the dashboard's own enum (in `app/api/dashboard/route.ts`) is unchanged. Optionally tidy by dropping the flag in a follow-up PR; out of scope here.

#### `lib/services/database-query/index.ts`

Update the public re-exports to drop `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `buildChatToolDescription`. Keep `ACTION_METADATA`, `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ActionMeta`, `executeQuery`.

---

### 3.3 Chat-Stream-Service Surface Swap

#### `lib/services/chat-stream-service.ts` — modified

The streaming orchestration shape stays the same (`streamText` + SSE events + message finalization). What changes:

```ts
import { createChatTools } from "@/lib/services/chat-tools";
import { createChatQueryRepository } from "@/lib/repositories/supabase/supabase-chat-query-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import {
  buildSystemPrompt,
  CHAT_PROMPT_VERSION,
} from "@/lib/prompts/chat-prompt";
import { applyPromptCacheMarkers } from "@/lib/services/chat-prompt-cache";
import { createCostBudgetTracker } from "@/lib/services/chat-cost-budget";

// Inside the streaming handler, once teamId and user are resolved:

const ctx: ChatToolContext = {
  workspace: { teamId, userId: user.id },
  chatQueryRepo: createChatQueryRepository(serviceClient, teamId, user.id),
  embeddingRepo: createEmbeddingRepository(serviceClient, teamId, user.id),
  supabaseClient,
  emitStatus: (msg) => controller.enqueue(encoder.encode(sseEvent("status", { text: msg }))),
  recordToolResultTokens: budgetTracker.record, // see § 3.5
};

const baseTools = createChatTools(ctx);
const tools = budgetTracker.wrap(baseTools); // see § 3.5

const budgetTracker = createCostBudgetTracker(CHAT_PER_TURN_BUDGET, {
  onBudgetExceeded: () => {
    controller.enqueue(encoder.encode(sseEvent("status", {
      text: "Query is broad — synthesising a partial answer."
    })));
  },
});

const systemPrompt = buildSystemPrompt({ date: todayIso() });
const messages = applyPromptCacheMarkers(systemPrompt, contextMessages);

const result = await streamText({
  model: resolvedModel.model,
  system: undefined, // system message is in `messages` so caching can apply
  messages,
  tools,
  stopWhen: stepCountIs(CHAT_STEP_CAP),
  maxOutputTokens: clampOutputTokens(CHAT_MAX_TOKENS, resolvedModel.label),
});
```

Key changes from the old shape:
- System prompt is now a `messages[0]` system message (not the `system: ...` field) so the cache markers can apply to it. This is provider-specific (Anthropic), but the Vercel AI SDK accepts both shapes — works as a no-op for OpenAI / Google.
- `baseTools` (from `createChatTools(ctx)`) is wrapped by `budgetTracker.wrap()` to insert the budget guard before each tool's `execute()` fires.
- The `controller`, `encoder`, `lastUserMessage` threading into tool builders is gone — tools get everything they need from `ChatToolContext`.

The SSE event pipeline (`status`, `delta`, `sources`, `follow_ups`, `done`, `error`) is unchanged. Message finalization, abort handling, length/step-cap warnings are unchanged.

---

### 3.4 Prompt Caching

#### `lib/services/chat-prompt-cache.ts` — new

Provider-aware wrapper that adds cache markers to the stable prefix (system prompt + tool descriptions). Tool descriptions are carried separately by the Vercel AI SDK's `tools` parameter — they're cached by the SDK / provider automatically when the system message itself is cached, so we only need to mark the system message.

> **Provider-agnostic at the call-site, provider-specific inside the helper.** Caching is one of the few features where the providers fundamentally differ in protocol — Anthropic requires explicit markers, OpenAI is automatic, Google requires a separate API call before generation. The AI SDK doesn't unify these because they can't be unified at the abstraction layer. The right shape is one helper that switches on `AI_PROVIDER` internally; the rest of the system never sees the difference. This is the same pattern Vercel's docs, LangChain, and Anthropic's own SDK documentation recommend.

```ts
import type { ModelMessage } from "ai";

const ANTHROPIC = "anthropic";
const OPENAI = "openai";
const GOOGLE = "google";

/**
 * Applies provider-specific cache markers to the stable system message so
 * the system prompt + tool descriptions are billed at the cache-hit rate
 * on every turn after the first within a conversation.
 *
 * - Anthropic: explicit `providerOptions.anthropic.cacheControl` marker.
 *   First-call cost slightly higher (cache write); subsequent calls ~10%
 *   of input price for cached tokens.
 * - OpenAI: caching is automatic for prompts ≥ 1024 tokens. Nothing to
 *   add at request time; cache-hit telemetry comes from response usage
 *   `cachedInputTokens` (or equivalent SDK field).
 * - Google: requires explicit `createCachedContent` API call. Deferred
 *   to a follow-up — the no-op path applies until that's wired.
 * - Other / unknown providers: no-op fallback.
 */
export function applyPromptCacheMarkers(
  systemPrompt: string,
  history: ModelMessage[]
): ModelMessage[] {
  const provider = process.env.AI_PROVIDER ?? "";

  if (provider === ANTHROPIC) {
    return [
      {
        role: "system",
        content: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      ...history,
    ];
  }

  // OpenAI: caching is automatic, no markers needed. Same shape as no-op.
  // Google: explicit CachedContent API not wired here yet (backlog).
  // Unknown providers: graceful no-op.
  void OPENAI;
  void GOOGLE;
  return [{ role: "system", content: systemPrompt }, ...history];
}
```

Per-turn telemetry (in `chat-stream-service.ts`'s existing `chat-complete` log line) gains two fields:

```
cache-hit-input: <N>     // from usage.cachedInputTokens (or provider equivalent)
cache-miss-input: <N>    // from usage.inputTokens - cachedInputTokens
```

Where the active provider doesn't expose cached-token counts, both fields are logged as `0` and a once-per-process warning is emitted so observability gaps are visible.

**Industry-standard expectation:** on turn 2+ within a single conversation, `cache-hit-input` should be the **majority** of input tokens (PRD § P3.AC9). For Anthropic this means ~80–90% of input tokens served from cache once the system prompt + tool descriptions have been cached. The eval harness reports this stat alongside per-query metrics for evidence.

#### Cache TTL note

Anthropic's `ephemeral` cache lives **5 minutes** by default and is per-conversation (keyed by exact prefix bytes). A conversation that sits idle for >5 minutes loses the cache on its next turn — that's expected behaviour and not worth working around. Long-conversation users see a cache miss on the first re-engaged turn and cache hits thereafter.

---

### 3.5 Per-Turn Cost Circuit Breaker

#### `lib/services/chat-cost-budget.ts` — new

Stateful per-turn tracker. Wraps each tool's `execute()` with a guard that:
- Lets the **first** tool call through unconditionally (so the model always gets some data).
- Checks the running total before each subsequent call.
- When the budget is exceeded, returns an injected sentinel payload instead of running the tool.

```ts
import { estimateTokens } from "@/lib/services/token-estimator";
import type { Tool } from "ai";

export const CHAT_PER_TURN_BUDGET = parseInt(
  process.env.CHAT_PER_TURN_BUDGET ?? "100000",
  10
);

export interface BudgetTrackerOpts {
  /** Fired the first time the budget is exceeded in this turn. */
  onBudgetExceeded?: (info: {
    totalTokensAtTrip: number;
    callsBeforeTrip: number;
    callsRejected: number;
    toolCounts: Record<string, number>;
  }) => void;
}

export function createCostBudgetTracker(
  budgetTokens: number,
  opts: BudgetTrackerOpts = {}
) {
  let totalResultTokens = 0;
  let callCount = 0;
  let exceeded = false;
  let callsRejected = 0;
  const toolCounts: Record<string, number> = {};

  function record(toolName: string, tokens: number): void {
    totalResultTokens += tokens;
    callCount += 1;
    toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
  }

  function isExceeded(): boolean {
    return totalResultTokens >= budgetTokens;
  }

  function wrap<T extends Record<string, Tool>>(tools: T): T {
    const out = {} as Record<string, Tool>;
    for (const [name, original] of Object.entries(tools)) {
      out[name] = {
        ...original,
        execute: async (input, options) => {
          // One-shot first call: always let the first tool call through.
          if (callCount > 0 && isExceeded()) {
            callsRejected += 1;
            if (!exceeded) {
              exceeded = true;
              opts.onBudgetExceeded?.({
                totalTokensAtTrip: totalResultTokens,
                callsBeforeTrip: callCount,
                callsRejected,
                toolCounts: { ...toolCounts },
              });
            }
            return {
              __BUDGET_EXHAUSTED__: true,
              message:
                "Per-turn cost budget exhausted. Synthesise an answer from the tool results you already have, and explicitly tell the user the query was too broad and suggest narrowing by client or date range.",
            };
          }
          const result = await original.execute(input, options);
          record(name, estimateTokens(result));
          return result;
        },
      } as Tool;
    }
    return out as T;
  }

  return { wrap, record, isExceeded };
}
```

The `__BUDGET_EXHAUSTED__` sentinel is recognised by the system prompt v2 — the prompt instructs the model that when it sees this payload it must stop calling tools and synthesise a response from earlier results, explicitly telling the user the query was too broad. The user-facing message surfaces this in plain language; the sentinel itself never leaks into the assistant's text.

Telemetry on trip (logged via `console.warn` from the `onBudgetExceeded` callback in `chat-stream-service.ts`):

```
[chat-stream-service] per-turn cost budget exceeded — totalTokensAtTrip: 102347, callsBeforeTrip: 4, callsRejected: 2, toolCounts: { semantic_search: 2, fetch_session_content: 2 }
```

#### Budget tuning

The 100,000-token initial budget is **deliberately tight** (TRD § 1.12 of Part 2 noted this). Expected to be raised to 150–250k from telemetry once we see real workloads. Tuning is via the `CHAT_PER_TURN_BUDGET` env var, no code change.

---

### 3.6 ChatToolContext Extension

#### `lib/services/chat-tools/shared/tool-context.ts` — modified

Add the telemetry hook earmarked in Part 1's TRD § 1.4. Single new field:

```ts
export interface ChatToolContext {
  workspace: WorkspaceCtx;
  chatQueryRepo: ChatQueryRepository;
  embeddingRepo: EmbeddingRepository;
  supabaseClient: SupabaseClient;
  emitStatus: (message: string) => void;
  /** PRD-033 Part 3 — sums tool-result tokens for the cost circuit breaker. */
  recordToolResultTokens: (toolName: string, tokens: number) => void;
}
```

The wrapper in § 3.5 calls `record()` automatically when each tool's execute returns. Individual tool factories don't have to be touched — the wrapper handles it. The field is exposed on the context for future use cases (e.g. a per-tool budget for `fetch_session_content` alone) but the budget tracker is the only Part 3 consumer.

---

### 3.7 Step Cap Review

`stepCountIs(10)` is the current ceiling (from PRD-031 Part 3). Broad agentic queries now chain 2–4 tool calls instead of 1, so the cap is **reviewed but not raised by default** per PRD P3.R7.

Review procedure (one-time, during Increment 3.7):
- Run the eval against the new surface with `stepCountIs(10)`.
- Check the per-query report for any query where `actualTrajectory.length >= 10` AND `routingPass === false`. If a representative query (Q-001..Q-026) hits the cap on a plausible chain, raise the constant. Otherwise leave it.
- Document the review outcome in the cutover PR description.

Expected outcome: no raise needed. The longest expected chains are:
- `aggregate → list_sessions → fetch_session_content` (3 calls)
- `aggregate → list_sessions → summarise_sessions` (3 calls)
- `aggregate × 2 → list_sessions → summarise_sessions` for comparative queries (4 calls)

All well under 10.

---

### 3.8 Starter Questions Update

P3.R8: at least one starter question is changed to demonstrate a new capability.

Implementation: find the starter-questions array in the chat UI component (likely a const at the top of one of the chat client components in `app/`). Replace one of the existing four with a "summarise everything" prompt — e.g. **"Summarise everything I've heard from my top client this quarter"**.

This is a 4-line UI change. Not gated by P1.R8 ("no new UI") because Part 3 is the cutover and is allowed to change the chat tab's discoverable surface.

---

### 3.9 Eval Gate (Cutover Gate)

Pre-merge procedure for the cutover PR:

1. Apply the migrations from Part 1 to staging Supabase (`001-fts-on-session-embeddings.sql`, `002-match-session-embeddings-fts-rpc.sql`) if not already applied.
2. Set `SUMMARY_AI_PROVIDER` / `SUMMARY_AI_MODEL` in the staging env.
3. Fill in the `invokeSurface()` shim in `scripts/run-eval.ts` against the staging `/api/chat/send` route.
4. Run the eval against both surfaces:
   ```
   npm run eval:chat -- --surface=old
   npm run eval:chat -- --surface=new
   ```
5. Compare the two reports:
   - **Threshold A:** new surface achieves ≥ 90% answer-correctness (judge-rubric overall ≥ 0.9 averaged across all queries).
   - **Threshold B:** new surface achieves ≥ 90% tool-routing accuracy (subsequence match rate).
   - **Zero regressions:** for every query where the old surface scored ≥ 0.9 on answer correctness OR passed routing, the new surface must score the same or better.
6. Document the report paths, totals, and per-category breakdown in the cutover PR description. Attach both report JSONs as PR artefacts.
7. If a threshold is not met or a regression is found: do not merge. Open follow-up issues for the gap, fix in the cutover branch, re-eval, re-gate.

**Post-cutover safety:** after merge, monitor production telemetry for 1–2 weeks (the standard observation window we'd have used a feature flag for, if we had one). The mechanisms are: per-turn `chat-complete` logs, the new cache-hit / cache-miss telemetry, the budget-trip warnings. If a real-traffic regression surfaces that the eval missed, revert the cutover commit, close the gap in the eval set with a covering query, and re-cut once the updated eval passes.

---

### 3.10 Files Changed (Part 3)

**New files:**
- `lib/services/chat-prompt-cache.ts` — provider-aware cache marker application.
- `lib/services/chat-cost-budget.ts` — per-turn cost circuit breaker (`createCostBudgetTracker`).

**Modified files:**
- `lib/prompts/chat-prompt.ts` — system prompt v2 rewritten in place; `CHAT_PROMPT_VERSION = "v2"` exported; `buildSystemPrompt({ date })` is the new entry point.
- `lib/services/chat-stream-service.ts` — swaps tool surface, removes `buildSearchInsightsTool` + `buildQueryDatabaseTool` + the sanitisation layer (~150 lines deleted), wires the new prompt + cache + budget tracker. The `lastUserMessage` threading is removed.
- `lib/services/chat-tools/shared/tool-context.ts` — adds `recordToolResultTokens` field.
- `lib/services/database-query/action-metadata.ts` — removes `CHAT_TOOL_ACTIONS_TUPLE`, `buildChatToolDescription`, `assertChatToolActionsInSync`.
- `lib/services/database-query/index.ts` — removes the corresponding public re-exports.
- One UI file in `app/` — replaces one starter question with a "summarise everything" prompt.
- `ARCHITECTURE.md` — final file-map cleanup; Chat tool surface paragraph updated to "wired to the streaming surface"; new env var entry for `CHAT_PER_TURN_BUDGET`.
- `CHANGELOG.md` — Part 3 entry.

**Files explicitly NOT touched:**
- `app/api/dashboard/route.ts` — dashboard's action surface untouched (PRD § Purpose).
- All Part 1 / Part 2 tool factories — already final.
- The eval harness or queries.json — the surface-invocation shim in `run-eval.ts` is filled in pre-merge (Increment 3.9) but the rest is unchanged.

---

### 3.11 Implementation Increments

#### Increment 3.1 — System prompt v2

Rewrite `chat-prompt.ts` to the new structure (§ 3.1). The prompt isn't wired yet — `chat-stream-service.ts` still imports the old prompt name. Verifiable by reading the prompt and confirming structure; functional verification is via the eval after the cutover.

#### Increment 3.2 — ChatToolContext extension + cost budget tracker (dormant)

Add `recordToolResultTokens` to `ChatToolContext`. Land `chat-cost-budget.ts`. Wire the tracker into `chat-stream-service.ts` but **don't** wrap the old tools — the tracker exists but doesn't gate anything yet. This decouples the budget infrastructure from the cutover.

#### Increment 3.3 — Prompt caching infrastructure (dormant)

Land `chat-prompt-cache.ts`. Add the per-turn cache-hit / cache-miss telemetry to the existing `chat-complete` log line in `chat-stream-service.ts`. **Don't** switch the system message to use the cache markers yet — that lands with the cutover swap. This increment is a no-op functionally but lands the helper.

#### Increment 3.4 — Cutover swap

The one-PR-cutover. In a single change:
- `chat-stream-service.ts` builds the `ChatToolContext`, calls `createChatTools(ctx)`, wraps with `budgetTracker.wrap()`, applies cache markers via `applyPromptCacheMarkers()`, imports the v2 prompt.
- Deletes `buildSearchInsightsTool`, `buildQueryDatabaseTool`, `sanitizeSearchInsightsFilters`, `sanitizeQueryDatabaseFilters`, the cue constants, the `lastUserMessage` plumbing.
- Deletes `CHAT_TOOL_ACTIONS_TUPLE`, `buildChatToolDescription`, `assertChatToolActionsInSync` from `action-metadata.ts`; removes the re-exports from `database-query/index.ts`.

`tsc --noEmit` is the structural gate; the eval is the behavioural gate.

#### Increment 3.5 — Starter questions update

One UI file edit. Replace one starter question with a "summarise everything" prompt.

#### Increment 3.6 — Step cap review

Run the eval, inspect per-query reports for queries hitting `stepCountIs(10)`. If none, document "no raise needed" in the cutover PR. If one or more representative queries cap out, raise to 15 and document.

#### Increment 3.7 — Eval gate run + PR description

Apply the procedure from § 3.9. The PR cannot merge until the eval is documented in its description, both reports are attached, and the thresholds are clearly met.

#### Increment 3.8 — End-of-PRD audit

Run the audit checklist from [CLAUDE.md](../../CLAUDE.md#end-of-prd-audit) across **all** files touched by PRD-033 (Parts 1, 2, 3). Update ARCHITECTURE.md (file map, env vars table, Chat API section moves the "not yet wired" caveat out and reflects the deletions). Update CHANGELOG.md Part 3 entry. Verify every doc reference to a deleted symbol (`CHAT_TOOL_ACTIONS`, etc.) is gone. This audit produces fixes, not a report.

---

### 3.12 Acceptance Criteria → Verification Map

| PRD AC | Verified by |
|---|---|
| P3.AC1 (only v2 system prompt in the codebase) | Increment 3.1 + grep verification in 3.8 audit (no stale references) |
| P3.AC2 (all six retired symbols gone) | Increment 3.4 deletions; grep verification in 3.8 audit |
| P3.AC3 (every query shape works on the new surface) | Eval queries Q-001..Q-016 baseline (Part 1) + Q-017..Q-026 (Part 2) cover the shape inventory; Increment 3.7 confirms |
| P3.AC4 ("summarise everything for X" produces multi-session synthesis) | Eval Q-017 (canonical gap-closer); Increment 3.7 |
| P3.AC5 (starter questions reflect new capability) | Increment 3.5 |
| P3.AC6 (broad-summary cost ≥ 30% lower than premium-only fetch path) | Eval Q-026 (cost test) + per-turn telemetry comparison; documented in PR description |
| P3.AC7 (`npx tsc --noEmit` passes) | Increment 3.4 gate |
| P3.AC8 (existing chat features unchanged: citations, follow-ups, search, archive, rename/pin/archive/delete) | Manual regression pass per Increment 3.8 audit; touches mostly client-side code unaffected by the swap |
| P3.AC9 (prompt caching: majority of input tokens cached on turns 2+) | Increment 3.3 telemetry + post-cutover production observation; documented in PR description with a sample conversation log |
| P3.AC10 (circuit breaker trips, partial answer + "too broad" message) | Increment 3.7 includes a synthetic pathological query (e.g. "summarise everything across every client all time") to verify the trip; production-trip telemetry confirms the field telemetry path |
| P3.AC11 (eval thresholds + zero regressions, documented in PR) | Increment 3.7 explicitly produces the documentation |

---

### 3.13 Open Implementation Questions

These are the only choices the PRD doesn't fully constrain:

1. **SDK `usage` field shape for cached-token telemetry.** Request-side caching is per-provider (§ 3.4 handles that with a switch). Response-side telemetry — reading how many cached tokens the provider actually served — comes back through the AI SDK's normalised `usage` object, whose field names have changed across SDK versions: recent versions expose `usage.cachedInputTokens`; older versions used `usage.promptTokensDetails.cachedTokens` mirroring OpenAI's raw response shape. Increment 3.3 reads the SDK's actual surface (the project is on `ai@^6.0.144`) and adapts. This is provider-neutral — Anthropic, OpenAI, and (eventually) Google all flow through the same SDK normalisation. If the active provider doesn't expose cached-token counts at all, log `0` and emit a one-time "observability gap" warning per provider.

2. **Google Gemini caching is deferred.** The provider isn't in production use today (Synthesiser's active providers are Anthropic and OpenAI). When Google is added as an active provider, three deferred decisions need to be revisited together: (a) the `createCachedContent` API integration in `chat-prompt-cache.ts` (replacing the current no-op branch), (b) cache lifecycle management (TTL, eviction, per-conversation cache id storage), (c) usage-field telemetry verification for Google's SDK shape. The no-op fallback in `chat-prompt-cache.ts` is correct and honest until then — Google traffic just shows `cache-hit-input: 0`.

3. **`recordToolResultTokens` granularity.** The current design records the result-token count once per tool call. If a single broad `summarise_sessions` call returns 50 digests (each ~50 tokens output), it's recorded as one ~3000-token charge against the budget. This matches how the chat model actually receives the result. Per-leaf recording would be misleading.

4. **The `__BUDGET_EXHAUSTED__` sentinel payload shape.** Designed as `{ __BUDGET_EXHAUSTED__: true, message: "..." }` so the model sees a clear signal it must synthesise from prior results. The system prompt v2 (§ 3.1) explicitly instructs the model on this contract. If a future provider strips unknown top-level keys, the design holds because the `message` is human-readable. **This is the first behaviour the eval must verify in Increment 3.7** — the entire cost-protection mechanism depends on the model respecting the contract (stop calling tools, synthesise, surface "too broad" suggestion in plain language to the user, not leak the internal sentinel name). A deliberately-pathological eval query is added to `queries.json` during Increment 3.7 with three rubric checks: actualTrajectory stops growing after the sentinel is returned; the synthesised answer is coherent from prior results; the user-facing response mentions narrowing and does not contain "BUDGET_EXHAUSTED" or "error". Without this verification, we'd have built infrastructure that doesn't actually protect against pathological queries — robust when eval-verified, brittle when not.

5. **Cache-aware tool description ordering.** Tool descriptions are passed via the AI SDK's `tools` parameter — they're separate from the system message but cached as part of the same prefix by both Anthropic and OpenAI (under the hood). Reordering `createChatTools()` would invalidate caches on that turn. Action item: pick an order, lock it in Increment 3.4, don't reorder casually after that.

---

### 3.14 What Part 3 Explicitly Defers

Items intentionally left for follow-up PRDs (already enumerated in the PRD backlog; mirrored here for the implementer's reference):

- **Per-team feature flag** for the cutover — explicitly rejected during PRD review (no flag system exists; revert is the rollback lever for an early-stage product).
- **Google Gemini explicit cache integration** — deferred; no-op fallback applies until then.
- **Adaptive per-turn budget** — replaces the static 100k with a query-intent-aware budget.
- **Reranker layer** for `semantic_search` — already in backlog; hybrid retrieval is in production and the eval will tell us whether a reranker is needed.
- **Streaming the map step** of `summarise_sessions` — UX improvement, deferred from Part 2.
- **Tool-call tracing UI** — debug panel; backlog.
- **Trajectory-matching CI block** — promotes the manual eval to a CI gate; this PRD does the manual version once at cutover. The CI block is a separate ops decision (CI minutes, secret management for `EVAL_JUDGE_*` keys).
- **LLM-as-judge model upgrade path** — single-judge → multi-judge agreement; deferred until eval volume justifies the cost.

End of Part 3. End of TRD-033.
