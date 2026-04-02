# TRD-003: Signal Extraction

> **PRD:** `docs/003-signal-extraction/prd.md`
> **Status:** Complete — Parts 1, 2, 3, and 4 implemented (2026-03-26)

---

## Part 1: Database Schema Update

### Technical Decisions

- **Single column addition:** Add `structured_notes` (TEXT, nullable) to the existing `sessions` table. No new tables, no new indexes, no new RLS policies. The column inherits all existing table-level RLS rules automatically.
- **Nullable, not empty string:** A NULL value means "not yet enriched." This is semantically clearer than an empty string and makes querying straightforward — `WHERE structured_notes IS NOT NULL` returns all enriched sessions. This also means the column has no default value; it is simply absent until explicitly set.
- **No data migration:** Existing rows get `structured_notes = NULL` automatically when the column is added (Postgres default behaviour for nullable columns). No backfill, no script, no downtime.
- **No schema-level constraint on content:** The column stores free-form markdown text. There is no CHECK constraint on format or length beyond Postgres's TEXT type (which is effectively unlimited). Validation of the markdown structure happens at the application layer (prompt engineering + optional Zod check), not the database.
- **API contract changes are additive:** The GET, POST, and PUT session endpoints add `structuredNotes` to their request/response contracts. This is backwards-compatible — existing clients that don't send `structuredNotes` get null, and the response simply includes a new field that old consumers can ignore.
- **Service layer changes are minimal:** The `Session` and `SessionWithClient` interfaces gain a `structured_notes` field. The `CreateSessionInput` and `UpdateSessionInput` interfaces gain an optional `structuredNotes` field. The Supabase queries are updated to include the new column in SELECT and INSERT/UPDATE operations.

### Database Schema

#### Migration: Add `structured_notes` to `sessions`

```sql
-- Add structured_notes column to sessions table
-- Stores markdown-formatted signal extraction output, NULL when not enriched
ALTER TABLE sessions ADD COLUMN structured_notes TEXT;
```

No index is needed on `structured_notes` for Part 1. If future requirements need to query "all sessions with/without structured notes," a partial index can be added later:

```sql
-- Future consideration (not needed now):
-- CREATE INDEX sessions_structured_notes_exists_idx ON sessions ((structured_notes IS NOT NULL)) WHERE deleted_at IS NULL;
```

### API Endpoint Changes

#### `GET /api/sessions`

**Response change:** Each session object in the response now includes `structured_notes`.

Before:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "client_name": "Acme Corp",
      "session_date": "2026-03-25",
      "raw_notes": "Met with Acme team...",
      "created_by": "uuid",
      "created_at": "2026-03-25T10:00:00Z"
    }
  ],
  "total": 1
}
```

After:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "client_name": "Acme Corp",
      "session_date": "2026-03-25",
      "raw_notes": "Met with Acme team...",
      "structured_notes": "## Session Summary\n...",
      "created_by": "uuid",
      "created_at": "2026-03-25T10:00:00Z"
    }
  ],
  "total": 1
}
```

`structured_notes` will be `null` for sessions that haven't been enriched.

#### `POST /api/sessions`

**Request body change:** Accepts an optional `structuredNotes` field.

```typescript
{
  clientId: string | null,
  clientName: string,
  sessionDate: string,
  rawNotes: string,
  structuredNotes?: string | null  // NEW — optional, defaults to null
}
```

**Zod schema update:** Add `structuredNotes` as an optional nullable string to `createSessionSchema`.

```typescript
structuredNotes: z.string().max(100000, "Structured notes must be 100,000 characters or fewer").nullable().optional().default(null),
```

**Response:** The returned session object includes `structured_notes`.

#### `PUT /api/sessions/[id]`

**Request body change:** Same as POST — accepts optional `structuredNotes`.

```typescript
{
  clientId: string | null,
  clientName: string,
  sessionDate: string,
  rawNotes: string,
  structuredNotes?: string | null  // NEW — optional
}
```

**Zod schema update:** Same as POST — add `structuredNotes` as optional nullable string to `updateSessionSchema`.

**Behaviour:** When `structuredNotes` is provided, it overwrites the existing value (including setting it to null to clear enrichment). When `structuredNotes` is omitted from the request body (`undefined`), the existing value is preserved — this ensures that saves from old clients or saves that only update raw notes don't accidentally wipe out existing structured notes.

### Service Layer Changes

#### `lib/services/session-service.ts`

**Interface changes:**

```typescript
// Add to Session interface
export interface Session {
  id: string;
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;  // NEW
  created_by: string;
  created_at: string;
}

// SessionWithClient inherits the change via extends

// Add to CreateSessionInput
export interface CreateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;  // NEW — optional
}

// Add to UpdateSessionInput
export interface UpdateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;  // NEW — optional
}
```

**`getSessions()` change:**

Update the Supabase SELECT to include `structured_notes`:

```typescript
// Before:
.select("id, client_id, session_date, raw_notes, created_by, created_at, clients(name)", { count: "exact" })

// After:
.select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, clients(name)", { count: "exact" })
```

Update the row transformation to include `structured_notes`:

```typescript
return {
  id: row.id,
  client_id: row.client_id,
  session_date: row.session_date,
  raw_notes: row.raw_notes,
  structured_notes: row.structured_notes ?? null,  // NEW
  created_by: row.created_by,
  created_at: row.created_at,
  client_name: clientData?.name ?? "Unknown",
};
```

**`createSession()` change:**

Update the INSERT to include `structured_notes` and the SELECT to return it:

```typescript
const { data, error } = await supabase
  .from("sessions")
  .insert({
    client_id: resolvedClientId,
    session_date: sessionDate,
    raw_notes: rawNotes,
    structured_notes: structuredNotes ?? null,  // NEW
  })
  .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
  .single();
```

**`updateSession()` change:**

Build the update object conditionally to support the "omit = preserve" behaviour:

```typescript
// Build update payload — only include structured_notes if explicitly provided
const updatePayload: Record<string, unknown> = {
  client_id: resolvedClientId,
  session_date: sessionDate,
  raw_notes: rawNotes,
};

// Only overwrite structured_notes when the caller explicitly passes it
// (undefined means "don't touch it", null means "clear it", string means "set it")
if (structuredNotes !== undefined) {
  updatePayload.structured_notes = structuredNotes;
}

const { data, error } = await supabase
  .from("sessions")
  .update(updatePayload)
  .eq("id", id)
  .is("deleted_at", null)
  .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
  .single();
```

### Files Changed

| File | Change |
|------|--------|
| `lib/services/session-service.ts` | Add `structured_notes` to interfaces (`Session`, `CreateSessionInput`, `UpdateSessionInput`). Update `getSessions`, `createSession`, `updateSession` to include the new column in queries and responses. |
| `app/api/sessions/route.ts` | Add `structuredNotes` to `createSessionSchema` (optional, nullable). Pass through to service layer. Include in response. |
| `app/api/sessions/[id]/route.ts` | Add `structuredNotes` to `updateSessionSchema` (optional, nullable). Pass through to service layer. Include in response. |

### Implementation Increments

**Increment 1 (single PR):** This part is small enough to ship as one increment.

1. Run the migration in Supabase to add the `structured_notes` column.
2. Update `Session`, `SessionWithClient`, `CreateSessionInput`, and `UpdateSessionInput` interfaces in `session-service.ts`.
3. Update `getSessions()`, `createSession()`, and `updateSession()` to include `structured_notes` in queries.
4. Update `createSessionSchema` and `updateSessionSchema` in the API routes to accept `structuredNotes`.
5. Verify existing flows (create, list, update, delete) still work — `structured_notes` should be null for all existing sessions and the frontend should be unaffected since it doesn't yet read or write the field.
6. Update `ARCHITECTURE.md` — add `structured_notes` to the sessions table in the data model section and update the API route descriptions.
7. Update `CHANGELOG.md`.

### Verification Checklist

- [ ] Migration runs without error — `structured_notes` column exists on `sessions` table
- [ ] Existing sessions have `structured_notes = NULL` after migration
- [ ] `GET /api/sessions` returns `structured_notes` in each session object
- [ ] `POST /api/sessions` accepts `structuredNotes` in the request body and persists it
- [ ] `POST /api/sessions` without `structuredNotes` saves the session with `structured_notes = NULL`
- [ ] `PUT /api/sessions/[id]` with `structuredNotes` updates the value
- [ ] `PUT /api/sessions/[id]` without `structuredNotes` preserves the existing value
- [ ] `PUT /api/sessions/[id]` with `structuredNotes: null` clears the value
- [ ] Existing capture form and past sessions table continue to work without changes
- [ ] RLS policies still function — authenticated users can read/write the new column
- [ ] `ARCHITECTURE.md` data model section reflects the new column
- [ ] `CHANGELOG.md` has an entry for this change

---

## Part 2: Signal Extraction via Claude API

### Technical Decisions

- **Single Claude call per extraction.** One API call extracts all signal categories, session-level attributes, and client profile in a single pass. Splitting into multiple calls adds latency, cost, and complexity with no quality benefit — the raw notes from a single session are well within Claude's context window.
- **Prompt as code.** The system prompt and user message template live in `lib/prompts/signal-extraction.ts` as named exports. Changing a prompt is a code change that goes through review. This prevents untracked prompt drift and makes it easy to correlate prompt versions with output quality.
- **AI service layer.** A new `lib/services/ai-service.ts` encapsulates all Claude API interaction — client instantiation, retry logic, error handling. The API route calls the service; the service calls Claude. This keeps the route handler thin and the AI logic reusable if future features need Claude (e.g., theme suggestion, summarisation).
- **Retry with exponential backoff.** Transient failures (429 rate limit, 500 server error, timeouts) are retried up to 3 times with exponential backoff (1s, 2s, 4s). Non-transient failures (400 bad request) are not retried — those indicate a prompt or input bug. This is implemented in the service layer, not the route handler.
- **Text in, text out.** The Claude response is treated as a raw string (markdown text), not parsed as JSON. This matches the PRD decision to keep structured notes as human-readable markdown. Validation is minimal — we check that the response is non-empty and is a string. We do not parse or validate the markdown structure programmatically.
- **Excess information handling.** Per PRD P2.R4, if the notes contain information that doesn't fit any defined category, Claude captures it under an "Other / Uncategorised" section with a suggested category. This prevents signal loss without forcing signals into wrong categories.
- **Auth via middleware.** The `/api/ai/extract-signals` route is protected by the existing middleware that redirects unauthenticated requests. The route itself uses `createClient()` (which reads the user's session cookies) to verify the user has an active session. If `getUser()` returns no user, the route returns 401.
- **max_tokens sizing.** The structured output is typically 2–4x shorter than the raw input (extraction compresses, it doesn't expand). For safety, `max_tokens` is set to 4096 — sufficient for a comprehensive signal report from even lengthy session notes, while preventing runaway generation.

### Prompt Design

#### `lib/prompts/signal-extraction.ts`

The prompt file exports two named constants:

```typescript
export const SIGNAL_EXTRACTION_SYSTEM_PROMPT: string;
export const buildSignalExtractionUserMessage: (rawNotes: string) => string;
```

**System prompt** defines:
1. Claude's role — a signal extraction analyst for an ad tech performance marketing platform (InMobi context)
2. The exact output structure with markdown formatting rules
3. Each signal category with its definition and examples
4. Explicit instructions on what NOT to do (no fabrication, no filler, no JSON)
5. Handling for empty categories and uncategorised information

**System prompt content:**

```
You are a signal extraction analyst for InMobi, an ad tech company building a performance marketing platform. Your job is to read raw session notes from client calls and extract structured signals into a consistent markdown report.

The platform allows customers to run ads across Google, Bing, Meta, and other platforms from a single interface. Most sessions are onboarding or requirements-gathering calls with prospective customers.

## Output Format

Return a markdown document with the following sections in this exact order. Use ## for section headings and - for bullet points. Use **bold** for labels in the Session Overview and Client Profile sections.

### Section 1: Session Overview

## Session Summary
A single sentence summarising what this session was about.

## Sentiment
**Overall:** [Positive | Mixed | Negative] — [1-2 sentence explanation of why]

## Urgency
**Level:** [Critical | High | Medium | Low] — [1-2 sentence explanation with context from the notes]

## Decision Timeline
**Timeline:** [Specific timeline extracted from notes, e.g., "Q3 2026", "End of April", "Exploring, no fixed timeline"]

### Section 2: Client Profile

## Client Profile
- **Industry / Vertical:** [e.g., E-commerce, Gaming, Fintech, Travel — or "Not mentioned" if absent]
- **Market / Geography:** [e.g., Southeast Asia, North America, Global — or "Not mentioned" if absent]
- **Monthly Ad Spend:** [e.g., "$50K–$100K", "$1M+" — or "Not mentioned" if absent]

### Section 3: Signal Categories

For each category below, extract individual signals as bullet points. Each bullet should be a clear, concise statement of the signal — not a copy-paste from the notes, but a distilled insight.

## Pain Points
What is broken, frustrating, or costly in the customer's current setup. What they are running away from.

## Must-Haves / Requirements
Deal-breaker capabilities. Table stakes the customer considers non-negotiable to even consider the platform.

## Aspirations
Forward-looking wants. "Nice to haves" that would delight but won't block a deal.

## Competitive Mentions
Who the customer is currently using, who else they are evaluating, and what they like or dislike about those tools. Include the competitor name and the context.

## Blockers / Dependencies
What stands between interest and commitment. Technical, organisational, contractual, or timeline-based obstacles.

## Platforms & Channels
Which ad platforms matter to the customer (Google, Meta, Bing, TikTok, programmatic, etc.) and their relative importance or priority.

## Current Stack / Tools
The customer's existing workflow, tools, and systems for campaign management, reporting, attribution, and related operations.

## Other / Uncategorised
Any signals or information from the notes that do not fit the categories above. For each item, suggest which category it might belong to or note that a new category may be needed. Do not force signals into irrelevant categories.

## Rules

1. Only extract information that is explicitly stated or clearly inferable from the notes. Do not fabricate, assume, or hallucinate signals.
2. If a category has no relevant signals in the notes, write "No signals identified." under that heading. Do not omit the heading.
3. Do not include conversational filler, disclaimers, apologies, or meta-commentary (e.g., "Based on the notes provided...").
4. Do not wrap the output in a code block or return JSON. Return clean markdown only.
5. Distill signals into clear, concise statements. Do not copy-paste raw sentences from the notes verbatim unless the exact wording is important.
6. If the same signal is relevant to multiple categories, place it in the most specific category and do not duplicate it.
```

**User message template:**

```typescript
export function buildSignalExtractionUserMessage(rawNotes: string): string {
  return `Extract signals from the following client session notes:\n\n${rawNotes}`;
}
```

### Service Layer

#### `lib/services/ai-service.ts` (new file)

Encapsulates Claude API interaction with retry logic.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import {
  SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  buildSignalExtractionUserMessage,
} from "@/lib/prompts/signal-extraction";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_TOKENS = 4096;

/**
 * Extract signals from raw session notes using Claude.
 * Returns a markdown-formatted signal extraction report.
 * Retries transient failures (429, 500, timeout) with exponential backoff.
 * Throws on non-retryable errors or after exhausting retries.
 */
export async function extractSignals(rawNotes: string): Promise<string> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const model = process.env.CLAUDE_MODEL;
  if (!model) {
    throw new AIConfigError("CLAUDE_MODEL environment variable is not set");
  }

  const userMessage = buildSignalExtractionUserMessage(rawNotes);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[ai-service] extractSignals — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${model}`
      );

      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SIGNAL_EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract text from the response
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text" || !textBlock.text.trim()) {
        throw new AIEmptyResponseError("Claude returned an empty response");
      }

      console.log(
        `[ai-service] extractSignals — success, ${textBlock.text.length} chars`
      );
      return textBlock.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry non-transient errors
      if (err instanceof Anthropic.BadRequestError) {
        console.error("[ai-service] extractSignals — bad request (not retrying):", lastError.message);
        throw new AIRequestError(`Claude rejected the request: ${lastError.message}`);
      }

      // Don't retry our own validation errors
      if (err instanceof AIEmptyResponseError || err instanceof AIConfigError) {
        throw err;
      }

      // Retry transient errors (rate limit, server error, timeout)
      const isRetryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError;

      if (!isRetryable || attempt >= MAX_RETRIES) {
        console.error(
          `[ai-service] extractSignals — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw new AIServiceError(
          `Signal extraction failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[ai-service] extractSignals — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new AIServiceError(
    `Signal extraction failed: ${lastError?.message ?? "unknown error"}`
  );
}

/**
 * Error classes for AI service failures.
 * These allow the API route to map errors to appropriate HTTP status codes.
 */
export class AIServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIEmptyResponseError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIEmptyResponseError";
  }
}

export class AIRequestError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIRequestError";
  }
}

export class AIConfigError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}
```

### API Route

#### `POST /api/ai/extract-signals` — `app/api/ai/extract-signals/route.ts` (new file)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  extractSignals,
  AIServiceError,
  AIEmptyResponseError,
  AIRequestError,
  AIConfigError,
} from "@/lib/services/ai-service";

const extractSignalsSchema = z.object({
  rawNotes: z
    .string()
    .min(1, "Notes are required")
    .max(50000, "Notes must be 50,000 characters or fewer"),
});

export async function POST(request: NextRequest) {
  console.log("[api/ai/extract-signals] POST — extracting signals");

  // Auth check — verify the user has an active session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/ai/extract-signals] POST — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = extractSignalsSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/ai/extract-signals] POST — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  // Call the AI service
  try {
    const structuredNotes = await extractSignals(parsed.data.rawNotes);

    console.log(
      "[api/ai/extract-signals] POST — extraction complete,",
      structuredNotes.length,
      "chars"
    );
    return NextResponse.json({ structuredNotes });
  } catch (err) {
    // Map error types to HTTP status codes
    if (err instanceof AIConfigError) {
      console.error("[api/ai/extract-signals] config error:", err.message);
      return NextResponse.json(
        { message: "AI service is not configured correctly. Please contact support." },
        { status: 500 }
      );
    }

    if (err instanceof AIRequestError) {
      console.error("[api/ai/extract-signals] request error:", err.message);
      return NextResponse.json(
        { message: "Could not process these notes. Please try shortening them or removing special characters." },
        { status: 400 }
      );
    }

    if (err instanceof AIEmptyResponseError) {
      console.error("[api/ai/extract-signals] empty response:", err.message);
      return NextResponse.json(
        { message: "AI could not extract signals from these notes. Please ensure the notes contain session content and try again." },
        { status: 422 }
      );
    }

    if (err instanceof AIServiceError) {
      console.error("[api/ai/extract-signals] service error:", err.message);
      return NextResponse.json(
        { message: "Signal extraction is temporarily unavailable. Please try again in a few moments." },
        { status: 503 }
      );
    }

    // Unexpected error
    console.error(
      "[api/ai/extract-signals] unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "An unexpected error occurred during signal extraction." },
      { status: 500 }
    );
  }
}
```

**HTTP status code mapping:**

| Error Type | HTTP Status | User-Facing Message |
|------------|-------------|---------------------|
| `AIConfigError` | 500 | "AI service is not configured correctly. Please contact support." |
| `AIRequestError` | 400 | "Could not process these notes. Please try shortening them or removing special characters." |
| `AIEmptyResponseError` | 422 | "AI could not extract signals from these notes. Please ensure the notes contain session content and try again." |
| `AIServiceError` (after retries) | 503 | "Signal extraction is temporarily unavailable. Please try again in a few moments." |
| Unexpected error | 500 | "An unexpected error occurred during signal extraction." |

### Files Changed

| File | Change |
|------|--------|
| `lib/prompts/signal-extraction.ts` | **New file.** System prompt and user message template for signal extraction. |
| `lib/services/ai-service.ts` | **New file.** Claude API client wrapper with `extractSignals()`, retry logic, and typed error classes. |
| `app/api/ai/extract-signals/route.ts` | **New file.** POST route handler — auth check, Zod validation, calls ai-service, maps errors to HTTP responses. |

### Implementation Increments

**Increment 1 (single PR):** This part is self-contained and ships as one increment.

1. Create `lib/prompts/signal-extraction.ts` with the system prompt and user message builder.
2. Create `lib/services/ai-service.ts` with the `extractSignals()` function, retry logic, and error classes.
3. Create `app/api/ai/extract-signals/route.ts` with the POST handler.
4. Test the endpoint manually:
   - Send a POST with sample raw notes → verify structured markdown response.
   - Send a POST with empty notes → verify 400 response.
   - Send a POST without auth → verify 401 response.
   - Verify the output follows the defined markdown structure with all sections present.
5. Update `ARCHITECTURE.md` — add the new API route, new files to the file map, and update the current state.
6. Update `CHANGELOG.md`.

### Verification Checklist

- [ ] `POST /api/ai/extract-signals` returns structured markdown for valid raw notes
- [ ] Output contains all defined sections: Summary, Sentiment, Urgency, Decision Timeline, Client Profile, Pain Points, Must-Haves, Aspirations, Competitive Mentions, Blockers, Platforms & Channels, Current Stack, Other / Uncategorised
- [ ] Empty categories show "No signals identified." not fabricated content
- [ ] Uncategorised information is captured under "Other / Uncategorised" with category suggestions
- [ ] Unauthenticated requests return 401
- [ ] Empty or missing `rawNotes` returns 400
- [ ] Notes exceeding 50,000 characters returns 400
- [ ] `max_tokens` is set to 4096 on the Claude API call
- [ ] Model name is read from `CLAUDE_MODEL` environment variable
- [ ] Missing `CLAUDE_MODEL` env var returns 500 with config error message
- [ ] Rate limit errors (429) are retried up to 3 times with exponential backoff
- [ ] Server errors (500) are retried up to 3 times with exponential backoff
- [ ] Bad request errors (400) are not retried
- [ ] All errors are logged server-side with attempt count and error details
- [ ] Prompt file exists at `lib/prompts/signal-extraction.ts` with named exports
- [ ] AI service file exists at `lib/services/ai-service.ts` with typed error classes
- [ ] `ARCHITECTURE.md` reflects new files and API route
- [ ] `CHANGELOG.md` has an entry for this change

---

## Part 3: Capture Form — Extract Signals UX

### Technical Decisions

- **New dependency: `react-markdown` + `remark-gfm`.** For rendering markdown as formatted HTML inside React components. `react-markdown` is the most widely used React markdown renderer — it takes a markdown string and returns React elements, no `dangerouslySetInnerHTML` needed. `remark-gfm` adds GitHub Flavored Markdown support (tables, strikethrough, task lists) which is useful for the structured output format. No other rendering libraries are needed.
- **Markdown panel as a shared component.** The view/edit markdown panel (rendered markdown + edit toggle + textarea) will be needed in Part 4 (past sessions table) as well. Extract it as a reusable component `MarkdownPanel` in `app/capture/_components/` for now (co-located since both Part 3 and Part 4 use it within the capture route). If it's later needed outside `/capture`, it can be promoted to `components/`.
- **Structured notes managed outside react-hook-form.** The structured notes are not a form input in the traditional sense — they're generated by an API call, not typed by the user. Managing them as a separate `useState` variable in the form component keeps the form schema clean (client, date, rawNotes) and avoids Zod validation complexity for an optional AI-generated field. The structured notes are included in the save payload manually.
- **Extraction state machine.** The extraction flow has clear states: `idle` (no extraction attempted), `extracting` (API call in flight), `done` (extraction complete, output available). Use a discriminated union type: `type ExtractionState = 'idle' | 'extracting' | 'done'`. This drives the button icon, label, disabled state, and whether the markdown panel is visible.
- **Icon progression per P3.R7.** The Extract Signals button uses a `Sparkles` icon (from lucide-react) in the `idle` state, a `Loader2` spinner during `extracting`, and a `RefreshCw` icon once extraction is `done` (indicating re-extraction). The label changes from "Extract Signals" → "Extracting..." → "Re-extract Signals".
- **Dirty tracking for re-extraction confirmation.** Track whether the user has edited the structured notes after extraction. Store the "last extracted" value alongside the current value. If they differ when the user clicks re-extract, show a confirmation dialog. If they match (no manual edits), re-extract silently.
- **Form width expansion.** The current form is `max-w-2xl`. With the structured notes panel appearing below the notes textarea, the form may need to expand. Keep `max-w-2xl` for the form inputs but allow the markdown panel to take full width below. This keeps the input area focused and gives the structured output room to breathe.
- **Markdown styling.** The rendered markdown needs CSS for headings, lists, bold, and paragraphs. Use Tailwind's `prose` class from `@tailwindcss/typography` plugin for consistent, clean markdown rendering. This provides sensible defaults for `h2`, `ul`, `li`, `strong`, `p` elements without custom CSS.

### New Dependencies

```bash
npm install react-markdown remark-gfm @tailwindcss/typography
```

- `react-markdown` — renders markdown strings as React elements
- `remark-gfm` — GitHub Flavored Markdown plugin (tables, strikethrough, task lists)
- `@tailwindcss/typography` — Tailwind `prose` class for styled markdown content

**Tailwind config update:** Add the typography plugin to `tailwind.config.ts` (or `postcss.config` / `globals.css` depending on the project's Tailwind v4 setup).

### Frontend Components

#### `MarkdownPanel` — `app/capture/_components/markdown-panel.tsx` (new file)

A reusable view/edit panel for markdown content.

```typescript
interface MarkdownPanelProps {
  content: string;
  onChange: (value: string) => void;
  className?: string;
}
```

**Behaviour:**
- Default mode: **view** — renders markdown using `react-markdown` with `remark-gfm` plugin, wrapped in a `prose` container for typography styling.
- Toggle button (top-right corner): switches between view mode (rendered markdown) and edit mode (raw markdown textarea).
- Edit mode: shows a `<Textarea>` pre-filled with the raw markdown string. Changes update the parent via `onChange`.
- Switching from edit → view re-renders the markdown with any edits the user made.
- The toggle button uses a `Eye` icon for "view" and `Pencil` icon for "edit" (lucide-react), with a tooltip or label.

**Styling:**
- View mode: bordered container with padding, `prose prose-sm` class for markdown typography, max-height with scroll for long content.
- Edit mode: full-height textarea matching the view container dimensions.
- Toggle button: small icon button positioned at the top-right of the panel header.

#### `SessionCaptureForm` — `app/capture/_components/session-capture-form.tsx` (modified)

**State additions:**

```typescript
// Structured notes — managed outside react-hook-form
const [structuredNotes, setStructuredNotes] = useState<string | null>(null);
const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(null);
const [extractionState, setExtractionState] = useState<'idle' | 'extracting' | 'done'>('idle');
```

**New function — `handleExtractSignals`:**

```typescript
async function handleExtractSignals() {
  const rawNotes = getValues("rawNotes");

  // Re-extraction confirmation if user has edited the structured notes
  if (extractionState === 'done' && structuredNotes !== lastExtractedNotes) {
    // Show confirmation — if user cancels, return early
  }

  setExtractionState('extracting');

  try {
    const response = await fetch('/api/ai/extract-signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawNotes }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      toast.error(errorData?.message ?? 'Failed to extract signals');
      // Preserve existing state on failure
      setExtractionState(structuredNotes ? 'done' : 'idle');
      return;
    }

    const { structuredNotes: extracted } = await response.json();
    setStructuredNotes(extracted);
    setLastExtractedNotes(extracted);
    setExtractionState('done');
    toast.success('Signals extracted');
  } catch (err) {
    console.error('[SessionCaptureForm] extraction error:', err);
    toast.error('Failed to extract signals — please try again');
    setExtractionState(structuredNotes ? 'done' : 'idle');
  }
}
```

**Modified `onSubmit`:**

Update the save payload to include `structuredNotes`:

```typescript
body: JSON.stringify({
  clientId: client.id,
  clientName: client.name,
  sessionDate: data.sessionDate,
  rawNotes: data.rawNotes,
  structuredNotes: structuredNotes,  // null if not extracted
}),
```

On successful save, reset structured notes state along with the form:

```typescript
setStructuredNotes(null);
setLastExtractedNotes(null);
setExtractionState('idle');
```

**UI changes:**

After the Notes textarea, add:

1. **Extract Signals button** — positioned below the notes field, in a row with Save Session.
   - `idle` state: `<Sparkles />` icon + "Extract Signals" label. Disabled if `rawNotes` is empty. Uses `variant="outline"` to visually distinguish from the primary Save button.
   - `extracting` state: `<Loader2 className="animate-spin" />` icon + "Extracting..." label. Disabled.
   - `done` state: `<RefreshCw />` icon + "Re-extract Signals" label. Enabled.

2. **Structured notes panel** — visible only when `extractionState === 'done'` and `structuredNotes` is non-null. Uses the `MarkdownPanel` component.
   - Header: "Extracted Signals" label.
   - Body: `<MarkdownPanel content={structuredNotes} onChange={setStructuredNotes} />`

3. **Re-extraction confirmation** — when user clicks re-extract and structured notes have been edited (dirty), show a `Dialog` (shadcn) with:
   - Title: "Re-extract Signals?"
   - Description: "Re-extracting will replace your edited signals. Continue?"
   - Actions: "Cancel" (closes dialog) and "Re-extract" (proceeds with extraction).

**Button layout:**

```
[Extract Signals (outline)]  [Save Session (primary)]
```

### Files Changed

| File | Change |
|------|--------|
| `app/capture/_components/markdown-panel.tsx` | **New file.** Reusable markdown view/edit panel with toggle between rendered markdown and raw textarea. |
| `app/capture/_components/session-capture-form.tsx` | Add extraction state management, Extract Signals button with icon progression, structured notes panel, re-extraction confirmation dialog. Include `structuredNotes` in save payload. Reset extraction state on successful save. |
| `app/globals.css` or Tailwind config | Add `@tailwindcss/typography` plugin for `prose` class support. |
| `package.json` | Add `react-markdown`, `remark-gfm`, `@tailwindcss/typography` dependencies. |

### Implementation Increments

**Increment 3.1: Dependencies and MarkdownPanel component**

1. Install `react-markdown`, `remark-gfm`, and `@tailwindcss/typography`.
2. Configure the typography plugin in Tailwind.
3. Create `markdown-panel.tsx` with view/edit toggle, rendered markdown (prose styling), and raw textarea edit mode.
4. Verify the component renders markdown correctly in isolation.

**Increment 3.2: Extract Signals button and extraction flow**

1. Add extraction state (`idle` / `extracting` / `done`) and structured notes state to `SessionCaptureForm`.
2. Add the Extract Signals button with icon progression (Sparkles → Loader2 → RefreshCw).
3. Implement `handleExtractSignals` — calls the API, updates state, handles errors with toasts.
4. Show the `MarkdownPanel` below the notes field when extraction is done.
5. Verify the full flow: type notes → click extract → see rendered signals → edit → re-extract with confirmation.

**Increment 3.3: Save integration and reset**

1. Update `onSubmit` to include `structuredNotes` in the save payload.
2. Reset extraction state on successful save.
3. Add re-extraction confirmation dialog (shadcn `Dialog`) for dirty structured notes.
4. Verify: save with extraction saves both fields, save without extraction sends `structuredNotes: null`, re-extraction after edits shows confirmation.
5. Update `ARCHITECTURE.md` and `CHANGELOG.md`.

### Verification Checklist

- [ ] `react-markdown`, `remark-gfm`, and `@tailwindcss/typography` are installed and configured
- [ ] `MarkdownPanel` renders markdown with headings, bullets, bold in view mode
- [ ] `MarkdownPanel` shows raw markdown textarea in edit mode
- [ ] Toggle switches between view and edit, re-rendering updated content
- [ ] Extract Signals button appears below the notes textarea
- [ ] Button is disabled when notes are empty
- [ ] Button shows `Sparkles` icon in idle state, `Loader2` spinner during extraction, `RefreshCw` after extraction
- [ ] Button label changes: "Extract Signals" → "Extracting..." → "Re-extract Signals"
- [ ] Successful extraction shows the structured output in a `MarkdownPanel`
- [ ] Extraction failure shows an error toast and preserves existing state
- [ ] Re-extraction with edited structured notes shows a confirmation dialog
- [ ] Re-extraction without edits proceeds silently
- [ ] "Save Session" sends both `rawNotes` and `structuredNotes` in the payload
- [ ] Saving without extraction sends `structuredNotes: null`
- [ ] Successful save resets structured notes and extraction state to idle
- [ ] Form validation still works — Save is disabled until client, date, and notes are filled
- [ ] Extraction state does not affect Save button enablement (extraction is optional)
- [ ] `ARCHITECTURE.md` reflects new component and dependencies
- [ ] `CHANGELOG.md` has an entry for this change

---

## Part 4: Past Sessions — Side-by-Side View with Markdown Rendering

### Technical Decisions

- **`SessionRow` interface gains `structured_notes`.** The existing `SessionRow` interface in `past-sessions-table.tsx` omits `structured_notes`. Adding it as `string | null` makes it available to both the collapsed row (for the extraction status indicator) and the expanded row (for the side-by-side view).
- **Side-by-side layout using CSS grid.** The expanded row currently shows a single-column form. Part 4 replaces the single notes textarea with a two-column grid: raw notes (left) and structured notes (right). On narrow viewports, the columns stack vertically. Use `grid grid-cols-1 md:grid-cols-2 gap-4` for the layout.
- **Reuse `MarkdownPanel` from Part 3.** Both panels (raw notes and structured notes) use the `MarkdownPanel` component created in Part 3. This provides view/edit toggle with rendered markdown and raw textarea editing out of the box.
- **Extraction in expanded row.** The expanded row gains its own extraction state (`idle` / `extracting` / `done`) and an "Extract Signals" or "Re-extract" button, mirroring the capture form. The extraction function is identical — calls `POST /api/ai/extract-signals` with the current raw notes. The button sits above the structured notes panel.
- **Dirty tracking expands to include structured notes.** The `isDirty` check currently compares client, date, and rawNotes. It now also includes `structuredNotes` — checking against the session's original `structured_notes` value. This ensures unsaved changes to structured notes trigger the "Save/Discard/Cancel" prompt when switching rows.
- **Save includes `structuredNotes`.** The PUT request in the expanded row now includes `structuredNotes` in the payload. This follows the same "omit = preserve" contract from Part 1 — but since the expanded row always has the structured notes state loaded, it always sends the value explicitly.
- **Extraction status indicator on collapsed rows.** A small `Sparkles` icon (filled/coloured) appears next to the notes preview on rows that have `structured_notes !== null`. This gives a quick visual scan of which sessions have been enriched. Use a muted colour for the icon to keep it subtle — not a badge, just an inline icon.
- **Empty state for structured panel.** When a session has no structured notes and the expanded view opens, the right panel shows "No signals extracted yet" with a centred "Extract Signals" button. Once extraction completes, the panel transitions to the `MarkdownPanel` with the result.

### Frontend Components

#### `SessionRow` interface — `past-sessions-table.tsx` (modified)

```typescript
interface SessionRow {
  id: string
  client_id: string
  client_name: string
  session_date: string
  raw_notes: string
  structured_notes: string | null  // NEW
  created_at: string
}
```

#### `SessionTableRow` — collapsed row changes

Add extraction status indicator next to the truncated notes:

```tsx
<td className="px-4 py-2.5 text-muted-foreground">
  <span className="flex items-center gap-1.5">
    {truncateNotes(session.raw_notes)}
    {session.structured_notes && (
      <Sparkles className="size-3.5 shrink-0 text-primary/60" />
    )}
  </span>
</td>
```

The `Sparkles` icon in `primary/60` (muted brand colour) provides a subtle but visible indicator.

#### `ExpandedSessionRow` — major restructuring

**State additions:**

```typescript
const [structuredNotes, setStructuredNotes] = useState<string | null>(session.structured_notes)
const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(session.structured_notes)
const [extractionState, setExtractionState] = useState<ExtractionState>(
  session.structured_notes ? 'done' : 'idle'
)
const [showReextractConfirm, setShowReextractConfirm] = useState(false)
```

**Dirty tracking update:**

```typescript
const isDirty =
  client.id !== session.client_id ||
  client.name !== session.client_name ||
  sessionDate !== session.session_date ||
  rawNotes !== session.raw_notes ||
  structuredNotes !== session.structured_notes  // NEW
```

**Extraction functions** — same as capture form (`performExtraction`, `handleExtractSignals`, `handleConfirmReextract`).

**Save payload update:**

```typescript
body: JSON.stringify({
  clientId: client.id,
  clientName: client.name,
  sessionDate,
  rawNotes,
  structuredNotes,  // NEW
}),
```

**Layout restructuring** — replace the single notes textarea with a two-column grid:

```tsx
{/* Notes — side by side */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* Left: Raw Notes */}
  <div className="flex flex-col gap-1.5">
    <Label className="text-xs text-muted-foreground">Raw Notes</Label>
    <MarkdownPanel
      content={rawNotes}
      onChange={setRawNotes}
    />
  </div>

  {/* Right: Structured Notes */}
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
      {/* Extract / Re-extract button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!rawNotes.trim() || extractionState === 'extracting'}
        onClick={handleExtractSignals}
      >
        {extractionState === 'extracting' ? (
          <><Loader2 className="mr-1.5 size-3.5 animate-spin" />Extracting...</>
        ) : extractionState === 'done' ? (
          <><RefreshCw className="mr-1.5 size-3.5" />Re-extract</>
        ) : (
          <><Sparkles className="mr-1.5 size-3.5" />Extract Signals</>
        )}
      </Button>
    </div>

    {extractionState === 'done' && structuredNotes ? (
      <MarkdownPanel
        content={structuredNotes}
        onChange={setStructuredNotes}
      />
    ) : extractionState === 'extracting' ? (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-sm text-muted-foreground">
        No signals extracted yet.
      </div>
    )}
  </div>
</div>
```

**Re-extraction confirmation** — same modal pattern as capture form, rendered inside the expanded row.

### Files Changed

| File | Change |
|------|--------|
| `app/capture/_components/past-sessions-table.tsx` | Add `structured_notes` to `SessionRow` interface. Add extraction status indicator (Sparkles icon) on collapsed rows. Restructure `ExpandedSessionRow` with side-by-side grid layout, `MarkdownPanel` for both raw and structured notes, extraction state management, Extract/Re-extract button, empty state panel, re-extraction confirmation dialog. Update dirty tracking and save payload to include `structuredNotes`. |

### Implementation Increments

**Increment 4.1: SessionRow interface and extraction status indicator**

1. Add `structured_notes: string | null` to the `SessionRow` interface.
2. Add the `Sparkles` icon next to truncated notes on collapsed rows for sessions with structured notes.
3. Verify: sessions with `structured_notes` show the icon, sessions without don't.

**Increment 4.2: Expanded row side-by-side layout with MarkdownPanel**

1. Add `structuredNotes` state, `extractionState`, and dirty tracking to `ExpandedSessionRow`.
2. Replace the single notes textarea with a two-column grid: `MarkdownPanel` for raw notes (left) and structured notes panel (right).
3. Add the empty state ("No signals extracted yet") for sessions without structured notes.
4. Add the Extract Signals / Re-extract button above the structured notes panel.
5. Implement `performExtraction`, `handleExtractSignals`, `handleConfirmReextract` — same logic as capture form.
6. Add re-extraction confirmation dialog.
7. Verify: expand a row → see side-by-side panels → extract signals → edit → re-extract with confirmation.

**Increment 4.3: Save integration and documentation**

1. Update the save payload to include `structuredNotes`.
2. Update dirty tracking to include `structuredNotes` comparison.
3. Verify: save persists both raw and structured notes, cancel discards both, unsaved changes dialog triggers for structured notes edits.
4. Update `ARCHITECTURE.md` and `CHANGELOG.md`.

### Verification Checklist

- [ ] `SessionRow` interface includes `structured_notes: string | null`
- [ ] Collapsed rows show `Sparkles` icon for sessions with structured notes
- [ ] Collapsed rows without structured notes show no icon
- [ ] Expanded row shows two-column grid: raw notes (left) and structured notes (right)
- [ ] Both panels use `MarkdownPanel` with independent view/edit toggles
- [ ] Sessions without structured notes show "No signals extracted yet" in the right panel
- [ ] Extract Signals button appears above the structured notes panel
- [ ] Button shows Sparkles (idle), Loader2 (extracting), RefreshCw (done) — same as capture form
- [ ] Extraction calls the API and populates the structured notes panel
- [ ] Re-extraction with dirty structured notes shows confirmation dialog
- [ ] Loading state shows spinner in the structured notes panel during extraction
- [ ] Save payload includes `structuredNotes`
- [ ] Dirty tracking includes `structuredNotes` — unsaved changes prompt works for structured edits
- [ ] Cancel discards changes to both raw and structured notes
- [ ] Columns stack vertically on narrow viewports (`grid-cols-1 md:grid-cols-2`)
- [ ] Truncated notes preview in collapsed row still shows raw notes (not structured)
- [ ] `ARCHITECTURE.md` updated
- [ ] `CHANGELOG.md` has an entry for this change
