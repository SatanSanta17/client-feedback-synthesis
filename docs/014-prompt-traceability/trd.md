# TRD-014: Prompt Traceability & Extraction Staleness

> **Status:** Draft (Parts 1–3)
>
> Mirrors **PRD-014**. Each part maps to the corresponding PRD part.

---

## Part 1: Session Traceability & Staleness Data Model

> Implements **P1.R1–P1.R13** from PRD-014.

### Overview

Add three columns to the `sessions` table — `prompt_version_id`, `extraction_stale`, and `updated_by` — and thread them through every layer of the stack: database migration, repository interfaces, Supabase adapter, service functions, API route handlers, and the extract-signals API response. The goal is to record *which* prompt produced a session's structured notes, *whether* those notes are still in sync with reality, and *who* last modified the session.

This part is data-model-only — no UI changes. Parts 2–4 consume the data surfaced here.

### Forward Compatibility Notes

While this part only implements the data model, the interfaces and column set are designed to support Parts 2–4 without breaking changes:

- **Part 2 (View Prompt on Capture Page):** Needs the `prompt_version_id` returned from the extract-signals API (P1.R6) so the capture form can pass it along on session save. No additional columns required.
- **Part 3 (Show Prompt Version in Past Sessions):** Needs `prompt_version_id` in the sessions list response (P1.R13) to display the version badge. Will add a new API route (`GET /api/prompts/[id]`) to fetch a specific prompt version's content — not part of this TRD part but the repository interface is already sufficient (`getHistory` returns all versions including inactive ones).
- **Part 4 (Staleness Indicators & Re-extraction Warnings):** Needs `extraction_stale` in the sessions list response (P1.R13) for table-level indicators. Also introduces `structured_notes_edited` (P4.R5) — a *separate* column added in Part 4's migration, not this one. The `extraction_stale` flag set here is the foundation; Part 4 adds the secondary flag to distinguish *why* extraction is stale.

### Database Changes

#### Migration: `add_session_traceability_columns.sql`

```sql
-- 1. Add prompt_version_id (nullable FK to prompt_versions)
ALTER TABLE sessions
  ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL;

-- 2. Add extraction_stale (boolean, NOT NULL, default false)
ALTER TABLE sessions
  ADD COLUMN extraction_stale BOOLEAN NOT NULL DEFAULT false;

-- 3. Add updated_by (nullable FK to auth.users)
ALTER TABLE sessions
  ADD COLUMN updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Index on prompt_version_id for Part 4's prompt version filter (P4.R7)
-- Added now to avoid a second migration later. Only sessions with a non-null
-- prompt_version_id need indexing.
CREATE INDEX sessions_prompt_version_id_idx
  ON sessions (prompt_version_id)
  WHERE prompt_version_id IS NOT NULL AND deleted_at IS NULL;

-- 5. No backfill needed (P1.R11). Existing rows get:
--    prompt_version_id = NULL, extraction_stale = false, updated_by = NULL.
```

**Why `ON DELETE SET NULL` for `prompt_version_id`?** If a prompt version row is ever deleted (unlikely but possible via admin cleanup), the session retains its structured notes — it just loses the traceability link. This is safer than CASCADE (which would clear structured notes) or RESTRICT (which would block prompt cleanup).

**Why no RLS changes?** The three new columns are read/written through the same session rows that existing RLS policies already cover. No new tables or cross-table access patterns are introduced.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/014-prompt-traceability/add_session_traceability_columns.sql` | **Create** | Migration SQL |
| `lib/repositories/prompt-repository.ts` | **Modify** | Add `getActiveVersion()` method returning full `PromptVersionRow` (not just content) |
| `lib/repositories/supabase/supabase-prompt-repository.ts` | **Modify** | Implement `getActiveVersion()` |
| `lib/repositories/session-repository.ts` | **Modify** | Add new fields to `SessionRow`, `SessionInsert`, `SessionUpdate` |
| `lib/repositories/supabase/supabase-session-repository.ts` | **Modify** | Include new columns in all queries and mutations |
| `lib/services/ai-service.ts` | **Modify** | Return `prompt_version_id` alongside `structuredNotes` from `extractSignals()` |
| `lib/services/prompt-service.ts` | **Modify** | Add `getActivePromptVersion()` returning full row |
| `lib/services/session-service.ts` | **Modify** | Accept and propagate traceability fields in create/update; compute `extraction_stale` |
| `app/api/ai/extract-signals/route.ts` | **Modify** | Return `promptVersionId` in the response (P1.R6) |
| `app/api/sessions/route.ts` | **Modify** | Accept `promptVersionId` on POST; include new fields in GET response |
| `app/api/sessions/[id]/route.ts` | **Modify** | Accept `promptVersionId` on PUT; set `updated_by`; compute `extraction_stale` |

### Implementation

#### Increment 1.1: Database Migration + Repository Layer

**What:** Run the migration, then update repository interfaces and their Supabase adapters to read/write the three new columns.

**Files:**

1. **Create `docs/014-prompt-traceability/add_session_traceability_columns.sql`**

   Contains the migration SQL shown above. Run via Supabase dashboard or CLI.

2. **Modify `lib/repositories/session-repository.ts`**

   Add the three new fields to every interface that touches session data:

   ```typescript
   export interface SessionRow {
     id: string;
     client_id: string;
     session_date: string;
     raw_notes: string;
     structured_notes: string | null;
     created_by: string;
     created_at: string;
     client_name: string;
     // --- New fields (P1.R1, P1.R2, P1.R3) ---
     prompt_version_id: string | null;
     extraction_stale: boolean;
     updated_by: string | null;
   }

   export interface SessionInsert {
     client_id: string;
     session_date: string;
     raw_notes: string;
     structured_notes: string | null;
     // --- New field (P1.R7) ---
     prompt_version_id?: string | null;
   }

   export interface SessionUpdate {
     client_id: string;
     session_date: string;
     raw_notes: string;
     structured_notes?: string | null;
     // --- New fields (P1.R4, P1.R5, P1.R7, P1.R12) ---
     prompt_version_id?: string | null;
     extraction_stale?: boolean;
     updated_by?: string | null;
   }
   ```

   `SessionInsert` does not include `extraction_stale` or `updated_by` because on creation `extraction_stale` defaults to `false` (P1.R10) and `updated_by` is not set (P1.R12). `prompt_version_id` is optional — it's set when the user extracted signals before saving, and omitted when saving without extraction.

3. **Modify `lib/repositories/supabase/supabase-session-repository.ts`**

   **`list()`:** Add the three new columns to the select string:
   ```
   "id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, prompt_version_id, extraction_stale, updated_by, clients(name)"
   ```
   Map them into the returned `SessionRow` objects.

   **`create()`:** Include `prompt_version_id` in the insert payload when provided. Add the three new columns to the `.select()` string. Map them into the returned `SessionRow`.

   **`update()`:** Include `prompt_version_id`, `extraction_stale`, and `updated_by` in the update payload when provided (same `!== undefined` guard pattern used for `structured_notes`). Add them to the `.select()` string and return mapping.

   **`findById()`:** No changes needed — this only returns `id` and `created_by` for access checks.

   **`softDelete()`:** No changes needed — this only returns metadata for post-delete side effects.

4. **Modify `lib/repositories/prompt-repository.ts`**

   Add a new method to retrieve the full active prompt version row (not just content). This is needed so `extractSignals()` can return the `prompt_version_id` (P1.R6):

   ```typescript
   export interface PromptRepository {
     /** Existing methods remain unchanged */
     getActive(promptKey: PromptKey): Promise<string | null>;
     getHistory(promptKey: PromptKey): Promise<PromptVersionRow[]>;
     deactivateCurrent(promptKey: PromptKey): Promise<void>;
     create(input: { ... }): Promise<PromptVersionRow>;

     /** NEW: Fetch the full active prompt version row for a given key. */
     getActiveVersion(promptKey: PromptKey): Promise<PromptVersionRow | null>;
   }
   ```

5. **Modify `lib/repositories/supabase/supabase-prompt-repository.ts`**

   Implement `getActiveVersion()`:

   ```typescript
   async getActiveVersion(promptKey: PromptKey): Promise<PromptVersionRow | null> {
     console.log("[supabase-prompt-repo] getActiveVersion — key:", promptKey, "teamId:", teamId);

     let query = supabase
       .from("prompt_versions")
       .select("*")
       .eq("prompt_key", promptKey)
       .eq("is_active", true);

     query = scopeByTeam(query, teamId);

     const { data, error } = await query.maybeSingle();

     if (error) {
       console.error(
         `[supabase-prompt-repo] getActiveVersion error for ${promptKey}:`,
         error.message
       );
       return null;
     }

     return data ?? null;
   }
   ```

#### Increment 1.2: Service Layer Changes

**What:** Update the AI service to return `prompt_version_id` alongside structured notes, and update the session service to handle traceability fields on create/update.

**Files:**

1. **Modify `lib/services/prompt-service.ts`**

   Add a new function that wraps the new repository method:

   ```typescript
   /**
    * Fetches the full active prompt version row for a given key.
    * Returns null if none found (caller falls back to hardcoded default).
    */
   export async function getActivePromptVersion(
     repo: PromptRepository,
     promptKey: PromptKey
   ): Promise<PromptVersionRow | null> {
     console.log(`[prompt-service] getActivePromptVersion — key: ${promptKey}`);

     const version = await repo.getActiveVersion(promptKey);

     console.log(
       `[prompt-service] getActivePromptVersion — ${version ? `found: ${version.id}` : "not found"} for ${promptKey}`
     );
     return version;
   }
   ```

2. **Modify `lib/services/ai-service.ts`**

   Change `extractSignals()` to return an object instead of a plain string:

   ```typescript
   export interface ExtractionResult {
     structuredNotes: string;
     promptVersionId: string | null;
   }

   export async function extractSignals(
     promptRepo: PromptRepository,
     rawNotes: string
   ): Promise<ExtractionResult> {
     // Fetch the full version row (not just content) so we can return the ID
     const activeVersion = await getActivePromptVersion(promptRepo, "signal_extraction");
     const systemPrompt = activeVersion?.content ?? SIGNAL_EXTRACTION_SYSTEM_PROMPT;

     const userMessage = buildSignalExtractionUserMessage(rawNotes);

     const structuredNotes = await callModel({
       systemPrompt,
       userMessage,
       maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
       operationName: "extractSignals",
     });

     return {
       structuredNotes,
       promptVersionId: activeVersion?.id ?? null,
     };
   }
   ```

   **Breaking change management:** `extractSignals()` previously returned `Promise<string>`. The only caller is `app/api/ai/extract-signals/route.ts`. This is updated in Increment 1.3. No other callers exist.

3. **Modify `lib/services/session-service.ts`**

   **Update interfaces:**

   ```typescript
   export interface CreateSessionInput {
     clientId: string | null;
     clientName: string;
     sessionDate: string;
     rawNotes: string;
     structuredNotes?: string | null;
     promptVersionId?: string | null;  // NEW (P1.R7)
   }

   export interface UpdateSessionInput {
     clientId: string | null;
     clientName: string;
     sessionDate: string;
     rawNotes: string;
     structuredNotes?: string | null;
     promptVersionId?: string | null;  // NEW (P1.R7, P1.R9)
     isExtraction?: boolean;           // NEW — true when this save follows an extraction
   }

   export interface Session {
     id: string;
     client_id: string;
     session_date: string;
     raw_notes: string;
     structured_notes: string | null;
     created_by: string;
     created_at: string;
     // --- New fields ---
     prompt_version_id: string | null;
     extraction_stale: boolean;
     updated_by: string | null;
   }

   export interface SessionWithClient extends Session {
     client_name: string;
     created_by_email?: string;
     attachment_count: number;
   }
   ```

   **Update `createSession()`:**

   Pass `prompt_version_id` through to the repository. `extraction_stale` is not passed — it defaults to `false` at the database level (P1.R10). `updated_by` is not set on creation (P1.R12).

   ```typescript
   const row = await sessionRepo.create({
     client_id: resolvedClientId,
     session_date: sessionDate,
     raw_notes: rawNotes,
     structured_notes: structuredNotes ?? null,
     prompt_version_id: promptVersionId ?? null,  // NEW
   });
   ```

   **Update `updateSession()`:**

   Accept `userId` as a new parameter (for `updated_by`). Compute `extraction_stale` based on the `isExtraction` flag:

   ```typescript
   export async function updateSession(
     sessionRepo: SessionRepository,
     clientRepo: ClientRepository,
     id: string,
     input: UpdateSessionInput,
     userId: string  // NEW — for updated_by (P1.R12)
   ): Promise<Session> {
     const {
       clientId, clientName, sessionDate, rawNotes,
       structuredNotes, promptVersionId, isExtraction,
     } = input;

     // ...existing client resolution logic...

     // Compute staleness (P1.R4, P1.R5, P1.R8)
     let extractionStale: boolean | undefined;
     let resolvedPromptVersionId: string | null | undefined;

     if (isExtraction) {
       // P1.R5 / P1.R9: Fresh extraction resets staleness
       extractionStale = false;
       resolvedPromptVersionId = promptVersionId ?? null;
     } else if (structuredNotes === null) {
       // P1.R8: Clearing structured notes resets everything
       extractionStale = false;
       resolvedPromptVersionId = null;
     } else if (structuredNotes !== undefined) {
       // P1.R4: Structured notes changed outside extraction = stale
       extractionStale = true;
     }
     // If structuredNotes is undefined (not provided), we don't touch
     // extraction_stale here — but raw_notes or attachment changes
     // should still mark it stale. This is handled below.

     // P1.R4: Raw notes changes mark as stale (unless this is an extraction save)
     // The API route is responsible for detecting raw_notes changes and
     // setting extractionStale=true when rawNotes differs from the stored value.
     // However, since the API route always sends the full payload, we handle
     // the simpler approach: the API route sets isExtraction=false for normal
     // saves, and we mark stale if structured_notes exist on the session.
     // See Increment 1.3 for the full staleness detection logic.

     try {
       const row = await sessionRepo.update(id, {
         client_id: resolvedClientId,
         session_date: sessionDate,
         raw_notes: rawNotes,
         structured_notes: structuredNotes,
         prompt_version_id: resolvedPromptVersionId,
         extraction_stale: extractionStale,
         updated_by: userId,  // P1.R12
       });

       console.log("[session-service] updateSession success:", row.id);
       return mapRowToSession(row);
     } catch (err) {
       // ...existing error handling...
     }
   }
   ```

   **Update `mapRowToSession()`:**

   ```typescript
   function mapRowToSession(row: SessionRow): Session {
     return {
       id: row.id,
       client_id: row.client_id,
       session_date: row.session_date,
       raw_notes: row.raw_notes,
       structured_notes: row.structured_notes,
       created_by: row.created_by,
       created_at: row.created_at,
       prompt_version_id: row.prompt_version_id,
       extraction_stale: row.extraction_stale,
       updated_by: row.updated_by,
     };
   }
   ```

   **Update `getSessions()`:**

   The new fields flow through automatically since `SessionRow` and `SessionWithClient` now include them. The mapping in `getSessions()` must include the three new fields:

   ```typescript
   const sessions: SessionWithClient[] = rows.map((row) => ({
     // ...existing fields...
     prompt_version_id: row.prompt_version_id,
     extraction_stale: row.extraction_stale,
     updated_by: row.updated_by,
   }));
   ```

#### Increment 1.3: API Route Changes

**What:** Update the extract-signals API to return `promptVersionId`, and update session API routes to accept/return the new fields.

**Files:**

1. **Modify `app/api/ai/extract-signals/route.ts`**

   Update the response to include `promptVersionId` (P1.R6):

   ```typescript
   try {
     const result = await extractSignals(promptRepo, parsed.data.rawNotes);

     console.log(
       "[api/ai/extract-signals] POST — extraction complete,",
       result.structuredNotes.length,
       "chars, promptVersionId:",
       result.promptVersionId
     );
     return NextResponse.json({
       structuredNotes: result.structuredNotes,
       promptVersionId: result.promptVersionId,  // NEW (P1.R6)
     });
   } catch (err) {
     // ...existing error handling...
   }
   ```

2. **Modify `app/api/sessions/route.ts`**

   **POST handler:** Add `promptVersionId` to the Zod schema and pass it through:

   ```typescript
   const createSessionSchema = z.object({
     // ...existing fields...
     promptVersionId: z.string().uuid().nullable().optional().default(null),  // NEW
   });
   ```

   Pass to `createSession()`:
   ```typescript
   const session = await createSession(sessionRepo, clientRepo, {
     clientId: parsed.data.clientId,
     clientName: parsed.data.clientName,
     sessionDate: parsed.data.sessionDate,
     rawNotes: parsed.data.rawNotes,
     structuredNotes: parsed.data.structuredNotes,
     promptVersionId: parsed.data.promptVersionId,  // NEW
   });
   ```

   **GET handler:** No code changes needed — the `getSessions()` service already returns the new fields via `SessionWithClient`, which are serialised to JSON automatically (P1.R13).

3. **Modify `app/api/sessions/[id]/route.ts`**

   **PUT handler:** Add `promptVersionId` and `isExtraction` to the Zod schema:

   ```typescript
   const updateSessionSchema = z.object({
     // ...existing fields...
     promptVersionId: z.string().uuid().nullable().optional(),  // NEW
     isExtraction: z.boolean().optional().default(false),       // NEW
   });
   ```

   Pass `userId` and new fields to `updateSession()`:

   ```typescript
   const session = await updateSession(sessionRepo, clientRepo, id, {
     clientId: parsed.data.clientId,
     clientName: parsed.data.clientName,
     sessionDate: parsed.data.sessionDate,
     rawNotes: parsed.data.rawNotes,
     structuredNotes: parsed.data.structuredNotes,
     promptVersionId: parsed.data.promptVersionId,    // NEW
     isExtraction: parsed.data.isExtraction,           // NEW
   }, user.id);  // NEW — userId for updated_by
   ```

   **Staleness on raw notes / attachment changes (P1.R4):**

   When `isExtraction` is `false` and the session has existing structured notes, any update to raw notes should mark `extraction_stale = true`. Since the PUT route always receives the full payload (not a diff), we need to detect whether inputs have actually changed. There are two approaches:

   **Chosen approach:** The client-side code (expanded row, capture form) already knows whether raw notes changed or attachments were added/removed. Rather than fetching the current session to diff, the API accepts an explicit signal. We add an `inputChanged` field to the PUT schema:

   ```typescript
   const updateSessionSchema = z.object({
     // ...existing fields...
     promptVersionId: z.string().uuid().nullable().optional(),
     isExtraction: z.boolean().optional().default(false),
     inputChanged: z.boolean().optional().default(false),  // NEW — client signals raw notes or attachments changed
   });
   ```

   The service layer then uses this:
   - `isExtraction === true` → `extraction_stale = false` (P1.R5)
   - `structuredNotes === null` → `extraction_stale = false`, `prompt_version_id = null` (P1.R8)
   - `inputChanged === true` and session has structured notes → `extraction_stale = true` (P1.R4)
   - Manual edit to structured notes (not extraction) → `extraction_stale = true` (P1.R4)

   Update `UpdateSessionInput` in the service to include `inputChanged`:

   ```typescript
   export interface UpdateSessionInput {
     clientId: string | null;
     clientName: string;
     sessionDate: string;
     rawNotes: string;
     structuredNotes?: string | null;
     promptVersionId?: string | null;
     isExtraction?: boolean;
     inputChanged?: boolean;  // NEW — raw notes or attachments changed
   }
   ```

   Refined staleness logic in `updateSession()`:

   ```typescript
   let extractionStale: boolean | undefined;
   let resolvedPromptVersionId: string | null | undefined;

   if (isExtraction) {
     // P1.R5, P1.R9: Fresh extraction resets staleness
     extractionStale = false;
     resolvedPromptVersionId = promptVersionId ?? null;
   } else if (structuredNotes === null) {
     // P1.R8: Clearing structured notes resets everything
     extractionStale = false;
     resolvedPromptVersionId = null;
   } else if (inputChanged) {
     // P1.R4: Raw notes or attachments changed — stale if structured notes exist
     // We set true here; if the session has no structured_notes the flag is
     // harmless (no output to be stale against). Part 4 will check both.
     extractionStale = true;
   } else if (structuredNotes !== undefined) {
     // P1.R4: Structured notes manually edited (changed but not via extraction)
     extractionStale = true;
   }
   ```

   **Attachment add/remove (P1.R4):**

   Attachment add (`POST /api/sessions/[id]/attachments`) and remove (`DELETE /api/sessions/[id]/attachments/[attachmentId]`) routes also need to mark `extraction_stale = true` when the session has structured notes. Add a minimal update call after the attachment operation:

   ```typescript
   // After successful attachment add or remove:
   // Mark session as stale if it has structured notes
   await sessionRepo.update(id, {
     // Pass only staleness fields — other fields are unchanged
     extraction_stale: true,
     updated_by: userId,
   });
   ```

   However, the current `SessionUpdate` interface requires `client_id`, `session_date`, and `raw_notes`. To avoid fetching the full session just to echo back unchanged fields, add a new lightweight method to `SessionRepository`:

   ```typescript
   /** Patch staleness-related fields without requiring the full session payload. */
   markStale(sessionId: string, updatedBy: string): Promise<void>;
   ```

   **Supabase implementation:**

   ```typescript
   async markStale(sessionId: string, updatedBy: string): Promise<void> {
     console.log("[supabase-session-repo] markStale — id:", sessionId);

     const { error } = await supabase
       .from("sessions")
       .update({ extraction_stale: true, updated_by: updatedBy })
       .eq("id", sessionId)
       .is("deleted_at", null);

     if (error) {
       console.error("[supabase-session-repo] markStale error:", error);
       throw new Error("Failed to mark session as stale");
     }

     console.log("[supabase-session-repo] markStale success:", sessionId);
   }
   ```

   Modify `app/api/sessions/[id]/attachments/route.ts` (POST) and `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` (DELETE) to call `sessionRepo.markStale(sessionId, userId)` after the attachment operation succeeds.

### Staleness State Machine Summary

This table documents the complete set of transitions for `extraction_stale` and `prompt_version_id`, covering all requirements:

| Trigger | `extraction_stale` | `prompt_version_id` | PRD Ref |
|---------|--------------------|---------------------|---------|
| **Session created** (POST) | `false` (DB default) | Set if extraction ran before save, else `null` | P1.R7, P1.R10 |
| **Extraction save** (PUT with `isExtraction=true`) | → `false` | → active prompt version ID | P1.R5, P1.R9 |
| **Raw notes changed** (PUT with `inputChanged=true`) | → `true` | Unchanged | P1.R4 |
| **Attachment added** (POST attachment) | → `true` | Unchanged | P1.R4 |
| **Attachment removed** (DELETE attachment) | → `true` | Unchanged | P1.R4 |
| **Structured notes manually edited** (PUT, not extraction) | → `true` | Unchanged | P1.R4 |
| **Structured notes cleared** (PUT with `structuredNotes=null`) | → `false` | → `null` | P1.R8 |
| **Any PUT** | — | — | `updated_by` → `userId` (P1.R12) |

### Acceptance Criteria Traceability

| Criterion | Implementation |
|-----------|---------------|
| `sessions` table has `prompt_version_id`, `extraction_stale`, `updated_by` with correct types/defaults/constraints | Migration SQL in Increment 1.1 |
| Saving with extraction records correct `prompt_version_id`, sets `extraction_stale=false` | `updateSession()` with `isExtraction=true` path (Increment 1.2) |
| Editing raw notes / adding/removing attachments / manually editing structured notes sets `extraction_stale=true` | `updateSession()` with `inputChanged` / structured notes edit paths + `markStale()` in attachment routes (Increments 1.2, 1.3) |
| Re-extracting resets `extraction_stale=false` and updates `prompt_version_id` | Same as extraction save path (Increment 1.2) |
| Clearing structured notes clears `prompt_version_id` and resets `extraction_stale=false` | `structuredNotes === null` path in `updateSession()` (Increment 1.2) |
| `updated_by` set on every PUT | Passed as `userId` parameter to `updateSession()` (Increment 1.2) |
| Existing sessions have NULL/false/NULL and function normally | Migration adds columns with defaults, no backfill (Increment 1.1) |
| Sessions list API includes all three new fields | `SessionRow` and `SessionWithClient` updated (Increment 1.1, auto-serialised in GET handler) |

#### Increment 1.4: End-of-Part Audit

**What:** Run the full end-of-part audit checklist — type check, PRD compliance verification, code quality conventions, documentation updates.

**Checks performed:**

1. **Type check** — `npx tsc --noEmit` passes cleanly
2. **PRD compliance** — All P1.R1–P1.R13 traced to implementation with no gaps
3. **SRP** — Each layer (repo → service → route) maintains single responsibility; staleness logic centralised in session-service
4. **DRY** — No duplication; `markStale()` avoids repeating full update payload in attachment routes
5. **Dead code** — Removed unused `SessionAccessRow` import from `session-service.ts`
6. **Naming / conventions** — All files, interfaces, and functions follow project conventions
7. **Logging** — All modified functions log entry, exit, and errors

**Documentation updated:**

- `ARCHITECTURE.md` — Added 3 new columns + index to sessions table schema; updated current state to include PRD-014 Part 1; updated ai-service description with `ExtractionResult` return type
- `CHANGELOG.md` — Added Part 1 entry with all changes delivered

---

## Part 2: View Prompt on Capture Page

> Implements **P2.R1–P2.R5** from PRD-014.

### Overview

Add a "View Prompt" button next to the "Extract Signals" button on the capture form. Clicking it opens a read-only dialog showing the currently active `signal_extraction` prompt rendered as markdown (consistent with how structured notes are rendered via `MarkdownPanel`). The dialog includes a link to navigate to Settings for editing. The prompt is fetched on-demand when the dialog opens.

No new API endpoints are needed — the existing `GET /api/prompts?key=signal_extraction` already returns `{ active, history }` where `active` contains the full `PromptVersionRow` with `content`. The dialog only needs `active.content`.

### Forward Compatibility Notes

- **Part 3 (Past Sessions Prompt Version):** Will reuse the same `ViewPromptDialog` component created here but with a different title ("Extraction Prompt Used" vs "Active Extraction Prompt") and without the "Edit in Settings" link. The dialog is designed for reuse by accepting `title`, `content`, and an optional footer action via props.
- **Part 4 (Staleness Indicators):** No dependency on Part 2's components.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/capture/_components/view-prompt-dialog.tsx` | **Create** | Reusable read-only prompt viewing dialog |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | Add "View Prompt" button, state management, and dialog integration |

### Implementation

#### Increment 2.1: ViewPromptDialog Component + Capture Form Integration

**What:** Create the `ViewPromptDialog` component and wire it into the capture form.

**Files:**

1. **Create `app/capture/_components/view-prompt-dialog.tsx`**

   A read-only dialog that displays prompt content rendered as markdown. Designed for reuse in Part 3 (past sessions) with different titles and optional footer actions.

   ```typescript
   "use client"

   import { useState, useEffect } from "react"
   import { Eye, ExternalLink, Loader2, AlertCircle } from "lucide-react"
   import ReactMarkdown from "react-markdown"
   import remarkGfm from "remark-gfm"
   import Link from "next/link"

   import { Button } from "@/components/ui/button"
   import {
     Dialog,
     DialogContent,
     DialogDescription,
     DialogFooter,
     DialogHeader,
     DialogTitle,
   } from "@/components/ui/dialog"

   interface ViewPromptDialogProps {
     /** Controls dialog visibility. */
     open: boolean
     onOpenChange: (open: boolean) => void
     /** Dialog title. Default: "Active Extraction Prompt". */
     title?: string
     /** Optional subtitle / description. */
     description?: string
     /**
      * If provided, the dialog renders this content directly (no fetch).
      * Used by Part 3 to pass a specific prompt version's content.
      */
     content?: string | null
     /** If true, shows the "Edit in Settings" link in the footer (P2.R3). */
     showEditLink?: boolean
     className?: string
   }

   type FetchState = "idle" | "loading" | "success" | "error"

   export function ViewPromptDialog({
     open,
     onOpenChange,
     title = "Active Extraction Prompt",
     description,
     content: externalContent,
     showEditLink = false,
     className,
   }: ViewPromptDialogProps) {
     const [fetchState, setFetchState] = useState<FetchState>("idle")
     const [promptContent, setPromptContent] = useState<string | null>(null)

     // Fetch prompt when dialog opens and no external content is provided (P2.R4)
     useEffect(() => {
       if (!open) {
         // Reset on close
         setFetchState("idle")
         setPromptContent(null)
         return
       }

       if (externalContent !== undefined) {
         // External content provided — skip fetch
         setPromptContent(externalContent)
         setFetchState(externalContent ? "success" : "error")
         return
       }

       // Fetch the active prompt
       let cancelled = false
       setFetchState("loading")

       fetch("/api/prompts?key=signal_extraction")
         .then((res) => {
           if (!res.ok) throw new Error("Failed to fetch prompt")
           return res.json()
         })
         .then((data) => {
           if (cancelled) return
           const content = data.active?.content ?? null
           setPromptContent(content)
           setFetchState(content ? "success" : "error")
         })
         .catch(() => {
           if (cancelled) return
           setFetchState("error")
         })

       return () => { cancelled = true }
     }, [open, externalContent])

     return (
       <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
           <DialogHeader>
             <DialogTitle className="flex items-center gap-2">
               <Eye className="size-4 text-muted-foreground" />
               {title}
             </DialogTitle>
             {description && (
               <DialogDescription>{description}</DialogDescription>
             )}
           </DialogHeader>

           <div className="flex-1 min-h-0 overflow-y-auto">
             {fetchState === "loading" && (
               <div className="flex items-center justify-center py-12">
                 <Loader2 className="size-5 animate-spin text-muted-foreground" />
                 <span className="ml-2 text-sm text-muted-foreground">
                   Loading prompt...
                 </span>
               </div>
             )}

             {fetchState === "error" && (
               <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                 <AlertCircle className="size-4 shrink-0" />
                 <span>
                   Could not load the extraction prompt. Please try again or
                   check Settings.
                 </span>
               </div>
             )}

             {fetchState === "success" && promptContent && (
               <div className="rounded-lg border border-border bg-card p-4">
                 <div className="prose prose-sm max-w-none overflow-y-auto prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
                   <ReactMarkdown remarkPlugins={[remarkGfm]}>
                     {promptContent}
                   </ReactMarkdown>
                 </div>
               </div>
             )}
           </div>

           <DialogFooter className="flex items-center justify-between sm:justify-between">
             {showEditLink ? (
               <Link
                 href="/settings"
                 className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
               >
                 <ExternalLink className="size-3.5" />
                 Edit in Settings
               </Link>
             ) : (
               <div /> // Spacer to keep Close button right-aligned
             )}
             <Button variant="outline" onClick={() => onOpenChange(false)}>
               Close
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
     )
   }
   ```

   **Design decisions:**

   - **Reusable for Part 3:** Accepts optional `content` prop. When provided, skips the fetch and renders directly. Part 3 will pass the specific prompt version's content fetched on-demand from a new endpoint.
   - **Markdown rendering:** Uses `ReactMarkdown` + `remarkGfm` with the same prose classes as `MarkdownPanel` (P2.R5). This ensures the prompt looks the same as structured notes when viewed.
   - **Fetch on open (P2.R4):** The `useEffect` triggers only when `open` changes to `true`. Cleans up on close. Handles race conditions via `cancelled` flag.
   - **Error state:** Shows a user-friendly message if the fetch fails, not raw API errors.
   - **No editing:** The dialog is strictly read-only. The "Edit in Settings" link is the only path to change the prompt (P2.R3).

2. **Modify `app/capture/_components/session-capture-form.tsx`**

   Add a "View Prompt" button and the dialog state:

   **Import the new component:**
   ```typescript
   import { Eye } from "lucide-react"
   import { ViewPromptDialog } from "./view-prompt-dialog"
   ```

   **Add state inside `SessionCaptureForm`:**
   ```typescript
   const [showPromptDialog, setShowPromptDialog] = useState(false)
   ```

   **Add the button in the action buttons area (P2.R1):**

   Insert the "View Prompt" button after the "Extract Signals" button but before the "Save Session" button. It uses `variant="ghost"` and `size="lg"` to be visually subordinate:

   ```tsx
   {/* View Prompt button — secondary/ghost, visually subordinate (P2.R1) */}
   <Button
     type="button"
     variant="ghost"
     size="lg"
     onClick={() => setShowPromptDialog(true)}
     className="text-muted-foreground"
   >
     <Eye className="mr-2 size-4" />
     View Prompt
   </Button>
   ```

   **Add the dialog at the end of the component return, alongside the existing `ReextractConfirmDialog`:**

   ```tsx
   <ViewPromptDialog
     open={showPromptDialog}
     onOpenChange={setShowPromptDialog}
     showEditLink
   />
   ```

   The full action buttons section becomes:

   ```tsx
   <div className="flex items-center gap-3">
     {/* Extract Signals button */}
     <Button
       type="button"
       variant="ai"
       size="lg"
       disabled={!hasInput || isOverLimit || extractionState === "extracting"}
       onClick={handleExtractSignals}
     >
       {/* ...existing extract button content... */}
     </Button>

     {/* View Prompt button (P2.R1) */}
     <Button
       type="button"
       variant="ghost"
       size="lg"
       onClick={() => setShowPromptDialog(true)}
       className="text-muted-foreground"
     >
       <Eye className="mr-2 size-4" />
       View Prompt
     </Button>

     {/* Submit button */}
     <Button
       type="submit"
       disabled={!isValid || !hasInput || isOverLimit || isSubmitting}
       size="lg"
     >
       {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
       {isSubmitting ? "Saving..." : "Save Session"}
     </Button>
   </div>
   ```

### Acceptance Criteria Traceability

| Criterion | Implementation |
|-----------|---------------|
| A "View Prompt" button appears next to the "Extract Signals" button | Ghost button with `Eye` icon in capture form action bar (Increment 2.1) |
| Clicking it opens a read-only dialog with the active extraction prompt | `ViewPromptDialog` fetches via `GET /api/prompts?key=signal_extraction` on open (Increment 2.1) |
| The dialog includes an "Edit in Settings" link to `/settings` | `showEditLink` prop renders a `next/link` to `/settings` in the dialog footer (Increment 2.1) |
| The prompt is rendered as markdown, consistent with Settings prompt editor view mode | `ReactMarkdown` + `remarkGfm` with same `prose` classes as `MarkdownPanel` (Increment 2.1) |
| If the prompt fetch fails, a clear error message is shown instead | Error state renders user-friendly message with `AlertCircle` icon (Increment 2.1) |

#### Increment 2.2: End-of-Part Audit

**What:** Run the full end-of-part audit checklist — type check, PRD compliance verification (P2.R1–P2.R5), code quality conventions (SRP, DRY, dead code, naming, logging, design token adherence), documentation updates.

**Checks to perform:**

1. **Type check** — `npx tsc --noEmit` passes cleanly
2. **PRD compliance** — All P2.R1–P2.R5 traced to implementation with no gaps
3. **SRP** — `ViewPromptDialog` handles only display; fetch logic is self-contained; capture form only adds state + button
4. **DRY** — Markdown rendering prose classes consistent with `MarkdownPanel`; no duplicated fetch logic
5. **Dead code** — No unused imports or variables in new/modified files
6. **Design tokens** — All colours, spacing, and typography use Tailwind tokens or CSS custom properties
7. **Naming / conventions** — File naming (kebab-case), component naming (PascalCase), prop interfaces follow project conventions

**Documentation to update:**

- `ARCHITECTURE.md` — Add `view-prompt-dialog.tsx` to file map under `capture/_components/`
- `CHANGELOG.md` — Add Part 2 entry with changes delivered

---

## Part 3: Show Prompt Version in Past Sessions

> Implements **P3.R1–P3.R6** from PRD-014.

### Overview

Add a prompt version indicator to the expanded session row in the past sessions table. When a session has a non-null `prompt_version_id`, a small clickable badge (e.g., "Prompt v3") appears near the structured notes section. Clicking it opens the `ViewPromptDialog` (created in Part 2) with the exact prompt text used for that extraction, fetched on demand from a new API endpoint.

This part requires:

1. A new API endpoint (`GET /api/prompts/[id]`) to fetch a single prompt version by UUID, including its computed version number.
2. A new repository method (`findById`) on `PromptRepository` to fetch a prompt version by ID.
3. A new service function (`getPromptVersionById`) wrapping the repo method.
4. Threading `prompt_version_id` through the frontend component tree — from the sessions list response to `SessionRow` to `ExpandedSessionRow`.
5. A small `PromptVersionBadge` component that renders the clickable indicator, fetches prompt content on click, and opens the reused `ViewPromptDialog`.

### Forward Compatibility Notes

- **Part 4 (Staleness Indicators):** The prompt version badge and staleness indicator coexist in the expanded row — both near the structured notes header. Part 4 adds the staleness badge; this part adds the version badge. They are independent and can appear simultaneously per P4.R2.

### Database Changes

None. All data was added in Part 1.

### New API Endpoint

#### `GET /api/prompts/[id]`

Fetches a single prompt version by UUID. Returns the full `PromptVersionRow` plus a computed `versionNumber` (1-based, ordered by `created_at` ascending within the same `prompt_key` and scope).

**Why compute `versionNumber` server-side?** The version number is derived from the prompt's position in the history for its `prompt_key`. Computing this client-side would require fetching the full history every time — wasteful. The server can resolve it in a single query (count of versions with `created_at <= this version's created_at` for the same key and scope).

**Request:** `GET /api/prompts/{uuid}`

**Response (200):**
```json
{
  "version": { "id": "...", "prompt_key": "signal_extraction", "content": "...", "author_email": "...", "is_active": false, "created_at": "..." },
  "versionNumber": 3
}
```

**Error responses:**
- 400 — Invalid UUID format
- 401 — Unauthenticated
- 404 — Prompt version not found

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/repositories/prompt-repository.ts` | **Modify** | Add `findById(id)` method to interface |
| `lib/repositories/supabase/supabase-prompt-repository.ts` | **Modify** | Implement `findById()` — select by ID, no team scoping (prompt versions are accessible across scopes for traceability) |
| `lib/services/prompt-service.ts` | **Modify** | Add `getPromptVersionById()` wrapping repo method |
| `app/api/prompts/[id]/route.ts` | **Create** | GET handler — auth, validate UUID, fetch version, compute version number, return response |
| `app/capture/_components/expanded-session-row.tsx` | **Modify** | Add `prompt_version_id` to `SessionRow` interface; pass it to new `PromptVersionBadge` |
| `app/capture/_components/prompt-version-badge.tsx` | **Create** | Clickable badge — fetches prompt version on click, opens `ViewPromptDialog` with content |
| `app/capture/_components/past-sessions-table.tsx` | **Modify** | No code changes needed — `SessionRow` type is imported from `expanded-session-row.tsx` and the API already returns `prompt_version_id` (Part 1) |

### Implementation

#### Increment 3.1: Repository + Service + API Route

**What:** Add `findById()` to the prompt repository, wrap it in a service function, and create the `GET /api/prompts/[id]` route handler.

**Files:**

1. **Modify `lib/repositories/prompt-repository.ts`**

   Add a new method to the `PromptRepository` interface:

   ```typescript
   /** Fetch a single prompt version by ID. Returns null if not found. */
   findById(id: string): Promise<PromptVersionRow | null>;
   ```

2. **Modify `lib/repositories/supabase/supabase-prompt-repository.ts`**

   Implement `findById()`:

   ```typescript
   async findById(id: string): Promise<PromptVersionRow | null> {
     console.log("[supabase-prompt-repo] findById — id:", id);

     const { data, error } = await supabase
       .from("prompt_versions")
       .select("*")
       .eq("id", id)
       .maybeSingle();

     if (error) {
       console.error("[supabase-prompt-repo] findById error:", error.message);
       return null;
     }

     return data ?? null;
   }
   ```

   **Why no `scopeByTeam`?** Prompt versions are accessed for traceability across scopes. A session in one team workspace might reference a prompt version created in another context. The `findById` query should not restrict by team — the prompt version ID itself is the access key (only sessions the user has access to will have the ID in the first place).

3. **Modify `lib/services/prompt-service.ts`**

   Add a service function:

   ```typescript
   /**
    * Fetches a single prompt version by ID.
    * Returns null if not found.
    */
   export async function getPromptVersionById(
     repo: PromptRepository,
     id: string
   ): Promise<PromptVersionRow | null> {
     console.log(`[prompt-service] getPromptVersionById — id: ${id}`);

     const version = await repo.findById(id);

     console.log(
       `[prompt-service] getPromptVersionById — ${version ? "found" : "not found"} for ${id}`
     );
     return version;
   }
   ```

4. **Create `app/api/prompts/[id]/route.ts`**

   New GET handler:

   ```typescript
   import { NextRequest, NextResponse } from "next/server";
   import { z } from "zod";
   import { createClient, getActiveTeamId } from "@/lib/supabase/server";
   import { getPromptVersionById, getPromptHistory } from "@/lib/services/prompt-service";
   import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";

   const idSchema = z.string().uuid("Invalid prompt version ID");

   export async function GET(
     _request: NextRequest,
     { params }: { params: Promise<{ id: string }> }
   ) {
     const { id } = await params;

     console.log("[api/prompts/[id]] GET — id:", id);

     // Validate UUID format
     const parsed = idSchema.safeParse(id);
     if (!parsed.success) {
       return NextResponse.json(
         { message: "Invalid prompt version ID" },
         { status: 400 }
       );
     }

     // Auth check
     const supabase = await createClient();
     const {
       data: { user },
     } = await supabase.auth.getUser();

     if (!user) {
       return NextResponse.json(
         { message: "Authentication required" },
         { status: 401 }
       );
     }

     const teamId = await getActiveTeamId();
     const promptRepo = createPromptRepository(supabase, teamId);

     try {
       const version = await getPromptVersionById(promptRepo, id);

       if (!version) {
         return NextResponse.json(
           { message: "Prompt version not found" },
           { status: 404 }
         );
       }

       // Compute version number: count of versions with created_at <= this
       // version's created_at for the same prompt_key and scope.
       const history = await getPromptHistory(promptRepo, version.prompt_key);
       const sorted = [...history].sort(
         (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
       );
       const versionNumber = sorted.findIndex((v) => v.id === version.id) + 1;

       console.log(
         `[api/prompts/[id]] GET — found version ${version.id}, number ${versionNumber}`
       );

       return NextResponse.json({ version, versionNumber });
     } catch (err) {
       console.error(
         "[api/prompts/[id]] GET — error:",
         err instanceof Error ? err.message : err
       );
       return NextResponse.json(
         { message: "Failed to fetch prompt version" },
         { status: 500 }
       );
     }
   }
   ```

   **Version number computation:** Fetches the full history for the prompt key, sorts ascending by `created_at`, and finds the index. This is simple and correct — prompt histories are small (typically <20 versions). An alternative would be a COUNT query, but that would require a new repo method for marginal gain.

#### Increment 3.2: Frontend — PromptVersionBadge + ExpandedSessionRow Integration

**What:** Create the `PromptVersionBadge` component, add `prompt_version_id` to the frontend `SessionRow` interface, and wire the badge into the expanded session row.

**Files:**

1. **Modify `app/capture/_components/expanded-session-row.tsx`**

   Add `prompt_version_id` to the `SessionRow` interface:

   ```typescript
   export interface SessionRow {
     id: string
     client_id: string
     client_name: string
     session_date: string
     raw_notes: string
     structured_notes: string | null
     created_by: string
     created_at: string
     created_by_email?: string
     attachment_count: number
     prompt_version_id: string | null   // ← new
   }
   ```

   In the JSX, add the `PromptVersionBadge` next to the "Extracted Signals" label:

   ```tsx
   import { PromptVersionBadge } from "./prompt-version-badge"

   // ... inside the Extracted Signals section header:
   <div className="flex items-center justify-between">
     <div className="flex items-center gap-2">
       <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
       {session.prompt_version_id && (
         <PromptVersionBadge promptVersionId={session.prompt_version_id} />
       )}
     </div>
     {canEdit && (
       <Button ...>
         {/* existing extract button */}
       </Button>
     )}
   </div>
   ```

   The badge only renders when `prompt_version_id` is non-null (P3.R4).

2. **Create `app/capture/_components/prompt-version-badge.tsx`**

   A small clickable badge that fetches the prompt version on click and opens the `ViewPromptDialog`:

   ```typescript
   "use client"

   import { useState, useCallback } from "react"
   import { Loader2 } from "lucide-react"
   import { toast } from "sonner"

   import { Badge } from "@/components/ui/badge"
   import { ViewPromptDialog } from "./view-prompt-dialog"

   interface PromptVersionBadgeProps {
     promptVersionId: string
     className?: string
   }

   type FetchState = "idle" | "loading" | "success" | "error"

   export function PromptVersionBadge({
     promptVersionId,
   }: PromptVersionBadgeProps) {
     const [showDialog, setShowDialog] = useState(false)
     const [fetchState, setFetchState] = useState<FetchState>("idle")
     const [promptContent, setPromptContent] = useState<string | null>(null)
     const [dialogTitle, setDialogTitle] = useState("Extraction Prompt Used")

     const handleClick = useCallback(async () => {
       if (fetchState === "loading") return

       setFetchState("loading")

       try {
         const res = await fetch(`/api/prompts/${promptVersionId}`)
         if (!res.ok) throw new Error("Failed to fetch prompt version")

         const data = await res.json()
         setPromptContent(data.version.content)
         setDialogTitle(
           data.versionNumber
             ? `Extraction Prompt — Version ${data.versionNumber}`
             : "Extraction Prompt Used"
         )
         setFetchState("success")
         setShowDialog(true)
       } catch {
         setFetchState("error")
         toast.error("Could not load prompt version")
       }
     }, [promptVersionId, fetchState])

     return (
       <>
         <Badge
           variant="outline"
           className="cursor-pointer text-[10px] px-1.5 py-0 text-muted-foreground hover:text-foreground transition-colors"
           onClick={handleClick}
         >
           {fetchState === "loading" ? (
             <Loader2 className="size-3 animate-spin" />
           ) : (
             "View prompt used"
           )}
         </Badge>

         <ViewPromptDialog
           open={showDialog}
           onOpenChange={setShowDialog}
           title={dialogTitle}
           content={promptContent}
         />
       </>
     )
   }
   ```

   **Design decisions:**

   - **Fetch on click, not on open (P3.R6).** The badge fetches the prompt version when clicked, before opening the dialog. Once fetched, the content is passed directly via the `content` prop — the dialog doesn't re-fetch. The fetch result is cached in component state so re-opening doesn't re-fetch.
   - **Title includes version number (P3.R5).** The dialog title shows "Extraction Prompt — Version 3" to distinguish from the "Active Extraction Prompt" title used in Part 2.
   - **No "Edit in Settings" link.** `showEditLink` defaults to `false` — historical prompt versions are read-only with no path to edit.
   - **Badge text is "View prompt used"** rather than "Prompt v3" — the version number requires the API call to compute, so we don't show it in the badge itself. The version number appears in the dialog title after the fetch completes.

### Acceptance Criteria Traceability

| Criterion | Implementation |
|-----------|---------------|
| Sessions with a linked prompt version show a version indicator in the expanded row | `PromptVersionBadge` rendered conditionally when `session.prompt_version_id` is non-null (Increment 3.2) |
| Clicking the indicator opens a read-only dialog with the exact prompt text used for that extraction | Badge `handleClick` fetches from `GET /api/prompts/[id]`, passes content to `ViewPromptDialog` (Increment 3.2) |
| Sessions without a linked prompt version show no indicator | Conditional render: `{session.prompt_version_id && <PromptVersionBadge ... />}` (Increment 3.2) |
| The dialog clearly labels this as a historical prompt version, not the current active prompt | Dialog title: "Extraction Prompt — Version {n}" (P3.R5, Increment 3.2) |
| Prompt content is fetched on demand, not included in the session list response | New `GET /api/prompts/[id]` endpoint, called only on badge click (P3.R6, Increments 3.1 + 3.2) |

#### Increment 3.3: End-of-Part Audit

**What:** Run the full end-of-part audit checklist — type check, PRD compliance verification (P3.R1–P3.R6), code quality conventions (SRP, DRY, dead code, naming, logging, design token adherence), documentation updates.

**Checks to perform:**

1. **Type check** — `npx tsc --noEmit` passes cleanly
2. **PRD compliance** — All P3.R1–P3.R6 traced to implementation with no gaps
3. **SRP** — `PromptVersionBadge` handles fetch + dialog state; `ViewPromptDialog` handles display only; API route validates + fetches + computes version number
4. **DRY** — `ViewPromptDialog` reused from Part 2 with no duplication; version number computation in one place (API route)
5. **Dead code** — No unused imports or variables in new/modified files
6. **Design tokens** — Badge uses semantic Tailwind classes, no hardcoded colours
7. **Naming / conventions** — All files, interfaces, and functions follow project conventions
8. **Logging** — New repo method, service function, and API route log entry, exit, and errors

**Documentation to update:**

- `ARCHITECTURE.md` — Add `prompt-version-badge.tsx` to file map under `capture/_components/`; add `prompts/[id]/route.ts` to file map under `api/`; update current state
- `CHANGELOG.md` — Add Part 3 entry with changes delivered
