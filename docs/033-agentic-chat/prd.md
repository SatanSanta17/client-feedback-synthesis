# PRD-033: Agentic Chat — Primitive Tool Surface

> **Status:** Draft
> **Depends on:** PRD-019 (Vector Search — implemented), PRD-020 (RAG Chat — implemented), PRD-021 (Insights Dashboard — implemented), PRD-031 Part 3 (Looser Chat Response Limits — implemented)
> **Deliverable:** Replaces today's two-tool chat surface (`searchInsights` + `queryDatabase` with a 13-action enum) with a small set of focused, composable tools the chat model chains together to answer any question. Closes the "summarise all sessions" gap, lowers cost on broad queries through a map-reduce summarisation tool, and removes the defensive filter-sanitisation layer that exists only because today's monolithic tool over-fills its schema. Lands the production-readiness pieces an agentic chat surface needs to be safely shippable: prompt caching for input-cost reduction, a per-turn cost circuit breaker against pathological chains, and an eval-gated cutover so the switch to the new surface is evidence-based.

## Purpose

Today's chat has two tools. `searchInsights` does vector retrieval. `queryDatabase` is a 13-action enum that dispatches to bespoke handlers. Every new question shape that doesn't fit those 13 actions either needs another action added (combinatorial growth) or simply can't be answered.

The most visible failure of this design is **aggregate questions**: "summarise all my sessions for Acme last quarter", "what changed in Q2 vs Q1", "give me a rundown of every pain point this month". Vector RAG returns top-k; it samples a biased subset and silently misses the rest of the corpus. None of the 13 quantitative actions return session content — they return counts and groupings. So "summarise everything" has no path to an honest answer today.

A second, quieter failure is filter hallucination. The chat tool exposes a single 8-field filter bag (date / client / severity / urgency / granularity / confidence / etc). The model treats it as a schema-fill exercise and invents defaults — `severity: "low"`, wide date ranges, empty arrays. The codebase compensates with a defensive layer that string-matches the user's last message for cues and drops filters the user didn't actually mention. That defensive layer is a symptom of a tool surface that mixes too many concerns.

This PRD replaces both tools with a set of focused **primitive tools** the model chains together. Each tool does one thing, with only the filters that thing actually needs. The chat model's job becomes orchestration — list, then fetch, then synthesise — instead of picking the one canned action that approximates the user's intent.

A focused **map-reduce summarisation tool** lets broad queries scale beyond what the chat model's context window can hold, and uses a cheaper model for the leaf summaries to keep costs in check on multi-session synthesis questions.

Three production-readiness pieces accompany the new surface. **Prompt caching** of the system prompt and tool descriptions (Anthropic `cache_control` / equivalent) cuts repeat input cost dramatically — system prompts and tool descriptions are large and stable, so this is essentially free money once enabled. A **per-turn cost circuit breaker** caps the total tool-result tokens accumulated within a single user turn, so a pathological query ("summarise everything across all clients all time") forces the model to synthesise from a bounded budget and tell the user to narrow rather than chaining indefinitely. A **golden eval set** of representative queries with expected tool trajectories and an LLM-as-judge scoring rubric is built alongside the new tools and gates the cutover — the old surface is not deleted until the new one demonstrably matches or exceeds it on the eval.

This is a **single-surface replacement** — when this PRD ships, every team and personal workspace is on the new surface. The cutover is gated by the eval (Part 3 specifies the threshold). If a real-world regression surfaces post-cutover that the eval missed, the rollback lever is reverting the cutover commit, closing the gap in the eval, and re-cutting once the eval re-passes — there is no separate feature-flag system for this PRD. The dashboard's direct use of the underlying query layer (which has its own action surface, separate from what the chat model sees) is unchanged.

## User Story

As a user of the chat tab, I want to ask broad, open-ended questions like "summarise everything Acme told us this quarter" or "what's changed in our top theme since last month" and get complete, grounded answers — not a top-5 sampling that pretends to be a summary, and not a polite refusal because the question doesn't match a pre-built action.

---

## Part 1: Primitive Tool Surface

**Scope:** Build the new chat tool surface as a set of focused, composable tools. Old surface remains active; new tools are not yet exposed to the chat model. This part exists so each tool can be specified, built, and verified in isolation before the cutover.

### Requirements

**P1.R1 — Discovery tools.** The chat surface includes tools for listing and discovering data without returning content:
- A tool to **list clients** with lightweight metadata (id, name, session count, last-session timestamp), filterable by name search and "has sessions".
- A tool to **list sessions** returning ids and lightweight metadata (id, client name, date, sentiment, urgency, theme names) — filterable by client, date range, theme, severity, sentiment, urgency, chunk type. Returns ids and headers, not full content.
- A tool to **list themes** with mention counts, filterable by name search and date range (so "what themes were discussed this quarter" works without first listing sessions).

These tools answer "what exists?" without dumping content into the model's context.

**Filter semantics for `list_sessions`** (and any other tool that filters by a mix of session-level and signal-level fields): session-level fields (sentiment, date, client) filter the session row directly. Signal-level fields (severity, urgency, theme, chunk type) match a session if **at least one** of its signal chunks satisfies the filter — "high-severity sessions" returns every session that contains at least one high-severity chunk. Filter combinations are AND across the filter set, not "the same chunk satisfies all signal-level filters" — a session matches `severity=high AND theme=pricing` if it has any high-severity chunk **and** any pricing-themed chunk, even if those are different chunks.

**P1.R2 — Retrieval tools.** The chat surface includes three retrieval tools, each with a distinct purpose:
- A **semantic-search tool** (replaces today's `searchInsights`) — rephrase-friendly query string, returns ranked chunks with client/date/text/score. Filterable by client, date range, and chunk type. Retrieval is **hybrid**: a Postgres `tsvector` full-text search and the existing pgvector similarity search both produce top-N candidate sets, fused via reciprocal rank fusion (RRF) before the model sees the result. Pure-vector misses exact-term queries ("sessions mentioning Snowflake"); pure-keyword misses semantic paraphrase ("onboarding pain" ↔ "first-time setup is confusing"). Hybrid + RRF closes both gaps without introducing a paid reranker dependency. The RRF weighting and per-side top-N are configurable; the eval set (P1.R9) is the source of truth for tuning.
- A **fetch-session-content tool** — takes a list of session ids and returns the full content for each. "Full content" means **all 11 chunk types** (`summary`, `client_profile`, `pain_point`, `requirement`, `aspiration`, `positive_signal`, `competitive_mention`, `blocker`, `tool_and_platform`, `custom`, `raw`) plus session-level metadata (date, client name, themes, sentiment, urgency, raw notes) — there is no chunk-type filter on this tool. The model gets everything; the token budget protects cost; redundancy between `summary`/`raw` and the structured chunks is acceptable for the simplicity of "no filter to choose wrong". Capped by a **token budget** rather than a raw session count (initial budget: ~50,000 tokens of returned content per call, configurable via env var) so small sessions fill more slots and large sessions fewer. **Token counting** uses the active provider's tokenizer (`AI_PROVIDER` env var) where the SDK exposes one; otherwise a `chars/4` proxy is acceptable since the budget is approximate by design. The response reports "fetched N of M requested (token budget reached)" when the budget is exhausted before all ids are served, so the model can paginate or narrow.
- A **fetch-signals tool** — flat list of structured signal chunks across sessions matching filters (client, theme, chunk type, severity, urgency, date range). **Strictly schema-filtered — no query string.** This is the deliberate distinction from `semantic_search`: "every pain point about pricing" is a completeness question (`fetch_signals(theme=pricing, chunk_type=pain_point)` returns *all* matches), while "what are clients saying about onboarding?" is a similarity question (`semantic_search(query="onboarding")`). If the model wants similarity ranking, it uses `semantic_search`; if it wants exhaustive coverage of a tagged subset, it uses `fetch_signals`. The two tools must not overlap in capability.

**P1.R3 — Aggregation tools.** The chat surface includes two aggregation tools that subsume today's quantitative actions:
- An **aggregate tool** — takes an entity (sessions / signals / clients), an optional `groupBy` (single dimension or array of dimensions, drawn from: client / theme / sentiment / urgency / severity / chunk type), and filters. Omitting `groupBy` returns a count. With a single-dim `groupBy` the result is ranked by count desc by default. With a multi-dim `groupBy` (e.g. `[theme, client]`) the result is a flat array of `{ dimensions: { theme, client }, count }` rows that the model can pivot into a matrix in its response.
- A **time-series tool** — takes an entity, a granularity (week / month), an optional single-dim `groupBy`, and filters. Returns time-bucketed counts.

**Mapping from today's 13 quantitative actions to the new surface** (this table is the source of truth for P1.AC4 parity testing):

| Old action | New call |
|---|---|
| `count_clients` | `aggregate(entity=clients)` |
| `count_sessions` | `aggregate(entity=sessions)` |
| `sessions_per_client` | `aggregate(entity=sessions, groupBy=client)` |
| `sentiment_distribution` | `aggregate(entity=sessions, groupBy=sentiment)` |
| `urgency_distribution` | `aggregate(entity=signals, groupBy=urgency)` |
| `recent_sessions` | `list_sessions` (sorted by date desc — discovery, not aggregation) |
| `client_list` | `list_clients` (discovery, not aggregation) |
| `sessions_over_time` | `time_series(entity=sessions, granularity=week\|month)` |
| `client_health_grid` | `aggregate(entity=signals, groupBy=[client, severity])` |
| `competitive_mention_frequency` | `aggregate(entity=signals, filter chunk_type=competitive_mention, groupBy=client)` |
| `top_themes` | `aggregate(entity=signals, groupBy=theme)` (default sort handles "top") |
| `theme_trends` | `time_series(entity=signals, groupBy=theme, granularity=week\|month)` |
| `theme_client_matrix` | `aggregate(entity=signals, groupBy=[theme, client])` |

Two of the 13 (`recent_sessions`, `client_list`) are discovery shapes, not aggregations, so they map to Part 1 discovery tools rather than to `aggregate`. The remaining 11 all collapse into `aggregate` or `time_series`. Multi-dim `groupBy` is required to cover `client_health_grid` and `theme_client_matrix`; single-dim is sufficient for the other nine.

**P1.R4 — Insights passthrough tools.** The two existing insights actions (`insights_latest`, `insights_history`) become their own tools rather than being merged into aggregation, because their shape and pagination semantics don't fit the aggregate / time-series mould.

**P1.R5 — Per-tool filter contracts.** Each tool exposes only the filters that tool actually uses. There is no single shared filter bag. The semantic-search tool does not accept severity. The aggregate tool does not accept `chunkTypes` for entity = "clients". A filter that doesn't apply isn't on the schema, so the model cannot fill it.

**P1.R6 — Workspace scope is invisible to the model.** Every tool that touches workspace data is automatically scoped to the current team / personal workspace at the service layer. The model never names a `teamId` or `workspaceId`. RLS continues to be the structural backstop.

**P1.R7 — Tool results are model-friendly.** Every tool returns data in a shape the chat model can directly cite or reason over: arrays of plain objects, with names rather than UUIDs where the model would mention them in a response, ISO date strings, and explicit "no results" empty arrays (never `null` / undefined). No leaked SQL errors, no ORM artefacts, no internal column names that don't appear in the user-facing UI.

**P1.R8 — No new user-facing UI.** The chat tab's UI does not change in this part. Status messages emitted during tool calls update to reflect the new tool names (e.g. "Looking up clients…", "Fetching session content…"), but the conversation panel, citation chips, follow-ups, and starter questions are unchanged.

**P1.R9 — Eval harness foundation.** Alongside the new tool surface, an automated eval harness is established: a frozen test set of representative chat queries paired with the expected tool-call trajectory for each query, an LLM-as-judge scoring rubric for answer quality (factual correctness, groundedness, citation accuracy, list completeness), and an integration that lets the eval be run on demand against any tool / system-prompt change. The harness scores **two dimensions per query**, tracked separately:
- **Answer correctness** — judged by the LLM-as-judge rubric.
- **Tool-routing accuracy** — did the model pick the right tool / chain (e.g. "which clients exist?" should hit `list_clients`, not `aggregate(sessions, group_by=client)`). A query can be answered correctly via the wrong path; that still counts as a routing regression because it bloats cost, latency, and context. **Matching is by subsequence**: the expected tool calls must appear in the actual call sequence in order, but extra calls between them are allowed (the model is free to take exploratory side-trips like an extra `semantic_search` to clarify a query). Missing a required call, or executing them out of expected order, fails the routing check.

Initial coverage: at least 15 queries spanning the four shapes today's surface handles — quantitative (count / distribution / time-series), qualitative (semantic search), discovery (list), and hybrid — plus dedicated **exact-term queries** ("sessions mentioning Snowflake", "find the word 'churn' in any pain point") that validate the hybrid retrieval added in P1.R2 and would fail under pure-vector. This part runs the eval against both surfaces (old and new) so the new surface can be measured against the old one's baseline before the Part 3 cutover gate fires.

### Acceptance Criteria

- [ ] P1.AC1 — Each new tool exists and can be invoked directly with valid inputs to return correct results
- [ ] P1.AC2 — `list_sessions` returns lightweight metadata only (no `parsed_content`, no `structured_json`)
- [ ] P1.AC3 — `fetch_session_content` returns structured content sized by a token budget (not a raw session count) and reports "fetched N of M requested (token budget reached)" when the budget is exhausted before all ids are served
- [ ] P1.AC4 — `aggregate` with no `groupBy` returns a count; with a `groupBy` returns a ranked or labelled distribution; matches today's `queryDatabase` results for the same filters across all 13 retired actions
- [ ] P1.AC5 — `time_series` returns the same shape as today's `sessions_over_time` and `theme_trends` for equivalent inputs
- [ ] P1.AC6 — Each tool's filter schema contains only fields that tool uses; no shared 8-field filter bag
- [ ] P1.AC7 — Workspace scoping is enforced at the service layer; the tool inputs do not include any `teamId` field
- [ ] P1.AC8 — Tool result shapes are JSON-serialisable, name-resolved (clients/themes by name, not UUID), date-string normalised, and use `[]` for empty results
- [ ] P1.AC9 — The old `searchInsights` and `queryDatabase` tools remain wired to the chat model and unchanged in behaviour at the end of this part
- [ ] P1.AC10 — The eval harness exists, contains at least 15 queries across the four shape categories plus dedicated exact-term queries, runs end-to-end against the old surface (establishing baseline pass rate) and the new surface (measuring parity), and produces a per-query report with judge scores
- [ ] P1.AC11 — `semantic_search` performs hybrid retrieval (pgvector + Postgres `tsvector`, fused via RRF); exact-term queries return the matching chunks even when there is no semantic similarity to the query phrasing
- [ ] P1.AC12 — The eval harness reports tool-routing accuracy as a metric distinct from answer correctness; the per-query report distinguishes "right answer via wrong path" from "right answer via right path"

---

## Part 2: Map-Reduce Summarisation Tool

**Scope:** A composition tool that lets the chat model summarise N sessions without holding all N in its own context, by fanning out per-session summaries to a cheaper model and returning the digest array to the chat model.

### Requirements

**P2.R1 — Summarise-sessions tool.** The chat surface gains a tool that takes a list of session ids and an optional `focus` string, and returns one short summary per session — formatted as `[{ sessionId, clientName, date, summary }, ...]`. Each summary is independently produced; ordering matches input.

**P2.R2 — Cheaper model for the map step.** The summary-per-session step uses a configurable, cheaper model than the chat model — provider and model name come from environment variables independent of the chat-model env vars (mirroring how transcription has its own provider config in PRD-032 Part 2). The chat model is never used for the map step; the cheaper model is never used for the reduce.

**P2.R3 — Focus-scoped summaries.** When the chat model passes a `focus` string ("pricing complaints", "feature requests"), each per-session summary is scoped to that topic — the summarisation prompt explicitly instructs the cheap model to extract only content relevant to the focus and to return a single sentence noting "no content matches focus" if the session is irrelevant. With no focus, the summary is a balanced 3-sentence digest.

**P2.R4 — Bounded fan-out.** The tool caps the number of session ids per call (initial cap: 50) with explicit "summarised 50 of {total} requested" feedback so the model can paginate. This is a count cap, not a token-budget cap (unlike `fetch_session_content`), because each session's full content is held only in the cheap model's context one at a time — the chat model only ever sees the short per-session summaries, so the chat-side context pressure is small and predictable.

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

**Scope:** Switch the chat model to the new tool surface and delete the old tools and the defensive scaffolding around them in the same commit. The cutover is gated by the eval (P3.R11). If a real-world regression surfaces post-cutover that the eval missed, the cutover commit is reverted, the gap is closed in the eval, and the cutover is re-attempted before this PRD is closed.

### Requirements

**P3.R1 — System prompt v2.** The chat system prompt is rewritten to instruct the model on the new tool surface. It explains each tool's purpose, when to chain them (list → fetch → synthesise; list → summarise → synthesise), and when to prefer summarise-sessions over fetch-session-content (rule of thumb: when N > ~10). It also instructs the model on **agent-driven multi-query semantic search**: when the user's question is broad, ambiguous, or uses domain-specific terminology, the model issues 2–3 `semantic_search` calls with rephrased queries and synthesises across the union, rather than relying on a single phrasing. This is prompt-guided, not a hardcoded pre-rewriter pipeline — the model decides whether and how to fan out, consistent with the agentic philosophy of the rest of the surface. It retains the existing rules on grounding, citations, internal-detail non-disclosure, list-completeness, and follow-ups.

**P3.R2 — Old tools removed.** The `searchInsights` and `queryDatabase` tool builders are removed from the chat stream service in the cutover commit. The defensive filter-sanitisation layer (cue-matching against the user's last message to drop hallucinated filters) is removed in the same change — the new per-tool filter schemas make it unnecessary. There is no parallel-runtime commit; the cutover and the ripout are the same change.

> **Deviation (2026-05-11, post-cutover):** The per-tool Zod-schema-only defence held for Claude but not for GPT-4o, which invented categorical filter values and passed empty strings for every optional field. A **per-tool** filter sanitiser was re-introduced at [`lib/services/chat-tools/shared/filter-sanitiser.ts`](../../lib/services/chat-tools/shared/filter-sanitiser.ts). It is not the old monolithic layer — each tool's `execute()` calls its own sanitiser before invoking its service, so the boundary stays inside the tool's contract rather than wrapping the whole chat stream. See the CHANGELOG entry "PRD-033 post-cutover — re-introduce per-tool filter sanitisation" for the full rationale. The "retire cue matching" claim above should be read as "retire monolithic cue matching" in the current implementation.

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

**P3.R9 — Prompt caching.** The chat system prompt and tool descriptions are cached at the model-call layer using the configured provider's cache mechanism. The two providers Synthesiser uses in production today both have caching:
- **Anthropic** — explicit `cache_control: { type: "ephemeral" }` markers on the cached message blocks.
- **OpenAI** — automatic for any prompt ≥ 1024 tokens (no developer action needed); telemetry exposes the hit count via the SDK's normalised `usage` object.

**Google Gemini caching is deferred** — Google is not an active provider today. When it's added, three deferred decisions need to be revisited together: (a) the explicit `createCachedContent` API integration, (b) cache lifecycle management (TTL, eviction, per-conversation cache id storage), (c) the corresponding usage-field telemetry shape. Until then, the no-op fallback path applies and Google traffic shows `cache-hit-input: 0`, which is honest.

A no-op fallback also applies if the active provider is later swapped for one without caching support. Per-turn telemetry logs cache-hit-input vs cache-miss-input token counts so the savings are observable. Target: a measurable input-cost reduction on every turn after the first within a conversation; specifically, cache-hit tokens become the majority of input tokens once the conversation is past its first turn.

**P3.R10 — Per-turn cost circuit breaker.** The chat stream tracks the cumulative tool-result tokens introduced into the model's context within a single user turn. When the per-turn budget is exceeded (initial budget: 100,000 tool-result input tokens; configurable via env var, expected to be tuned upward from telemetry once we see real workloads — start tight rather than discover the right number through a surprise bill), no further tool calls are accepted; a system-level message is injected telling the model "you have hit the per-turn budget — synthesise an answer with what you already have, and explicitly tell the user the query was too broad and suggest narrowing by client or date range". The user-facing response surfaces this narrowing suggestion in plain language, never an internal error. The hit is logged with telemetry indicating which tools and how many calls preceded the breaker.

**P3.R11 — Eval set as the cutover gate.** The cutover (deletion of the old tools) is gated by the eval results. Before the cutover commit lands, the new surface must clear two thresholds (initial targets: ≥ 90% answer-correctness pass-rate AND ≥ 90% tool-routing accuracy on the Part 1 baseline-coverage queries, with zero regressions on either dimension vs. queries the old surface answered correctly). The eval results are reviewed and the pass is documented in the cutover commit / PR description. If a threshold is not met, the cutover is deferred — the old surface stays wired and the gap is fixed, eval re-run, then re-gated. If a regression surfaces in real production traffic post-cutover that the eval missed, the cutover commit is reverted, the gap is closed by adding a covering query to the eval, and the cutover is re-attempted once the updated eval passes.

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
- [ ] P3.AC11 — The eval results clear both gates (≥ 90% answer-correctness AND ≥ 90% tool-routing accuracy, with zero regressions on either dimension vs. the old-surface baseline) and are documented in the cutover PR description before the old tools are deleted

---

## Backlog

- **Tool-call tracing UI.** A debug panel (admin-only or dev-only) that shows the model's tool-call sequence for a turn, so we can audit whether the model is chaining tools efficiently.
- **Per-tool latency telemetry.** Log entry / exit / duration for each tool call separately, surfaced in a dashboard, so we can spot slow tools and optimise the right ones.
- **Reranker layer for semantic search.** A second-stage reranker (Cohere Rerank, BGE, or a self-hosted cross-encoder) over the top-N results from the hybrid retrieval added in P1.R2, before the chunks reach the chat model. Deferred from PRD-033 because: (a) it introduces a new paid SaaS dependency or a new self-hosted service; (b) it adds 200–500ms of latency per call; (c) hybrid retrieval (pgvector + tsvector + RRF) often closes 80% of the precision gap a reranker would address. Decision rule: ship hybrid, measure precision on the eval over real workloads, and only PRD a reranker if a precision gap remains that's not closable by tuning RRF weights or query rewriting.
- **Chat-side caching of `list_*` results.** A list of clients rarely changes within a single conversation. Cache discovery-tool results per conversation turn so chained calls don't re-query.
- **Cross-session diff tool.** A first-class "compare A vs B" tool that takes two filter sets and returns aligned summaries — currently the chat model has to do this by chaining two summarise calls.
- **User-controllable summarisation depth.** Surface a per-conversation setting ("brief / detailed / verbatim") that the chat model passes through to summarise-sessions, instead of the model picking depth implicitly.
- **Streaming the map step.** Stream per-session summaries as they complete (instead of waiting for the full batch) so the chat model can start writing its synthesis sooner.
- **Tool-result memoisation across turns.** Recognise that "what changed since I last asked" benefits from comparing against a previous turn's tool results; persist the most recent result per tool per conversation for quick deltas.
- **User-editable system prompt for chat.** Lift the chat system prompt out of source control and into the per-team prompt editor (mirroring extraction prompts), so power users can tune chat behaviour without a code change.
- **Semantic caching of repeated user queries.** A second-layer cache (Portkey / Helicone / homegrown) that recognises semantically-equivalent user prompts within a workspace and serves the prior answer directly, skipping the model entirely. Saves recurring "what did Acme say last week" lookups but needs careful invalidation when underlying data changes.
- **Adaptive per-turn cost budget.** Replace the static circuit breaker (initially 100k tool-result input tokens; expected to settle higher once telemetry calibrates it) with a budget that scales with query intent — broader queries get a larger budget up to a hard ceiling, narrow queries are capped tighter. Avoids the false-positive case where a legitimately broad query is artificially squeezed.
- **Trajectory-matching CI block.** Promote the eval from "manually run before cutover" to a CI gate that blocks merges when tool-call trajectories regress against the golden set — turn the Part 3 manual gate into a permanent quality bar for chat changes.
- **Graph-based agent orchestration.** If tool count grows past ~15 or chained-call workflows become consistently buggy, revisit whether to migrate from ReAct + `streamText` to an explicit state-machine library (LangGraph or OpenAI Agents SDK). Premature today.
- **LLM-as-judge model upgrade path.** Today's eval uses a single judge model. Add multi-judge agreement (or a stronger model than the chat model as judge) once eval volume justifies the cost.
