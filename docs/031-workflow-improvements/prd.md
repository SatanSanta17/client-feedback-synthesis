# PRD-031: Workflow Improvements

> **Status:** Draft
> **Depends on:** PRD-018 (Structured Output — implemented, established `structured_json` as the primary extraction surface and made `structured_notes` markdown a derived backward-compat column), PRD-019 (Vector Search — implemented, the embedding pipeline that consumes the structured output), PRD-020 (RAG Chat — implemented, owns the chat token budget, output cap, step count, and system prompt this PRD tunes), PRD-021 (Insights Dashboard — implemented, consumes chunk-type breakdowns that this PRD extends with `positive_signal`)
> **Deliverable:** Three independent quality-of-life improvements to the capture → embedding → chat workflow that remove dead weight, close a real content gap in extraction, and make chat answers feel complete instead of clipped. None of the parts changes the user's mental model of the product; each one removes a small daily friction.

## Purpose

The capture → embedding → chat pipeline shipped through PRDs 018 → 019 → 020 → 021 works, but three rough edges show up in everyday use:

1. **Markdown extraction is dead weight.** Every extraction call asks the LLM to produce — and we then store — a markdown rendering of the same structured signals we already have in `structured_json`. PRD-018 kept `structured_notes` for backward compatibility while the JSON path matured. The JSON path is now the only path the UI, embeddings, themes, dashboard, and chat consume; the markdown column is consumed by exactly one retired surface (the master-signal backend). Continuing to write it on every extraction burns LLM tokens and storage for no user-visible value.

2. **Positive client signals have nowhere to live.** The current schema has buckets for pain points, requirements, aspirations, blockers, competitive mentions, and tools — every one of which is either negative-leaning or neutral. When a client says "your onboarding flow is genuinely the best I've used" or "the team turnaround on bug fixes has been a major reason we stayed," the LLM either drops it, awkwardly classifies it as an "aspiration achieved," or buries it in the session summary. Positive signal is product-strategically the most valuable kind of feedback (renewal predictor, sales asset, retention proof), and the product can't surface it because the data shape can't carry it. Compounding this, the structured signal view on the capture page renders every section even when empty, padding the screen with "No signals identified." rows that tell the user nothing.

3. **Chat answers feel clipped.** Users routinely ask broad questions ("summarise everything I know about Acme", "what are the top complaints across all clients") and get responses that visibly stop mid-list. The conversation-history token budget (80K) is generous and not the bottleneck; the response cap (4,096 tokens), the tool-step ceiling (5), and a system prompt that biases toward brevity are. Across a normal session, multiple chats hit each of those three independently.

This PRD treats all three as workflow polish, not new features. The work is split into three small parts, each independently shippable.

## User Story

As a user of Synthesiser — a sales lead, founder, CS manager, or PM — I want extraction to spend its tokens on the structured data I actually use, I want the product to make space for the positive things clients say (not just the problems), I want the capture page to show me what the LLM found rather than long lists of empty sections, and I want chat answers to be as long as the question warrants — so that the workflow gets quieter and more useful in proportion to how often I use it.

---

## Part 1: Drop Markdown Extraction

**Scope:** Stop generating and persisting the markdown rendering (`structured_notes`) on session create and re-extraction. The `structured_json` column remains the single source of truth for extraction output. The capture-page UI already renders from JSON via `StructuredSignalView`. Backward compatibility for any surface that historically read `structured_notes` must be preserved without re-introducing markdown generation in the request path.

### Requirements

**P1.R1 — Markdown is no longer generated at extraction time.** New session creates and re-extractions must not emit a markdown rendering as part of the LLM call or as a post-processing step. Extraction returns `structured_json` only; nothing in the user-perceived flow depends on the markdown output existing.

**P1.R2 — Markdown is no longer persisted at extraction time.** New session creates and re-extractions must not write a value to `structured_notes`. For sessions inserted after this part ships, the column is left at its existing default.

**P1.R3 — Existing markdown data is preserved.** Sessions that were captured before this change still have `structured_notes` populated and must continue to read that value when needed for legacy surfaces. This part does not migrate or delete existing rows.

**P1.R4 — Surfaces that previously consumed markdown must not break.** The master-signal backend, any internal admin paths, or any future re-entry points that historically read `structured_notes` must continue to function. Where the markdown is genuinely needed (and only there), it must be derived from `structured_json` on demand at the point of use — not regenerated by the LLM and not pre-persisted. Surfaces that can equally consume `structured_json` directly should do so without an intermediate markdown step.

**P1.R5 — The user-perceived extraction flow is unchanged.** The capture page renders the same structured view, the same time-to-first-render, and the same edit affordances. The user must not be able to tell that the markdown step is gone.

**P1.R6 — Extraction prompt cleanup.** The system prompt and user message template used for extraction must be reviewed for any clauses that exist solely to shape the markdown output (formatting instructions, section headers, prose voice). Removing them must not change the JSON shape or quality. This is a simplification, not a re-prompt: the goal is fewer instructions for the LLM to honour, not different ones.

### Acceptance criteria

- [ ] New session create stores `structured_json` and does not write `structured_notes` (the column is left untouched for new rows).
- [ ] Session re-extraction (PUT) replaces `structured_json` and clears `structured_notes` to null. Legacy markdown is dropped on re-extract because JSON is the unambiguous source of truth post-extraction; the master-signal backend renders markdown on demand for any surface that still needs it.
- [ ] The capture page, past sessions list, drill-down dialogs, and dashboard widgets render identically before and after this part for a session captured under this part.
- [ ] Pre-existing sessions (captured before this part) still display correctly on every surface that previously rendered them.
- [ ] The master-signal backend (and any other legacy consumer of `structured_notes`) functions correctly for both pre- and post-change sessions.
- [ ] The extraction LLM call no longer requests, accepts, or post-processes a markdown field; tokens spent per extraction visibly drop.
- [ ] No regression in extraction success rate, structured-signal quality, or downstream embedding/theme/insight chains.

---

## Part 2: Positive Signal Chunk Type and Hide-Empty Sections

**Scope:** Two coordinated changes to the structured extraction surface — one extends the data shape, the other tightens the rendering. First, introduce a new `positive_signal` chunk type that captures praise, wins, retention drivers, and other clearly-positive client statements. Second, on the capture page (and any other surface that renders the structured view), hide signal sections that have zero entries instead of showing the "No signals identified." empty state for every untouched section.

The decision to limit chunk-type expansion to `positive_signal` only — rather than also adding `success_story`, `objection`, `risk`, `next_step`, etc. in the same pass — is deliberate. Each new chunk type adds classification ambiguity for the LLM ("is this a win or an aspiration achieved?"), and the only category with zero overlap against the existing buckets is positive signal. Further expansion is parked in the backlog until a real product surface needs the additional dimension.

### Requirements

**P2.R1 — `positive_signal` chunk type exists end-to-end.** The extraction schema defines `positive_signal` as a first-class category alongside the existing nine chunk types. The category accepts the same shape as the other narrative signal categories (a list of items with text, optional client quote, and severity-equivalent intensity field if appropriate — final shape decided in TRD).

**P2.R2 — The extraction prompt elicits positive signals.** The system prompt instructs the LLM to identify clearly-positive client statements (praise, wins, retention drivers, things the client says are working well) and place them in `positive_signal`, with explicit guidance that distinguishes positive signal from aspirations (a positive signal is something the client is *experiencing now and likes*; an aspiration is something they *want next*). The prompt must include a worked example in each direction so the boundary is unambiguous.

**P2.R3 — Positive signals flow through the embedding pipeline.** Each `positive_signal` item becomes its own embedding chunk with `chunk_type = "positive_signal"`, the same base metadata (client name, session date) every other chunk gets, and any item-specific metadata fields (quote, intensity) added to the JSONB metadata column.

**P2.R4 — Positive signals flow through the theme assignment pipeline.** Theme assignment must classify positive-signal chunks the same way it classifies other narrative chunks. No theme-side schema changes are required if the existing assignment shape is generic across chunk types; if any branch-on-chunk-type logic exists, it must include `positive_signal`.

**P2.R5 — Positive signals are surfaced in the structured view UI.** The capture page renders a "Positive Signals" section (label and ordering decided in TRD) using the same visual pattern as the other signal lists — list items, optional quotes, optional intensity badge — so the surface feels native, not bolted on.

**P2.R6 — Empty signal sections are hidden, not shown with a zero-state row.** On the structured signal view, sections that have zero entries must not render at all — no "No signals identified." placeholder, no empty header. This applies uniformly to all narrative signal categories (pain points, requirements, aspirations, positive signals, blockers, competitive mentions, tools and platforms, custom). Always-rendered sections (session summary, sentiment, urgency, decision timeline, client profile) are unaffected — they render even when fields are null using the existing "Not mentioned" treatment.

**P2.R7 — Drill-down and dashboard surfaces include positive signals.** Wherever the dashboard, drill-down panel, or chat citation dialog enumerates chunk types or surfaces signals (e.g., chunk-type breakdown tooltips on the top-themes widget), the new `positive_signal` type must appear with a human-readable label, a visual treatment that reads as positive (e.g., success-themed colour token), and the same drill-down/cross-filter affordances as the other narrative chunk types.

**P2.R8 — Existing sessions are not retroactively re-extracted.** Sessions captured before this part will have no `positive_signal` entries. They render as if the positive-signal section is empty, which (per P2.R6) means it is hidden. Bulk re-extraction (PRD-017) remains the user's tool to enrich legacy sessions when desired.

**P2.R9 — Top Wins dashboard widget.** The dashboard surfaces a "Top Wins" widget alongside the existing Top Themes widget, ranking the topics that clients most often praise — i.e. the themes with the most `positive_signal` contributions for the current workspace. The widget mirrors the Top Themes widget's visual pattern (horizontal bar chart, click-to-drill-down, response to the global filter bar — clients, date range, severity, urgency, confidenceMin) but with success-themed colouring so the user can read it as wins at a glance. Drill-down into a bar opens the existing drill-down panel showing the actual positive-signal text and client context for that theme. The widget hides itself entirely when no positive-signal data exists in the workspace (consistent with the hide-empty intent of P2.R6), so the dashboard does not show an empty "no wins yet" placeholder before extractions begin producing positives. This is the minimum-viable surfacing of the new category at the top level — fancier variants (wins trend over time, wins-by-client scatter, intensity-weighted ranking) are deferred to the backlog until enough real-workspace data exists to validate the right cuts.

### Acceptance criteria

- [ ] `positive_signal` is a recognised chunk type in the extraction schema, the embeddings pipeline, the theme assignment pipeline, and the rendering surface.
- [ ] The extraction prompt produces positive signals when the raw notes contain clearly-positive client statements, and produces empty `positive_signal` arrays when they don't.
- [ ] Captured positive signals are embedded, themed, and retrievable via chat (`searchInsights`) and dashboard drill-down identically to other chunks.
- [ ] On the capture page, sections with zero entries do not render. Sections with entries render unchanged.
- [ ] On dashboard surfaces that enumerate chunk types (chunk-type breakdown tooltips, theme matrix legend, etc.), `positive_signal` appears with a human-readable label and a visual treatment that reads as positive.
- [ ] The Top Wins widget renders on the dashboard whenever the workspace has any `positive_signal` data, sits alongside Top Themes, responds to the global filter bar, and supports drill-down identically to Top Themes. It is hidden entirely when the workspace has no positive-signal data.
- [ ] No regression in extraction success rate or LLM bucket-accuracy on the existing nine chunk types — the new category does not pull signals out of categories where they previously belonged.
- [ ] A worked example session containing a clear positive client statement, a clear pain point, and a clear aspiration produces one entry in each correct bucket — no cross-contamination.

---

## Part 3: Looser Chat Response Limits

**Scope:** Three small, independent tunings to the RAG chat surface that, together, give answers room to be as long as the question warrants without changing how the user interacts with chat in any other way. None of these is a feature; each is a knob set to a value that fits how the product is now used.

### Requirements

**P3.R1 — Chat response output cap raised.** The maximum response length the LLM may emit per chat turn is increased from the current cap (4,096 tokens) to 8,192 tokens. This is the single highest-impact change and is the primary cause of the "answer ran out mid-list" complaint.

**P3.R2 — Tool-call step ceiling raised.** The maximum number of tool-call rounds the LLM may take inside a single chat turn before it must finalise the answer is raised from 5 to 10. This unblocks hybrid questions (e.g., "which clients mention pricing AND how many sessions does each have") that legitimately need multiple rounds of `searchInsights` and `queryDatabase` calls plus a composing pass.

**P3.R3 — System prompt softened on brevity.** The chat system prompt's brevity bias must be loosened so that list-style questions can return complete lists. The "Be concise" instruction is replaced with guidance that distinguishes (a) genuinely conversational answers (where brevity is right) from (b) list-style and synthesis answers (where completeness within the budget is right). The existing rule that already says "List ALL items the tool returns. Never silently omit entries." stays, and is reinforced — the new wording must not contradict it. The change is a softening of one clause, not a rewrite of the prompt.

**P3.R4 — Conversation history budget unchanged.** The 80K-token conversation-history budget (`DEFAULT_TOKEN_BUDGET`) is left as-is. The bottleneck on response length is the output cap, not the input window; raising the input budget would not affect the user-visible problem and would increase per-turn cost for no gain. If production logs ever show "budget reached at N messages" during real conversations, that becomes a separate backlog item.

**P3.R5 — Provider compatibility verified.** The new output cap of 8,192 must be a value all configured providers (Anthropic, OpenAI, Google) accept on the currently selected models. If any provider/model combination supported by the env-var configuration has a lower hard limit, the value used at runtime must clamp to the provider's actual maximum and log a warning — not fail the chat turn.

**P3.R6 — Telemetry on output usage.** The completion's actual token usage (output tokens emitted, finish reason — `stop` vs `length` vs `tool_calls` vs `error`) must be logged for every chat turn so the team can see, after a week of usage, how often the new 8,192 cap is *itself* being hit. If the new cap is also frequently hit, that is the signal to revisit the value (or the prompt) — not to keep raising it blindly.

### Acceptance criteria

- [ ] The output cap used by the chat streaming call is 8,192 tokens (or the provider/model maximum, whichever is lower, with a warning logged when clamped).
- [ ] The tool-step ceiling used by the chat streaming call is 10.
- [ ] The chat system prompt no longer contains an unqualified "be concise" instruction; the replacement guidance handles list-style and conversational answers differently and does not contradict the existing "List ALL items the tool returns" rule.
- [ ] The conversation-history token budget is unchanged.
- [ ] Per-turn token usage and finish reason are logged for every chat completion.
- [ ] In manual verification, a representative broad question ("summarise everything I know about Acme", "what are the top complaints across all clients") returns a substantively longer, fully-resolved answer compared to before this part — without a visible mid-list truncation and without finishing on `length`.
- [ ] No regression in chat latency-to-first-token or first-tool-call latency that is attributable to this part (budget changes do not affect these, but verify before close-out).

---

## Backlog

The following are explicitly out of scope for PRD-031 and parked for later if a real product surface needs them:

- **Further chunk-type expansion** — `success_story` (multi-signal narrative arcs), `objection` (sales-style objections distinct from blockers), `risk` (forward-looking concern distinct from current pain), `next_step` / `commitment` (action items, follow-throughs), `decision_criteria`, `stakeholder` (who said what), `usage_pattern`. Each requires its own bucket-clarity argument and a UI surface that uses the data; defer until that surface exists.
- **Hard-deleting the `structured_notes` column** — this PRD stops *writing* the column but does not drop it. A separate cleanup PRD should drop the column once the master-signal backend is either retired or migrated to render markdown on demand from `structured_json`.
- **Raising the conversation-history token budget** — only if production logs show real conversations hitting the 80K cap.
- **Per-conversation or per-user output-cap overrides** — e.g., a "give me a long answer" toggle. Only worth designing once the static 8,192 cap is shown to be insufficient for a real, recurring question pattern.
- **Re-extracting legacy sessions to populate `positive_signal`** — bulk re-extraction (PRD-017) already covers this on user demand. No automatic backfill.
- **Fancier variants of the Top Wins widget** — wins trend over time (multi-line chart), wins-by-client scatter, intensity-weighted ranking, "Recent Wins" qualitative quote stream. The minimum-viable Top Wins widget ships in P2.R9; these richer variants are deferred until enough real-workspace data exists to validate the right cuts.
