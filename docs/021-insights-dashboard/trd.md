# TRD-021: AI-Powered Insights Dashboard

> **Status:** Draft (Part 1 detailed)
> **PRD:** `docs/021-insights-dashboard/prd.md` (approved)
> **Mirrors:** PRD Parts 1–6. Each part is written and reviewed one at a time. Parts 2–6 will be added after their preceding parts are implemented.

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

**What:** Refactor `ai-service.ts` to expose two public generics (`callModelText`, `callModelObject<T>`) that all non-streaming LLM calls use. Migrate existing callers (`extractSignals`, `synthesiseMasterSignal`, `generateConversationTitle`). Create the theme assignment prompt. This increment touches existing code but produces zero behavior change for existing callers — it's a pure refactor with the addition of the theme prompt.

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
