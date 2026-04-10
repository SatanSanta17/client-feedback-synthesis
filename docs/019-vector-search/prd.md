# PRD-019: Vector Search Infrastructure

> **Master PRD Section:** Section 19 — Vector Search Infrastructure
> **Status:** Draft
> **Deliverable:** Session extraction data is embedded as semantic vectors in pgvector, enabling similarity-based retrieval of relevant signal chunks by meaning. This infrastructure is consumed by the RAG chat interface (PRD-020) and the AI insights dashboard (PRD-021).

## Purpose

The structured JSON output from PRD-018 gives us queryable, typed extraction data. But structured data alone only supports exact-match queries — you can filter by sentiment or urgency, but you cannot ask "what are clients saying about onboarding?" and get semantically relevant results across all sessions.

Vector search solves this. Each signal chunk (pain point, requirement, aspiration, etc.) is converted into a numeric embedding that captures its meaning. Similar meanings produce similar embeddings. When a user asks a question, the question is embedded the same way, and the closest chunks are retrieved — regardless of whether the exact words match.

This PRD builds four things: the vector storage layer (pgvector on Supabase), a chunking service that splits structured JSON into embeddable units, an embedding pipeline that converts chunks to vectors on extraction, and a retrieval service that finds relevant chunks for a given query. Together, these form the search backbone that the chat interface and dashboard will consume.

## User Story

"As a user who has captured multiple client sessions, I want the system to understand the meaning of my feedback data so that downstream features can retrieve relevant insights based on what I'm asking about — not just keyword matches."

---

## Part 1: pgvector Setup and Embeddings Table

**Scope:** Enable the pgvector extension on Supabase, create the `session_embeddings` table with appropriate schema, RLS policies, and indexes for efficient similarity search.

### Requirements

- **P1.R1** Enable the `pgvector` extension on the Supabase instance via a migration (`CREATE EXTENSION IF NOT EXISTS vector`).

- **P1.R2** Create the `session_embeddings` table with the following columns:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `session_id` — UUID, foreign key to `sessions.id`, NOT NULL. On session delete, cascade delete embeddings.
  - `team_id` — UUID, nullable (null for personal workspace, populated for team context). Mirrors the scoping pattern used in `sessions`.
  - `chunk_text` — text, NOT NULL. The human-readable text of the chunk that was embedded.
  - `chunk_type` — text, NOT NULL. One of: `summary`, `client_profile`, `pain_point`, `requirement`, `aspiration`, `competitive_mention`, `blocker`, `tool_and_platform`, `custom`, `raw`. Stored as text (not a Postgres enum) to allow adding new types without a migration.
  - `metadata` — jsonb, NOT NULL, default `'{}'`. Contains type-specific fields: `client_name`, `session_date`, `severity`, `priority`, `competitor`, `category_name` (for custom chunks), `client_quote`, and any other contextual data from the signal chunk.
  - `embedding` — vector column. Dimension is determined by the configured embedding model (1536 for OpenAI `text-embedding-3-small`). NOT NULL.
  - `schema_version` — integer, NOT NULL, default `1`. Matches the `schemaVersion` from the extraction schema, enabling future schema-aware retrieval.
  - `created_at` — timestamptz, NOT NULL, default `now()`.

- **P1.R3** Create an index on the `embedding` column for efficient similarity search. Use HNSW (Hierarchical Navigable Small World) index type as it provides better query performance than IVFFlat for the expected data volume (thousands of chunks, not millions): `CREATE INDEX ON session_embeddings USING hnsw (embedding vector_cosine_ops)`.

- **P1.R4** Enable Row-Level Security on `session_embeddings`. Policies:
  - Embeddings are readable by any authenticated user within the same team context (team_id matches or both are null for personal workspace). This is team-scoped (not user-private) because retrieval needs to search across all sessions the user has access to.
  - Embeddings are insertable, updatable, and deletable only by authenticated users within the same team context.
  - Policy pattern matches the existing `sessions` table RLS.

- **P1.R5** Add a composite index on `(session_id)` for efficient cascade deletes and re-extraction cleanup (delete all embeddings for a given session before regenerating).

- **P1.R6** Add a composite index on `(team_id, chunk_type)` for filtered similarity searches (e.g., "search only pain points within my team").

### Acceptance Criteria

- [ ] pgvector extension is enabled on the Supabase instance
- [ ] `session_embeddings` table exists with all specified columns and correct types
- [ ] HNSW index exists on the `embedding` column
- [ ] RLS is enabled with team-scoped read/write policies matching `sessions` table pattern
- [ ] Cascade delete works: deleting a session removes its embeddings
- [ ] Composite indexes exist on `(session_id)` and `(team_id, chunk_type)`
- [ ] Migration is documented in the TRD and applied cleanly

---

## Part 2: Chunking Logic

**Scope:** Build a chunking service that takes a session's `structured_json` (from PRD-018) and produces an array of typed, metadata-rich chunks ready for embedding. This is a pure function with no database calls or side effects.

### Requirements

- **P2.R1** Create a chunking service in `lib/services/chunking-service.ts` that exports a function `chunkStructuredSignals(structuredJson: ExtractedSignals, sessionMeta: SessionMeta): EmbeddingChunk[]`. The `SessionMeta` parameter carries: `sessionId`, `clientName`, `sessionDate`, `teamId`, `schemaVersion`.

- **P2.R2** The chunking function produces one chunk per discrete signal item:
  - **Summary** — one chunk from the `summary` field. chunk_type: `summary`. Metadata: `{ client_name, session_date }`.
  - **Client profile** — one chunk combining industry, geography, and budget range into a readable sentence. chunk_type: `client_profile`. Metadata: `{ client_name, session_date, industry, geography, budget_range }`. If all profile fields are null, skip this chunk.
  - **Pain points** — one chunk per item. chunk_type: `pain_point`. chunk_text is the `text` field. Metadata includes `severity`, `client_quote` (if present), `client_name`, `session_date`.
  - **Requirements** — one chunk per item. chunk_type: `requirement`. Metadata includes `severity`, `priority`, `client_quote`, `client_name`, `session_date`.
  - **Aspirations** — one chunk per item. chunk_type: `aspiration`. Metadata includes `severity`, `client_quote`, `client_name`, `session_date`.
  - **Competitive mentions** — one chunk per item. chunk_type: `competitive_mention`. chunk_text is the `context` field. Metadata includes `competitor`, `sentiment`, `client_name`, `session_date`.
  - **Blockers** — one chunk per item. chunk_type: `blocker`. Metadata includes `severity`, `client_quote`, `client_name`, `session_date`.
  - **Tools and platforms** — one chunk per item. chunk_type: `tool_and_platform`. chunk_text is the `context` field. Metadata includes `name`, `type` (tool/platform/competitor), `client_name`, `session_date`.
  - **Custom categories** — one chunk per signal in each custom category. chunk_type: `custom`. Metadata includes `category_name`, `severity`, `client_quote`, `client_name`, `session_date`.

- **P2.R3** Define the `EmbeddingChunk` interface in `lib/types/embedding-chunk.ts`:
  ```
  interface EmbeddingChunk {
    chunkText: string
    chunkType: ChunkType
    metadata: Record<string, unknown>
    sessionId: string
    teamId: string | null
    schemaVersion: number
  }
  ```
  where `ChunkType` is a union type of all valid chunk type strings.

- **P2.R4** Build a separate function `chunkRawNotes(rawNotes: string, sessionMeta: SessionMeta): EmbeddingChunk[]` for sessions that have no `structured_json`. This splits raw notes by paragraphs (double newline), filters out empty paragraphs, and produces one chunk per paragraph with chunk_type: `raw`. Metadata includes `client_name` and `session_date` only.

- **P2.R5** The chunking functions are pure: no database access, no API calls, no side effects. They receive data and return an array. This makes them independently testable.

- **P2.R6** Empty signal arrays produce no chunks (not a chunk with empty text). Null fields within a signal (e.g., null `clientQuote`) are omitted from metadata, not included as null values.

### Acceptance Criteria

- [ ] `chunkStructuredSignals()` produces correct chunks for all schema sections
- [ ] Each chunk has the correct `chunkType` and complete metadata
- [ ] Client profile chunk is skipped when all profile fields are null
- [ ] Empty arrays produce zero chunks, not empty-text chunks
- [ ] Null fields within signals are omitted from metadata
- [ ] `chunkRawNotes()` produces paragraph-level chunks for raw-only sessions
- [ ] Both functions are pure with no side effects
- [ ] `EmbeddingChunk` interface and `ChunkType` type are exported from `lib/types/`

---

## Part 3: Embedding Pipeline (Provider-Agnostic)

**Scope:** Build a provider-agnostic embedding service that converts text chunks into vector embeddings, and wire it into the extraction flow so embeddings are generated automatically when a session is extracted.

### Requirements

- **P3.R1** Create an embedding service in `lib/services/embedding-service.ts` with a provider-agnostic architecture mirroring the AI service pattern:
  - `EMBEDDING_PROVIDER` env var (e.g., `openai`). Determines which SDK to use.
  - `EMBEDDING_MODEL` env var (e.g., `text-embedding-3-small`). Determines which model to call.
  - `EMBEDDING_DIMENSIONS` env var (e.g., `1536`). Specifies the vector dimension for the configured model. This must match the vector column size in the database.
  - A provider map that resolves the provider string to the appropriate SDK call. Initially supports OpenAI; the map is extensible to other providers (Anthropic, Google, Cohere, etc.) by adding a new case.

- **P3.R2** The embedding service exports `embedTexts(texts: string[]): Promise<number[][]>` — takes an array of text strings, returns an array of embedding vectors. Batch embedding (multiple texts in one API call) is used where the provider supports it to minimize API calls and latency.

- **P3.R3** The embedding service includes retry logic matching the AI service pattern: retry transient failures (429, 5xx, network errors) up to 3 times with exponential backoff. Do not retry 4xx errors (except 429). Log all errors with context.

- **P3.R4** Add rate limiting awareness: if the embedding provider returns 429 (rate limited), respect the `Retry-After` header if present, otherwise use exponential backoff. For batch operations (embedding many chunks from one session), process in batches of a configurable size (default 20 chunks per API call) with a configurable delay between batches.

- **P3.R5** Create an embedding repository in `lib/repositories/embedding-repository.ts` (interface) and `lib/repositories/supabase/supabase-embedding-repository.ts` (implementation) with methods:
  - `upsertChunks(chunks: EmbeddingRow[]): Promise<void>` — bulk insert embedding rows.
  - `deleteBySessionId(sessionId: string): Promise<void>` — delete all embeddings for a session.
  - `similaritySearch(queryEmbedding: number[], options: SearchOptions): Promise<SimilarityResult[]>` — cosine similarity search with metadata filtering (team_id, chunk_type, date range, client name). Returns chunks ranked by similarity score.

- **P3.R6** Wire embedding generation into the extraction flow. After `extractSignals()` succeeds and the session is saved with `structured_json`:
  1. Chunk the structured JSON via `chunkStructuredSignals()`.
  2. Embed all chunks via `embedTexts()`.
  3. Upsert the embedding rows into `session_embeddings`.
  This happens server-side in the extraction API route, after the session save succeeds. Embedding failures do not block the extraction — if embedding fails, log the error and continue. The session is saved with its structured JSON regardless. Embeddings can be retried later.

- **P3.R7** On re-extraction (user extracts a session that already has embeddings): delete existing embeddings for that session via `deleteBySessionId()`, then generate new embeddings from the new extraction. This ensures embeddings always reflect the latest extraction.

- **P3.R8** On session deletion: embeddings are cascade-deleted via the foreign key constraint (P1.R2). No additional application logic needed.

- **P3.R9** For sessions with no `structured_json` but with `raw_notes` (raw-only sessions): embed on save using `chunkRawNotes()` as the chunking strategy. This follows the same save-time embedding flow as extracted sessions — after the session is saved, chunk the raw notes and generate embeddings. This ensures every saved session is searchable regardless of whether extraction has been run. If the session is later extracted, the re-extraction flow (P3.R7) deletes the raw-note embeddings and replaces them with structured-JSON embeddings.

- **P3.R10** Add the following environment variables to the application configuration:
  - `EMBEDDING_PROVIDER` — required, string (e.g., `openai`).
  - `EMBEDDING_MODEL` — required, string (e.g., `text-embedding-3-small`).
  - `EMBEDDING_DIMENSIONS` — required, integer (e.g., `1536`).
  - `OPENAI_API_KEY` — required when `EMBEDDING_PROVIDER=openai`. Used exclusively for embeddings; separate from `AI_PROVIDER`/`AI_MODEL` used for extraction and synthesis.

### Acceptance Criteria

- [ ] Embedding service resolves provider and model from environment variables
- [ ] `embedTexts()` returns correct-dimension vectors for input texts
- [ ] Batch embedding processes multiple texts per API call where supported
- [ ] Retry logic handles 429 and 5xx errors with exponential backoff
- [ ] Rate limiting respects configurable batch size and inter-batch delay
- [ ] Embedding repository supports upsert, delete by session, and similarity search
- [ ] Extraction flow auto-generates embeddings after successful extraction
- [ ] Embedding failure does not block extraction — session saves regardless
- [ ] Re-extraction deletes old embeddings and generates new ones
- [ ] Session deletion cascade-deletes embeddings
- [ ] Raw-only sessions are embedded on save via `chunkRawNotes()`, and re-extraction replaces raw embeddings with structured ones
- [ ] All new environment variables are documented

---

## Part 4: Retrieval Service

**Scope:** Build the retrieval service that takes a user's natural-language query, embeds it, searches the vector database, and returns ranked, metadata-rich results. This service includes adaptive retrieval logic that adjusts the number of results based on query type.

### Requirements

- **P4.R1** Create a retrieval service in `lib/services/retrieval-service.ts` that exports `retrieveRelevantChunks(query: string, options: RetrievalOptions): Promise<RetrievalResult[]>`. The `RetrievalOptions` include: `teamId` (required — scopes to current workspace), `maxChunks` (optional override), `filters` (optional — client name, date range, chunk types to include/exclude).

- **P4.R2** The retrieval flow:
  1. Classify the query to determine retrieval depth (see P4.R3).
  2. Embed the query text using the embedding service.
  3. Execute similarity search via the embedding repository with team scoping and any metadata filters.
  4. Return results as `RetrievalResult[]` where each result contains: `chunkText`, `similarityScore`, `sessionId`, `clientName`, `sessionDate`, `chunkType`, and the full `metadata` object.

- **P4.R3** Adaptive retrieval: before searching, classify the query to determine how many chunks to retrieve. Classification categories:
  - **Broad** (15-20 chunks) — general questions about patterns, trends, or aggregates. Examples: "What are the main pain points?", "Summarise all feedback."
  - **Specific** (5-8 chunks) — questions about a particular client, topic, or narrow subject. Examples: "What did Client X say about pricing?", "Any feedback about API performance?"
  - **Comparative** (10 chunks per entity) — questions comparing two or more clients or topics. Examples: "How does Client A's feedback differ from Client B?", "Compare onboarding vs. pricing complaints."
  Classification is done via a lightweight LLM call with a short system prompt that returns a structured response (`{ type: 'broad' | 'specific' | 'comparative', entities?: string[] }`). If the classification call fails, default to broad (15 chunks) as a safe fallback. The classification model should be the fastest/cheapest available (e.g., GPT-4o-mini or equivalent).

- **P4.R4** The retrieval service applies a minimum similarity threshold. Chunks below a configurable score (default 0.3) are excluded even if they would otherwise fill the result count. This prevents returning irrelevant chunks for highly specific queries that have few true matches.

- **P4.R5** Results are deduplicated: if the same signal chunk text appears in multiple sessions (unlikely but possible with shared notes), return only the highest-scoring instance. Deduplication is based on exact text match, not embedding similarity.

- **P4.R6** The `RetrievalResult` interface is defined in `lib/types/retrieval-result.ts`:
  ```
  interface RetrievalResult {
    chunkText: string
    similarityScore: number
    sessionId: string
    clientName: string
    sessionDate: string
    chunkType: ChunkType
    metadata: Record<string, unknown>
  }
  ```

- **P4.R7** The retrieval service is framework-agnostic: it does not import from `next/server` or reference HTTP concepts. It is a pure service function callable from any API route, background job, or future agent.

### Acceptance Criteria

- [ ] `retrieveRelevantChunks()` returns ranked chunks with similarity scores and metadata
- [ ] Adaptive retrieval classifies queries and adjusts chunk count accordingly
- [ ] Classification failure defaults to broad retrieval (15 chunks)
- [ ] Minimum similarity threshold filters out irrelevant results
- [ ] Results are deduplicated by exact chunk text match
- [ ] Team scoping is enforced — only chunks from the user's current workspace are returned
- [ ] Metadata filters (client name, date range, chunk type) work correctly
- [ ] Service is framework-agnostic with no HTTP/Next.js imports
- [ ] `RetrievalResult` interface is exported from `lib/types/`

---

## Backlog (deferred from this PRD)

- Backfill embeddings for existing sessions that have `structured_json` but were extracted before the embedding pipeline was wired in
- Re-embedding batch job for when embedding model/provider is switched (different models produce incompatible vectors)
- Hybrid search: combine vector similarity with keyword search (Postgres full-text search) for better precision on exact-match queries
- Embedding analytics: track which chunks are most frequently retrieved, which sessions have the densest embedding clusters
- Multi-vector embeddings: embed the same chunk with multiple models for ensemble retrieval
- Chunk overlap: add context from adjacent chunks (e.g., include the session summary as prefix to each signal chunk) to improve retrieval quality for context-dependent signals
- Embedding compression: reduce vector dimensions for storage efficiency at scale
- Cross-team embedding search for admin/org-level analytics (requires new RLS policies)
