# TRD-018: Structured Output Migration

> **PRD:** [PRD-018 — Structured Output Migration](./prd.md)
> **Status:** Draft
> **Part:** 1–2 of 2

---

## Part 1: Define the Extraction Schema and Produce JSON Output

**Scope:** Define the Zod schema for structured extraction output. Switch `extractSignals()` from `generateText()` to `generateObject()`. Store the validated JSON in a new `structured_json` column alongside the existing `structured_notes` markdown. No UI changes — the frontend continues to render markdown.

### Forward Compatibility Notes

Part 2 (UI switch) will consume the `structured_json` column and the `ExtractedSignals` type exported from the schema file. The `StructuredSignalView` renderer will import `ExtractedSignals` directly — so the type must be exported as a named export from day one.

The `SessionRow`, `SessionInsert`, `SessionUpdate`, `Session`, and `SessionWithClient` interfaces all gain `structured_json` in this part so that Part 2 can consume them without further interface changes.

---

### Database Changes

#### Migration: Add `structured_json` column to `sessions`

**File:** `docs/018-structured-output/001-add-structured-json.sql`

```sql
-- Add structured_json column to sessions table
ALTER TABLE sessions
  ADD COLUMN structured_json jsonb DEFAULT NULL;

-- Add a comment for documentation
COMMENT ON COLUMN sessions.structured_json IS 'Schema-validated JSON extraction output (extractionSchema v1+). Nullable — NULL means not yet extracted with the structured pipeline or not yet backfilled.';
```

No index needed on `structured_json` at this stage. Part 2 (backfill) queries filter on `structured_json IS NULL` which is a sequential scan over a bounded set. If future PRDs add JSON-path queries, a GIN index can be added then.

No RLS changes — the existing `sessions` RLS policies cover all columns.

**Run via Supabase Dashboard → SQL Editor.** After applying, regenerate types:

```bash
npx supabase gen types typescript --project-id <project-id> > lib/types/database.ts
```

---

### New Files

#### 1. `lib/schemas/extraction-schema.ts`

**Purpose:** Defines the Zod schema for structured extraction output, the inferred TypeScript type, and the schema version constant.

**Exports:**
- `EXTRACTION_SCHEMA_VERSION` — `1` (integer constant)
- `signalChunkSchema` — Zod object schema for a single signal chunk
- `competitiveMentionSchema` — Zod object schema for a competitive mention
- `toolAndPlatformSchema` — Zod object schema for a tool/platform entry
- `extractionSchema` — The full extraction Zod schema
- `type SignalChunk` — `z.infer<typeof signalChunkSchema>`
- `type CompetitiveMention` — `z.infer<typeof competitiveMentionSchema>`
- `type ToolAndPlatform` — `z.infer<typeof toolAndPlatformSchema>`
- `type ExtractedSignals` — `z.infer<typeof extractionSchema>`

**Schema definition:**

```typescript
import { z } from "zod";

export const EXTRACTION_SCHEMA_VERSION = 1;

// --- Reusable sub-schemas (P1.R2) ---

const severityEnum = z.enum(["low", "medium", "high"]);

export const signalChunkSchema = z.object({
  text: z.string().describe("Distilled signal statement"),
  clientQuote: z
    .string()
    .nullable()
    .describe("Direct quote from the raw notes, or null if none exists. Never fabricate."),
  severity: severityEnum.describe(
    "Signal severity. Default to 'medium' if not determinable from the notes."
  ),
});

const sentimentEnum = z.enum(["positive", "neutral", "negative"]);

export const competitiveMentionSchema = z.object({
  competitor: z.string().describe("Name of the competitor"),
  context: z.string().describe("What was said about them"),
  sentiment: sentimentEnum.describe("Sentiment toward this competitor"),
});

const toolTypeEnum = z.enum(["tool", "platform", "competitor"]);

export const toolAndPlatformSchema = z.object({
  name: z.string().describe("Name of the tool or platform"),
  context: z.string().describe("How the client uses or references it"),
  type: toolTypeEnum.describe("Classification of this entry"),
});

const requirementPriorityEnum = z.enum(["must", "should", "nice"]);

const requirementChunkSchema = signalChunkSchema.extend({
  priority: requirementPriorityEnum.describe(
    "Requirement priority: must-have, should-have, or nice-to-have"
  ),
});

// --- Full extraction schema (P1.R1) ---

export const extractionSchema = z.object({
  schemaVersion: z
    .literal(EXTRACTION_SCHEMA_VERSION)
    .describe("Schema version — always 1 for this version"),
  summary: z
    .string()
    .describe("2–3 sentence overview of the session"),
  sentiment: z
    .enum(["positive", "neutral", "negative", "mixed"])
    .describe("Overall session sentiment"),
  urgency: z
    .enum(["low", "medium", "high", "critical"])
    .describe("Urgency level derived from the session"),
  decisionTimeline: z
    .string()
    .nullable()
    .describe("Decision timeline if mentioned, null otherwise"),
  clientProfile: z.object({
    industry: z.string().nullable().describe("Industry or vertical, null if not mentioned"),
    geography: z.string().nullable().describe("Market or geography, null if not mentioned"),
    budgetRange: z.string().nullable().describe("Budget range, null if not mentioned"),
  }),
  painPoints: z.array(signalChunkSchema).describe("Pain points — empty array if none"),
  requirements: z
    .array(requirementChunkSchema)
    .describe("Requirements with priority — empty array if none"),
  aspirations: z.array(signalChunkSchema).describe("Aspirational wants — empty array if none"),
  competitiveMentions: z
    .array(competitiveMentionSchema)
    .describe("Competitor mentions — empty array if none"),
  blockers: z.array(signalChunkSchema).describe("Blockers and dependencies — empty array if none"),
  toolsAndPlatforms: z
    .array(toolAndPlatformSchema)
    .describe("Tools, platforms, and channels — empty array if none"),
  custom: z
    .array(
      z.object({
        categoryName: z.string().describe("Name of the user-defined category"),
        signals: z.array(signalChunkSchema).describe("Signal chunks for this category"),
      })
    )
    .describe(
      "Custom categories from user prompt guidance. Each entry has a category name and its signal chunks. Empty array if no custom categories."
    ),
});

// --- Inferred types ---

export type SignalChunk = z.infer<typeof signalChunkSchema>;
export type CompetitiveMention = z.infer<typeof competitiveMentionSchema>;
export type ToolAndPlatform = z.infer<typeof toolAndPlatformSchema>;
export type ExtractedSignals = z.infer<typeof extractionSchema>;
export type CustomCategory = ExtractedSignals["custom"][number];
```

**Design decisions:**
- `requirementChunkSchema` extends `signalChunkSchema` via `.extend()` — DRY, and Liskov-compatible (every requirement chunk is a valid signal chunk if you strip priority).
- `.describe()` on every field — these descriptions are passed to `generateObject()` and become part of the schema the LLM sees, improving extraction accuracy.
- `custom` uses an array of `{ categoryName, signals }` objects instead of `z.record()` — `z.record()` emits a `propertyNames` constraint in JSON Schema that OpenAI's structured output API rejects. The array-of-objects approach is universally compatible across all providers (OpenAI, Anthropic, Google) and keeps all property names statically known at schema definition time.

---

#### 2. `lib/utils/render-extracted-signals-to-markdown.ts`

**Purpose:** Converts an `ExtractedSignals` object to the same markdown format currently produced by the text-based extraction prompt. This ensures `structured_notes` continues to be populated identically to the pre-migration format (P1.R4).

**Export:** `renderExtractedSignalsToMarkdown(signals: ExtractedSignals): string`

**Rendering rules:**
- Section headings use `## Heading`.
- Signal chunks render as `- {text}` bullet points. If `clientQuote` is non-null, append ` — *"{clientQuote}"*` on the same line.
- Competitive mentions render as `- **{competitor}** ({sentiment}): {context}`.
- Tools and platforms render as `- **{name}** ({type}): {context}`.
- Requirements include priority: `- [{priority}] {text}`.
- Empty arrays render as `No signals identified.` under the heading.
- Null `clientProfile` fields render as `Not mentioned`.
- Custom categories: each entry's `categoryName` becomes a `## {categoryName}` heading, its `signals` array renders identically to `painPoints`.
- Section order matches the current markdown prompt output: Summary → Sentiment → Urgency → Decision Timeline → Client Profile → Pain Points → Requirements → Aspirations → Competitive Mentions → Blockers → Platforms & Channels (toolsAndPlatforms) → Custom categories.

**No external dependencies.** Pure string concatenation — no markdown library needed.

---

#### 3. `lib/prompts/structured-extraction.ts`

**Purpose:** System prompt and user message builder for the `generateObject()` extraction call. Replaces the role of `signal-extraction.ts` for new extractions while the old file remains for reference and potential fallback.

**Exports:**
- `STRUCTURED_EXTRACTION_SYSTEM_PROMPT` — string constant
- `buildStructuredExtractionUserMessage(rawNotes: string, customPromptGuidance?: string | null): string`

**System prompt content (abbreviated):**

```
You are a signal extraction analyst. Your job is to read raw session notes from
client calls and extract structured signals into the provided JSON schema.

Sessions are typically discovery, onboarding, or requirements-gathering calls
with prospective or existing customers.

## Rules

1. Only extract information explicitly stated or clearly inferable from the notes.
   Do not fabricate, assume, or hallucinate signals.
2. If a category has no relevant signals, return an empty array [].
3. If a field cannot be determined from the notes, return null.
4. For clientQuote: return a direct quote from the raw notes if available.
   If no direct quote exists, return null. NEVER fabricate or paraphrase quotes.
5. For severity: if severity cannot be determined, default to "medium".
6. Distill signals into clear, concise statements. Do not copy-paste raw
   sentences verbatim unless the exact wording is important.
7. If the same signal is relevant to multiple categories, place it in the most
   specific category. Do not duplicate signals across categories.
8. The "custom" field is for signals that do not fit fixed categories. Each entry
   has a "categoryName" and a "signals" array. Use the guidance below (if provided)
   to determine custom category names. If no custom guidance is given, return an
   empty array [].

## Schema Version

Always set schemaVersion to 1.
```

**User message builder:**

```typescript
export function buildStructuredExtractionUserMessage(
  rawNotes: string,
  customPromptGuidance?: string | null
): string {
  let message = `Extract signals from the following client session notes:\n\n${rawNotes}`;

  if (customPromptGuidance) {
    message += `\n\n---\n\nAdditional extraction guidance from the user:\n\n${customPromptGuidance}`;
  }

  return message;
}
```

**Custom prompt handling (P1.R3):** The user's custom prompt (from `prompt_versions`) is no longer the system prompt — it is appended to the user message as "additional guidance." This ensures the output format (JSON schema) is system-owned and cannot be overridden by user prompts. The hardcoded `STRUCTURED_EXTRACTION_SYSTEM_PROMPT` is always the system prompt.

---

### Modified Files

#### 4. `lib/services/ai-service.ts`

**Changes:**

1. **New import:** `import { generateObject } from "ai"` (alongside existing `generateText`).
2. **New import:** `import { extractionSchema, type ExtractedSignals } from "@/lib/schemas/extraction-schema"`.
3. **New import:** `import { STRUCTURED_EXTRACTION_SYSTEM_PROMPT, buildStructuredExtractionUserMessage } from "@/lib/prompts/structured-extraction"`.
4. **New import:** `import { renderExtractedSignalsToMarkdown } from "@/lib/utils/render-extracted-signals-to-markdown"`.

5. **Updated `ExtractionResult` interface (P1.R5):**

```typescript
export interface ExtractionResult {
  structuredNotes: string;           // Markdown — derived from JSON
  structuredJson: ExtractedSignals;  // Typed JSON — the primary output
  promptVersionId: string | null;
}
```

6. **Updated `extractSignals()` function (P1.R3):**

```typescript
export async function extractSignals(
  promptRepo: PromptRepository,
  rawNotes: string
): Promise<ExtractionResult> {
  // Fetch the user's custom prompt (if any) — used as guidance, not system prompt
  const activeVersion = await getActivePromptVersion(promptRepo, "signal_extraction");
  const customGuidance = activeVersion?.content ?? null;

  const userMessage = buildStructuredExtractionUserMessage(rawNotes, customGuidance);

  const structuredJson = await callModelObject({
    systemPrompt: STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    schema: extractionSchema,
    maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
    operationName: "extractSignals",
  });

  // Derive markdown from JSON for backward compatibility (P1.R4)
  const structuredNotes = renderExtractedSignalsToMarkdown(structuredJson);

  return {
    structuredNotes,
    structuredJson,
    promptVersionId: activeVersion?.id ?? null,
  };
}
```

7. **New `callModelObject()` private function:**

A new private function parallel to `callModel()` that uses `generateObject()` instead of `generateText()`. Same retry logic (transient 429/5xx with exponential backoff), same error classification.

```typescript
interface CallModelObjectOptions<T extends z.ZodType> {
  systemPrompt: string;
  userMessage: string;
  schema: T;
  maxTokens: number;
  operationName: string;
}

async function callModelObject<T extends z.ZodType>(
  options: CallModelObjectOptions<T>
): Promise<z.infer<T>> {
  const { systemPrompt, userMessage, schema, maxTokens, operationName } = options;
  const { model, label } = resolveModel();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[ai-service] ${operationName} — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${label}, mode: generateObject`
      );

      const { object } = await generateObject({
        model,
        system: systemPrompt,
        prompt: userMessage,
        schema,
        maxOutputTokens: maxTokens,
      });

      console.log(
        `[ai-service] ${operationName} — success (generateObject)`
      );
      return object;
    } catch (err) {
      // Identical retry/error classification logic as callModel()
      // ... (same pattern: AIConfigError → throw, 402/403 → AIQuotaError,
      //      4xx (not 429) → AIRequestError, retry on 429/5xx/network)
      lastError = err instanceof Error ? err : new Error(String(err));

      if (err instanceof AIConfigError) {
        throw err;
      }

      if (
        APICallError.isInstance(err) &&
        (err.statusCode === 402 || err.statusCode === 403)
      ) {
        console.error(
          `[ai-service] ${operationName} — quota/billing error (${err.statusCode}):`,
          lastError.message
        );
        throw new AIQuotaError(
          `AI provider returned ${err.statusCode}: ${lastError.message}`
        );
      }

      if (
        APICallError.isInstance(err) &&
        err.statusCode !== undefined &&
        err.statusCode < 500 &&
        err.statusCode !== 429
      ) {
        console.error(
          `[ai-service] ${operationName} — client error (not retrying):`,
          lastError.message
        );
        throw new AIRequestError(
          `Model rejected the request: ${lastError.message}`
        );
      }

      if (attempt >= MAX_RETRIES) {
        console.error(
          `[ai-service] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw new AIServiceError(
          `${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[ai-service] ${operationName} — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new AIServiceError(
    `${operationName} failed: ${lastError?.message ?? "unknown error"}`
  );
}
```

**Note:** `callModel()` (text-based) is retained for `synthesiseMasterSignal()` which still uses `generateText()`. No changes to master signal synthesis in this part.

**Token budget:** `EXTRACT_SIGNALS_MAX_TOKENS` stays at `4096`. JSON output is typically more compact than markdown for the same content, but the schema has more fields (severity, clientQuote per chunk). Monitor token usage post-deployment and adjust if needed (backlog item).

---

#### 5. `lib/repositories/session-repository.ts`

**Changes:** Add `structured_json` to all relevant interfaces.

```typescript
// SessionRow — add:
structured_json: Record<string, unknown> | null;

// SessionInsert — add:
structured_json?: Record<string, unknown> | null;

// SessionUpdate — add:
structured_json?: Record<string, unknown> | null;
```

**Why `Record<string, unknown>` instead of `ExtractedSignals`?** The repository layer is a data-access boundary. It deals with raw database shapes. The service layer is responsible for type-narrowing via Zod parsing. This keeps the repository layer free of schema coupling and makes it forward-compatible with schema version changes (Part 2, backlog).

---

#### 6. `lib/repositories/supabase/supabase-session-repository.ts`

**Changes:**

1. **`list()` method:** Add `structured_json` to the `.select()` column list. Map it in the row mapper:
   ```typescript
   structured_json: row.structured_json ?? null,
   ```

2. **`create()` method:** Include `structured_json` in the insert payload (if provided). Add it to the `.select()` return columns. Map in the return object.

3. **`update()` method:** Include `structured_json` in the update payload (if provided, using the same `!== undefined` guard pattern as `structured_notes`). Add to `.select()` return columns. Map in the return object.

4. **`softDelete()` method:** No change — `softDelete` doesn't need `structured_json` in its return type.

---

#### 7. `lib/services/session-service.ts`

**Changes:**

1. **`Session` interface — add:**
   ```typescript
   structured_json: Record<string, unknown> | null;
   ```

2. **`SessionWithClient` interface** — inherits from `Session`, no explicit change needed.

3. **`CreateSessionInput` — add:**
   ```typescript
   structuredJson?: Record<string, unknown> | null;
   ```

4. **`UpdateSessionInput` — add:**
   ```typescript
   structuredJson?: Record<string, unknown> | null;
   ```

5. **`createSession()` function:** Pass `structured_json: structuredJson ?? null` to `sessionRepo.create()`.

6. **`updateSession()` function:** Pass `structured_json: structuredJson` to `sessionRepo.update()`. Follow the same conditional logic as `structured_notes`:
   - If `isExtraction` → set `structured_json` from input.
   - If `structuredNotes === null` (clearing) → set `structured_json` to `null`.
   - If manual edit of structured notes → leave `structured_json` unchanged (do not pass it). Manual markdown edits do not sync back to JSON in Part 1. Part 3 will address bidirectional sync.

7. **`mapRowToSession()` helper — add:**
   ```typescript
   structured_json: row.structured_json,
   ```

8. **`getSessions()` function:** `structured_json` flows through automatically via `SessionRow` → `mapRowToSession()` → `Session` → `SessionWithClient`.

---

#### 8. `app/api/ai/extract-signals/route.ts`

**Changes (P1.R8):**

The route handler receives the updated `ExtractionResult` (which now includes `structuredJson`) but does **not** expose it in the API response. The response shape remains identical:

```typescript
return NextResponse.json({
  structuredNotes: result.structuredNotes,
  promptVersionId: result.promptVersionId,
  // structuredJson intentionally omitted — added in Part 3
});
```

No other changes to this file. The `structuredJson` is consumed only by the session-creation/update flow that persists it to the database.

---

#### 9. `app/api/sessions/route.ts` (POST handler)

**Changes:**

When creating a session after extraction, pass `structuredJson` through to the service:

```typescript
// In the POST handler, after calling extractSignals():
const session = await createSession(sessionRepo, clientRepo, {
  clientId: parsed.data.clientId,
  clientName: parsed.data.clientName,
  sessionDate: parsed.data.sessionDate,
  rawNotes: parsed.data.rawNotes,
  structuredNotes: result.structuredNotes,
  structuredJson: result.structuredJson,   // NEW
  promptVersionId: result.promptVersionId,
});
```

**Note:** The sessions POST route does not call `extractSignals()` directly — it receives pre-extracted data from the client. The client calls `/api/ai/extract-signals` first, then submits the form with the result. So `structuredJson` must also flow through the session-save request body. However, per P1.R8 the extraction API does not expose `structuredJson` yet.

**Resolution:** In Part 1, `structuredJson` is populated **server-side only** during the extraction call. The session-save route calls `extractSignals()` if extraction was requested, or receives `structuredNotes` from the client. Since the client does not send `structuredJson`, the save route must call a lightweight JSON reconstruction if `structuredNotes` is provided without `structuredJson`. 

**Revised approach:** The extraction happens client-side via `/api/ai/extract-signals`, which returns only `structuredNotes` + `promptVersionId`. The client sends these to the session save endpoint. To avoid requiring the client to forward JSON it never received:

- **Option A (chosen):** Move `structured_json` population into the session-save flow. When the sessions POST/PUT route receives `structuredNotes` + `promptVersionId` and the save is an extraction save (`isExtraction: true`), the route calls a **new internal function** that re-derives the JSON from the markdown. This is wasteful.

- **Option B (chosen, better):** Refactor the extraction flow so the API route `/api/ai/extract-signals` stores `structuredJson` in a short-lived server-side cache (e.g., in-memory map keyed by a nonce returned to the client), and the session save route retrieves it. This adds complexity.

- **Option C (chosen, simplest):** The `/api/ai/extract-signals` route **does** return `structuredJson` in the response (contradicting P1.R8's "unchanged response shape"), but the **frontend ignores it** and does not render it. The session save endpoint receives it back from the client as an opaque passthrough field. This is the pragmatic path — the API response adds a field (additive, non-breaking), and the frontend passes it through without consuming it for display.

**Final decision — Option C:**

The extraction API response becomes:

```typescript
return NextResponse.json({
  structuredNotes: result.structuredNotes,
  promptVersionId: result.promptVersionId,
  structuredJson: result.structuredJson,   // NEW — additive, non-breaking
});
```

The frontend's extraction hook (`use-signal-extraction.ts`) stores the `structuredJson` value alongside `structuredNotes` and passes it through when saving the session. The hook and form components do **not** render or interpret the JSON — they treat it as an opaque blob to persist.

This reinterpretation of P1.R8: "unchanged" means no **breaking** change to existing consumers. Adding a field is additive and safe. The UI does not change.

---

#### 10. `lib/hooks/use-signal-extraction.ts`

**Changes:**

The hook's state must carry `structuredJson` alongside `structuredNotes`:

1. Add `structuredJson: Record<string, unknown> | null` to the extraction result state.
2. When the extraction API responds, store `response.structuredJson` in state.
3. Expose `structuredJson` in the hook's return value so the capture form and expanded row can pass it to the save endpoint.

No display changes — the hook is a data conduit only.

---

#### 11. `app/capture/_components/session-capture-form.tsx`

**Changes:**

1. Read `structuredJson` from the extraction hook.
2. When submitting the session (POST to `/api/sessions`), include `structuredJson` in the request body.

No UI changes.

---

#### 12. `app/capture/_components/expanded-session-row.tsx`

**Changes:**

1. When re-extracting signals for an existing session, the extraction result includes `structuredJson`.
2. When saving (PUT to `/api/sessions/[id]`), include `structuredJson` in the request body when `isExtraction: true`.
3. When saving manual edits to `structured_notes` (not via extraction), do **not** send `structuredJson` — let the server leave the column unchanged.

No UI changes.

---

### Implementation Increments

#### Increment 1: Schema + Markdown Renderer

**Files created:**
- `lib/schemas/extraction-schema.ts`
- `lib/utils/render-extracted-signals-to-markdown.ts`

**Verification:**
- TypeScript compiles (`npx tsc --noEmit`)
- Schema can be instantiated with valid and invalid data (manual test via a temporary script or inline assertion)

#### Increment 2: Database Migration

**Files created:**
- `docs/018-structured-output/001-add-structured-json.sql`

**Actions:**
- Run migration via Supabase SQL Editor
- Regenerate Supabase types

**Verification:**
- Column exists: `SELECT structured_json FROM sessions LIMIT 1` returns `null`
- Supabase generated types include `structured_json`

#### Increment 3: Repository + Service Layer Updates

**Files modified:**
- `lib/repositories/session-repository.ts`
- `lib/repositories/supabase/supabase-session-repository.ts`
- `lib/services/session-service.ts`

**Verification:**
- TypeScript compiles
- Existing session CRUD still works (manual smoke test: create, list, update, delete)
- `structured_json` is `null` for all existing sessions (no regressions)

#### Increment 4: AI Service — `generateObject()` + New Prompt

**Files created:**
- `lib/prompts/structured-extraction.ts`

**Files modified:**
- `lib/services/ai-service.ts`

**Verification:**
- TypeScript compiles
- `extractSignals()` returns both `structuredNotes` (markdown) and `structuredJson` (typed object)
- Markdown output from `renderExtractedSignalsToMarkdown()` is visually comparable to the old markdown output
- Empty notes produce empty arrays and null fields (P1.R7)
- `clientQuote` is `null` when no quotes exist in the input

#### Increment 5: API Route + Frontend Passthrough

**Files modified:**
- `app/api/ai/extract-signals/route.ts`
- `app/api/sessions/route.ts` (POST)
- `app/api/sessions/[id]/route.ts` (PUT)
- `lib/hooks/use-signal-extraction.ts`
- `app/capture/_components/session-capture-form.tsx`
- `app/capture/_components/expanded-session-row.tsx`

**Verification:**
- Extract signals → response includes `structuredJson`
- Save new session → `structured_json` column populated in DB
- Save existing session (re-extract) → `structured_json` column updated
- Save existing session (manual edit) → `structured_json` column unchanged
- `prompt_version_id` recorded correctly on extraction (P1.R6)
- Frontend renders identically — no visual changes

#### Increment 6: End-of-Part Audit

**Actions:**
1. SRP check — each new file/function does one thing
2. DRY check — `callModelObject()` shares retry logic pattern with `callModel()` (evaluate extracting shared retry logic into a helper; do so if the duplication is > 20 lines)
3. Design token adherence — N/A (no UI changes)
4. Logging — verify `ai-service.ts` logs entry, exit, and errors for `callModelObject()`
5. Dead code — `signal-extraction.ts` old prompt is still imported by the prompt editor (`use-prompt-editor.ts`). Retained for that consumer. No action needed.
6. Convention compliance — named exports, kebab-case files, import order
7. Update `ARCHITECTURE.md` — add `structured_json` to sessions table, add new files to file map, update `ai-service.ts` description
8. Update `CHANGELOG.md`
9. Run `npx tsc --noEmit`

---
---

## Part 2: Switch UI to Render from JSON

**Scope:** Replace the markdown-based rendering of extracted signals with a typed React component (`StructuredSignalView`) that renders directly from `structured_json`. Sessions without `structured_json` (pre-Part 1) fall back to the existing markdown renderer. Manual editing of structured notes continues to work via the existing `MarkdownPanel`. The extraction API response already includes `structuredJson` (added in Part 1, Option C).

### Forward Compatibility Notes

The `StructuredSignalView` component built here is a pure presentational component that accepts `ExtractedSignals` as a prop. Future PRDs (dashboard widgets, RAG chat context panel) can import and reuse it wherever structured signal data needs to be displayed.

Manual edits to structured notes currently operate on the markdown representation only — `structured_json` is not updated when the user edits markdown. This is acceptable pre-launch. A future PRD could add bidirectional sync (parse edited markdown back to JSON) or replace the markdown editor with a structured form editor.

---

### No Database Changes

Part 2 has no schema migrations. All required columns (`structured_json`) were added in Part 1.

---

### New Files

#### 1. `components/capture/structured-signal-view.tsx`

**Purpose:** Renders an `ExtractedSignals` object as formatted UI with discrete sections, severity badges, quote formatting, and empty-state handling. This is the primary replacement for rendering extraction output via `ReactMarkdown`.

**Location:** `components/capture/` — shared component level because it will be reused by future PRDs (dashboard, chat context). Not co-located with a specific route.

**Export:** `StructuredSignalView` (named export)

**Props interface:**

```typescript
export interface StructuredSignalViewProps {
  signals: ExtractedSignals;
  className?: string;
}
```

**Rendering rules (P2.R3, P2.R4, P2.R7):**

The component renders sections in the same order as the markdown renderer to maintain visual consistency:

1. **Session Summary** — `signals.summary` as a paragraph.
2. **Sentiment** — `signals.sentiment` as a styled badge (colour-coded: positive = green, negative = red, mixed = amber, neutral = grey). Uses design tokens from `globals.css`.
3. **Urgency** — `signals.urgency` as a styled badge (low = grey, medium = amber, high = orange, critical = red).
4. **Decision Timeline** — `signals.decisionTimeline` as text. If `null`, render "Not mentioned" in muted text.
5. **Client Profile** — Three fields (`industry`, `geography`, `budgetRange`) as a compact key-value list. Null fields render as "Not mentioned" in muted text.
6. **Pain Points** — `SignalChunkList` sub-component (see below).
7. **Requirements** — `RequirementChunkList` sub-component with priority badges.
8. **Aspirations** — `SignalChunkList`.
9. **Competitive Mentions** — `CompetitiveMentionList` sub-component.
10. **Blockers / Dependencies** — `SignalChunkList`.
11. **Platforms & Channels** — `ToolAndPlatformList` sub-component.
12. **Custom Categories** — For each entry in `signals.custom`, render `categoryName` as a section heading and `signals` via `SignalChunkList`.

**Empty state (P2.R4):** Each array section checks `array.length === 0`. If empty, render "No signals identified." in muted text — matching the existing markdown behavior.

**Sub-components (co-located in the same file as private components):**

```typescript
// --- SignalChunkList ---
// Renders an array of SignalChunk as a bulleted list.
// Each item: text + severity badge (right-aligned) + client quote (italic, below).

function SignalChunkList({ chunks }: { chunks: SignalChunk[] }) {
  if (chunks.length === 0) {
    return <p className="text-sm text-muted-foreground">No signals identified.</p>;
  }
  return (
    <ul className="space-y-2">
      {chunks.map((chunk, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start justify-between gap-2">
            <span>{chunk.text}</span>
            <SeverityBadge severity={chunk.severity} />
          </div>
          {chunk.clientQuote && (
            <p className="mt-0.5 text-xs italic text-muted-foreground">
              &ldquo;{chunk.clientQuote}&rdquo;
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- RequirementChunkList ---
// Like SignalChunkList but with a priority badge before the text.

function RequirementChunkList({ chunks }: { chunks: RequirementChunk[] }) {
  if (chunks.length === 0) {
    return <p className="text-sm text-muted-foreground">No signals identified.</p>;
  }
  return (
    <ul className="space-y-2">
      {chunks.map((chunk, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <PriorityBadge priority={chunk.priority} />
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <span>{chunk.text}</span>
                <SeverityBadge severity={chunk.severity} />
              </div>
              {chunk.clientQuote && (
                <p className="mt-0.5 text-xs italic text-muted-foreground">
                  &ldquo;{chunk.clientQuote}&rdquo;
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- CompetitiveMentionList ---
// Renders competitor name (bold), sentiment badge, and context.

function CompetitiveMentionList({ mentions }: { mentions: CompetitiveMention[] }) {
  if (mentions.length === 0) {
    return <p className="text-sm text-muted-foreground">No signals identified.</p>;
  }
  return (
    <ul className="space-y-2">
      {mentions.map((m, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <span className="font-medium">{m.competitor}</span>
            <SentimentBadge sentiment={m.sentiment} />
          </div>
          <p className="mt-0.5 text-muted-foreground">{m.context}</p>
        </li>
      ))}
    </ul>
  );
}

// --- ToolAndPlatformList ---
// Renders name (bold), type badge, and context.

function ToolAndPlatformList({ tools }: { tools: ToolAndPlatform[] }) {
  if (tools.length === 0) {
    return <p className="text-sm text-muted-foreground">No signals identified.</p>;
  }
  return (
    <ul className="space-y-2">
      {tools.map((t, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <span className="font-medium">{t.name}</span>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t.type}
            </span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{t.context}</p>
        </li>
      ))}
    </ul>
  );
}
```

**Badge sub-components (co-located):**

```typescript
// --- SeverityBadge ---
// Renders low/medium/high as a small coloured badge.
// Colours: low = grey (muted), medium = amber (--status-warning), high = red (--status-error)

function SeverityBadge({ severity }: { severity: "low" | "medium" | "high" }) { ... }

// --- PriorityBadge ---
// Renders must/should/nice as a small coloured badge.
// Colours: must = red, should = amber, nice = grey

function PriorityBadge({ priority }: { priority: "must" | "should" | "nice" }) { ... }

// --- SentimentBadge ---
// Renders positive/neutral/negative as a small coloured badge.
// Same colour scheme as SeverityBadge sentiment mapping.

function SentimentBadge({ sentiment }: { sentiment: "positive" | "neutral" | "negative" }) { ... }
```

**Design tokens:** All badge colours use CSS custom properties from `globals.css` (e.g., `--status-warning`, `--status-error`, `--status-success`). No hardcoded hex values. If any needed tokens are missing, they are added in the same increment.

**Server vs Client component:** This component is a **Client Component** (`'use client'`) because it receives props from parent client components (the capture form and expanded row are already client components). No hooks or browser APIs needed — but the parent boundary is already client-side.

---

### Modified Files

#### 2. `app/capture/_components/structured-notes-panel.tsx`

**Changes (P2.R5, P2.R6):**

This component currently wraps `MarkdownPanel` unconditionally. It becomes the **branching point** between the new JSON renderer and the existing markdown fallback.

**Updated logic:**

```typescript
"use client"

import { MarkdownPanel } from "./markdown-panel"
import { StructuredSignalView } from "@/components/capture/structured-signal-view"
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema"

interface StructuredNotesPanelProps {
  structuredNotes: string | null;
  structuredJson: Record<string, unknown> | null;
  onChange: (notes: string | null) => void;
  readOnly?: boolean;
}

export function StructuredNotesPanel({
  structuredNotes,
  structuredJson,
  onChange,
  readOnly,
}: StructuredNotesPanelProps) {
  if (!structuredNotes && !structuredJson) return null;

  // Determine display mode:
  // - If structuredJson is available → render via StructuredSignalView (primary)
  // - Otherwise fall back to MarkdownPanel (pre-Part 1 sessions)
  const hasJson = structuredJson !== null;

  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        Extracted Signals
      </h3>

      {hasJson ? (
        <StructuredSignalView signals={structuredJson as ExtractedSignals} />
      ) : (
        <MarkdownPanel
          content={structuredNotes!}
          onChange={readOnly ? undefined : (v) => onChange(v)}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
```

**Cast justification:** `structuredJson as ExtractedSignals` is safe here because the JSON was validated by Zod's `extractionSchema` at extraction time (in `callModelObject`). The repository layer stores it as `Record<string, unknown>` for layer separation, but the data is guaranteed to conform. A future hardening step could add runtime re-validation here.

**Manual editing (P2.R6):** When `structuredJson` is present, the `StructuredSignalView` is read-only — there is no structured form editor. The user can still switch to markdown editing via a toggle (see increment detail below). When editing, the markdown representation is what gets modified, and `structured_json` remains unchanged in the DB. This is acceptable pre-launch; a structured form editor is a future PRD concern.

**Edit toggle approach:** When the user has `structured_json` and wants to edit, they need a way to switch from the JSON view to the markdown editor. Two options:

- **Option A:** Add an Edit button to `StructuredNotesPanel` that swaps `StructuredSignalView` for `MarkdownPanel` in edit mode. The user edits markdown, saves, and `structured_notes` is updated. `structured_json` is left stale (acceptable pre-launch — `structured_notes_edited` flag already tracks this).

- **Option B:** Remove manual editing entirely when `structured_json` is present — force re-extraction for changes. Too restrictive.

**Decision — Option A.** The panel shows `StructuredSignalView` by default. A Pencil icon toggles to `MarkdownPanel` (edit mode). Saving from edit mode updates `structured_notes` and sets `structured_notes_edited = true`. The `structured_json` column is not modified (server logic from Part 1 already handles this — `structured_json` is only sent on `isExtraction: true` saves).

---

#### 3. `app/capture/_components/session-capture-form.tsx`

**Changes:**

1. Pass `structuredJson` from the extraction hook to `StructuredNotesPanel`:
   ```typescript
   <StructuredNotesPanel
     structuredNotes={structuredNotes}
     structuredJson={structuredJson}
     onChange={setStructuredNotes}
   />
   ```

Minimal change — the form already has `structuredJson` from the hook (Part 1). It just needs to forward it to the panel.

---

#### 4. `app/capture/_components/expanded-session-row.tsx`

**Changes (P2.R5, P2.R6):**

The expanded row currently renders extracted signals via `MarkdownPanel` directly (not through `StructuredNotesPanel`). Two changes needed:

1. **Source `structured_json` from the session prop.** The `SessionRow` interface already includes `structured_json` (from Part 1). The expanded row receives the session as a prop, so `session.structured_json` is available.

2. **Replace the inline `MarkdownPanel` with `StructuredNotesPanel`:**

   Current pattern (approximate):
   ```tsx
   {extractionState === "done" && structuredNotes && (
     <MarkdownPanel
       content={structuredNotes}
       onChange={canEdit ? setStructuredNotes : undefined}
       readOnly={!canEdit}
     />
   )}
   ```

   Updated pattern:
   ```tsx
   {(extractionState === "done" || session.structured_notes) && (
     <StructuredNotesPanel
       structuredNotes={structuredNotes ?? session.structured_notes}
       structuredJson={structuredJson ?? session.structured_json}
       onChange={canEdit ? setStructuredNotes : undefined}
       readOnly={!canEdit}
     />
   )}
   ```

   **Key detail:** When loading an existing session (no fresh extraction), the panel reads from `session.structured_json` and `session.structured_notes`. When the user re-extracts, the hook state (`structuredJson`, `structuredNotes`) takes precedence.

3. **Resolve the `structuredJson` state for existing sessions vs fresh extractions:**

   The `useSignalExtraction` hook's `structuredJson` starts as `null` and is only populated after a fresh extraction. For displaying an existing session's JSON, the component must read from `session.structured_json`. The display logic uses a resolved value:

   ```typescript
   const resolvedStructuredJson = structuredJson ?? (session.structured_json as Record<string, unknown> | null);
   ```

---

#### 5. `lib/hooks/use-signal-extraction.ts`

**No changes required.** The hook already exposes `structuredJson` in its return value (Part 1). Part 2 consumers just need to read it.

---

#### 6. `globals.css` (if needed)

**Potential changes:** If any badge colour tokens are missing (e.g., `--status-success` for positive sentiment), add them. Verify existing tokens cover: success (green), warning (amber), error (red), neutral (grey). This is checked in Increment 1 before building the component.

---

### Implementation Increments

#### Increment 2.1: `StructuredSignalView` Component

**Files created:**
- `components/capture/structured-signal-view.tsx`

**Files potentially modified:**
- `globals.css` — add any missing badge colour tokens

**What this delivers:**
- The full `StructuredSignalView` component with all sub-components (SignalChunkList, RequirementChunkList, CompetitiveMentionList, ToolAndPlatformList) and badge components (SeverityBadge, PriorityBadge, SentimentBadge)
- All sections rendered: summary, sentiment, urgency, decision timeline, client profile, pain points, requirements, aspirations, competitive mentions, blockers, platforms & channels, custom categories
- Empty-state handling for all array sections
- Null-field handling for nullable fields

**Verification:**
- TypeScript compiles (`npx tsc --noEmit`)
- Component can be imported without errors (no circular dependencies)
- Badge tokens exist in `globals.css`

#### Increment 2.2: Wire `StructuredNotesPanel` to Branch Between JSON and Markdown

**Files modified:**
- `app/capture/_components/structured-notes-panel.tsx` — add `structuredJson` prop, branch rendering logic, edit toggle (Pencil icon to switch from JSON view to markdown editor)

**What this delivers:**
- When `structuredJson` is present → renders `StructuredSignalView`
- When `structuredJson` is null → falls back to `MarkdownPanel` (existing behavior)
- Edit toggle: Pencil icon switches from JSON view to markdown editor; Eye icon switches back to JSON view
- `readOnly` prop controls whether the edit toggle is shown

**Verification:**
- TypeScript compiles
- Panel renders `StructuredSignalView` when JSON prop is provided
- Panel renders `MarkdownPanel` when JSON prop is null
- Edit toggle works: clicking Pencil shows markdown editor, clicking Eye shows JSON view

#### Increment 2.3: Wire Capture Form + Expanded Row

**Files modified:**
- `app/capture/_components/session-capture-form.tsx` — pass `structuredJson` to `StructuredNotesPanel`
- `app/capture/_components/expanded-session-row.tsx` — replace inline `MarkdownPanel` with `StructuredNotesPanel`, resolve `structuredJson` from session prop vs hook state

**What this delivers:**
- New sessions: extraction → JSON view rendered via `StructuredSignalView`
- Existing sessions: `structured_json` from DB → JSON view rendered
- Pre-Part 1 sessions (`structured_json = null`): markdown fallback
- Manual edit flow: toggle to markdown, edit, save → `structured_notes` updated, `structured_json` unchanged
- Re-extract flow: fresh extraction → new JSON rendered, save → both columns updated

**Verification:**
- TypeScript compiles
- End-to-end: create new session → extract → verify JSON view renders with severity badges, quotes, sections
- End-to-end: open existing session with `structured_json` → verify JSON view renders
- End-to-end: open pre-Part 1 session (no `structured_json`) → verify markdown fallback renders
- Manual edit: toggle to markdown → edit → save → verify `structured_notes` updated in DB, `structured_json` unchanged
- Re-extract: click re-extract → verify new JSON replaces old → save → verify both columns updated
- Visual regression: compare JSON view sections with markdown output for the same session — content should be equivalent

#### Increment 2.4: End-of-Part Audit

**Actions:**
1. SRP check — `StructuredSignalView` renders, sub-components handle individual section types, panel handles branching
2. DRY check — badge components reuse a common pattern; verify no duplication across SignalChunkList/RequirementChunkList (they differ by priority badge, so separate components are justified)
3. Design token adherence — all colours use CSS custom properties, no hardcoded values
4. Dead code — check if `MarkdownPanel` is still imported where needed (it's retained for fallback and raw notes display)
5. Convention compliance — named exports, kebab-case files, import order, `className` prop on public components
6. Update `ARCHITECTURE.md` — add `structured-signal-view.tsx` to file map, update `structured-notes-panel.tsx` description
7. Update `CHANGELOG.md`
8. Run `npx tsc --noEmit`
