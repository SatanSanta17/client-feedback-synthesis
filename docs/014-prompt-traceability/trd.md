# TRD-014: Prompt Traceability & Extraction Staleness

> **PRD:** `docs/014-prompt-traceability/prd.md`
> **Status:** Draft

---

## Part 1: Session Traceability & Staleness Data Model

### Technical Decisions

- **Three new columns on `sessions`, not a separate table.** `prompt_version_id`, `extraction_stale`, `updated_by`, and later `structured_notes_edited` (Part 4) are all per-session attributes. A separate tracking table would add join complexity for no benefit. These columns are lightweight (UUID, boolean, UUID) and don't change the query patterns for the sessions list.
- **`prompt_version_id` is a nullable FK.** Pre-migration sessions have `NULL` — this is accurate, not a gap. We don't backfill because we can't know which prompt produced those extractions. The FK references `prompt_versions.id` with no cascade delete — if a prompt version row were removed, the session should retain the reference (and the UI can show "Prompt version unavailable"). In practice, prompt versions are never deleted.
- **`extraction_stale` is a denormalised flag, not a computed value.** Computing staleness at query time (comparing raw notes hashes, checking prompt version currency, checking attachment changes) would be expensive on every GET. A simple boolean that flips at write time is cheap to query and simple to index if needed later.
- **`extraction_stale` is set by the API layer, not by a database trigger.** The flag depends on application-level context (did the change come from an extraction flow or a manual edit?). A database trigger on the `sessions` table can't distinguish between a PUT that saves extraction results and a PUT that saves manual edits — both update `structured_notes`. The API routes have this context and set the flag explicitly.
- **`updated_by` is set on the API route, not in the service layer.** The service layer (`session-service.ts`) is framework-agnostic and doesn't have direct access to the authenticated user. The API route handler reads `user.id` from the auth context and passes it to the service. This follows the existing pattern where `created_by` is set by Supabase's `auth.uid()` default, but `updated_by` needs explicit setting since Supabase doesn't have a built-in "current user" for updates.
- **The extract-signals API returns `promptVersionId` in the response.** The client holds this value in state and passes it when saving the session. This avoids the race condition where the active prompt changes between extraction and save — the session records the prompt that was actually used, not the one that's active at save time.
- **Attachment add/delete routes set `extraction_stale` on the parent session.** When an attachment is uploaded (`POST /api/sessions/[id]/attachments`) or deleted (`DELETE /api/sessions/[id]/attachments/[attachmentId]`), the route also updates the session's `extraction_stale = true` if the session has existing structured notes. This requires a small additional Supabase query in those routes. The `sessionId` is already available in both routes from the URL params (`params.id`).
- **`structured_notes_edited` references in Part 1 code are guarded.** The `updateSession()` function in Part 1 includes references to `structured_notes_edited` (a Part 4 column). During Parts 1–3 implementation, these lines are omitted. Part 4's increment adds them when the column exists. The TRD code shows the final state after all parts are complete. Implementation notes in each code block mark which lines are Part 4–only.
- **`extractSignals()` return type is a breaking change.** The function currently returns `Promise<string>`. It changes to `Promise<ExtractSignalsResult>`. The only caller is `app/api/ai/extract-signals/route.ts`, which is updated in the same increment. No other code calls this function directly.
- **Base `Session` interface is updated.** The `Session` interface in `session-service.ts` gains `prompt_version_id`, `extraction_stale`, and `updated_by` fields to match the new database columns. The `SessionWithClient` interface gains `updated_by_email` for display.

### Database Schema

#### Migration: Add traceability columns to `sessions`

```sql
-- Add prompt version tracking
ALTER TABLE sessions
  ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id);

-- Add staleness tracking
ALTER TABLE sessions
  ADD COLUMN extraction_stale BOOLEAN NOT NULL DEFAULT false;

-- Add edit attribution
ALTER TABLE sessions
  ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Index for prompt version filter (Part 4)
CREATE INDEX sessions_prompt_version_id_idx
  ON sessions (prompt_version_id)
  WHERE deleted_at IS NULL;
```

No backfill needed. All existing sessions get `prompt_version_id = NULL`, `extraction_stale = false`, `updated_by = NULL` via column defaults.

### API Changes

#### `POST /api/ai/extract-signals` — Return prompt version ID

**File:** `app/api/ai/extract-signals/route.ts`

The route calls `extractSignals()` which internally fetches the active prompt. The service function is updated to also return the prompt version ID alongside the structured notes.

**Changes to `lib/services/ai-service.ts`:**

Update `extractSignals()` to return an object instead of a plain string:

```typescript
export interface ExtractSignalsResult {
  structuredNotes: string;
  promptVersionId: string | null;
}

export async function extractSignals(rawNotes: string): Promise<ExtractSignalsResult> {
  const activePromptResult = await getActivePromptWithId("signal_extraction");
  const systemPrompt = activePromptResult?.content ?? SIGNAL_EXTRACTION_SYSTEM_PROMPT;
  const promptVersionId = activePromptResult?.id ?? null;

  const userMessage = buildSignalExtractionUserMessage(rawNotes);

  const structuredNotes = await callModel({
    systemPrompt,
    userMessage,
    maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
    operationName: "extractSignals",
  });

  return { structuredNotes, promptVersionId };
}
```

**Changes to `lib/services/prompt-service.ts`:**

Add a new function that returns both content and ID:

```typescript
export async function getActivePromptWithId(
  promptKey: PromptKey
): Promise<{ id: string; content: string } | null> {
  const teamId = await getActiveTeamId();
  const supabase = await createClient();

  let query = supabase
    .from("prompt_versions")
    .select("id, content")
    .eq("prompt_key", promptKey)
    .eq("is_active", true);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(
      `[prompt-service] Failed to fetch active prompt with ID for ${promptKey}:`,
      error.message
    );
    return null;
  }

  return data ?? null;
}
```

**Changes to `app/api/ai/extract-signals/route.ts`:**

Update the response to include `promptVersionId`:

```typescript
const { structuredNotes, promptVersionId } = await extractSignals(parsed.data.rawNotes);

return NextResponse.json({ structuredNotes, promptVersionId });
```

#### `POST /api/sessions` — Accept `promptVersionId`

**File:** `app/api/sessions/route.ts`

Add `promptVersionId` to the Zod schema:

```typescript
const createSessionSchema = z.object({
  // ...existing fields...
  promptVersionId: z.string().uuid().nullable().optional().default(null),
});
```

Pass it through to the service:

```typescript
const session = await createSession({
  clientId: parsed.data.clientId,
  clientName: parsed.data.clientName,
  sessionDate: parsed.data.sessionDate,
  rawNotes: parsed.data.rawNotes,
  structuredNotes: parsed.data.structuredNotes,
  promptVersionId: parsed.data.promptVersionId,
});
```

**Changes to `lib/services/session-service.ts`:**

Update the base `Session` interface to include new columns:

```typescript
export interface Session {
  id: string;
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
  created_by: string;
  created_at: string;
  prompt_version_id: string | null;
  extraction_stale: boolean;
  updated_by: string | null;
}
```

Update `CreateSessionInput` and `createSession()`:

```typescript
export interface CreateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;
  promptVersionId?: string | null;
}
```

The insert payload includes `prompt_version_id`:

```typescript
const { data, error } = await supabase
  .from("sessions")
  .insert({
    client_id: resolvedClientId,
    session_date: sessionDate,
    raw_notes: rawNotes,
    structured_notes: structuredNotes ?? null,
    prompt_version_id: promptVersionId ?? null,
    // extraction_stale defaults to false (correct for fresh creation)
    team_id: teamId,
  })
  .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, prompt_version_id, extraction_stale")
  .single();
```

#### `PUT /api/sessions/[id]` — Handle staleness and attribution

**File:** `app/api/sessions/[id]/route.ts`

Add new fields to the Zod schema:

```typescript
const updateSessionSchema = z.object({
  // ...existing fields...
  promptVersionId: z.string().uuid().nullable().optional(),
  isExtraction: z.boolean().optional().default(false),
});
```

The `isExtraction` flag tells the API whether this save is the result of an extraction (in which case `extraction_stale` resets to `false` and `prompt_version_id` updates) or a manual edit (in which case `extraction_stale` may flip to `true`).

Pass `userId` from the access check to the service for `updated_by`:

```typescript
const session = await updateSession(id, {
  clientId: parsed.data.clientId,
  clientName: parsed.data.clientName,
  sessionDate: parsed.data.sessionDate,
  rawNotes: parsed.data.rawNotes,
  structuredNotes: parsed.data.structuredNotes,
  promptVersionId: parsed.data.promptVersionId,
  isExtraction: parsed.data.isExtraction,
  updatedBy: access.userId,
});
```

**Changes to `lib/services/session-service.ts`:**

Update `UpdateSessionInput` and `updateSession()`:

```typescript
export interface UpdateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;
  promptVersionId?: string | null;
  isExtraction?: boolean;
  updatedBy: string;
}
```

The update function builds the payload with staleness logic:

```typescript
export async function updateSession(
  id: string,
  input: UpdateSessionInput
): Promise<Session> {
  const { clientId, clientName, sessionDate, rawNotes, structuredNotes, promptVersionId, isExtraction, updatedBy } = input;

  // Fetch the current session to compare for staleness
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("sessions")
    .select("raw_notes, structured_notes, prompt_version_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    client_id: resolvedClientId,
    session_date: sessionDate,
    raw_notes: rawNotes,
    updated_by: updatedBy,
  };

  if (structuredNotes !== undefined) {
    updatePayload.structured_notes = structuredNotes;
  }

  if (isExtraction) {
    // Extraction flow: reset staleness, update prompt version
    updatePayload.extraction_stale = false;
    updatePayload.structured_notes_edited = false; // Part 4 — omit until Part 4 migration runs
    if (promptVersionId !== undefined) {
      updatePayload.prompt_version_id = promptVersionId;
    }
  } else if (current) {
    // Manual edit flow: check what changed
    const rawNotesChanged = rawNotes !== current.raw_notes;
    const structuredNotesChanged =
      structuredNotes !== undefined &&
      structuredNotes !== current.structured_notes;
    const hasExistingStructuredNotes = !!current.structured_notes;

    if (hasExistingStructuredNotes && (rawNotesChanged || structuredNotesChanged)) {
      updatePayload.extraction_stale = true;
    }

    // If structured notes were manually edited (not via extraction)
    // Part 4 — omit until Part 4 migration runs:
    if (structuredNotesChanged && hasExistingStructuredNotes) {
      updatePayload.structured_notes_edited = true;
    }

    // If structured notes are cleared, reset everything
    if (structuredNotes === null) {
      updatePayload.prompt_version_id = null;
      updatePayload.extraction_stale = false;
      updatePayload.structured_notes_edited = false; // Part 4 — omit until Part 4 migration runs
    }
  }

  // ...rest of update logic unchanged...
}
```

#### Attachment routes — Set `extraction_stale` on parent session

**File:** `app/api/sessions/[id]/attachments/route.ts` (POST)

After successfully creating the attachment, update the parent session's staleness:

```typescript
// After uploadAndCreateAttachment succeeds:
await markSessionExtractionStale(sessionId);
```

**File:** `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` (DELETE)

After successfully deleting the attachment, update the parent session's staleness:

```typescript
// After deleteAttachment succeeds:
await markSessionExtractionStale(sessionId);
```

**New helper in `lib/services/session-service.ts`:**

```typescript
/**
 * Marks a session's extraction as stale if it has structured notes.
 * Called when attachments are added or removed.
 */
export async function markSessionExtractionStale(sessionId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("sessions")
    .update({ extraction_stale: true })
    .eq("id", sessionId)
    .is("deleted_at", null)
    .neq("structured_notes", "")
    .not("structured_notes", "is", null);

  if (error) {
    console.error(
      "[session-service] markSessionExtractionStale error:",
      error.message
    );
    // Non-fatal — log but don't throw. The session save succeeded.
  }
}
```

#### `GET /api/sessions` — Include new fields

**File:** `lib/services/session-service.ts`

Update the `getSessions()` select clause and `SessionWithClient` interface:

```typescript
export interface SessionWithClient extends Session {
  client_name: string;
  created_by_email?: string;
  updated_by_email?: string;
  attachment_count: number;
  prompt_version_id: string | null;
  extraction_stale: boolean;
}
```

Update the select in `getSessions()`:

```typescript
.select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, prompt_version_id, extraction_stale, updated_by, clients(name)", { count: "exact" })
```

Resolve `updated_by` emails in the same profiles batch query already used for `created_by_email`:

```typescript
// In team context, collect both created_by and updated_by user IDs
const uniqueUserIds = [...new Set(
  rows.flatMap((r) => [r.created_by, r.updated_by].filter(Boolean))
)];
```

### Frontend Changes

#### `SessionCaptureForm` — Track and pass `promptVersionId`

**File:** `app/capture/_components/session-capture-form.tsx`

Add state for the prompt version ID returned by extraction:

```typescript
const [promptVersionId, setPromptVersionId] = useState<string | null>(null);
```

Update `performExtraction()` to capture it:

```typescript
const { structuredNotes: extracted, promptVersionId: pvId } = await response.json();
setStructuredNotes(extracted);
setLastExtractedNotes(extracted);
setPromptVersionId(pvId ?? null);
```

Pass it in `onSubmit()`:

```typescript
body: JSON.stringify({
  clientId: client.id,
  clientName: client.name,
  sessionDate: data.sessionDate,
  rawNotes: data.rawNotes,
  structuredNotes: structuredNotes,
  promptVersionId: promptVersionId,
  hasAttachments: attachments.length > 0,
}),
```

Reset on form clear:

```typescript
setPromptVersionId(null);
```

#### `ExpandedSessionRow` — Track and pass `promptVersionId` and `isExtraction`

**File:** `app/capture/_components/expanded-session-row.tsx`

Update the `SessionRow` interface to include the new fields:

```typescript
export interface SessionRow {
  id: string;
  client_id: string;
  client_name: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
  created_by: string;
  created_at: string;
  created_by_email?: string;
  updated_by_email?: string;
  attachment_count: number;
  prompt_version_id: string | null;
  extraction_stale: boolean;
}
```

Add state for prompt version ID. On extraction, capture it from the response. On save, pass `isExtraction: true` if saving after a fresh extraction, `isExtraction: false` for manual edits. Include `promptVersionId` in the PUT body.

### Files Changed

| File | Change |
|------|--------|
| `lib/services/prompt-service.ts` | Add `getActivePromptWithId()` function |
| `lib/services/ai-service.ts` | Update `extractSignals()` to return `ExtractSignalsResult` with `promptVersionId` |
| `lib/services/session-service.ts` | Update interfaces, `createSession()`, `updateSession()`, `getSessions()`, add `markSessionExtractionStale()` |
| `app/api/ai/extract-signals/route.ts` | Return `promptVersionId` in response |
| `app/api/sessions/route.ts` | Accept `promptVersionId` in POST schema |
| `app/api/sessions/[id]/route.ts` | Accept `promptVersionId`, `isExtraction` in PUT schema; pass `updatedBy` |
| `app/api/sessions/[id]/attachments/route.ts` | Call `markSessionExtractionStale()` after POST |
| `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` | Call `markSessionExtractionStale()` after DELETE |
| `app/capture/_components/session-capture-form.tsx` | Track `promptVersionId` state, pass in POST body |
| `app/capture/_components/expanded-session-row.tsx` | Update `SessionRow` interface, track `promptVersionId`, pass `isExtraction` in PUT body |
| `app/capture/_components/past-sessions-table.tsx` | Pass new fields through to `ExpandedSessionRow` |

### Implementation Increments

**Increment 1: Migration + prompt service update.**
Add the three new columns to `sessions`. Add `getActivePromptWithId()` to `prompt-service.ts`. Update `extractSignals()` in `ai-service.ts` to return `ExtractSignalsResult`.

**Increment 2: API route changes.**
Update extract-signals route to return `promptVersionId`. Update session POST/PUT schemas and service functions. Add `markSessionExtractionStale()` and wire it into attachment routes. Update `getSessions()` to return new fields.

**Increment 3: Frontend state threading.**
Update `SessionRow` interface, `SessionCaptureForm`, and `ExpandedSessionRow` to track and pass `promptVersionId` and `isExtraction`. Wire `updated_by_email` through the table.

---

## Part 2: View Prompt on Capture Page

### Technical Decisions

- **New co-located component: `prompt-view-dialog.tsx`.** A reusable dialog component that fetches and displays a prompt. Lives in `app/capture/_components/` since it's used by both the capture form (Part 2) and the expanded row (Part 3). It accepts either "fetch the current active prompt" or "fetch a specific prompt version by ID" as its mode.
- **Fetch on dialog open, not on page mount.** Most users won't click "View Prompt" most of the time. Fetching on mount wastes a network call. The dialog shows a loading spinner while fetching and handles errors inline.
- **Reuse the existing `GET /api/prompts?key=signal_extraction` endpoint.** This endpoint already returns the active prompt with its content. The dialog calls it when opened in "active prompt" mode. No new API endpoint needed for Part 2.
- **For Part 3 (specific version by ID), add a new endpoint.** `GET /api/prompts/[id]` returns a single prompt version by its UUID. This is needed because the existing endpoint returns history by `prompt_key`, not by individual version ID.
- **"Edit in Settings" link uses `next/link`.** Navigating to `/settings` triggers the unsaved changes check on the capture form if there's dirty state. This is existing behaviour from the capture page's `beforeunload` handling.

### New Component: `PromptViewDialog`

**File:** `app/capture/_components/prompt-view-dialog.tsx`

```typescript
interface PromptViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode:
    | { type: "active" }                    // Fetch current active prompt
    | { type: "version"; versionId: string }; // Fetch specific version by ID
}
```

**Behaviour:**

1. On `open = true`, fetches the prompt content:
   - `mode.type === "active"`: calls `GET /api/prompts?key=signal_extraction`, reads `active.content`.
   - `mode.type === "version"`: calls `GET /api/prompts/{versionId}` (new endpoint, Part 3).
2. Shows a loading spinner while fetching.
3. On success, renders the prompt text in a scrollable `<pre>` block with monospace font (`font-mono whitespace-pre-wrap`).
4. On error, shows "Could not load prompt. Please try again."
5. Dialog title:
   - Active mode: "Signal Extraction Prompt"
   - Version mode: "Prompt Version {N}" — the version number is extracted from the `GET /api/prompts/[id]` response (`version_number` field). While loading, title shows "Extraction Prompt Used."
6. Footer: "Edit in Settings" link (active mode only, not shown for historical versions).

**UI structure:**

Uses the existing shadcn `Dialog` component (`components/ui/dialog.tsx`):

```
┌──────────────────────────────────────────────┐
│ [Title]                               [X]    │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ (monospace, scrollable, max-h-[60vh])    │ │
│ │                                          │ │
│ │ You are an expert signal extraction...   │ │
│ │ ...                                      │ │
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ [Edit in Settings →]              [Close]    │
└──────────────────────────────────────────────┘
```

### Capture Form Changes

**File:** `app/capture/_components/session-capture-form.tsx`

Add a "View Prompt" button next to the "Extract Signals" button in the action buttons row:

```typescript
import { Eye } from "lucide-react";
import { PromptViewDialog } from "./prompt-view-dialog";

// State
const [showPromptDialog, setShowPromptDialog] = useState(false);

// In the buttons row, before the Extract Signals button:
<Button
  type="button"
  variant="ghost"
  size="lg"
  onClick={() => setShowPromptDialog(true)}
>
  <Eye className="mr-2 size-4" />
  View Prompt
</Button>

// Dialog
<PromptViewDialog
  open={showPromptDialog}
  onOpenChange={setShowPromptDialog}
  mode={{ type: "active" }}
/>
```

The button is always enabled (not dependent on form state) — users may want to see the prompt before they start typing.

### Files Changed

| File | Change |
|------|--------|
| `app/capture/_components/prompt-view-dialog.tsx` | **New file** — reusable prompt view dialog |
| `app/capture/_components/session-capture-form.tsx` | Add "View Prompt" button and dialog state |

### Implementation Increments

**Single increment.** Create `prompt-view-dialog.tsx` with the "active" mode only (the "version" mode is wired in Part 3). Add the button and dialog to `session-capture-form.tsx`.

---

## Part 3: Show Prompt Version in Past Sessions

### Technical Decisions

- **New API endpoint for fetching a single prompt version.** `GET /api/prompts/[id]` returns one prompt version by UUID. This is needed because the expanded row knows the `prompt_version_id` but not the `prompt_key`, and the existing endpoint requires `prompt_key`. The new endpoint is a simple lookup by primary key.
- **Version number is computed server-side.** The "Prompt v3" label requires knowing the position of this version in the sequence of all versions for the same `prompt_key` and workspace scope. Computing this client-side would require fetching the full version history. Instead, the new endpoint returns a `version_number` computed by counting all versions with the same `prompt_key` in the same workspace scope where `created_at <= this version's created_at`. This gives a 1-based sequential number (the first version ever created is v1, the second is v2, etc.).
- **Prompt version badge placement.** The badge appears next to the "Extracted Signals" label in the expanded row, inline with the existing header. It only renders when `prompt_version_id` is non-null.
- **Reuse `PromptViewDialog` in "version" mode.** The same dialog component from Part 2 handles both active-prompt and historical-prompt viewing. The expanded row passes `mode: { type: "version", versionId, versionLabel: "Prompt v3" }`.

### New API Endpoint

**File:** `app/api/prompts/[id]/route.ts`

```typescript
// GET /api/prompts/[id]
// Returns a single prompt version by UUID with computed version number.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  }

  // Fetch the prompt version
  const { data: version, error } = await supabase
    .from("prompt_versions")
    .select("id, prompt_key, content, author_email, created_at, is_active, team_id")
    .eq("id", id)
    .single();

  if (error || !version) {
    return NextResponse.json({ message: "Prompt version not found" }, { status: 404 });
  }

  // Compute version number: count of versions with the same prompt_key
  // in the same workspace scope that were created at or before this one
  const teamId = version.team_id;

  let countQuery = supabase
    .from("prompt_versions")
    .select("id", { count: "exact", head: true })
    .eq("prompt_key", version.prompt_key)
    .lte("created_at", version.created_at);

  if (teamId) {
    countQuery = countQuery.eq("team_id", teamId);
  } else {
    countQuery = countQuery.is("team_id", null);
  }

  const { count } = await countQuery;

  return NextResponse.json({
    version: {
      id: version.id,
      prompt_key: version.prompt_key,
      content: version.content,
      author_email: version.author_email,
      created_at: version.created_at,
      is_active: version.is_active,
      version_number: count ?? 1,
    },
  });
}
```

### Expanded Row Changes

**File:** `app/capture/_components/expanded-session-row.tsx`

Add prompt version badge and dialog near the "Extracted Signals" label:

```typescript
import { PromptViewDialog } from "./prompt-view-dialog";

// State
const [showPromptVersionDialog, setShowPromptVersionDialog] = useState(false);

// In the Extracted Signals header row:
<div className="flex items-center justify-between">
  <div className="flex items-center gap-2">
    <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
    {session.prompt_version_id && (
      <button
        type="button"
        className="text-xs text-primary/70 hover:text-primary underline-offset-2 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setShowPromptVersionDialog(true);
        }}
      >
        View extraction prompt
      </button>
    )}
  </div>
  {/* existing Extract Signals / Re-extract button */}
</div>

// Dialog — version number is fetched by the dialog from GET /api/prompts/[id]
{session.prompt_version_id && (
  <PromptViewDialog
    open={showPromptVersionDialog}
    onOpenChange={setShowPromptVersionDialog}
    mode={{ type: "version", versionId: session.prompt_version_id }}
  />
)}
```

The link text says "View extraction prompt" rather than "Prompt v3" to avoid needing the version number at render time (the version number is fetched when the dialog opens from the `GET /api/prompts/[id]` endpoint). The dialog title dynamically shows "Prompt Version {N}" once the endpoint response arrives, using the `version_number` field. No `versionLabel` prop is needed — the dialog fetches and displays the version number itself.

### Files Changed

| File | Change |
|------|--------|
| `app/api/prompts/[id]/route.ts` | **New file** — GET single prompt version by UUID with version number |
| `app/capture/_components/prompt-view-dialog.tsx` | Wire "version" mode to call `GET /api/prompts/[id]` |
| `app/capture/_components/expanded-session-row.tsx` | Add prompt version link and dialog |

### Implementation Increments

**Increment 1: New API endpoint.** Create `app/api/prompts/[id]/route.ts`.

**Increment 2: Wire dialog and expanded row.** Add "version" fetch mode to `PromptViewDialog`. Add the "View extraction prompt" link and dialog to `ExpandedSessionRow`.

---

## Part 4: Staleness Indicators & Re-extraction Warnings

### Technical Decisions

- **`structured_notes_edited` is a separate column from `extraction_stale`.** `extraction_stale` tells the user "something is out of sync." `structured_notes_edited` tells the system "the user manually edited the AI output." The first drives the UI indicator, the second drives the re-extraction confirmation dialog. Collapsing them would lose the ability to distinguish "stale because raw notes changed" from "stale because you edited the output" — which matters for the confirmation UX and future bulk re-extraction (PRD-015).
- **The `structured_notes_edited` column is added in Part 4's migration, not Part 1.** Part 1 builds the core traceability infrastructure. Part 4 adds the UX layer. The column is referenced forward-compatibly in Part 1's service code (the `updateSession` function sets it when present), but the column must exist by the time Part 4 ships. If implementing Parts 1–3 first, the `structured_notes_edited` references in the update payload should be behind a safe check or added in Part 4's increment.
- **Staleness indicator uses a warning triangle icon.** `AlertTriangle` from lucide-react, displayed in amber/warning colour. Visually distinct from the primary-coloured sparkles icon (which means "has structured notes") and the prompt version link.
- **Table-level staleness hint in collapsed rows.** A small warning icon next to the existing sparkles icon in the Notes column. Uses `AlertTriangle` at `size-3` in `text-warning` (amber). Lightweight — no tooltip, no hover state.
- **Re-extraction confirmation enhancement.** The existing re-extract confirmation dialog already checks `isStructuredDirty` (whether the user edited structured notes in the current session). Part 4 enhances this to also check `structured_notes_edited` from the server — covering the case where a user edited structured notes in a previous session, closed the row, and is now re-opening and re-extracting.
- **Prompt version filter as a Select dropdown.** Uses the existing shadcn `Select` component. The filter options are derived from the sessions already fetched (no additional API call) plus a dedicated endpoint for distinct prompt versions if needed for accuracy. For simplicity, the filter adds a `promptVersionId` query param to the sessions API, and the server-side query filters by it.

### Database Schema

#### Migration: Add `structured_notes_edited` column

```sql
ALTER TABLE sessions
  ADD COLUMN structured_notes_edited BOOLEAN NOT NULL DEFAULT false;
```

### API Changes

#### `GET /api/sessions` — Support prompt version filter

**File:** `app/api/sessions/route.ts`

Add `promptVersionId` to the Zod query params schema:

```typescript
const getSessionsParamsSchema = z.object({
  // ...existing params...
  promptVersionId: z.string().uuid().optional(),
  promptVersionNull: z.coerce.boolean().optional(), // For "No prompt version" filter
});
```

**File:** `lib/services/session-service.ts`

Update `SessionFilters` and `getSessions()`:

```typescript
export interface SessionFilters {
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  promptVersionId?: string;
  promptVersionNull?: boolean;
  offset: number;
  limit: number;
}
```

In the query builder:

```typescript
if (filters.promptVersionId) {
  query = query.eq("prompt_version_id", filters.promptVersionId);
} else if (filters.promptVersionNull) {
  query = query.is("prompt_version_id", null);
}
```

Also update `getSessions()` to include `structured_notes_edited` in the select clause and response:

```typescript
.select("..., structured_notes_edited, ...", { count: "exact" })
```

#### New endpoint: `GET /api/prompts/versions/distinct`

Returns the distinct prompt versions used across the user's sessions, for populating the filter dropdown.

**File:** `app/api/prompts/versions/distinct/route.ts`

```typescript
// Returns distinct prompt_version_ids used in the user's sessions,
// with version number and created_at for display labels.

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  }

  const teamId = await getActiveTeamId();

  // Get distinct prompt_version_ids from sessions
  let sessionsQuery = supabase
    .from("sessions")
    .select("prompt_version_id")
    .is("deleted_at", null)
    .not("prompt_version_id", "is", null);

  if (teamId) {
    sessionsQuery = sessionsQuery.eq("team_id", teamId);
  } else {
    sessionsQuery = sessionsQuery.is("team_id", null);
  }

  const { data: sessionRows } = await sessionsQuery;

  const uniqueIds = [...new Set((sessionRows ?? []).map((r) => r.prompt_version_id))];

  if (uniqueIds.length === 0) {
    return NextResponse.json({ versions: [] });
  }

  // Fetch prompt version metadata
  const { data: versions } = await supabase
    .from("prompt_versions")
    .select("id, created_at, prompt_key")
    .in("id", uniqueIds)
    .eq("prompt_key", "signal_extraction")
    .order("created_at", { ascending: true });

  // Compute version numbers
  const versionsWithNumbers = (versions ?? []).map((v, idx) => ({
    id: v.id,
    label: `Prompt v${idx + 1}`,
    created_at: v.created_at,
  }));

  // Check if any sessions have NULL prompt_version_id
  let nullCheckQuery = supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("prompt_version_id", null);

  if (teamId) {
    nullCheckQuery = nullCheckQuery.eq("team_id", teamId);
  } else {
    nullCheckQuery = nullCheckQuery.is("team_id", null);
  }

  const { count: nullCount } = await nullCheckQuery;
  const hasNullVersions = (nullCount ?? 0) > 0;

  return NextResponse.json({
    versions: versionsWithNumbers,
    hasNullVersions,
  });
}
```

### Frontend Changes

#### Staleness indicator in expanded row

**File:** `app/capture/_components/expanded-session-row.tsx`

Near the "Extracted Signals" section, when `extraction_stale = true` and structured notes exist:

```typescript
import { AlertTriangle } from "lucide-react";

// In the Extracted Signals header area:
{session.extraction_stale && structuredNotes && (
  <span className="flex items-center gap-1 text-xs text-warning">
    <AlertTriangle className="size-3.5" />
    Extraction may be outdated
  </span>
)}
```

#### Staleness hint in collapsed table rows

**File:** `app/capture/_components/past-sessions-table.tsx`

In the `SessionTableRow` Notes column, next to the existing sparkles icon:

```typescript
import { AlertTriangle } from "lucide-react";

// In the notes cell, after the sparkles icon:
{session.structured_notes && session.extraction_stale && (
  <AlertTriangle className="size-3 shrink-0 text-warning" />
)}
```

#### Enhanced re-extraction confirmation

**File:** `app/capture/_components/expanded-session-row.tsx`

Update the re-extract confirmation logic to check `structured_notes_edited` from the server:

```typescript
// The session prop now includes structured_notes_edited
const handleExtractSignals = useCallback(async () => {
  // Check both local dirty state AND server-side edited flag
  if (
    extractionState === "done" &&
    (isStructuredDirty || session.structured_notes_edited)
  ) {
    setShowReextractConfirm(true);
    return;
  }
  await performExtraction();
}, [extractionState, isStructuredDirty, session.structured_notes_edited, performExtraction]);
```

Update the dialog message when `structured_notes_edited` is true:

```typescript
<p className="mt-2 text-sm text-muted-foreground">
  {session.structured_notes_edited
    ? "You've manually edited the structured notes since the last extraction. Re-extracting will replace your edits. Continue?"
    : "Re-extracting will replace the current signals. Continue?"}
</p>
```

#### Prompt version filter

**File:** `app/capture/_components/session-filters.tsx`

Add a prompt version filter dropdown:

```typescript
export interface SessionFiltersState {
  clientId?: string;
  clientName?: string;
  dateFrom: string;
  dateTo: string;
  promptVersionId?: string;
  promptVersionNull?: boolean;
}
```

New filter control using shadcn `Select`:

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// State: fetch distinct versions on mount
const [promptVersions, setPromptVersions] = useState<{ id: string; label: string }[]>([]);
const [hasNullVersions, setHasNullVersions] = useState(false);

useEffect(() => {
  fetch("/api/prompts/versions/distinct")
    .then((res) => res.ok ? res.json() : { versions: [], hasNullVersions: false })
    .then((data) => {
      setPromptVersions(data.versions ?? []);
      setHasNullVersions(data.hasNullVersions ?? false);
    })
    .catch(() => {});
}, []);

// In the filter bar (only show if there are multiple versions):
{promptVersions.length > 0 && (
  <div className="flex flex-col gap-1">
    <Label className="text-xs text-muted-foreground">Prompt Version</Label>
    <div className="flex items-center gap-1">
      <Select
        value={filters.promptVersionNull ? "__null__" : (filters.promptVersionId ?? "")}
        onValueChange={(val) => {
          if (val === "__null__") {
            onFiltersChange({ ...filters, promptVersionId: undefined, promptVersionNull: true });
          } else if (val === "") {
            onFiltersChange({ ...filters, promptVersionId: undefined, promptVersionNull: undefined });
          } else {
            onFiltersChange({ ...filters, promptVersionId: val, promptVersionNull: undefined });
          }
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All versions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All versions</SelectItem>
          {promptVersions.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
          ))}
          {hasNullVersions && (
            <SelectItem value="__null__">No prompt version</SelectItem>
          )}
        </SelectContent>
      </Select>
      {(filters.promptVersionId || filters.promptVersionNull) && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onFiltersChange({ ...filters, promptVersionId: undefined, promptVersionNull: undefined })}
          aria-label="Clear prompt version filter"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  </div>
)}
```

#### "Last edited by" in expanded row

**File:** `app/capture/_components/expanded-session-row.tsx`

In the read-only metadata section (non-edit mode) and alongside "Captured by" in edit mode:

```typescript
// In the metadata area, after "Captured by":
{session.updated_by_email && (
  <div>
    <span className="text-xs text-muted-foreground">Last edited by</span>
    <p className="font-medium">{session.updated_by_email}</p>
  </div>
)}
```

Only render in team context (check `isTeamContext` or simply rely on `updated_by_email` being undefined for personal workspace sessions).

### Files Changed

| File | Change |
|------|--------|
| `app/api/sessions/route.ts` | Add `promptVersionId` and `promptVersionNull` query params |
| `app/api/prompts/versions/distinct/route.ts` | **New file** — distinct prompt versions for filter dropdown |
| `lib/services/session-service.ts` | Add `promptVersionId` filter, include `structured_notes_edited` in select/response |
| `app/capture/_components/session-filters.tsx` | Add prompt version filter dropdown |
| `app/capture/_components/past-sessions-table.tsx` | Add staleness warning icon in collapsed rows, pass new fields |
| `app/capture/_components/expanded-session-row.tsx` | Add staleness indicator, enhanced re-extract confirmation, "Last edited by" display |

### Implementation Increments

**Increment 1: Migration + API filter support.**
Add `structured_notes_edited` column. Update `GET /api/sessions` to support `promptVersionId` filter. Create `GET /api/prompts/versions/distinct` endpoint.

**Increment 2: Staleness indicators.**
Add staleness warning in collapsed table rows and expanded row. Wire `structured_notes_edited` into the update service logic.

**Increment 3: Prompt version filter + re-extraction warnings.**
Add prompt version filter to `SessionFilters`. Enhance re-extraction confirmation dialog. Add "Last edited by" display.
