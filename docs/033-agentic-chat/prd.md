# PRD-033: Agentic Chat — Primitive Tool Surface

> **Status:** Draft
> **Depends on:** PRD-019 (Vector Search — implemented), PRD-020 (RAG Chat — implemented), PRD-021 (Insights Dashboard — implemented), PRD-031 Part 3 (Looser Chat Response Limits — implemented)
> **Deliverable:** Replaces today's two-tool chat surface (`searchInsights` + `queryDatabase` with a 13-action enum) with a small set of focused, composable tools the chat model chains together to answer any question. Closes the "summarise all sessions" gap, lowers cost on broad queries through a map-reduce summarisation tool, and removes the defensive filter-sanitisation layer that exists only because today's monolithic tool over-fills its schema. Lands the production-readiness pieces an agentic chat surface needs to be safely shippable: prompt caching for input-cost reduction, a per-turn cost circuit breaker against pathological chains, and a CI-gated eval set so the cutover is evidence-based.

## Purpose

Today's chat has two tools. `searchInsights` does vector retrieval. `queryDatabase` is a 13-action enum that dispatches to bespoke handlers. Every new question shape that doesn't fit those 13 actions either needs another action added (combinatorial growth) or simply can't be answered.

The most visible failure of this design is **aggregate questions**: "summarise all my sessions for Acme last quarter", "what changed in Q2 vs Q1", "give me a rundown of every pain point this month". Vector RAG returns top-k; it samples a biased subset and silently misses the rest of the corpus. None of the 13 quantitative actions return session content — they return counts and groupings. So "summarise everything" has no path to an honest answer today.

A second, quieter failure is filter hallucination. The chat tool exposes a single 8-field filter bag (date / client / severity / urgency / granularity / confidence / etc). The model treats it as a schema-fill exercise and invents defaults — `severity: "low"`, wide date ranges, empty arrays. The codebase compensates with a defensive layer that string-matches the user's last message for cues and drops filters the user didn't actually mention. That defensive layer is a symptom of a tool surface that mixes too many concerns.

This PRD replaces both tools with a set of focused **primitive tools** the model chains together. Each tool does one thing, with only the filters that thing actually needs. The chat model's job becomes orchestration — list, then fetch, then synthesise — instead of picking the one canned action that approximates the user's intent.

A focused **map-reduce summarisation tool** lets broad queries scale beyond what the chat model's context window can hold, and uses a cheaper model for the leaf summaries to keep costs in check on multi-session synthesis questions.

Three production-readiness pieces accompany the new surface. **Prompt caching** of the system prompt and tool descriptions (Anthropic `cache_control` / equivalent) cuts repeat input cost dramatically — system prompts and tool descriptions are large and stable, so this is essentially free money once enabled. A **per-turn cost circuit breaker** caps the total tool-result tokens accumulated within a single user turn, so a pathological query ("summarise everything across all clients all time") forces the model to synthesise from a bounded budget and tell the user to narrow rather than chaining indefinitely. A **golden eval set** of representative queries with expected tool trajectories and an LLM-as-judge scoring rubric is built alongside the new tools and gates the cutover — the old surface is not deleted until the new one demonstrably matches or exceeds it on the eval.

This is a **big-bang replacement** — when this PRD ships, the old `searchInsights` and `queryDatabase` tools are gone. The dashboard's direct use of the underlying query layer (which has its own action surface, separate from what the chat model sees) is unchanged.

## User Story

As a user of the chat tab, I want to ask broad, open-ended questions like "summarise everything Acme told us this quarter" or "what's changed in our top theme since last month" and get complete, grounded answers — not a top-5 sampling that pretends to be a summary, and not a polite refusal because the question doesn't match a pre-built action.

---

## Part 1: Primitive Tool Surface

**Scope:** Build the new chat tool surface as a set of focused, composable tools. Old surface remains active; new tools are not yet exposed to the chat model. This part exists so each tool can be specified, built, and verified in isolation before the cutover.

### Requirements

**P1.R1 — Discovery tools.** The chat surface includes tools for listing and discovering data without returning content:
- A tool to **list clients** with lightweight metadata (id, name, session count, last-session timestamp), filterable by name search and "has sessions".
- A tool to **list sessions** returning ids and lightweight metadata (id, client name, date, sentiment, urgency, theme names) — filterable by client, date range, theme, severity, sentiment. Returns ids and headers, not full content.
- A tool to **list themes** with mention counts, filterable by name search.

These tools answer "what exists?" without dumping content into the model's context.

**P1.R2 — Retrieval tools.** The chat surface includes three retrieval tools, each with a distinct purpose:
- A **semantic-search tool** (replaces today's `searchInsights`) — rephrase-friendly query string, returns ranked chunks with client/date/text/score. Filterable by client, date range, and chunk type.
- A **fetch-session-content tool** — takes a list of session ids and returns the full structured content (pain points, requirements, aspirations, positive signals, blockers, competitive mentions, etc.) for each. This is the new tool that closes the "summarise all sessions" gap. Capped at a maximum of N session ids per call (initial cap: 30) with explicit "got 30 of {total} requested" feedback in the response so the model can paginate or narrow.
- A **fetch-signals tool** — flat list of structured signal chunks across sessions matching filters (client, theme, chunk type, severity, urgency, date range). This is the path for "give me every pain point about pricing" — filter-driven, not similarity-driven.

**P1.R3 — Aggregation tools.** The chat surface includes two aggregation tools that subsume today's quantitative actions:
- An **aggregate tool** — takes an entity (sessions / signals / clients), an optional `groupBy` dimension (client / theme / sentiment / urgency / chunk type), and filters. Omitting `groupBy` returns a count.
- A **time-series tool** — takes an entity, a granularity (week / month), and filters. Returns time-bucketed counts.

Together these replace today's 13 quantitative actions (`count_clients`, `count_sessions`, `sessions_per_client`, `sentiment_distribution`, `urgency_distribution`, `recent_sessions`, `client_list`, `sessions_over_time`, `client_health_grid`, `competitive_mention_frequency`, `top_themes`, `theme_trends`, `theme_client_matrix`).

**P1.R4 — Insights passthrough tools.** The two existing insights actions (`insights_latest`, `insights_history`) become their own tools rather than being merged into aggregation, because their shape and pagination semantics don't fit the aggregate / time-series mould.

**P1.R5 — Per-tool filter contracts.** Each tool exposes only the filters that tool actually uses. There is no single shared filter bag. The semantic-search tool does not accept severity. The aggregate tool does not accept `chunkTypes` for entity = "clients". A filter that doesn't apply isn't on the schema, so the model cannot fill it.

**P1.R6 — Workspace scope is invisible to the model.** Every tool that touches workspace data is automatically scoped to the current team / personal workspace at the service layer. The model never names a `teamId` or `workspaceId`. RLS continues to be the structural backstop.

**P1.R7 — Tool results are model-friendly.** Every tool returns data in a shape the chat model can directly cite or reason over: arrays of plain objects, with names rather than UUIDs where the model would mention them in a response, ISO date strings, and explicit "no results" empty arrays (never `null` / undefined). No leaked SQL errors, no ORM artefacts, no internal column names that don't appear in the user-facing UI.

**P1.R8 — No new user-facing UI.** The chat tab's UI does not change in this part. Status messages emitted during tool calls update to reflect the new tool names (e.g. "Looking up clients…", "Fetching session content…"), but the conversation panel, citation chips, follow-ups, and starter questions are unchanged.

**P1.R9 — Eval harness foundation.** Alongside the new tool surface, an automated eval harness is established: a frozen test set of representative chat queries paired with the expected tool-call trajectory for each query, an LLM-as-judge scoring rubric for answer quality (factual correctness, groundedness, citation accuracy, list completeness), and an integration that lets the eval be run on demand against any tool / system-prompt change. Initial coverage: at least 15 queries spanning the four shapes today's surface handles — quantitative (count / distribution / time-series), qualitative (semantic search), discovery (list), and hybrid. This part runs the eval against both surfaces (old and new) so the new surface can be measured against the old one's baseline before the Part 3 cutover gate fires.

### Acceptance Criteria

- [ ] P1.AC1 — Each new tool exists and can be invoked directly with valid inputs to return correct results
- [ ] P1.AC2 — `list_sessions` returns lightweight metadata only (no `parsed_content`, no `structured_json`)
- [ ] P1.AC3 — `fetch_session_content` returns structured content for the requested ids and reports "got N of M requested" when input exceeds the per-call cap
- [ ] P1.AC4 — `aggregate` with no `groupBy` returns a count; with a `groupBy` returns a ranked or labelled distribution; matches today's `queryDatabase` results for the same filters across all 13 retired actions
- [ ] P1.AC5 — `time_series` returns the same shape as today's `sessions_over_time` and `theme_trends` for equivalent inputs
- [ ] P1.AC6 — Each tool's filter schema contains only fields that tool uses; no shared 8-field filter bag
- [ ] P1.AC7 — Workspace scoping is enforced at the service layer; the tool inputs do not include any `teamId` field
- [ ] P1.AC8 — Tool result shapes are JSON-serialisable, name-resolved (clients/themes by name, not UUID), date-string normalised, and use `[]` for empty results
- [ ] P1.AC9 — The old `searchInsights` and `queryDatabase` tools remain wired to the chat model and unchanged in behaviour at the end of this part
- [ ] P1.AC10 — The eval harness exists, contains at least 15 queries across the four shape categories, runs end-to-end against the old surface (establishing baseline pass rate) and the new surface (measuring parity), and produces a per-query report with judge scores

---

## Part 2: Map-Reduce Summarisation Tool

**Scope:** A composition tool that lets the chat model summarise N sessions without holding all N in its own context, by fanning out per-session summaries to a cheaper model and returning the digest array to the chat model.

### Requirements

**P2.R1 — Summarise-sessions tool.** The chat surface gains a tool that takes a list of session ids and an optional `focus` string, and returns one short summary per session — formatted as `[{ sessionId, clientName, date, summary }, ...]`. Each summary is independently produced; ordering matches input.

**P2.R2 — Cheaper model for the map step.** The summary-per-session step uses a configurable, cheaper model than the chat model — provider and model name come from environment variables independent of the chat-model env vars (mirroring how transcription has its own provider config in PRD-032 Part 2). The chat model is never used for the map step; the cheaper model is never used for the reduce.

**P2.R3 — Focus-scoped summaries.** When the chat model passes a `focus` string ("pricing complaints", "feature requests"), each per-session summary is scoped to that topic — the summarisation prompt explicitly instructs the cheap model to extract only content relevant to the focus and to return a single sentence noting "no content matches focus" if the session is irrelevant. With no focus, the summary is a balanced 3-sentence digest.

**P2.R4 — Bounded fan-out.** The tool caps the number of session ids per call (initial cap: 50) with explicit "summarised 50 of {total} requested" feedback so the model can paginate. The cap is independent of, and may be larger than, the `fetch_session_content` cap because each session's content stays in the cheap model's context, not the chat model's.

**P2.R5 — Parallel execution with bounded concurrency.** Per-session summaries run in parallel, capped at a small concurrency limit (initial: 5), to avoid swamping the cheap model's rate limits. Sessions that fail their individual summary do not abort the batch — they are returned with `summary: null` and an explicit `error` field, so the chat model can mention partial coverage in its reply.

**P2.R6 — Status events for user-perceived latency.** Because a 50-session call may take 5–10 seconds even with concurrency, the tool emits a status event to the chat stream when it starts ("Summarising N sessions…") and updates progress as batches complete. The user sees the chat tab is working, not stuck.

**P2.R7 — No content retention.** Per-session summaries returned by the cheap model are passed through to the chat model and not persisted anywhere. Audit logging captures input and output token counts per call (consistent with existing chat telemetry) but not the summary content itself.

**P2.R8 — No new user-facing UI.** As with Part 1, no chat UI changes. The new status events use the existing status-event pipeline.

**P2.R9 — Eval coverage for summarisation.** The eval set established in Part 1 is extended with at least 10 new queries that exercise the new capability: focus-scoped summaries, broad-fan-out summaries (>30 sessions), partial-failure tolerance (sessions whose individual summary fails), pagination across the per-call cap, and the canonical "summarise everything for client X" query that motivated this PRD. These queries cannot be answered correctly by the old surface; their pass rate on the new surface is reported separately so the new capability is evidence-tracked, not just claimed.

### Acceptance Criteria

- [ ] P2.AC1 — A `summarise_sessions` tool exists and returns one summary per session id in the input order
- [ ] P2.AC2 — The map step uses a separately-configured cheaper model (env-controlled), independent of the chat model's provider/model
- [ ] P2.AC3 — Summaries scoped by `focus` exclude unrelated content and explicitly mark sessions with no matching content
- [ ] P2.AC4 — Calls exceeding the per-call cap return the capped count plus a "summarised N of M requested" indicator
- [ ] P2.AC5 — A failure on one session returns a per-row error without aborting the batch
- [ ] P2.AC6 — The user sees a "Summarising N sessions…" status while the tool is running
- [ ] P2.AC7 — Per-call telemetry logs input / output / total tokens for the cheap model, separately from chat-model telemetry
- [ ] P2.AC8 — Summaries are not written to any persistent store
- [ ] P2.AC9 — The eval set contains at least 10 summarisation-specific queries covering focus, fan-out, partial failure, pagination, and the gap-closer query — and the new surface's pass rate on these is tracked separately

---

## Part 3: Cutover and Ripout

**Scope:** Switch the chat model to the new tool surface. Delete the old tools and the defensive scaffolding around them. No A/B, no flag, no parallel runtime.

### Requirements

**P3.R1 — System prompt v2.** The chat system prompt is rewritten to instruct the model on the new tool surface. It explains each tool's purpose, when to chain them (list → fetch → synthesise; list → summarise → synthesise), and when to prefer summarise-sessions over fetch-session-content (rule of thumb: when N > ~10). It retains the existing rules on grounding, citations, internal-detail non-disclosure, list-completeness, and follow-ups.

**P3.R2 — Old tools removed.** The `searchInsights` and `queryDatabase` tool builders are removed from the chat stream service. The defensive filter-sanitisation layer (cue-matching against the user's last message to drop hallucinated filters) is removed in the same change — the new per-tool filter schemas make it unnecessary.

**P3.R3 — Chat-tool action registry retired.** The `CHAT_TOOL_ACTIONS` tuple, the `buildChatToolDescription()` helper, and the dev-time `assertChatToolActionsInSync()` check that exists only to keep the chat tool's enum in sync with the dashboard registry are deleted. The dashboard's own use of the underlying query layer (its own action surface) is unaffected.

**P3.R4 — End-to-end coverage on the new surface.** Every question shape that worked on the old surface continues to work on the new surface, and the previously unanswerable shape works:
- Quantitative: "How many sessions do we have?" / "How many high-severity sessions?" / "Top themes this month"
- Qualitative: "What are clients saying about onboarding?" / "Which clients mentioned pricing?"
- Hybrid: "Top 3 themes and what each one represents"
- Aggregate / synthesis (the gap): "Summarise everything Acme said this quarter" / "What changed in our top theme between Q1 and Q2"
- Conversational: follow-ups, clarifications, history-only answers

**P3.R5 — No regression in citation rendering.** Citations continue to surface client name and session date for qualitative chunks the model cited (from the new semantic-search and fetch-session-content tools). The citation chips and preview dialog work unchanged.

**P3.R6 — No regression on cancellation, truncation, and step-cap warnings.** Existing UX for client-side abort, length-truncation warning ("this answer was cut off"), and step-cap warning ("I reached my reasoning step limit") all continue to work.

**P3.R7 — Step cap raised if needed.** Because broad queries become 2–4 tool calls instead of 1, the step ceiling (`stepCountIs(10)` today) is reviewed and raised only if a representative test set hits the cap on plausible queries. Default: leave unchanged unless evidence shows otherwise.

**P3.R8 — Starter questions updated.** The four hardcoded starter questions are reviewed and at least one is changed to demonstrate a question the old surface couldn't answer (e.g. a "summarise everything" prompt), so users discover the new capability.

**P3.R9 — Prompt caching.** The chat system prompt and tool descriptions are cached at the model-call layer using the configured provider's cache mechanism (Anthropic `cache_control` markers; equivalent for other providers, with a no-op fallback when the active provider doesn't support caching). Per-turn telemetry logs cache-hit-input vs cache-miss-input token counts so the savings are observable. Target: a measurable input-cost reduction on every turn after the first within a conversation; specifically, cache-hit tokens become the majority of input tokens once the conversation is past its first turn.

**P3.R10 — Per-turn cost circuit breaker.** The chat stream tracks the cumulative tool-result tokens introduced into the model's context within a single user turn. When the per-turn budget is exceeded (initial budget: 200,000 tool-result input tokens; configurable via env var), no further tool calls are accepted; a system-level message is injected telling the model "you have hit the per-turn budget — synthesise an answer with what you already have, and explicitly tell the user the query was too broad and suggest narrowing by client or date range". The user-facing response surfaces this narrowing suggestion in plain language, never an internal error. The hit is logged with telemetry indicating which tools and how many calls preceded the breaker.

**P3.R11 — Eval set as the cutover gate.** The cutover (deletion of the old tools) is gated by the eval results. Before the ripout commit lands, the new surface must score at least the configured pass-rate threshold (initial target: ≥ 90% of the Part 1 baseline-coverage queries judged "correct or better" by the LLM-as-judge rubric, AND zero regressions on queries the old surface answered correctly). The eval results are reviewed and the pass is documented in the cutover commit / PR description. If the threshold is not met, the cutover is deferred — the old surface stays wired and the gap is fixed, eval re-run, then re-gated.

### Acceptance Criteria

- [ ] P3.AC1 — The chat system prompt instructs the model on the new tool surface and is the only chat system prompt in the codebase
- [ ] P3.AC2 — `searchInsights`, `queryDatabase`, the cue-matching filter sanitiser, `CHAT_TOOL_ACTIONS`, `buildChatToolDescription()`, and `assertChatToolActionsInSync()` are gone
- [ ] P3.AC3 — A representative test pass covers every query shape listed in P3.R4 and produces grounded, citation-correct answers
- [ ] P3.AC4 — The "summarise everything for client X" query produces a complete, multi-session synthesis instead of a top-k sampling
- [ ] P3.AC5 — The starter-questions row reflects the new capability surface
- [ ] P3.AC6 — Cost on the broad-summary test query is measurably lower (target: ≥ 30% reduction at 30+ sessions) than a hypothetical premium-only `fetch_session_content` path
- [ ] P3.AC7 — `npx tsc --noEmit` passes
- [ ] P3.AC8 — Existing chat features (citations, follow-ups, in-conversation search, archive, conversation rename / pin / archive / delete) are unchanged
- [ ] P3.AC9 — Prompt caching is enabled for the active provider with a no-op fallback for unsupported providers; per-turn telemetry shows cache-hit-input as the majority of input tokens on turns 2+ within a conversation
- [ ] P3.AC10 — A pathological broad query trips the per-turn cost circuit breaker, the model produces a synthesised partial answer, and the user-facing response includes a "too broad — try narrowing" suggestion in plain language
- [ ] P3.AC11 — The eval results meet the configured threshold (≥ 90% pass with zero regressions vs. the old-surface baseline) and are documented in the cutover PR description before the old tools are deleted

---

## Backlog

- **Tool-call tracing UI.** A debug panel (admin-only or dev-only) that shows the model's tool-call sequence for a turn, so we can audit whether the model is chaining tools efficiently.
- **Per-tool latency telemetry.** Log entry / exit / duration for each tool call separately, surfaced in a dashboard, so we can spot slow tools and optimise the right ones.
- **Adaptive fetch-session-content cap.** Replace the static 30-session cap with a token-budget cap (e.g. "fetch until ~50k tokens") so smaller sessions fill more slots and larger ones fewer.
- **Chat-side caching of `list_*` results.** A list of clients rarely changes within a single conversation. Cache discovery-tool results per conversation turn so chained calls don't re-query.
- **Cross-session diff tool.** A first-class "compare A vs B" tool that takes two filter sets and returns aligned summaries — currently the chat model has to do this by chaining two summarise calls.
- **User-controllable summarisation depth.** Surface a per-conversation setting ("brief / detailed / verbatim") that the chat model passes through to summarise-sessions, instead of the model picking depth implicitly.
- **Streaming the map step.** Stream per-session summaries as they complete (instead of waiting for the full batch) so the chat model can start writing its synthesis sooner.
- **Tool-result memoisation across turns.** Recognise that "what changed since I last asked" benefits from comparing against a previous turn's tool results; persist the most recent result per tool per conversation for quick deltas.
- **User-editable system prompt for chat.** Lift the chat system prompt out of source control and into the per-team prompt editor (mirroring extraction prompts), so power users can tune chat behaviour without a code change.
- **Semantic caching of repeated user queries.** A second-layer cache (Portkey / Helicone / homegrown) that recognises semantically-equivalent user prompts within a workspace and serves the prior answer directly, skipping the model entirely. Saves recurring "what did Acme say last week" lookups but needs careful invalidation when underlying data changes.
- **Adaptive per-turn cost budget.** Replace the static 200k-token circuit breaker with a budget that scales with query intent — broader queries get a larger budget up to a hard ceiling, narrow queries are capped tighter. Avoids the false-positive case where a legitimately broad query is artificially squeezed.
- **Trajectory-matching CI block.** Promote the eval from "manually run before cutover" to a CI gate that blocks merges when tool-call trajectories regress against the golden set — turn the Part 3 manual gate into a permanent quality bar for chat changes.
- **Graph-based agent orchestration.** If tool count grows past ~15 or chained-call workflows become consistently buggy, revisit whether to migrate from ReAct + `streamText` to an explicit state-machine library (LangGraph or OpenAI Agents SDK). Premature today.
- **LLM-as-judge model upgrade path.** Today's eval uses a single judge model. Add multi-judge agreement (or a stronger model than the chat model as judge) once eval volume justifies the cost.
