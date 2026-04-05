# TRD-013: File Upload and Signal Extraction

> **Status:** Draft (Parts 1–2)
>
> Mirrors **PRD-013**. Each part maps to the corresponding PRD part.

---

## Part 1: File Upload Infrastructure

> Implements **P1.R1–P1.R9** from PRD-013.

### Overview

Add file upload capability to the capture form. Users can upload files (TXT, PDF, CSV, DOCX, JSON), which are parsed server-side into text and held in client state until session save. Chat format detection (WhatsApp, Slack) restructures parsed content into sender-labelled messages. A combined character counter tracks raw notes + attachment content against the 50,000 character limit. No database changes or persistence in this part — that comes in Part 2.

### Dependencies (npm)

| Package | Purpose | Version |
|---------|---------|---------|
| `pdf-parse` | PDF text extraction | latest |
| `mammoth` | DOCX → text extraction | latest |
| `papaparse` | CSV parsing | latest |

`pdf-parse` reads PDF buffers and returns extracted text. `mammoth` converts DOCX files to raw text (not HTML). `papaparse` is a robust CSV parser with header detection. All three are server-side only (used in the API route, not bundled to the client).

### Database Changes

None in Part 1. The `session_attachments` table and Supabase Storage bucket are introduced in Part 2. Part 1 is stateless — files are parsed and held in client memory only.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/services/file-parser-service.ts` | **Create** | Format-specific parsers (TXT, PDF, CSV, DOCX, JSON) + chat format detection |
| `lib/constants.ts` | **Create** | Shared constants: `MAX_FILE_SIZE_BYTES`, `MAX_COMBINED_CHARS`, `MAX_ATTACHMENTS`, `ACCEPTED_FILE_TYPES` |
| `app/api/files/parse/route.ts` | **Create** | Stateless parse endpoint — accepts file, returns parsed content + source format |
| `app/capture/_components/file-upload-zone.tsx` | **Create** | Drag-and-drop + file picker UI component |
| `app/capture/_components/attachment-list.tsx` | **Create** | List of uploaded attachments with type icons, size, remove button |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | Integrate upload zone, attachment state, combined char counter, disable logic |

### Implementation

#### Increment 1.1: File Parser Service + Constants

**What:** Create the file parser service with format-specific parsers and chat format detection, plus shared constants used across client and server.

**Files:**

1. **Create `lib/constants.ts`**

   ```typescript
   export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
   export const MAX_COMBINED_CHARS = 50_000;
   export const MAX_ATTACHMENTS = 5;
   export const ACCEPTED_FILE_TYPES = {
     "text/plain": [".txt"],
     "application/pdf": [".pdf"],
     "text/csv": [".csv"],
     "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
     "application/json": [".json"],
   } as const;
   export const ACCEPTED_EXTENSIONS = [".txt", ".pdf", ".csv", ".docx", ".json"];
   ```

2. **Create `lib/services/file-parser-service.ts`**

   Exports:
   - `parseFile(buffer: Buffer, fileName: string, mimeType: string): Promise<ParsedFileResult>`
   - `type ParsedFileResult = { parsed_content: string; source_format: SourceFormat }`
   - `type SourceFormat = "whatsapp" | "slack" | "generic"`

   Internal structure:
   - `parseTxt(buffer: Buffer): string` — decode as UTF-8.
   - `parsePdf(buffer: Buffer): Promise<string>` — use `pdf-parse` to extract text. Return `data.text`.
   - `parseCsv(buffer: Buffer): string` — use `papaparse` to parse. Concatenate rows into `"Header1: value1 | Header2: value2\n..."` format for readability.
   - `parseDocx(buffer: Buffer): Promise<string>` — use `mammoth.extractRawText()`. Return `value`.
   - `parseJson(buffer: Buffer): string` — `JSON.parse()` the buffer. If it's a Slack export (has `messages` array with `user`/`text` objects), delegate to `restructureSlack()`. Otherwise, `JSON.stringify(data, null, 2)` for readability.
   - `detectAndRestructure(content: string, mimeType: string): ParsedFileResult` — runs after parsing:
     - For `.txt` files: check if lines match WhatsApp pattern `\[\d{1,2}/\d{1,2}/\d{2,4},\s\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?\]\s.+?:\s.+`. If >50% of non-empty lines match, treat as WhatsApp and call `restructureWhatsApp()`.
     - For `.json` files: Slack detection happens in `parseJson()` before this step.
     - Otherwise: return `{ parsed_content: content, source_format: "generic" }`.
   - `restructureWhatsApp(content: string): string` — regex-parse each line, output `[Sender]: message` format, strip timestamps.
   - `restructureSlack(messages: SlackMessage[]): string` — map each message to `[User]: text` format.

   Error handling: each parser wraps in try/catch and throws a `FileParseError` (custom error class exported from this file) with a descriptive message (e.g., "Could not extract text from this PDF — it may be scanned or encrypted").

   Validation: after parsing, if `parsed_content.trim()` is empty, throw `FileParseError("No content could be extracted from this file.")`.

#### Increment 1.2: Stateless Parse API Route

**What:** Create the API route that accepts a file upload, calls the parser service, and returns the result. No persistence.

**Files:**

1. **Create `app/api/files/parse/route.ts`**

   ```
   POST /api/files/parse
   Content-Type: multipart/form-data
   Body: file (File)

   Response 200:
   {
     parsed_content: string,
     file_name: string,
     file_type: string,
     file_size: number,
     source_format: "whatsapp" | "slack" | "generic"
   }

   Response 400: { message: "No file provided" }
   Response 400: { message: "Unsupported file type: ..." }
   Response 400: { message: "File exceeds 10MB limit" }
   Response 401: { message: "Authentication required" }
   Response 422: { message: "No content could be extracted..." } (from FileParseError)
   Response 500: { message: "Failed to parse file" }
   ```

   Implementation steps:
   1. Auth check — `createClient()`, `getUser()`. Return 401 if no user.
   2. Read `formData()` from request. Get the `file` field.
   3. Validate: file exists, file size ≤ `MAX_FILE_SIZE_BYTES`, MIME type is in `ACCEPTED_FILE_TYPES`.
   4. Convert file to `Buffer` via `Buffer.from(await file.arrayBuffer())`.
   5. Call `parseFile(buffer, file.name, file.type)`.
   6. Return JSON response with `parsed_content`, `file_name`, `file_type`, `file_size`, `source_format`.
   7. Catch `FileParseError` → 422. Catch unknown errors → 500.
   8. Log: entry (`[api/files/parse] POST — parsing {fileName}`), success (`parsed {N} chars, format: {format}`), errors.

   Important: Next.js App Router handles `multipart/form-data` natively via `request.formData()`. No additional middleware (like multer) is needed.

   Add to `next.config.ts` if needed: set `api.bodyParser` to allow larger payloads. Actually, Next.js App Router route handlers do not use the `bodyParser` config — `formData()` handles file uploads directly with no size limit at the framework level. The 10MB limit is enforced in our code.

#### Increment 1.3: Upload Zone + Attachment List UI Components

**What:** Create the drag-and-drop upload zone and the attachment list components. These are self-contained client components that manage their own UI state (drag-over highlight, loading indicators) and call parent callbacks for data flow.

**Files:**

1. **Create `app/capture/_components/file-upload-zone.tsx`**

   ```typescript
   "use client"

   interface FileUploadZoneProps {
     onFileParsed: (result: ParsedAttachment) => void;
     disabled?: boolean;
     currentCount: number;
   }

   export interface ParsedAttachment {
     file: File;
     parsed_content: string;
     file_name: string;
     file_type: string;
     file_size: number;
     source_format: string;
   }
   ```

   Features:
   - Drag-and-drop area with a dashed border. On drag-over, border highlights (e.g., `border-[var(--brand-primary)]`).
   - Hidden `<input type="file" accept=".txt,.pdf,.csv,.docx,.json" multiple>` triggered by a "Browse files" button.
   - On file(s) selected or dropped:
     1. Client-side validation: check file type against `ACCEPTED_EXTENSIONS`, check size against `MAX_FILE_SIZE_BYTES`, check count against `MAX_ATTACHMENTS - currentCount`.
     2. For each valid file, show a loading state and call `POST /api/files/parse` with `FormData`.
     3. On success, call `onFileParsed(result)` with the parsed data + the original `File` object.
     4. On error (4xx/5xx), show error toast.
   - Supports multiple files in a single drop — each parsed independently.
   - Shows inline error for invalid files (wrong type, too large, max count exceeded).
   - Visual: Upload cloud icon + "Drag and drop files or Browse" text + accepted formats + size limit.
   - `disabled` prop disables the zone (e.g., during session save).

2. **Create `app/capture/_components/attachment-list.tsx`**

   ```typescript
   "use client"

   interface AttachmentListProps {
     attachments: ParsedAttachment[];
     onRemove: (index: number) => void;
   }
   ```

   Features:
   - Renders a list of attachment cards (only when `attachments.length > 0`).
   - Each card shows: file type icon (mapped from MIME type — `FileText` for TXT, `FileSpreadsheet` for CSV, `FileType` for PDF, `FileJson` for JSON, `FileText` for DOCX — all from `lucide-react`), file name (truncated if long), file size (formatted: "2.4 MB", "156 KB"), source format badge if not `"generic"` (e.g., `WhatsApp` or `Slack` badge using the existing `Badge` component), and an `X` button to remove.
   - Clicking remove calls `onRemove(index)`.
   - Clean, compact layout. Each card is a horizontal row.

#### Increment 1.4: Capture Form Integration

**What:** Integrate the upload zone and attachment list into the existing `session-capture-form.tsx`. Add combined character counter. Update the Extract Signals button disable logic.

**Files:**

1. **Modify `app/capture/_components/session-capture-form.tsx`**

   Changes:
   - **New state:** `const [attachments, setAttachments] = useState<ParsedAttachment[]>([])`.
   - **Add `FileUploadZone`** below the Notes textarea:
     ```tsx
     <FileUploadZone
       onFileParsed={(result) => setAttachments((prev) => [...prev, result])}
       disabled={isSubmitting}
       currentCount={attachments.length}
     />
     ```
   - **Add `AttachmentList`** below the upload zone:
     ```tsx
     {attachments.length > 0 && (
       <AttachmentList
         attachments={attachments}
         onRemove={(index) =>
           setAttachments((prev) => prev.filter((_, i) => i !== index))
         }
       />
     )}
     ```
   - **Combined character counter:**
     ```typescript
     const attachmentChars = attachments.reduce(
       (sum, a) => sum + a.parsed_content.length, 0
     );
     const totalChars = (rawNotes?.length ?? 0) + attachmentChars;
     const isOverLimit = totalChars > MAX_COMBINED_CHARS;
     ```
     Display below the upload zone: `{totalChars.toLocaleString()} / {MAX_COMBINED_CHARS.toLocaleString()} characters`
     If over limit, show in red with warning text.
   - **Update Extract Signals button** disable logic:
     - Currently: `disabled={!hasNotes || extractionState === "extracting"}`
     - New: `disabled={(!hasNotes && attachments.length === 0) || extractionState === "extracting" || isOverLimit}`
     - Allow extraction with only attachments (no raw notes) per P4.R5.
   - **Update `performExtraction`** to include attachment content in the API call:
     - For now (Part 1 only), the extraction API still receives just `rawNotes`. But we compose the input on the client by concatenating raw notes with attachment parsed content before sending:
       ```typescript
       const composedInput = composeAIInput(notes, attachments);
       // Send composedInput as rawNotes to the existing API
       body: JSON.stringify({ rawNotes: composedInput })
       ```
     - Helper function `composeAIInput(rawNotes: string, attachments: ParsedAttachment[]): string`:
       ```
       --- Manual Notes ---
       {rawNotes}

       --- Attachment: {file_name} ({source_format}) ---
       {parsed_content}
       ...
       ```
       If `rawNotes` is empty, omit the "Manual Notes" section.
       This keeps the existing extract-signals API route unchanged — it still receives a single `rawNotes` string. The composition happens on the client.
   - **Update `onSubmit`**: include `attachments` in the POST body for Part 2. For now (Part 1), attachments are not persisted — they exist only in client state. The session save only sends `rawNotes` and `structuredNotes` as today. When Part 2 is implemented, the save will also upload files and insert attachment rows.
   - **Update `reset` after save**: clear attachments state: `setAttachments([])`.
   - **Update Zod schema**: change `rawNotes` min from 1 to 0 to allow sessions with only attachments. Add a custom `.refine()` that requires either `rawNotes` or attachments to be non-empty. Actually, since attachments are outside react-hook-form state, the validation for "at least one input" should be handled in the submit handler or by disabling the submit button when both are empty:
     ```typescript
     const hasInput = hasNotes || attachments.length > 0;
     // Disable Save when !hasInput
     ```
     Update the Zod schema: change `rawNotes` to `.min(0)` (or just `.string()`) — no longer required when attachments are present. The submit button disable condition: `disabled={!hasInput || !isValid || isSubmitting}`.

   Note on PRD Part 2 forward-compatibility: The `ParsedAttachment` type includes the `File` object in memory. When Part 2 is implemented, the submit handler will: (1) upload each `attachment.file` to Supabase Storage, (2) insert the attachment metadata + `parsed_content` into the `session_attachments` table. The client state shape is designed to carry all the data Part 2 will need without changes.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 1.1 | File parser service + constants | P1.R4, P1.R9 |
| 1.2 | Stateless parse API route | P1.R3, P1.R7 |
| 1.3 | Upload zone + attachment list UI | P1.R1, P1.R2, P1.R6 |
| 1.4 | Capture form integration | P1.R5, P1.R8, P1.R2 (count validation) |

### Forward Compatibility Notes (for Parts 2–4)

These are not implemented in Part 1 but the design accounts for them:

- **Part 2 — Persistence:** The `ParsedAttachment` type carries the original `File` object for Supabase Storage upload. The `source_format` field maps directly to the `session_attachments.source_format` column. The `composeAIInput()` helper will be moved server-side when the extract-signals API is updated to fetch attachments from the DB.
- **Part 3 — Past sessions:** The `AttachmentList` component is designed for reuse in the expanded session row. It will be extended with "View content" toggle and download button.
- **Part 4 — Edge cases:** The `MAX_ATTACHMENTS` limit is enforced in the upload zone (Increment 1.3). The `MAX_COMBINED_CHARS` limit is enforced in the capture form (Increment 1.4). Empty file and corrupt file handling is in the parser service (Increment 1.1).

---

## Part 2: Persistence and Signal Extraction Integration

> Implements **P2.R1–P2.R6** from PRD-013.
>
> References full PRD scope: Part 3 requires `getAttachmentsBySessionId()` and signed URL generation for the past sessions expanded view. Part 4 requires server-side combined character limit validation. All interfaces and storage paths are designed to support these future needs.

### Overview

Persist file attachments when a session is saved. Original files are stored in Supabase Storage; metadata and parsed content go into a new `session_attachments` table. Attachment deletion soft-deletes the DB row and hard-deletes the blob. Parsed content is view-only on the client. Signal extraction composition (P2.R4) is already implemented client-side in Part 1 — no server-side changes needed for extraction.

### Database Changes

#### `session_attachments` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `session_id` | UUID (FK → sessions) | NOT NULL, ON DELETE CASCADE |
| `file_name` | TEXT | NOT NULL — original file name |
| `file_type` | TEXT | NOT NULL — MIME type |
| `file_size` | INTEGER | NOT NULL — bytes |
| `storage_path` | TEXT | NOT NULL — path in Supabase Storage bucket |
| `parsed_content` | TEXT | NOT NULL — extracted text from the file |
| `source_format` | TEXT | NOT NULL, default `'generic'` — detected format (`whatsapp`, `slack`, `generic`) |
| `created_by` | UUID | NOT NULL, default `auth.uid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. Mirrors parent session. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `deleted_at` | TIMESTAMPTZ | Nullable. Soft delete. |

**Indexes:**
- `session_attachments_session_id_idx` — on `(session_id)` where `deleted_at IS NULL`

**RLS policies:**
- SELECT: authenticated users can read attachments where `team_id IS NULL AND created_by = auth.uid()` OR where `is_team_member(team_id)`.
- INSERT: authenticated users.
- UPDATE/DELETE: service role only (soft-delete sets `deleted_at` via service role client).

**Why `team_id` and `created_by` on attachments?** Denormalised from the parent session to keep RLS policies self-contained (no cross-table joins in policies). Mirrors the pattern used by `sessions`, `clients`, `master_signals`, and `prompt_versions`.

#### Supabase Storage bucket

- **Bucket name:** `session-attachments`
- **Public:** No (private bucket)
- **File path pattern:** `{owner_id}/{session_id}/{uuid}.{ext}`
  - `owner_id` = `auth.uid()` for personal workspace, `team_id` for team workspace
  - `{uuid}` = `crypto.randomUUID()` to prevent name collisions
  - `{ext}` = original file extension
- **Storage policies:** All storage operations (upload, download, delete) use the service role client server-side. No direct client-to-storage access — the browser never talks to Storage directly.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/services/attachment-service.ts` | **Create** | Attachment CRUD — upload to Storage, insert/select/soft-delete DB rows |
| `app/api/sessions/route.ts` | **Modify** | Accept `attachments` array in POST, persist after session creation |
| `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` | **Create** | DELETE — soft-delete attachment + hard-delete from Storage |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | Upload original files on save, handle upload failures |
| `app/capture/_components/attachment-list.tsx` | **Modify** | Add "View content" toggle for parsed text (view-only) |

### Implementation

#### Increment 2.1: Database Migration + Storage Bucket

**What:** Create the `session_attachments` table with RLS and the `session-attachments` Storage bucket. This is a manual Supabase Dashboard step documented here.

**SQL migration:**

```sql
-- session_attachments table
CREATE TABLE session_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  parsed_content TEXT NOT NULL,
  source_format TEXT NOT NULL DEFAULT 'generic',
  created_by UUID NOT NULL DEFAULT auth.uid(),
  team_id UUID REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Index for fetching attachments by session
CREATE INDEX session_attachments_session_id_idx
  ON session_attachments (session_id)
  WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE session_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: personal workspace (own) or team member
CREATE POLICY "Users can read own attachments"
  ON session_attachments FOR SELECT
  TO authenticated
  USING (
    (team_id IS NULL AND created_by = auth.uid())
    OR
    (team_id IS NOT NULL AND is_team_member(team_id))
  );

-- INSERT: authenticated users
CREATE POLICY "Authenticated users can insert attachments"
  ON session_attachments FOR INSERT
  TO authenticated
  WITH CHECK (true);
```

**Storage bucket:** Create via Supabase Dashboard → Storage → New bucket:
- Name: `SYNTHESISER_FILE_UPLOAD`
- Public: off
- File size limit: 10MB
- Allowed MIME types: `text/plain`, `application/pdf`, `text/csv`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/json`

No Storage RLS policies needed — all operations go through the service role client.

Save migration SQL to `docs/013-file-upload/001-create-session-attachments-table.sql`.

#### Increment 2.2: Attachment Service

**What:** Create the service layer for attachment CRUD operations.

**Files:**

1. **Create `lib/services/attachment-service.ts`**

   Exports:
   - `uploadAndCreateAttachment(params): Promise<SessionAttachment>` — uploads file to Storage, inserts DB row
   - `getAttachmentsBySessionId(sessionId: string): Promise<SessionAttachment[]>` — fetches non-deleted attachments for a session
   - `deleteAttachment(attachmentId: string): Promise<void>` — soft-deletes DB row + hard-deletes from Storage
   - `getSignedDownloadUrl(storagePath: string): Promise<string>` — generates a signed URL for downloading the original file (used by Part 3)

   Types:
   ```typescript
   export interface SessionAttachment {
     id: string;
     session_id: string;
     file_name: string;
     file_type: string;
     file_size: number;
     storage_path: string;
     parsed_content: string;
     source_format: string;
     created_at: string;
   }

   export interface CreateAttachmentInput {
     sessionId: string;
     fileName: string;
     fileType: string;
     fileSize: number;
     parsedContent: string;
     sourceFormat: string;
     fileBuffer: Buffer;
     teamId: string | null;
   }
   ```

   Implementation details:

   **`uploadAndCreateAttachment`:**
   1. Build storage path: `{ownerId}/{sessionId}/{uuid}.{ext}` where `ownerId` = `teamId ?? auth.uid()`.
   2. Use `createServiceRoleClient()` to upload to `session-attachments` bucket: `supabase.storage.from('session-attachments').upload(path, buffer, { contentType })`.
   3. If upload fails, throw with descriptive error.
   4. Insert row into `session_attachments` using the anon client (RLS INSERT policy allows authenticated users). Include `team_id` from input.
   5. Return the inserted row.
   6. Log: entry, storage upload result, DB insert result, errors.

   **`getAttachmentsBySessionId`:**
   1. Use anon client (RLS handles access control).
   2. `SELECT * FROM session_attachments WHERE session_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`.
   3. Return rows.

   **`deleteAttachment`:**
   1. Use service role client to read the attachment row (need `storage_path`).
   2. Soft-delete: `UPDATE session_attachments SET deleted_at = now() WHERE id = $1`.
   3. Hard-delete from Storage: `supabase.storage.from('session-attachments').remove([storagePath])`.
   4. If Storage delete fails, log warning but don't fail (attachment is already soft-deleted in DB — orphaned blob is acceptable).
   5. Throw `AttachmentNotFoundError` if row doesn't exist.

   **`getSignedDownloadUrl`:**
   1. Use service role client.
   2. `supabase.storage.from('session-attachments').createSignedUrl(path, 60)` — 60 second expiry.
   3. Return the signed URL.

   Error class:
   ```typescript
   export class AttachmentNotFoundError extends Error {
     constructor(message: string) {
       super(message);
       this.name = "AttachmentNotFoundError";
     }
   }
   ```

#### Increment 2.3: API Route Updates

**What:** Update `POST /api/sessions` to persist attachments alongside session creation. Create a DELETE route for individual attachment removal.

**Files:**

1. **Modify `app/api/sessions/route.ts`**

   Changes to `POST` handler:
   - Update Zod schema to accept optional `attachments` array:
     ```typescript
     attachments: z.array(z.object({
       file_name: z.string(),
       file_type: z.string(),
       file_size: z.number(),
       source_format: z.string(),
       parsed_content: z.string(),
     })).optional().default([]),
     ```
   - Update `rawNotes` validation: change `.min(1)` to `.min(0)` (or just `.string()`) to allow sessions with only attachments. Add a `.refine()` that requires either `rawNotes` or `attachments` to be non-empty:
     ```typescript
     .refine(
       (data) => data.rawNotes.trim().length > 0 || (data.attachments && data.attachments.length > 0),
       { message: "Notes or at least one attachment is required", path: ["rawNotes"] }
     )
     ```
   - After session creation, iterate over `attachments` and call `uploadAndCreateAttachment()` for each. The original file binary is **not** available at this point (the API receives JSON, not multipart). **Design decision:** The original file upload to Storage happens client-side via a separate step. The `POST /api/sessions` route only persists the attachment metadata + parsed content to the DB, without the original file blob.

   **Revised approach for original file upload:** Since `POST /api/sessions` receives JSON (not multipart), the client must upload original files separately. The flow becomes:
   1. Client saves session via `POST /api/sessions` → gets back `session.id`.
   2. Client uploads each original file via `POST /api/sessions/[id]/attachments` (new route, multipart) → each call uploads to Storage + inserts DB row.
   3. If any upload fails, the session is still saved — attachment persistence is best-effort.

   This keeps the session save fast and atomic (JSON-only), and file uploads happen as a follow-up. The capture form already holds the `File` objects in memory from Part 1.

2. **Create `app/api/sessions/[id]/attachments/route.ts`**

   ```
   POST /api/sessions/[id]/attachments
   Content-Type: multipart/form-data
   Body: file (File), parsed_content (string), source_format (string)

   Response 201: { attachment: SessionAttachment }
   Response 400: { message: "..." } (missing fields, invalid file)
   Response 401: { message: "Authentication required" }
   Response 404: { message: "Session not found" }
   Response 500: { message: "Failed to upload attachment" }
   ```

   Implementation:
   1. Auth check.
   2. Verify session exists and user has access (same logic as `checkTeamSessionPermission` but for write access).
   3. Read `formData()` — extract `file`, `parsed_content`, `source_format`.
   4. Validate attachment count: query existing non-deleted attachment count for this session. If `count >= MAX_ATTACHMENTS`, return 400.
   5. Convert file to Buffer.
   6. Call `uploadAndCreateAttachment()` with session ID, file data, parsed content, and team ID.
   7. Return the created attachment.

3. **Create `app/api/sessions/[id]/attachments/[attachmentId]/route.ts`**

   ```
   DELETE /api/sessions/[id]/attachments/[attachmentId]

   Response 200: { message: "Attachment deleted" }
   Response 401: { message: "Authentication required" }
   Response 403: { message: "..." } (team permission check)
   Response 404: { message: "Attachment not found" }
   Response 500: { message: "Failed to delete attachment" }
   ```

   Implementation:
   1. Auth check.
   2. Team permission check (same as session edit permission — reuse `checkTeamSessionPermission` or extract to a shared helper).
   3. Call `deleteAttachment(attachmentId)`.
   4. Catch `AttachmentNotFoundError` → 404.

#### Increment 2.4: Client-Side Persistence + View-Only Content

**What:** Update the capture form to upload original files to Storage after session save. Add a "View content" toggle to the attachment list for viewing parsed text (read-only).

**Files:**

1. **Modify `app/capture/_components/session-capture-form.tsx`**

   Changes to `onSubmit`:
   - After `POST /api/sessions` returns the new session ID:
     1. For each attachment in state, upload the original file via `POST /api/sessions/[id]/attachments` (multipart).
     2. Show a progress indicator or toast for file uploads.
     3. If any upload fails, show an error toast but don't fail the session save (session data is already persisted).
     4. Clear attachments state after all uploads complete (or fail).
   - Remove `attachments` from the JSON body of `POST /api/sessions` (the metadata is now sent via the multipart upload route instead).
   - Update the composed `rawNotes` to only include manual notes (not attachment content) — attachment parsed content is now persisted separately in `session_attachments`. The signal extraction composition remains client-side: `composeAIInput()` still merges raw notes + attachment content for the extract-signals call.

   **Session save flow (updated):**
   ```
   1. User fills form + uploads files (parsed client-side via Part 1)
   2. User clicks "Extract Signals" → client composes rawNotes + attachment content → sends to /api/ai/extract-signals
   3. User clicks "Save Session" →
      a. POST /api/sessions with { clientId, clientName, sessionDate, rawNotes (manual only), structuredNotes }
      b. For each attachment: POST /api/sessions/[id]/attachments with multipart { file, parsed_content, source_format }
      c. On completion: reset form
   ```

2. **Modify `app/capture/_components/attachment-list.tsx`**

   Add a "View content" toggle per attachment:
   - Each attachment row gets an expand/collapse chevron button.
   - When expanded, shows the `parsed_content` in a read-only container with monospace font, max-height with scroll, and a muted background.
   - The text is not editable — no textarea, just a `<pre>` or `<div>` with `whitespace-pre-wrap`.
   - This satisfies P2.R6 (parsed content is view-only).

#### Increment 2.5: Code Quality Audit

**What:** Review all files created or modified in Part 2 for adherence to development rules.

**Scope:** `lib/services/attachment-service.ts`, `app/api/sessions/route.ts`, `app/api/sessions/[id]/attachments/route.ts`, `app/api/sessions/[id]/attachments/[attachmentId]/route.ts`, `app/capture/_components/session-capture-form.tsx`, `app/capture/_components/attachment-list.tsx`.

**Checklist:**
1. **SRP** — each file and function does one thing.
2. **DRY** — no duplicated patterns (e.g., team permission checks extracted to a shared helper if reused).
3. **Design tokens** — no hardcoded colours or font sizes.
4. **Logging** — all API routes and service functions log entry, exit, and errors.
5. **Dead code** — no unused imports or variables.
6. **Convention compliance** — naming, exports, import order, TypeScript strictness.

This increment produces fixes, not a report.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 2.1 | Database migration + Storage bucket | P2.R1, P2.R2 |
| 2.2 | Attachment service (CRUD) | P2.R3 (service layer), P2.R5 (delete logic) |
| 2.3 | API route updates (persist + delete) | P2.R3 (API layer), P2.R5 (delete endpoint) |
| 2.4 | Client-side persistence + view-only content | P2.R3 (upload flow), P2.R4 (composition — already done), P2.R6 (view-only) |
| 2.5 | Code quality audit | Convention compliance |

### Forward Compatibility Notes (for Parts 3–4)

- **Part 3 — Past sessions display:** `getAttachmentsBySessionId()` is ready for the expanded session row. `getSignedDownloadUrl()` generates signed URLs for the download button. The `AttachmentList` component's view-only toggle (Increment 2.4) will be reused in expanded rows. The attachment count can be fetched via `getAttachmentsBySessionId().length` or added as a count subquery in `getSessions()`.
- **Part 3 — Upload from expanded view:** The `FileUploadZone` + `POST /api/sessions/[id]/attachments` route already support adding attachments to existing sessions.
- **Part 4 — Server-side combined limit:** The `POST /api/sessions/[id]/attachments` route can query existing attachment `parsed_content` character totals and reject uploads that would exceed `MAX_COMBINED_CHARS`.
