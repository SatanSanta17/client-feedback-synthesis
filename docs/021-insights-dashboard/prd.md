# PRD-021: AI-Powered Insights Dashboard

> **Master PRD Section:** Section 21 — AI-Powered Insights Dashboard
> **Status:** Draft
> **Deliverable:** Users see an interactive, visual dashboard that surfaces key patterns, trends, and anomalies across all client feedback — combining direct quantitative widgets with AI-derived thematic analysis, qualitative drill-downs, and headline insights.

## Purpose

The RAG chat (PRD-020) lets users investigate what they're curious about. But it's reactive — it only answers questions the user thinks to ask. The dashboard is the proactive counterpart: it surfaces patterns, anomalies, and trends without the user needing to formulate a question. "Onboarding complaints doubled this quarter" or "3 new clients mentioned Competitor X" are insights a user might never discover through chat unless they already suspected them.

The dashboard combines two types of data. Direct widgets query structured fields from the sessions table (sentiment counts, urgency distribution, session volume) — these are fast, exact, and require no AI. Derived widgets group free-text signals into themes using LLM categorisation at extraction time, enabling views like "pain point themes ranked by frequency" and "requirement themes trending over the last 3 months." The qualitative drill-down layer (powered by the vector DB from PRD-019) lets users click any data point and see the actual client quotes behind it.

The dashboard shares the same service layer as the chat's `queryDatabase` tool (PRD-020 P2.R6/P2.R8), extending it with additional query actions rather than building a parallel data layer.

## User Story

"As a user who manages client relationships, I want to open a dashboard and immediately see what's happening across my clients — which themes are growing, which clients need attention, what competitors are being mentioned — so that I can prioritise my team's work based on real patterns, not gut feeling."

---

## Part 1: Theme Assignment at Extraction Time

**Scope:** Extend the extraction flow to assign each signal chunk to a persistent theme. Themes are team-scoped entities that build up organically as sessions are extracted. This is the foundation for all derived dashboard widgets.

### Requirements

- **P1.R1** Create a `themes` table:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `name` — text, NOT NULL. Human-readable theme label (e.g., "Onboarding Friction", "Pricing Concerns", "API Performance"). Unique per team (or per personal workspace).
  - `description` — text, nullable. LLM-generated one-sentence description of what this theme covers. Generated when the theme is first created, can be manually edited.
  - `team_id` — UUID, nullable. Null for personal workspace. Themes are team-scoped — different teams may have different theme vocabularies.
  - `created_by` — UUID, FK to `auth.users`, NOT NULL.
  - `is_archived` — boolean, NOT NULL, default `false`. Archived themes are excluded from new assignments but their historical data is preserved.
  - `created_at` — timestamptz, NOT NULL, default `now()`.
  - `updated_at` — timestamptz, NOT NULL, default `now()`.

- **P1.R2** RLS on `themes`: team-scoped read/write, matching the `sessions` table pattern. All team members can read and create themes. Only admins and owners can archive, rename, or merge themes.

- **P1.R3** Create a `signal_themes` junction table:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `embedding_id` — UUID, FK to `session_embeddings.id`, NOT NULL. On embedding delete, cascade delete the assignment.
  - `theme_id` — UUID, FK to `themes.id`, NOT NULL. On theme delete, cascade delete assignments.
  - `assigned_by` — text, NOT NULL, default `ai`. One of: `ai` (assigned during extraction), `user` (manually reassigned by a user in a future feature).
  - `confidence` — float, nullable. The LLM's confidence in the assignment (0.0 to 1.0), if provided. Null for user assignments.
  - `created_at` — timestamptz, NOT NULL, default `now()`.

- **P1.R4** RLS on `signal_themes`: access derived from the embedding's team scope. A user can read/write signal theme assignments only for embeddings they have access to via the `session_embeddings` RLS.

- **P1.R5** Create a theme assignment service in `lib/services/theme-service.ts` that exports `assignThemes(signals: EmbeddingChunk[], teamId: string | null, userId: string): Promise<ThemeAssignment[]>`. This function:
  1. Fetches the current active (non-archived) theme list for the team/workspace.
  2. Builds a prompt containing all signal texts from the extraction and the existing theme names.
  3. Calls the LLM (one call per extraction, not per signal) with instructions to: assign each signal to the best matching existing theme, or suggest a new theme name if no existing theme fits. The LLM should strongly prefer existing themes over creating new ones — only create a new theme if the signal is genuinely about a topic not covered by any existing theme.
  4. For each new theme suggested by the LLM: create a row in the `themes` table with the name and an LLM-generated description.
  5. For each assignment: create a row in `signal_themes` linking the embedding to the theme.
  6. Returns the assignments for logging/verification.

- **P1.R6** The theme assignment prompt is defined in `lib/prompts/theme-assignment.ts`. It instructs the LLM to:
  - Consider each signal's text and client quote (if available) when determining the theme.
  - Assign themes that are topic-based (what the signal is about), not type-based (chunk_type already captures whether something is a pain point or requirement).
  - Themes span chunk types: the same theme (e.g., "Onboarding Friction") can apply to pain points, requirements, blockers, and aspirations.
  - Prefer existing themes. Only create a new theme if the signal genuinely covers a topic not represented in the current theme list.
  - For structured signal chunks: assign exactly one theme per signal.
  - For raw text chunks (chunk_type: `raw`): assign one or more themes per chunk, since raw paragraphs often cover multiple topics. Report a lower confidence score for raw chunk assignments to reflect the inherent ambiguity.
  - Return a structured response: array of `{ signalIndex: number, themes: Array<{ themeName: string, isNew: boolean, confidence: number }> }`. Structured chunks will have exactly one entry in the `themes` array; raw chunks may have multiple.

- **P1.R7** Wire theme assignment into the extraction flow, running **in parallel** with embedding generation. After chunking completes (PRD-019 Part 2), both the embedding call and the theme assignment call are fired simultaneously. Neither depends on the other — both depend only on the chunk output. This minimises added latency to the extraction flow (theme assignment adds near-zero wall-clock time since it runs concurrently with embedding). Theme assignment failures do not block extraction or embedding — if it fails, log the error and continue. Signals without theme assignments will still appear in the dashboard's direct widgets; they just won't contribute to theme-based views until re-extracted or manually assigned.

- **P1.R8** Theme assignment applies to **both structured and raw-only sessions**. For structured sessions, each signal chunk (pain point, requirement, etc.) is assigned to one theme. For raw-only sessions (chunk_type: `raw`), each raw paragraph chunk may be assigned to **multiple themes** since raw text often mixes topics. The LLM prompt accounts for this: for structured chunks it returns one theme per signal; for raw chunks it may return multiple themes per chunk. The `signal_themes` junction table already supports many-to-many via multiple rows per embedding_id. Raw chunk theme assignments are tagged with lower confidence scores to reflect the inherent ambiguity.

- **P1.R9** On re-extraction: when embeddings are deleted and regenerated (PRD-019 P3.R7), the cascade delete on `signal_themes` removes old assignments. The new embeddings go through theme assignment again, potentially being assigned to different themes if the extraction output changed.

- **P1.R10** The theme assignment LLM call uses the same provider-agnostic AI service pattern as extraction. It should use the fastest/cheapest available model (configurable via env vars or hardcoded to the same `AI_PROVIDER`/`AI_MODEL` used for extraction). The call is lightweight — input is just signal texts (no raw notes) plus theme names, and output is a structured array.

### Acceptance Criteria

- [ ] `themes` table exists with all specified columns and team-scoped RLS
- [ ] `signal_themes` junction table exists with cascade deletes on both FKs
- [ ] Theme assignment service fetches existing themes and assigns signals via one LLM call per extraction
- [ ] LLM strongly prefers existing themes over creating new ones
- [ ] New themes are auto-created with LLM-generated descriptions
- [ ] Themes span chunk types — the same theme can apply to pain points, requirements, blockers, etc.
- [ ] Theme assignment runs in parallel with embedding generation, adding near-zero latency
- [ ] Raw-only session chunks are themed with multiple theme assignments allowed per chunk
- [ ] Raw chunk theme assignments have lower confidence scores than structured chunk assignments
- [ ] Theme assignment failure does not block extraction or embedding
- [ ] Re-extraction cascade-deletes old assignments and generates new ones
- [ ] Theme assignment prompt is defined in `lib/prompts/theme-assignment.ts`

---

## Part 2: Dashboard Layout, Navigation, and Direct Widgets

**Scope:** Create the dashboard page at the top of the sidebar navigation. Build the page shell with global filters and the direct quantitative widgets that query structured data from Postgres (no AI needed for these).

### Requirements

#### Page Layout and Navigation

- **P2.R1** Create a new route at `/dashboard`. Add it to the sidebar navigation as the first item (above Capture and Chat). The dashboard is the landing page for insight discovery.

- **P2.R2** The dashboard page has a global filter bar at the top: client selector (multi-select dropdown), date range picker, severity filter, urgency filter. All filters are optional — default is "all clients, all time, all severities, all urgencies." All widgets on the page react to filter changes.

- **P2.R3** Filter state is encoded in URL query parameters so that a filtered dashboard view can be bookmarked or shared via link. On page load, filters are initialised from URL params if present, otherwise from defaults.

- **P2.R4** The dashboard uses a responsive grid layout. On desktop: 2-3 column grid with widgets filling cells. On mobile: single-column stack. Widgets have consistent card styling (border, padding, heading, optional subtitle).

#### Direct Widgets (Structured JSON Queries)

- **P2.R5** **Sentiment Distribution** — donut or bar chart showing session count by sentiment (positive, neutral, negative, mixed). Data source: `structured_json->>'sentiment'` grouped and counted, filtered by global filters. Clicking a segment triggers the drill-down (Part 4).

- **P2.R6** **Urgency Distribution** — bar chart showing session count by urgency level (low, medium, high, critical). Data source: `structured_json->>'urgency'` grouped and counted. Clicking a bar triggers the drill-down.

- **P2.R7** **Client Health Grid** — a matrix/scatter view with sentiment on one axis and urgency on the other. Each client is a dot/cell positioned by their most recent session's sentiment and urgency. Colour-coded by urgency. Clicking a client dot triggers the drill-down filtered to that client.

- **P2.R8** **Session Volume Over Time** — line chart showing sessions captured per week or month. Data source: `COUNT(*) GROUP BY date_trunc('week', session_date)`. Time granularity (week/month) is selectable. Provides context for trend widgets — a spike in pain points means more if session volume was constant.

- **P2.R9** **Competitive Mentions** — horizontal bar chart ranking competitors by mention frequency. Data source: unnest `structured_json->'competitiveMentions'` and count by `competitor` field. Clicking a competitor bar triggers the drill-down showing what was said about them.

- **P2.R10** All direct widgets consume the `queryDatabase` service layer from PRD-020 (P2.R8). New query actions are added to the database query service to support each widget:
  - `sentiment_distribution` — already exists from PRD-020.
  - `urgency_distribution` — already exists from PRD-020.
  - `sessions_over_time` — new: count sessions grouped by time bucket (week/month), with date range filter.
  - `client_health_grid` — new: for each client, return latest session's sentiment and urgency.
  - `competitive_mention_frequency` — new: count competitive mentions grouped by competitor name.
  All new actions respect global filters (client, date range, severity, urgency) and team scoping.

### Acceptance Criteria

- [ ] `/dashboard` route exists and is the first item in sidebar navigation
- [ ] Global filter bar with client, date range, severity, and urgency filters
- [ ] Filter state encoded in URL query parameters
- [ ] All widgets react to global filter changes
- [ ] Sentiment distribution widget renders correctly with clickable segments
- [ ] Urgency distribution widget renders correctly with clickable bars
- [ ] Client health grid shows each client positioned by sentiment and urgency
- [ ] Session volume over time chart with selectable week/month granularity
- [ ] Competitive mentions chart ranks competitors by frequency
- [ ] All widgets consume the shared `queryDatabase` service layer
- [ ] New query actions added to the database query service
- [ ] Responsive grid layout: 2-3 columns on desktop, single column on mobile

---

## Part 3: Derived Theme Widgets

**Scope:** Build dashboard widgets that use the theme assignments from Part 1 to show thematic analysis — which topics appear most frequently, how they trend over time, and which clients are associated with which themes.

### Requirements

- **P3.R1** **Top Themes** — horizontal bar chart showing the most frequent themes ranked by the number of signals assigned to them. Each bar shows the theme name, signal count, and a breakdown by chunk type (e.g., "Onboarding Friction — 12 signals: 5 pain points, 4 requirements, 2 blockers, 1 aspiration"). Clicking a theme bar triggers the drill-down (Part 4) showing the actual signals in that theme.

- **P3.R2** **Theme Trends Over Time** — line or area chart showing how theme frequency changes over time. X-axis is time (weeks or months), Y-axis is signal count, each line is a theme. The user can select which themes to display (top 5 by default, configurable). This reveals emerging patterns: "Pricing concerns went from 2 signals/month to 8 signals/month over the last quarter."

- **P3.R3** **Theme-Client Matrix** — a heatmap grid with themes on one axis and clients on the other. Each cell shows the signal count for that theme-client pair. Colour intensity reflects count. This answers: "Which clients care about which topics?" and "Is this pain point isolated to one client or widespread?" Clicking a cell triggers the drill-down for that specific theme-client combination.

- **P3.R4** Add new query actions to the `queryDatabase` service layer:
  - `top_themes` — return themes ranked by signal count, with per-chunk-type breakdown. Supports global filters (date range, client, severity).
  - `theme_trends` — return signal counts per theme per time bucket. Supports theme selection and date range filters.
  - `theme_client_matrix` — return signal counts per theme-client pair. Supports global filters.
  All actions join `signal_themes` with `session_embeddings` and `sessions` tables, respecting team scoping.

- **P3.R5** The derived widgets gracefully handle the cold-start state: when no themes exist yet (no extractions have been run since Part 1 was deployed), the theme widgets show an empty state with a message: "Themes will appear as you extract more sessions." Not an error — just a natural empty state.

- **P3.R6** All derived widgets respect the global filters from Part 2 (P2.R2). When a client or date range is selected, theme counts and trends recalculate to reflect only the filtered data.

### Acceptance Criteria

- [ ] Top themes widget ranks themes by signal count with chunk-type breakdown
- [ ] Clicking a theme triggers drill-down showing actual signals
- [ ] Theme trends widget shows theme frequency over time with selectable themes
- [ ] Theme-client matrix shows heatmap of signal counts per theme-client pair
- [ ] Clicking a matrix cell triggers drill-down for that theme-client combination
- [ ] New query actions added to the shared service layer
- [ ] Cold-start empty state displays correctly when no themes exist
- [ ] All derived widgets respect global filters

---

## Part 4: Qualitative Drill-Down

**Scope:** When a user clicks any data point in any widget, show the actual client quotes and signals behind that data point. The drill-down reuses the session preview modal from PRD-020 and adds a grouped client accordion view.

### Requirements

- **P4.R1** Clicking any interactive data point on any widget (a bar, a segment, a dot, a matrix cell) opens a drill-down panel. The drill-down is scoped by whatever the data point represents: a sentiment value, an urgency level, a client, a theme, a competitor, or a combination.

- **P4.R2** The drill-down panel displays a list of clients that match the filter. Each client is a collapsible accordion row showing: client name, session count matching the filter, and a summary line (e.g., "3 pain points about Onboarding Friction"). Multiple clients can be expanded simultaneously.

- **P4.R3** Expanding a client row reveals the actual signals: the chunk text, client quote (if available), severity badge, chunk type badge, session date, and the theme label. Each signal has a "View Session" link that opens the session preview modal (reused from PRD-020 P3.R16) showing the full structured signal view for that session.

- **P4.R4** The drill-down data is fetched by combining a filtered query (from the `queryDatabase` service — to get the list of matching sessions and clients) with a retrieval query (from the retrieval service in PRD-019 — to get the actual signal texts and quotes). For theme-based drill-downs, the signal_themes join provides the exact signals. For direct widgets (sentiment, urgency), the retrieval uses metadata filters on chunk_type and the relevant field.

- **P4.R5** The drill-down panel is a sliding panel from the right (similar to the master signal panel in PRD-020 P4.R2) or a modal — consistent with the existing UI pattern. On desktop, it occupies 40-50% of the viewport. On mobile, full width.

- **P4.R6** The drill-down panel includes a count header: "Showing N signals from N clients" and the active filter context (e.g., "Sentiment: Negative" or "Theme: Onboarding Friction, Client: Acme Corp").

### Acceptance Criteria

- [ ] Clicking any widget data point opens a drill-down panel
- [ ] Drill-down shows a client accordion list with expandable rows
- [ ] Multiple clients can be expanded simultaneously
- [ ] Expanded rows show actual signal texts, quotes, severity, chunk type, theme, and session date
- [ ] "View Session" link opens the session preview modal from PRD-020
- [ ] Drill-down data combines queryDatabase and retrieval service results
- [ ] Panel is responsive: 40-50% width on desktop, full width on mobile
- [ ] Count header and active filter context are displayed

---

## Part 5: AI-Generated Headline Insights

**Scope:** Periodically generate 3-5 headline insights using an LLM call over recent data, and display them as attention-grabbing alert cards at the top of the dashboard. Store a history of insights for tracking how the picture changes over time.

### Requirements

- **P5.R1** Create a `dashboard_insights` table:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `content` — text, NOT NULL. The headline insight text (e.g., "Onboarding complaints doubled this quarter, now mentioned by 5 of 12 clients").
  - `insight_type` — text, NOT NULL. One of: `trend` (a metric changed significantly), `anomaly` (something unusual appeared), `milestone` (a threshold was crossed). Used for icon/colour styling on the card.
  - `batch_id` — UUID, NOT NULL. Groups insights that were generated together in a single LLM call. All insights from one generation share the same batch_id.
  - `team_id` — UUID, nullable. Null for personal workspace.
  - `created_by` — UUID, FK to `auth.users`, NOT NULL. The user who triggered the generation (or the system user for auto-refresh).
  - `generated_at` — timestamptz, NOT NULL, default `now()`.

- **P5.R2** RLS on `dashboard_insights`: team-scoped, matching the `sessions` table pattern. All team members can read insights. Generation is triggered by any authenticated user.

- **P5.R3** Create an insight generation service in `lib/services/insight-service.ts` that exports `generateHeadlineInsights(teamId: string | null, userId: string): Promise<DashboardInsight[]>`. This function:
  1. Queries aggregate data: theme counts and trends (from `signal_themes` + `themes`), sentiment distribution, urgency distribution, session volume, competitive mention counts. This is a summary of the current state, not a full data dump.
  2. Queries the previous batch of insights (if any) for comparison context.
  3. Builds a prompt with the current aggregates and previous insights.
  4. Calls the LLM to generate 3-5 headline insights, each with an `insight_type` classification.
  5. Inserts the new insights into `dashboard_insights` with a shared `batch_id`.
  6. Returns the new insights.

- **P5.R4** The insight generation prompt is defined in `lib/prompts/headline-insights.ts`. It instructs the LLM to:
  - Generate 3-5 concise, specific, actionable insights (one sentence each).
  - Focus on changes, anomalies, and patterns — not just restating the data. "5 clients mentioned pricing" is data. "Pricing concerns doubled since last quarter, now the #1 pain point" is an insight.
  - Compare against previous insights where available: highlight what's new or changed.
  - Classify each insight as `trend`, `anomaly`, or `milestone`.
  - Do not fabricate — every claim must be derivable from the provided aggregates.

- **P5.R5** Headline insights are displayed at the top of the dashboard as a row of alert cards. Each card shows: the insight text, the `insight_type` as an icon/colour (trend = blue, anomaly = amber, milestone = green), and the generation date.

- **P5.R6** A "Refresh Insights" button allows manual regeneration. Auto-refresh is triggered when a new session is extracted (the extraction flow checks if insights exist and whether new sessions have been added since the last generation — if so, triggers regeneration asynchronously after extraction completes).

- **P5.R7** Below the current insight cards, a "Previous Insights" expandable section shows older batches grouped by generation date. This provides a history view — users can see how the picture has evolved over time.

- **P5.R8** Insight generation failure does not break the dashboard. If generation fails, the dashboard shows the most recent successful batch. If no insights have ever been generated, the insight area shows an empty state: "Click 'Refresh Insights' to generate your first headline insights."

### Acceptance Criteria

- [ ] `dashboard_insights` table exists with all specified columns and team-scoped RLS
- [ ] Insight generation service produces 3-5 headline insights per call
- [ ] Insights are classified as trend, anomaly, or milestone
- [ ] Insights compare against previous batch for change detection
- [ ] Alert cards display at the top of the dashboard with type-specific styling
- [ ] "Refresh Insights" button triggers manual regeneration
- [ ] Auto-refresh triggers after new session extraction
- [ ] "Previous Insights" section shows historical batches
- [ ] Generation failure falls back to most recent successful batch
- [ ] Empty state displays when no insights have been generated

---

## Part 6: Filters and Interactivity

**Scope:** Ensure the global filter system works cohesively across all widgets, add cross-widget interactions, and polish the dashboard UX.

### Requirements

- **P6.R1** Global filters (P2.R2) propagate to every widget on the page — both direct widgets and derived theme widgets. When a filter changes, all widgets re-fetch their data with the new filter parameters. This is implemented via shared filter state (React context or URL params) that each widget reads from.

- **P6.R2** Cross-widget interaction: clicking a data point in one widget can set a global filter that affects other widgets. For example: clicking "Acme Corp" in the client health grid adds Acme Corp to the client filter, and all other widgets update to show only Acme Corp's data. A "Clear filters" button resets all filters to defaults.

- **P6.R3** Widget loading states: each widget shows an individual loading skeleton while its data is being fetched. Widgets load independently — a slow theme query doesn't block the sentiment chart from rendering. This is implemented via independent data fetching per widget (not a single monolithic dashboard query).

- **P6.R4** Widget error states: if a widget's data fetch fails, that widget shows an inline error ("Could not load data — click to retry") while other widgets continue to function. Dashboard-level errors (e.g., authentication failure) show a full-page error.

- **P6.R5** Empty states per widget: if a widget has no data for the current filter selection (e.g., no sessions in the selected date range), show a contextual empty message ("No sessions found for the selected filters") rather than a broken or blank chart.

- **P6.R6** Dashboard data freshness indicator: a subtle timestamp near the filter bar showing "Data as of [time]" or "Last updated [time ago]" so users know how current the view is. This updates when any widget re-fetches.

### Acceptance Criteria

- [ ] Global filters propagate to all widgets simultaneously
- [ ] Cross-widget clicks set global filters and update all widgets
- [ ] "Clear filters" button resets all filters to defaults
- [ ] Each widget has independent loading skeletons
- [ ] Failed widgets show inline retry errors without breaking other widgets
- [ ] Empty states display contextually per widget
- [ ] Data freshness indicator shows last update time

---

## Backlog (deferred from this PRD)

- **Theme management UI** — a "Manage Themes" page or modal where users can rename themes, merge two themes into one (reassigning all signals), archive themes, and view theme details (description, signal count, client spread). Keeps the theme list clean over time.
- **Manual theme assignment** — allow users to manually reassign a signal from one theme to another in the drill-down view. Updates the `signal_themes.assigned_by` field to `user`.
- **Custom dashboard layouts** — let users rearrange, resize, hide, or pin specific widgets. Store layout preferences per user.
- **Dashboard export** — export the current dashboard view as a PDF report or screenshot. Include all visible widgets with their current filter state.
- **Anomaly detection** — automated detection of statistically significant changes (e.g., sentiment shift for a client, sudden spike in a theme) without relying on the LLM. Alerts surface as badges on the dashboard icon in the sidebar.
- **Comparison mode** — side-by-side comparison of two time periods or two client groups across all widgets.
- **Dashboard sharing** — share a dashboard view (with filters) as a link that other team members can open.
- **Widget drill-down to chat** — from any drill-down panel, a "Ask about this in Chat" button that opens the chat with a pre-filled question about the data point the user was exploring.
- **Backfill theme assignments** — for sessions extracted before Part 1 was deployed, run a batch job that assigns themes to existing embeddings. Processes in batches with rate limiting.
