# PRD-003: Signal Extraction

> **Master PRD Section:** Section 2 — Capture Tab (enrichment layer)
> **Status:** Implemented — Parts 1–4 complete (2026-03-26)
> **Depends on:** PRD-002 (Capture Tab — implemented)
> **Deliverable:** User can extract structured signals from raw session notes using Claude, review and edit the output as rendered markdown, and save it alongside the original notes.

## Purpose

The Capture tab collects raw session notes — freeform text pasted by account managers and sales reps after client calls. While this solves the first-mile problem of getting notes into a shared database, the raw text is difficult to scan, compare across clients, and synthesise into actionable insights.

Signal Extraction adds an enrichment layer on top of the raw capture. It sends the raw notes to Claude with a domain-aware prompt and returns a structured markdown report that categorises the signals the customer conveyed: pain points, must-haves, competitive landscape, blockers, and more. The user reviews the report, edits anything Claude got wrong or missed, and saves it alongside the original notes.

This is deliberately scoped as **signal capture, not signal interpretation.** The output answers "what is the customer telling us?" — not "what should we build." Roadmap decisions and feature prioritisation are future scope under the feature-advisor layer, which will consume these extracted signals as input.

### Context

InMobi is an ad tech company building a performance marketing platform where customers can run ads across Google, Bing, Meta, and other platforms from a single interface. The product is pre-revenue and most client interactions are onboarding or requirements-gathering calls with prospective customers. The signals extracted from these sessions are critical for understanding what the market needs before it commits.

## User Story

As a sales or account team member, I want to extract structured signals from my raw session notes so that the team can quickly understand what the customer communicated — their pain points, requirements, urgency, competitive context, and blockers — without reading through the entire raw text.

---

## Part 1: Database Schema Update

**Scope:** Add support for structured notes storage on the sessions table.

### Requirements

- **P1.R1** Add a `structured_notes` column to the `sessions` table. Type: TEXT, nullable. A null value indicates the session has not been enriched. A non-null value contains the markdown-formatted signal extraction output as reviewed and approved by the user.
- **P1.R2** The existing `raw_notes` column remains unchanged. Both `raw_notes` and `structured_notes` coexist on every session — raw notes are the source material, structured notes are the enriched output.
- **P1.R3** Existing RLS policies continue to apply. No new policies are needed — the column inherits the table's existing access rules.

### Acceptance Criteria

- [ ] `structured_notes` column exists on the `sessions` table (TEXT, nullable)
- [ ] Existing sessions have `structured_notes` as null (no data migration needed)
- [ ] RLS policies still function correctly — authenticated users can read and write the new column
- [ ] The sessions API (GET, POST, PUT) includes `structured_notes` in its request/response contracts

---

## Part 2: Signal Extraction via Claude API

**Scope:** Server-side API route and prompt that takes raw notes and returns a structured markdown signal report.

### Requirements

- **P2.R1** A new API route `POST /api/ai/extract-signals` accepts `{ rawNotes: string }` and returns `{ structuredNotes: string }`. The response body is a markdown-formatted signal extraction report.
- **P2.R2** The API route sends the raw notes to Claude with a system prompt that defines the signal extraction task, the expected output format, and the signal categories. The prompt is stored in `lib/prompts/signal-extraction.ts` and is version-controlled.
- **P2.R3** The system prompt instructs Claude to extract signals into the following structure:

  **Session-level attributes:**
  - **Summary** — a one-line TL;DR of the session
  - **Sentiment** — overall session sentiment: Positive, Mixed, or Negative, with a brief explanation
  - **Urgency** — how urgently the customer needs a solution: Critical, High, Medium, or Low, with context
  - **Decision Timeline** — when the customer expects to make a decision or go live (e.g., "Q3 2026," "Exploring, no fixed timeline")

  **Client profile (extracted from context in the notes):**
  - **Industry / Vertical** — the customer's business domain (e.g., E-commerce, Gaming, Fintech)
  - **Market / Geography** — where the customer operates
  - **Monthly Ad Spend** — approximate range if mentioned or inferable

  **Signal categories:**
  - **Pain Points** — what's broken or frustrating in the customer's current setup; what they're running away from
  - **Must-Haves / Requirements** — deal-breaker capabilities; table stakes to consider the platform
  - **Aspirations** — forward-looking wants; "nice to haves" that would delight but won't block a deal
  - **Competitive Mentions** — who they're currently using, who else they're evaluating, what they like or dislike about those tools
  - **Blockers / Dependencies** — what stands between interest and commitment (technical, organisational, contractual, timeline-based)
  - **Platforms & Channels** — which ad platforms matter to the customer (Google, Meta, Bing, TikTok, programmatic, etc.) and their relative importance
  - **Current Stack / Tools** — the customer's existing workflow for campaign management, reporting, attribution, and related operations

- **P2.R4** The prompt explicitly instructs Claude to:
  - Return the output as clean markdown with `##` headings for each section and `-` bullet points for individual signals
  - Use bold (`**label:**`) for session-level attributes and client profile fields
  - Leave a section empty with "No signals identified." if the notes contain no relevant information for that category — never fabricate signals
  - Only extract information that is present or clearly inferable from the notes — no hallucination
  - Not include conversational filler, disclaimers, or meta-commentary in the output
  - If the notes contain any point which do not lie under any category note it down as excess information and suggest a category for that dont push it in any irrelevant category

- **P2.R5** The API route validates the Claude response is non-empty and is a string. If Claude returns an empty or malformed response, the route returns HTTP 422 with a user-friendly error message.
- **P2.R6** The API route handles all Claude failure modes: timeouts, rate limits (429), service outages (500), and empty responses. Transient failures (429, 500, timeout) are retried up to 3 times with exponential backoff. Non-transient failures (400) are not retried. All failures are logged server-side with full context.
- **P2.R7** The `max_tokens` parameter is set explicitly on every Claude call based on expected output size. The model name is read from the `CLAUDE_MODEL` environment variable.
- **P2.R8** The API route requires authentication. Unauthenticated requests return 401.

### Acceptance Criteria

- [ ] `POST /api/ai/extract-signals` accepts raw notes and returns structured markdown
- [ ] Prompt lives in `lib/prompts/signal-extraction.ts` as a named export
- [ ] Output follows the defined markdown structure with all signal categories
- [ ] Empty categories show "No signals identified." instead of fabricated content
- [ ] Rate limits and timeouts are retried with exponential backoff (up to 3 retries)
- [ ] Non-retryable errors return appropriate HTTP status codes with user-friendly messages
- [ ] `max_tokens` is explicitly set on the Claude API call
- [ ] Model name is read from `CLAUDE_MODEL` environment variable
- [ ] Unauthenticated requests return 401
- [ ] All errors are logged server-side with full context

---

## Part 3: Capture Form — Extract Signals UX

**Scope:** Add the "Extract Signals" button to the capture form, display the structured output with markdown rendering, and allow the user to review and edit before saving.

### Requirements

- **P3.R1** An "Extract Signals" button appears on the capture form once the Notes field contains text. The button is disabled when Notes is empty.
- **P3.R2** Clicking "Extract Signals" sends the raw notes to `POST /api/ai/extract-signals`. While the request is in flight, the button shows a loading state (spinner + "Extracting...") and is disabled to prevent duplicate calls.
- **P3.R3** On successful extraction, the structured output appears below or alongside the notes field. The structured output is rendered as formatted markdown — headings, bullet points, and bold text are visually rendered, not shown as raw markdown characters.
- **P3.R4** A toggle or button allows the user to switch between **view mode** (rendered markdown) and **edit mode** (raw markdown in a textarea). Edit mode lets the user modify the structured output directly — reword signals, delete irrelevant sections, add missing information.
- **P3.R5** Switching back from edit mode to view mode re-renders the updated markdown.
- **P3.R6** The "Save Session" button persists both `raw_notes` and `structured_notes` together. If the user has not extracted signals, `structured_notes` is saved as null.
- **P3.R7** The user can re-extract signals by clicking "Extract Signals" again. This overwrites the current structured output with a fresh extraction. If the user has made manual edits to the structured output, a confirmation prompt is shown: "Re-extracting will replace your edited signals. Continue?" to prevent accidental loss of edits. the button contains a zap or a twinkle icon which updates to a rerun button when the extraction is done for the first time indicating that from now on its a reextraction
- **P3.R8** On extraction failure (network error, Claude error), an error toast is shown with a user-friendly message. The form state is preserved — raw notes and any previously extracted signals remain intact.
- **P3.R9** Signal extraction is optional. The user can save a session with only raw notes (no extraction). The "Save Session" button does not require structured notes.

### Acceptance Criteria

- [ ] "Extract Signals" button appears when Notes field has content
- [ ] Button is disabled when Notes is empty or extraction is in progress
- [ ] Loading state shows spinner and "Extracting..." text during API call
- [ ] Structured output appears after successful extraction, rendered as formatted markdown
- [ ] View mode renders markdown (headings, bullets, bold)
- [ ] Edit mode shows raw markdown in an editable textarea
- [ ] Toggle switches between view and edit modes, re-rendering on switch
- [ ] "Save Session" persists both raw_notes and structured_notes
- [ ] Sessions can be saved without extraction (structured_notes = null)
- [ ] Re-extraction shows a confirmation prompt if structured output has been edited
- [ ] Extraction failure shows an error toast and preserves form state
- [ ] Re-extraction replaces previous structured output

---

## Part 4: Past Sessions — Side-by-Side View with Markdown Rendering

**Scope:** Update the past sessions table to display both raw notes and structured notes, with markdown rendering for both.

### Requirements

- **P4.R1** When a session row is expanded in the past sessions table, the detail view shows two panels side by side: raw notes (left) and structured notes (right). If the session has no structured notes, the right panel shows a prompt: "No signals extracted yet" with an "Extract Signals" button.
- **P4.R2** Both panels render their content as formatted markdown — headings, bullet points, and bold text are visually displayed. This applies to raw notes as well, since users may use markdown formatting in their session notes.
- **P4.R3** Each panel has a view/edit toggle. View mode shows rendered markdown. Edit mode shows raw markdown in a textarea. The toggles are independent — the user can edit one panel while viewing the other.
- **P4.R4** The "Extract Signals" button is available in the expanded view for sessions that have raw notes. It works identically to the capture form: calls the API, shows a loading state, and populates the structured notes panel.
- **P4.R5** For sessions that already have structured notes, a "Re-extract" button is available. If the structured notes have been manually edited (dirty state), clicking re-extract shows the same confirmation prompt as in the capture form.
- **P4.R6** The "Save" button in the expanded row persists changes to both raw notes and structured notes. The "Cancel" button discards changes to both.
- **P4.R7** The notes column in the collapsed table row continues to show a truncated preview of the raw notes (existing behaviour). A visual indicator (icon or badge) next to the row shows whether signals have been extracted for that session.

### Acceptance Criteria

- [ ] Expanded row shows raw notes and structured notes side by side
- [ ] Sessions without structured notes show "No signals extracted yet" with an extract button
- [ ] Both panels render markdown content (headings, bullets, bold)
- [ ] Each panel has an independent view/edit toggle
- [ ] Extract Signals button works from the expanded view for unextracted sessions
- [ ] Re-extract button available for sessions with existing structured notes
- [ ] Re-extract shows confirmation prompt when structured notes have been edited
- [ ] Save persists both raw and structured notes
- [ ] Cancel discards changes to both panels
- [ ] Collapsed row shows visual indicator for extraction status
- [ ] Truncated notes preview in collapsed row still shows raw notes

---

## Backlog (deferred from this PRD)

- **JSON-based signal storage** — store extracted signals as structured JSON (in addition to or instead of markdown) to enable programmatic querying, aggregation, and the synthesis dashboard. Deferred because the current need is human-readable output, not machine-queryable data.
- **Bulk extraction** — "Extract all" button to run signal extraction on multiple past sessions that haven't been enriched yet. Useful for backfilling after the feature launches.
- **Extraction confidence scores** — Claude could indicate confidence per signal (e.g., "explicitly stated" vs. "inferred"). Deferred to avoid over-engineering the first version.
- **Custom signal categories** — allow users or admins to add/remove signal categories from the extraction prompt. Deferred because the current categories cover the onboarding call use case well.
- **Extraction history / versioning** — keep a history of past extractions so users can compare what changed after a re-extract. Deferred for simplicity.
- **Auto-extraction on save** — automatically run signal extraction when a session is saved, without requiring the user to click a button. Deferred because human-in-the-loop review is important in the early phase.
- **Session-level tags derived from signals** — auto-generate tags (e.g., "high urgency," "competitive threat") from the extracted signals for quick filtering. Deferred to synthesis dashboard scope.
