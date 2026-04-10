# TRD-019: Vector Search Infrastructure

> **Status:** Draft (Part 1)
> **PRD:** `docs/019-vector-search/prd.md` (approved)
> **Mirrors:** PRD Parts 1–4. Only Part 1 is detailed below. Subsequent parts will be added as each prior part completes.

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
