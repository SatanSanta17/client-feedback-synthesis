# PRD-004: Master Signal View

> **Status:** Implemented — Part 1 complete (2026-03-26)
> **Section:** 004-master-signals
> **Master PRD ref:** Section 3 (Synthesis Dashboard) — first deliverable

---

## Purpose

Individual session signal extraction is live. Each session can have its structured notes extracted via Claude, producing a per-session markdown report of categorised signals (Pain Points, Must-Haves, Aspirations, etc.).

The next step is a **master signal document** — a single AI-synthesised report that distills all individual session signals into a unified, cross-client analysis. This is not a raw dump of grouped signals — Claude reads all the individual extracted signals and produces a higher-level synthesis: recurring themes, cross-client patterns, and strategic insights.

The generation is **incremental**: the system tracks when the master signal was last generated and which sessions have been added or updated since. On re-generation, only the delta (new/updated signals) is sent to Claude along with the previous master signal, producing an updated version without reprocessing everything from scratch. This keeps API costs low and generation fast.

---

## User Story

As a sales or account team member, I want to generate a master signal document that synthesises all extracted signals across clients into a single cohesive analysis, so that I can see cross-client themes and patterns without reading every session individually — and I want it to update incrementally as new sessions are captured.

---

## Part 1: Master Signal Page — AI Synthesis, Persistence, and Display

### Requirements

**P1.R1 — New `/signals` page.**
A new tab/page at `/signals` accessible from the main navigation. The page is the home for the master signal document. No filters — the master signal covers all sessions.

**P1.R2 — Generate button.**
A prominent "Generate Master Signal" button. When clicked, the system:
1. Determines whether this is a **first generation** or an **incremental update**
2. Fetches the relevant session signals (all sessions for first gen; only new/updated since last gen for incremental)
3. Sends them to Claude via a server-side API route to produce a synthesised master signal document
4. Persists the generated master signal and the generation timestamp
5. Displays the result on the page

**P1.R3 — First generation (cold start).**
When no master signal exists yet:
- Fetch all sessions with non-null `structured_notes`
- Send all individual signals to Claude with a synthesis prompt
- Claude produces a comprehensive master signal document in markdown
- Store the generated markdown and the current timestamp as `last_generated_at`

**P1.R4 — Incremental generation (warm update).**
When a master signal already exists:
- Fetch sessions where `updated_at > last_generated_at` and `structured_notes IS NOT NULL`
- Send the **previous master signal** + the **new/updated individual signals** to Claude
- Claude produces an updated master signal that incorporates the new data
- Store the updated markdown and update `last_generated_at`

**P1.R5 — AI synthesis output.**
Claude produces a markdown document that synthesises the individual signals into a cohesive analysis. The exact format and structure is determined by the prompt (to be defined in TRD), but the output should go beyond simple grouping — it should identify patterns, recurring themes, cross-client commonalities, and strategic takeaways.

**P1.R6 — Staleness indicator.**
If there are sessions with `structured_notes` that were created or updated after `last_generated_at`, show a visible indicator:
- Text: "Master signal may be out of date — X new/updated session(s) since last generation."
- Positioned near the Generate button to encourage re-generation

**P1.R7 — Display the master signal.**
The generated master signal is rendered as styled markdown on the page (reuse the existing markdown rendering approach with `react-markdown` + `remark-gfm` + prose styling). If no master signal has been generated yet, show an empty state prompting the user to generate one.

**P1.R8 — Download as PDF.**
A "Download PDF" button that exports the current master signal markdown as a downloadable PDF file. Only enabled when a master signal exists.

**P1.R9 — Loading and progress state.**
While generating (API call to Claude in progress), show a loading indicator on the Generate button. Disable the button during generation to prevent double-clicks.

**P1.R10 — Tab navigation update.**
Add "Signals" to the tab navigation bar alongside "Capture."

**P1.R11 — Empty state.**
If no sessions have structured notes at all, show: "No extracted signals found. Extract signals from individual sessions on the Capture page first."

**P1.R12 — Error handling.**
If Claude fails (timeout, rate limit, malformed response), show a user-friendly error toast. The previous master signal (if any) remains untouched — failed generation never overwrites a good previous result.

### Acceptance Criteria

- [ ] `/signals` page exists and is accessible from the tab navigation
- [ ] "Generate Master Signal" button triggers AI synthesis via a server-side API route
- [ ] First generation processes all sessions with structured notes
- [ ] Incremental generation only processes new/updated sessions since last generation
- [ ] Generated master signal is persisted (survives page refresh)
- [ ] Staleness indicator shows when new sessions exist since last generation, including the count
- [ ] Master signal renders as styled markdown on the page
- [ ] "Download PDF" exports the master signal as a PDF file
- [ ] Loading state shown during generation; button disabled to prevent double-clicks
- [ ] Empty state shown when no structured notes exist across any session
- [ ] Failed generation does not overwrite the previous master signal
- [ ] Error toast shown on AI failure with user-friendly message

---

## Backlog

- Filters: add optional client and date range filters so users can generate a master signal for a subset of sessions
- Generation history: keep previous versions of the master signal so users can view or compare past generations
- Diff between generations: highlight what changed between the current and previous master signal (new themes, resolved signals, shifted sentiment)
- Client profile cards: per-client summary cards showing their signal distribution, sentiment trend, and key themes
- Export as docx: additional export format alongside PDF
- Cross-client theme detection: automatically identify when 3+ clients raise the same concern and surface it as a top-level insight
- Signal strength scoring: weight signals by recency, urgency, and client value
- Roadmap gap analysis: map signals to product roadmap items and highlight uncovered areas
- Scheduled auto-generation: generate the master signal on a schedule (weekly) and notify the team via Slack
- Feature-advisor integration: wire the feature-advisor agent to query the master signal directly
