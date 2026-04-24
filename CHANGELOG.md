# Changelog — Synthesiser

All notable changes to this project are documented here, grouped by PRD and part number.

---

## [Unreleased]

### Gap P5 — Shared filter persistence — 2026-04-25

- Added `lib/hooks/use-filter-storage.ts` — sessionStorage-backed filter persistence primitive keyed by `filters:<surface>:<userId>:<workspaceId|personal>`. Narrow `{ key, read, write }` API so each surface owns its own sync policy.
- Wired dashboard `filter-bar.tsx` to the hook — restores filters from storage on mount/workspace-change when the URL has no filter params; mirrors URL → storage on every filter change.
- Wired capture `past-sessions-table.tsx` to the hook — hydrates React filter state from storage on mount/workspace-change; persists state → storage on every filter update.
- `setActiveTeam()` in `auth-provider.tsx` now calls `router.replace(pathname)` on workspace switch to strip URL query params, per the P5 contract ("workspace switch is a fresh context").
- No cleanup on signOut needed — `userId` in the storage key makes stale entries from a prior user inert, and tab close clears `sessionStorage`.

### PRD-022 Layout Cleanup — 2026-04-12

**Part 1 — Settings Accordion in Sidebar + Shared Page Header:**
- Replaced the "Settings" nav link in `app-sidebar.tsx` with a collapsible Settings accordion containing "Team Management" and "Extraction Prompt" sub-links.
- Created reusable `PageHeader` component (`components/layout/page-header.tsx`) and adopted it on Dashboard and Capture pages.
- Replaced the tabbed settings page (`app/settings/page.tsx`) with a redirect to `/settings/team`.

**Part 2 — Dedicated Team Management Page:**
- Created dedicated team management page (`app/settings/team/page.tsx`) restricted to team admins.
- Created `team-management-client.tsx` to group existing components into "Access" and "Manage Team" sections.
- Safely deleted `app/settings/_components/team-settings.tsx`.

**Part 3 — Dedicated Extraction Prompt Page:**
- Created dedicated extraction prompt page (`app/settings/prompts/page.tsx`) with full edit access for personal/admins and read-only for non-admins.
- Created `extraction-prompt-client.tsx` and `use-extraction-prompt.ts` focused solely on the single signal extraction prompt.
- Removed tabs UI and master signal prompts; deleted dead code (`prompt-editor-page-content.tsx`, `prompt-master-signal-notice.tsx`, `prompt-unsaved-dialog.tsx`, `use-prompt-editor.ts`, `settings-page-content.tsx`).

**Part 4 — Landing Page Refresh:**
- Updated marketing copy on `/` to reflect the current product value (Insights Dashboard + Chat).
- Swapped out "Cross-Client Synthesis" feature card for "Insights Dashboard" and "Ask Your Data".
- Updated Step 3 in "How It Works" to "Understand" instead of "Synthesise".
- Purged all mentions of the deprecated "master signal" from the landing page.

### PRD-021 Part 6: Filters and Interactivity — 2026-04-12

**Cross-widget filtering (P6.R2):**
- Shift+click on sentiment/urgency/client-health widget data points sets global URL filters (`severity`, `urgency`, `clients`) that all widgets respond to via existing `useDashboardFetch` + `FilterBar` infrastructure
- `applyWidgetFilter()` callback in `dashboard-content.tsx` — receives `Record<string, string>`, merges into URL params via `router.replace()`
- Three widgets updated with `onFilter` prop and `event.shiftKey` detection: `sentiment-widget.tsx`, `urgency-widget.tsx`, `client-health-widget.tsx`

**Data freshness indicator (P6.R6):**
- `freshness-context.tsx` — lightweight context providing `onFetchComplete` callback, avoids prop-drilling through 8 widgets
- `freshness-indicator.tsx` — "Data as of just now / Nm ago / HH:MM" display with 30-second auto-refresh timer
- `use-dashboard-fetch.ts` — calls `onFetchComplete()` from context after each successful fetch
- `dashboard-content.tsx` — ref+state pair with 30s interval sync, wraps children in `FreshnessContext.Provider`

**Dashboard screenshot export (P6.R7):**
- `export-dashboard.ts` — `exportDashboardAsImage()` utility: dynamically imports `html2canvas` (~200KB deferred), prepends temporary filter context header to capture area, captures at 2x retina scale, triggers PNG download with date-stamped filename, cleans up header in `finally` block
- `filter-bar.tsx` — "Export as Image" button with Camera icon (Loader2 spinner during export), `onExport`/`isExporting` props, positioned right via `ml-auto`
- `dashboard-content.tsx` — `dashboardRef` on wrapper div, `isExporting` state, `activeFilters` derived from URL params, `handleExport` async callback

**Audit fixes:**
- `freshness-indicator.tsx` — replaced string concatenation with `cn()` for className composition
- `dashboard-content.tsx` — fixed indentation inside `dashboardRef` wrapper div

**Already implemented (no changes needed):**
- P6.R1 (global filter propagation) — Part 2
- P6.R3 (widget loading states) — Part 2
- P6.R4 (widget error states) — Part 2
- P6.R5 (empty states per widget) — Part 2

---

### PRD-021 Part 5: AI-Generated Headline Insights — 2026-04-12

**Database:**
- `dashboard_insights` table — `id` (UUID PK), `content` (text), `insight_type` (CHECK: trend/anomaly/milestone), `batch_id` (UUID), `team_id` (FK nullable), `created_by` (FK), `generated_at` (timestamptz); indexes on `(team_id, batch_id)` and `(team_id, generated_at DESC)`; RLS policies for team member reads, personal workspace reads, and authenticated inserts

**New lib files:**
- `lib/types/insight.ts` — `InsightType`, `DashboardInsight`, `InsightBatch` types
- `lib/schemas/headline-insights-schema.ts` — Zod schema for LLM response (1–5 classified insight items), `HeadlineInsightsResponse` inferred type
- `lib/prompts/headline-insights.ts` — system prompt (3–5 change-focused, classified, no-fabrication rules), `InsightAggregates` interface, `buildHeadlineInsightsUserMessage()` user message builder with previous batch comparison
- `lib/repositories/insight-repository.ts` — `InsightRepository` interface (`getLatestBatch`, `getPreviousBatches`, `insertBatch`, `getLastGeneratedAt`) + `InsightInsert` type
- `lib/repositories/supabase/supabase-insight-repository.ts` — Supabase adapter with `mapRow()`, `groupIntoBatches()`, inline team scoping
- `lib/services/insight-service.ts` — `generateHeadlineInsights()` (5 aggregate queries in parallel via `executeQuery()` → previous batch fetch → `callModelObject()` → batch insert), `maybeRefreshDashboardInsights()` (staleness check via session count since last generation, fire-and-forget safe)

**API routes:**
- `POST /api/dashboard/insights` — auth check, service-role client, calls `generateHeadlineInsights()`, returns `{ insights }`
- `insights_latest` and `insights_history` read actions added to `GET /api/dashboard` Zod enum and `database-query-service.ts` action map (now 17 actions)

**New UI components:**
- `use-insights.ts` — `useInsights()` hook: fetches latest batch on mount, `refresh()` POSTs for new generation, `loadPrevious()` lazy-loads history
- `insight-cards-row.tsx` — horizontal scrollable card row with type-specific styling (trend=blue/info, anomaly=amber/warning, milestone=green/success), relative timestamp, "Refresh Insights" button with spinner, skeleton/error/empty states
- `previous-insights.tsx` — collapsible `<details>/<summary>` with lazy load on first expand, compact batch list with type icons and formatted dates

**Dashboard wiring:**
- `dashboard-content.tsx` — `useInsights()` called in `DashboardInner`, `InsightCardsRow` + `PreviousInsights` rendered between FilterBar and widget grid

**Auto-refresh wiring:**
- `app/api/sessions/route.ts` POST — fire-and-forget chain extended: `generateEmbeddings() → assignThemes() → maybeRefreshDashboardInsights()`
- `app/api/sessions/[id]/route.ts` PUT — same chain extension for re-extraction flow

---

### PRD-021 Part 4: Qualitative Drill-Down — 2026-04-12

**New components:**
- `drill-down-types.ts` — `DrillDownContext` discriminated union (7 variants: sentiment, urgency, client, competitor, theme, theme_bucket, theme_client), `DrillDownSignal`, `DrillDownClientGroup`, `DrillDownResult` interfaces
- `drill-down-content.tsx` — Presentation-agnostic drill-down body; fetches data via `useDashboardFetch` with `drill_down` action; renders count header (with truncation indicator), filter label, client accordion (native `<details>/<summary>`, multiple open simultaneously), signal rows with chunk-type badge, theme badge, session date, text truncation toggle, "View Session" button; loading/error/empty states
- `drill-down-panel.tsx` — Thin Sheet shell (side="right", 45vw desktop / full mobile) wrapping `DrillDownContent`; swappable to Dialog in one file change; owns `SessionPreviewDialog` state
- `session-preview-dialog.tsx` — Dialog wrapping `StructuredSignalView`; fetches session via `session_detail` action; client name + date in header; loading skeleton, error retry, no-data states

**Database query service extensions:**
- `drill_down` action — Zod-validated discriminated union payload with 7 dispatch strategies: 3 direct (sentiment, urgency, client via `fetchDirectDrillDownRows`), 1 competitor (sessions + filtered embeddings), 3 theme (signal_themes join via `fetchThemeDrillDownRows` with optional bucket/client narrowing); results grouped by client via `groupByClient()`, capped at 100 signals
- `session_detail` action — fetches single session by ID with team scoping, returns `structuredJson`, `clientName`, `sessionDate`
- `drillDown?: string` and `sessionId?: string` added to `QueryFilters`

**API route extensions:**
- 2 new actions (`drill_down`, `session_detail`) added to Zod enum
- `drillDown: z.string().optional()` and `sessionId: z.string().uuid().optional()` params

**Widget wiring (7 widgets):**
- All 7 clickable widgets now accept `onDrillDown?: (context: DrillDownContext) => void` prop
- `dashboard-content.tsx` manages `drillDownContext` state, passes `handleDrillDown` callback to all widgets, renders `DrillDownPanel`
- All `console.log` drill-down stubs replaced with actual `onDrillDown` calls
- `client-health-widget.tsx` — `clientId` added to `ScatterPoint` for drill-down
- `theme-trends-widget.tsx` — `activeDot.onClick` handler dispatches `theme_bucket` context
- `SessionVolumeWidget` intentionally excluded (no meaningful click interaction)

**Shared infrastructure (DRY):**
- `CHUNK_TYPE_LABELS`, `formatChunkType()`, `formatChunkTypePlural()` extracted to `chart-colours.ts` — replaces local definitions in `drill-down-content.tsx` and `top-themes-widget.tsx`

---

### PRD-021 Part 3: Derived Theme Widgets — 2026-04-12

**New dashboard widgets:**
- Top Themes — horizontal BarChart (layout="vertical") ranked by signal count descending; custom tooltip shows per-chunk-type breakdown (e.g., "5 Pain points, 3 Requirements, 2 Blockers"); 15-theme default with "Show all N themes" toggle; clickable bars (drill-down stub for Part 4); spans 2 grid columns
- Theme Trends — multi-line LineChart with X-axis time buckets, Y-axis signal count, each theme a separate coloured line; defaults to top 5 themes by total count; local theme multi-select (Popover + Command); local week/month granularity toggle; 8-colour cycling palette; spans 2 grid columns
- Theme-Client Matrix — HTML heatmap grid (not Recharts); themes on rows, clients on columns; cell background opacity proportional to count; sticky row/column headers for scrollable overflow; custom positioned tooltip ("Theme X + Client Y: N signals"); clickable cells (drill-down stub for Part 4); spans 3 grid columns

**Database query service extensions:**
- 3 new actions: `top_themes` (aggregate by theme_id with chunk_type sub-counts), `theme_trends` (group by date_trunc + theme_id), `theme_client_matrix` (sparse cells grouped by theme_id + client_id)
- `confidenceMin?: number` added to `QueryFilters` — filters signal_themes by confidence threshold (available as URL param `?confidenceMin=0.8`, UI slider deferred to Part 6)
- `fetchActiveThemeMap()` shared helper — queries `themes` table for workspace-scoped id→name Map
- `fetchSignalThemeRows()` shared helper — multi-table join (`signal_themes` → `session_embeddings!inner` → `sessions!inner`) with team scoping, date range, client IDs, and confidence threshold
- `dateTrunc()` utility — week (Monday-aligned) and month truncation for TypeScript-side grouping

**API route extensions:**
- 3 new actions added to Zod enum in `/api/dashboard` route
- `confidenceMin` param: `z.coerce.number().min(0).max(1).optional()`

**Shared infrastructure:**
- `BRAND_PRIMARY_HEX` and `BRAND_PRIMARY_RGB` constants extracted to `chart-colours.ts` (DRY)
- `THEME_LINE_COLOURS` 8-colour palette added to `chart-colours.ts`
- All 3 theme widgets use `useDashboardFetch` and `DashboardCard` (shared patterns from Part 2)
- Dashboard grid now contains 8 widgets total (5 direct + 3 theme-derived)

---

### PRD-021 Part 2: Dashboard Layout, Navigation, and Direct Widgets — 2026-04-12

**New route and page:**
- `/dashboard` page — server component with metadata, responsive widget grid (1→2→3 columns), global filter bar
- `/api/dashboard` GET route — Zod-validated action + filter params, delegates to `executeQuery()` via RLS-protected anon client
- Dashboard is now the first item in sidebar navigation (BarChart3 icon)

**Global filter bar:**
- Client multi-select (Popover + Command with search), date range (from/to), sentiment dropdown, urgency dropdown
- All filter state encoded in URL search params (bookmarkable/shareable)
- "Clear filters" button resets all params

**Dashboard widgets (Recharts):**
- Sentiment distribution — donut PieChart (positive=green, neutral=slate, negative=red, mixed=amber), clickable segments
- Urgency distribution — BarChart (low=green, medium=amber, high=orange, critical=red), clickable bars
- Session volume over time — AreaChart with local week/month granularity toggle, CartesianGrid
- Client health grid — ScatterChart positioning clients by sentiment (X) × urgency (Y), colour-coded dots, custom tooltip
- Competitive mentions — horizontal BarChart sorted by frequency, clickable bars

**Database query service extensions:**
- 3 new actions: `sessions_over_time` (via RPC), `client_health_grid`, `competitive_mention_frequency`
- Extended `QueryFilters` with `clientIds`, `severity`, `urgency`, `granularity`
- `handleClientList()` now returns `{ id, name }` objects (was just name strings)
- `sessions_over_time` RPC function for time-bucketed GROUP BY queries

**Shared infrastructure:**
- `useDashboardFetch<T>` hook — shared fetch lifecycle across all widgets, reads URL search params for global filter reactivity, supports widget-local extra params
- `DashboardCard` component — shared card chrome with loading skeleton, error/retry, empty state, content slot
- `chart-colours.ts` — centralised sentiment and urgency hex colour maps (DRY extraction)

### PRD-021 Part 1: Theme Assignment at Extraction Time — 2026-04-12

**New tables:**
- `themes` — workspace-scoped topic-based themes with `initiated_by`, `origin` (ai/user), `is_archived`, and case-insensitive partial unique indexes for name deduplication
- `signal_themes` — many-to-many junction linking embeddings to themes, with `assigned_by` (ai/user), `confidence` score, and cascade deletes on both FKs

**AI service refactor:**
- Extracted two public generics: `callModelText()` and `callModelObject<T>()` — all non-streaming LLM calls now route through these with retry logic and error classification
- Migrated `extractSignals()`, `synthesiseMasterSignal()`, and `generateConversationTitle()` to use the new generics
- Fixed PRD-020 bug: `generateConversationTitle()` now gets 3 retries for transient failures (previously had zero)

**Theme assignment pipeline:**
- Created `theme-service.ts` with `assignSessionThemes()` — fetches workspace themes, calls LLM once per extraction, resolves/creates themes with concurrent-safe unique constraint handling, bulk inserts assignments
- Created theme assignment prompt (`lib/prompts/theme-assignment.ts`) — topic-based classification with primary/secondary theme distinction and confidence ranges
- Created Zod schema (`lib/schemas/theme-assignment-schema.ts`) for validated LLM response
- Created `ThemeRepository` and `SignalThemeRepository` interfaces with Supabase adapters

**Extraction flow wiring:**
- Modified `generateSessionEmbeddings()` to return embedding IDs (`string[]` instead of `void`) and accept `preComputedChunks`
- Wired `assignSessionThemes()` into both POST and PUT session routes, chained after embedding generation (fire-and-forget)
- Replaced all silent `.catch(() => {})` calls with dev-aware catches that emit yellow ANSI warnings in development mode

### PRD-020 Post-Part 3 Bug Fixes — 2026-04-11

**Critical: Data isolation fix**
- **Root cause:** `ChatPageContent` hardcoded `teamId = null` instead of reading from auth context; chat send route accepted `teamId` from request body (allowing client-side override); service-role client bypassed RLS for `queryDatabase` tool, exposing all users' personal workspace data when `team_id IS NULL`
- Wired `activeTeamId` from `useAuth()` context in `ChatPageContent` — chat page now respects active workspace
- Removed `teamId` from chat send request body schema — route now always reads from `active_team_id` cookie via `getActiveTeamId()`, matching all other routes
- Switched `queryDatabase` tool from service-role client to RLS-protected anon client for data isolation
- Added `filter_user_id` parameter to `match_session_embeddings` RPC function — enforces `sessions.created_by = filter_user_id` in personal workspace to prevent cross-user embedding leakage
- Updated `createEmbeddingRepository()` to accept optional `userId` parameter, passed to RPC for personal workspace scoping
- Removed `serviceClient` from `ChatStreamDeps` interface (no longer needed — anon client handles data reads, embedding repo is pre-injected)
- Removed `teamId` from `useChat` hook options and request payload

**UI fixes**
- Fixed `<!--follow-ups:...-->` HTML comment rendering in streamed messages — added `stripFollowUpBlock()` in `use-chat.ts` that strips both complete and partial follow-up blocks during streaming and from completed messages
- Changed follow-up chip clicks from auto-send to textarea insertion — added `suggestedText` prop on `ChatInput`, chips now populate textarea for user review before sending
- Fixed user message copy button invisible — added `text-foreground` on actions container to override inherited `text-primary-foreground` from user bubble
- Enabled textarea during streaming — removed `disabled={isStreaming}` so users can type ahead while response generates
- Changed chat input focus ring to `--brand-primary-light` design token
- Moved follow-up suggestion pills outside the message bubble — now rendered below the bubble in a flex column layout
- Added AI disclaimer text below chat input
- Fixed pin not re-sorting conversation list — added `sortConversations()` helper (pinned first → updatedAt desc → id desc) to optimistic update
- Replaced rename dialog with inline editing — title becomes editable in-place on "Rename" click, Enter saves, Escape cancels; deleted `rename-dialog.tsx`
- Added pinned section separator in conversation sidebar — "Pinned" label + divider between pinned and unpinned groups, hidden when no pinned conversations

### PRD-020 Part 3: Chat UI Components — 2026-04-11
- Created `app/chat/page.tsx` — thin server component with metadata, renders ChatPageContent
- Created conversation sidebar (`conversation-sidebar.tsx`, `conversation-item.tsx`, `conversation-context-menu.tsx`, `rename-dialog.tsx`) — collapsible desktop panel (280px ↔ 0) + mobile Sheet drawer, search, active/archived tabs, context menu with rename/pin/archive/delete
- Created `chat-page-content.tsx` — client coordinator wiring `useConversations` + `useChat` hooks, manages active conversation ID, sidebar collapse/mobile state, conversation creation with prepend placeholder
- Created chat area (`chat-area.tsx`, `chat-header.tsx`, `chat-input.tsx`) — header with sidebar/search toggles, auto-expanding textarea (1–6 rows) with Send/Stop buttons, archived unarchive bar
- Created message rendering (`message-bubble.tsx`, `message-thread.tsx`, `message-actions.tsx`, `memoized-markdown.tsx`) — react-virtuoso reverse mode with sentinel pattern for streaming, React.memo'd ReactMarkdown with remark-gfm, hover-visible copy actions
- Created streaming UI (`streaming-message.tsx`, `message-status-indicator.tsx`) — live markdown rendering with blinking cursor, status badges for failed/cancelled/stale with retry
- Created citations and follow-ups (`citation-chips.tsx`, `citation-preview-dialog.tsx`, `follow-up-chips.tsx`, `starter-questions.tsx`) — pill-shaped citation chips opening preview dialog, clickable follow-up question chips, 4 starter questions in empty state
- Created in-conversation search (`chat-search-bar.tsx`, `highlighted-text.tsx`) — Ctrl/Cmd+F keyboard shortcut, match count with prev/next navigation, recursive text highlighting in markdown via component overrides
- Created `use-chat.ts` — custom SSE streaming hook with AbortController cancellation, streaming state machine (idle/streaming/error)
- Created `use-conversations.ts` — dual active/archived list management with optimistic CRUD, compound cursor pagination, search filtering
- **End-of-part audit:** a11y fixes (aria-labels on sidebar clear button, aria-hidden on decorative icons), verified no dead code/import violations, TypeScript check clean

### PRD-020 Part 2: Chat Data Model and Streaming Infrastructure — 2026-04-11
- Created `conversations` and `messages` database tables with RLS (user-private conversations, derived access for messages), indexes, and auto-update triggers
- Created `lib/types/chat.ts` — `MessageRole`, `MessageStatus`, `ChatSource`, `Message`, `Conversation`, `ConversationListOptions` types
- Created `ConversationRepository` and `MessageRepository` interfaces with Supabase adapters — cursor-based pagination, pinned-first ordering for conversations, newest-first for messages
- Created `lib/services/chat-service.ts` — conversation CRUD, message CRUD, `buildContextMessages()` with 80,000-token budget (char/4 approximation)
- Created `lib/services/database-query-service.ts` — 7 predefined actions (`count_clients`, `count_sessions`, `sessions_per_client`, `sentiment_distribution`, `urgency_distribution`, `recent_sessions`, `client_list`) with team scoping via `scopeByTeam()` and shared query helpers (DRY extraction)
- Created `lib/prompts/chat-prompt.ts` — chat system prompt with tool usage instructions, citation rules, follow-up generation as `<!--follow-ups:["..."]-->` HTML comment block
- Created `lib/prompts/generate-title.ts` — lightweight 5-8 word title generation prompt
- Added `generateConversationTitle()` to `lib/services/ai-service.ts` — fire-and-forget LLM title generation, returns null on failure
- Created `lib/services/chat-stream-service.ts` — streaming orchestration: `searchInsights` and `queryDatabase` tool definitions (Vercel AI SDK v6 `tool()` + `inputSchema: zodSchema()`), `streamText()` with `stopWhen: stepCountIs(3)`, custom SSE events via `ReadableStream`, follow-up parsing, source deduplication, message finalization
- Created `lib/utils/chat-helpers.ts` — pure utility functions: `sseEvent()`, `parseFollowUps()`, `toSource()`, `deduplicateSources()`
- Created `app/api/chat/send/route.ts` — thin POST controller: auth, Zod validation, conversation create-or-resolve, message lifecycle, delegates streaming to `chat-stream-service`; returns SSE response with `X-Conversation-Id` header
- **End-of-part audit:** SRP refactor (route → stream service → helpers), DRY extraction in database-query-service (shared `baseSessionQuery`/`baseClientQuery`/`aggregateJsonField`/`extractClientName` helpers), import order fixes, TypeScript check clean

### PRD-020 Part 1: Sidebar Navigation — 2026-04-11
- Replaced top-bar header (`app-header.tsx`, `tab-nav.tsx`) with an Instagram-style hover-to-expand sidebar (`app-sidebar.tsx`) — icon-only (64px) at rest, overlay (240px) on hover, no content shift
- Created `authenticated-layout.tsx` — auth-aware layout wrapper that renders sidebar + margin for authenticated routes and footer-only for public routes
- Created `components/ui/sheet.tsx` — slide-out drawer (left/right/top/bottom) built on Radix Dialog primitives, used for mobile sidebar
- Updated `user-menu.tsx` — added `side`, `collapsed`, and `onOpenChange` props for sidebar integration; avatar wrapped in fixed-size div to prevent squishing
- Updated `workspace-switcher.tsx` — added `collapsed` and `onOpenChange` props for sidebar integration
- Added `--sidebar-width-expanded` and `--sidebar-width-collapsed` CSS custom properties to `globals.css`
- Mobile: hamburger trigger (md:hidden) opens left-side Sheet drawer with full sidebar content
- Portal-mounted dropdown collapse fix: ref-based counter (`openDropdownCount`) with 100ms grace period prevents sidebar from collapsing while dropdowns are open
- Deleted `app-header.tsx` and `tab-nav.tsx` — replaced by sidebar navigation
- Footer removed from authenticated layouts; theme toggle moved into sidebar "More" menu
- Updated `layout.tsx` — replaced AppHeader with AuthenticatedLayout wrapper
- **End-of-part audit:** TypeScript check clean (`npx tsc --noEmit`), no dead references, all 12 PRD acceptance criteria verified

### PRD-019 Part 4: Retrieval Service — 2026-04-11
- Created `lib/types/retrieval-result.ts` — `QueryClassification` union (broad/specific/comparative), `ClassificationResult`, `RetrievalOptions`, `RetrievalResult` interfaces
- Created `lib/prompts/classify-query.ts` — version-controlled system prompt and max tokens constant for lightweight LLM query classification
- Created `lib/services/retrieval-service.ts` — `retrieveRelevantChunks()` with 5-step flow: classify query (adaptive chunk count) → embed query (ephemeral, never persisted) → similarity search via repository RPC → deduplicate by exact text match → map to typed RetrievalResult[]; classification via `generateObject()` + Zod schema reusing `resolveModel()` from ai-service; classification failure falls back to broad (15 chunks); embedding/search errors propagate to caller
- Exported `resolveModel()` from `lib/services/ai-service.ts` (previously internal) for reuse by the retrieval service
- **End-of-part audit:** No fixes needed — SRP/DRY/logging/dead code/convention compliance/TypeScript strictness/framework-agnostic all clean

### PRD-019 Part 3: Embedding Pipeline — 2026-04-10
- Installed `openai` npm package for embedding API calls
- Created `lib/services/embedding-service.ts` — provider-agnostic `embedTexts()` with OpenAI adapter, batching (20 per API call, 200ms inter-batch delay), `withEmbeddingRetry()` with exponential backoff and Retry-After handling on 429, dimension validation on first call, four error classes (`EmbeddingServiceError`, `EmbeddingConfigError`, `EmbeddingRequestError`, `EmbeddingRateLimitError`)
- Created `lib/repositories/embedding-repository.ts` — `EmbeddingRepository` interface with `upsertChunks()`, `deleteBySessionId()`, `similaritySearch()` + `EmbeddingRow`, `SearchOptions`, `SimilarityResult` types
- Created `lib/repositories/supabase/supabase-embedding-repository.ts` — Supabase adapter using service-role client; similarity search via `match_session_embeddings` RPC function
- Created `docs/019-vector-search/002-match-session-embeddings-rpc.sql` — RPC function with team scoping, metadata filtering (chunk type, client name, date range), soft-delete exclusion via sessions join, configurable similarity threshold
- Created `lib/services/embedding-orchestrator.ts` — `generateSessionEmbeddings()` coordinating chunking → embedding → persistence; handles structured JSON vs raw notes fallback; deletes old embeddings on re-extraction; entire body wrapped in try/catch for fire-and-forget usage
- Wired fire-and-forget embedding into `POST /api/sessions` (embed on create) and `PUT /api/sessions/[id]` (re-embed on every update with `isReExtraction: true`)
- Updated `.env.example` with `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
- Updated `lib/repositories/index.ts` and `lib/repositories/supabase/index.ts` with embedding repository re-exports
- **End-of-part audit:** Fixed dead `EmbeddingRateLimitError` class — wired into retry exhaustion on 429; fixed import ordering in both session route files; updated ARCHITECTURE.md (new files in file map, embedding env vars in env table, updated Current State)

### PRD-019 Part 2: Chunking Logic — 2026-04-10
- Created `lib/types/embedding-chunk.ts` — `ChunkType` union (10 chunk types), `EmbeddingChunk` interface, `SessionMeta` interface
- Created `lib/services/chunking-service.ts` — pure `chunkStructuredSignals()` producing typed chunks from all `ExtractedSignals` sections (summary, client profile, pain points, requirements, aspirations, competitive mentions, blockers, tools & platforms, custom categories) with snake_case metadata and null-value omission; pure `chunkRawNotes()` splitting raw notes by paragraph for raw-only sessions
- **End-of-part audit:** No fixes needed — SRP/DRY/dead code/convention compliance/TypeScript strictness/purity all clean

### PRD-019 Part 1: pgvector Setup and Embeddings Table — 2026-04-10
- Enabled `pgvector` extension on the Supabase instance (`CREATE EXTENSION IF NOT EXISTS vector`)
- Created `session_embeddings` table with columns: `id`, `session_id` (FK → sessions, ON DELETE CASCADE), `team_id` (FK → teams, nullable), `chunk_text`, `chunk_type` (text), `metadata` (jsonb), `embedding` (vector(1536)), `schema_version`, `created_at`
- Created HNSW index on `embedding` column (`vector_cosine_ops`) for cosine similarity search
- Created composite indexes on `(session_id)` and `(team_id, chunk_type)` for cascade deletes and filtered searches
- Enabled RLS with 8 policies (personal + team for SELECT/INSERT/UPDATE/DELETE) mirroring `sessions` table pattern via `is_team_member()`
- Updated ARCHITECTURE.md — added `session_embeddings` to Data Model section, database tables list, and docs file map

### PRD-018 Part 2: Switch UI to Render from JSON — 2026-04-10
- Created `components/capture/structured-signal-view.tsx` — renders `ExtractedSignals` JSON as typed UI with discrete sections (summary, sentiment, urgency, decision timeline, client profile, pain points, requirements, aspirations, competitive mentions, blockers, platforms & channels, custom categories); severity/priority/sentiment/urgency badges using design tokens; client quote formatting; empty-state handling
- Updated `structured-notes-panel.tsx` — branches between `StructuredSignalView` (when `structuredJson` is present) and `MarkdownPanel` fallback (pre-Part 1 sessions); edit toggle switches from JSON view to markdown editor for manual edits; added `showHeading` and `className` props
- Wired `structuredJson` into `session-capture-form.tsx` — passes hook state to `StructuredNotesPanel`
- Wired `StructuredNotesPanel` into `expanded-session-row.tsx` — replaced inline `MarkdownPanel` with panel; resolves JSON from hook state (fresh extraction) or session prop (DB); added `structured_json` to frontend `SessionRow` interface
- **End-of-part audit:** Fixed `text-white` hardcode → `text-primary-foreground` in urgency critical badge; added `className` prop to `StructuredNotesPanel`; fixed import order in `structured-notes-panel.tsx`; updated ARCHITECTURE.md (added `structured-signal-view.tsx` to file map, updated `structured-notes-panel.tsx` description)

### PRD-018 Part 1: Structured Output Migration — Core Schema & Extraction — 2026-04-10
- Created `lib/schemas/extraction-schema.ts` — Zod schema for structured signal extraction output with `EXTRACTION_SCHEMA_VERSION`, `.describe()` annotations for LLM guidance, and exported types (`ExtractedSignals`, `SignalChunk`, `RequirementChunk`, `CompetitiveMention`, `ToolAndPlatform`, `CustomCategory`)
- Created `lib/utils/render-extracted-signals-to-markdown.ts` — converts `ExtractedSignals` JSON to markdown matching the original extraction prompt output format for backward compatibility
- Created `lib/prompts/structured-extraction.ts` — system prompt and user message builder for `generateObject()` extraction; custom user prompts appended as guidance in the user message, not the system prompt
- Migrated `extractSignals()` in `ai-service.ts` from `generateText()` to `generateObject()` with `extractionSchema`; derives markdown via `renderExtractedSignalsToMarkdown()` for the `structured_notes` column
- Extracted `withRetry<T>()` generic helper in `ai-service.ts` — shared retry logic with error classification used by both `callModel()` and `callModelObject()`
- Added `structured_json` (JSONB, nullable) column to `sessions` table; updated `SessionRow`, `SessionInsert`, `SessionUpdate` in repository interface, Supabase adapter, and mock adapter
- Extended `Session`, `CreateSessionInput`, `UpdateSessionInput` in session-service with `structured_json` passthrough; `updateSession()` handles extraction vs manual-edit vs input-change scenarios for JSON column
- Updated `POST /api/ai/extract-signals` response to include `structuredJson`
- Updated `POST /api/sessions` and `PUT /api/sessions/[id]` to accept and pass through `structuredJson` (Zod `z.record(z.string(), z.unknown())`)
- Extended `useSignalExtraction` hook to store and expose `structuredJson` from extraction API response
- Updated `SessionCaptureForm` and `ExpandedSessionRow` to pass `structuredJson` through to session save (PUT only sends JSON when `isExtraction: true`)
- Used array-of-objects for `custom` field instead of `z.record()` to avoid OpenAI structured output `propertyNames` restriction
- **End-of-part audit:** SRP/DRY acceptable (renderer helpers and callModel/callModelObject diverge enough to justify separation); no dead code; import order fix in ai-service.ts; updated ARCHITECTURE.md (added `structured_json` to data model, new files to file map, updated ai-service and Key Design Decisions descriptions)

### PRD-014 Part 4: Staleness Indicators & Re-extraction Warnings — 2026-04-08
- Added `structured_notes_edited` column (boolean, default false) to `sessions` table — distinguishes manual-edit staleness from input-change staleness
- Extended `SessionRow`, `SessionUpdate`, and `Session` interfaces (repository + service) with `structured_notes_edited`; updated Supabase and mock adapters
- Enhanced staleness state machine in `updateSession()`: fresh extraction resets both flags; manual structured notes edits set `structured_notes_edited = true`; input-only changes preserve existing `structured_notes_edited` value
- Added staleness warning badge ("Extraction may be outdated") in expanded session row — amber `--status-warning` token, visually distinct from prompt version badge
- Added subtle `AlertTriangle` warning icon in collapsed table row next to Sparkles icon when `extraction_stale = true`
- Enhanced `ReextractConfirmDialog` with `hasManualEdits` prop — context-aware warning text distinguishing manual edit loss from standard re-extraction
- Added `forceConfirmOnReextract` option to `useSignalExtraction` hook — bridges server-side `structured_notes_edited` flag into client-side re-extract confirmation flow
- Created `GET /api/sessions/prompt-versions` endpoint — returns distinct prompt version IDs with computed version numbers and `hasNull` flag for pre-migration sessions
- Added `getDistinctPromptVersionIds()` to `SessionRepository` interface, Supabase adapter, and mock adapter
- Added `promptVersionId` and `promptVersionNull` filter params to `SessionListFilters`, Supabase list query, `SessionFilters` service type, and `GET /api/sessions` Zod schema
- Created `PromptVersionFilter` component — dropdown populated from prompt-versions endpoint with "All versions", "Prompt vN", and "Default prompt" options
- Wired `PromptVersionFilter` into `SessionFilters` component and `PastSessionsTable` API call
- Added "Last edited by" field to `ExpandedSessionMetadata` — resolves `updated_by` email in team context alongside `created_by` emails in a single batch query
- Added `updated_by_email` to `SessionWithClient` service interface and frontend `SessionRow` interface
- **End-of-part audit:** All P4.R1–P4.R8 requirements verified; no SRP/DRY/dead code/design token violations found; updated ARCHITECTURE.md (added `structured_notes_edited` to data model, `prompt-versions/route.ts` and `prompt-version-filter.tsx` to file map, updated current state and component descriptions)

### PRD-014 Part 3: Show Prompt Version in Past Sessions — 2026-04-08
- Created `GET /api/prompts/[id]` endpoint — fetches a single prompt version by UUID with computed version number (1-based, ordered by `created_at` ascending); Zod UUID validation, auth check, 400/401/404/500 responses with logging
- Added `findById()` method to `PromptRepository` interface and Supabase adapter — fetches a prompt version without team scoping (cross-scope traceability for historical versions)
- Added `getPromptVersionById()` wrapper in prompt-service
- Created `PromptVersionBadge` component — clickable badge in expanded session row that fetches prompt content on click, caches the result, and opens `ViewPromptDialog` with "Extraction Prompt — Version {n}" title
- Added `prompt_version_id` to frontend `SessionRow` interface; conditional badge render when non-null
- **Bug fix:** `useSignalExtraction` hook now captures and exposes `promptVersionId` from the extraction API response; `session-capture-form` (POST) and `expanded-session-row` (PUT) now pass `promptVersionId` to session save — previously the value was discarded and never stored
- Expanded session row PUT now also sends `isExtraction` and `inputChanged` flags to support the backend staleness state machine
- **End-of-part audit:** Removed unused `className` prop from `PromptVersionBadgeProps`; verified P3.R1–P3.R6 compliance; updated ARCHITECTURE.md file map (added `prompts/[id]/route.ts`, `prompt-version-badge.tsx`), hook description, and current state

### PRD-014 Part 2: View Prompt on Capture Page — 2026-04-08
- Created `ViewPromptDialog` component — reusable read-only dialog that fetches the active extraction prompt on open, renders it as markdown, includes "Edit in Settings" footer link, handles loading/error states; designed for Part 3 reuse via optional `content` prop
- Added "View Prompt" button (`ai-outline` variant) to capture form between Extract Signals and Save Session buttons
- Added `ai-outline` button variant to `button.tsx` — gold border/text with subtle gold hover background
- Extracted `PROSE_CLASSES` constant to `lib/utils.ts` — shared Tailwind prose classes now used by `ViewPromptDialog`, `MarkdownPanel`, and `MasterSignalContent` (DRY fix, 3 files consolidated)
- **End-of-part audit:** Removed unused `Eye` import and commented-out wrapper div from `view-prompt-dialog.tsx`; extracted shared prose classes; updated ARCHITECTURE.md file map, utils description, and current state

### PRD-014 Part 1: Session Traceability & Staleness Data Model — 2026-04-08
- Added `prompt_version_id` (UUID, nullable FK → prompt_versions), `extraction_stale` (boolean, default false), and `updated_by` (UUID, nullable FK → auth.users) columns to the `sessions` table
- Added partial index `sessions_prompt_version_id_idx` on `prompt_version_id` for future prompt version filtering (P4.R7)
- Extended `SessionRow`, `SessionInsert`, `SessionUpdate` interfaces and all repository adapters (Supabase + mock) with the three new fields
- Added `getActiveVersion()` method to `PromptRepository` interface and Supabase adapter — returns full `PromptVersionRow` (not just content) for traceability
- Added `markStale()` method to `SessionRepository` interface and adapters — lightweight staleness update for attachment add/remove flows
- Changed `extractSignals()` return type from `string` to `ExtractionResult` (`{ structuredNotes, promptVersionId }`) — API response now includes the prompt version ID used (P1.R6)
- Added `getActivePromptVersion()` to prompt-service — wraps the new repo method for the AI service layer
- Implemented staleness state machine in `updateSession()`: fresh extraction resets stale (P1.R5/R9), clearing structured notes clears both (P1.R8), input changes or manual edits mark stale (P1.R4)
- Added `isExtraction`, `inputChanged`, `promptVersionId` fields to PUT `/api/sessions/[id]` schema and `promptVersionId` to POST `/api/sessions`
- Attachment upload and delete routes now call `markStale()` to flag extraction staleness on attachment changes (P1.R4)
- Sessions list API (`GET /api/sessions`) includes all three new fields in the response (P1.R13)
- **End-of-part audit:** Removed unused `SessionAccessRow` import from session-service.ts; verified all P1.R1–R13 requirements traced to implementation; updated ARCHITECTURE.md data model and current state

### PRD-015 Part 1: Public Landing Page — 2026-04-07
- Added public landing page at `/` with hero section (gradient headline, pill badge, dual CTAs), 4-card feature grid, 3-step "How It Works" flow, and bottom CTA
- Features defined as a data array for easy extension as new capabilities ship
- Authenticated users auto-redirect to `/capture` with no flash of landing page
- Updated middleware to allow unauthenticated access to `/`
- Updated `AppHeader` and `AppFooter` to hide on the landing page (footer converted to client component for `usePathname` access)
- Landing page renders its own lightweight nav (logo + Get Started) and minimal footer (copyright + sign-in link)
- All styling uses existing CSS custom properties and Tailwind tokens — no new dependencies

### PRD-012 Backlog: Polish fixes — 2026-04-07
- Added missing entry logs to 3 GET route handlers (`/api/teams`, `/api/teams/[teamId]`, `/api/teams/[teamId]/members`) for logging consistency
- Extracted `TableShell` and `TableHeadCell` into `components/settings/table-shell.tsx` — shared bordered table wrapper used by `team-members-table` and `pending-invitations-table`, normalised to design tokens
- Extracted `ConfirmDialog` into `components/ui/confirm-dialog.tsx` — reusable config-driven confirmation dialog (title, description, destructive variant, loading state); replaces inline implementation in `team-members-table.tsx`
- Updated PRD-012 status to Complete; checked off all acceptance criteria across Parts 1–5; updated TRD status

### PRD-012 Part 5: Dependency Inversion — Injectable Data-Access Layer — 2026-04-07
- Introduced repository pattern: 8 interfaces in `lib/repositories/` defining data-access contracts (SessionRepository, ClientRepository, TeamRepository, MasterSignalRepository, InvitationRepository, PromptRepository, ProfileRepository, AttachmentRepository)
- Created Supabase adapter implementations in `lib/repositories/supabase/` — one per interface, instantiated via factory functions (`createSessionRepository`, `createClientRepository`, etc.)
- Extracted `scopeByTeam()` helper in `lib/repositories/supabase/scope-by-team.ts` — centralises workspace scoping logic (12+ occurrences DRY'd into one function)
- Moved `SessionNotFoundRepoError` from Supabase adapter to `session-repository.ts` interface file — eliminates service-layer coupling to the Supabase implementation
- Refactored all 8 data-access services to accept injected repository parameters instead of importing from `@/lib/supabase/server` — zero Supabase imports remain in `lib/services/`
- Updated all 21 API route handlers to create Supabase clients, instantiate repositories via factories, and pass them to services
- Created `MockSessionRepository` in `lib/repositories/mock/` — in-memory implementation demonstrating that services work with non-Supabase backends
- **End-of-PRD audit (PRD-012 complete):** Full SRP/DRY/dead-code/convention sweep across all Parts 1–5; updated ARCHITECTURE.md file map, service descriptions, key design decisions, and workspace context flow

### PRD-012 Part 4: API Route and Service Layer Cleanup — 2026-04-07
- Moved `SignalSession` type from `master-signal-service.ts` to `lib/types/signal-session.ts` — fixes dependency direction (prompts layer no longer imports from services)
- Extracted `generateOrUpdateMasterSignal()` orchestration into `master-signal-service.ts` with discriminated union return (`GenerateResult`), reducing `generate-master-signal/route.ts` from 173 → 68 lines
- Extracted `getTeamMembersWithProfiles()` and `getTeamsWithRolesForUser()` into `team-service.ts`, simplifying `teams/[teamId]/members/route.ts` (83 → 49 lines) and `teams/route.ts` GET handler
- Moved `checkSessionAccess()` from `app/api/sessions/_helpers.ts` to `session-service.ts` with discriminated union return (`SessionAccessResult`); created shared `mapAccessError()` in `lib/utils/map-access-error.ts`; deleted `_helpers.ts`
- Added Zod validation to `GET /api/clients` (`clientSearchSchema`) and `GET /api/prompts` (`promptQuerySchema`), replacing manual `VALID_PROMPT_KEYS` array with shared `PROMPT_KEYS` const used by both GET and POST schemas
- All route handlers now follow the pattern: auth → validate → service call → map result to HTTP response. No route contains inline Supabase queries for business logic.

### PRD-012 Part 3: SRP — Component Decomposition — 2026-04-07
- Extracted `SessionTableRow` + `formatDate`, `truncateNotes`, `formatEmail` helpers from `past-sessions-table.tsx` into `session-table-row.tsx` (past-sessions-table 401 → 298 lines)
- Split `expanded-session-row.tsx` (493 lines) into thin coordinator + 3 presentational subcomponents: `expanded-session-metadata.tsx` (73), `expanded-session-notes.tsx` (111), `expanded-session-actions.tsx` (118) — coordinator reduced to 349 lines with signals panel kept inline per design decision
- Split `session-capture-form.tsx` (315 lines) into coordinator + 2 subcomponents: `capture-attachment-section.tsx` (60), `structured-notes-panel.tsx` (27) — coordinator reduced to 286 lines
- Split `master-signal-page-content.tsx` (330 lines) into coordinator + hook + 3 subcomponents: `use-master-signal.ts` (170), `master-signal-status-banner.tsx` (74), `master-signal-empty-state.tsx` (76), `master-signal-content.tsx` (44) — coordinator reduced to 107 lines
- Split `prompt-editor-page-content.tsx` (497 lines) into coordinator + hook + 2 subcomponents: `use-prompt-editor.ts` (358), `prompt-master-signal-notice.tsx` (54), `prompt-unsaved-dialog.tsx` (50) — coordinator reduced to 144 lines
- All new presentational components are pure renderers with no side effects; hooks own state + logic; coordinators compose children

### PRD-012 Part 2: DRY — Shared Utilities and Patterns — 2026-04-07
- Created `lib/cookies/active-team.ts` — single source of truth for client-side `active_team_id` cookie operations (`getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie`), replacing 7+ inline implementations
- Added reactive `activeTeamId` and `setActiveTeam()` to AuthProvider context — workspace switching now updates React state instead of calling `window.location.reload()`, enabling reactive data refetching across all consuming components
- Extracted `fetchCanCreateTeam` helper within `auth-provider.tsx` — deduplicated profile query used by both auth paths
- Created `lib/hooks/use-signal-extraction.ts` — shared extraction state machine hook (`ExtractionState`, re-extract confirmation flow, `resetExtraction`) consumed by `session-capture-form.tsx` and `expanded-session-row.tsx`
- Created `components/capture/reextract-confirm-dialog.tsx` — shared presentational re-extract confirmation dialog
- Created `components/auth/auth-form-shell.tsx` — shared centered auth card layout (`title`, `subtitle`, `children`), replacing 4× duplicated full-screen centering markup in login, signup, forgot-password, and reset-password forms
- Created `components/auth/email-confirmation-panel.tsx` — shared "Check your email" success panel (`children`, `linkText`, `linkHref`), replacing 2× duplicated confirmation UI in signup and forgot-password forms
- Created `lib/utils/map-ai-error.ts` — `mapAIErrorToResponse()` shared AI error-to-HTTP mapper handling 5 error types + unexpected fallback, replacing 2× duplicated ~70-line catch blocks in `extract-signals/route.ts` and `generate-master-signal/route.ts`
- Created `components/settings/role-picker.tsx` — controlled `RolePicker` component with exported `Role` type, replacing 3× duplicated role select + type definitions in `invite-single-form.tsx`, `invite-bulk-dialog.tsx`, and `pending-invitations-table.tsx`

### PRD-012 Part 1: Design Tokens and Typography — 2026-04-07
- Added 14 status colour tokens (`--status-error`, `--status-success`, `--status-warning`, `--status-info` with `-light`, `-border`, `-text` variants) and 4 AI action tokens (`--ai-action`, `--ai-action-foreground`, `--ai-action-hover`, `--ai-action-light`) to `globals.css` using oklch colour space
- Added `ai` button variant (warm gold) to `button.tsx` CVA config
- Applied `variant="ai"` to Extract Signals, Re-extract Signals, and Generate Master Signal buttons
- Replaced all hardcoded Tailwind status colours (`text-red-500`, `bg-red-50`, `bg-green-50`, `text-green-500`, `bg-amber-*`, `text-amber-*`, `bg-blue-*`, `text-blue-*`) with CSS custom property tokens across 14 files
- Migrated `invite-shell.tsx` StatusIcon colour map from hardcoded Tailwind classes to token references
- Replaced `window.location.href = "/capture"` with `router.push("/capture")` in `login-form.tsx` and `reset-password-form.tsx`
- Replaced all `text-[10px]` arbitrary font sizes with `text-xs` across 5 files

### PRD-013 Part 4: Edge Cases & Limits — 2026-04-06
- Replaced hardcoded `.max(50000)` with `MAX_COMBINED_CHARS` constant in `extract-signals/route.ts`, `sessions/route.ts`, `sessions/[id]/route.ts`, and `session-capture-form.tsx` — server and client now reference the same shared limit
- Added input length logging to the extract-signals route before AI calls

### PRD-013 UI Polish — 2026-04-06
- Made the entire file upload zone clickable (not just the "browse" link) — added `onClick` on the container div, `cursor-pointer` styling, and hover feedback
- Moved the attachments section (upload zone, saved/pending lists, character counter) below raw notes inside the left column of the expanded session row grid
- Made saved attachment rows fully clickable to toggle expand/collapse — added `e.stopPropagation()` on download/delete buttons to prevent unintended toggles

### Bug Fix: PDF Parsing — 2026-04-06
- Downgraded `pdf-parse` from v2.4.5 to v1.1.1 — v2 depends on `DOMMatrix` and other browser APIs unavailable in Vercel's serverless runtime
- Fixed import to `pdf-parse/lib/pdf-parse` to bypass v1's test-file-loading entrypoint (`ENOENT: ./test/data/05-versions-space.pdf`)
- Removed `@types/pdf-parse` (v2 types); added custom type declaration in `types/pdf-parse.d.ts`

### Docs: Storage Bucket Name Correction — 2026-04-06
- Updated ARCHITECTURE.md, CHANGELOG.md, PRD-013, and TRD-013 to reference the actual Supabase Storage bucket name (`SYNTHESISER_FILE_UPLOAD`) instead of the previously documented `session-attachments`

### PRD-013 Part 3: Past Sessions — Attachment Display & Management — 2026-04-02
- Added `attachment_count` to `SessionWithClient` with batch-fetch in `getSessions()` — displays paperclip icon with count in collapsed session rows
- Created `GET /api/sessions/[id]/attachments` — returns non-deleted attachments for a session
- Created `GET /api/sessions/[id]/attachments/[attachmentId]/download` — generates signed download URL
- Created `saved-attachment-list.tsx` — displays persisted attachments with download, delete (with confirmation when signals exist), and view parsed content toggle
- Updated `expanded-session-row.tsx` — full attachment management: fetch saved attachments on mount, upload new via `FileUploadZone`, delete existing, compose AI input from all attachments, two-step save flow
- Relaxed `PUT /api/sessions/[id]` validation to allow empty `rawNotes` when `hasAttachments` is true
- **Code quality audit:**
  - Extracted `FILE_ICONS` to `lib/constants/file-icons.ts` — shared by `attachment-list.tsx` and `saved-attachment-list.tsx`
  - Extracted `composeAIInput()` to `lib/utils/compose-ai-input.ts` — shared by `session-capture-form.tsx` and `expanded-session-row.tsx`
  - Extracted `uploadAttachmentsToSession()` to `lib/utils/upload-attachments.ts` — shared by `session-capture-form.tsx` and `expanded-session-row.tsx`
  - Renamed `checkSessionWriteAccess` → `checkSessionAccess` — accurately reflects its use for both read and write operations

### PRD-013 Part 2: Persistence & Signal Extraction Integration — 2026-04-02
- Created `session_attachments` table with RLS (personal + team-scoped) and `SYNTHESISER_FILE_UPLOAD` Storage bucket
- Created `lib/services/attachment-service.ts` — `uploadAndCreateAttachment`, `getAttachmentsBySessionId`, `deleteAttachment` (soft-delete DB + hard-delete Storage), `getSignedDownloadUrl`, `getAttachmentCountForSession`
- Created `POST /api/sessions/[id]/attachments` — multipart upload endpoint with file size/type/count validation
- Created `DELETE /api/sessions/[id]/attachments/[attachmentId]` — soft-delete attachment + hard-delete from Storage
- Updated `POST /api/sessions` — relaxed `rawNotes` to allow empty when `hasAttachments` is true
- Updated `session-capture-form.tsx` — two-step save flow (save session JSON → upload attachments via multipart)
- Updated `attachment-list.tsx` — added "View content" toggle showing parsed text read-only
- Extracted `checkSessionWriteAccess` shared helper to `app/api/sessions/_helpers.ts` — eliminates duplicated auth/permission checks across `[id]/route.ts`, attachments POST, and attachments DELETE routes
- Extracted `formatFileSize` to `lib/utils/format-file-size.ts` — shared by `file-upload-zone.tsx` and `attachment-list.tsx`
- Removed unused `getActiveTeamId` import from `attachment-service.ts`

### PRD-013 Part 1: File Upload Infrastructure — 2026-04-02
- Created `lib/constants.ts` with file upload limits (`MAX_FILE_SIZE_BYTES`, `MAX_COMBINED_CHARS`, `MAX_ATTACHMENTS`, `ACCEPTED_FILE_TYPES`, `ACCEPTED_EXTENSIONS`)
- Created `lib/services/file-parser-service.ts` with parsers for TXT, PDF, CSV, DOCX, JSON files and WhatsApp/Slack chat format detection and restructuring
- Created `POST /api/files/parse` stateless API route — accepts `multipart/form-data`, validates file, returns parsed content with `source_format`
- Created `file-upload-zone.tsx` — drag-and-drop upload zone with inline validation, multi-file support, and server-side parse calls
- Created `attachment-list.tsx` — displays attached files with type icon, size, format badge, and remove button
- Integrated file attachments into `session-capture-form.tsx` — combined character counter (notes + attachments vs 50k limit), composed AI input merges raw notes with attachment content, attachments sent in save payload, form reset clears attachments
- Installed `pdf-parse`, `mammoth`, `papaparse` npm packages with TypeScript type definitions

### PRD-011: Email + Password Authentication — 2026-04-02
- **Part 1 — Sign-Up & Sign-In:** Created `/signup` page with email/password form (Zod validation: 8+ chars, 1 digit, 1 special char), email confirmation flow via Supabase, and Google OAuth button. Updated `/login` with email/password form alongside existing Google OAuth. Added shared `PasswordInput` component (toggleable show/hide) and `passwordField` Zod schema in `lib/schemas/password-schema.ts`. Created `GoogleIcon` shared component.
- **Part 2 — Password Reset:** Created `/forgot-password` page (sends reset email via `supabase.auth.resetPasswordForEmail` with `type=recovery` redirect). Created `/reset-password` page (new password + confirm, calls `supabase.auth.updateUser`). Auth callback handles `type=recovery` and redirects to reset page.
- **Part 3 — Invite Flow:** Updated `/invite/[token]` with four states: authenticated + email match (accept card), authenticated + mismatch (warning + sign-out option), unauthenticated + existing user (sign-in form with pre-filled email), unauthenticated + new user (sign-up form with pre-filled email). Email match verification in auth callback prevents wrong-account acceptance. Created `invite-sign-in-form.tsx`, `invite-sign-up-form.tsx`, `invite-accept-card.tsx`, `invite-mismatch-card.tsx`, `invite-shell.tsx`, `invite-helpers.ts`.
- **Part 4 — Middleware:** Added `/signup`, `/forgot-password`, and `/invite/*` to public routes. `/reset-password` requires authentication (user arrives via recovery link which establishes session). Authenticated users redirected away from auth pages to `/capture`.

### Workspace Switcher: Always Visible + Create Team in Dropdown — 2026-04-02
- Workspace switcher now renders for all authenticated users (not just those with teams)
- Shows a skeleton shimmer while loading instead of disappearing
- "Create Team" option moved inside the dropdown (gated by `canCreateTeam`)
- Non-paid users see a disabled "Team workspaces — contact us" hint (passive CTA)
- Standalone "Create Team" button removed from app header
- `CreateTeamDialog` converted to controlled component (`open`/`onOpenChange` props)
- Fixed `router.refresh()` → `window.location.reload()` in both workspace switcher and create team dialog

### Email Provider: Add Brevo Adapter — 2026-04-02
- Added Brevo adapter to `email-service.ts` using `@getbrevo/brevo` SDK
- `EMAIL_PROVIDER` now supports `resend` and `brevo` — switch via env var
- Added `BREVO_API_KEY` env var; only the active provider's key is required
- Added `parseFromAddress()` helper to extract name/email from `EMAIL_FROM` format
- Resend adapter unchanged

### PRD-010 Part 7: Team Management — Members, Roles, and Ownership — 2026-04-02
- Added team management service functions: `renameTeam`, `deleteTeam`, `removeMember`, `changeMemberRole`, `transferOwnership`, `leaveTeam` (with `LeaveBlockedError`)
- Created API routes: `GET/PATCH/DELETE /api/teams/[teamId]`, `GET /api/teams/[teamId]/members`, `DELETE /api/teams/[teamId]/members/[userId]`, `PATCH /api/teams/[teamId]/members/[userId]/role`, `POST /api/teams/[teamId]/transfer`, `POST /api/teams/[teamId]/leave`
- Owner can rename/delete team, remove any member, change roles, transfer ownership
- Admin can remove sales members; sales have no management actions (except leave)
- Owner leaving auto-transfers ownership to the oldest admin; blocked if no other admins exist
- Created `team-members-table.tsx`: member list with contextual actions (remove, role change, transfer, leave) and confirmation dialogs
- Created `team-danger-zone.tsx`: rename input + delete button with type-to-confirm safety dialog (owner only)
- Updated `team-settings.tsx` to integrate members table and danger zone
- Updated `settings-page-content.tsx` to resolve and pass `ownerId`, `isOwner` to team settings

### PRD-010 Part 6: Team-Scoped Master Signal and Prompts — 2026-04-02
- Scoped all `master-signal-service.ts` functions by `team_id` via `getActiveTeamId()`: `getLatestMasterSignal`, `getStaleSessionCount`, `getAllSignalSessions`, `getSignalSessionsSince`, `saveMasterSignal`
- Scoped all `prompt-service.ts` functions by `team_id`: `getActivePrompt`, `getPromptHistory`, `savePromptVersion` (deactivation scoped to workspace)
- Added admin role check to `POST /api/ai/generate-master-signal` and `POST /api/prompts` in team context (403 for sales)
- Master signal page hides generate button for non-admin team members, shows info banner
- Prompt editor accepts `readOnly` prop — sales members see prompts in view-only mode with info banner
- `VersionHistoryPanel` and `VersionViewDialog` hide revert buttons when `onRevert` is not provided
- `SettingsPageContent` passes `readOnly` for non-admin team members

### PRD-010 Part 5: Team-Scoped Data — Sessions and Clients — 2026-04-02
- Scoped `getSessions` and `createSession` by `team_id` via `getActiveTeamId()` in `session-service.ts`
- Scoped `searchClients` and `createNewClient` by `team_id` in `client-service.ts`
- `taintLatestMasterSignal` accepts optional `teamId` for team-scoped tainting
- `deleteSession` passes `team_id` to taint function
- Added `checkTeamSessionPermission` to `PUT/DELETE /api/sessions/[id]` — sales can only modify own sessions, admins can modify any
- Added "Captured by" column in past sessions table (team context only, shows email local part)
- `SessionRow` interface includes `created_by` and `created_by_email`
- `ExpandedSessionRow` accepts `canEdit` — read-only view with "View only" message for non-permitted users
- `MarkdownPanel` accepts `readOnly` prop to hide edit toggle
- Resolved creator emails via `profiles` table in `getSessions` for team attribution

### PRD-010 Part 4: Workspace Switcher and Context Management — 2026-04-02
- Added `getActiveTeamId()` to `lib/supabase/server.ts` for reading the `active_team_id` cookie server-side
- Middleware validates `active_team_id` cookie on every request — clears if user is no longer a team member
- Created `workspace-switcher.tsx`: dropdown showing Personal + all teams with roles, sets/clears cookie on switch
- Integrated workspace switcher into `app-header.tsx` (visible only when user has team memberships)
- Created `GET /api/teams` route to list user's teams with roles

### PRD-010 Part 3: Invite Acceptance and Join Flow — 2026-04-02
- Created `/invite/[token]` server page with `InvitePageContent` client component
- Handles four states: valid (join), expired, already accepted, invalid — with appropriate UI for each
- Authenticated users see "Accept & Join Team" button (calls `POST /api/invite/[token]/accept`)
- Unauthenticated users see "Sign in with Google to join" (sets `pending_invite_token` cookie, redirects through OAuth)
- Auth callback (`/auth/callback`) checks for `pending_invite_token` cookie, auto-accepts invitation and sets `active_team_id`
- Added `getInvitationByToken` and `acceptInvitation` to `invitation-service.ts` (service role client for RLS bypass)
- Middleware allows `/invite` as a public route

### PRD-010 Part 2: Team Creation and Invite Flow — 2026-04-02
- Created `team-service.ts` with `createTeam`, `getTeamsForUser`, `getTeamById`, `getTeamMember`, `getActiveTeamMembers`
- Created `invitation-service.ts` with `createInvitations`, `getPendingInvitations`, `revokeInvitation`, `resendInvitation`
- Created invite email template in `lib/email-templates/invite-email.ts`
- Created API routes: `POST /api/teams`, `GET/POST /api/teams/[teamId]/invitations`, `DELETE/POST .../[invitationId]`, `.../[invitationId]/resend`
- Created `create-team-dialog.tsx` for team creation (visible when `can_create_team = true`)
- Created `team-settings.tsx`, `invite-single-form.tsx`, `invite-bulk-dialog.tsx`, `pending-invitations-table.tsx`
- Created `settings-page-content.tsx` wrapping prompt editor and team settings in tabs (admin only)

### PRD-010 Part 1: Database Schema and Email Service — 2026-04-02
- Created `teams`, `team_members`, `team_invitations` tables with RLS policies
- Added `can_create_team` to `profiles` table
- Added nullable `team_id` column to `sessions`, `clients`, `master_signals`, `prompt_versions`
- Created helper functions: `is_team_member()`, `get_team_role()`, `is_team_admin()` (SECURITY DEFINER)
- Created provider-agnostic `email-service.ts` with `sendEmail()`, `resolveEmailProvider()`, Resend adapter
- Added `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` env vars

### PRD-009 Part 1: AI Provider Abstraction — 2026-04-02
- Replaced `@anthropic-ai/sdk` with the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`)
- Replaced `callClaude()` with provider-agnostic `callModel()` using `generateText()` from the Vercel AI SDK
- Added `resolveModel()` factory that reads `AI_PROVIDER` and `AI_MODEL` env vars and returns the correct SDK model instance
- Supports Anthropic, OpenAI, and Google providers at launch — switching is a one-line env var change
- Replaced Anthropic-specific error class checks with generic `APICallError` status code inspection for retry logic
- Replaced `CLAUDE_MODEL` env var with `AI_PROVIDER` + `AI_MODEL`
- Public API (`extractSignals`, `synthesiseMasterSignal`) unchanged — no caller modifications
- Updated `.env.example`, `ARCHITECTURE.md`, `CLAUDE.md`

### PRD-008 Part 3: Remove Admin Role System — 2026-04-02
- Removed admin gate from Settings page — all authenticated users can access `/settings` and customise their prompts
- Settings tab now visible in navigation for all users
- Removed `isCurrentUserAdmin()` checks from `GET /api/prompts` and `POST /api/prompts` — access control handled by RLS
- Removed `isAdmin` from `AuthProvider` context and `AuthContextValue` interface
- Deleted `lib/hooks/use-profile.ts` (only fetched the admin flag)
- Removed `isCurrentUserAdmin()` from `profile-service.ts` — `getCurrentProfile()` retained
- `is_admin` column on `profiles` and `is_admin()` SQL function retained in database for potential future use

### PRD-008 Part 2: Per-User Data Isolation — 2026-04-02
- Added `created_by` column to `clients` table with per-user RLS policies and unique index `(LOWER(name), created_by)`
- Updated RLS policies on `sessions` — SELECT and UPDATE now scoped to `created_by = auth.uid()`
- Updated RLS policy on `master_signals` — SELECT now scoped to `created_by = auth.uid()`
- Added `created_by` column to `prompt_versions` table with per-user RLS policies and unique index `(prompt_key, created_by)`
- `taintLatestMasterSignal` now accepts a `userId` parameter to target the correct user's master signal
- `deleteSession` passes the session's `created_by` to the taint function
- `getActivePrompt` and `savePromptVersion` switched from service role client to user-scoped `createClient()` — RLS handles per-user scoping
- System-seeded prompt rows (`created_by = NULL`) are no longer visible via RLS; users fall back to hardcoded defaults

### PRD-008 Part 1: Remove Email Domain Restriction — 2026-04-02
- Removed `ALLOWED_EMAIL_DOMAIN` environment variable and email domain check from the OAuth callback — any Google account can now sign in
- Simplified `app/auth/callback/route.ts` — after successful code exchange, redirects straight to `/capture`
- Removed `domain_restricted` error block from the login page
- Deleted `lib/constants.ts` (its only export was `ALLOWED_EMAIL_DOMAIN`)
- Removed unused `useSearchParams` / `Suspense` from login page
- Updated `.env.example`, `ARCHITECTURE.md`, `CLAUDE.md`

### Rebrand: Accelerate Synthesis → Synthesiser — 2026-04-02
- Renamed product from "Accelerate Synthesis" to "Synthesiser" across all UI, metadata, and PDF output
- Removed InMobi and ad-tech specific context from all AI prompts (signal extraction, master signal cold start, master signal incremental) — prompts are now industry-agnostic
- Made login page domain restriction error message generic ("Access restricted to authorised email domains") instead of hardcoded "@inmobi.com"
- Updated package name from "accelerate-synthesis" to "synthesiser"
- Updated all documentation (ARCHITECTURE.md, CLAUDE.md, master PRD, section PRDs/TRDs, seed SQL)

### PRD-007 Part 1: Prompt Editor — View Alternate Master Signal Prompt — 2026-03-30
- Added contextual note above the editor on the Master Signal tab explaining which prompt variant is loaded (cold-start or incremental) and when it's used
- Added inline toggle link to switch between cold-start and incremental prompts without leaving the tab
- Both prompt variants are fully editable — save, reset to default, version history, and revert all work on the toggled variant
- Auto-selected prompt (based on app state) shows an "(active)" badge; alternate prompt does not
- Toggle respects the existing dirty-state guard — switching with unsaved changes triggers the discard confirmation dialog
- Toggle resets when switching between top-level tabs (Signal Extraction ↔ Master Signal)
- New state (`isViewingAlternate`) and derived keys (`autoSelectedMasterKey`, `alternateMasterKey`, `displayedMasterKey`, `effectiveKey`) in `prompt-editor-page-content.tsx`

### PRD-006 Part 1 Increments 1.1–1.3: Master Signal Cleanup on Session Deletion — 2026-03-30
- Added `is_tainted` (BOOLEAN, default false) column to `master_signals` table
- When a session with `structured_notes` is soft-deleted, the latest master signal is marked as tainted via `taintLatestMasterSignal()` in `master-signal-service.ts` (best-effort, doesn't fail the deletion)
- `deleteSession()` in `session-service.ts` now selects `structured_notes` and conditionally taints the master signal
- `POST /api/ai/generate-master-signal` checks `isTainted` on the latest master signal — if tainted, forces a cold-start rebuild (all active sessions) instead of incremental merge, purging deleted session data
- `GET /api/master-signal` response now includes `isTainted` flag
- Master Signal page (`/m-signals`) shows a tainted-specific amber banner: "A session with extracted signals was deleted — regenerate to remove its data from the master signal." (takes priority over standard staleness banner; combines both messages when both conditions are true)
- Settings page (`/settings`) prompt editor now resolves the Master Signal tab to the cold-start prompt when the master signal is tainted, since that's the prompt that will be used on the next generation
- `MasterSignal` TypeScript interface updated with `isTainted: boolean` across service, API, and frontend layers

### PRD-005 UX Improvement: Dynamic Master Signal Tab — 2026-03-27
- Consolidated three prompt tabs into two: "Signal Extraction" and "Master Signal"
- The Master Signal tab dynamically resolves to the cold start or incremental prompt by checking `GET /api/master-signal` on mount — if a master signal exists, edits the incremental prompt; otherwise edits the cold start prompt
- Removed the confusing cold start / incremental distinction from the UI; the system selects the correct prompt automatically

### PRD-005 Part 4 Increment 4.2: Version View Dialog + Revert Wiring — 2026-03-27
- Created `version-view-dialog.tsx`: read-only dialog showing full prompt content for any past version, with version number, active badge, author email, relative timestamp in the header, and "Revert to this version" button (hidden for active version)
- Wired "View" button in version history panel to open the dialog with the selected version's content
- Wired "Revert" button in both the history panel and the dialog to POST the old content as a new active version and refetch history
- Dialog closes automatically after a successful revert

### PRD-005 Part 4 Increment 4.1: Version History Panel — 2026-03-27
- Created `format-relative-time.ts` utility for relative timestamps ("just now", "5m ago", "3h ago", "2d ago", or formatted date for older entries)
- Created `version-history-panel.tsx`: collapsible panel below the editor action bar showing all prompt versions newest-first, with computed version numbers (oldest = v1), "Active" badge, author email, relative timestamp, 100-char content preview, and View/Revert buttons
- Modified `prompt-editor-page-content.tsx` to store history from API response, render the panel, toggle open/closed, and handle revert via existing POST endpoint

### PRD-005 Part 3 Increments 3.1–3.2: Prompt Editor UI — 2026-03-27
- Created `prompt-editor.tsx`: monospace textarea component with full-height flex layout, loading skeleton, and spellcheck disabled
- Created `prompt-editor-page-content.tsx`: main client component with tab layout (signal extraction, master signal cold start, master signal incremental), API fetch on tab switch, dirty tracking (originalContent vs currentContent), save handler (POST to /api/prompts), reset-to-default handler (POST hardcoded default), character count, unsaved changes dialog on tab switch, and `beforeunload` guard for browser navigation
- Updated `app/settings/page.tsx` to render `PromptEditorPageContent` for admin users
- Full-width/full-height editor layout using flex column chain from layout → page → tabs → textarea

### PRD-005 Part 2 Increment 2.3: Prompt API Routes — 2026-03-27
- Created `GET /api/prompts?key=<prompt_key>`: returns active prompt and full version history, admin-only (403 for non-admins)
- Created `POST /api/prompts`: saves a new prompt version and makes it active, Zod-validated input, admin-only
- Both routes use `isCurrentUserAdmin()` guard and return appropriate HTTP status codes

### PRD-005 Part 2 Increment 2.2: Prompt Service + AI Service Integration — 2026-03-27
- Created `lib/services/prompt-service.ts` with `getActivePrompt()` (service role client), `getPromptHistory()` (anon client), and `savePromptVersion()` (service role client, atomic deactivate + insert)
- Modified `lib/services/ai-service.ts` to read active prompts from the database with hardcoded fallback — `extractSignals()` reads `signal_extraction`, `synthesiseMasterSignal()` reads `master_signal_cold_start` or `master_signal_incremental`
- Hardcoded prompt constants in `lib/prompts/` retained as fallback defaults

### PRD-005 Part 1 Increments 1.2–1.3: Admin Role System — 2026-03-27
- Created `lib/services/profile-service.ts` with `getCurrentProfile()` and `isCurrentUserAdmin()` (server-side, anon client respecting RLS)
- Created `lib/hooks/use-profile.ts` with `useProfile()` hook for fetching admin flag from the browser client
- Extended `AuthProvider` with `isAdmin` via `useProfile` hook; `isLoading` now includes profile fetch to prevent UI flicker
- Modified `tab-nav.tsx` to conditionally show Settings tab for admin users
- Created `app/settings/page.tsx` with server-side admin gate (access-denied state for non-admins)

### PRD-005 Part 1 Increment 1.1 + Part 2 Increment 2.1: Database Migrations — 2026-03-27
- Created `profiles` table with FK to `auth.users`, `is_admin` flag, RLS (users can read own profile), auto-create trigger on signup, backfill for existing users, initial admin seed
- Created `prompt_versions` table with CHECK constraint on `prompt_key`, `is_active` flag, partial unique index (one active per key), RLS via `SECURITY DEFINER` `is_admin()` function
- Seeded three initial prompt versions (signal extraction, master signal cold start, master signal incremental) from hardcoded defaults

### PRD-004 Part 1 Increment 1.5: PDF Download — 2026-03-26
- Installed `pdf-lib` for client-side PDF generation (no server round-trip needed)
- Implemented `master-signal-pdf.ts` using pdf-lib: parses master signal markdown into headings, paragraphs, bullets, and numbered lists, renders them as a styled A4 PDF with branded header, metadata bar, word wrapping, and automatic page breaks
- "Download PDF" button dynamically imports pdf-lib to avoid bloating the initial bundle, generates the PDF in-browser, and triggers a file download
- PDF includes: indigo-branded title bar, generation timestamp + session count, all markdown sections with proper heading hierarchy, bullet/numbered lists, and horizontal rules

### PRD-004 Part 1 Increment 1.4: Frontend Page + Tab Navigation — 2026-03-26
- Created `/m-signals` page with server component and `MasterSignalPageContent` client component
- Page states: loading spinner, empty (no sessions), empty (ready to generate with session count), has master signal (rendered markdown)
- Staleness banner: amber warning showing count of new/updated sessions since last generation
- Generate button: "Generate Master Signal" (cold start) / "Re-generate" (incremental), Loader2 spinner during generation, disabled during processing
- Download PDF button: initially used browser print-to-PDF, replaced in Increment 1.5 with client-side pdf-lib generation
- Metadata bar below header shows generation timestamp and session count
- Master signal content rendered with `react-markdown` + `remark-gfm` + prose styling
- Error handling: toast on API failure, previous master signal preserved on screen
- Added "Master Signals" tab (BarChart3 icon) to `tab-nav.tsx` at `/m-signals`

### PRD-004 Part 1 Increment 1.3: API Routes — 2026-03-26
- Created `POST /api/ai/generate-master-signal` route: triggers cold start or incremental master signal generation via Claude, persists result, returns unchanged if no new sessions since last generation, maps AI errors to user-friendly HTTP responses
- Created `GET /api/master-signal` route: returns the latest master signal and a staleness count (number of sessions updated since last generation)
- Both routes include auth checks (401 if unauthenticated)
- Failed generation never overwrites a good previous master signal

### PRD-004 Part 1 Increment 1.2: AI Prompt + Synthesis Function — 2026-03-26
- Created `lib/prompts/master-signal-synthesis.ts` with two system prompts: cold start (full synthesis from all sessions) and incremental (merge new sessions into existing master signal), plus a user message builder that formats sessions as labeled blocks
- Added `synthesiseMasterSignal()` to `lib/services/ai-service.ts`: accepts sessions + optional previous master signal, selects the appropriate prompt, returns synthesised markdown
- Refactored `ai-service.ts` to extract shared retry logic into a private `callClaude()` helper — both `extractSignals()` and `synthesiseMasterSignal()` use it, eliminating duplicated retry code
- Master signal uses `max_tokens: 8192` (vs 4096 for individual extraction) to accommodate the larger synthesised output

### PRD-004 Part 1 Increment 1.1: Master Signal Database Table + Service Layer — 2026-03-26
- Created `master_signals` table in Supabase: immutable rows, each generation inserts a new snapshot, latest by `generated_at` is the current one
- RLS: authenticated users can SELECT and INSERT (no UPDATE/DELETE — rows are immutable)
- Index: `master_signals_generated_at_idx` (DESC) for fast "get latest" queries
- Created `lib/services/master-signal-service.ts` with five functions: `getLatestMasterSignal`, `getStaleSessionCount`, `getAllSignalSessions`, `getSignalSessionsSince`, `saveMasterSignal`
- SQL migration script saved at `docs/004-master-signals/001-create-master-signals-table.sql`

### Bug Fix: Session Delete + Client Combobox UX — 2026-03-26
- Fixed soft-delete failing due to RLS `WITH CHECK (deleted_at IS NULL)` blocking updates that set `deleted_at`: `deleteSession()` now uses a service role client to bypass RLS for this server-only admin operation
- Added `createServiceRoleClient()` factory to `lib/supabase/server.ts`
- Revamped `ClientCombobox` from a popover/combobox pattern to a type-to-create-first text input: typing defaults to "create new client", existing matches appear as suggestions below, "Create" option is always listed first when the name doesn't exactly match an existing client
- Removed dependency on `cmdk` Command/Popover components from the client combobox (now uses a plain input with a custom dropdown)

### PRD-003 Part 4: Past Sessions — Side-by-Side View with Signal Extraction — 2026-03-26
- Restructured expanded rows in `PastSessionsTable` with a two-column CSS grid layout (`grid-cols-1 md:grid-cols-2`)
- Left column: raw notes displayed in a read-only-by-default `MarkdownPanel` (rendered markdown with edit toggle)
- Right column: structured notes panel with Extract Signals / Re-extract button, empty state, loading spinner, and `MarkdownPanel` for viewing/editing extracted signals
- Added Sparkles icon indicator on collapsed rows for sessions that have structured notes (enriched sessions)
- Signal extraction in expanded rows mirrors the capture form: calls `POST /api/ai/extract-signals`, icon progression (Sparkles → Loader2 → RefreshCw), re-extraction confirmation dialog when structured notes have been edited
- Updated dirty tracking to include `structuredNotes` comparison against the original session value
- Save payload from expanded rows now includes `structuredNotes` (preserves existing value if unchanged, sends updated value if modified or newly extracted)
- Replaced raw `Textarea` import with `MarkdownPanel` for both raw notes and structured notes display

### PRD-003 Part 3: Capture Form — Extract Signals UX — 2026-03-26
- Added `react-markdown`, `remark-gfm`, and `@tailwindcss/typography` dependencies for markdown rendering
- Configured `@tailwindcss/typography` plugin via `@plugin` directive in `globals.css`
- Created `MarkdownPanel` component (`markdown-panel.tsx`) — reusable view/edit panel with rendered markdown preview (prose styling) and raw markdown textarea edit mode, toggled via Eye/Pencil icons
- Added "Extract Signals" button to `SessionCaptureForm` with icon progression: Sparkles (idle) → Loader2 spinner (extracting) → RefreshCw (re-extract)
- Extraction calls `POST /api/ai/extract-signals`, displays structured output in a `MarkdownPanel` below the notes field
- Structured notes are editable in the panel — users can reword, add, or remove signals before saving
- Re-extraction with dirty (edited) structured notes shows a confirmation dialog before overwriting
- Save payload now includes `structuredNotes` (null if not extracted); extraction state resets on successful save
- Signal extraction is optional — sessions can be saved with only raw notes

### PRD-003 Part 2: Signal Extraction via Claude API — 2026-03-26
- Added `POST /api/ai/extract-signals` endpoint that accepts raw session notes and returns a structured markdown signal report via Claude
- Created `lib/prompts/signal-extraction.ts` with the system prompt defining all signal categories (Pain Points, Must-Haves, Aspirations, Competitive Mentions, Blockers, Platforms & Channels, Current Stack, Other/Uncategorised) plus session-level attributes (Summary, Sentiment, Urgency, Decision Timeline) and Client Profile
- Created `lib/services/ai-service.ts` with `extractSignals()` function, exponential backoff retry (up to 3 retries for 429/500/timeout), and typed error classes (`AIServiceError`, `AIEmptyResponseError`, `AIRequestError`, `AIConfigError`)
- Route validates auth (401), input via Zod (400), and maps AI errors to user-friendly HTTP responses (400/422/500/503)

### PRD-003 Part 1: Database Schema Update for Signal Extraction — 2026-03-26
- Added `structured_notes` (TEXT, nullable) column to `sessions` table for storing markdown-formatted signal extraction output
- Updated `GET /api/sessions` response to include `structured_notes` field
- Updated `POST /api/sessions` and `PUT /api/sessions/[id]` to accept optional `structuredNotes` in request body
- PUT supports "omit = preserve" semantics: omitting `structuredNotes` preserves existing value, sending `null` clears it
- Updated service layer interfaces (`Session`, `CreateSessionInput`, `UpdateSessionInput`) and query functions

### PRD-002 Part 3 Increment 3.4: Expandable Rows with Inline Editing — 2026-03-25
- Added expandable row inline editing to `PastSessionsTable`: click a row to expand it with editable client combobox, date picker, and textarea pre-populated with session data
- Added Save, Cancel, and Delete actions in expanded rows: Save calls `PUT /api/sessions/[id]`, Delete shows inline confirmation then calls `DELETE /api/sessions/[id]`
- Added dirty state tracking: compares current form values to original session snapshot
- Created `UnsavedChangesDialog` component: Save/Discard/Cancel prompt when switching rows with unsaved changes (P3.R9)
- Moved expand/collapse state management fully into `PastSessionsTable` (simplified `CapturePageContent`)
- Delete confirmation uses inline confirm/cancel buttons (no modal) for faster interaction

### PRD-002 Part 3 Increment 3.3: Past Sessions Table UI — 2026-03-25
- Created `ClientFilterCombobox` component: searches clients with `hasSession=true`, no "create new" option, includes clear button
- Created `SessionFilters` component: horizontal filter bar with client combobox and date range pickers (From/To), individual clear buttons, date auto-sync (From adjusts To if past it, and vice versa)
- Created `PastSessionsTable` component: fetches sessions with server-side filters and offset-based pagination, "Load more" button, empty state
- Created `CapturePageContent` client wrapper: manages `refreshKey` between form and table
- Updated `SessionCaptureForm` to accept `onSessionSaved` callback prop
- Updated `DatePicker` to accept optional `min`/`max` props

### PRD-002 Part 3 Increment 3.2: Session Update and Delete API — 2026-03-25
- Added `updateSession()` and `deleteSession()` to `session-service.ts`: update supports client change (including new client creation), delete sets `deleted_at`
- Created `PUT /api/sessions/[id]` route handler: Zod validation, handles 404/409 errors
- Created `DELETE /api/sessions/[id]` route handler: soft-delete with 404 handling

### PRD-002 Part 3 Increment 3.1: Session List API and Service — 2026-03-25
- Added `getSessions()` to `session-service.ts`: joins sessions with clients, supports clientId/dateFrom/dateTo filters, offset-based pagination with total count
- Added `GET /api/sessions` route handler: Zod-validated query params, returns `{ sessions, total }`
- Extended `searchClients()` with optional `hasSession` filter: queries distinct client_ids from sessions table
- Updated `GET /api/clients` route handler to support `hasSession=true` query param

### PRD-002 Part 2 Increment 2.2: Session Capture Form and Page Update — 2026-03-25
- Created `DatePicker` component (`app/capture/_components/date-picker.tsx`): styled native date input, future dates blocked via `max` attribute
- Created `SessionCaptureForm` component (`app/capture/_components/session-capture-form.tsx`): react-hook-form + zod, three fields (client combobox, date picker, notes textarea), disabled-until-valid submit, toast on success/failure, form reset on save
- Replaced capture page placeholder with the real `SessionCaptureForm`
- Added `Toaster` from sonner to root layout for toast notifications

### PRD-002 Part 2 Increment 2.1: Session Service and API Route — 2026-03-25
- Created `session-service.ts` (`lib/services/session-service.ts`): orchestrates client creation (if new) and session insertion in a single flow
- Created `POST /api/sessions` route handler: Zod validation with conditional `clientName` requirement via `refine()`, 201 on success, 409 for duplicate clients, 400 for validation errors

### PRD-002 Part 1 Increment 1.3: Client Combobox Component — 2026-03-25
- Created `command.tsx` and `popover.tsx` shadcn/ui primitives (cmdk + radix popover)
- Created `ClientCombobox` component (`app/capture/_components/client-combobox.tsx`): debounced search (300ms), keyboard navigation, "Create new client" option with inline confirmation text
- Installed `cmdk` package

### PRD-002 Part 1 Increment 1.2: Client API Routes and Service — 2026-03-25
- Created `client-service.ts` (`lib/services/client-service.ts`): `searchClients()` with case-insensitive partial match, `createNewClient()` with duplicate detection via `ClientDuplicateError`
- Created `GET /api/clients` route handler: search by query param `q`, returns up to 50 matches
- Created `POST /api/clients` route handler: Zod validation, 201 on success, 409 on duplicate name

### PRD-002 Part 1 Increment 1.1: Database Schema — 2026-03-25
- Created `clients` table: UUID PK, name (case-insensitive unique), timestamps, soft delete
- Created `sessions` table: UUID PK, FK to clients, session_date, raw_notes, created_by (auth.uid()), timestamps, soft delete
- Added RLS policies on both tables (authenticated users only, soft-delete filtering on SELECT)
- Created `update_updated_at()` shared trigger function for both tables
- Added indexes: `clients_name_unique`, `sessions_client_id_idx`, `sessions_session_date_idx`

### PRD-001 Part 2 Increment 2.2: Middleware, AuthProvider, and User Menu — 2026-03-25
- Created route protection middleware (`middleware.ts`): redirects unauthenticated users to `/login`, refreshes sessions via `getUser()`, redirects authenticated users away from `/login`
- Created `AuthProvider` context (`components/providers/auth-provider.tsx`): exposes `user`, `isAuthenticated`, `isLoading`, `signOut` via React context with `onAuthStateChange` subscription
- Wrapped root layout with `AuthProvider`
- Wired `UserMenu` to auth context: loading skeleton, sign-in link when unauthenticated, Google avatar + email + sign-out dropdown when authenticated
- Added `lh3.googleusercontent.com` to `next.config.ts` image remote patterns for Google avatars

### PRD-001 Part 2 Increment 2.1: Supabase Clients, Login Page, OAuth Callback — 2026-03-25
- Created server-side Supabase client factory (`lib/supabase/server.ts`) using `@supabase/ssr` with cookie helpers
- Created browser-side Supabase client factory (`lib/supabase/client.ts`)
- Created shared constants file (`lib/constants.ts`) with `ALLOWED_EMAIL_DOMAIN`
- Created `/login` page with "Sign in with Google" button and domain-restricted error display
- Created `/auth/callback` route handler: exchanges OAuth code, verifies email domain, redirects accordingly

### PRD-001 Part 1: App Shell and Navigation — 2026-03-25
- Added brand CSS tokens to `globals.css` (indigo/purple primary, surface and text tokens)
- Created `AppHeader` component with app name, `TabNav`, and `UserMenu`
- Created `TabNav` with route-based active state and indigo underline indicator
- Created placeholder `UserMenu` (avatar + "Sign in" text)
- Created `/capture` placeholder page ("Coming soon")
- Updated root layout with proper metadata ("Synthesiser") and `AppHeader`
- Root `/` now redirects to `/capture`

### Project Setup — 2026-03-23
- Created project structure: `CLAUDE.md`, `ARCHITECTURE.md`, `CHANGELOG.md`
- Created Master PRD (`docs/master-prd/prd.md`) with 5 sections covering the full product scope
- Established development conventions and process in `CLAUDE.md`
- Initialized Next.js app with TypeScript, Tailwind, shadcn/ui
- Restructured doc hierarchy: Master PRD (sections) → Section PRDs (parts) → TRDs (increments) → PRs
- Created Foundation PRD (`docs/001-foundation/prd.md`) with 3 parts: App Shell, Authentication, Database Schema
