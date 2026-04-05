# TRD-013: File Upload and Signal Extraction

> **Status:** Draft (Part 1)
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
