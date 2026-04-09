# PRD-018: Structured Output Migration

> **Master PRD Section:** Section 18 — Structured Output Migration
> **Status:** Draft
> **Deliverable:** Signal extraction produces versioned, schema-validated JSON alongside markdown so that downstream features (vector search, dashboard, chat) can consume structured, queryable data.

## Purpose

The current signal extraction pipeline returns free-form markdown. While readable for humans, markdown cannot be programmatically queried, chunked for embeddings, or aggregated into dashboard widgets. Every downstream feature on the roadmap — the RAG chat interface (PRD-019), the AI-powered insights dashboard (PRD-020), and any future analytics — requires structured, typed extraction output.

This PRD migrates the extraction output from markdown to a schema-validated JSON structure while preserving full backward compatibility with existing sessions. The JSON schema defines a fixed set of signal categories (pain points, requirements, competitive mentions, etc.) with a flexible `custom` escape hatch for user-defined categories. Custom prompts continue to control *what the LLM pays attention to and how it interprets notes* — they no longer control the *output format*, which is now system-owned.

The schema is explicitly versioned from day one so that future schema evolutions can coexist with older extractions without data loss or breaking changes.

## User Story

"As a user who captures client session notes, I want the extraction output to be structured and reliable so that my insights can power search, dashboards, and cross-client analysis — without losing the flexibility of my custom prompts."

---

## Part 1: Define the Extraction Schema and Produce JSON Output

**Scope:** Define the Zod schema for structured extraction output. Update the extraction service to use `generateObject()` and return validated JSON. Store the JSON in a new column alongside the existing `structured_notes` markdown. No UI changes — the frontend continues to render markdown derived from the JSON.

### Requirements

- **P1.R1** Define a Zod schema (`extractionSchema`) in `lib/schemas/extraction-schema.ts` that captures all signal categories currently produced by the markdown extraction prompt. The schema must include:
  - `schemaVersion` — integer, starting at `1`, stored with every extraction for forward-compatible migrations.
  - `summary` — string, 2-3 sentence session overview.
  - `sentiment` — enum: `positive`, `neutral`, `negative`, `mixed`.
  - `urgency` — enum: `low`, `medium`, `high`, `critical`.
  - `decisionTimeline` — nullable string.
  - `clientProfile` — object with nullable fields: `industry`, `geography`, `budgetRange`.
  - `painPoints` — array of signal chunks (see P1.R2).
  - `requirements` — array of signal chunks extended with `priority` enum: `must`, `should`, `nice`.
  - `aspirations` — array of signal chunks.
  - `competitiveMentions` — array of objects: `competitor` (string), `context` (string), `sentiment` (enum: `positive`, `neutral`, `negative`).
  - `blockers` — array of signal chunks.
  - `toolsAndPlatforms` — array of objects: `name` (string), `context` (string), `type` (enum: `tool`, `platform`, `competitor`).
  - `custom` — array of objects: `categoryName` (string), `signals` (array of signal chunks). The escape hatch for user-defined categories from custom prompts.

- **P1.R2** Define a reusable `signalChunkSchema` used across signal categories. Each chunk contains:
  - `text` — string, the distilled signal statement.
  - `clientQuote` — nullable string, a direct quote from the raw notes if available.
  - `severity` — enum: `low`, `medium`, `high`.
  The LLM must return `null` for `clientQuote` when no direct quote exists in the notes. The LLM must never fabricate quotes or infer severity beyond what the notes support. If severity cannot be determined, default to `medium`.

- **P1.R3** Update `ai-service.ts` to use `generateObject()` from the Vercel AI SDK with `extractionSchema` instead of `generateText()`. The system prompt is updated to instruct the LLM to populate the schema fields. The user's custom prompt (if active) is appended to the system prompt as additional extraction guidance — it does not override or replace the schema instruction.

- **P1.R4** Add a new column `structured_json` (type `jsonb`, nullable) to the `sessions` table. The existing `structured_notes` (markdown) column is retained and continues to be populated — derived by rendering the JSON into the same markdown format the current prompt produces. Both columns are written in a single transaction on extraction.

- **P1.R5** The `ExtractionResult` interface returned by `extractSignals()` is extended to include `structuredJson: ExtractedSignals` (the typed schema output) alongside the existing `structuredNotes: string` (markdown).

- **P1.R6** The `prompt_version_id` traceability link (from PRD-014) continues to work. The prompt version ID is stored alongside the JSON extraction just as it is today with markdown.

- **P1.R7** Every array field in the schema must accept an empty array (`[]`). Every nullable field must accept `null`. The system prompt must explicitly instruct the LLM: "If a category has no signals, return an empty array. If a field cannot be determined from the notes, return null. Do not fabricate, guess, or infer information not explicitly present in the notes."

- **P1.R8** The extraction API route (`/api/ai/extract-signals`) response shape is unchanged for existing consumers. The JSON is stored server-side but not yet exposed in the API response until the UI is ready to consume it (Part 3).

### Acceptance Criteria

- [ ] `extractionSchema` and `signalChunkSchema` are defined in `lib/schemas/extraction-schema.ts` with full Zod validation
- [ ] `schemaVersion` field is present and defaults to `1`
- [ ] `extractSignals()` uses `generateObject()` and returns validated JSON conforming to the schema
- [ ] `structured_json` column exists on `sessions` table (jsonb, nullable)
- [ ] Both `structured_notes` (markdown) and `structured_json` are written on every new extraction
- [ ] Custom prompts are appended as guidance, not as output format instructions
- [ ] `prompt_version_id` is recorded on extraction as before
- [ ] Empty arrays and null values are correctly handled when the LLM has no data for a category
- [ ] The LLM never fabricates quotes — `clientQuote` is `null` when no direct quote exists
- [ ] Existing API response shape is unchanged — no frontend breakage

---

## Part 2: Switch UI to Render from JSON

**Scope:** Update the frontend to render extraction results from `structured_json` instead of raw markdown. The markdown column becomes a fallback for pre-Part 1 sessions that were never re-extracted. The extraction API response is updated to include the JSON.

### Requirements

- **P2.R1** Update the extraction API response (`/api/ai/extract-signals`) to include `structuredJson` in the response body alongside `structuredNotes`. The `structuredNotes` field remains for backward compatibility.

- **P2.R2** Update the session detail API to return `structured_json` alongside `structured_notes`.

- **P2.R3** Build a renderer component (`StructuredSignalView`) that takes the typed `ExtractedSignals` object and renders it as formatted UI — not by converting back to markdown, but by rendering each section (pain points, requirements, etc.) as discrete UI elements with appropriate styling, severity badges, and quote formatting.

- **P2.R4** The renderer gracefully handles missing data: empty arrays render as "No signals identified" (matching current markdown behavior), null fields are omitted from display.

- **P2.R5** For sessions that have `structured_json = NULL` (pre-Part 1 sessions that were never re-extracted), fall back to rendering the existing `structured_notes` markdown as-is. The UI must handle both paths seamlessly.

- **P2.R6** The session capture form's "structured notes" preview panel switches to using `StructuredSignalView` for new extractions. Existing edit functionality (manual edits to structured notes) is preserved — edits update both the JSON and the markdown representation.

- **P2.R7** The `custom` field entries are rendered dynamically: each entry's `categoryName` becomes a section heading, and its `signals` array is rendered identically to the fixed categories.

### Acceptance Criteria

- [ ] Extraction API response includes `structuredJson` field
- [ ] Session detail API returns `structured_json`
- [ ] `StructuredSignalView` component renders all schema sections with proper formatting
- [ ] Empty arrays display "No signals identified"
- [ ] Null fields are omitted from display
- [ ] Sessions without `structured_json` fall back to markdown rendering
- [ ] Custom categories render dynamically with the same signal chunk UI
- [ ] Manual edit functionality continues to work, updating both JSON and markdown

---

## Backlog (deferred from this PRD)

- **Backfill existing sessions** — Post-launch, if needed: build a script/API route to migrate pre-Part 1 sessions that have `structured_notes` but no `structured_json`. Re-extract from `raw_notes` via `generateObject()`, process in batches with rate limiting, skip sessions with no extraction, make idempotent. Not needed pre-launch since no production data exists.
- Remove `structured_notes` markdown column entirely once all sessions have `structured_json` and the UI is fully migrated (breaking change — requires migration period)
- Schema evolution tooling: automated migration functions that upgrade `schemaVersion: N` to `schemaVersion: N+1` when the schema changes
- Prompt editor update: replace free-form text box with guided "focus areas" and "custom categories" UI that generates prompt additions without letting users override the output format
- Validate that `generateObject()` token usage stays within acceptable bounds compared to `generateText()` — monitor cost delta
