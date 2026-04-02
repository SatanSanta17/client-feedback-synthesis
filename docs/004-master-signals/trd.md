# TRD-004: Master Signal View

> **Status:** Part 1 Increments 1.1–1.6 implemented
> **PRD:** `docs/004-master-signals/prd.md` (approved)
> **Mirrors:** PRD Part 1

---

## Part 1: Master Signal Page — AI Synthesis, Persistence, and Display

### Overview

Add a `/signals` page that lets the team generate a master signal document — an AI-synthesised cross-client analysis produced by Claude from all individual session signals. The master signal is persisted in a new `master_signals` database table. On re-generation, only new/updated sessions since the last generation are sent to Claude alongside the previous master signal (incremental update). A staleness indicator warns when new data is available. The generated markdown is rendered on the page and can be downloaded as PDF.

---

### Database Model

#### `master_signals` (new table)

Stores every generated master signal as an immutable row. Each generation inserts a new row — previous rows are never updated or deleted. The latest row (by `generated_at` DESC) is the current master signal displayed to users. Older rows are retained as historical snapshots.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `content` | TEXT | Markdown content of the generated master signal |
| `generated_at` | TIMESTAMPTZ | When this generation completed |
| `sessions_included` | INTEGER | Total number of sessions that contributed to this signal |
| `created_by` | UUID | `auth.uid()` — who triggered the generation |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Design:** Each generation creates a new row. The latest row (by `generated_at` DESC) is the current master signal. Previous rows are retained for potential future "generation history" (backlog). We use `generated_at` of the latest row to determine the delta for incremental updates.

**RLS:** Authenticated users can SELECT and INSERT. No UPDATE or DELETE needed — each generation is an immutable snapshot.

**Indexes:** `master_signals_generated_at_idx` — DESC on `generated_at` for fast "get latest" queries.

---

### API Endpoints

#### `POST /api/ai/generate-master-signal`

Triggers master signal generation (cold start or incremental).

**Auth:** Required (401 if unauthenticated).

**Request body:** None (empty POST).

**Logic:**

1. Fetch the latest `master_signals` row (by `generated_at` DESC, limit 1).
2. **If no previous generation exists (cold start):**
   - Fetch all non-deleted sessions with non-null `structured_notes`, joined with `clients` for client names.
   - If zero sessions found, return 422 with message "No extracted signals found."
   - Build Claude prompt with all session signals.
3. **If previous generation exists (incremental):**
   - Fetch sessions where `updated_at > last_generated_at` AND `structured_notes IS NOT NULL` AND `deleted_at IS NULL`, joined with `clients`.
   - If zero new sessions, return 200 with `{ unchanged: true, masterSignal: <existing> }` — no re-generation needed.
   - Build Claude prompt with the previous master signal + new/updated session signals.
4. Call `synthesiseMasterSignal()` in the AI service.
5. Insert a new row into `master_signals` with the generated content.
6. Return `{ masterSignal: { id, content, generatedAt, sessionsIncluded } }`.

**Error handling:** Same pattern as `extract-signals` — map AI errors to HTTP status codes (400, 422, 500, 503). A failed generation never inserts a row, so the previous master signal is preserved.

**Response:**
- 200: `{ masterSignal: { id, content, generatedAt, sessionsIncluded }, unchanged?: boolean }`
- 401: Unauthenticated
- 422: No sessions with structured notes
- 500/503: AI service errors

#### `GET /api/master-signal`

Fetch the current master signal and staleness info.

**Auth:** Required (401 if unauthenticated).

**Logic:**

1. Fetch the latest `master_signals` row.
2. If none exists, return `{ masterSignal: null, staleCount: <total sessions with structured_notes> }`.
3. If exists, count sessions where `updated_at > generated_at` AND `structured_notes IS NOT NULL` AND `deleted_at IS NULL`.
4. Return the master signal and stale count.

**Response:**
- 200: `{ masterSignal: { id, content, generatedAt, sessionsIncluded } | null, staleCount: number }`
- 401: Unauthenticated

---

### Service Layer

#### `lib/services/master-signal-service.ts` (new file)

**Functions:**

`getLatestMasterSignal(): Promise<MasterSignal | null>`
- Queries `master_signals` ORDER BY `generated_at` DESC LIMIT 1.
- Returns the row or null.

`getStaleSessionCount(since: string): Promise<number>`
- Counts sessions where `updated_at > since` AND `structured_notes IS NOT NULL` AND `deleted_at IS NULL`.
- Used by both the GET endpoint and the generate endpoint.

`getAllSignalSessions(): Promise<SignalSession[]>`
- Fetches all non-deleted sessions with non-null `structured_notes`, joined with `clients.name`.
- Returns `{ id, clientName, sessionDate, structuredNotes }[]`.

`getSignalSessionsSince(since: string): Promise<SignalSession[]>`
- Same as above but filtered to `updated_at > since`.

`saveMasterSignal(content: string, sessionsIncluded: number): Promise<MasterSignal>`
- Inserts a new row into `master_signals`.

#### `lib/services/ai-service.ts` (extended)

**New function:**

`synthesiseMasterSignal(input: MasterSignalInput): Promise<string>`
- `input.previousMasterSignal?: string` — the previous master signal markdown (null for cold start)
- `input.sessions: Array<{ clientName, sessionDate, structuredNotes }>` — the session signals to incorporate
- Calls Claude with the master signal synthesis prompt
- Returns the generated markdown
- Same retry logic and error classes as `extractSignals()`
- `max_tokens`: 8192 (master signal is larger than individual extractions)

#### `lib/prompts/master-signal-synthesis.ts` (new file)

**Cold start prompt (system):**
Instructs Claude to read all provided individual session signals and produce a synthesised master signal document. The prompt defines the expected output structure:
- Executive summary (2-3 paragraphs of high-level patterns)
- Signal categories (same categories as individual extraction: Pain Points, Must-Haves, Aspirations, Competitive Mentions, Blockers, Platforms & Channels, Current Stack, Other) — but synthesised across clients, with recurring themes identified and attributed to source clients
- Cross-client patterns (themes that appear in 2+ clients, with client names)
- Sentiment overview (aggregate sentiment across clients)
- Strategic takeaways (3-5 actionable insights derived from the signals)

Rules: only use information from the provided signals, attribute insights to source clients, do not fabricate.

**Incremental update prompt (system):**
Instructs Claude to update an existing master signal with new session data. Provides:
- The previous master signal as context
- The new/updated session signals
- Instructions to merge, not replace: incorporate new signals into existing themes where relevant, add new themes if needed, update counts and attributions, keep the same output structure.

**User message builder:**
`buildMasterSignalUserMessage(sessions: SignalSession[], previousMasterSignal?: string): string`
- Formats each session as a labeled block: `### [Client Name] — [Date]\n<structured notes>`
- If `previousMasterSignal` is provided, prepends it under a `## Previous Master Signal` section

---

### Frontend

#### New files

**`app/signals/page.tsx`** — Server component. Renders page metadata and the `MasterSignalPageContent` client component.

**`app/signals/_components/master-signal-page-content.tsx`** — Client component. The main page content:
- On mount, fetches `GET /api/master-signal` to load the current master signal and stale count.
- **Empty state** (no master signal, no sessions): Shows message directing user to extract signals on the Capture page first.
- **Empty state** (no master signal, sessions exist): Shows "Generate" button with message "X session(s) with extracted signals ready to synthesise."
- **Has master signal:** Renders the markdown content using `react-markdown` + `remark-gfm` + prose styling. Shows `generated_at` timestamp and `sessionsIncluded` count.
- **Staleness banner:** If `staleCount > 0`, shows a banner: "Master signal may be out of date — X new/updated session(s) since last generation." Positioned above the content, near the Generate button.
- **Generate button:** "Generate Master Signal" (cold start) or "Re-generate Master Signal" (update). Shows Loader2 spinner while generating. Disabled during generation.
- **Download PDF button:** Enabled only when a master signal exists. Calls a client-side PDF generation function.
- **Error handling:** Toast on API failure. Previous master signal remains visible.

**`app/signals/_components/master-signal-pdf.ts`** — Utility function to generate a PDF from the master signal markdown. Uses a lightweight library (e.g., `html2pdf.js` or `jspdf` + rendering the markdown to HTML first). The PDF includes a title, generation date, and the formatted content.

#### Modified files

**`components/layout/tab-nav.tsx`** — Add a "Master Signals" tab entry:
```typescript
{
  label: "Master Signals",
  href: "/m-signals",
  icon: <BarChart3 className="h-4 w-4" />,
}
```

---

### Implementation Increments

#### Increment 1.1: Database Table + Service Layer

**Scope:**
- Create `master_signals` table in Supabase (manual migration) with RLS policies and index.
- Create `lib/services/master-signal-service.ts` with all five functions: `getLatestMasterSignal`, `getStaleSessionCount`, `getAllSignalSessions`, `getSignalSessionsSince`, `saveMasterSignal`.
- Define TypeScript interfaces: `MasterSignal`, `SignalSession`.

**Files created:**
- `lib/services/master-signal-service.ts`

**Files modified:**
- `ARCHITECTURE.md` (data model, file map)

**Verification:** TypeScript compiles. Service functions match the interfaces defined above.

---

#### Increment 1.2: AI Prompt + Synthesis Function

**Scope:**
- Create `lib/prompts/master-signal-synthesis.ts` with cold start and incremental system prompts + user message builder.
- Add `synthesiseMasterSignal()` to `lib/services/ai-service.ts` with the same retry/error pattern as `extractSignals()`.

**Files created:**
- `lib/prompts/master-signal-synthesis.ts`

**Files modified:**
- `lib/services/ai-service.ts`
- `ARCHITECTURE.md` (file map)

**Verification:** TypeScript compiles. Prompt structure matches the signal categories from the individual extraction prompt.

---

#### Increment 1.3: API Routes

**Scope:**
- Create `POST /api/ai/generate-master-signal` route handler with auth check, cold start vs. incremental logic, and error mapping.
- Create `GET /api/master-signal` route handler with auth check, latest master signal fetch, and stale count.

**Files created:**
- `app/api/ai/generate-master-signal/route.ts`
- `app/api/master-signal/route.ts`

**Files modified:**
- `ARCHITECTURE.md` (API routes table)

**Verification:** TypeScript compiles. Routes follow the same patterns as existing API routes (auth check, Zod validation where needed, error mapping).

---

#### Increment 1.4: Frontend Page + Tab Navigation

**Scope:**
- Create `/signals` page with `MasterSignalPageContent` client component.
- Implement: fetch current master signal on mount, empty states, staleness banner, Generate button, loading state, markdown rendering, error toasts.
- Add "Signals" tab to `tab-nav.tsx`.

**Files created:**
- `app/signals/page.tsx`
- `app/signals/_components/master-signal-page-content.tsx`

**Files modified:**
- `components/layout/tab-nav.tsx`
- `ARCHITECTURE.md` (file map)

**Verification:** Page loads, shows correct empty state, Generate button triggers API call, markdown renders with prose styling, staleness banner shows correct count, tab navigation works.

---

#### Increment 1.5: PDF Download

**Scope:**
- Install a PDF generation library (evaluate `html2pdf.js` or `jspdf` + `html2canvas`).
- Create `app/signals/_components/master-signal-pdf.ts` utility.
- Wire the "Download PDF" button in the page content component.

**Files created:**
- `app/signals/_components/master-signal-pdf.ts`

**Files modified:**
- `app/signals/_components/master-signal-page-content.tsx`
- `package.json` (new dependency)

**Verification:** PDF downloads with formatted content, title, and generation date. Button disabled when no master signal exists.

---

#### Increment 1.6: Documentation + Changelog

**Scope:**
- Update `ARCHITECTURE.md` with final file map, data model, API routes, and env vars.
- Update `CHANGELOG.md` with all Part 1 changes.
- Verify all documentation references match the codebase.

**Files modified:**
- `ARCHITECTURE.md`
- `CHANGELOG.md`

**Verification:** All file paths in ARCHITECTURE.md exist. All API routes documented. Changelog entries cover all increments.
