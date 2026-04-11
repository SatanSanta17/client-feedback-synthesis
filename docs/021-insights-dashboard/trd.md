# TRD-021: AI-Powered Insights Dashboard

> **Status:** Parts 1–3 implemented. Parts 4–6 pending.
> **PRD:** `docs/021-insights-dashboard/prd.md` (approved)
> **Mirrors:** PRD Parts 1–6. Each part is written and reviewed one at a time. Parts 4–6 will be added after their preceding parts are implemented.

---

## Part 1: Theme Assignment at Extraction Time

> Implements **P1.R1–P1.R10** from PRD-021.

### Overview

Extend the extraction flow so that each signal chunk is assigned to a persistent, workspace-scoped theme. Two new tables (`themes`, `signal_themes`) store the theme entities and their many-to-many relationship with embeddings. A new `theme-service.ts` orchestrates a single LLM call per extraction that classifies every chunk, strongly preferring existing themes over creating new ones. Theme assignment is **chained after embedding generation** (it needs embedding IDs for the junction table), but the entire chain is fire-and-forget — it runs asynchronously after the session response is returned, adding zero latency to the user-facing flow. Failures are swallowed, matching the embedding orchestrator pattern.

### Technical Decisions

1. **Fire-and-forget chained call.** Theme assignment needs embedding IDs to create `signal_themes` rows, so it is chained after embedding generation: `generateSessionEmbeddings().then(assignSessionThemes).catch(devWarnCatch)`. The entire chain is fire-and-forget — the session API response is returned immediately, and the async chain runs in the background. If embedding generation fails, theme assignment is skipped (no embedding IDs to link to). If theme assignment fails after embeddings succeed, embeddings are preserved — the user just doesn't get theme assignments until re-extraction.

2. **One LLM call per extraction, not per chunk.** The theme assignment prompt receives all signal texts from the extraction in a single call and returns assignments for all of them. This is both cheaper (one API call) and produces more coherent assignments (the model sees the full context of the session when deciding themes). The payload is lightweight — only signal texts and existing theme names, no raw notes or embedding vectors.

3. **`generateObject()` with Zod schema for structured response.** Following the `extractSignals()` pattern in `ai-service.ts`, theme assignment uses `generateObject()` with a Zod schema to validate the LLM's response at parse time. This eliminates manual JSON parsing and gives typed output. The schema enforces the expected array structure with `signalIndex`, `themes[]`, `isNew`, and `confidence` fields.

4. **Repository pattern for `themes` and `signal_themes`.** Following the codebase convention (`embedding-repository.ts`, `session-repository.ts`, etc.), create `ThemeRepository` and `SignalThemeRepository` interfaces with Supabase adapters. The theme service depends on these interfaces, not Supabase directly. This maintains Dependency Inversion and keeps the service testable.

5. **Service-role client for theme writes, anon for reads.** Theme creation during extraction happens in a fire-and-forget server context where the user's session cookie may not be propagated reliably. The service-role client bypasses RLS for writes (creating new themes, inserting `signal_themes` rows). RLS still governs all read paths (dashboard widgets, theme lists). This matches how embedding writes use the service-role client via `createEmbeddingRepository(serviceClient, teamId)`.

6. **Unique theme names scoped by workspace via partial unique index.** Rather than relying on the LLM to perfectly match existing theme names, the database enforces uniqueness at the index level: `UNIQUE (LOWER(name), team_id) WHERE team_id IS NOT NULL` for teams and `UNIQUE (LOWER(name), initiated_by) WHERE team_id IS NULL` for personal workspaces. If the LLM suggests a "new" theme that already exists (case-insensitive), the service catches the unique violation and resolves to the existing theme. This is a safety net — the prompt instructs the LLM to prefer existing themes, but the DB guarantees it.

7. **`origin` column instead of `created_by` on themes.** The `themes` table uses `initiated_by` (UUID FK → `auth.users`) for the user whose action triggered theme creation, and `origin` (text: `'ai'` | `'user'`) to distinguish AI-generated themes from future manually created ones. This avoids conflating "who triggered the action" with "what mechanism created the theme" and prevents breaking the `created_by` FK convention used elsewhere.

8. **Cascade delete via `signal_themes.embedding_id` FK.** When embeddings are deleted during re-extraction (`embeddingRepo.deleteBySessionId()`), the cascade on `signal_themes.embedding_id` automatically removes stale assignments. No explicit cleanup code is needed — the DB handles it. The new extraction then fires theme assignment again with the fresh chunks, creating new `signal_themes` rows linked to the new embedding IDs. Themes themselves are never deleted by re-extraction — only the assignments.

9. **Theme assignment prompt is topic-based, not type-based.** The prompt explicitly instructs the LLM that themes describe *what* a signal is about (e.g., "Onboarding Friction", "API Performance"), not *what kind* of signal it is (pain point, requirement, etc.) — `chunk_type` already captures the latter. This prevents the LLM from creating themes like "Pain Points" or "Requirements" which would duplicate chunk_type semantics.

10. **All chunks support multiple themes, with primary/secondary distinction via confidence.** A structured signal like "Our onboarding is slow and the API keeps timing out during import" genuinely spans both "Onboarding Friction" and "API Performance." Forcing one theme per structured chunk creates blind spots in the dashboard. Instead, the schema allows an array of themes for *all* chunk types. The LLM assigns one primary theme (confidence ≥ 0.8) and optionally adds secondary themes only when the signal substantively covers another topic — not for tangential mentions. For raw chunks, multi-theme assignments are more common and carry lower confidence (0.3–0.7) to reflect inherent ambiguity. Downstream widgets (Part 3) can filter by confidence threshold to control how secondary assignments affect counts and trends. The `signal_themes` junction table already supports this via multiple rows per `embedding_id` — no schema change needed.

11. **Dev-mode visible warnings for fire-and-forget failures.** All fire-and-forget `.catch(() => {})` calls are replaced with a dev-aware catch that emits a bright yellow `console.warn` in development mode: `.catch((err) => { if (process.env.NODE_ENV === 'development') console.warn('\x1b[33m⚠ [label] FAILED:\x1b[0m', err instanceof Error ? err.message : err); })`. This applies to both the existing embedding generation catches (`app/api/sessions/route.ts` POST line 167, `app/api/sessions/[id]/route.ts` PUT line 140) and the new theme assignment chain. In production, the catch still swallows — the internal orchestrators already log errors at the `console.error` level. This is a developer-experience improvement: the yellow ANSI warning is harder to miss in peripheral terminal vision than a standard log line, keeping the developer in browser flow while still surfacing failures.

### Forward Compatibility Notes

- **Part 2 (Dashboard Layout):** The direct widgets (sentiment, urgency, session volume) do not use the `themes` or `signal_themes` tables. Part 1 can be deployed independently — direct widgets work without themes.
- **Part 3 (Derived Theme Widgets):** Queries will join `signal_themes` → `themes` → `session_embeddings` → `sessions` to produce theme frequency counts, trends, and the theme-client matrix. The `theme_id` + `embedding_id` junction, combined with embedding metadata (`client_name`, `session_date`, `chunk_type`), provides all the join paths Part 3 needs. New `queryDatabase` actions will be added in Part 3's TRD.
- **Part 4 (Qualitative Drill-Down):** Clicking a theme data point will filter by `theme_id` through `signal_themes` to retrieve the actual signal texts. The `embedding_id` FK provides the join to `session_embeddings.chunk_text` and metadata.
- **Part 5 (Headline Insights):** The insight generation service will query theme aggregates (theme counts, trends) as input to the LLM. These are read-only queries against the same tables.
- **Backlog (Theme Management UI):** The `is_archived` column, `origin` column, and `description` field are all forward-compatible with a management UI. Archiving a theme excludes it from future assignments (the service filters `WHERE is_archived = false`) but preserves historical data. The `origin` column allows the UI to distinguish AI-created vs user-created themes.
- **Backlog (Manual Theme Assignment):** The `signal_themes.assigned_by` column (`'ai'` | `'user'`) already supports this. A future UI can insert rows with `assigned_by = 'user'` and `confidence = NULL`.
- **Backlog (Backfill):** Existing sessions extracted before Part 1 have embeddings but no `signal_themes` rows. A backfill job would read chunks from `session_embeddings`, call `assignSessionThemes()` per session, and insert `signal_themes` rows. The service already handles the case where no themes exist (cold start).

### Database Migrations

#### Migration 1: `themes` table

```sql
CREATE TABLE themes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  initiated_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origin        TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'user')),
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique theme names per team (case-insensitive)
CREATE UNIQUE INDEX themes_name_team_unique
  ON themes (LOWER(name), team_id)
  WHERE team_id IS NOT NULL AND is_archived = false;

-- Unique theme names per personal workspace (case-insensitive)
CREATE UNIQUE INDEX themes_name_personal_unique
  ON themes (LOWER(name), initiated_by)
  WHERE team_id IS NULL AND is_archived = false;

-- Index for fetching active themes by workspace (used by theme service before each assignment)
CREATE INDEX themes_team_active_idx
  ON themes (team_id)
  WHERE is_archived = false;

-- Auto-update updated_at trigger (reuse existing function)
CREATE TRIGGER themes_updated_at
  BEFORE UPDATE ON themes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

-- SELECT: team members can read team themes; personal workspace owner reads own
CREATE POLICY themes_select ON themes
  FOR SELECT USING (
    CASE
      WHEN team_id IS NOT NULL THEN is_team_member(team_id)
      ELSE initiated_by = auth.uid()
    END
  );

-- INSERT: authenticated users can create themes in their workspace
CREATE POLICY themes_insert ON themes
  FOR INSERT WITH CHECK (
    CASE
      WHEN team_id IS NOT NULL THEN is_team_member(team_id)
      ELSE initiated_by = auth.uid()
    END
  );

-- UPDATE: team admins/owners can update team themes; personal workspace owner updates own
CREATE POLICY themes_update ON themes
  FOR UPDATE USING (
    CASE
      WHEN team_id IS NOT NULL THEN is_team_admin(team_id)
      ELSE initiated_by = auth.uid()
    END
  ) WITH CHECK (
    CASE
      WHEN team_id IS NOT NULL THEN is_team_admin(team_id)
      ELSE initiated_by = auth.uid()
    END
  );

-- DELETE: same as UPDATE (admins/owners only for team; owner for personal)
CREATE POLICY themes_delete ON themes
  FOR DELETE USING (
    CASE
      WHEN team_id IS NOT NULL THEN is_team_admin(team_id)
      ELSE initiated_by = auth.uid()
    END
  );
```

#### Migration 2: `signal_themes` junction table

```sql
CREATE TABLE signal_themes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  embedding_id  UUID NOT NULL REFERENCES session_embeddings(id) ON DELETE CASCADE,
  theme_id      UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  assigned_by   TEXT NOT NULL DEFAULT 'ai' CHECK (assigned_by IN ('ai', 'user')),
  confidence    REAL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate assignments (same embedding + theme)
CREATE UNIQUE INDEX signal_themes_embedding_theme_unique
  ON signal_themes (embedding_id, theme_id);

-- Index for querying all signals in a theme (Part 3 widgets, Part 4 drill-down)
CREATE INDEX signal_themes_theme_id_idx
  ON signal_themes (theme_id);

-- Index for querying all themes for an embedding (display on signal detail)
CREATE INDEX signal_themes_embedding_id_idx
  ON signal_themes (embedding_id);

-- RLS
ALTER TABLE signal_themes ENABLE ROW LEVEL SECURITY;

-- SELECT: derived from embedding access — if user can see the embedding, they can see its theme assignments
CREATE POLICY signal_themes_select ON signal_themes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM session_embeddings
      WHERE session_embeddings.id = signal_themes.embedding_id
    )
  );

-- INSERT: derived from embedding access
CREATE POLICY signal_themes_insert ON signal_themes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM session_embeddings
      WHERE session_embeddings.id = signal_themes.embedding_id
    )
  );

-- UPDATE: derived from embedding access (for future manual reassignment)
CREATE POLICY signal_themes_update ON signal_themes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM session_embeddings
      WHERE session_embeddings.id = signal_themes.embedding_id
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM session_embeddings
      WHERE session_embeddings.id = signal_themes.embedding_id
    )
  );

-- DELETE: derived from embedding access
CREATE POLICY signal_themes_delete ON signal_themes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM session_embeddings
      WHERE session_embeddings.id = signal_themes.embedding_id
    )
  );
```

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/021-insights-dashboard/001-themes.sql` | **Create** | Migration 1: themes table + indexes + RLS |
| `docs/021-insights-dashboard/002-signal-themes.sql` | **Create** | Migration 2: signal_themes junction table + indexes + RLS |
| `lib/types/theme.ts` | **Create** | TypeScript types: `Theme`, `ThemeAssignment`, `ThemeAssignmentResult`, `LLMThemeResponse` |
| `lib/schemas/theme-assignment-schema.ts` | **Create** | Zod schema for theme assignment LLM response (used with `generateObject()`) |
| `lib/repositories/theme-repository.ts` | **Create** | `ThemeRepository` interface |
| `lib/repositories/signal-theme-repository.ts` | **Create** | `SignalThemeRepository` interface |
| `lib/repositories/supabase/supabase-theme-repository.ts` | **Create** | Supabase adapter for ThemeRepository |
| `lib/repositories/supabase/supabase-signal-theme-repository.ts` | **Create** | Supabase adapter for SignalThemeRepository |
| `lib/repositories/index.ts` | **Edit** | Re-export theme and signal-theme repository interfaces |
| `lib/repositories/supabase/index.ts` | **Edit** | Re-export theme and signal-theme repository factory functions |
| `lib/prompts/theme-assignment.ts` | **Create** | Theme assignment system prompt and user message builder |
| `lib/services/theme-service.ts` | **Create** | Theme assignment orchestrator — fetch themes, call LLM, create themes, insert assignments |
| `app/api/sessions/route.ts` | **Edit** | Chain theme assignment after embedding generation, fire-and-forget with dev-aware catch (POST) |
| `app/api/sessions/[id]/route.ts` | **Edit** | Chain theme assignment after embedding generation, fire-and-forget with dev-aware catch (PUT) |
| `lib/services/ai-service.ts` | **Edit** | Refactor into two public generics: `callModelText()` and `callModelObject<T>()`. Migrate all existing callers (`extractSignals`, `synthesiseMasterSignal`, `generateConversationTitle`) to use them. Theme service uses `callModelObject<ThemeAssignmentResponse>()`. |

### Type Definitions

#### `lib/types/theme.ts`

```typescript
export interface Theme {
  id: string;
  name: string;
  description: string | null;
  teamId: string | null;
  initiatedBy: string;
  origin: "ai" | "user";
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignalTheme {
  id: string;
  embeddingId: string;
  themeId: string;
  assignedBy: "ai" | "user";
  confidence: number | null;
  createdAt: string;
}

/** Shape of a single signal's theme assignment as returned by the LLM. */
export interface LLMThemeAssignment {
  signalIndex: number;
  themes: Array<{
    themeName: string;
    isNew: boolean;
    confidence: number;
    description?: string; // LLM-generated description for new themes only
  }>;
}

/** Result returned by assignSessionThemes() for logging/verification. */
export interface ThemeAssignmentResult {
  totalSignals: number;
  totalAssignments: number;
  newThemesCreated: number;
  existingThemesUsed: number;
}
```

#### `lib/schemas/theme-assignment-schema.ts`

```typescript
import { z } from "zod";

export const themeAssignmentItemSchema = z.object({
  signalIndex: z.number().int().min(0),
  themes: z.array(
    z.object({
      themeName: z.string().min(1).max(100),
      isNew: z.boolean(),
      confidence: z.number().min(0).max(1),
      description: z.string().max(200).optional(),
    })
  ).min(1),
});

export const themeAssignmentResponseSchema = z.object({
  assignments: z.array(themeAssignmentItemSchema),
});

export type ThemeAssignmentResponse = z.infer<typeof themeAssignmentResponseSchema>;
```

### Repository Interfaces

#### `lib/repositories/theme-repository.ts`

```typescript
import type { Theme } from "@/lib/types/theme";

export interface ThemeInsert {
  name: string;
  description: string | null;
  team_id: string | null;
  initiated_by: string;
  origin: "ai" | "user";
}

export interface ThemeUpdate {
  name?: string;
  description?: string | null;
  is_archived?: boolean;
}

export interface ThemeRepository {
  /** Fetch all active (non-archived) themes for a workspace. */
  getActiveByWorkspace(teamId: string | null, userId: string): Promise<Theme[]>;

  /** Get a single theme by ID. */
  getById(id: string): Promise<Theme | null>;

  /** Find a theme by name (case-insensitive) within a workspace. */
  findByName(name: string, teamId: string | null, userId: string): Promise<Theme | null>;

  /** Create a new theme. Returns the created theme. */
  create(data: ThemeInsert): Promise<Theme>;

  /** Update a theme. */
  update(id: string, data: ThemeUpdate): Promise<Theme>;
}
```

#### `lib/repositories/signal-theme-repository.ts`

```typescript
import type { SignalTheme } from "@/lib/types/theme";

export interface SignalThemeInsert {
  embedding_id: string;
  theme_id: string;
  assigned_by: "ai" | "user";
  confidence: number | null;
}

export interface SignalThemeRepository {
  /** Bulk insert signal-theme assignments. */
  bulkCreate(data: SignalThemeInsert[]): Promise<void>;

  /** Get all theme assignments for a list of embedding IDs. */
  getByEmbeddingIds(embeddingIds: string[]): Promise<SignalTheme[]>;

  /** Get all theme assignments for a theme. */
  getByThemeId(themeId: string): Promise<SignalTheme[]>;
}
```

### Service Design

#### `lib/services/theme-service.ts`

```typescript
import type { EmbeddingChunk } from "@/lib/types/embedding-chunk";
import type { ThemeRepository } from "@/lib/repositories/theme-repository";
import type { SignalThemeRepository } from "@/lib/repositories/signal-theme-repository";
import type { ThemeAssignmentResult } from "@/lib/types/theme";

/**
 * Assigns themes to a set of signal chunks from a single extraction.
 *
 * 1. Fetches active themes for the workspace.
 * 2. Builds the theme assignment prompt with signal texts + existing theme names.
 * 3. Calls the LLM (one call) to assign each signal to existing or new themes.
 * 4. Creates any new themes in the DB.
 * 5. Inserts signal_themes rows linking embeddings to themes.
 *
 * Swallows all errors — this function is called fire-and-forget.
 * Logs entry, exit, and errors.
 */
export async function assignSessionThemes(options: {
  chunks: EmbeddingChunk[];
  embeddingIds: string[];
  teamId: string | null;
  userId: string;
  themeRepo: ThemeRepository;
  signalThemeRepo: SignalThemeRepository;
}): Promise<ThemeAssignmentResult | null>;
```

**Internal flow:**

1. **Fetch active themes** — `themeRepo.getActiveByWorkspace(teamId, userId)`. Returns `Theme[]` with `id` and `name`.
2. **Build prompt** — pass chunk texts (with `chunkType` and metadata like `client_quote`) plus existing theme names to `buildThemeAssignmentUserMessage()`.
3. **Call LLM** — use `generateObject()` with `themeAssignmentResponseSchema`. Uses `resolveModel()` — same provider/model as extraction.
4. **Resolve themes** — for each assignment:
   - If `isNew === false`: look up the theme by name (case-insensitive) from the fetched list. If found, use its `id`.
   - If `isNew === true`: attempt `themeRepo.create()`. If it throws a unique constraint violation (theme was created by a concurrent extraction), fall back to `themeRepo.findByName()` to get the existing one.
5. **Bulk insert assignments** — collect all `SignalThemeInsert` rows and call `signalThemeRepo.bulkCreate()`.
6. **Return result** — counts for logging.

**Error handling:** The entire function body is wrapped in try/catch. Errors are logged with `[theme-service]` prefix and full context (session ID, chunk count, error message). The function returns `null` on failure. Callers (session routes) use the dev-aware catch (Technical Decision #11) as an additional safety net.

**Concurrency safety:** Two extractions running simultaneously for the same workspace might both try to create the same new theme. The unique index on `themes(LOWER(name), team_id)` prevents duplicates. The service catches the constraint violation and resolves to the existing theme. This is safe and idempotent.

#### `lib/services/ai-service.ts` — refactor

The current `ai-service.ts` has three issues:

1. `callModelObject()` is hardcoded to `extractionSchema` — can't be reused for theme assignment.
2. `callModel()` is private — `synthesiseMasterSignal()` uses it via a closure, but no other module can.
3. `generateConversationTitle()` has its own inline `generateText()` call that bypasses `withRetry()` entirely — it gets no retry logic for transient failures (429, 5xx). This is a bug from PRD-020.

**Refactor: two public generics that all LLM calls use.**

```typescript
// --- Public generic: text generation with retry ---

export async function callModelText(options: {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  operationName: string;
}): Promise<string>
```

Wraps `generateText()` + `withRetry()` + `resolveModel()`. Returns trimmed text. Throws `AIEmptyResponseError` on empty response.

```typescript
// --- Public generic: structured object generation with retry ---

export async function callModelObject<T>(options: {
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodSchema<T>;
  schemaName: string;
  maxTokens: number;
  operationName: string;
}): Promise<T>
```

Wraps `generateObject()` + `withRetry()` + `resolveModel()`. Returns validated object of type `T`.

**Migration of existing callers:**

| Caller | Current | After |
|--------|---------|-------|
| `extractSignals()` | Private `callModelObject()` (hardcoded `ExtractedSignals`) | `callModelObject<ExtractedSignals>({ schema: extractionSchema, ... })` |
| `synthesiseMasterSignal()` | Private `callModel()` | `callModelText({ ... })` |
| `generateConversationTitle()` | Inline `generateText()` with manual try/catch, **no retry** | `callModelText({ ... })` wrapped in try/catch returning `null` on failure. Now gets retry logic for transient failures. |
| `assignSessionThemes()` (new) | — | `callModelObject<ThemeAssignmentResponse>({ schema: themeAssignmentResponseSchema, ... })` |

The old private `callModel()` and `callModelObject()` functions are deleted — replaced entirely by the public generics. `withRetry()` remains private (internal implementation detail).

**`generateConversationTitle()` retains its fire-and-forget contract:** it still catches all errors and returns `null` on failure. The difference is that transient failures (429, 5xx, network) now get 3 retries with exponential backoff before giving up — matching every other LLM call in the system. The outer try/catch in `generateConversationTitle()` catches the final `AIServiceError` after retries are exhausted and returns `null`, same as before.

```typescript
export async function generateConversationTitle(
  firstMessage: string
): Promise<string | null> {
  try {
    const title = await callModelText({
      systemPrompt: GENERATE_TITLE_SYSTEM_PROMPT,
      userMessage: firstMessage,
      maxTokens: GENERATE_TITLE_MAX_TOKENS,
      operationName: "generateConversationTitle",
    });
    return title;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ai-service] generateConversationTitle — failed: ${message}`);
    return null;
  }
}
```

The streaming chat path (`streamText()` in `chat-stream-service.ts`) is unaffected — it uses the Vercel AI SDK's streaming API directly, not request/response. Only non-streaming LLM calls go through the two generics.

### Prompt Definition

#### `lib/prompts/theme-assignment.ts`

```typescript
export const THEME_ASSIGNMENT_SYSTEM_PROMPT = `...`;
export const THEME_ASSIGNMENT_MAX_TOKENS = 2048;

export function buildThemeAssignmentUserMessage(
  signals: Array<{ index: number; text: string; chunkType: string; clientQuote?: string }>,
  existingThemes: Array<{ name: string; description: string | null }>
): string;
```

**System prompt content:**

```
You are a theme classification analyst. Your job is to assign each signal from a client feedback session to the most appropriate topic-based theme.

## Rules

1. Themes describe WHAT a signal is about (e.g., "Onboarding Friction", "Pricing Concerns", "API Performance", "Data Migration"), NOT what type of signal it is. The chunk_type field already captures whether something is a pain point, requirement, blocker, etc. — do not duplicate that as a theme.
2. STRONGLY prefer assigning to an existing theme. Only suggest a new theme if the signal covers a topic genuinely not represented by any existing theme. When in doubt, use the closest existing theme.
3. New theme names should be concise (2-4 words), human-readable, and topic-focused. Include a one-sentence description explaining what the theme covers.
4. For ALL signal chunks (structured and raw): assign one PRIMARY theme with the highest confidence, and optionally one or more SECONDARY themes when the signal genuinely spans multiple topics. Only add secondary themes when the signal substantively covers another topic — not for tangential mentions.
5. For raw text chunks (chunk_type: "raw"): multiple themes are more common since raw paragraphs often mix topics. Report lower confidence scores (0.3–0.7) for raw chunk assignments.
6. Confidence scores: PRIMARY theme should be 0.8–1.0 for clear matches, 0.6–0.8 for reasonable matches. SECONDARY themes should be 0.5–0.7 to reflect they are not the main topic. For raw chunks, all assignments use 0.3–0.7. For new themes, use 0.8+ on the primary assignment (since you created the theme specifically for this signal).
7. Consider both the signal text and the client quote (if provided) when determining the theme.
8. Do not create themes that are too broad ("General Feedback") or too narrow ("Button Color on Page 3"). Aim for a level of specificity that would be useful for tracking trends across multiple sessions.
```

**User message builder:**

Constructs a message containing:
1. The existing theme list (name + description for each), or "No existing themes yet." if empty.
2. A numbered list of signals, each with: index, chunk_type, text, and client_quote (if available).

```
## Existing Themes

1. Onboarding Friction — Issues related to the onboarding experience and initial setup
2. API Performance — Concerns about API response times and reliability
...

## Signals to Classify

[0] (pain_point) "Users report confusion during the initial setup wizard, especially around connecting their data sources."
   Client quote: "We spent two days just trying to figure out the setup."

[1] (requirement) "Need single sign-on support for enterprise clients."
   Client quote: null

[2] (raw) "The client also mentioned they're evaluating Competitor X and are concerned about our pricing model relative to their team size. They want to see a demo of the dashboard before committing."
   Client quote: null
```

### Integration Points

#### `app/api/sessions/route.ts` (POST) — modifications

After session creation, the route currently fires embedding generation. The modification chains theme assignment after embedding generation, all within a single fire-and-forget promise:

```typescript
// Current (silent swallow):
generateSessionEmbeddings({ ... }).catch(() => {});

// After — chained fire-and-forget:
const chunks = structuredJson
  ? chunkStructuredSignals(structuredJson as ExtractedSignals, sessionMeta)
  : chunkRawNotes(rawNotes, sessionMeta);

generateSessionEmbeddings({ ...embeddingOptions, preComputedChunks: chunks })
  .then(async (embeddingIds) => {
    if (!embeddingIds || embeddingIds.length === 0) return;
    await assignSessionThemes({
      chunks,
      embeddingIds,
      teamId,
      userId: user.id,
      themeRepo,
      signalThemeRepo,
    });
  })
  .catch((err) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('\x1b[33m⚠ EMBEDDING+THEME CHAIN FAILED:\x1b[0m', err instanceof Error ? err.message : err);
    }
  });
```

This requires `generateSessionEmbeddings()` to **return** the persisted embedding IDs. Currently it returns `void`. We modify it to return `string[]` — the IDs of the created embedding rows. This is a minor change: `upsertChunks()` already inserts with `gen_random_uuid()` — we add a `.select('id')` to the insert and return the IDs.

The entire chain is fire-and-forget relative to the session response. The user gets the session response immediately; embedding + theme assignment happens asynchronously in the background. The PRD's "near-zero wall-clock time" requirement is about the user-facing response latency, not the internal sequencing of async tasks.

#### `lib/services/embedding-orchestrator.ts` — modifications

```typescript
// Current signature:
export async function generateSessionEmbeddings(options: { ... }): Promise<void>

// Modified signature:
export async function generateSessionEmbeddings(options: { ... }): Promise<string[]>
```

After `embeddingRepo.upsertChunks(rows)`, return the embedding IDs. This requires `upsertChunks()` to return inserted IDs. Modify `EmbeddingRepository.upsertChunks()` to return `string[]`. Update the Supabase adapter to add `.select('id')` to the insert query.

On error (catch block), return empty array `[]` instead of swallowing silently — this signals to the chained theme assignment that embeddings failed, and it should skip.

#### `app/api/sessions/[id]/route.ts` (PUT) — modifications

Same pattern as POST. The PUT handler already fires `generateSessionEmbeddings()` with `isReExtraction: true`. Chain `assignSessionThemes()` after it:

```typescript
generateSessionEmbeddings({ ...embeddingOptions, isReExtraction: true })
  .then(async (embeddingIds) => {
    if (!embeddingIds || embeddingIds.length === 0) return;
    await assignSessionThemes({
      chunks,
      embeddingIds,
      teamId,
      userId: user.id,
      themeRepo,
      signalThemeRepo,
    });
  })
  .catch((err) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('\x1b[33m⚠ EMBEDDING+THEME CHAIN FAILED:\x1b[0m', err instanceof Error ? err.message : err);
    }
  });
```

On re-extraction, cascade delete on `signal_themes.embedding_id` removes old assignments when old embeddings are deleted. New embeddings + new theme assignments are created by this chain.

### Implementation

#### Increment 1.1: Database Tables and Migrations

**What:** Create the `themes` and `signal_themes` tables with all columns, indexes, RLS policies, and triggers. Run migrations against Supabase. Regenerate TypeScript types.

**Steps:**

1. Create `docs/021-insights-dashboard/001-themes.sql` with the themes table DDL, unique indexes, active index, RLS policies, and `updated_at` trigger.
2. Create `docs/021-insights-dashboard/002-signal-themes.sql` with the signal_themes table DDL, unique index, FK indexes, and RLS policies.
3. Run both migrations against the Supabase instance.
4. Regenerate Supabase TypeScript types (`supabase gen types typescript`).
5. Verify tables, indexes, RLS, and triggers via Supabase dashboard or SQL queries.
6. Test RLS: confirm team member can read themes, non-member cannot. Confirm signal_themes access follows embedding access.

**Requirement coverage:** P1.R1 (themes table), P1.R2 (themes RLS), P1.R3 (signal_themes table), P1.R4 (signal_themes RLS).

#### Increment 1.2: Types, Repositories, and Schema

**What:** Create TypeScript types, Zod schema for LLM response, repository interfaces, and Supabase adapters. No service logic yet — this is the data access layer.

**Steps:**

1. Create `lib/types/theme.ts` with `Theme`, `SignalTheme`, `LLMThemeAssignment`, and `ThemeAssignmentResult` interfaces.
2. Create `lib/schemas/theme-assignment-schema.ts` with `themeAssignmentResponseSchema` (Zod) for `generateObject()` validation.
3. Create `lib/repositories/theme-repository.ts` (interface).
4. Create `lib/repositories/signal-theme-repository.ts` (interface).
5. Create `lib/repositories/supabase/supabase-theme-repository.ts` (adapter). `getActiveByWorkspace()` uses `scopeByTeam()` + `is_archived = false` filter. `findByName()` does case-insensitive match with `ilike`. `create()` returns the created theme. Maps snake_case → camelCase.
6. Create `lib/repositories/supabase/supabase-signal-theme-repository.ts` (adapter). `bulkCreate()` uses a single batch insert. `getByEmbeddingIds()` uses `IN` filter.
7. Update `lib/repositories/index.ts` and `lib/repositories/supabase/index.ts` with re-exports.
8. Verify: `npx tsc --noEmit` passes, all exports resolve.

**Requirement coverage:** P1.R1 (themes data model), P1.R3 (signal_themes data model), P1.R5 (theme service foundation — repository layer).

#### Increment 1.3: AI Service Refactor and Theme Assignment Prompt

**What:** Refactor `ai-service.ts` to expose two public generics (`callModelText`, `callModelObject<T>`) that all non-streaming LLM calls use. Migrate existing callers (`extractSignals`, `synthesiseMasterSignal`, `generateConversationTitle`). Create the theme assignment prompt. For `extractSignals` and `synthesiseMasterSignal`, this is a pure refactor with zero behavior change. For `generateConversationTitle`, this adds retry logic that was previously missing (PRD-020 bug fix) — the external contract (`string | null`) is unchanged, but transient failures now retry up to 3 times before returning `null`.

**Steps:**

1. In `lib/services/ai-service.ts`, create `callModelText()` — public, wraps `generateText()` + `withRetry()` + `resolveModel()`. Same logic as the current private `callModel()`, just public.
2. In `lib/services/ai-service.ts`, create `callModelObject<T>()` — public generic, wraps `generateObject()` + `withRetry()` + `resolveModel()`. Accepts any `z.ZodSchema<T>` plus a `schemaName` string.
3. Migrate `extractSignals()` to call `callModelObject<ExtractedSignals>({ schema: extractionSchema, schemaName: 'extractionSchema', ... })`. Verify the extraction flow still works identically.
4. Migrate `synthesiseMasterSignal()` to call `callModelText({ ... })`. Verify master signal generation still works identically.
5. Migrate `generateConversationTitle()` to call `callModelText({ ... })` inside its existing try/catch. This fixes the missing retry logic — title generation now gets 3 retries for transient failures (429, 5xx, network). The outer try/catch still returns `null` on final failure. Verify chat title generation still works.
6. Delete the old private `callModel()` and `callModelObject()` functions. Verify no remaining references.
7. Create `lib/prompts/theme-assignment.ts` with `THEME_ASSIGNMENT_SYSTEM_PROMPT`, `THEME_ASSIGNMENT_MAX_TOKENS`, and `buildThemeAssignmentUserMessage()`.
8. Verify: `npx tsc --noEmit` passes. Run manual tests: extract a session (extraction still works), generate a master signal (synthesis still works), start a chat conversation (title generation still works).

**Requirement coverage:** P1.R6 (theme assignment prompt), P1.R10 (same AI service pattern, provider-agnostic). Also fixes a PRD-020 bug: `generateConversationTitle()` now gets retry logic.

#### Increment 1.4: Theme Service and Embedding Orchestrator Modification

**What:** Create the theme assignment service. Modify the embedding orchestrator to return embedding IDs.

**Steps:**

1. Modify `EmbeddingRepository.upsertChunks()` to return `string[]` (inserted IDs). Update the interface and the Supabase adapter (add `.select('id')` to the insert query).
2. Modify `generateSessionEmbeddings()` to return `string[]` instead of `void`. On success, return the IDs from `upsertChunks()`. On error (catch block), return `[]`.
3. Create `lib/services/theme-service.ts` with `assignSessionThemes()`. Implements the full flow: fetch themes → build prompt → call LLM → resolve themes (create new / find existing) → bulk insert assignments.
4. Handle concurrent creation: wrap `themeRepo.create()` in try/catch. If unique constraint error, fall back to `themeRepo.findByName()`.
5. Add comprehensive logging: entry (session ID, chunk count, existing theme count), LLM response summary, new themes created, assignments inserted, exit or error.
6. Verify: `npx tsc --noEmit` passes.

**Requirement coverage:** P1.R5 (theme assignment service), P1.R7 (fire-and-forget pattern foundation), P1.R8 (raw chunk multi-theme support), P1.R9 (re-extraction cascade handled by DB + re-assignment in chain).

#### Increment 1.5: Wire into Extraction Flow

**What:** Wire `assignSessionThemes()` into both session routes (POST and PUT), chained after embedding generation.

**Steps:**

1. Edit `app/api/sessions/route.ts` (POST): after session creation, pre-compute chunks, fire `generateSessionEmbeddings().then(assignSessionThemes)` with dev-aware catch (Technical Decision #11).
2. Edit `app/api/sessions/[id]/route.ts` (PUT): same pattern, with `isReExtraction: true` for embeddings.
3. **Replace the existing silent `.catch(() => {})` calls** on both routes (POST line 167, PUT line 140) with the dev-aware catch pattern. These currently swallow embedding failures silently — they should now emit yellow `console.warn` in development mode. This is a retroactive improvement to the existing embedding flow, applied alongside the new theme wiring.
4. Create the `themeRepo` and `signalThemeRepo` instances using `createThemeRepository(serviceClient, teamId)` and `createSignalThemeRepository(serviceClient)` — both use the service-role client.
5. Extract the chunking call out of the embedding orchestrator so both routes can pre-compute chunks once and pass them to both the orchestrator and theme service. Add a `preComputedChunks` option to `generateSessionEmbeddings()` that skips internal chunking when provided.
6. Resolve the user ID from the authenticated session for `initiated_by`.
7. Verify: manual test — create a session with extraction, check that `themes` and `signal_themes` rows are created.
8. Verify: re-extract a session, check that old `signal_themes` rows are cascade-deleted and new ones created.
9. Verify: theme assignment failure does not affect session creation response time or success.
10. Verify: introduce a deliberate failure (e.g., invalid AI model env var) and confirm the yellow warning appears in the terminal in dev mode.

**Requirement coverage:** P1.R7 (chained after embedding generation, fire-and-forget), P1.R8 (both structured and raw sessions), P1.R9 (re-extraction cascade + re-assignment), P1.R10 (uses same AI service).

#### Increment 1.6: Cleanup and Audit

**What:** End-of-part audit across all files created/modified in Part 1.

**Steps:**

1. Run `npx tsc --noEmit` for a full type check.
2. Verify all file references in the TRD exist in the codebase.
3. SRP check: each file, function, and service does one thing. Theme service handles orchestration only — DB access is in repositories, AI calls are in ai-service, prompt is in prompts/.
4. DRY check: `scopeByTeam()` reused in theme repository, `withRetry()` reused via public `callModelText()` / `callModelObject<T>()`, no duplicated patterns.
5. Logging check: theme-service logs entry, exit, and errors. AI service logs attempts and results. Repositories log on error.
6. Dead code check: no unused imports, variables, or functions. Verify the old private `callModel()` and `callModelObject()` are fully deleted with no remaining references.
7. Convention check: naming (`theme-service.ts`, `ThemeRepository`, `assignSessionThemes`), exports (named only), import order (React/Next → third-party → internal).
8. Verify all PRD Part 1 acceptance criteria are met:
   - `themes` table exists with all specified columns and team-scoped RLS ✓
   - `signal_themes` junction table exists with cascade deletes on both FKs ✓
   - Theme assignment service fetches existing themes and assigns signals via one LLM call per extraction ✓
   - LLM strongly prefers existing themes over creating new ones ✓
   - New themes are auto-created with LLM-generated descriptions ✓
   - Themes span chunk types ✓
   - Theme assignment runs chained after embeddings, fire-and-forget, adding zero latency to user response ✓
   - All chunks (structured and raw) support multiple theme assignments via junction table ✓
   - Structured chunks have one primary theme (confidence ≥ 0.8) with optional secondary themes ✓
   - Raw chunk theme assignments have lower confidence scores than structured chunk assignments ✓
   - Theme assignment failure does not block extraction or embedding ✓
   - Re-extraction cascade-deletes old assignments and generates new ones ✓
   - Theme assignment prompt is defined in `lib/prompts/theme-assignment.ts` ✓
   - Fire-and-forget catches emit yellow console warnings in development mode ✓
9. Update `ARCHITECTURE.md` — add `themes` and `signal_themes` tables to Data Model section, add new files to file map, update Current State.
10. Update `CHANGELOG.md` with Part 1 deliverables.

**Requirement coverage:** All P1.R1–P1.R11. End-of-part audit.

---

## Part 2: Dashboard Layout, Navigation, and Direct Widgets

> Implements **P2.R1–P2.R10** from PRD-021.

### Overview

Create the `/dashboard` route as the first sidebar navigation item. The page has a global filter bar (client, date range, severity, urgency) encoded in URL query parameters, a responsive widget grid, and five direct quantitative widgets that query structured session data from Postgres. No AI or theme data is needed — these widgets run on `sessions.structured_json` fields and the `clients` table. Three new query actions are added to the existing `database-query-service.ts`, and each widget fetches data independently so one slow query doesn't block others.

### Technical Decisions

1. **Recharts for all chart widgets.** The project has no charting library yet. Recharts is the right choice: it's React-native (composable components, not imperative canvas), plays well with Server Components (widgets can be client-only leaves), is the most commonly used chart library in the Next.js ecosystem, and supports all chart types we need (bar, donut/pie, line, scatter). Install `recharts` as a dependency.

2. **Filter state in URL search params, not React context.** Filters are encoded as URL query parameters (`?clients=uuid1,uuid2&dateFrom=2026-01-01&dateTo=2026-03-31&severity=high&urgency=critical`). This makes filtered views bookmarkable and shareable (P2.R3). `useSearchParams()` from `next/navigation` reads the current filters; a `setFilters()` helper updates them via `router.replace()` without a full page reload. Each widget reads filters from the URL — no React context needed. This also means the back button restores the previous filter state naturally.

3. **Each widget fetches independently via separate API calls.** Each widget is a client component that calls `/api/dashboard/[action]` with the current filters. Widgets mount, show a skeleton, fetch their data, and render independently. A slow `competitive_mention_frequency` query doesn't block the `sentiment_distribution` chart from rendering (P6.R3). This is a simple `useEffect` + `useState` pattern per widget — no SWR/React Query needed at this stage.

4. **Single `/api/dashboard` API route, action-based dispatch.** Rather than one API route per widget, a single `/api/dashboard` route accepts `?action=sentiment_distribution&dateFrom=...&clients=...` and delegates to `executeQuery()` from `database-query-service.ts`. This keeps the API surface minimal and reuses the existing query infrastructure. The route validates the action and filters with Zod, resolves team scope from the cookie, and returns the query result as JSON.

5. **Extend `QueryAction` and `QueryFilters`, don't create a parallel system.** The PRD says the dashboard "shares the same service layer as the chat's `queryDatabase` tool." We add 3 new actions (`sessions_over_time`, `client_health_grid`, `competitive_mention_frequency`) to the existing `database-query-service.ts` and extend `QueryFilters` with optional `severity` and `urgency` fields. Existing chat queries continue to work unchanged.

6. **`sessions_over_time` uses `date_trunc()` via a Supabase RPC function.** Supabase's query builder doesn't support `GROUP BY date_trunc()` natively. We create a small Postgres function `sessions_over_time(p_team_id, p_date_from, p_date_to, p_granularity)` that returns `{ bucket: date, count: int }[]`. This keeps the complex SQL in the database where it belongs and the service handler simple.

7. **`competitive_mention_frequency` uses client-side JSON extraction.** Supabase can't natively unnest and aggregate a JSON array. The handler fetches `structured_json` for all matching sessions (selecting only the `competitiveMentions` key via `structured_json->competitiveMentions`) and aggregates competitor names in TypeScript. The data volume is small (one row per session, a few mentions per session) so this is efficient.

8. **`client_health_grid` fetches each client's most recent session.** For each client matching the filters, the handler fetches the most recent session's `sentiment` and `urgency`. This uses a `DISTINCT ON (client_id)` query ordered by `session_date DESC` — standard Postgres pattern. Clients with no extracted sessions (no `structured_json`) are excluded from the grid.

9. **Client selector is a multi-select dropdown populated from the `client_list` action.** The filter bar fetches the client list once on mount using the existing `client_list` action from `database-query-service.ts`. Selected client IDs are stored as a comma-separated list in the `clients` URL param. The multi-select component is built from shadcn/ui Popover + Command (combobox pattern).

10. **Date range picker uses two date inputs (from/to), not a calendar widget.** Simple `<input type="date">` fields styled with the project's design tokens. No external date picker library. The date range maps to `dateFrom` and `dateTo` URL params. Default is empty (all time).

11. **Dashboard page is a Server Component shell with client-side widget leaves.** The `/dashboard/page.tsx` is a Server Component that renders the page title and the filter bar. Each widget is a separate `'use client'` component that reads filters from URL params and fetches its own data. This keeps the page shell fast (no JS bundle) and pushes the client boundary as deep as possible.

12. **Widget card is a shared component.** All widgets share a `DashboardCard` component providing consistent styling: border, padding, heading, optional subtitle, loading skeleton state, and error state with retry. This is co-located in `app/dashboard/_components/dashboard-card.tsx`.

### Forward Compatibility Notes

- **Part 3 (Derived Theme Widgets):** The widget grid, filter bar, and `DashboardCard` component are all reusable. Theme widgets will be additional client components in `app/dashboard/_components/` that call new query actions. The filter bar already supports all the filter types theme widgets need.
- **Part 4 (Qualitative Drill-Down):** Clicking a widget data point will set a drill-down state (theme, client, sentiment, etc.) that opens a sliding panel. The click handlers are wired in Part 2 as no-ops or console.logs that Part 4 will replace with actual drill-down logic.
- **Part 6 (Cross-Widget Interaction):** The URL-based filter system naturally supports cross-widget interaction — clicking a data point in one widget updates the URL params, which triggers all widgets to re-fetch. No additional plumbing needed.
- **Backlog (Screenshot Export):** The widget grid is a single DOM container, making `html2canvas` capture straightforward when P6.R7 is implemented.

### Database Migrations

#### Migration 1: `sessions_over_time` RPC function

```sql
-- Postgres function for time-bucketed session counts.
-- Called by the sessions_over_time query action.
CREATE OR REPLACE FUNCTION sessions_over_time(
  p_team_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_granularity TEXT DEFAULT 'week'
)
RETURNS TABLE (bucket DATE, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    date_trunc(p_granularity, s.session_date)::date AS bucket,
    COUNT(*) AS count
  FROM sessions s
  WHERE s.deleted_at IS NULL
    AND (p_team_id IS NULL AND s.team_id IS NULL OR s.team_id = p_team_id)
    AND (p_date_from IS NULL OR s.session_date >= p_date_from)
    AND (p_date_to IS NULL OR s.session_date <= p_date_to)
  GROUP BY bucket
  ORDER BY bucket ASC;
$$;
```

No new tables are created in Part 2 — only this RPC function.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/dashboard/page.tsx` | **Create** | Dashboard page — Server Component shell with metadata |
| `app/dashboard/_components/dashboard-content.tsx` | **Create** | Client component — filter bar, widget grid layout, filter state management |
| `app/dashboard/_components/dashboard-card.tsx` | **Create** | Shared widget card — heading, subtitle, loading skeleton, error/retry, empty state |
| `app/dashboard/_components/filter-bar.tsx` | **Create** | Global filter bar — client multi-select, date range, severity, urgency dropdowns |
| `app/dashboard/_components/sentiment-widget.tsx` | **Create** | Sentiment distribution donut/bar chart (Recharts) |
| `app/dashboard/_components/urgency-widget.tsx` | **Create** | Urgency distribution bar chart (Recharts) |
| `app/dashboard/_components/client-health-widget.tsx` | **Create** | Client health grid scatter/matrix (Recharts) |
| `app/dashboard/_components/session-volume-widget.tsx` | **Create** | Session volume over time line chart with week/month toggle (Recharts) |
| `app/dashboard/_components/competitive-mentions-widget.tsx` | **Create** | Competitive mentions horizontal bar chart (Recharts) |
| `app/api/dashboard/route.ts` | **Create** | Dashboard API route — validates action + filters, delegates to `executeQuery()` |
| `lib/services/database-query-service.ts` | **Edit** | Add 3 new actions: `sessions_over_time`, `client_health_grid`, `competitive_mention_frequency`. Extend `QueryFilters` with `severity`, `urgency`, `clientIds`. |
| `components/layout/app-sidebar.tsx` | **Edit** | Add "Dashboard" as the first nav item (`/dashboard`, `BarChart3` icon) |
| `package.json` | **Edit** | Add `recharts` dependency |

### Type Definitions

#### Extended `QueryFilters` (in `database-query-service.ts`)

```typescript
export interface QueryFilters {
  teamId: string | null;
  dateFrom?: string;
  dateTo?: string;
  clientName?: string;
  // New — dashboard filters
  clientIds?: string[];
  severity?: string;
  urgency?: string;
  granularity?: "week" | "month";
}
```

#### Extended `QueryAction` (in `database-query-service.ts`)

```typescript
export type QueryAction =
  | "count_clients"
  | "count_sessions"
  | "sessions_per_client"
  | "sentiment_distribution"
  | "urgency_distribution"
  | "recent_sessions"
  | "client_list"
  // New — dashboard actions
  | "sessions_over_time"
  | "client_health_grid"
  | "competitive_mention_frequency";
```

#### Dashboard filter state (co-located in `dashboard-content.tsx`)

```typescript
interface DashboardFilters {
  clientIds: string[];
  dateFrom: string;
  dateTo: string;
  severity: string;
  urgency: string;
}
```

### New Query Action Designs

#### `sessions_over_time`

**Input filters:** `teamId`, `dateFrom`, `dateTo`, `granularity` (default `"week"`).

**Implementation:** Calls the `sessions_over_time` RPC function via `supabase.rpc()`. Returns `{ buckets: Array<{ bucket: string, count: number }> }`.

```typescript
async function handleSessionsOverTime(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("sessions_over_time", {
    p_team_id: filters.teamId,
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_granularity: filters.granularity ?? "week",
  });

  if (error) {
    console.error(`${LOG_PREFIX} sessions_over_time error:`, error);
    throw new Error("Failed to fetch sessions over time");
  }

  return { buckets: data ?? [] };
}
```

#### `client_health_grid`

**Input filters:** `teamId`, `dateFrom`, `dateTo`, `clientIds`, `severity`, `urgency`.

**Implementation:** Fetches each client's most recent session with `structured_json` via `DISTINCT ON (client_id)`. Extracts sentiment and urgency from the JSON. Returns `{ clients: Array<{ clientId, clientName, sentiment, urgency, sessionDate }> }`.

```typescript
async function handleClientHealthGrid(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  // Fetch all sessions with structured_json, ordered by date desc
  let query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("client_id, session_date, structured_json, clients(name)")
      .not("structured_json", "is", null)
      .order("session_date", { ascending: false }),
    filters
  );

  if (filters.clientIds && filters.clientIds.length > 0) {
    query = query.in("client_id", filters.clientIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} client_health_grid error:`, error);
    throw new Error("Failed to fetch client health grid");
  }

  // Keep only the most recent session per client (DISTINCT ON simulation)
  const latestByClient = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const clientId = row.client_id as string;
    if (!latestByClient.has(clientId)) {
      latestByClient.set(clientId, row);
    }
  }

  const clients = Array.from(latestByClient.values()).map((row) => {
    const json = row.structured_json as Record<string, unknown> | null;
    return {
      clientId: row.client_id,
      clientName: extractClientName(row),
      sentiment: (json?.sentiment as string) ?? "unknown",
      urgency: (json?.urgency as string) ?? "unknown",
      sessionDate: row.session_date,
    };
  });

  return { clients };
}
```

#### `competitive_mention_frequency`

**Input filters:** `teamId`, `dateFrom`, `dateTo`, `clientIds`.

**Implementation:** Fetches `structured_json` for all matching sessions, extracts the `competitiveMentions` array from each, and aggregates by competitor name. Returns `{ competitors: Array<{ name, count }> }` sorted by count descending.

```typescript
async function handleCompetitiveMentionFrequency(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  let query = baseSessionQuery(
    supabase
      .from("sessions")
      .select("structured_json")
      .not("structured_json", "is", null),
    filters
  );

  if (filters.clientIds && filters.clientIds.length > 0) {
    query = query.in("client_id", filters.clientIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG_PREFIX} competitive_mention_frequency error:`, error);
    throw new Error("Failed to fetch competitive mentions");
  }

  const countMap = new Map<string, number>();
  for (const row of data ?? []) {
    const json = row.structured_json as Record<string, unknown> | null;
    const mentions = json?.competitiveMentions as Array<{ competitor?: string }> | undefined;
    if (mentions) {
      for (const mention of mentions) {
        const name = mention.competitor;
        if (name) {
          countMap.set(name, (countMap.get(name) ?? 0) + 1);
        }
      }
    }
  }

  const competitors = Array.from(countMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { competitors };
}
```

### API Route Design

#### `app/api/dashboard/route.ts`

```typescript
// GET /api/dashboard?action=sentiment_distribution&dateFrom=...&clients=uuid1,uuid2&severity=high
const dashboardParamsSchema = z.object({
  action: z.enum([
    "sentiment_distribution",
    "urgency_distribution",
    "sessions_over_time",
    "client_health_grid",
    "competitive_mention_frequency",
    "client_list",
  ]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  clients: z.string().optional(),     // comma-separated UUIDs
  severity: z.string().optional(),
  urgency: z.string().optional(),
  granularity: z.enum(["week", "month"]).optional(),
});
```

The route:
1. Validates query params with Zod.
2. Resolves the Supabase anon client and team ID (RLS-protected reads).
3. Splits the `clients` param into an array of UUIDs.
4. Calls `executeQuery()` with the action and filters.
5. Returns `{ action, data }` as JSON.

Uses the **anon client** (not service-role) so RLS enforces team scoping and personal workspace isolation. This matches the chat `queryDatabase` pattern (Architectural Decision #14).

### Widget Component Pattern

Each widget follows the same structure:

```typescript
"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { DashboardCard } from "./dashboard-card";

interface SentimentWidgetProps {
  className?: string;
}

export function SentimentWidget({ className }: SentimentWidgetProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SentimentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("action", "sentiment_distribution");

    setIsLoading(true);
    setError(null);

    fetch(`/api/dashboard?${params.toString()}`)
      .then((res) => res.json())
      .then((result) => setData(result.data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [searchParams]); // Re-fetch when any filter changes

  return (
    <DashboardCard
      title="Sentiment Distribution"
      isLoading={isLoading}
      error={error}
      onRetry={() => { /* re-trigger fetch */ }}
      isEmpty={!data || Object.values(data).every((v) => v === 0)}
      emptyMessage="No sentiment data for the selected filters"
      className={className}
    >
      {/* Recharts PieChart / BarChart */}
    </DashboardCard>
  );
}
```

### Sidebar Navigation Update

`components/layout/app-sidebar.tsx` — add Dashboard as the first item:

```typescript
import { BarChart3, Pencil, MessageSquare, Settings } from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: BarChart3 },
  { label: "Capture", href: "/capture", icon: Pencil },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Settings", href: "/settings", icon: Settings },
];
```

### Implementation Increments

#### Increment 2.1: Database Migration and Query Service Extension

**What:** Create the `sessions_over_time` RPC function. Add 3 new query actions and extended filters to `database-query-service.ts`.

**Steps:**

1. Apply the `sessions_over_time` RPC function migration in Supabase.
2. Extend `QueryFilters` with `clientIds`, `severity`, `urgency`, `granularity`.
3. Extend `QueryAction` with `sessions_over_time`, `client_health_grid`, `competitive_mention_frequency`.
4. Implement `handleSessionsOverTime()` — calls the RPC function.
5. Implement `handleClientHealthGrid()` — fetches most-recent session per client, extracts sentiment/urgency from JSON.
6. Implement `handleCompetitiveMentionFrequency()` — fetches structured_json, unnests competitive mentions, aggregates by name.
7. Update the `ACTION_MAP` with the 3 new handlers.
8. Update existing handlers (`handleSentimentDistribution`, `handleUrgencyDistribution`, `handleRecentSessions`) to support the new `clientIds`, `severity`, and `urgency` filters where relevant.
9. Verify: `npx tsc --noEmit` passes.

**Requirement coverage:** P2.R10 (new query actions in shared service layer).

#### Increment 2.2: Dashboard API Route and Page Shell

**What:** Create the `/api/dashboard` route and the `/dashboard` page shell (Server Component + empty grid layout). Install Recharts. Update sidebar navigation.

**Steps:**

1. Install `recharts` — `npm install recharts`.
2. Create `app/api/dashboard/route.ts` — GET handler with Zod-validated action + filter params, delegates to `executeQuery()`.
3. Create `app/dashboard/page.tsx` — Server Component with metadata, renders `DashboardContent`.
4. Create `app/dashboard/_components/dashboard-content.tsx` — `'use client'` component, reads URL search params, renders filter bar placeholder and responsive widget grid (empty cards for now).
5. Create `app/dashboard/_components/dashboard-card.tsx` — shared widget card with loading, error, empty, and content states.
6. Edit `components/layout/app-sidebar.tsx` — add "Dashboard" as the first nav item with `BarChart3` icon.
7. Verify: the `/dashboard` route renders, the sidebar shows Dashboard first, the API route returns data for existing actions.

**Requirement coverage:** P2.R1 (route + sidebar), P2.R4 (responsive grid layout).

#### Increment 2.3: Global Filter Bar

**What:** Build the filter bar component with client multi-select, date range, severity, and urgency filters. Wire filter state to URL search params.

**Steps:**

1. Create `app/dashboard/_components/filter-bar.tsx` — client multi-select (shadcn Popover + Command), two date inputs, severity dropdown, urgency dropdown.
2. On mount, fetch client list via `/api/dashboard?action=client_list` to populate the multi-select.
3. Wire all filter changes to `router.replace()` with updated search params (no full reload).
4. Read initial filter values from URL search params on mount (P2.R3 — bookmarkable).
5. Add "Clear filters" button that removes all filter params.
6. Wire `DashboardContent` to pass filter changes through to child widgets via search params.
7. Verify: changing a filter updates the URL, reloading the page preserves filters, "Clear filters" resets.

**Requirement coverage:** P2.R2 (global filter bar), P2.R3 (URL-encoded filter state).

#### Increment 2.4: Sentiment and Urgency Widgets

**What:** Build the sentiment distribution and urgency distribution widgets with Recharts.

**Steps:**

1. Create `sentiment-widget.tsx` — fetches `sentiment_distribution` action, renders a Recharts `PieChart` (donut variant via `innerRadius`). Colour-coded: positive=green, neutral=grey, negative=red, mixed=amber. Clickable segments (console.log for now — Part 4 wires drill-down).
2. Create `urgency-widget.tsx` — fetches `urgency_distribution` action, renders a Recharts `BarChart`. Colour-coded: low=green, medium=amber, high=orange, critical=red. Clickable bars.
3. Both widgets use the `DashboardCard` wrapper for loading/error/empty states.
4. Both re-fetch when `searchParams` changes (global filter reactivity).
5. Verify: widgets render with real data, respond to filter changes, show skeleton while loading.

**Requirement coverage:** P2.R5 (sentiment), P2.R6 (urgency).

#### Increment 2.5: Session Volume and Competitive Mentions Widgets

**What:** Build the session volume over time and competitive mentions widgets.

**Steps:**

1. Create `session-volume-widget.tsx` — fetches `sessions_over_time` action with a `granularity` toggle (week/month). Renders a Recharts `LineChart` or `AreaChart`. X-axis is time buckets, Y-axis is session count. The granularity toggle is local to the widget (not a global filter).
2. Create `competitive-mentions-widget.tsx` — fetches `competitive_mention_frequency` action. Renders a Recharts horizontal `BarChart` (layout="vertical") with competitor names on Y-axis and counts on X-axis. Sorted by count descending. Clickable bars.
3. Both widgets use `DashboardCard` and re-fetch on filter changes.
4. Verify: session volume chart shows time series, granularity toggle works, competitive mentions ranks competitors correctly.

**Requirement coverage:** P2.R8 (session volume), P2.R9 (competitive mentions).

#### Increment 2.6: Client Health Grid Widget

**What:** Build the client health grid widget — a scatter/matrix positioning clients by sentiment and urgency.

**Steps:**

1. Create `client-health-widget.tsx` — fetches `client_health_grid` action. Renders a Recharts `ScatterChart` with sentiment on X-axis (categorical: positive=1, neutral=2, negative=3, mixed=4) and urgency on Y-axis (low=1, medium=2, high=3, critical=4). Each dot represents a client, sized uniformly, colour-coded by urgency. Tooltip shows client name, sentiment, urgency, and last session date. Clickable dots.
2. Handle edge cases: clients with "unknown" sentiment/urgency are excluded. Empty state when no clients have extracted sessions.
3. Use `DashboardCard` wrapper. Re-fetch on filter changes.
4. Verify: grid positions clients correctly, tooltip works, click handler fires.

**Requirement coverage:** P2.R7 (client health grid).

#### Increment 2.7: Cleanup and Audit

**What:** End-of-part audit across all files created/modified in Part 2.

**Steps:**

1. Run `npx tsc --noEmit` for a full type check.
2. Verify all file references in the TRD exist in the codebase.
3. SRP check: page shell is thin, each widget is self-contained, filter bar handles only filter state, API route only validates and dispatches.
4. DRY check: `DashboardCard` is shared across all widgets, `baseSessionQuery()` is shared across all action handlers, no duplicated fetch logic.
5. Logging check: API route logs entry and exit, each new query handler logs errors.
6. Dead code check: no unused imports or variables.
7. Convention check: naming, exports, import order, `'use client'` only on leaf components.
8. Verify all PRD Part 2 acceptance criteria are met:
   - `/dashboard` route exists and is the first item in sidebar navigation ✓
   - Global filter bar with client, date range, severity, and urgency filters ✓
   - Filter state encoded in URL query parameters ✓
   - All widgets react to global filter changes ✓
   - Sentiment distribution widget renders correctly with clickable segments ✓
   - Urgency distribution widget renders correctly with clickable bars ✓
   - Client health grid shows each client positioned by sentiment and urgency ✓
   - Session volume over time chart with selectable week/month granularity ✓
   - Competitive mentions chart ranks competitors by frequency ✓
   - All widgets consume the shared `queryDatabase` service layer ✓
   - New query actions added to the database query service ✓
   - Responsive grid layout: 2-3 columns on desktop, single column on mobile ✓
9. Update `ARCHITECTURE.md` — add `/dashboard` route, new files to file map, new RPC function, updated database-query-service description.
10. Update `CHANGELOG.md` with Part 2 deliverables.

**Requirement coverage:** All P2.R1–P2.R10. End-of-part audit.

---

## Part 3: Derived Theme Widgets

> Implements **P3.R1–P3.R6** from PRD-021.

### Overview

Build three theme-powered dashboard widgets that visualise how signal themes distribute, trend, and correlate with clients. These widgets join `signal_themes` → `session_embeddings` → `sessions` (→ `clients`) to aggregate theme data, respecting the same global filter bar and URL-param-driven filter state from Part 2. Three new query actions are added to `database-query-service.ts`. The widgets follow the same self-contained pattern established in Part 2: each is a `'use client'` leaf component using `useDashboardFetch`, `DashboardCard`, and Recharts.

### Technical Decisions

1. **All theme queries join through `session_embeddings` for team scoping.** The `signal_themes` table has no `team_id` column — scoping is derived from its parent `session_embeddings.team_id` (which mirrors `sessions.team_id`). All three query handlers join `signal_themes` → `session_embeddings` → `sessions` to apply team scoping, date range, and client ID filters via the sessions table. This avoids duplicating scoping logic and keeps the `signal_themes` table lean.

2. **Confidence threshold as a query filter parameter.** The PRD notes that "downstream widgets can filter by confidence threshold to control how secondary assignments affect counts and trends." A new optional `confidenceMin` field is added to `QueryFilters` (default: no threshold — include all assignments). The filter bar does **not** expose this in the UI for Part 3; it is available as a URL param (`?confidenceMin=0.8`) for power users and for Part 6 to wire up later. All three theme query handlers apply `WHERE confidence >= confidenceMin` when the param is present.

3. **`top_themes` returns per-chunk-type breakdown in a single query.** Rather than making N+1 queries (one per theme for breakdown), the handler fetches all matching `signal_themes` rows joined to `session_embeddings` (for `chunk_type`) in a single query, then aggregates in TypeScript: group by `theme_id`, count total signals, and sub-count by `chunk_type`. The result is sorted by total signal count descending. This is efficient because the data volume is bounded — themes are workspace-scoped and the theme count is typically 10-50.

4. **`theme_trends` uses `date_trunc()` in TypeScript, not an RPC.** Unlike `sessions_over_time` (which needed a Postgres RPC for complex GROUP BY on the sessions table), theme trends aggregate a smaller, already-joined dataset. The handler fetches `signal_themes` → `session_embeddings` → `sessions` (selecting `session_date` and `theme_id`), groups by `date_trunc(granularity, session_date)` and `theme_id` in TypeScript, and returns `{ buckets: Array<{ bucket: string, themes: Record<themeId, count> }> }`. This avoids creating another RPC function and keeps the logic transparent.

5. **`theme_client_matrix` returns a sparse matrix, not a full grid.** The handler fetches all `signal_themes` rows joined through to `clients`, groups by `(theme_id, client_id)`, counts signal assignments per pair, and returns only non-zero cells: `{ cells: Array<{ themeId, themeName, clientId, clientName, count }> }`. The widget constructs the full grid client-side. This avoids transmitting a potentially large `themes × clients` dense matrix when most cells are zero.

6. **Theme name resolution via a single lookup query.** All three handlers need to map `theme_id` to `theme_name` for display. Rather than joining `themes` in every query (adding complexity to already multi-table joins), each handler fetches active themes once via `supabase.from('themes').select('id, name')` scoped by team, builds an `id → name` Map, and attaches names during TypeScript aggregation. This is a single small query (10-50 rows) cached in-memory for the handler's lifetime.

7. **Theme trends widget defaults to top 5 themes, user-selectable.** The widget fetches `theme_trends` with all themes, but the chart only renders the 5 most frequent (by total signal count) by default. A local multi-select allows the user to add/remove themes from the chart — this is widget-local state (not a global filter), matching how the session volume widget has a local granularity toggle. The theme selection is not encoded in URL params.

8. **Theme-client matrix uses a heatmap-style grid, not a Recharts chart.** A traditional chart (scatter, bar) doesn't communicate the matrix structure well. The widget renders an HTML `<div>` grid with themes on rows and clients on columns (or vice versa for narrow screens). Cell background intensity is proportional to signal count (CSS `opacity` mapped from 0 to max count). Hover shows count tooltip. Click triggers drill-down (Part 4). This avoids forcing Recharts into a use case it's not designed for.

9. **Cold-start empty state per widget, not per page.** When no themes exist, each theme widget independently shows "Themes will appear as you extract more sessions" via the `DashboardCard` empty state. The direct widgets (sentiment, urgency, etc.) continue to function normally. This is handled by the `isEmpty` prop on `DashboardCard` — no special-case logic needed.

10. **`top_themes` widget limits to 15 themes by default.** To prevent visual clutter, the horizontal bar chart shows at most 15 themes. If more exist, a "Show all N themes" toggle expands the list. The query handler returns all themes (no server-side limit) so the widget can toggle client-side without re-fetching.

### Forward Compatibility Notes

- **Part 4 (Qualitative Drill-Down):** All three widgets have click handlers wired as `console.log` stubs, matching the Part 2 pattern. Part 4 will replace these with drill-down panel openings. The `top_themes` click passes `themeId`; the `theme_client_matrix` click passes `{ themeId, clientId }`; the `theme_trends` click passes `{ themeId, bucket }`.
- **Part 6 (Confidence Threshold UI):** The `confidenceMin` filter is already plumbed through `QueryFilters` and the API route. Part 6 can add a slider or input to the filter bar that sets `?confidenceMin=0.7` in the URL.

### Query Action Designs

#### `top_themes`

**Client-supplied filters:** `dateFrom`, `dateTo`, `clientIds`, `confidenceMin`
**Server-resolved context:** `teamId` (from `active_team_id` cookie — never client-supplied)

**Query strategy:**
1. Fetch active themes for workspace: `themes` WHERE `team_id = ?` AND `is_archived = false` → build `id → name` Map.
2. Fetch matching assignments: `signal_themes` JOIN `session_embeddings` ON `embedding_id` JOIN `sessions` ON `session_id`, applying team scope, date range, client IDs, and optional confidence threshold.
3. Aggregate in TypeScript: group by `theme_id`, count total, sub-count by `chunk_type`.
4. Sort by total count descending.

**Response shape:**
```typescript
{
  themes: Array<{
    themeId: string;
    themeName: string;
    count: number;
    breakdown: Record<string, number>; // chunk_type → count
  }>
}
```

#### `theme_trends`

**Client-supplied filters:** `dateFrom`, `dateTo`, `clientIds`, `confidenceMin`, `granularity` (week | month)
**Server-resolved context:** `teamId` (from `active_team_id` cookie — never client-supplied)

**Query strategy:**
1. Fetch active themes → `id → name` Map.
2. Fetch matching assignments joined to `sessions` for `session_date`.
3. Group in TypeScript by `date_trunc(granularity, session_date)` and `theme_id`.
4. Return time-bucketed theme counts.

**Response shape:**
```typescript
{
  themes: Array<{ themeId: string; themeName: string }>;
  buckets: Array<{
    bucket: string; // ISO date string
    counts: Record<string, number>; // themeId → count
  }>
}
```

#### `theme_client_matrix`

**Client-supplied filters:** `dateFrom`, `dateTo`, `clientIds`, `confidenceMin`
**Server-resolved context:** `teamId` (from `active_team_id` cookie — never client-supplied)

**Query strategy:**
1. Fetch active themes → `id → name` Map.
2. Fetch matching assignments joined through `session_embeddings` → `sessions` → `clients`.
3. Group by `(theme_id, client_id)`, count per pair.
4. Return sparse cells with names resolved.

**Response shape:**
```typescript
{
  themes: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  cells: Array<{
    themeId: string;
    clientId: string;
    count: number;
  }>
}
```

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/dashboard/_components/top-themes-widget.tsx` | **Create** | Top themes horizontal bar chart with chunk-type breakdown tooltip |
| `app/dashboard/_components/theme-trends-widget.tsx` | **Create** | Theme trends line chart with local theme selector |
| `app/dashboard/_components/theme-client-matrix-widget.tsx` | **Create** | Theme-client heatmap grid with intensity-mapped cells |
| `app/dashboard/_components/dashboard-content.tsx` | **Edit** | Add 3 new theme widgets to the grid layout |
| `lib/services/database-query-service.ts` | **Edit** | Add 3 new actions (`top_themes`, `theme_trends`, `theme_client_matrix`), add `confidenceMin` to `QueryFilters` |
| `app/api/dashboard/route.ts` | **Edit** | Add 3 new actions to Zod enum, add `confidenceMin` param |

### Implementation Increments

#### Increment 3.1: Query Service Extension

**What:** Add 3 new theme query actions to `database-query-service.ts` and extend the API route to accept them. Add `confidenceMin` to `QueryFilters`.

**Steps:**

1. Extend `QueryAction` with `top_themes`, `theme_trends`, `theme_client_matrix`.
2. Add `confidenceMin?: number` to `QueryFilters`.
3. Create a shared `fetchActiveThemeMap()` helper — queries `themes` table for workspace, returns `Map<string, string>` (id → name). Used by all 3 handlers.
4. Implement `handleTopThemes()` — fetch `signal_themes` JOIN `session_embeddings` JOIN `sessions`, apply filters + optional confidence threshold, aggregate by `theme_id` with `chunk_type` sub-counts, sort by count descending.
5. Implement `handleThemeTrends()` — same join + filters, group by `(date_trunc(granularity, session_date), theme_id)` in TypeScript, return time-bucketed counts.
6. Implement `handleThemeClientMatrix()` — same join + filters + JOIN `clients`, group by `(theme_id, client_id)`, return sparse cells with resolved names.
7. Add all 3 handlers to `ACTION_MAP`.
8. Edit `app/api/dashboard/route.ts` — add 3 new actions to Zod enum, add `confidenceMin` as `z.coerce.number().min(0).max(1).optional()`.
9. Update `executeQuery()` logging to include `confidenceMin`.
10. Verify: `npx tsc --noEmit` passes.

**Requirement coverage:** P3.R4 (new query actions), P3.R6 (global filter respect).

#### Increment 3.2: Top Themes Widget

**What:** Build the top themes horizontal bar chart widget.

**Steps:**

1. Create `app/dashboard/_components/top-themes-widget.tsx` — fetches `top_themes` action, renders a Recharts horizontal `BarChart` (layout="vertical") with theme names on Y-axis and signal counts on X-axis. Sorted by count descending. Bar fill uses the brand primary colour.
2. On hover/tooltip: show per-chunk-type breakdown (e.g., "5 pain points, 3 requirements, 2 blockers").
3. Default display limit of 15 themes. If more exist, show a "Show all N themes" toggle below the chart.
4. Clickable bars — `console.log` for now (Part 4 wires drill-down with `themeId`).
5. Empty state: "Themes will appear as you extract more sessions."
6. Re-fetch on search param changes (global filter reactivity via `useDashboardFetch`).
7. Verify: widget renders with real data, responds to filter changes.

**Requirement coverage:** P3.R1 (top themes ranked by signal count with chunk-type breakdown), P3.R5 (cold-start empty state).

#### Increment 3.3: Theme Trends Widget

**What:** Build the theme trends line chart widget.

**Steps:**

1. Create `app/dashboard/_components/theme-trends-widget.tsx` — fetches `theme_trends` action with local `granularity` toggle (week/month, matching session volume widget pattern).
2. Render a Recharts `LineChart` — X-axis is time buckets, Y-axis is signal count, each line is a theme (different colour per theme).
3. Default to top 5 themes by total count. Add a local multi-select (shadcn Popover + Command, matching the filter bar pattern) to add/remove themes from the chart. This is local state, not URL-encoded.
4. Colour assignment: cycle through a predefined palette of 8 distinct colours. If more than 8 themes are selected, colours repeat.
5. Tooltip shows bucket date + all visible theme counts.
6. Empty state: "Themes will appear as you extract more sessions."
7. Re-fetch on search param changes.
8. Verify: chart shows time series with multiple theme lines, theme selector works, granularity toggle works.

**Requirement coverage:** P3.R2 (theme frequency over time with selectable themes), P3.R5 (cold-start empty state).

#### Increment 3.4: Theme-Client Matrix Widget

**What:** Build the theme-client heatmap grid widget.

**Steps:**

1. Create `app/dashboard/_components/theme-client-matrix-widget.tsx` — fetches `theme_client_matrix` action.
2. Render as an HTML grid (not Recharts) — themes on rows, clients on columns. Each cell has background opacity proportional to its count (0 = transparent, max count = full intensity using brand primary colour).
3. Cell content shows the count number. Hover shows a tooltip: "Theme X + Client Y: N signals".
4. Clickable cells — `console.log` for now (Part 4 wires drill-down with `{ themeId, clientId }`).
5. Handle large matrices: if more than 10 themes or 10 clients, show scrollable overflow with sticky row/column headers.
6. Empty state: "Themes will appear as you extract more sessions."
7. Re-fetch on search param changes.
8. Verify: grid renders correctly, colour intensity reflects counts, tooltip works, click handler fires.

**Requirement coverage:** P3.R3 (heatmap grid with theme-client pairs), P3.R5 (cold-start empty state).

#### Increment 3.5: Cleanup and Audit

**What:** End-of-part audit across all files created/modified in Part 3.

**Steps:**

1. Run `npx tsc --noEmit` for a full type check.
2. Verify all file references in the TRD exist in the codebase.
3. SRP check: each widget is self-contained, query handlers do one thing, shared helpers extracted.
4. DRY check: `fetchActiveThemeMap()` is shared across all 3 handlers, `useDashboardFetch` and `DashboardCard` shared, no duplicated fetch or aggregation logic.
5. Logging check: API route logs new actions, each new query handler logs errors.
6. Dead code check: no unused imports or variables.
7. Convention check: naming, exports, import order, `'use client'` only on leaf components.
8. Verify all PRD Part 3 acceptance criteria are met:
   - Top themes widget ranks themes by signal count with chunk-type breakdown ✓
   - Clicking a theme triggers drill-down (console.log stub — Part 4 wires) ✓
   - Theme trends widget shows theme frequency over time with selectable themes ✓
   - Theme-client matrix shows heatmap of signal counts per theme-client pair ✓
   - Clicking a matrix cell triggers drill-down (console.log stub) ✓
   - New query actions added to the shared service layer ✓
   - Cold-start empty state displays correctly when no themes exist ✓
   - All derived widgets respect global filters ✓
9. Update `ARCHITECTURE.md` — add new widget files to file map, update database-query-service description (13 actions), add `confidenceMin` to env/filter docs.
10. Update `CHANGELOG.md` with Part 3 deliverables.

**Requirement coverage:** All P3.R1–P3.R6. End-of-part audit.
