# TRD-019: Vector Search Infrastructure

> **Status:** Draft (Parts 1–4)
> **PRD:** `docs/019-vector-search/prd.md` (approved)
> **Mirrors:** PRD Parts 1–4. All parts are detailed below.

---

## Technical Decisions

1. **pgvector over external vector databases.** Supabase natively supports pgvector as a Postgres extension. Keeping embeddings in the same database as application data means: no additional infrastructure, RLS applies natively, foreign key cascades work, and queries can join embeddings with sessions/clients in a single round trip. External vector DBs (Pinecone, Weaviate) add operational complexity with no benefit at the expected data volume (thousands of chunks, not millions).

2. **HNSW index over IVFFlat.** HNSW provides better query performance without requiring periodic re-training. IVFFlat requires `CREATE INDEX ... WITH (lists = N)` tuning and periodic re-indexing as data grows. At the expected scale, HNSW's higher memory usage is negligible and its query latency is consistently lower.

3. **`chunk_type` stored as text, not a Postgres enum.** New chunk types (from future extraction schema versions or custom categories) can be added without a migration. The application layer enforces valid values via the `ChunkType` TypeScript union type. This matches the PRD's explicit requirement (P1.R2).

4. **`embedding` dimension driven by environment variable.** The `EMBEDDING_DIMENSIONS` env var (Part 3) determines the vector column size. The migration hardcodes `1536` (OpenAI `text-embedding-3-small` default) because Postgres requires a fixed dimension at column creation time. If the embedding model changes to a different dimension, a migration to alter the column is required — this is intentional, as switching embedding models also requires re-embedding all existing data (noted in PRD backlog).

5. **Team-scoped RLS mirroring `sessions` pattern.** Embeddings are a derived artifact of sessions. The RLS policy structure matches `sessions`: personal workspace rows (`team_id IS NULL`) are scoped to the creating user; team rows (`team_id IS NOT NULL`) are scoped to team membership via `is_team_member()`. Write policies (INSERT/UPDATE/DELETE) also use team membership — any team member who can extract signals can write embeddings. This is simpler than the sessions pattern (which distinguishes admin vs. sales for updates) because embeddings are system-generated, not user-edited.

6. **Cascade delete via foreign key, not application logic.** `ON DELETE CASCADE` on `session_id` ensures embeddings are automatically removed when a session is hard-deleted. For soft deletes, the retrieval service (Part 4) filters by joining to `sessions WHERE deleted_at IS NULL` — embeddings for soft-deleted sessions remain in the database but are excluded from search results. This avoids a secondary cleanup job.

---

## Part 1: pgvector Setup and Embeddings Table

> Implements **P1.R1–P1.R6** from PRD-019.

### Overview

Enable the pgvector Postgres extension, create the `session_embeddings` table with all required columns, indexes, and RLS policies. This is a database-only change — no application code is modified. The table is created with forward compatibility for Parts 2–4: the schema carries all columns those parts will need (chunk_type, metadata, schema_version) even though nothing writes to the table yet.

### Forward Compatibility Notes

- **Part 2 (Chunking Logic):** Produces `EmbeddingChunk` objects whose fields map 1:1 to the columns defined here. The `chunk_type` text column accepts all values from the `ChunkType` union type. The `metadata` jsonb column stores the type-specific metadata each chunk type carries.
- **Part 3 (Embedding Pipeline):** Writes rows into `session_embeddings` via the embedding repository. The `embedding` vector(1536) column receives the output of the configured embedding model. The `schema_version` column is populated from `SessionMeta.schemaVersion` to enable future schema-aware retrieval.
- **Part 4 (Retrieval Service):** Reads from `session_embeddings` using the HNSW index for cosine similarity search, filtered by `team_id` and `chunk_type` via the composite index. The RLS policies defined here ensure retrieval is team-scoped without additional application-level filtering.

### Database Changes

#### Migration: `001-create-session-embeddings.sql`

```sql
-- ============================================================
-- PRD-019 Part 1: pgvector Setup and Embeddings Table
-- ============================================================

-- P1.R1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- P1.R2: Create session_embeddings table
CREATE TABLE session_embeddings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  team_id          UUID REFERENCES teams(id),
  chunk_text       TEXT NOT NULL,
  chunk_type       TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  embedding        vector(1536) NOT NULL,
  schema_version   INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- P1.R4: Enable Row-Level Security
ALTER TABLE session_embeddings ENABLE ROW LEVEL SECURITY;

-- P1.R3: HNSW index for cosine similarity search
CREATE INDEX session_embeddings_embedding_hnsw_idx
  ON session_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- P1.R5: Index on session_id for cascade deletes and re-extraction cleanup
CREATE INDEX session_embeddings_session_id_idx
  ON session_embeddings (session_id);

-- P1.R6: Composite index on (team_id, chunk_type) for filtered similarity searches
CREATE INDEX session_embeddings_team_chunk_type_idx
  ON session_embeddings (team_id, chunk_type);
```

**Why `vector(1536)` is hardcoded:** Postgres requires a fixed dimension at column definition time. The value `1536` matches OpenAI's `text-embedding-3-small` model, which is the initial embedding provider (Part 3). Changing to a different-dimension model requires a migration to alter this column — an intentional constraint, since model switches also require re-embedding all data.

**Why no `updated_at` column:** Embeddings are immutable write-once artifacts. On re-extraction, old embeddings are deleted and new ones are inserted (Part 3, P3.R7). There is no update-in-place flow, so `updated_at` adds no value.

**Why no `created_by` column:** Embeddings are system-generated as a side effect of signal extraction, not user-authored. The creating user is already tracked on the parent `sessions` row. Adding `created_by` here would duplicate data without enabling any query pattern.

#### RLS Policies

The policy structure mirrors `sessions` but is simpler — embeddings are system-generated, so there's no admin-vs-sales distinction for writes.

```sql
-- ============================================================
-- RLS Policies for session_embeddings
-- ============================================================

-- SELECT: Personal workspace — user can read their own embeddings
CREATE POLICY "Users can read own personal embeddings"
  ON session_embeddings FOR SELECT TO authenticated
  USING (
    team_id IS NULL
    AND session_id IN (
      SELECT id FROM sessions
      WHERE created_by = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- SELECT: Team workspace — team members can read team embeddings
CREATE POLICY "Team members can read team embeddings"
  ON session_embeddings FOR SELECT TO authenticated
  USING (
    team_id IS NOT NULL
    AND is_team_member(team_id)
  );

-- INSERT: Personal workspace — user can insert embeddings for own sessions
CREATE POLICY "Users can insert own personal embeddings"
  ON session_embeddings FOR INSERT TO authenticated
  WITH CHECK (
    team_id IS NULL
    AND session_id IN (
      SELECT id FROM sessions
      WHERE created_by = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- INSERT: Team workspace — team members can insert team embeddings
CREATE POLICY "Team members can insert team embeddings"
  ON session_embeddings FOR INSERT TO authenticated
  WITH CHECK (
    team_id IS NOT NULL
    AND is_team_member(team_id)
  );

-- DELETE: Personal workspace — user can delete embeddings for own sessions
CREATE POLICY "Users can delete own personal embeddings"
  ON session_embeddings FOR DELETE TO authenticated
  USING (
    team_id IS NULL
    AND session_id IN (
      SELECT id FROM sessions
      WHERE created_by = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- DELETE: Team workspace — team members can delete team embeddings
CREATE POLICY "Team members can delete team embeddings"
  ON session_embeddings FOR DELETE TO authenticated
  USING (
    team_id IS NOT NULL
    AND is_team_member(team_id)
  );

-- UPDATE: Personal workspace — user can update embeddings for own sessions
CREATE POLICY "Users can update own personal embeddings"
  ON session_embeddings FOR UPDATE TO authenticated
  USING (
    team_id IS NULL
    AND session_id IN (
      SELECT id FROM sessions
      WHERE created_by = auth.uid()
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (true);

-- UPDATE: Team workspace — team members can update team embeddings
CREATE POLICY "Team members can update team embeddings"
  ON session_embeddings FOR UPDATE TO authenticated
  USING (
    team_id IS NOT NULL
    AND is_team_member(team_id)
  )
  WITH CHECK (true);
```

**Why UPDATE policies exist when embeddings are immutable:** The embedding repository's `upsertChunks()` method (Part 3) uses Postgres `ON CONFLICT ... DO UPDATE` for idempotent re-insertion. RLS must allow UPDATE for upsert to work, even though the application never issues standalone UPDATE statements.

**Why personal-workspace policies check `sessions.created_by` instead of a `created_by` on the embeddings table:** Embeddings don't have a `created_by` column (see rationale above). The parent session's `created_by` is the authoritative ownership signal. The subquery is performant because `session_id` is indexed (P1.R5) and the sessions table has an index on `created_by`.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/019-vector-search/001-create-session-embeddings.sql` | **Create** | Migration SQL — extension, table, indexes, RLS |

### Implementation

#### Increment 1.1: Create Migration File and Apply

**What:** Write the migration SQL file containing the pgvector extension enablement, `session_embeddings` table creation, all three indexes, and all RLS policies.

**Steps:**

1. Create `docs/019-vector-search/001-create-session-embeddings.sql` containing the full migration from sections above (DDL + indexes + RLS policies) as a single, idempotent script.
2. Execute the migration against the Supabase instance via the SQL editor.
3. Verify all objects were created.

**Verification:**

1. Confirm extension exists:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```
2. Confirm table exists with correct columns:
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_name = 'session_embeddings'
   ORDER BY ordinal_position;
   ```
3. Confirm indexes exist:
   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE tablename = 'session_embeddings';
   ```
   Expected: three indexes — `session_embeddings_embedding_hnsw_idx`, `session_embeddings_session_id_idx`, `session_embeddings_team_chunk_type_idx` — plus the primary key index.
4. Confirm RLS is enabled:
   ```sql
   SELECT relname, relrowsecurity
   FROM pg_class
   WHERE relname = 'session_embeddings';
   ```
   Expected: `relrowsecurity = true`.
5. Confirm policies exist:
   ```sql
   SELECT policyname, cmd
   FROM pg_policies
   WHERE tablename = 'session_embeddings';
   ```
   Expected: 8 policies (2 per operation: SELECT, INSERT, UPDATE, DELETE — one personal, one team).
6. Confirm cascade delete works: insert a dummy embedding row referencing an existing session, then delete the session and verify the embedding row is gone.

**Post-increment:**

- Update `ARCHITECTURE.md` — add `session_embeddings` to the Data Model section.
- Update `CHANGELOG.md` — record Part 1 completion.
- Add `docs/019-vector-search/` to the file map in `ARCHITECTURE.md`.

---

## Part 2: Chunking Logic

> Implements **P2.R1–P2.R6** from PRD-019.

### Overview

Build a pure chunking service that transforms a session's `structured_json` (the `ExtractedSignals` type from PRD-018) into an array of typed, metadata-rich `EmbeddingChunk` objects ready for embedding. No database calls, no API calls — input in, array out. Also provide a fallback chunker for raw-only sessions (no structured JSON).

### Forward Compatibility Notes

- **Part 3 (Embedding Pipeline):** Calls `chunkStructuredSignals()` and `chunkRawNotes()` to get chunks, then passes `chunk.chunkText` values to `embedTexts()`. The `EmbeddingChunk` shape maps directly to the `session_embeddings` columns defined in Part 1: `chunkText` → `chunk_text`, `chunkType` → `chunk_type`, `metadata` → `metadata`, `sessionId` → `session_id`, `teamId` → `team_id`, `schemaVersion` → `schema_version`.
- **Part 4 (Retrieval Service):** The `chunkType` field enables filtered retrieval (e.g., "search only pain points"). The `metadata` object carries contextual fields (`client_name`, `session_date`, `severity`, etc.) that the retrieval service returns alongside similarity results.

### Type Definitions

#### `lib/types/embedding-chunk.ts` (P2.R3)

```typescript
/**
 * Valid chunk type values — matches chunk_type TEXT column in session_embeddings.
 * Stored as text in Postgres (not enum) for extensibility without migration.
 */
export type ChunkType =
  | "summary"
  | "client_profile"
  | "pain_point"
  | "requirement"
  | "aspiration"
  | "competitive_mention"
  | "blocker"
  | "tool_and_platform"
  | "custom"
  | "raw";

/**
 * A single embeddable chunk ready for the embedding pipeline.
 * Produced by the chunking service, consumed by the embedding service (Part 3).
 */
export interface EmbeddingChunk {
  chunkText: string;
  chunkType: ChunkType;
  metadata: Record<string, unknown>;
  sessionId: string;
  teamId: string | null;
  schemaVersion: number;
}

/**
 * Session metadata needed by the chunking service.
 * Passed in by the caller — the chunking service has no database access.
 */
export interface SessionMeta {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  teamId: string | null;
  schemaVersion: number;
}
```

### Service Design

#### `lib/services/chunking-service.ts` (P2.R1, P2.R2, P2.R4, P2.R5, P2.R6)

Two named exports. Both are pure functions — no imports from `next/server`, no Supabase client, no fetch calls. They receive data and return arrays.

```
chunkStructuredSignals(structuredJson: ExtractedSignals, sessionMeta: SessionMeta): EmbeddingChunk[]
chunkRawNotes(rawNotes: string, sessionMeta: SessionMeta): EmbeddingChunk[]
```

##### `chunkStructuredSignals` — chunking rules per section

Each section of the `ExtractedSignals` type produces zero or more chunks. Every chunk carries `sessionId`, `teamId`, and `schemaVersion` from `sessionMeta`. Metadata always includes `client_name` and `session_date`.

| Section | Source field(s) | chunk_type | chunk_text | Additional metadata | Skip condition |
|---------|----------------|------------|------------|-------------------|----------------|
| Summary | `summary` | `summary` | The `summary` string | — | Never skipped (summary is required by schema) |
| Client profile | `clientProfile.industry`, `.geography`, `.budgetRange` | `client_profile` | Composed sentence, e.g., "Industry: SaaS. Geography: North America. Budget range: $50k–$100k." Only includes non-null fields. | `industry`, `geography`, `budget_range` (non-null values only) | All three fields are null (P2.R2) |
| Pain points | `painPoints[]` | `pain_point` | `item.text` | `severity`, `client_quote` (if non-null) | Array is empty (P2.R6) |
| Requirements | `requirements[]` | `requirement` | `item.text` | `severity`, `priority`, `client_quote` (if non-null) | Array is empty |
| Aspirations | `aspirations[]` | `aspiration` | `item.text` | `severity`, `client_quote` (if non-null) | Array is empty |
| Competitive mentions | `competitiveMentions[]` | `competitive_mention` | `item.context` | `competitor`, `sentiment` | Array is empty |
| Blockers | `blockers[]` | `blocker` | `item.text` | `severity`, `client_quote` (if non-null) | Array is empty |
| Tools & platforms | `toolsAndPlatforms[]` | `tool_and_platform` | `item.context` | `name`, `type` | Array is empty |
| Custom categories | `custom[].signals[]` | `custom` | `signal.text` | `category_name`, `severity`, `client_quote` (if non-null) | Outer array empty, or category has zero signals |

**Null field handling (P2.R6):** Null fields within a signal (e.g., `clientQuote: null`) are omitted from the metadata object entirely — not included as `client_quote: null`. This keeps metadata clean for downstream filtering and display.

**Metadata key convention:** Metadata keys use `snake_case` to match the database `jsonb` column convention and the `session_embeddings.metadata` field. The mapping from TypeScript camelCase to metadata snake_case:

| TypeScript field | Metadata key |
|-----------------|-------------|
| `clientName` (from sessionMeta) | `client_name` |
| `sessionDate` (from sessionMeta) | `session_date` |
| `clientQuote` | `client_quote` |
| `severity` | `severity` |
| `priority` | `priority` |
| `competitor` | `competitor` |
| `sentiment` | `sentiment` |
| `name` (tool/platform) | `name` |
| `type` (tool/platform) | `type` |
| `categoryName` (custom) | `category_name` |

##### `chunkRawNotes` — fallback for raw-only sessions (P2.R4)

Splits `rawNotes` by double newline (`\n\n`), trims each paragraph, filters out empty strings, and produces one chunk per paragraph:

- `chunkType`: `raw`
- `chunkText`: the trimmed paragraph text
- `metadata`: `{ client_name, session_date }` only

If the entire `rawNotes` string is empty or contains only whitespace, returns an empty array.

##### Helper: `buildBaseMetadata`

Internal (not exported) helper that constructs the `{ client_name, session_date }` base metadata from `SessionMeta`. Every chunk's metadata is spread from this base plus type-specific fields.

##### Helper: `omitNullValues`

Internal (not exported) helper that takes a `Record<string, unknown>` and returns a new object with all `null` and `undefined` values removed. Applied to every chunk's metadata before returning.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/types/embedding-chunk.ts` | **Create** | `ChunkType`, `EmbeddingChunk`, `SessionMeta` type definitions |
| `lib/services/chunking-service.ts` | **Create** | `chunkStructuredSignals()` and `chunkRawNotes()` pure functions |

### Implementation

#### Increment 2.1: Type Definitions

**What:** Create the `EmbeddingChunk` interface, `ChunkType` union, and `SessionMeta` interface.

**Steps:**

1. Create `lib/types/embedding-chunk.ts` with the type definitions from the section above.
2. Verify the file exports: `ChunkType`, `EmbeddingChunk`, `SessionMeta`.

**Verification:**

- Run `npx tsc --noEmit` — no type errors from the new file.

#### Increment 2.2: Chunking Service

**What:** Implement both chunking functions and internal helpers.

**Steps:**

1. Create `lib/services/chunking-service.ts`.
2. Import `ExtractedSignals` from `@/lib/schemas/extraction-schema` and `EmbeddingChunk`, `SessionMeta`, `ChunkType` from `@/lib/types/embedding-chunk`.
3. Implement `buildBaseMetadata(meta: SessionMeta)` — returns `{ client_name: meta.clientName, session_date: meta.sessionDate }`.
4. Implement `omitNullValues(obj: Record<string, unknown>)` — filters out null/undefined entries.
5. Implement `chunkStructuredSignals()` following the chunking rules table above. Process sections in order: summary → client profile → pain points → requirements → aspirations → competitive mentions → blockers → tools & platforms → custom categories.
6. Implement `chunkRawNotes()` — split on `\n\n`, trim, filter empties, produce `raw` chunks.

**Verification:**

1. Run `npx tsc --noEmit` — no type errors.
2. Verify purity: the file has no imports from `next/server`, `@supabase/supabase-js`, or any fetch/HTTP library.
3. Manual trace through each section with the extraction schema to confirm:
   - Summary always produces exactly 1 chunk.
   - Client profile produces 0 chunks when all fields null, 1 chunk otherwise.
   - Each signal array produces N chunks (one per item), 0 for empty arrays.
   - Custom categories with nested signals produce one chunk per signal, not one per category.
   - Null `clientQuote` fields are absent from metadata, not `null`.
   - Metadata keys are `snake_case`.

#### Increment 2.3: End-of-Part Audit

**What:** Run the full end-of-part audit checklist across all files created in Part 2. This increment produces fixes, not a report.

**Checklist:**

1. **SRP violations** — `chunking-service.ts` does one thing (chunking). `embedding-chunk.ts` does one thing (type definitions). Helpers are internal, not leaked.
2. **DRY violations** — Confirm the base metadata construction is centralised in `buildBaseMetadata`, not duplicated per chunk type. Confirm `omitNullValues` is called from a single path, not copy-pasted.
3. **Design token adherence** — N/A (no UI components in this part).
4. **Logging** — N/A (pure functions with no I/O — logging is the caller's responsibility in Part 3).
5. **Dead code** — No unused imports, no unreachable branches, no exported symbols that nothing imports yet are acceptable (Part 3 will consume them).
6. **Convention compliance** — File names are kebab-case, types are PascalCase, functions are camelCase, named exports only, import order follows the project convention (React/Next → third-party → internal utilities → internal types).
7. **TypeScript strictness** — Run `npx tsc --noEmit`. Zero errors, zero `any` types.
8. **Purity verification** — Grep both files for prohibited imports (`next/server`, `@supabase`, `fetch`, `process.env`). Zero matches.

**Post-audit:**

- Update `ARCHITECTURE.md` — add `lib/types/embedding-chunk.ts` and `lib/services/chunking-service.ts` to the file map.
- Update `CHANGELOG.md` — record Part 2 completion.

---

## Part 3: Embedding Pipeline (Provider-Agnostic)

> Implements **P3.R1–P3.R10** from PRD-019.

### Overview

Build a provider-agnostic embedding service that converts text chunks into vector embeddings, a repository layer for persisting and querying embeddings in `session_embeddings`, and wire embedding generation into the session save and extraction flows so every saved session is searchable. The embedding service mirrors the existing `ai-service.ts` provider abstraction pattern — env vars select the provider and model, a provider map resolves the SDK call, and retry logic handles transient failures.

### Forward Compatibility Notes

- **Part 4 (Retrieval Service):** Calls `embedTexts()` to embed the user's query, then calls `embeddingRepo.similaritySearch()` to find matching chunks. The `SearchOptions` and `SimilarityResult` types defined here are consumed directly by the retrieval service.

### Technical Decisions

1. **OpenAI SDK for embeddings, Vercel AI SDK for generation.** The Vercel AI SDK does not expose an embedding API. The OpenAI provider package (`@ai-sdk/openai`) is already installed but only covers chat/completion models. Embeddings use the `openai` npm package directly. The provider map is extensible — adding Cohere or Voyage means adding one case to the map.

2. **Separate env vars from the AI service.** `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` are independent of `AI_PROVIDER` / `AI_MODEL`. This allows using OpenAI for embeddings while using Anthropic for extraction/synthesis — a common production pattern since OpenAI's embedding models are cost-effective and widely used.

3. **Dimension validation on first call.** The embedding service validates that `EMBEDDING_DIMENSIONS` matches the database column dimension on the first embedding call. A mismatch throws a clear `EmbeddingConfigError` with both values in the message, rather than letting Postgres produce a cryptic insertion error later.

4. **Fire-and-forget embedding in API routes.** Embedding generation after session save/extraction is non-blocking. The API route awaits the session save, returns the response to the client, and triggers embedding in a fire-and-forget pattern. Embedding failures are logged but never surface to the user or block the response. This matches P3.R6: "Embedding failures do not block the extraction."

5. **Service-role client for embedding writes.** The embedding repository uses the service-role Supabase client for inserts and deletes. This avoids RLS complexity during system-generated writes — RLS on `session_embeddings` protects reads (retrieval), while writes are trusted server-side operations that have already passed auth checks in the parent route.

6. **Embed on save for all sessions (Option A).** Per the updated P3.R9, every saved session gets embeddings — `chunkStructuredSignals()` when `structured_json` exists, `chunkRawNotes()` when only `raw_notes` is available. Re-extraction (P3.R7) deletes old embeddings and replaces them with structured ones.

### Embedding Service

#### `lib/services/embedding-service.ts` (P3.R1, P3.R2, P3.R3, P3.R4)

```typescript
// ---------------------------------------------------------------------------
// Provider resolution (mirrors ai-service.ts pattern)
// ---------------------------------------------------------------------------

type SupportedEmbeddingProvider = "openai";

interface EmbeddingProviderAdapter {
  embed(texts: string[], model: string, dimensions: number): Promise<number[][]>;
}

const PROVIDER_MAP: Record<SupportedEmbeddingProvider, () => EmbeddingProviderAdapter>;

function resolveEmbeddingProvider(): {
  adapter: EmbeddingProviderAdapter;
  model: string;
  dimensions: number;
  label: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function embedTexts(texts: string[]): Promise<number[][]>;
```

**Provider resolution (`resolveEmbeddingProvider`):**

- Reads `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` from `process.env`.
- If any are missing, throws `EmbeddingConfigError` with a descriptive message naming the missing variable.
- Validates `EMBEDDING_DIMENSIONS` parses to a positive integer.
- Looks up the provider in `PROVIDER_MAP`. If not found, throws `EmbeddingConfigError` listing supported providers.
- Returns the adapter, model string, parsed dimensions, and a human-readable label (`"openai/text-embedding-3-small"`).

**OpenAI adapter:**

```typescript
import OpenAI from "openai";

const openaiAdapter: EmbeddingProviderAdapter = {
  async embed(texts, model, dimensions) {
    const client = new OpenAI(); // reads OPENAI_API_KEY from env
    const response = await client.embeddings.create({
      model,
      input: texts,
      dimensions,
    });
    // Return in input order (OpenAI guarantees order matches input)
    return response.data.map((item) => item.embedding);
  },
};
```

**`embedTexts(texts)` (P3.R2):**

- If `texts` is empty, returns `[]` immediately (no API call).
- Resolves provider via `resolveEmbeddingProvider()`.
- Processes texts in batches of `EMBEDDING_BATCH_SIZE` (configurable constant, default 20) to respect rate limits (P3.R4).
- Each batch is wrapped in `withEmbeddingRetry()` (see below).
- Between batches, waits `EMBEDDING_BATCH_DELAY_MS` (configurable constant, default 200ms).
- Returns all embeddings as a flat `number[][]` in the same order as the input texts.

**Retry logic (`withEmbeddingRetry`) (P3.R3):**

Mirrors `withRetry` from `ai-service.ts` but is self-contained in `embedding-service.ts` (no shared import — the retry logic is internal to each service per SRP):

- Max retries: 3.
- Initial delay: 1000ms, exponential backoff (`delay * 2^attempt`).
- On 429: respect `Retry-After` header if present in the error response, otherwise use exponential backoff (P3.R4).
- On 5xx or network errors: retry with exponential backoff.
- On other 4xx (except 429): throw immediately as `EmbeddingRequestError` (config or input bug).
- After max retries exhausted: throw `EmbeddingServiceError`.

**Dimension validation (P3.R1 + defensive check):**

On the first call to `embedTexts()`, after receiving the first batch of embeddings from the provider, validate that the returned vector length matches `EMBEDDING_DIMENSIONS`. If mismatched, throw `EmbeddingConfigError` with the message: `"Embedding dimension mismatch: provider returned ${actual}-dimensional vectors but EMBEDDING_DIMENSIONS is set to ${expected}. The session_embeddings column is vector(${expected}). Update EMBEDDING_DIMENSIONS or the database column to match."`. This is a module-level flag (`dimensionValidated`) that flips to `true` after the first successful check — subsequent calls skip validation.

**Error classes:**

```typescript
export class EmbeddingServiceError extends Error { name = "EmbeddingServiceError"; }
export class EmbeddingConfigError extends EmbeddingServiceError { name = "EmbeddingConfigError"; }
export class EmbeddingRequestError extends EmbeddingServiceError { name = "EmbeddingRequestError"; }
export class EmbeddingRateLimitError extends EmbeddingServiceError { name = "EmbeddingRateLimitError"; }
```

### Embedding Repository

#### Interface: `lib/repositories/embedding-repository.ts` (P3.R5)

```typescript
export interface EmbeddingRow {
  id?: string;
  session_id: string;
  team_id: string | null;
  chunk_text: string;
  chunk_type: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  schema_version: number;
}

export interface SearchOptions {
  teamId: string | null;
  maxResults: number;
  chunkTypes?: string[];
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  similarityThreshold?: number;
}

export interface SimilarityResult {
  id: string;
  sessionId: string;
  chunkText: string;
  chunkType: string;
  metadata: Record<string, unknown>;
  similarityScore: number;
}

export interface EmbeddingRepository {
  upsertChunks(chunks: EmbeddingRow[]): Promise<void>;
  deleteBySessionId(sessionId: string): Promise<void>;
  similaritySearch(
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<SimilarityResult[]>;
}
```

#### Implementation: `lib/repositories/supabase/supabase-embedding-repository.ts`

```typescript
export function createEmbeddingRepository(
  serviceClient: SupabaseClient,
  teamId: string | null
): EmbeddingRepository;
```

**`upsertChunks(chunks)` (P3.R5):**

- If `chunks` is empty, returns immediately.
- Uses `serviceClient.from("session_embeddings").insert(chunks)` for bulk insert.
- Embedding vectors are passed as arrays — Supabase's PostgREST client handles `vector` column serialisation.
- Logs entry (chunk count, session_id from first chunk) and exit (success or error).

**`deleteBySessionId(sessionId)` (P3.R5):**

- Uses `serviceClient.from("session_embeddings").delete().eq("session_id", sessionId)`.
- Logs entry (session_id) and exit (success or error).

**`similaritySearch(queryEmbedding, options)` (P3.R5):**

- Calls a Postgres RPC function `match_session_embeddings` that performs the cosine similarity search server-side. This is more efficient than fetching all embeddings and computing similarity in JavaScript.
- The RPC function is created as part of this increment's migration:

```sql
CREATE OR REPLACE FUNCTION match_session_embeddings(
  query_embedding vector(1536),
  match_count INT,
  similarity_threshold FLOAT DEFAULT 0.3,
  filter_team_id UUID DEFAULT NULL,
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
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    se.id,
    se.session_id,
    se.chunk_text,
    se.chunk_type,
    se.metadata,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM session_embeddings se
  INNER JOIN sessions s ON s.id = se.session_id AND s.deleted_at IS NULL
  WHERE
    (filter_team_id IS NULL AND se.team_id IS NULL
     OR se.team_id = filter_team_id)
    AND (filter_chunk_types IS NULL
     OR se.chunk_type = ANY(filter_chunk_types))
    AND (filter_client_name IS NULL
     OR se.metadata->>'client_name' = filter_client_name)
    AND (filter_date_from IS NULL
     OR (se.metadata->>'session_date')::date >= filter_date_from)
    AND (filter_date_to IS NULL
     OR (se.metadata->>'session_date')::date <= filter_date_to)
    AND 1 - (se.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

- The adapter calls this function via `serviceClient.rpc("match_session_embeddings", { ... })` and maps the result rows to `SimilarityResult[]`.
- Logs entry (options summary) and exit (result count).

**Why `SECURITY DEFINER`:** The RPC function needs to read from `session_embeddings` and join to `sessions`. Using `SECURITY DEFINER` with the function owner (service role) bypasses RLS for this server-side search operation. The team scoping is enforced by the `filter_team_id` parameter, which the application layer always provides from the authenticated user's active workspace.

**Why join to `sessions WHERE deleted_at IS NULL`:** Embeddings for soft-deleted sessions remain in the database (no application-level cleanup). The join ensures they are excluded from search results without requiring a separate cleanup job.

### Wiring Into Session Flows

#### Embedding orchestrator: `lib/services/embedding-orchestrator.ts` (P3.R6, P3.R7, P3.R9)

A thin coordination layer that ties together the chunking service, embedding service, and embedding repository. This keeps the orchestration logic out of API routes (which should only validate and delegate) and out of the individual services (which should remain single-responsibility).

```typescript
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type { SessionMeta } from "@/lib/types/embedding-chunk";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";

/**
 * Generates embeddings for a session and persists them.
 * If the session has structured_json, chunks via chunkStructuredSignals().
 * Otherwise, falls back to chunkRawNotes() for raw-only sessions.
 *
 * On re-extraction: caller should pass isReExtraction=true to delete
 * existing embeddings before generating new ones (P3.R7).
 *
 * Embedding failures are logged but never thrown — this function
 * swallows errors so it can be called fire-and-forget (P3.R6).
 */
export async function generateSessionEmbeddings(options: {
  sessionMeta: SessionMeta;
  structuredJson: ExtractedSignals | null;
  rawNotes: string;
  embeddingRepo: EmbeddingRepository;
  isReExtraction?: boolean;
}): Promise<void>;
```

**Flow:**

1. If `isReExtraction`, call `embeddingRepo.deleteBySessionId(sessionMeta.sessionId)` (P3.R7).
2. Chunk: if `structuredJson` is non-null, call `chunkStructuredSignals(structuredJson, sessionMeta)`. Else call `chunkRawNotes(rawNotes, sessionMeta)`.
3. If chunks array is empty (raw notes with no paragraphs, or structured JSON with only empty arrays), log and return early.
4. Call `embedTexts(chunks.map(c => c.chunkText))` to get vectors.
5. Map chunks + vectors into `EmbeddingRow[]`.
6. Call `embeddingRepo.upsertChunks(rows)`.
7. Log success: session ID, chunk count, chunk types breakdown.

**Error handling:** The entire function body is wrapped in a try/catch. On any error, log the error with full context (session ID, step that failed, error message) and return — never rethrow. This ensures embedding failures are invisible to the caller and never block the session save or extraction response.

#### API route changes

**`app/api/sessions/route.ts` (POST) — embed on create (P3.R6, P3.R9):**

After `createSession()` succeeds and the response is returned, trigger embedding generation fire-and-forget:

```typescript
// After session save succeeds — fire-and-forget embedding
const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
generateSessionEmbeddings({
  sessionMeta: {
    sessionId: session.id,
    clientName: parsed.data.clientName || session.clientName,
    sessionDate: parsed.data.sessionDate,
    teamId,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  },
  structuredJson: parsed.data.structuredJson as ExtractedSignals | null,
  rawNotes: parsed.data.rawNotes,
  embeddingRepo,
}).catch(() => {}); // swallowed — orchestrator already logs
```

The `.catch(() => {})` is intentional — it prevents unhandled promise rejections while the orchestrator's internal try/catch handles logging. The `catch` on the promise is a safety net for any edge case where the orchestrator's own error handling fails.

**`app/api/sessions/[id]/route.ts` (PUT) — embed on update/re-extraction (P3.R6, P3.R7):**

After `updateSession()` succeeds:

```typescript
const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
generateSessionEmbeddings({
  sessionMeta: {
    sessionId: id,
    clientName: session.clientName,
    sessionDate: parsed.data.sessionDate,
    teamId,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  },
  structuredJson: parsed.data.isExtraction
    ? (parsed.data.structuredJson as ExtractedSignals | null)
    : null, // non-extraction updates don't re-embed structured data
  rawNotes: parsed.data.rawNotes,
  embeddingRepo,
  isReExtraction: parsed.data.isExtraction,
}).catch(() => {});
```

**Note on non-extraction updates:** When a user edits metadata (client name, date) or raw notes without re-extracting, the `isExtraction` flag is `false`. In this case we still re-generate embeddings because the raw notes or metadata may have changed. The orchestrator deletes old embeddings (via `isReExtraction: true` — we set this to `true` on any update, not just extractions) and generates fresh ones. This ensures embeddings always reflect the latest session content.

**Correction to the above:** On further consideration, every PUT that changes content should re-embed. Set `isReExtraction: true` for all PUT calls to ensure stale embeddings are replaced.

**`app/api/sessions/[id]/route.ts` (DELETE) — cascade handled by FK (P3.R8):**

No changes needed. The `ON DELETE CASCADE` foreign key on `session_embeddings.session_id` handles cleanup when the session is hard-deleted. For soft deletes, the `match_session_embeddings` function's join to `sessions WHERE deleted_at IS NULL` excludes embeddings of soft-deleted sessions from search results.

### Environment Variables (P3.R10)

Add to `.env.example`:

```
# Embedding provider — which embedding service to use
# Supported: openai
EMBEDDING_PROVIDER=openai

# Embedding model — provider-specific model identifier
# Examples: text-embedding-3-small (openai), text-embedding-3-large (openai)
EMBEDDING_MODEL=text-embedding-3-small

# Embedding dimensions — must match the vector column in session_embeddings
# text-embedding-3-small default: 1536
EMBEDDING_DIMENSIONS=1536
```

`OPENAI_API_KEY` is already in `.env.example` (used by the AI service for OpenAI generation). It is shared by the embedding service when `EMBEDDING_PROVIDER=openai`.

### Database Migration

#### `002-match-session-embeddings-rpc.sql`

Contains the `match_session_embeddings` RPC function defined in the Embedding Repository section above. This is a separate migration from Part 1's table creation.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/services/embedding-service.ts` | **Create** | Provider-agnostic embedding service — `embedTexts()`, retry logic, dimension validation |
| `lib/services/embedding-orchestrator.ts` | **Create** | Coordination layer — `generateSessionEmbeddings()` ties chunking → embedding → persistence |
| `lib/repositories/embedding-repository.ts` | **Create** | `EmbeddingRepository` interface + types (`EmbeddingRow`, `SearchOptions`, `SimilarityResult`) |
| `lib/repositories/supabase/supabase-embedding-repository.ts` | **Create** | Supabase adapter — `upsertChunks()`, `deleteBySessionId()`, `similaritySearch()` via RPC |
| `lib/repositories/index.ts` | **Modify** | Re-export `EmbeddingRepository` and related types |
| `lib/repositories/supabase/index.ts` | **Modify** | Re-export `createEmbeddingRepository` factory |
| `app/api/sessions/route.ts` | **Modify** | Wire fire-and-forget embedding into POST (session create) |
| `app/api/sessions/[id]/route.ts` | **Modify** | Wire fire-and-forget embedding into PUT (session update/re-extraction) |
| `.env.example` | **Modify** | Add `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` |
| `docs/019-vector-search/002-match-session-embeddings-rpc.sql` | **Create** | Migration SQL for the `match_session_embeddings` RPC function |

### Implementation

#### Increment 3.1: Embedding Service

**What:** Create the provider-agnostic embedding service with OpenAI adapter, retry logic, batching, and dimension validation.

**Steps:**

1. Install `openai` npm package: `npm install openai`.
2. Create `lib/services/embedding-service.ts` with:
   - `resolveEmbeddingProvider()` reading env vars.
   - OpenAI adapter using `new OpenAI()`.
   - `withEmbeddingRetry()` with exponential backoff and 429/Retry-After handling.
   - `embedTexts()` with batching (default 20) and inter-batch delay (default 200ms).
   - Dimension validation on first call.
   - Error classes: `EmbeddingServiceError`, `EmbeddingConfigError`, `EmbeddingRequestError`, `EmbeddingRateLimitError`.

**Verification:**

- `npx tsc --noEmit` — no type errors.
- Confirm no imports from `next/server` (service is framework-agnostic).

#### Increment 3.2: Embedding Repository

**What:** Create the repository interface and Supabase adapter, plus the RPC migration.

**Steps:**

1. Create `lib/repositories/embedding-repository.ts` with the interface and types.
2. Create `lib/repositories/supabase/supabase-embedding-repository.ts` with the factory function and all three methods.
3. Create `docs/019-vector-search/002-match-session-embeddings-rpc.sql` with the `match_session_embeddings` function.
4. Update `lib/repositories/index.ts` — re-export `EmbeddingRepository`, `EmbeddingRow`, `SearchOptions`, `SimilarityResult`.
5. Update `lib/repositories/supabase/index.ts` — re-export `createEmbeddingRepository`.
6. Run the RPC migration against Supabase.

**Verification:**

- `npx tsc --noEmit` — no type errors.
- Confirm the RPC function exists: `SELECT proname FROM pg_proc WHERE proname = 'match_session_embeddings';`.

#### Increment 3.3: Embedding Orchestrator

**What:** Create the coordination layer that ties chunking, embedding, and persistence together.

**Steps:**

1. Create `lib/services/embedding-orchestrator.ts` with `generateSessionEmbeddings()`.
2. Confirm it imports from chunking-service, embedding-service, and embedding-repository only (no `next/server`, no Supabase client directly).

**Verification:**

- `npx tsc --noEmit` — no type errors.
- Read the file and confirm the try/catch wraps the entire body and never rethrows.

#### Increment 3.4: Wire Into API Routes + Env Vars

**What:** Modify the session POST and PUT routes to trigger fire-and-forget embedding, and update `.env.example`.

**Steps:**

1. Modify `app/api/sessions/route.ts` — add imports for `createEmbeddingRepository`, `generateSessionEmbeddings`, `EXTRACTION_SCHEMA_VERSION`; add fire-and-forget call after session create.
2. Modify `app/api/sessions/[id]/route.ts` — same imports; add fire-and-forget call after session update, with `isReExtraction: true` for all PUTs.
3. Update `.env.example` — add the three embedding env vars.

**Verification:**

- `npx tsc --noEmit` — no type errors.
- Read both route files and confirm the embedding call is not awaited — the promise floats with `.catch(() => {})` to prevent unhandled rejections, and the `return NextResponse.json()` follows immediately so the response is not blocked by embedding.
- Confirm `.env.example` has the new variables.

#### Increment 3.5: End-of-Part Audit

**What:** Run the full end-of-part audit checklist across all files created and modified in Part 3.

**Checklist:**

1. **SRP violations** — `embedding-service.ts` handles provider resolution and API calls. `embedding-orchestrator.ts` handles coordination. `embedding-repository.ts` handles persistence. `supabase-embedding-repository.ts` handles Supabase-specific queries. No file does two jobs.
2. **DRY violations** — Retry logic is self-contained per service (not shared with `ai-service.ts` — intentional per SRP since the error types differ). Confirm no duplicate code between embedding-service and ai-service beyond the structural retry pattern.
3. **Design token adherence** — N/A (no UI components).
4. **Logging** — Confirm every public function and repository method logs entry (with input context), exit (with outcome), and errors (with full message). Confirm `embedding-orchestrator.ts` logs at each step.
5. **Dead code** — No unused imports or unreachable branches. Confirm all error classes are used.
6. **Convention compliance** — kebab-case files, PascalCase types, camelCase functions, named exports, correct import order. Repository follows existing interface + supabase-adapter pattern.
7. **TypeScript strictness** — `npx tsc --noEmit`. Zero errors, zero `any` types (except the one allowed in `scope-by-team.ts` which is pre-existing).
8. **Environment variables** — Confirm `.env.example` documents all three new variables. Confirm `ARCHITECTURE.md` env vars section (if one exists) is updated.

**Post-audit:**

- Update `ARCHITECTURE.md` — add new files to file map, add `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` to any env vars documentation, update the Current State section.
- Update `CHANGELOG.md` — record Part 3 completion.

---

## Part 4: Retrieval Service

> Implements **P4.R1–P4.R7** from PRD-019.

### Overview

Build a framework-agnostic retrieval service that takes a user's natural-language query, classifies it to determine retrieval depth, embeds the query on the fly (never persisted), searches `session_embeddings` via cosine similarity, deduplicates results, and returns ranked, metadata-rich `RetrievalResult[]`. This is the final piece of the vector search infrastructure — the public API that PRD-020 (RAG Chat) and PRD-021 (AI Insights Dashboard) will consume.

### Technical Decisions

1. **Query embeddings are ephemeral.** The user's query is embedded solely to compute cosine similarity against stored session embeddings. The query vector is never persisted. Storing query vectors would add write overhead and storage cost for no retrieval benefit — they're transient, user-specific, and don't contribute to the searchable corpus. If query analytics become valuable later (popular themes, unanswered queries), a separate lightweight table logging raw query text and result counts is the appropriate solution — not vector storage.

2. **Lightweight LLM classification via the existing AI service.** Query classification (broad/specific/comparative) reuses `resolveModel()` from `ai-service.ts` and the Vercel AI SDK's `generateObject()` with a Zod schema. This avoids a second provider abstraction. The classification prompt is short (<200 tokens system + query), and the response is structured JSON — `generateObject()` guarantees schema conformance. The model used is the same as `AI_MODEL` (configurable via env). If a cheaper/faster model is preferred for classification alone, that's a future optimisation (new env var like `CLASSIFICATION_MODEL`) — not Part 4 scope.

3. **Classification failure defaults to broad retrieval.** If the LLM call fails (timeout, rate limit, malformed response), the retrieval service falls back to `{ type: "broad" }` with 15 chunks. This ensures search always works even when the classification step fails. The failure is logged but does not surface to the caller.

4. **Deduplication by exact text match, not embedding similarity.** Identical chunk text appearing in multiple sessions (rare but possible with shared notes or copy-pasted feedback) is deduplicated by keeping only the highest-scoring instance. This is a simple `Map<string, RetrievalResult>` keyed by `chunkText` — no fuzzy matching needed at this stage. Near-duplicate detection is a backlog item.

5. **Retrieval service owns the chunk count mapping, not the caller.** The service maps classification types to chunk counts internally. Callers can override via `maxChunks` in `RetrievalOptions`, but the default behaviour is adaptive. This keeps the retrieval logic self-contained — the chat interface (PRD-020) just passes the query and gets appropriately-scoped results without needing to know about classification.

6. **No caching of query embeddings or results.** Each call to `retrieveRelevantChunks()` embeds the query fresh and runs the similarity search. At the expected query volume (interactive chat, not batch processing), the latency cost of one embedding call + one RPC is acceptable (~200-400ms total). Caching introduces cache invalidation complexity (new sessions, re-extractions) that isn't justified at this scale.

### Type Definitions

#### `lib/types/retrieval-result.ts` (P4.R6)

```typescript
import type { ChunkType } from "@/lib/types/embedding-chunk";

/**
 * Classification of a user query to determine retrieval depth.
 */
export type QueryClassification = "broad" | "specific" | "comparative";

/**
 * Structured output from the query classification LLM call.
 */
export interface ClassificationResult {
  type: QueryClassification;
  entities?: string[];
}

/**
 * Options for the retrieval service.
 */
export interface RetrievalOptions {
  /** Required — scopes search to the user's current workspace. */
  teamId: string | null;
  /** Optional — override the adaptive chunk count. */
  maxChunks?: number;
  /** Optional — filter by specific chunk types. */
  chunkTypes?: ChunkType[];
  /** Optional — filter by client name (exact match). */
  clientName?: string;
  /** Optional — filter by date range (inclusive). */
  dateFrom?: string;
  /** Optional — filter by date range (inclusive). */
  dateTo?: string;
}

/**
 * A single retrieval result with similarity score and full metadata.
 * Consumed by PRD-020 (RAG Chat) and PRD-021 (AI Insights Dashboard).
 */
export interface RetrievalResult {
  chunkText: string;
  similarityScore: number;
  sessionId: string;
  clientName: string;
  sessionDate: string;
  chunkType: ChunkType;
  metadata: Record<string, unknown>;
}
```

**Why `ChunkType` instead of `string` for `chunkType`:** The retrieval result is a public interface consumed by downstream features. Using the typed union ensures consumers get autocomplete and type safety when filtering or displaying results. The `SimilarityResult` from the repository uses `string` (it's the database-facing layer), and the retrieval service maps it to the typed `ChunkType` at the boundary.

### Service Design

#### `lib/services/retrieval-service.ts` (P4.R1, P4.R2, P4.R3, P4.R4, P4.R5, P4.R7)

```typescript
import type { RetrievalOptions, RetrievalResult, ClassificationResult } from "@/lib/types/retrieval-result";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";

/**
 * Retrieves relevant embedding chunks for a natural-language query.
 *
 * Flow:
 *   1. Classify the query (LLM call) → determines chunk count.
 *   2. Embed the query (embedding service) → produces query vector.
 *   3. Similarity search (embedding repository RPC) → ranked chunks.
 *   4. Deduplicate by exact chunk text → highest score wins.
 *   5. Map to RetrievalResult[] → return to caller.
 *
 * Framework-agnostic: no imports from next/server or HTTP concepts.
 */
export async function retrieveRelevantChunks(
  query: string,
  options: RetrievalOptions,
  embeddingRepo: EmbeddingRepository
): Promise<RetrievalResult[]>;
```

**Why `embeddingRepo` is a parameter, not internally constructed:** The retrieval service doesn't know how to create a Supabase client or which client type to use. The caller (an API route) creates the repository with the appropriate client and passes it in — matching the dependency injection pattern used by the orchestrator in Part 3.

##### Step 1: Query Classification (P4.R3)

```typescript
import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/services/ai-service";

const classificationSchema = z.object({
  type: z.enum(["broad", "specific", "comparative"]),
  entities: z.array(z.string()).optional(),
});

async function classifyQuery(query: string): Promise<ClassificationResult>;
```

**Classification prompt:**

```
System:
You are a query classifier for a client feedback search system.
Classify the user's query into one of three categories:

- "broad": General questions about patterns, trends, or aggregates across multiple clients or topics. Examples: "What are the main pain points?", "Summarise all feedback.", "What themes keep coming up?"
- "specific": Questions about a particular client, topic, or narrow subject. Examples: "What did Acme Corp say about pricing?", "Any feedback about API performance?", "Show me blockers from last month."
- "comparative": Questions comparing two or more clients, topics, or time periods. Examples: "How does Client A's feedback differ from Client B?", "Compare onboarding vs. pricing complaints.", "What changed between Q1 and Q2?"

For comparative queries, also extract the entities being compared as a string array in the "entities" field.

Respond with JSON only.

User:
{query}
```

**`classifyQuery()` implementation:**

- Calls `generateObject()` with `resolveModel()`, the classification prompt, and `classificationSchema`.
- Sets `maxTokens: 150` — the response is a tiny JSON object.
- Wraps the entire call in a try/catch. On any failure (timeout, rate limit, parse error), logs the error and returns `{ type: "broad" }` as the fallback (P4.R3).
- Logs: query (truncated to 100 chars for privacy), classification result, and latency.

##### Step 2: Chunk Count Mapping

```typescript
const CHUNK_COUNT_MAP: Record<QueryClassification, number> = {
  broad: 15,
  specific: 6,
  comparative: 10,
};

const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
```

- If `options.maxChunks` is provided, it overrides the adaptive count entirely.
- For `comparative` queries, the `entities` array from classification is not used to multiply the count in this implementation — the flat count of 10 serves comparative queries adequately since the RPC already returns the top-N most similar chunks which naturally span the compared entities. Entity-aware retrieval (fetching N per entity) is a backlog optimisation.

##### Step 3: Embed the Query (P4.R2)

```typescript
import { embedTexts } from "@/lib/services/embedding-service";

const [queryEmbedding] = await embedTexts([query]);
```

- Embeds the raw query string as a single text. The embedding service handles batching internally — for a single text, there's no batching overhead.
- The returned `queryEmbedding` is a `number[]` — never persisted, used only for the similarity search call that follows.

##### Step 4: Similarity Search (P4.R2)

```typescript
const rawResults = await embeddingRepo.similaritySearch(queryEmbedding, {
  teamId: options.teamId,
  maxResults: resolvedMaxChunks,
  chunkTypes: options.chunkTypes,
  clientName: options.clientName,
  dateFrom: options.dateFrom,
  dateTo: options.dateTo,
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
});
```

- Passes all filters through to the repository, which delegates to the `match_session_embeddings` RPC (defined in Part 3).
- The similarity threshold (default 0.3) is applied server-side in the RPC — chunks below this score are excluded before results leave the database (P4.R4).

##### Step 5: Deduplication (P4.R5)

```typescript
function deduplicateResults(results: SimilarityResult[]): SimilarityResult[] {
  const seen = new Map<string, SimilarityResult>();
  for (const result of results) {
    const existing = seen.get(result.chunkText);
    if (!existing || result.similarityScore > existing.similarityScore) {
      seen.set(result.chunkText, result);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => b.similarityScore - a.similarityScore
  );
}
```

- Keyed by exact `chunkText` match — if the same text appears from multiple sessions, only the highest-scoring instance survives.
- Re-sorts after deduplication to maintain descending similarity order.
- This is a pure function, internal to the retrieval service (not exported).

##### Step 6: Map to RetrievalResult[] (P4.R2, P4.R6)

```typescript
function toRetrievalResult(result: SimilarityResult): RetrievalResult {
  return {
    chunkText: result.chunkText,
    similarityScore: result.similarityScore,
    sessionId: result.sessionId,
    clientName: (result.metadata.client_name as string) ?? "Unknown",
    sessionDate: (result.metadata.session_date as string) ?? "",
    chunkType: result.chunkType as ChunkType,
    metadata: result.metadata,
  };
}
```

- `clientName` and `sessionDate` are extracted from the metadata object (where they were stored by the chunking service in Part 2) and promoted to top-level fields for consumer convenience.
- `chunkType` is cast from `string` (repository layer) to `ChunkType` (typed union). This is safe because the chunking service only produces valid `ChunkType` values — the cast is a boundary translation, not an unsafe narrowing.

##### Full `retrieveRelevantChunks()` flow

```typescript
export async function retrieveRelevantChunks(
  query: string,
  options: RetrievalOptions,
  embeddingRepo: EmbeddingRepository
): Promise<RetrievalResult[]> {
  const logger = `[retrieval-service]`;

  // 1. Classify
  const classification = await classifyQuery(query);
  const resolvedMaxChunks = options.maxChunks ?? CHUNK_COUNT_MAP[classification.type];
  console.log(`${logger} Query classified as "${classification.type}", fetching ${resolvedMaxChunks} chunks`);

  // 2. Embed the query
  const [queryEmbedding] = await embedTexts([query]);

  // 3. Similarity search
  const rawResults = await embeddingRepo.similaritySearch(queryEmbedding, {
    teamId: options.teamId,
    maxResults: resolvedMaxChunks,
    chunkTypes: options.chunkTypes,
    clientName: options.clientName,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  });
  console.log(`${logger} Similarity search returned ${rawResults.length} results`);

  // 4. Deduplicate
  const deduped = deduplicateResults(rawResults);
  if (deduped.length < rawResults.length) {
    console.log(`${logger} Deduplicated ${rawResults.length} → ${deduped.length} results`);
  }

  // 5. Map to RetrievalResult[]
  return deduped.map(toRetrievalResult);
}
```

**Error handling:** Unlike the embedding orchestrator (which swallows all errors for fire-and-forget), the retrieval service **does** throw on embedding or search failures. The caller (an API route) needs to know retrieval failed so it can return an appropriate HTTP error or fallback message. Only the classification step swallows errors (with a fallback to broad). This is intentional: classification is a "nice to have" optimisation, but embedding and search are the core operation.

### Prompt File

#### `lib/prompts/classify-query.ts`

Following the project convention of version-controlled prompts:

```typescript
export const CLASSIFY_QUERY_SYSTEM_PROMPT = `You are a query classifier for a client feedback search system.
Classify the user's query into one of three categories:

- "broad": General questions about patterns, trends, or aggregates across multiple clients or topics. Examples: "What are the main pain points?", "Summarise all feedback.", "What themes keep coming up?"
- "specific": Questions about a particular client, topic, or narrow subject. Examples: "What did Acme Corp say about pricing?", "Any feedback about API performance?", "Show me blockers from last month."
- "comparative": Questions comparing two or more clients, topics, or time periods. Examples: "How does Client A's feedback differ from Client B?", "Compare onboarding vs. pricing complaints.", "What changed between Q1 and Q2?"

For comparative queries, also extract the entities being compared as a string array in the "entities" field.

Respond with JSON only.`;

export const CLASSIFY_QUERY_MAX_TOKENS = 150;
```

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/types/retrieval-result.ts` | **Create** | `RetrievalResult`, `RetrievalOptions`, `QueryClassification`, `ClassificationResult` types |
| `lib/services/retrieval-service.ts` | **Create** | `retrieveRelevantChunks()` — classification → embed → search → deduplicate → map |
| `lib/prompts/classify-query.ts` | **Create** | Version-controlled classification prompt and max tokens constant |

### Implementation

#### Increment 4.1: Type Definitions

**What:** Create the `RetrievalResult`, `RetrievalOptions`, `QueryClassification`, and `ClassificationResult` types.

**Steps:**

1. Create `lib/types/retrieval-result.ts` with all type definitions from the section above.
2. Verify exports: `QueryClassification`, `ClassificationResult`, `RetrievalOptions`, `RetrievalResult`.

**Verification:**

- Run `npx tsc --noEmit` — no type errors from the new file.
- Confirm `ChunkType` is imported from `@/lib/types/embedding-chunk` (not redefined).

#### Increment 4.2: Classification Prompt

**What:** Create the version-controlled classification prompt file.

**Steps:**

1. Create `lib/prompts/classify-query.ts` with the system prompt and max tokens constant.
2. Verify exports: `CLASSIFY_QUERY_SYSTEM_PROMPT`, `CLASSIFY_QUERY_MAX_TOKENS`.

**Verification:**

- Run `npx tsc --noEmit` — no type errors.
- Confirm no imports from `next/server` or any SDK — this is a pure data file.

#### Increment 4.3: Retrieval Service

**What:** Implement the full retrieval service with classification, embedding, search, deduplication, and mapping.

**Steps:**

1. Create `lib/services/retrieval-service.ts`.
2. Import from: `ai` (generateObject), `zod` (z), `@/lib/services/ai-service` (resolveModel), `@/lib/services/embedding-service` (embedTexts), `@/lib/repositories/embedding-repository` (EmbeddingRepository, SimilarityResult), `@/lib/types/retrieval-result` (all types), `@/lib/types/embedding-chunk` (ChunkType), `@/lib/prompts/classify-query` (prompt + max tokens).
3. Implement `classifyQuery()` — internal function, not exported. Uses `generateObject()` with the Zod schema. Wraps in try/catch, falls back to `{ type: "broad" }` on any failure.
4. Implement `deduplicateResults()` — internal function, not exported. Keyed by exact `chunkText`, keeps highest score, re-sorts.
5. Implement `toRetrievalResult()` — internal function, not exported. Maps `SimilarityResult` to `RetrievalResult` with `clientName`/`sessionDate` promoted from metadata.
6. Implement `retrieveRelevantChunks()` — exported. Follows the 5-step flow: classify → embed → search → deduplicate → map.
7. Add logging at each step: classification result, chunk count, search result count, deduplication count (if applicable).

**Verification:**

1. Run `npx tsc --noEmit` — no type errors.
2. Verify framework-agnostic: grep the file for `next/server` — zero matches (P4.R7).
3. Read the file and confirm:
   - `classifyQuery()` swallows errors and returns `{ type: "broad" }` on failure.
   - `retrieveRelevantChunks()` does NOT swallow errors from `embedTexts()` or `similaritySearch()` — these propagate to the caller.
   - `DEFAULT_SIMILARITY_THRESHOLD` is `0.3`.
   - `CHUNK_COUNT_MAP` has correct values: broad=15, specific=6, comparative=10.
   - `options.maxChunks` overrides adaptive count when provided.
   - Deduplication keeps the highest-scoring instance per unique `chunkText`.
   - `toRetrievalResult()` correctly extracts `client_name` and `session_date` from metadata.

#### Increment 4.4: End-of-Part Audit

**What:** Run the full end-of-part audit checklist across all files created in Part 4. This increment produces fixes, not a report.

**Checklist:**

1. **SRP violations** — `retrieval-service.ts` orchestrates the retrieval flow. `retrieval-result.ts` defines types. `classify-query.ts` stores the prompt. Each file does one thing.
2. **DRY violations** — Confirm `resolveModel()` is reused from `ai-service.ts`, not reimplemented. Confirm `embedTexts()` is reused from `embedding-service.ts`. Confirm `similaritySearch()` is called via the repository interface, not reimplemented.
3. **Design token adherence** — N/A (no UI components in this part).
4. **Logging** — Confirm `retrieveRelevantChunks()` logs: classification result, resolved chunk count, search result count, deduplication delta (if any). Confirm `classifyQuery()` logs: query (truncated), result, latency, and errors on failure.
5. **Dead code** — No unused imports, no unreachable branches, no exported symbols that nothing yet consumes (downstream PRDs will consume `retrieveRelevantChunks()`, but it must be exported now).
6. **Convention compliance** — File names are kebab-case, types are PascalCase, functions are camelCase, named exports only, import order follows the project convention (React/Next → third-party → internal utilities → internal services → internal types).
7. **TypeScript strictness** — Run `npx tsc --noEmit`. Zero errors, zero `any` types.
8. **Framework-agnostic verification** — Grep `retrieval-service.ts` for `next/server`, `NextRequest`, `NextResponse` — zero matches. Grep for `@supabase` — zero matches (it uses the repository interface, not the Supabase client directly).

**Post-audit:**

- Update `ARCHITECTURE.md` — add `lib/types/retrieval-result.ts`, `lib/services/retrieval-service.ts`, and `lib/prompts/classify-query.ts` to the file map. Update the Current State section to reflect PRD-019 Part 4 completion.
- Update `CHANGELOG.md` — record Part 4 completion.

---

## End-of-PRD Audit

> Run after Part 4 completes. This is the final audit for the entire PRD-019.

**Checklist:**

1. Run the full end-of-part audit checklist across ALL files touched by PRD-019 (Parts 1–4).
2. Verify `ARCHITECTURE.md` file map is complete and accurate — every file, directory, route, and doc folder that exists in the codebase must be reflected:
   - `lib/types/embedding-chunk.ts`
   - `lib/types/retrieval-result.ts`
   - `lib/services/chunking-service.ts`
   - `lib/services/embedding-service.ts`
   - `lib/services/embedding-orchestrator.ts`
   - `lib/services/retrieval-service.ts`
   - `lib/repositories/embedding-repository.ts`
   - `lib/repositories/supabase/supabase-embedding-repository.ts`
   - `lib/prompts/classify-query.ts`
   - `docs/019-vector-search/` (PRD, TRD, migration files)
3. Verify `CHANGELOG.md` has entries for all four completed parts.
4. Run `npx tsc --noEmit` for a final type check across the entire codebase.
5. Verify all environment variables (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) are documented in both `.env.example` and `ARCHITECTURE.md`.
6. Verify the `match_session_embeddings` RPC function exists and matches the TRD specification.
7. This audit produces fixes and documentation updates, not a report.
