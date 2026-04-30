# Synthesiser — Architecture

> **This document reflects what is actually built — not what is planned.** It is the source of truth for the current state of the system. It is updated *after* every change that modifies file structure, routes, services, database tables, or environment variables. Read this before making any changes.
>
> For planned features and requirements, see the PRD and TRD in `docs/`.

## Overview

Synthesiser is a web application for teams to capture structured client session notes and view a live synthesis dashboard of cross-client themes, signal strength, and roadmap gaps.

**Tech Stack:**
- Frontend & API: Next.js (App Router, TypeScript)
- Database: Supabase (PostgreSQL + Row-Level Security)
- Authentication: Google OAuth via Supabase Auth
- AI: Vercel AI SDK (server-side only) — supports Anthropic, OpenAI, Google via env-var-driven provider selection
- Hosting: Vercel
- Styling: Tailwind CSS + shadcn/ui

---

## Current State

**Status:** PRD-002 through PRD-010 implemented. PRD-011 (Email + Password Auth, Parts 1–4) implemented. PRD-012 Parts 1–5 (Design Tokens and Typography + DRY Extraction + SRP Component Decomposition + API Route/Service Cleanup + Dependency Inversion) implemented. PRD-013 Parts 1–4 (File Upload Infrastructure + Persistence & Signal Extraction Integration + Past Sessions Attachment Management + Edge Cases & Limits) implemented. PRD-014 Parts 1–4 (Session Traceability & Staleness Data Model + View Prompt on Capture Page + Show Prompt Version in Past Sessions + Staleness Indicators & Re-extraction Warnings) implemented. PRD-015 Part 1 (Public Landing Page) implemented. PRD-016 (Dark Mode) and PRD-017 (Bulk Re-extraction) implemented. PRD-018 Parts 1–2 (Structured Output Migration + Render UI from JSON) implemented. PRD-019 Parts 1–4 (pgvector Setup & Embeddings Table + Chunking Logic + Embedding Pipeline + Retrieval Service) implemented. PRD-020 Parts 1–3 (Sidebar Navigation + Chat Data Model and Streaming Infrastructure + Chat UI Components) implemented. PRD-021 Parts 1–6 (Theme Assignment at Extraction Time + Dashboard Layout, Navigation, and Direct Widgets + Derived Theme Widgets + Qualitative Drill-Down + AI-Generated Headline Insights + Filters and Interactivity) implemented. PRD-022 Parts 1–4 (Settings Accordion + Team Management Page + Extraction Prompt Page + Landing Page Refresh) implemented. PRD-023 Parts 1–3 (Codebase Cleanup: Quick Wins + Shared Route Helpers + Session Orchestrator) implemented. PRD-026 Part 1 (Embedding-Based Prevention at Theme Creation) implemented — every theme now carries a `vector(1536)` embedding (HNSW indexed) populated either by the prevention guard at extraction time or by the one-shot backfill script; semantic-similarity match (default threshold 0.92, env-configurable) collapses synonym proposals onto existing themes before insert; LLM prompt biases new theme names toward umbrella naming as a complementary first line of defense; `merged_into_theme_id` pointer added forward-compat for Part 3. PRD-026 Part 2 (Platform-Suggested Merge Candidates) implemented — `theme_merge_candidates` + `theme_merge_dismissals` tables with RLS, `find_theme_candidate_pairs` + `fetch_theme_stats` RPCs, `theme-candidate-service` with refresh/list/dismiss + composite ranking (`0.5·sim + 0.3·vol + 0.2·rec`) + token-based shared-keywords hint, three admin-gated `/api/themes/candidates*` route handlers (cron deferred per scope decision; staleness handled via stale-on-mount auto-refresh on first visit), admin-only `/settings/themes` page with confidence-pill rendering + per-side stats + dismiss action, sidebar nav conditionally exposes the Themes entry to admins/owners only via `useIsWorkspaceAdmin()`. PRD-026 Part 3 (Admin-Confirmed Theme Merge) implemented — new `theme_merges` audit table with snapshotted theme names + RLS, atomic `merge_themes` PL/pgSQL RPC (locks both theme rows FOR UPDATE, re-points `signal_themes` with conflict-aware delete-then-update, archives + sets `merged_into_theme_id`, cleans up stale candidates/dismissals, writes audit row — all in one transaction), typed-error pipeline (SQLSTATE 22023 → MergeValidationError → 409, P0002 → MergeNotFoundError → 404), `theme-merge-service` with `mergeCandidatePair` + `listRecentMerges`, `WorkspaceCtx` + `matchesWorkspace` helper extracted to a shared `lib/services/workspace-context.ts` module, two new admin-gated `/api/themes/...` routes, merge-dialog with canonical-flip toggle + blast-radius preview + P3.R2 chat-history disclaimer hosted by `themes-page-content.tsx`, recent-merges audit section sibling of the candidates list. Service does not emit notifications — Part 4 will add a single fire-and-forget `notificationService.emit({ eventType: "theme.merged", payload, ... })` into the success path with no service-shape change — auth boilerplate, file-upload validation, and the `profiles.can_create_team` query are extracted into `lib/api/` helpers and `team-service.ts`; the post-response embeddings → themes → insights chain on session create / re-extract is owned by `runSessionPostResponseChain` in `lib/services/session-orchestrator.ts` (routes still register it via `after()`). The app is a fully functional team-capable client feedback capture and synthesis platform with a public landing page, vector search infrastructure, Instagram-style hover-to-expand sidebar navigation, complete RAG chat interface (conversations sidebar, message thread with virtualized scrolling, streaming with markdown, citations, follow-ups, in-conversation search, archive read-only mode), and full server-side RAG chat infrastructure (conversations, messages, tool-augmented streaming, LLM title generation). Dual authentication (Google OAuth and email/password with recovery flow), working capture form with AI signal extraction and file attachment upload with server-side persistence, past sessions table with filters/inline editing/soft delete, prompt editor with version history (at `/settings/prompts`), dedicated team management (at `/settings/team`), role-based team access, automatic embedding generation on session save/extraction, and semantic retrieval service with adaptive query classification for downstream RAG and insights features. PRD-029 Parts 1–4 (Workspace Notifications: Data Model & Service + Header Bell UI & Dropdown + Event-Type Catalogue & Renderers + Delivery Mechanism) implemented — `workspace_notifications` table with RLS + Supabase Realtime publication, closed event-type registry (`lib/notifications/events.ts`), repository, service, four `/api/notifications/*` route handlers, four custom hooks (`use-unread-count`, `use-notifications`, `use-mark-notification-read`, `use-notification-realtime`), renderer registry populated for all three initial event types (`theme.merged` → GitMerge → `/settings/themes`, `supersession.proposed` → Inbox → `/improvements/inbox`, `bulk_re_extract.completed` → CheckCircle → null), and a sidebar-mounted bell with cross-workspace aggregation, optimistic local mark-read, lazy-mounted dropdown content, brand-coloured unread badge (capped display at "9+"), and **Realtime delivery within 1-2 seconds + 5-minute polling fallback** (RLS-on-Realtime filters the event stream per user — no explicit channel filter needed; subscription is shared across the badge and dropdown via the `useNotificationRealtime` hook with a ref-stabilised callback and per-fetch generation counters guarding against stale-response writes). Bell renders specific titles for every registered event; FALLBACK ("Workspace activity") only fires for unregistered event types or malformed payloads. **Note:** the master-signal backend (API route, service, repository, prompt, `master_signals` table) remains wired but the `/m-signals` UI page has been retired — see "Master Signal (retained backend, retired UI)" below.

**Core features live:**
- Public landing page at `/` with hero, feature cards, how-it-works flow, and CTA (authenticated users auto-redirect to `/dashboard`; new accounts with no sessions redirect to `/capture`)
- Dual authentication: Google OAuth and email + password (sign-up, sign-in, forgot-password, reset-password) via Supabase Auth; invite acceptance supports both paths
- Session capture with AI signal extraction (Vercel AI SDK, multi-provider) and file attachment upload (TXT, PDF, CSV, DOCX, JSON) with server-side parsing and chat format detection (WhatsApp, Slack)
- Per-user/per-team prompt editor with version history and revert, accessed at `/settings/prompts`
- Team workspaces with role-based access (owner, admin, sales)
- Email invitations via provider-agnostic email service (Resend)
- Workspace switcher (personal ↔ team contexts)
- Team-scoped sessions, clients, master signals, and prompts
- Team management (members, roles, ownership transfer, rename, delete)
- Data retention on member departure
- RAG chat interface at `/chat` — conversation sidebar (search, pin, archive, rename, delete), virtualized message thread, markdown rendering with citations, follow-up suggestions, in-conversation search with match navigation, starter questions, archive read-only with unarchive
- AI-powered theme assignment — automatic topic-based classification of signal chunks during extraction, chained after embedding generation (fire-and-forget), workspace-scoped themes with many-to-many signal-theme junction, primary/secondary themes with confidence scores
- AI-powered insights dashboard at `/dashboard` — sentiment distribution (donut chart), urgency distribution (bar chart), session volume over time (area chart with week/month toggle), client health grid (scatter plot), competitive mentions (horizontal bar chart), top themes (horizontal bar chart with chunk-type breakdown tooltip), theme trends (multi-line chart with local theme selector and granularity toggle), theme-client matrix (heatmap grid with intensity-mapped cells); global filter bar (client multi-select, date range, severity, urgency) with URL-encoded state; `confidenceMin` available as URL param for theme query filtering; all widgets consume a shared `queryDatabase` service layer via `/api/dashboard` route; qualitative drill-down — clicking any widget data point opens a sliding Sheet panel showing actual signal texts grouped by client in collapsible accordion, with chunk-type/theme badges, session date, and "View Session" button that opens a Dialog with the full StructuredSignalView; two-layer architecture (DrillDownContent + DrillDownPanel) for swappable presentation shell; AI-generated headline insights — 3–5 classified insight cards (trend/anomaly/milestone) with type-specific colour accents displayed above the widget grid, manual "Refresh Insights" button, automatic generation after session extraction via fire-and-forget chain, collapsible "Previous Insights" section with lazy-loaded historical batches; cross-widget filtering — shift+click on sentiment/urgency/client data points sets global URL filters that all widgets respond to; data freshness indicator — "Data as of [time]" display updated via FreshnessContext from all widget fetches; dashboard screenshot export — "Export as Image" button dynamically imports html2canvas, prepends temporary filter context header, captures at 2x retina scale, triggers PNG download with date-stamped filename

**Database tables:** `clients`, `sessions`, `session_attachments`, `session_embeddings`, `themes` (with `embedding vector(1536)` + HNSW index for the PRD-026 Part 1 prevention guard, and `merged_into_theme_id` FK populated by PRD-026 Part 3's merge transaction), `signal_themes`, `theme_merge_candidates` (PRD-026 Part 2 — persisted ranked merge candidates per workspace), `theme_merge_dismissals` (PRD-026 Part 2 — admin "not a duplicate" judgments), `theme_merges` (PRD-026 Part 3 — merge audit log), `master_signals`, `profiles`, `prompt_versions`, `teams`, `team_members`, `team_invitations`, `conversations`, `messages`, `dashboard_insights`, `workspace_notifications` — all with RLS. **RPC functions:** `match_session_embeddings` (vector similarity search), `sessions_over_time` (time-bucketed session counts by week/month for dashboard), `find_theme_candidate_pairs` (PRD-026 Part 2 — pairwise theme similarity above threshold), `fetch_theme_stats` (PRD-026 Part 2 — per-theme assignment / session / client counts + last-assigned timestamp), `merge_themes` (PRD-026 Part 3 — atomic merge: re-points `signal_themes` with conflict-aware delete-then-update, archives + sets `merged_into_theme_id`, cleans up stale candidates/dismissals, writes audit row).

---

## File Map

```
synthesiser/
├── ARCHITECTURE.md              # This file — reflects current state
├── CLAUDE.md                    # Development rules and conventions
├── CHANGELOG.md                 # Change log grouped by PRD/part
├── README.md                    # Product overview and setup guide
├── .env.example                 # Template for required env vars
├── middleware.ts                # Route protection + active_team_id cookie validation
├── next.config.ts               # Next.js config — image remote patterns (Google avatars)
├── app/
│   ├── globals.css              # Global CSS tokens (brand colours, status colours, AI action colours, typography, surfaces, sidebar width tokens)
│   ├── layout.tsx               # Root layout — AuthProvider + AuthenticatedLayout + Toaster
│   ├── page.tsx                 # Landing page (public) — authenticated users redirect to /dashboard (or /capture if the account has no sessions)
│   ├── _components/
│   │   └── landing-page.tsx     # Client component — auth-aware landing page (hero, features, how-it-works, CTA)
│   ├── favicon.ico
│   ├── api/
│   │   ├── ai/
│   │   │   ├── extract-signals/
│   │   │   │   └── route.ts     # POST — extract signals from raw notes via AI model
│   │   │   └── generate-master-signal/
│   │   │       └── route.ts     # POST — generate/regenerate master signal — delegates to generateOrUpdateMasterSignal() service
│   │   ├── chat/
│   │   │   ├── conversations/
│   │   │   │   ├── route.ts     # GET — list conversations (active/archived, cursor-based pagination, search)
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts     # PATCH (rename/pin/archive/unarchive) and DELETE (soft-delete) conversation
│   │   │   │       └── messages/
│   │   │   │           └── route.ts # GET — list messages for a conversation (cursor-based, newest-first)
│   │   │   └── send/
│   │   │       └── route.ts     # POST — streaming chat route: auth, validation, conversation setup, delegates to chat-stream-service; returns SSE response
│   │   ├── clients/
│   │   │   └── route.ts         # GET (search, hasSession filter) and POST (create) — team-scoped
│   │   ├── files/
│   │   │   └── parse/
│   │   │       └── route.ts     # POST — stateless file parse (multipart/form-data) — returns parsed content + source format
│   │   ├── invite/
│   │   │   └── [token]/
│   │   │       └── accept/
│   │   │           └── route.ts # POST — accept team invitation, create team_members entry
│   │   ├── master-signal/
│   │   │   └── route.ts         # GET — fetch current master signal + staleness count — team-scoped
│   │   ├── prompts/
│   │   │   ├── route.ts         # GET/POST — prompt CRUD (team admin check) — workspace-scoped
│   │   │   └── [id]/
│   │   │       └── route.ts     # GET — fetch a single prompt version by UUID with computed version number
│   │   ├── sessions/
│   │   │   ├── route.ts         # GET/POST — session list and create — team-scoped
│   │   │   ├── prompt-versions/
│   │   │   │   └── route.ts     # GET — distinct prompt versions across sessions with computed version numbers
│   │   │   └── [id]/
│   │   │       ├── route.ts     # PUT/DELETE — update/soft-delete session (auth via requireSessionAccess)
│   │   │       └── attachments/
│   │   │           ├── route.ts         # GET/POST — list and upload attachments for a session
│   │   │           └── [attachmentId]/
│   │   │               ├── route.ts     # DELETE — soft-delete attachment + hard-delete from storage
│   │   │               └── download/
│   │   │                   └── route.ts # GET — signed download URL for attachment
│   │   └── teams/
│   │       ├── route.ts         # GET (list user's teams) and POST (create team)
│   │       └── [teamId]/
│   │           ├── route.ts     # GET/PATCH/DELETE — team details, rename, soft-delete
│   │           ├── leave/
│   │           │   └── route.ts # POST — current user leaves team
│   │           ├── transfer/
│   │           │   └── route.ts # POST — transfer ownership to another member
│   │           ├── invitations/
│   │           │   ├── route.ts # GET (pending) and POST (send invitations)
│   │           │   └── [invitationId]/
│   │           │       ├── route.ts     # DELETE — revoke invitation
│   │           │       └── resend/
│   │           │           └── route.ts # POST — resend invitation email
│   │           └── members/
│   │               ├── route.ts # GET — list team members with profiles
│   │               └── [userId]/
│   │                   ├── route.ts     # DELETE — remove member from team
│   │                   └── role/
│   │                       └── route.ts # PATCH — change member role
│   │   └── dashboard/
│   │       ├── route.ts         # GET — dashboard query route: Zod-validated action (13 actions incl. drill_down, session_detail, insights_latest, insights_history) + filter params (including confidenceMin, drillDown, sessionId), delegates to executeQuery() via anon client (RLS-protected)
│   │       └── insights/
│   │           └── route.ts     # POST — generate headline insights: auth check, service-role client, calls generateHeadlineInsights(), returns new batch
│   │   ├── notifications/
│   │   │   ├── route.ts                       # GET — paginated bell listing (cross-workspace by default); Zod-validated cursor/cursorId/limit/includeRead/windowDays; returns rows with joined teamName + nextCursor (PRD-029 Part 2)
│   │   │   ├── unread-count/
│   │   │   │   └── route.ts                   # GET — bell badge count; cross-workspace; returns { count } (PRD-029 Part 2)
│   │   │   ├── [id]/
│   │   │   │   └── read/
│   │   │   │       └── route.ts               # POST — mark one notification read; UUID-validated id; idempotent; RLS-denied rows are silent no-ops (PRD-029 Part 2)
│   │   │   └── mark-all-read/
│   │   │       └── route.ts                   # POST — bulk mark-read; optional body { teamId? }; default clears across every workspace (PRD-029 Part 2)
│   │   ├── themes/
│   │   │   ├── candidates/
│   │   │   │   ├── route.ts                   # GET — admin-gated merge-candidate list. Zod-validated limit/offset, requireWorkspaceAdmin gate, delegates to listCandidates(). Returns { candidates, hasMore, lastRefreshedAt }. (PRD-026 Part 2)
│   │   │   │   ├── refresh/
│   │   │   │   │   └── route.ts               # POST — admin-gated on-demand refresh. Builds candidate/pairs/dismissal/theme repos against the workspace, delegates to refreshCandidates(). Returns RefreshResult { workspace, candidatesGenerated, pairsAboveThreshold, dismissedFiltered, refreshBatchId, elapsedMs }. (PRD-026 Part 2)
│   │   │   │   └── [id]/
│   │   │   │       ├── dismiss/
│   │   │   │       │   └── route.ts           # POST — admin-gated dismiss. UUID-validated id, delegates to dismissCandidate(); CandidateNotFoundError → 404, CandidateAccessError → 403. Returns 204. (PRD-026 Part 2)
│   │   │   │       └── merge/
│   │   │   │           └── route.ts           # POST — admin-gated merge confirmation. UUID-validated id + body { canonicalThemeId }, delegates to mergeCandidatePair(); CandidateNotFoundForMergeError → 404, InvalidCanonicalChoiceError → 400, MergeNotFoundError → 404, MergeValidationError → 409 (already archived / cross-workspace / same theme), other errors → 500. Returns MergeResult. (PRD-026 Part 3)
│   │   │   └── merges/
│   │   │       └── route.ts                   # GET — admin-gated recent-merges audit list. Zod-validated limit/offset, delegates to listRecentMerges(). Returns { items, hasMore }. (PRD-026 Part 3)
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts         # OAuth callback — code exchange, pending invite auto-accept
│   ├── chat/
│   │   ├── page.tsx             # Chat tab — server component with metadata, renders ChatPageContent
│   │   └── _components/
│   │       ├── chat-area.tsx               # Main chat area — composes header, search bar, message thread, input, error banner; manages in-conversation search state; owns per-workspace cap state (useActiveStreamCount(teamId) + MAX_CONCURRENT_STREAMS) and gates BOTH chat-input and starter-questions consistently against one source of truth (PRD-024 Part 3)
│   │       ├── chat-header.tsx             # Conversation title bar — sidebar toggle, mobile menu, search toggle
│   │       ├── chat-input.tsx              # Auto-expanding textarea (1–6 rows) with send/stop buttons, Enter/Shift+Enter, archived unarchive bar; receives capReached: boolean from chat-area and renders the inline blocking banner (role=status, aria-live=polite) when capReached && !isStreaming; handleSend gates on capReached so Enter doesn't bypass the disabled Send button (PRD-024 Part 3)
│   │       ├── chat-page-content.tsx       # Client coordinator — wires useConversations + useChat, manages active conversation, sidebar state
│   │       ├── chat-search-bar.tsx         # In-conversation search — input, match count, prev/next navigation, keyboard shortcuts
│   │       ├── citation-chips.tsx          # Pill-shaped citation chips with client name · date, opens CitationPreviewDialog
│   │       ├── citation-preview-dialog.tsx # Dialog showing source chunk text, metadata, "View full session" link
│   │       ├── conversation-context-menu.tsx # Right-click context menu — rename, pin, archive/unarchive, delete
│   │       ├── conversation-item.tsx       # Single conversation row — title, date, pin/archive badges, context menu; renders pulsating brand-accent dot when streaming, solid dot when conversation has unseen completed response (PRD-024 P4); aria-label extends to include state for cohesive screen-reader announcement
│   │       ├── conversation-sidebar.tsx    # Collapsible sidebar — search, active/archived lists, new chat button, desktop panel + mobile Sheet; aggregate streaming-status footer text via useActiveStreamCount(teamId) with templated singular/plural and aria-live="polite" (PRD-024 P4.R4)
│   │       ├── follow-up-chips.tsx         # Clickable follow-up question pills with Sparkles icon
│   │       ├── highlighted-text.tsx        # Search highlight — splits text by regex, wraps matches in <mark>; exports highlightChildren() recursive utility
│   │       ├── memoized-markdown.tsx       # React.memo'd ReactMarkdown with remark-gfm, search highlighting via component overrides
│   │       ├── message-actions.tsx         # Hover-visible copy/action buttons on messages
│   │       ├── message-bubble.tsx          # Single message — user (right, coloured) or assistant (left, markdown), citations, follow-ups, status
│   │       ├── message-status-indicator.tsx # Status badges for failed/cancelled/stale with retry button
│   │       ├── message-thread.tsx          # Virtualized message list (react-virtuoso reverse mode) — infinite scroll, streaming sentinel, search scroll-to
│   │       ├── starter-questions.tsx       # Empty state — 4 hardcoded starter question chips
│   │       └── streaming-message.tsx       # Live streaming assistant response — spinner, status text, markdown, blinking cursor
│   ├── dashboard/
│   │   ├── page.tsx             # Dashboard page — server component with metadata, renders DashboardContent
│   │   └── _components/
│   │       ├── chart-colours.ts            # Shared chart colour/label constants — brand primary hex/rgb, sentiment/urgency colour maps, theme line palette, CHUNK_TYPE_LABELS with formatChunkType/formatChunkTypePlural helpers
│   │       ├── client-health-widget.tsx    # Client health grid — ScatterChart positioning clients by sentiment × urgency, custom tooltip, drill-down on click, shift+click cross-filter (clients)
│   │       ├── competitive-mentions-widget.tsx # Competitive mentions — horizontal BarChart sorted by frequency, drill-down on click
│   │       ├── dashboard-card.tsx          # Shared widget card — title, loading skeleton, error/retry, empty state, content slot
│   │       ├── dashboard-content.tsx       # Client coordinator — FilterBar + InsightCardsRow + PreviousInsights + responsive widget grid (8 widgets), drill-down state + DrillDownPanel, cross-widget filtering (applyWidgetFilter), freshness tracking (ref+context), screenshot export (dashboardRef), Suspense boundary
│   │       ├── export-dashboard.ts         # Dashboard screenshot export — dynamically imports html2canvas, prepends temporary filter context header, captures at 2x scale, triggers PNG download, cleans up
│   │       ├── freshness-context.tsx      # FreshnessContext — lightweight context providing onFetchComplete callback so useDashboardFetch can report fetch timestamps without prop-drilling
│   │       ├── freshness-indicator.tsx    # Data freshness display — "Data as of just now / Nm ago / HH:MM" with 30-second auto-refresh timer
│   │       ├── drill-down-content.tsx      # Presentation-agnostic drill-down body — data fetching via useDashboardFetch, count header, filter label, client accordion (native details/summary), signal rows with badges, "View Session" button
│   │       ├── drill-down-panel.tsx        # Thin Sheet shell wrapping DrillDownContent (swappable to Dialog in one file); owns SessionPreviewDialog
│   │       ├── drill-down-types.ts         # DrillDownContext discriminated union (7 variants), DrillDownSignal, DrillDownClientGroup, DrillDownResult interfaces
│   │       ├── filter-bar.tsx             # Global filter bar — client multi-select (Popover+Command), date range, severity, urgency dropdowns, URL search params, "Export as Image" button
│   │       ├── insight-cards-row.tsx      # Headline insight cards — horizontal scrollable row, type-specific styling (trend/anomaly/milestone), refresh button, skeleton/error/empty states
│   │       ├── previous-insights.tsx      # Previous insight batches — collapsible details/summary, lazy-loaded on first expand, compact list with type icons
│   │       ├── sentiment-widget.tsx        # Sentiment distribution — PieChart (donut) with clickable segments, drill-down on click, shift+click cross-filter (severity)
│   │       ├── session-volume-widget.tsx   # Session volume over time — AreaChart with local week/month granularity toggle (no drill-down)
│   │       ├── theme-client-matrix-widget.tsx # Theme-client matrix — HTML heatmap grid, opacity-mapped cells, sticky headers, custom tooltip, drill-down on click
│   │       ├── theme-trends-widget.tsx    # Theme trends — LineChart with local week/month toggle, top-5 default with theme multi-select (Popover+Command), 8-colour palette, drill-down on activeDot click
│   │       ├── top-themes-widget.tsx      # Top themes — horizontal BarChart, chunk-type breakdown tooltip, 15-theme default with show-all toggle, drill-down on click
│   │       ├── urgency-widget.tsx          # Urgency distribution — BarChart with colour-coded bars, drill-down on click, shift+click cross-filter (urgency)
│   │       ├── use-dashboard-fetch.ts     # Shared fetch hook — action + filter params from URL, loading/error/data lifecycle, re-fetch on filter change, reports successful fetches to FreshnessContext
│   │       └── use-insights.ts           # Insight data hook — fetches latest batch on mount, exposes refresh (POST), lazy-load previous batches
│   ├── capture/
│   │   ├── page.tsx             # Capture tab — server component, renders CapturePageContent
│   │   └── _components/
│   │       ├── attachment-list.tsx          # Attachment chips — file name, size, format badge, remove button
│   │       ├── capture-page-content.tsx    # Client wrapper — manages refreshKey between form and table
│   │       ├── client-combobox.tsx         # Type-to-create text input with existing client suggestions
│   │       ├── client-filter-combobox.tsx  # Client combobox for filters (hasSession, no create-new)
│   │       ├── date-picker.tsx            # Styled native date input (max: today, optional min/max)
│   │       ├── capture-attachment-section.tsx  # Attachments block for capture form — upload zone, list, char counter
│   │       ├── expanded-session-actions.tsx    # Save/cancel/delete action bar for expanded session row
│   │       ├── expanded-session-metadata.tsx   # Client/date fields (edit mode) or read-only display
│   │       ├── expanded-session-notes.tsx      # Raw notes + attachments section with char counter
│   │       ├── expanded-session-row.tsx   # Coordinator — state, hooks, handlers; composes metadata/notes/actions subcomponents
│   │       ├── file-upload-zone.tsx      # Drag-and-drop file upload zone with client-side validation and server parse
│   │       ├── markdown-panel.tsx         # Reusable markdown view/edit panel with rendered preview and raw edit toggle
│   │       ├── prompt-version-badge.tsx   # Clickable badge in expanded row — fetches prompt version on click, opens ViewPromptDialog
│   │       ├── past-sessions-table.tsx    # Past sessions table with expand/collapse, inline edit, delete, "Captured by" column
│   │       ├── prompt-version-filter.tsx  # Prompt version filter dropdown — fetches distinct versions, "Default prompt" for null
│   │       ├── saved-attachment-list.tsx  # Displays persisted attachments with download, delete (with confirmation when signals exist), and view parsed content toggle
│   │       ├── session-capture-form.tsx   # Coordinator — react-hook-form, submit, extract; composes attachment/notes subcomponents
│   │       ├── session-filters.tsx        # Filter bar — client combobox + date range + prompt version filter with auto-sync
│   │       ├── session-table-row.tsx      # Single table row — formatDate, truncateNotes, formatEmail helpers
│   │       ├── structured-notes-panel.tsx # Post-extraction display — branches: StructuredSignalView (JSON) or MarkdownPanel (fallback), with edit toggle
│   │       ├── unsaved-changes-dialog.tsx # Save/Discard/Cancel prompt for dirty expanded rows
│   │       └── view-prompt-dialog.tsx    # Reusable read-only dialog for viewing prompt content (markdown rendered, fetch-on-open)
│   ├── invite/
│   │   └── [token]/
│   │       ├── page.tsx                   # Invite acceptance page — server component
│   │       └── _components/
│   │           ├── invite-page-content.tsx    # Client coordinator — validates token, routes between invite states (PRD-011 Part 3)
│   │           ├── invite-shell.tsx           # Shared centered card shell for all invite states, with status icon
│   │           ├── invite-status-card.tsx     # Status cards for invalid/expired/already-accepted states
│   │           ├── invite-accept-card.tsx     # Authenticated + email-match state — shows team/role + accept button
│   │           ├── invite-mismatch-card.tsx   # Authenticated + email-mismatch state — warning + sign-out option
│   │           ├── invite-sign-in-form.tsx    # Unauthenticated + existing user — email/password sign-in with pre-filled email
│   │           ├── invite-sign-up-form.tsx    # Unauthenticated + new user — sign-up with pre-filled email
│   │           └── invite-helpers.ts          # Shared helpers for invite state resolution
│   ├── login/
│   │   ├── page.tsx             # Login page — server component with metadata
│   │   └── _components/
│   │       └── login-form.tsx   # Email/password form + Google OAuth button (PRD-011 Part 1)
│   ├── signup/
│   │   ├── page.tsx             # Sign-up page — server component with metadata
│   │   └── _components/
│   │       └── signup-form.tsx  # Email/password sign-up (Zod validation) + Google OAuth + email-confirmation panel (PRD-011 Part 1)
│   ├── forgot-password/
│   │   ├── page.tsx             # Forgot-password page — server component with metadata
│   │   └── _components/
│   │       └── forgot-password-form.tsx # Triggers supabase.auth.resetPasswordForEmail with type=recovery redirect (PRD-011 Part 2)
│   ├── reset-password/
│   │   ├── page.tsx             # Reset-password page — server component with metadata (requires authenticated recovery session)
│   │   └── _components/
│   │       └── reset-password-form.tsx  # New password + confirm, calls supabase.auth.updateUser (PRD-011 Part 2)
│   └── settings/
│       ├── page.tsx             # Settings page — redirects to /settings/team
│       ├── prompts/
│       │   ├── page.tsx         # Extraction Prompt page
│       │   └── _components/
│       │       ├── extraction-prompt-client.tsx  # Client coordinator for extraction prompt
│       │       └── use-extraction-prompt.ts      # Hook for extraction prompt state
│       ├── team/
│       │   ├── page.tsx         # Team Management page
│       │   └── _components/
│       │       └── team-management-client.tsx    # Client coordinator for team settings
│       ├── themes/                              # PRD-026 Part 2 — admin-only merge-candidate surface
│       │   ├── page.tsx                         # Server component — admin gate (personal workspace = implicit admin; team workspace requires member.role === "admin"); non-admin path renders an "admin-only" fallback panel; admin path renders ThemesPageContent inside the standard PageHeader layout
│       │   └── _components/
│       │       ├── themes-page-content.tsx      # Client orchestrator — fetch lifecycle, manual + stale-on-mount auto-refresh (Decision 20: STALE_THRESHOLD_HOURS=24, autoRefreshFiredRef one-shot guard), dismissal callback, "Show more" via PAGE_SIZE bumps, loading/empty/error states; routes through GET /api/themes/candidates + POST /refresh + POST /:id/dismiss
│       │       ├── candidate-list.tsx           # Pure presentation — renders rows + the bounded "Show more" affordance (P2.R4)
│       │       ├── candidate-row.tsx            # Single-pair display per P2.R3 — confidence pill (≥0.92 status-success / 0.85–0.92 status-warning / else neutral muted), two side-by-side ThemeSide panels (collapse to stacked on mobile), per-side stats footer with proper singular/plural, shared-keywords hint, score-component breakdown caption; embeds DismissAction; "Merge…" button is wired in PRD-026 Part 3 to fire onMerge(candidate) up to themes-page-content
│       │       ├── refresh-button.tsx           # Presentation-only refresh button — RefreshCw icon spins during in-flight; orchestrator owns the POST so manual + auto-refresh share one code path
│       │       ├── dismiss-action.tsx           # Per-row dismiss button — owns its own POST + loading state + Sonner toast; calls onDismissed back to parent so the list re-fetches
│       │       ├── merge-dialog.tsx             # PRD-026 Part 3 — confirmation dialog hosted by themes-page-content (open when `candidate !== null`). Two CanonicalChoice radio cards (default = higher-volume side, recomputes when candidate identity changes), BlastRadiusPreview computed from candidate snapshot stats ("approximately N signal assignments will be re-pointed"), P3.R2 chat-history disclaimer, Confirm + Cancel. Owns POST + loading state; toast on failure (keep dialog open)
│       │       └── recent-merges-section.tsx    # PRD-026 Part 3 — sibling section below the candidates list. Self-contained fetch + paging against GET /api/themes/merges. Each list item: archivedName → canonicalName headline + per-side counts + relative-time caption. Exposes refresh() via forwardRef + useImperativeHandle so themes-page-content can re-fetch right after a confirmed merge without prop-drilling refetch triggers
│       └── _components/
│           ├── invite-bulk-dialog.tsx          # Bulk invite dialog (CSV/paste, max 20 emails)
│           ├── invite-single-form.tsx          # Single email invite form
│           ├── pending-invitations-table.tsx   # Table of pending invitations with revoke/resend
│           ├── prompt-editor.tsx               # Monospace textarea with loading skeleton
│           ├── team-danger-zone.tsx            # Rename + delete team (owner only)
│           ├── team-members-table.tsx          # Members list with role change, remove, transfer, leave
│           ├── version-history-panel.tsx       # Collapsible version history with view/revert
│           └── version-view-dialog.tsx         # Read-only dialog for viewing past prompt versions
├── components/
│   ├── auth/
│   │   ├── auth-form-shell.tsx          # Shared centered auth card layout (title, subtitle, children)
│   │   └── email-confirmation-panel.tsx # Shared "Check your email" success panel (children, linkText, linkHref)
│   ├── capture/
│   │   ├── reextract-confirm-dialog.tsx # Shared re-extract confirmation dialog (show, hasManualEdits, onConfirm, onCancel)
│   │   ├── session-preview-dialog.tsx   # Session preview Dialog — fetches session_detail via dashboard API, renders StructuredSignalView with client name + date header (used by drill-down + chat citations)
│   │   └── structured-signal-view.tsx   # Renders ExtractedSignals JSON as typed UI — sections, severity/priority/sentiment badges, quotes (PRD-018 P2)
│   ├── notifications/
│   │   ├── notification-bell.tsx          # Public bell composition — Popover trigger (full-row button matching the sidebar's "More"/UserMenu pattern) + badge overlay (capped "9+" display, brand-coloured); Popover content lazy-mounts via Radix Portal so useNotifications fetches only on open; props: collapsed, onOpenChange (PRD-029 Part 2)
│   │   ├── notification-dropdown.tsx      # Popover content — header (title + "Mark all as read" when hasUnread), branches between skeleton / error / empty / row-list with optional Load-more footer; computes showWorkspaceLabel by row-team heuristic (suppresses labels when all visible rows share team_id) (PRD-029 Part 2)
│   │   ├── notification-row.tsx           # Single row — renderNotification(notification) for icon/title/deepLink, formatRelativeTime for timestamp, brand-coloured dot + bold text when unread; click flow: optimistic local mark-read → server POST → refetch unread count → setActiveTeam if cross-workspace → router.push(deepLink) → onClose; switching workspace before navigation prevents destination flashing (PRD-029 Part 2)
│   │   ├── notification-empty-state.tsx   # "You're all caught up" — BellOff icon + muted copy (PRD-029 Part 2)
│   │   └── notification-skeleton.tsx      # Three pulsing rows (animate-pulse + bg-muted) for the bell's initial fetch (PRD-029 Part 2)
│   ├── providers/
│   │   └── auth-provider.tsx    # AuthProvider context — user, isAuthenticated, isLoading, canCreateTeam, activeTeamId, setActiveTeam, signOut
│   ├── settings/
│   │   ├── role-picker.tsx      # Controlled role picker (value, onValueChange) + exported Role type
│   │   └── table-shell.tsx      # Shared bordered table wrapper (TableShell) + standardised header cell (TableHeadCell)
│   ├── layout/
│   │   ├── app-footer.tsx       # Footer — public routes only (developer contact + theme toggle)
│   │   ├── app-sidebar.tsx      # Instagram-style hover-to-expand sidebar — icon-only at rest, overlay on hover, mobile drawer via Sheet; nav links (Dashboard, Capture, Chat, Settings), workspace switcher, more menu, NotificationBell (PRD-029 Part 2 — between More and UserMenu, collapsed/onOpenChange wired into the same openDropdownCount mechanism), user menu; renders brand-accent indicator dot on Chat nav icon — pulsating when any workspace stream is active, solid when only unseen completions exist (PRD-024 P5.R2); aria-label on the Chat link extends to include state
│   │   ├── authenticated-layout.tsx # Auth-aware layout wrapper — sidebar + margin for authenticated routes, footer-only for public routes
│   │   ├── create-team-dialog.tsx # Controlled team creation dialog (opened from workspace switcher)
│   │   ├── page-header.tsx      # Shared header component with title and description
│   │   ├── synthesiser-logo.tsx # SVG logo component — full (wordmark) and icon-only variants
│   │   ├── theme-toggle.tsx     # Shared icon-only theme toggle — Sun/Moon icon, aria-labelled; consumes `useTheme().toggleTheme`
│   │   ├── user-menu.tsx        # Auth-aware user menu — avatar, email, sign-out dropdown; supports side/collapsed/onOpenChange props for sidebar integration
│   │   └── workspace-switcher.tsx # Always-visible workspace dropdown — switch, create team, CTA; supports collapsed/onOpenChange props for sidebar integration
│   └── ui/                      # shadcn/ui primitives (do not modify) + shared dialogs
│       ├── badge.tsx
│       ├── confirm-dialog.tsx    # Reusable confirmation dialog (config-driven: title, description, destructive variant, loading state)
│       ├── button.tsx           # Includes `ai` variant (gold) for AI action buttons
│       ├── command.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── google-icon.tsx      # Shared Google "G" icon component used by Google OAuth buttons (PRD-011)
│       ├── input.tsx
│       ├── label.tsx
│       ├── password-input.tsx   # Email/password input with show/hide toggle (PRD-011)
│       ├── popover.tsx
│       ├── select.tsx
│       ├── sheet.tsx            # Slide-out drawer (left/right/top/bottom) built on Radix Dialog primitives
│       ├── sonner.tsx
│       ├── tabs.tsx
│       └── textarea.tsx
├── lib/
│   ├── api/
│   │   ├── route-auth.ts        # Route auth helpers — requireAuth + requireTeamMember/Admin/Owner (optional forbiddenMessage) + requireSessionAccess; AuthContext/TeamContext/SessionContext types (PRD-023 Part 2)
│   │   ├── file-validation.ts   # validateFileUpload(file) — shared per-file size + MIME validation for upload routes (PRD-023 Part 2)
│   │   └── idempotent-no-op.ts  # idempotentNoOp(message) — canonical 409 response for "no-op: state already matches" (PRD-023 Part 2)
│   ├── constants.ts             # Shared constants (file upload limits, accepted types)
│   ├── constants/
│   │   └── file-icons.ts        # FILE_ICONS map (MIME type → lucide icon component)
│   ├── cookies/
│   │   ├── active-team.ts          # Client-side active team cookie helpers (getActiveTeamId via document.cookie, setActiveTeamCookie, clearActiveTeamCookie)
│   │   └── active-team-server.ts   # Server-side active team cookie reader (getActiveTeamId via next/headers cookies)
│   ├── hooks/
│   │   ├── use-chat.ts          # Composer — wires useConversationMessages + useChatStreaming and returns the combined UseChatReturn shape consumed by chat-surface components; thin wiring layer, no logic of its own (PRD-024 Part 6 decomposition; previously a 492-LOC monolithic hook)
│   │   ├── use-conversation-messages.ts  # Internal building block — owns active conversation's messages array, pagination, isLoadingMessages, isConversationNotFound, the load-messages effect with the Gap P9 skip-refetch guard, and clearMessages. Exposes setMessages so useChatStreaming can perform optimistic adds, retry trims, and fold-completion appends. Not re-exported from any barrel — useChat is the public composer (PRD-024 Part 6)
│   │   ├── use-chat-streaming.ts # Internal building block — slice subscription via useStreamingSlice, derived passthrough fields (streamState, streamingContent, statusText, latestSources, latestFollowUps, error), pendingConversationId fresh-send fallback, sendMessage/cancelStream/retryLastMessage delegating to @/lib/streaming, useLayoutEffect fold for finalMessage (P2.R7 no-flicker), useLayoutEffect clear-unseen for in-view auto-acknowledgment (P4.R2). Receives messages + setMessages from useConversationMessages via the composer; not re-exported from any barrel (PRD-024 Part 6)
│   │   ├── use-conversations.ts # Conversation list management — dual active/archived lists, optimistic CRUD, cursor-based pagination, search (PRD-020 Part 2–3)
│   │   ├── use-filter-storage.ts # Filter-persistence primitive — sessionStorage keyed by `filters:<surface>:<userId>:<workspaceId|personal>`; consumed by dashboard filter-bar and capture past-sessions-table (Gap P5)
│   │   ├── use-signal-extraction.ts # Shared extraction state machine hook (ExtractionState, promptVersionId, getInput callback, re-extract confirm flow, forceConfirmOnReextract for server-side manual edit flag)
│   │   ├── use-theme.ts         # Theme hook — reads/writes theme cookie, returns { theme, setTheme }
│   │   ├── use-workspace-admin.ts # PRD-026 Part 2 — useIsWorkspaceAdmin() returns { isAdmin, isLoading }; personal workspace short-circuits to admin; team workspace fetches `team_members.role` (owner is implicitly admin per team-repository.create()'s invariant). Used by app-sidebar to gate the Themes nav entry, exposable to any future admin-aware client component.
│   │   ├── use-unread-count.ts  # Bell badge — Realtime-driven refetch (sub-second latency) with 5-minute polling fallback (visibility-aware, paused when tab hidden, refetches on focus); generationRef guards against stale-fetch writes; returns { count, refetch } (PRD-029 Parts 2 + 4)
│   │   ├── use-notifications.ts # Bell-list management — paginated fetch with keyset cursor (cursor + cursorId), Realtime-driven page-1 refresh, optimistic local mark-read mutations (markRowReadLocally / markAllRowsReadLocally); cancelledRef + generationRef guard post-unmount and stale-response writes (PRD-029 Parts 2 + 4)
│   │   ├── use-mark-notification-read.ts # Fire-and-forget mark-read POSTs to /api/notifications/[id]/read and /api/notifications/mark-all-read; failures logged but not surfaced — bell stays optimistic, next Realtime event or poll corrects drift (PRD-029 Part 2)
│   │   └── use-notification-realtime.ts # Shared Supabase Realtime subscription — listens to workspace_notifications INSERT/UPDATE/DELETE, calls onChange on every event the user has RLS visibility to, ref-stabilised callback so subscription lifecycle is mount/unmount only, status logging under [useNotificationRealtime] (PRD-029 Part 4)
│   ├── types/
│   │   ├── chat.ts              # MessageRole, MessageStatus, ChatSource, Message, Conversation, ConversationListOptions — types for the chat system (PRD-020)
│   │   ├── embedding-chunk.ts   # ChunkType, EmbeddingChunk, SessionMeta — types for the vector search chunking/embedding pipeline (PRD-019)
│   │   ├── retrieval-result.ts  # QueryClassification, ClassificationResult, RetrievalOptions, RetrievalResult — types for the retrieval service (PRD-019)
│   │   ├── signal-session.ts    # SignalSession interface — shared between ai-service and master-signal-service
│   │   ├── theme.ts             # Theme, SignalTheme, LLMThemeAssignment, ThemeAssignmentResult — types for the theme assignment system (PRD-021)
│   │   ├── theme-candidate.ts   # ThemeSideStats, ThemeCandidate, ThemeCandidateWithThemes, ThemeDismissal, CandidatePair — domain types for the merge-candidate surface (PRD-026 Part 2)
│   │   ├── theme-merge.ts       # ThemeMerge (audit-row domain shape), MergeResult (service output, strict superset of themeMergedPayloadSchema minus actorName so Part 4 can hand it straight to the notification emitter) — PRD-026 Part 3
│   │   ├── insight.ts           # InsightType, DashboardInsight, InsightBatch — types for AI-generated headline insights (PRD-021 Part 5)
│   │   └── notification.ts      # WorkspaceNotification, NotificationCursor — domain types for workspace-level notifications (PRD-029 Part 1)
│   ├── notifications/            # Workspace-notifications domain primitive (PRD-029)
│   │   ├── events.ts            # Closed event-type registry — per-event Zod payload schemas, NOTIFICATION_EVENTS const, NotificationEventType, isNotificationEventType, payloadSchemaFor; renderers (Part 3) plug in alongside (PRD-029 Part 1)
│   │   └── renderers.ts         # Renderer registry — RendererFor<E> / RendererRegistry types; NOTIFICATION_RENDERERS populated for the three initial events (theme.merged → GitMerge + "Theme \"X\" merged into \"Y\"" + /settings/themes; supersession.proposed → Inbox + "N supersession proposal(s) from <source-label>" + /improvements/inbox; bulk_re_extract.completed → CheckCircle + branched session/error template + null deepLink); private pluralize() + SUPERSESSION_SOURCE_LABEL helpers; RenderedNotification consumer shape, FALLBACK ({ Bell, "Workspace activity", null }), renderNotification(notification) lookup with Zod payload re-validation as defence-in-depth. Type stays Partial<RendererRegistry> so future event types can register before their renderer ships (PRD-029 Parts 2–3)
│   ├── utils.ts                 # cn() utility (clsx + tailwind-merge) + PROSE_CLASSES constant
│   ├── email-templates/
│   │   └── invite-email.ts      # HTML email template for team invitations
│   ├── prompts/
│   │   ├── chat-prompt.ts       # Chat system prompt — tool usage instructions, citation rules, follow-up generation format; CHAT_MAX_TOKENS (PRD-020)
│   │   ├── classify-query.ts    # System prompt and max tokens for query classification — broad/specific/comparative (PRD-019)
│   │   ├── generate-title.ts    # Lightweight title generation prompt (5-8 word summary); GENERATE_TITLE_MAX_TOKENS (PRD-020)
│   │   ├── master-signal-synthesis.ts # System prompts (cold start + incremental) and user message builder
│   │   ├── signal-extraction.ts # System prompt and user message template for signal extraction (used by prompt editor)
│   │   ├── structured-extraction.ts # System prompt and user message builder for generateObject() extraction (PRD-018)
│   │   ├── theme-assignment.ts    # Theme assignment system prompt, max tokens, and buildThemeAssignmentUserMessage() for generateObject() classification (PRD-021)
│   │   └── headline-insights.ts  # Headline insights system prompt, max tokens, InsightAggregates interface, buildHeadlineInsightsUserMessage() for generateObject() insight generation (PRD-021 Part 5)
│   ├── schemas/
│   │   ├── extraction-schema.ts   # Zod schema for structured extraction output — signalChunkSchema, extractionSchema, type exports
│   │   ├── password-schema.ts     # Shared `passwordField` Zod schema (8+ chars, 1 digit, 1 special char) used by signup/reset forms (PRD-011)
│   │   ├── theme-assignment-schema.ts # Zod schema for theme assignment LLM response — themeAssignmentResponseSchema, ThemeAssignmentResponse type (PRD-021)
│   │   └── headline-insights-schema.ts # Zod schema for headline insights LLM response — headlineInsightsResponseSchema (1–5 items), HeadlineInsightsResponse type (PRD-021 Part 5)
│   ├── repositories/
│   │   ├── index.ts                    # Re-exports all repository interfaces and SessionNotFoundRepoError
│   │   ├── attachment-repository.ts    # AttachmentRepository interface
│   │   ├── client-repository.ts        # ClientRepository interface
│   │   ├── conversation-repository.ts  # ConversationRepository interface + ConversationInsert, ConversationUpdate types (PRD-020)
│   │   ├── embedding-repository.ts    # EmbeddingRepository interface + EmbeddingRow, SearchOptions, SimilarityResult types (PRD-019)
│   │   ├── invitation-repository.ts    # InvitationRepository interface
│   │   ├── theme-repository.ts        # ThemeRepository interface + ThemeInsert, ThemeUpdate types (PRD-021)
│   │   ├── signal-theme-repository.ts # SignalThemeRepository interface + SignalThemeInsert type (PRD-021)
│   │   ├── theme-candidate-repository.ts # PRD-026 Part 2 — ThemeCandidateRepository (bulkCreate / deleteByWorkspace / listByWorkspace / getById / deleteById) + ThemeCandidatePairsRepository (findPairs RPC wrapper) + ListCandidatesOptions + ThemeCandidateInsert
│   │   ├── theme-dismissal-repository.ts # PRD-026 Part 2 — ThemeDismissalRepository (create idempotent on 23505, listPairKeysByWorkspace returns Set<pairKey>) + pairKey() canonical helper
│   │   ├── theme-merge-repository.ts  # PRD-026 Part 3 — ThemeMergeRepository (executeMerge RPC wrapper + listByWorkspace) + ListMergesOptions + typed errors MergeValidationError (SQLSTATE 22023), MergeNotFoundError (P0002), MergeRepoError
│   │   ├── insight-repository.ts     # InsightRepository interface + InsightInsert type (PRD-021 Part 5)
│   │   ├── notification-repository.ts # NotificationRepository interface + NotificationInsert, ListForUserOptions, ListForUserResult, DeleteExpiredOptions (PRD-029 Part 1)
│   │   ├── master-signal-repository.ts # MasterSignalRepository interface
│   │   ├── message-repository.ts       # MessageRepository interface + MessageInsert, MessageUpdate types (PRD-020)
│   │   ├── profile-repository.ts       # ProfileRepository interface
│   │   ├── prompt-repository.ts        # PromptRepository interface
│   │   ├── session-repository.ts       # SessionRepository interface + domain types + SessionNotFoundRepoError
│   │   ├── team-repository.ts          # TeamRepository interface
│   │   ├── supabase/
│   │   │   ├── index.ts                          # Re-exports all factory functions (createSessionRepository, etc.)
│   │   │   ├── scope-by-team.ts                  # Shared helper — scopeByTeam(query, teamId) for workspace scoping
│   │   │   ├── supabase-attachment-repository.ts  # Supabase adapter for AttachmentRepository
│   │   │   ├── supabase-client-repository.ts      # Supabase adapter for ClientRepository
│   │   │   ├── supabase-conversation-repository.ts # Supabase adapter for ConversationRepository — cursor pagination, pinned-first ordering (PRD-020)
│   │   │   ├── supabase-embedding-repository.ts   # Supabase adapter for EmbeddingRepository — uses service-role client, similarity search via match_session_embeddings RPC with filter_user_id for personal workspace isolation (PRD-019)
│   │   │   ├── supabase-theme-repository.ts       # Supabase adapter for ThemeRepository — workspace-scoped with scopeByTeam(), case-insensitive findByName via ilike (PRD-021)
│   │   │   ├── supabase-signal-theme-repository.ts # Supabase adapter for SignalThemeRepository — bulk insert, query by embedding IDs or theme ID (PRD-021)
│   │   │   ├── supabase-theme-candidate-repository.ts # PRD-026 Part 2 adapter — joins themes via named FKs (theme_a_id_fkey / theme_b_id_fkey) for current name+description; mapRow asserts the theme_a_id < theme_b_id ordering invariant defensively; pgvector text-format helpers shared with the prevention path; also exposes createThemeCandidatePairsRepository wrapping the find_theme_candidate_pairs RPC
│   │   │   ├── supabase-theme-dismissal-repository.ts # PRD-026 Part 2 adapter — `create` swallows Postgres 23505 (unique violation) as idempotent re-dismissal no-op; `listPairKeysByWorkspace` returns a Set<pairKey> for the in-memory dismissal filter inside refreshCandidates
│   │   │   ├── supabase-theme-merge-repository.ts # PRD-026 Part 3 adapter — `executeMerge` calls the merge_themes RPC, inspects PG SQLSTATE codes (22023 → MergeValidationError, P0002 → MergeNotFoundError) and translates other DB errors to MergeRepoError; echoes archivedThemeId/canonicalThemeId from input through the result so the caller gets a complete MergeResult; `listByWorkspace` is the read path for the audit list with workspace scope + range pagination ordered by merged_at DESC
│   │   │   ├── supabase-insight-repository.ts    # Supabase adapter for InsightRepository — batch read/write, team-scoped, groupIntoBatches() helper (PRD-021 Part 5)
│   │   │   ├── supabase-notification-repository.ts # Supabase adapter for NotificationRepository — keyset pagination via (created_at, id), idempotent markRead, two-phase deleteExpired (date asymmetry + per-row expires_at) (PRD-029 Part 1)
│   │   │   ├── supabase-message-repository.ts     # Supabase adapter for MessageRepository — cursor pagination, newest-first (PRD-020)
│   │   │   ├── supabase-invitation-repository.ts  # Supabase adapter for InvitationRepository
│   │   │   ├── supabase-master-signal-repository.ts # Supabase adapter for MasterSignalRepository
│   │   │   ├── supabase-profile-repository.ts     # Supabase adapter for ProfileRepository
│   │   │   ├── supabase-prompt-repository.ts      # Supabase adapter for PromptRepository
│   │   │   ├── supabase-session-repository.ts     # Supabase adapter for SessionRepository
│   │   │   └── supabase-team-repository.ts        # Supabase adapter for TeamRepository
│   │   └── mock/
│   │       └── mock-session-repository.ts         # In-memory mock for SessionRepository (testing)
│   ├── services/
│   │   ├── ai-service.ts        # AI service — public generics callModelText() and callModelObject<T>() with retry; extractSignals(), synthesiseMasterSignal(), generateConversationTitle(); provider-agnostic via Vercel AI SDK
│   │   ├── chat-service.ts      # Chat service — conversation CRUD, message CRUD, buildContextMessages() with 80K-token budget (PRD-020)
│   │   ├── chat-stream-service.ts # Streaming orchestration — tool definitions (searchInsights, queryDatabase), streamText call, SSE event emission, message finalization (PRD-020)
│   │   ├── chunking-service.ts  # Pure chunking functions — chunkStructuredSignals() and chunkRawNotes() — transforms extraction JSON into EmbeddingChunk arrays (PRD-019)
│   │   ├── database-query/        # Database query module (PRD-020, PRD-021, PRD-023 P5) — 17-action registry serving the dashboard route, chat `queryDatabase` tool, and insight aggregation; replaces the pre-cleanup database-query-service.ts monolith
│   │   │   ├── index.ts           # Public surface — re-exports executeQuery, types (QueryAction, QueryFilters, DatabaseQueryResult, ActionMeta, ChatToolAction), ACTION_METADATA, CHAT_TOOL_ACTIONS, buildChatToolDescription
│   │   │   ├── types.ts           # Type definitions — QueryAction union (17 actions), QueryFilters (extended filters: clientIds, severity, urgency, granularity, confidenceMin, drillDown, sessionId), DatabaseQueryResult, ActionMeta, DrillDownRow
│   │   │   ├── action-metadata.ts # ACTION_METADATA registry (single source of truth for chat-tool exposure), CHAT_TOOL_ACTIONS tuple, buildChatToolDescription, dev-time assertChatToolActionsInSync (prevents tuple/registry drift), LOG_PREFIX
│   │   │   ├── execute-query.ts   # Thin router — ACTION_MAP + executeQuery entry point; validates action, dispatches to handler, emits entry/exit log lines with elapsed ms
│   │   │   ├── shared/
│   │   │   │   ├── base-query-builder.ts # baseSessionQuery + baseClientQuery — team scoping, soft-delete, optional date range, optional clientIds
│   │   │   │   ├── severity-filter.ts    # Cohesive severity API — sessionHasSeverity (sync predicate), filterRowsBySeverity (post-filter), resolveSessionIdsBySeverity (async pre-filter for theme joins); replaces 3 pre-cleanup helpers
│   │   │   │   ├── row-helpers.ts        # extractClientName (joined-row name extractor), aggregateJsonField (bucketed distribution), dateTrunc (week/month bucket)
│   │   │   │   └── theme-helpers.ts      # fetchActiveThemeMap, fetchSignalThemeRows (signal_themes ⨝ session_embeddings ⨝ sessions), applyThemeJoinFilters (team/date/clientIds chain shared by theme widgets and theme drill-down)
│   │   │   └── domains/
│   │   │       ├── counts.ts             # count_clients, count_sessions, sessions_per_client, client_list
│   │   │       ├── distributions.ts      # sentiment_distribution, urgency_distribution, competitive_mention_frequency
│   │   │       ├── sessions.ts           # recent_sessions, sessions_over_time (RPC), client_health_grid (severity/urgency post-filters)
│   │   │       ├── themes.ts             # top_themes, theme_trends, theme_client_matrix
│   │   │       ├── drilldown.ts          # handleDrillDown router + drillDownSchema (Zod discriminated union, 7 strategies) + buildFilterLabel + groupByClient + DRILL_DOWN_LIMIT (100-signal cap)
│   │   │       ├── drilldown-direct.ts   # fetchDirectDrillDownRows + handleCompetitorDrillDown via shared fetchDrillDownRows helper (predicate-driven; preserves direct's case-sensitive `===` and competitor's case-insensitive comparison verbatim)
│   │   │       ├── drilldown-theme.ts    # fetchThemeDrillDownRows — signal_themes-first join, optional bucket/clientId narrowing, sorts by session_date desc
│   │   │       ├── session-detail.ts     # handleSessionDetail — single-row lookup with team scoping (used by chat citation dialog and dashboard "View Session")
│   │   │       └── insights.ts           # handleInsightsLatest (most recent batch, two-step query), handleInsightsHistory (10 prior batches grouped by batch_id)
│   │   ├── embedding-service.ts # Provider-agnostic embedding service — embedTexts() with batching, retry, dimension validation (PRD-019)
│   │   ├── embedding-orchestrator.ts # Coordination layer — generateSessionEmbeddings() ties chunking → embedding → persistence, returns embedding IDs for downstream chaining, fire-and-forget (PRD-019, PRD-021)
│   │   ├── session-orchestrator.ts # Post-response chain owner — runSessionPostResponseChain() builds sessionMeta, selects chunks, creates chain repos, sequences generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights, emits per-stage timing logs + unconditional error log; called from POST /api/sessions and PUT /api/sessions/[id] inside after() (PRD-023 Part 3)
│   │   ├── theme-service.ts     # Theme assignment orchestrator — assignSessionThemes() fetches themes (with embeddings), calls LLM, runs the prevention pre-pass, resolves each proposal via cache → prevention map → create, bulk inserts assignments (PRD-021 Part 1, PRD-026 Part 1)
│   │   ├── theme-prevention.ts  # Embedding-based prevention guard (PRD-026 Part 1) — buildThemeEmbeddingText() (canonical name+description composition, single source of truth shared with backfill), runThemePrevention() (one batched embedding call per extraction, in-memory cosine vs existing themes, returns Map<lowerName, decision>), THEME_PREVENTION_SIMILARITY_THRESHOLD env var (default 0.92), per-decision logging under [theme-prevention]
│   │   ├── theme-candidate-service.ts # Merge-candidate orchestrator (PRD-026 Part 2) — refreshCandidates() (transactional replace via find_theme_candidate_pairs RPC + fetch_theme_stats RPC, scoring via combinedScore = 0.5·sim + 0.3·vol + 0.2·rec, shared-keywords extractor with built-in stop words, dismissal filter), listCandidates() (fetch-limit+1 pagination → { items, hasMore }), dismissCandidate() (records dismissal + deletes candidate row), THEME_CANDIDATE_SIMILARITY_THRESHOLD (default 0.80) + THEME_CANDIDATE_TOP_N (default 20) env vars, CandidateNotFoundError + CandidateAccessError; re-exports WorkspaceCtx from workspace-context.ts for back-compat
│   │   ├── theme-merge-service.ts     # Merge orchestrator (PRD-026 Part 3) — mergeCandidatePair() (candidate getById guard + matchesWorkspace defense + canonical-choice validation + delegate to merge_themes RPC), listRecentMerges() (fetch-limit+1 pagination → { items, hasMore }, default top 10), CandidateNotFoundForMergeError + InvalidCanonicalChoiceError; deliberately does NOT emit notifications — Part 4 will add a single fire-and-forget notificationService.emit() into the success path with no service-shape change
│   │   ├── workspace-context.ts       # PRD-026 Part 3 (extracted in audit) — WorkspaceCtx shape ({ teamId, userId }) + matchesWorkspace() defense-in-depth helper used by services that fetch a row by id and want to verify it belongs to the requesting workspace. Originally lived in theme-candidate-service.ts; extracted once theme-merge-service became the second consumer
│   │   ├── insight-service.ts   # Headline insight generation — generateHeadlineInsights() (aggregates → LLM → batch insert), maybeRefreshDashboardInsights() (conditional fire-and-forget after extraction) (PRD-021 Part 5)
│   │   ├── notification-service.ts # Workspace-notifications service — emit (registry check + Zod parse + insert), listForUser, unreadCount, markRead, markAllRead; UnknownEventTypeError + InvalidPayloadError; consumers import directly (no API routes until Part 2) (PRD-029 Part 1)
│   │   ├── retrieval-service.ts # Retrieval service — retrieveRelevantChunks() with adaptive query classification, embedding, similarity search, deduplication (PRD-019)
│   │   ├── attachment-service.ts # Attachment CRUD — accepts AttachmentRepository
│   │   ├── client-service.ts    # Client search and creation — accepts ClientRepository
│   │   ├── email-service.ts     # Provider-agnostic email sending — sendEmail(), resolveEmailProvider(), Resend adapter
│   │   ├── file-parser-service.ts # File parsing — TXT, PDF, CSV, DOCX, JSON + WhatsApp/Slack chat detection
│   │   ├── invitation-service.ts # Invitation CRUD — accepts InvitationRepository + TeamRepository
│   │   ├── master-signal-service.ts # Master signal CRUD + generateOrUpdateMasterSignal() — accepts MasterSignalRepository
│   │   ├── profile-service.ts   # Server-side profile fetch — accepts ProfileRepository
│   │   ├── prompt-service.ts    # Prompt CRUD — accepts PromptRepository
│   │   ├── session-service.ts   # Session CRUD + checkSessionAccess() — accepts SessionRepository + ClientRepository + MasterSignalRepository
│   │   └── team-service.ts      # Team CRUD + canUserCreateTeam() + getTeamMembersWithProfiles(), getTeamsWithRolesForUser() — accepts TeamRepository (and ProfileRepository for canUserCreateTeam)
│   ├── streaming/                # Client-side streaming-state module (PRD-024 Part 1) — module-level store keyed by conversationId, useSyncExternalStore-backed hooks, SSE loop. No consumers wired yet (legacy useChat still owns chat behavior)
│   │   ├── index.ts              # Public API barrel — types + actions + hooks
│   │   ├── streaming-types.ts    # ConversationStreamSlice, StartStreamArgs, IDLE_SLICE_DEFAULTS, MAX_CONCURRENT_STREAMS (=5, PRD-024 P3.R3)
│   │   ├── streaming-store.ts    # Module-level Map<conversationId, slice> + listener Set + AbortController map; subscribe/getSlice/setSlice/clearAll + selector exports isStreamingForTeam(teamId) / hasUnseenCompletionForTeam(teamId) predicate factories + findSlicesWhere(predicate) generic iteration helper (PRD-024 Part 6 predicate consolidation) — framework-agnostic
│   │   ├── streaming-actions.ts  # startStream (SSE loop, writes to slice; defensive cap guard refuses if at MAX_CONCURRENT_STREAMS), cancelStream (preserves partial content as cancelled bubble), markConversationViewed, markFinalMessageConsumed, clearAllStreams
│   │   └── streaming-hooks.ts    # useStreamingSlice, useIsStreaming, useHasUnseenCompletion, useActiveStreamIds, useActiveStreamCount, useUnseenCompletionIds, useHasAnyUnseenCompletion — useSyncExternalStore-backed; per-conversation hooks (useIsStreaming, useHasUnseenCompletion) use primitive selectors so subscribers to A don't re-render on deltas in B; aggregate hooks cache by teamId for stable refs
│   ├── utils/
│   │   ├── chat-helpers.ts        # Pure utilities — SSE encoding, follow-up parsing/strip, SSE chunk decoder, source mapping and deduplication (PRD-020 + PRD-024 Part 1: parseSSEChunk + stripFollowUpBlock extracted from use-chat.ts)
│   │   ├── compose-ai-input.ts    # Composes raw notes + attachments into a single AI input string
│   │   ├── format-file-size.ts    # File size formatting (bytes → "1.2 KB", "3.4 MB")
│   │   ├── format-relative-time.ts # Relative time formatting ("just now", "5m ago", "3d ago")
│   │   ├── plural.ts              # pluralize(word, count) — singular/plural helper used by the themes settings surface (PRD-026 Parts 2–3) and any future stats-line UI; trivial wrapper today, swappable to `Intl.PluralRules` if irregular plurals or locales arrive
│   │   ├── map-access-error.ts    # mapAccessError() — maps session access denial reasons to HTTP responses
│   │   ├── map-ai-error.ts       # mapAIErrorToResponse() — shared AI error-to-HTTP mapper (5 error types + unexpected)
│   │   ├── render-extracted-signals-to-markdown.ts # Converts ExtractedSignals JSON to markdown (backward compat for structured_notes)
│   │   └── upload-attachments.ts  # Uploads pending attachments to a session (shared by capture form + expanded row)
│   └── supabase/
│       ├── server.ts            # Server-side Supabase clients (anon + service role)
│       └── client.ts            # Browser-side Supabase client factory
├── scripts/                         # One-off operational scripts run via `npm run …` (tsx + @next/env loader, not in the request lifecycle)
│   └── backfill-theme-embeddings.ts # PRD-026 Part 1 backfill — populates `themes.embedding` for every row where the column is NULL. Idempotent; runs once between migrations 001 and 002. Uses buildThemeEmbeddingText for the same name+description composition the prevention guard uses.
└── docs/                            # Each numbered folder contains prd.md + trd.md (and optional SQL migrations)
```

> This map is updated after each increment ships. Only files that exist in the codebase are listed here.

---

## Data Model

### `clients`

Stores known client names for autocomplete and cross-session querying. Scoped to a user (personal workspace) or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | Unique per user or team (case-insensitive) among non-deleted rows |
| `created_by` | UUID | NOT NULL, default `auth.uid()` — owning user |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `clients_name_unique` — unique on `(LOWER(name), created_by)` where `deleted_at IS NULL AND team_id IS NULL`. Team-scoped unique index on `(LOWER(name), team_id)` where `deleted_at IS NULL AND team_id IS NOT NULL`.
**RLS:** Personal: users can SELECT/UPDATE their own non-deleted clients. Team: members can SELECT/UPDATE/INSERT team clients.

### `sessions`

Stores captured client feedback sessions. Scoped to a user or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `client_id` | UUID (FK → clients) | NOT NULL |
| `session_date` | DATE | NOT NULL |
| `raw_notes` | TEXT | NOT NULL, supports markdown |
| `structured_notes` | TEXT | Nullable. Markdown-formatted signal extraction output (derived from structured_json for backward compat). |
| `structured_json` | JSONB | Nullable. Schema-validated JSON extraction output (PRD-018). Primary structured data, markdown is derived from this. |
| `prompt_version_id` | UUID (FK → prompt_versions) | Nullable. Links to the prompt version that produced the structured notes. ON DELETE SET NULL. |
| `extraction_stale` | BOOLEAN | NOT NULL, default `false`. True when raw input or structured notes changed since last extraction. |
| `structured_notes_edited` | BOOLEAN | NOT NULL, default `false`. True when structured notes are manually edited (outside extraction). Reset on fresh extraction or when structured notes are cleared. |
| `updated_by` | UUID (FK → auth.users) | Nullable. Set to the authenticated user's ID on every session update (PUT). ON DELETE SET NULL. |
| `created_by` | UUID | Default `auth.uid()` — Supabase Auth user ID |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `sessions_client_id_idx` (filtered), `sessions_session_date_idx` (desc, filtered), `sessions_prompt_version_id_idx` — on `prompt_version_id` where `prompt_version_id IS NOT NULL AND deleted_at IS NULL`.
**RLS:** Personal: users SELECT/UPDATE own sessions. Team: members SELECT all team sessions; admins UPDATE/DELETE any team session; sales UPDATE/DELETE only own team sessions. INSERT allowed for authenticated users.

### `session_attachments`

Stores uploaded file metadata and parsed content for session attachments. Original files are stored in the `SYNTHESISER_FILE_UPLOAD` Supabase Storage bucket.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `session_id` | UUID (FK → sessions) | NOT NULL |
| `file_name` | TEXT | NOT NULL, original upload file name |
| `file_type` | TEXT | NOT NULL, MIME type |
| `file_size` | INTEGER | NOT NULL, file size in bytes |
| `storage_path` | TEXT | NOT NULL, path in Storage bucket (`{ownerId}/{sessionId}/{uuid}.{ext}`) |
| `parsed_content` | TEXT | NOT NULL, extracted text from file |
| `source_format` | TEXT | NOT NULL, detected format (`generic`, `whatsapp`, `slack`) |
| `created_by` | UUID | Default `auth.uid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**Indexes:** `session_attachments_session_id_idx` — on `session_id` where `deleted_at IS NULL`.
**RLS:** Personal: users SELECT/INSERT their own attachments. Team: members SELECT team attachments; INSERT allowed for authenticated users. Service role handles DELETE (soft-delete + storage cleanup).
**Storage bucket:** `SYNTHESISER_FILE_UPLOAD` — private, max 10 MB per file. Files stored at `{ownerId}/{sessionId}/{uuid}.{ext}`. All operations via service role client.

### `session_embeddings`

Stores vector embeddings of chunked session extraction data for semantic similarity search. Each row represents one embeddable chunk (e.g., a single pain point, requirement, or summary) with its vector and metadata.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `session_id` | UUID (FK → sessions) | NOT NULL. ON DELETE CASCADE — embeddings removed when session is deleted. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. Mirrors scoping pattern of `sessions`. |
| `chunk_text` | TEXT | NOT NULL. Human-readable text of the embedded chunk. |
| `chunk_type` | TEXT | NOT NULL. One of: `summary`, `client_profile`, `pain_point`, `requirement`, `aspiration`, `competitive_mention`, `blocker`, `tool_and_platform`, `custom`, `raw`. Stored as text (not enum) for extensibility. |
| `metadata` | JSONB | NOT NULL, default `'{}'`. Type-specific fields: `client_name`, `session_date`, `severity`, `priority`, `competitor`, `category_name`, `client_quote`, etc. |
| `embedding` | vector(1536) | NOT NULL. Embedding vector (dimension matches configured embedding model). |
| `schema_version` | INTEGER | NOT NULL, default `1`. Matches extraction schema version for schema-aware retrieval. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `session_embeddings_embedding_hnsw_idx` — HNSW index on `embedding` using `vector_cosine_ops` for cosine similarity search. `session_embeddings_session_id_idx` — on `session_id` for cascade deletes and re-extraction cleanup. `session_embeddings_team_chunk_type_idx` — on `(team_id, chunk_type)` for filtered similarity searches.
**RLS:** Personal: users SELECT/INSERT/UPDATE/DELETE embeddings for their own sessions. Team: members SELECT/INSERT/UPDATE/DELETE team embeddings via `is_team_member()`.

### `themes`

Workspace-scoped topic-based themes assigned to signal chunks by the AI during extraction. Themes describe *what* a signal is about (e.g., "Onboarding Friction", "API Performance"), not what type it is (chunk_type already captures that).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | NOT NULL. Human-readable theme label (2-4 words, topic-based). |
| `description` | TEXT | Nullable. One-sentence description of what the theme covers. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `initiated_by` | UUID (FK → auth.users) | NOT NULL. The user whose action triggered theme creation. |
| `origin` | TEXT | NOT NULL, default `'ai'`. Either `'ai'` (created during extraction) or `'user'` (future manual creation). |
| `is_archived` | BOOLEAN | NOT NULL, default `false`. Archived themes are excluded from future assignments but preserved for historical data. |
| `embedding` | vector(1536) | NOT NULL (post-rollout, PRD-026 Part 1 migration 002). Vector representation of `name` + `description` used by the prevention guard at extraction time and reserved for Part 2's candidate generation. |
| `merged_into_theme_id` | UUID (FK → themes) | Nullable. Forward-compat for PRD-026 Part 3 — when an admin merges a theme, the archived row gets a pointer to the canonical row it was merged into. Always NULL until Part 3 ships. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `themes_team_id_idx` — on `team_id` for workspace-scoped queries. Partial unique indexes: `themes_unique_name_team` — `UNIQUE (LOWER(name), team_id) WHERE team_id IS NOT NULL` for team dedup; `themes_unique_name_personal` — `UNIQUE (LOWER(name), initiated_by) WHERE team_id IS NULL` for personal workspace dedup. `themes_embedding_hnsw_idx` — HNSW index on `embedding` using `vector_cosine_ops` for cosine similarity (PRD-026 Part 1; reserved for Part 2's candidate generation). `themes_merged_into_theme_id_idx` — partial index on `merged_into_theme_id WHERE NOT NULL` (forward-compat for PRD-026 Part 3 audit lookups).
**RLS:** Personal: users SELECT/INSERT/UPDATE/DELETE their own themes. Team: members SELECT/INSERT/UPDATE/DELETE team themes via `is_team_member()`. Service-role client used for AI-driven writes during fire-and-forget extraction.

### `signal_themes`

Many-to-many junction table linking signal embeddings to themes. Each row represents one theme assignment for one signal chunk, with confidence score and attribution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `embedding_id` | UUID (FK → session_embeddings) | NOT NULL. ON DELETE CASCADE — assignments removed when embeddings are re-extracted. |
| `theme_id` | UUID (FK → themes) | NOT NULL. ON DELETE CASCADE — assignments removed when theme is deleted. |
| `assigned_by` | TEXT | NOT NULL, default `'ai'`. Either `'ai'` or `'user'` (future manual assignment). |
| `confidence` | REAL | Nullable. AI confidence score (0.0–1.0). NULL for manual assignments. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `signal_themes_embedding_id_idx` — on `embedding_id` for join queries from embeddings to themes. `signal_themes_theme_id_idx` — on `theme_id` for theme-centric queries (dashboard widgets). Unique index: `signal_themes_embedding_theme_unique` — `UNIQUE (embedding_id, theme_id)` prevents duplicate assignments.
**RLS:** Inherits access from parent tables via FK joins. Personal: users SELECT/INSERT/DELETE assignments for their own embeddings. Team: members SELECT/INSERT/DELETE team assignments via `is_team_member()`. Service-role client used for AI-driven bulk inserts.

### `theme_merge_candidates`

Workspace-scoped ranked list of theme pairs that look like duplicates, surfaced on the admin `/settings/themes` page (PRD-026 Part 2). Persisted output of `theme-candidate-service.refreshCandidates()`; the page reads this table directly so visits don't pay pairwise-similarity compute cost.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `initiated_by` | UUID (FK → auth.users) | NOT NULL. The user whose action triggered the refresh that produced this row. |
| `theme_a_id` | UUID (FK → themes) | NOT NULL. ON DELETE CASCADE. |
| `theme_b_id` | UUID (FK → themes) | NOT NULL. ON DELETE CASCADE. CHECK `theme_a_id < theme_b_id` enforces normalized pair ordering so (A, B) and (B, A) are the same row. |
| `similarity_score` | REAL | NOT NULL. Cosine similarity 0..1. |
| `volume_score` | REAL | NOT NULL. Log-scaled sum of both sides' assignment counts, normalised to 0..1. |
| `recency_score` | REAL | NOT NULL. Exponential decay on most-recent assignment, half-life 30 days. |
| `combined_score` | REAL | NOT NULL. `0.5·sim + 0.3·vol + 0.2·rec`. Sort key for the admin surface. |
| `theme_a_assignment_count` / `theme_a_distinct_sessions` / `theme_a_distinct_clients` / `theme_a_last_assigned_at` | INTEGER / INTEGER / INTEGER / TIMESTAMPTZ | NOT NULL (count fields default 0); snapshot of theme A stats at refresh time. |
| `theme_b_assignment_count` / `theme_b_distinct_sessions` / `theme_b_distinct_clients` / `theme_b_last_assigned_at` | INTEGER / INTEGER / INTEGER / TIMESTAMPTZ | NOT NULL; snapshot of theme B stats at refresh time. |
| `shared_keywords` | TEXT[] | NOT NULL, default `'{}'`. Tokenised intersection of both names+descriptions, capped at 3 tokens, used as the "why this looks like a duplicate" hint. |
| `refresh_batch_id` | UUID | NOT NULL. Groups every row produced by a single refresh; lets the transactional replace identify and clean up the prior set. |
| `generated_at` | TIMESTAMPTZ | Default `now()`. Drives the "Last refreshed at" UI label. |

**Indexes:** Per-workspace unique pair indexes — `theme_merge_candidates_unique_pair_team` `UNIQUE (theme_a_id, theme_b_id, team_id) WHERE team_id IS NOT NULL` and `theme_merge_candidates_unique_pair_personal` `UNIQUE (theme_a_id, theme_b_id, initiated_by) WHERE team_id IS NULL`. Sort/scan support — `theme_merge_candidates_team_score_idx` and `theme_merge_candidates_personal_score_idx` (each `(workspace, combined_score DESC)`). Refresh-batch lookup — `theme_merge_candidates_batch_idx` on `refresh_batch_id`.
**RLS:** Read-only for workspace members (`is_team_member(team_id)` for team workspaces, `initiated_by = auth.uid()` for personal). No INSERT/UPDATE/DELETE policies — those operations go through the service-role client (bypassing RLS) inside `theme-candidate-service.refreshCandidates` / `dismissCandidate` only.

### `theme_merge_dismissals`

Records admin "not a duplicate" judgments against candidate pairs (PRD-026 P2.R5). Read by `refreshCandidates` to filter dismissed pairs out of every subsequent persisted candidate set, so dismissals survive across refreshes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `initiated_by` | UUID (FK → auth.users) | NOT NULL. Owner-side scoping for personal workspaces. |
| `theme_a_id` | UUID (FK → themes) | NOT NULL. ON DELETE CASCADE. CHECK `theme_a_id < theme_b_id`. |
| `theme_b_id` | UUID (FK → themes) | NOT NULL. ON DELETE CASCADE. |
| `dismissed_by` | UUID (FK → auth.users) | NOT NULL. Audit trail — who clicked Dismiss. |
| `dismissed_at` | TIMESTAMPTZ | Default `now()`. |

**Indexes:** Per-workspace unique pair indexes mirroring the candidates table — `theme_merge_dismissals_unique_pair_team` and `theme_merge_dismissals_unique_pair_personal`. Insert idempotence is achieved via the `23505` unique-constraint violation being swallowed at the repository layer.
**RLS:** Read-only for workspace members (same pattern as candidates). Writes go through the service-role client only.

### `theme_merges`

Snapshot audit log of every confirmed theme merge in a workspace (PRD-026 Part 3). Written by the `merge_themes` RPC, never directly. Read by the "Recent merges" admin section of `/settings/themes` and (in Part 4) by the `theme.merged` notification emitter.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. ON DELETE CASCADE. |
| `initiated_by` | UUID (FK → auth.users) | NOT NULL. Owner-side scoping for personal workspaces. ON DELETE CASCADE. |
| `archived_theme_id` | UUID | NOT NULL. **No FK** — the audit row must survive a future hard-delete of the theme (TRD Decision 24). |
| `canonical_theme_id` | UUID | NOT NULL. Same — no FK. |
| `archived_theme_name` | TEXT | NOT NULL. Snapshotted at merge time so renames don't rewrite history. |
| `canonical_theme_name` | TEXT | NOT NULL. Snapshotted. |
| `actor_id` | UUID (FK → auth.users) | NOT NULL. Who clicked Confirm. |
| `reassigned_count` | INTEGER | NOT NULL. Number of `signal_themes` rows actually re-pointed (post-dedup, see Decision 23). |
| `distinct_sessions` | INTEGER | NOT NULL. Distinct sessions touched by the archived theme at merge time. |
| `distinct_clients` | INTEGER | NOT NULL. Distinct clients (from `session_embeddings.metadata->>'client_name'`) touched at merge time. |
| `merged_at` | TIMESTAMPTZ | Default `now()`. |

**Indexes:** Per-workspace recent-merges read pattern — `theme_merges_team_merged_at_idx` `(team_id, merged_at DESC) WHERE team_id IS NOT NULL` and `theme_merges_personal_merged_at_idx` `(initiated_by, merged_at DESC) WHERE team_id IS NULL`.
**RLS:** Read-only for workspace members (`is_team_member(team_id)` for team workspaces, `initiated_by = auth.uid()` for personal). No INSERT policy for the authenticated role — the `merge_themes` function under `SECURITY DEFINER` is the only legitimate writer.

### `master_signals`

Stores immutable snapshots of the AI-synthesised master signal document. Scoped to a user or a team.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `content` | TEXT | NOT NULL. Markdown content of the generated master signal |
| `generated_at` | TIMESTAMPTZ | NOT NULL. When this generation completed |
| `sessions_included` | INTEGER | NOT NULL. Total number of sessions that contributed |
| `is_tainted` | BOOLEAN | NOT NULL, default `false`. Forces cold-start on next generation. |
| `created_by` | UUID | NOT NULL. `auth.uid()` — who triggered the generation |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `master_signals_generated_at_idx` — DESC on `generated_at`.
**RLS:** Personal: users SELECT own master signals. Team: members SELECT team master signals. INSERT allowed for authenticated users. No UPDATE or DELETE (except service role sets `is_tainted`).

### `profiles`

Stores user metadata, auto-created by a trigger on `auth.users`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK, FK → auth.users.id) | CASCADE on delete |
| `email` | TEXT | NOT NULL, copied from auth.users |
| `is_admin` | BOOLEAN | NOT NULL, default `false` |
| `can_create_team` | BOOLEAN | NOT NULL, default `false`. Developer-set flag to enable team creation. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

**RLS:** Authenticated users can SELECT their own row only.
**Trigger:** `on_auth_user_created` — fires `AFTER INSERT` on `auth.users`, creates a `profiles` row with `id` and `email`.

### `teams`

Stores team workspaces. Team creation is gated by `profiles.can_create_team`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | NOT NULL, 1–100 characters |
| `owner_id` | UUID (FK → auth.users.id) | NOT NULL — team creator and current owner |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

**RLS:** Team members can SELECT their own teams. Owner can SELECT immediately after creation.

### `team_members`

Junction table linking users to teams with roles.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | NOT NULL |
| `user_id` | UUID (FK → auth.users.id) | NOT NULL |
| `role` | TEXT | NOT NULL, CHECK: `admin`, `sales` |
| `joined_at` | TIMESTAMPTZ | Default `now()` |
| `removed_at` | TIMESTAMPTZ | Nullable. Set when member leaves/removed. |

**Indexes:** Unique on `(team_id, user_id)` where `removed_at IS NULL`.
**RLS:** Members can SELECT their own team's membership list.

### `team_invitations`

Stores pending and historical team invitations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | NOT NULL |
| `email` | TEXT | NOT NULL |
| `role` | TEXT | NOT NULL, CHECK: `admin`, `sales` |
| `token` | TEXT | NOT NULL, unique. Used in invite URL. |
| `invited_by` | UUID (FK → auth.users.id) | NOT NULL |
| `accepted_at` | TIMESTAMPTZ | Nullable. Set when invitation is accepted. |
| `expires_at` | TIMESTAMPTZ | NOT NULL. Invite expiry (7 days from creation). |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**RLS:** Team admins can SELECT/INSERT/UPDATE their team's invitations.

### `prompt_versions`

Stores versioned AI system prompts per user or team workspace. Each save/reset/revert creates a new row. Only one row per `(prompt_key, created_by)` or `(prompt_key, team_id)` can be active at a time.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `prompt_key` | TEXT | NOT NULL, CHECK: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental` |
| `content` | TEXT | NOT NULL, full prompt body |
| `author_id` | UUID (FK → auth.users.id) | Nullable. NULL for system-seeded rows. |
| `author_email` | TEXT | NOT NULL, default `'system'`. Denormalised for display. |
| `is_active` | BOOLEAN | NOT NULL, default `false`. |
| `created_by` | UUID (FK → auth.users.id) | Nullable. Default `auth.uid()`. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** Partial unique index enforces one active per key per workspace scope.
**RLS:** Users can SELECT/INSERT/UPDATE their own prompt versions. Team members can access team-scoped prompts.

### `conversations`

Stores chat conversation threads. User-private (not team-shared). Scoped by team context for data isolation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `title` | TEXT | NOT NULL. Placeholder (first 80 chars), then LLM-generated title. |
| `created_by` | UUID (FK → auth.users) | NOT NULL. Owning user. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. ON DELETE SET NULL. |
| `is_pinned` | BOOLEAN | NOT NULL, default `false`. |
| `is_archived` | BOOLEAN | NOT NULL, default `false`. |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger + message insert trigger. |

**Indexes:** `idx_conversations_user_list` on `(created_by, is_archived, is_pinned DESC, updated_at DESC)`.
**RLS:** User-private — SELECT, INSERT, UPDATE, DELETE all require `created_by = auth.uid()`.

### `messages`

Stores individual messages within conversations. Access derived from conversation ownership.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `conversation_id` | UUID (FK → conversations) | NOT NULL. ON DELETE CASCADE. |
| `parent_message_id` | UUID (FK → messages) | Nullable. For future edit/retry branching. ON DELETE SET NULL. |
| `role` | TEXT | NOT NULL, CHECK: `user`, `assistant`. |
| `content` | TEXT | NOT NULL, default `''`. |
| `sources` | JSONB | Nullable. Array of ChatSource objects (sessionId, clientName, sessionDate, chunkText, chunkType). |
| `status` | TEXT | NOT NULL, default `completed`, CHECK: `completed`, `streaming`, `failed`, `cancelled`. |
| `metadata` | JSONB | Nullable. Model label, tools called, etc. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `idx_messages_conversation_created` on `(conversation_id, created_at ASC)`.
**RLS:** Derived from conversation ownership — all operations require `EXISTS (SELECT 1 FROM conversations WHERE id = conversation_id AND created_by = auth.uid())`.

### `dashboard_insights`

Stores AI-generated headline insight cards displayed above the dashboard widget grid. Rows are written in batches (3–5 insights per batch) keyed by `batch_id`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `content` | TEXT | NOT NULL. The insight text rendered in the card. |
| `insight_type` | TEXT | NOT NULL, CHECK: `trend`, `anomaly`, `milestone`. Drives card styling (blue/info, amber/warning, green/success). |
| `batch_id` | UUID | NOT NULL. Groups the 3–5 insights produced by a single generation call. |
| `team_id` | UUID (FK → teams) | Nullable. NULL = personal workspace. |
| `created_by` | UUID (FK → auth.users) | NOT NULL. The user whose action triggered the batch. |
| `generated_at` | TIMESTAMPTZ | NOT NULL, default `now()`. |

**Indexes:** `(team_id, batch_id)` for batch lookups; `(team_id, generated_at DESC)` for latest-first queries.
**RLS:** Personal: users SELECT/INSERT their own insights. Team: members SELECT team insights via `is_team_member()`. Service-role client used for AI-driven batch inserts during fire-and-forget `maybeRefreshDashboardInsights()`.

### `workspace_notifications`

Persistent workspace-level notifications. One row per notification. Visibility is encoded in `(team_id, user_id)`: a non-null `user_id` is a *targeted* notification visible only to that user; a null `user_id` is a *broadcast* visible to every member of `team_id`. Event-type strings are governed by the closed application-layer registry in `lib/notifications/events.ts` — there is intentionally no DB-level CHECK constraint, so adding a new event type is a single-file code change.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `team_id` | UUID (FK → teams) | NOT NULL. Workspace context the notification belongs to (drives RLS broadcast scoping and the bell's per-row workspace label). |
| `user_id` | UUID (FK → auth.users) | Nullable. NOT NULL = targeted; NULL = broadcast to team members. |
| `event_type` | TEXT | NOT NULL. Identifier from the closed registry (`theme.merged`, `supersession.proposed`, `bulk_re_extract.completed`, …). |
| `payload` | JSONB | NOT NULL, default `'{}'`. Validated against the event-type's Zod schema at emit time; reads must go through `payloadSchemaFor(eventType)` to retain runtime contract. |
| `read_at` | TIMESTAMPTZ | Nullable. Set by `markRead` / `markAllRead`; idempotent — re-reads are no-ops. |
| `expires_at` | TIMESTAMPTZ | Nullable. Per-row override for retention; deleted by Part 5's cleanup before the default age cutoff fires. |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()`. |

**Indexes:** `(user_id, created_at DESC) WHERE user_id IS NOT NULL` for the targeted dropdown; `(user_id) WHERE user_id IS NOT NULL AND read_at IS NULL` for the unread badge; `(team_id, created_at DESC) WHERE user_id IS NULL` for broadcast listings; `(expires_at) WHERE expires_at IS NOT NULL` for Part 5's cleanup pass.
**RLS:** SELECT and UPDATE policies grant access to rows where `user_id = auth.uid()` OR (`user_id IS NULL` AND the user is a member of `team_id`); INSERT and DELETE have no policies, so service-role-only writes (the `notification-service.emit` and Part 5's `deleteExpired` paths). Column-scope on UPDATE (only `read_at` mutates) is enforced at the service layer, not by RLS.
**Realtime:** Published to `supabase_realtime` (PRD-029 Part 4) so the bell hooks can subscribe via `useNotificationRealtime`. RLS applies to the event stream — each subscriber receives only changes for rows their SELECT policy lets them see, so no explicit channel filter is needed.

### Shared functions and triggers

- `update_updated_at()` — BEFORE UPDATE trigger on `clients`, `sessions`, `profiles`, `teams`, and `conversations` tables, sets `updated_at = now()`.
- `update_conversation_updated_at()` — AFTER INSERT trigger on `messages`, bumps `conversations.updated_at` to `now()` for the parent conversation.
- `handle_new_user()` — SECURITY DEFINER function, triggered AFTER INSERT on `auth.users`, creates a `profiles` row.
- `is_admin()` — SECURITY DEFINER function, returns `true` if the current user's profile has `is_admin = true`. Retained in database.
- `is_team_member(team_uuid)` — SECURITY DEFINER function, returns `true` if the current user is an active member of the given team.
- `get_team_role(team_uuid)` — SECURITY DEFINER function, returns the current user's role in the given team (or NULL).
- `is_team_admin(team_uuid)` — SECURITY DEFINER function, returns `true` if the current user's role is `admin` in the given team.

---

## Authentication Flow

**Providers:** Supabase Auth with two paths — Google OAuth and email + password. Open to any account (no domain allowlist). Email confirmation is required for new email/password sign-ups.

**Middleware** (`middleware.ts`) runs on every request. It refreshes the Supabase session via `getUser()`, redirects unauthenticated users to `/login`, and validates the `active_team_id` cookie (clears if user is no longer a member). Public routes (`/`, `/login`, `/signup`, `/forgot-password`, `/auth/callback`, `/invite/*`) are excluded. Authenticated users who hit `/login`, `/signup`, or `/forgot-password` are bounced to `DEFAULT_AUTH_ROUTE` (`/dashboard`). `/reset-password` is not public — users arrive there via the recovery link which establishes a session first.

**Google OAuth flow:**

1. User visits `/login` or `/signup` and clicks "Continue with Google."
2. `supabase.auth.signInWithOAuth({ provider: 'google' })` redirects to the Google consent screen.
3. Google redirects back to `/auth/callback?code=...`.
4. The callback route handler exchanges the code for a session via `supabase.auth.exchangeCodeForSession(code)`.
5. On success: the callback checks `sessions` count for the user — redirects to `DEFAULT_AUTH_ROUTE` (`/dashboard`) for returning users and `ONBOARDING_ROUTE` (`/capture`) for accounts with no sessions. Both constants live in `lib/constants.ts`. On failure: redirect to `/login?error=exchange_failed`.

**Email + password flow:**

1. **Sign-up** (`/signup`): user submits email + password (`passwordField` Zod schema: 8+ chars, 1 digit, 1 special char). Supabase sends a confirmation email; UI shows `EmailConfirmationPanel` until confirmed.
2. **Sign-in** (`/login`): same page hosts email/password and Google OAuth. Email/password sign-in establishes a session directly; the form then calls `router.push(DEFAULT_AUTH_ROUTE)` (or `ONBOARDING_ROUTE` for first-run accounts).
3. **Forgot password** (`/forgot-password`): `supabase.auth.resetPasswordForEmail()` with `redirectTo=...?type=recovery`. Email triggers the recovery link.
4. **Reset password** (`/reset-password`): the auth callback recognises `type=recovery` and redirects here; the form calls `supabase.auth.updateUser({ password })` to commit the new password.

**Shared auth context:**

- **AuthProvider** (`components/providers/auth-provider.tsx`) wraps the app in `layout.tsx`. It reads the initial session on mount, subscribes to `onAuthStateChange`, and exposes `user`, `isAuthenticated`, `isLoading`, `canCreateTeam`, `activeTeamId`, `setActiveTeam`, and `signOut` via React context. `signOut()` calls `supabase.auth.signOut()`, `clearActiveTeamCookie()`, and `clearAllStreams()` (PRD-024) so workspace context, streaming state, and the user identity don't leak to the next session on the same machine. The `onAuthStateChange` listener mirrors the same cleanup on any session-null transition (token expiry, multi-tab sign-out, server-side revoke) — not just the explicit `signOut` path (PRD-024 P5.R4).
- **UserMenu** consumes the auth context. Shows a loading skeleton while `isLoading`, a "Sign in" link when unauthenticated, and the user's avatar + email with a sign-out dropdown when authenticated.

**Invite acceptance flow:**

1. User receives an email with a link to `/invite/[token]`.
2. If authenticated and email matches the invitation: `InviteAcceptCard` shows team name, role, and "Accept & Join Team" button. Accepting calls `POST /api/invite/[token]/accept`, which creates a `team_members` entry and sets `active_team_id` cookie.
3. If authenticated but email does NOT match: `InviteMismatchCard` warns the user and offers a sign-out option.
4. If unauthenticated + account already exists for the invited email: `InviteSignInForm` — email is pre-filled; password or Google OAuth completes sign-in. A `pending_invite_token` cookie is set before any OAuth redirect.
5. If unauthenticated + no account exists: `InviteSignUpForm` — email is pre-filled; completing sign-up flows through confirmation.
6. After OAuth callback, if `pending_invite_token` exists and the signed-in email matches the invitation email, the callback auto-accepts the invitation, sets `active_team_id`, and clears the pending token cookie. On email mismatch the callback redirects to `/invite/[token]?error=email_mismatch`.

**Workspace context:**

- The `active_team_id` cookie determines the current workspace (personal or team). Absence = personal workspace.
- The **AuthProvider** exposes `activeTeamId` and `setActiveTeam()` via React context. `setActiveTeam` writes the cookie and updates context state, triggering reactive re-renders in all consuming components — no page reload needed.
- The **WorkspaceSwitcher** and **CreateTeamDialog** call `setActiveTeam()` to switch workspaces. Client-side cookie helpers live in `lib/cookies/active-team.ts`.
- Route handlers read the active team ID via `getActiveTeamId()` from `lib/cookies/active-team-server.ts`, then pass it to repository factories. Services receive pre-scoped repositories — they never call `getActiveTeamId()` directly.

---

## Streaming Context (PRD-024)

> The chat-streaming subsystem owns all client-side state for in-flight and recently-completed AI responses. It is the source of truth for streaming bubbles, sidebar dots, the AppSidebar Chat icon dot, and the conversations-sidebar footer text.

### Role and placement

The streaming context lives in `lib/streaming/` as a **module-level singleton** — not a React Context, not Redux, not Zustand. Its state (`Map<conversationId, ConversationStreamSlice>`, listener `Set`, and `Map<conversationId, AbortController>`) lives in module scope, not React scope. This is the cross-page survival mechanism: navigating from `/chat` to `/dashboard` unmounts every chat-related React component, but the streaming state persists because the JS module is still loaded.

The store is wiped only by:

- **Hard browser refresh** — full bundle reload kills the JS context.
- **`clearAllStreams()`** called from `auth-provider`'s `signOut` AND the `onAuthStateChange` session-null branch (covers explicit sign-out, token expiry, multi-tab sign-out, and server-side revocation).

### Per-conversation slice model

Each conversation has its own `ConversationStreamSlice` (defined in `lib/streaming/streaming-types.ts`):

| Field | Purpose |
|---|---|
| `conversationId` | Slice identity |
| `teamId` | Workspace tag — NULL = personal. Drives workspace-scoped UI filtering |
| `streamState` | `idle` / `streaming` / `error` |
| `streamingContent` | Accumulated content during streaming |
| `statusText` | Ephemeral tool-execution status ("Searching...", etc.) |
| `latestSources` | Citations from the latest stream |
| `latestFollowUps` | Follow-up question chips |
| `error` | User-visible error message when `streamState` is `error` |
| `assistantMessageId` | UUID from `X-Assistant-Message-Id` response header |
| `hasUnseenCompletion` | True from a terminal-state-with-content until the user views the conversation |
| `finalMessage` | Set on streaming→idle transition; consumed by `useChat`'s fold (P2.R7 no-flicker) |
| `startedAt` | ms epoch — for ordering and stale-stream detection |

The slice carries every field any consumer needs in one place; React subscribers read fields via primitive selectors or the full slice.

### Public API surface

Defined in `lib/streaming/index.ts` (the module's barrel — consumers never import internal modules directly):

**Imperative actions** (called from event handlers or auth lifecycle, not React render):

- `startStream(args)` — kicks off the SSE loop for a conversation; defensive cap guard refuses if `count >= MAX_CONCURRENT_STREAMS`.
- `cancelStream(conversationId)` — aborts and writes the cancelled bubble to `slice.finalMessage`.
- `markConversationViewed(conversationId)` — clears `hasUnseenCompletion`.
- `markFinalMessageConsumed(conversationId)` — clears `finalMessage` after the consumer (`useChat` fold) folds it into the message list.
- `clearAllStreams()` — sign-out / session-end teardown; aborts every controller, drops every slice.

**React hooks** (subscribe via `useSyncExternalStore`):

- Per-conversation primitive selectors: `useIsStreaming(id)`, `useHasUnseenCompletion(id)`, `useStreamingSlice(id)`.
- Workspace-scoped aggregates (cached for stable refs): `useActiveStreamIds(teamId)`, `useActiveStreamCount(teamId)`, `useUnseenCompletionIds(teamId)`, `useHasAnyUnseenCompletion(teamId)`.

**Selectors** (used by both action and hook layers — single source of truth for the predicates):

- `isStreamingForTeam(teamId)`, `hasUnseenCompletionForTeam(teamId)` — predicate factories.
- `findSlicesWhere(predicate)` — generic iteration helper.

**Constants:**

- `MAX_CONCURRENT_STREAMS = 5` — soft concurrency cap per workspace.

### Multi-stream concurrency

A user may run up to **5 concurrent streams per workspace** (`MAX_CONCURRENT_STREAMS`). Each conversation has its own SSE loop, its own `AbortController`, its own slice — they are fully independent. Cancelling one does not affect the others; completion in one does not block another.

The cap is enforced at two layers:

1. **UI gate** in `chat-area.tsx`'s `capReached` derivation, threaded to `chat-input.tsx`'s Send button (disabled + inline blocking message) AND `starter-questions.tsx`'s buttons (disabled).
2. **Defensive runtime guard** at the top of `startStream` in `streaming-actions.ts`. If a future caller bypasses the UI gate, the guard logs a warning and refuses without seeding a slice.

The cap is **workspace-scoped**: a user can have 5 personal streams + 5 team streams running simultaneously without either count blocking the other.

### Cross-page stream survival

Streams started on `/chat/<id>` continue running when the user navigates to `/dashboard`, `/capture`, `/settings`, etc. The streaming module is at module scope; the SSE loop in `runStream` is a detached promise with no React lifecycle observation. On return to `/chat/<id>`, the new `useChat` instance subscribes to the slice and reads its current state — either still streaming (live bubble + Stop button) or completed (assistant message in the thread).

The boundary is **hard refresh**, which wipes everything client-side. The server may still complete the stream and persist its message; the client just re-fetches via `/api/chat/conversations/[id]/messages` on next chat load. Client-side resume from a still-running server stream is in the PRD backlog, not in scope.

### Workspace isolation

Slices carry `teamId`; every public hook filters by `teamId`. Switching workspaces via the `WorkspaceSwitcher` hides cross-workspace state from UI but does **not** abort in-flight streams — they continue to run server-side, their slices remain in the store, and they re-surface on switch back. Sign-out clears the entire store (no leak across users on the same browser).

### `useChat` consumption pattern

`useChat` (`lib/hooks/use-chat.ts`) is a **thin composer** (~128 LOC) that wires two focused sub-hooks:

- **`useConversationMessages`** (`lib/hooks/use-conversation-messages.ts`) — message-list state, load-on-conversation-change with the Gap P9 skip-refetch guard, pagination via `fetchMoreMessages`, `clearMessages`, `isConversationNotFound` for cross-user UUIDs.
- **`useChatStreaming`** (`lib/hooks/use-chat-streaming.ts`) — slice subscription via `useStreamingSlice`, six derived passthrough fields, `sendMessage` / `cancelStream` / `retryLastMessage` delegating to the streaming module, the `useLayoutEffect` fold for `finalMessage` (P2.R7 no-flicker bubble→message swap), and the `useLayoutEffect` clear-unseen for in-view auto-acknowledgment.

The composition seam is `setMessages` + `messages` threaded from `useConversationMessages` to `useChatStreaming`. Three writers — optimistic add (sendMessage), retry trim (retryLastMessage), fold append (useLayoutEffect) — all flow through the single threaded `setMessages` reference.

### Three-tier indicator system

The streaming context surfaces in three UI tiers, all reading from the same store via the same hooks:

| Tier | Surface | File | Subscribes to |
|---|---|---|---|
| **Per-conversation** | Sidebar entry dot (pulsing or solid) | `conversation-item.tsx` | `useIsStreaming(id)`, `useHasUnseenCompletion(id)` |
| **Workspace-aggregate** | Footer text (*"N chats are streaming"* / *"Start a conversation"*) | `conversation-sidebar.tsx` | `useActiveStreamCount(teamId)` |
| **Global / off-chat** | Chat icon dot in the AppSidebar | `app-sidebar.tsx` | `useActiveStreamCount(teamId)`, `useHasAnyUnseenCompletion(teamId)` |

All three use the same lifecycle (always-set + consumer-clears, established in Part 4), the same brand-accent token, and the same a11y pattern (decorative `aria-hidden` dot + cohesive `aria-label` on the parent interactive element). The user is never unaware that streams are running or that responses are pending — regardless of which page they are on.

### File layout summary

```
lib/streaming/
├── streaming-types.ts       # ConversationStreamSlice, StartStreamArgs, IDLE_SLICE_DEFAULTS, MAX_CONCURRENT_STREAMS
├── streaming-store.ts       # Module-level Map + listener Set + AbortController map; selectors (isStreamingForTeam, hasUnseenCompletionForTeam, findSlicesWhere)
├── streaming-actions.ts     # startStream (SSE loop + cap defense), cancelStream, markConversationViewed, markFinalMessageConsumed, clearAllStreams
├── streaming-hooks.ts       # All useSyncExternalStore-backed hooks (per-conversation + workspace-aggregate)
└── index.ts                 # Public API barrel — only this is imported by consumers

lib/hooks/
├── use-chat.ts              # Composer (≈128 LOC)
├── use-conversation-messages.ts   # Message-list role
└── use-chat-streaming.ts    # Streaming subscription + delegates role
```

---

## API Routes

### Core Data

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| POST | `/api/ai/extract-signals` | Extract signals from raw notes via AI model. Body: `{ rawNotes }`. Returns `{ structuredNotes }`. | Yes |
| POST | `/api/ai/generate-master-signal` | Generate/regenerate master signal. Team: admin only (403 for sales). | Yes |
| GET | `/api/master-signal` | Fetch current master signal + staleness count. Workspace-scoped. | Yes |
| POST | `/api/files/parse` | Stateless file parse. Body: `multipart/form-data` with `file`. Returns `{ parsed_content, file_name, file_type, file_size, source_format }`. | Yes |
| GET | `/api/clients?q=&hasSession=` | Search clients. Workspace-scoped. | Yes (RLS) |
| POST | `/api/clients` | Create client. Workspace-scoped. | Yes (RLS) |
| GET | `/api/sessions?clientId=&dateFrom=&dateTo=&offset=&limit=` | List sessions. Workspace-scoped. Includes `created_by_email` for team context. | Yes (RLS) |
| POST | `/api/sessions` | Create session. Workspace-scoped. | Yes (RLS) |
| PUT | `/api/sessions/[id]` | Update session. Team: admin can edit any, sales own only. | Yes (RLS) |
| DELETE | `/api/sessions/[id]` | Soft-delete session. Team: admin can delete any, sales own only. | Yes (RLS) |
| GET | `/api/sessions/[id]/attachments` | List attachments for a session. | Yes (RLS) |
| POST | `/api/sessions/[id]/attachments` | Upload single attachment (multipart). Validates file size/type/count. | Yes (RLS) |
| DELETE | `/api/sessions/[id]/attachments/[attachmentId]` | Soft-delete attachment + hard-delete from Storage. | Yes |
| GET | `/api/sessions/[id]/attachments/[attachmentId]/download` | Signed download URL for attachment. | Yes |
| GET | `/api/prompts?key=` | Fetch active prompt + history. Workspace-scoped. | Yes (RLS) |
| POST | `/api/prompts` | Save new prompt version. Team: admin only. | Yes (RLS) |

### Teams

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/teams` | List user's teams with roles. | Yes |
| POST | `/api/teams` | Create team. Requires `can_create_team = true`. | Yes |
| GET | `/api/teams/[teamId]` | Get team details. Members only. | Yes |
| PATCH | `/api/teams/[teamId]` | Rename team. Owner only. Body: `{ name }`. | Yes |
| DELETE | `/api/teams/[teamId]` | Soft-delete team. Owner only. | Yes |
| POST | `/api/teams/[teamId]/leave` | Current user leaves team. Owner auto-transfers or blocked. | Yes |
| POST | `/api/teams/[teamId]/transfer` | Transfer ownership. Owner only. Body: `{ newOwnerId }`. | Yes |
| GET | `/api/teams/[teamId]/members` | List team members with profiles. | Yes |
| DELETE | `/api/teams/[teamId]/members/[userId]` | Remove member. Owner: any. Admin: sales only. | Yes |
| PATCH | `/api/teams/[teamId]/members/[userId]/role` | Change role. Owner only. Body: `{ role }`. | Yes |
| GET | `/api/teams/[teamId]/invitations` | List pending invitations. Admin+ only. | Yes |
| POST | `/api/teams/[teamId]/invitations` | Send invitations. Admin+ only. Body: `{ emails, role }`. | Yes |
| DELETE | `/api/teams/[teamId]/invitations/[invitationId]` | Revoke invitation. Admin+ only. | Yes |
| POST | `/api/teams/[teamId]/invitations/[invitationId]/resend` | Resend invitation email. Admin+ only. | Yes |
| POST | `/api/invite/[token]/accept` | Accept invitation. Creates team_members entry. | Yes |

### Chat

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/chat/conversations?cursor=&search=&archived=` | List user's conversations (active or archived) with cursor-based pagination and optional search. User-private. | Yes (RLS) |
| PATCH | `/api/chat/conversations/[id]` | Update conversation — rename, pin/unpin, archive/unarchive. | Yes (RLS) |
| DELETE | `/api/chat/conversations/[id]` | Soft-delete conversation. | Yes (RLS) |
| GET | `/api/chat/conversations/[id]/messages?cursor=` | List messages for a conversation (cursor-based, newest-first). | Yes (RLS) |
| POST | `/api/chat/send` | Streaming chat endpoint. Validates input, resolves/creates conversation, delegates to `chat-stream-service`, returns SSE response with `X-Conversation-Id` header. `teamId` is always read from the `active_team_id` cookie — never from the request body. | Yes |

### Dashboard

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/dashboard?action=...&dateFrom=&dateTo=&clients=&severity=&urgency=&granularity=&confidenceMin=&drillDown=&sessionId=` | Dashboard query endpoint. Zod-validated `action` (13 values: sentiment/urgency/sessions-over-time/client-health/competitive-mention/client-list, top-themes/theme-trends/theme-client-matrix, drill-down, session-detail, insights-latest, insights-history) and filter params. Delegates to `executeQuery()` via RLS-protected anon client. | Yes (RLS) |
| POST | `/api/dashboard/insights` | Generate a new headline-insights batch via service-role client and `generateHeadlineInsights()`. Returns the new batch. | Yes |

### Notifications

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/notifications?cursor=&cursorId=&limit=&includeRead=&windowDays=` | Paginated bell listing. Cross-workspace by default (no team filter; RLS scopes the row set across every team the user belongs to). Returns `{ rows: BellNotificationRow[], nextCursor }` where each row carries `teamName` joined from `teams`. Cursor pair (`cursor` = ISO `created_at`, `cursorId` = UUID) must be supplied together. (PRD-029 Part 2) | Yes (RLS) |
| GET | `/api/notifications/unread-count` | Unread-count badge for the bell. Returns `{ count }`. Cross-workspace. (PRD-029 Part 2) | Yes (RLS) |
| POST | `/api/notifications/[id]/read` | Mark a single notification read. Idempotent — RLS-denied rows are silent no-ops (no info leak about other users' rows). Returns `{ ok: true }`. (PRD-029 Part 2) | Yes (RLS) |
| POST | `/api/notifications/mark-all-read` | Bulk mark-read. Optional body `{ teamId? }`; default (empty body) clears unread across every workspace the user belongs to. Returns `{ ok: true }`. (PRD-029 Part 2) | Yes (RLS) |
| GET | `/api/themes/candidates?limit=&offset=` | Admin-gated. Returns `{ candidates: ThemeCandidateWithThemes[], hasMore, lastRefreshedAt }` ordered by `combined_score`. Zod-validated `limit` (clamped 1..100) and `offset` (≥0). Personal workspace allowed (owner is implicit admin); team workspace requires `member.role === "admin"`. (PRD-026 Part 2) | Yes (admin) |
| POST | `/api/themes/candidates/refresh` | Admin-gated on-demand refresh — runs `refreshCandidates()` (delete-then-bulk-insert with new `refresh_batch_id`). Returns `RefreshResult`. (PRD-026 Part 2) | Yes (admin) |
| POST | `/api/themes/candidates/[id]/dismiss` | Admin-gated dismiss — records `theme_merge_dismissals` row + deletes the candidate row. Returns 204. `CandidateNotFoundError` → 404, `CandidateAccessError` → 403. (PRD-026 Part 2) | Yes (admin) |
| POST | `/api/themes/candidates/[id]/merge` | Admin-gated merge confirmation. Body `{ canonicalThemeId: UUID }` (must be one of the candidate's two ids). Atomic via `merge_themes` RPC: re-points `signal_themes`, archives + sets `merged_into_theme_id`, cleans up stale candidates/dismissals, writes `theme_merges` row. Returns `MergeResult`. Errors: 400 (invalid canonical), 404 (candidate or theme not found), 409 (validation conflict — already archived / cross-workspace / same theme), 500 (DB error). (PRD-026 Part 3) | Yes (admin) |
| GET | `/api/themes/merges?limit=&offset=` | Admin-gated recent-merges audit list. Zod-validated `limit` (1..100, default 10) and `offset` (≥0). Returns `{ items: ThemeMerge[], hasMore }` ordered by `merged_at DESC`. (PRD-026 Part 3) | Yes (admin) |

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Client + Server | Supabase publishable key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase service role key (bypasses RLS) |
| `AI_PROVIDER` | Server only | AI provider (`anthropic`, `openai`, `google`) |
| `AI_MODEL` | Server only | Provider-specific model identifier |
| `ANTHROPIC_API_KEY` | Server only | Anthropic API key (required when `AI_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | Server only | OpenAI API key (required when `AI_PROVIDER=openai`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Server only | Google AI API key (required when `AI_PROVIDER=google`) |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Application base URL |
| `EMAIL_PROVIDER` | Server only | Email provider (`resend`, `brevo`) |
| `RESEND_API_KEY` | Server only | Resend API key (required when `EMAIL_PROVIDER=resend`) |
| `BREVO_API_KEY` | Server only | Brevo API key (required when `EMAIL_PROVIDER=brevo`) |
| `EMAIL_FROM` | Server only | Sender email address for outbound emails |
| `EMBEDDING_PROVIDER` | Server only | Embedding provider (`openai`) |
| `EMBEDDING_MODEL` | Server only | Provider-specific embedding model identifier (e.g., `text-embedding-3-small`) |
| `EMBEDDING_DIMENSIONS` | Server only | Vector dimension — must match `session_embeddings.embedding` column (e.g., `1536`) |

See `.env.example` for the full template.

---

## Key Design Decisions

1. **Standalone app.** Separate deployment, separate auth, separate database. No shared components.
2. **Supabase for auth and database.** Provides Google OAuth, PostgreSQL, RLS, and auto-generated types out of the box. Reduces infrastructure overhead.
3. **Server-side AI calls only, provider-agnostic.** API keys never touch the browser. All AI operations go through Next.js API routes. The AI service exposes two public generics — `callModelText()` and `callModelObject<T>()` — that wrap provider resolution, retry logic, and error classification. All non-streaming LLM calls (extraction, synthesis, title generation, theme assignment) use these generics. Streaming chat uses `streamText()` directly. Supports multiple providers (Anthropic, OpenAI, Google) via `AI_PROVIDER` and `AI_MODEL` env vars.
4. **AI-driven theme assignment at extraction time.** Signal chunks are automatically classified into topic-based themes during extraction via a chained fire-and-forget LLM call (PRD-021). The LLM strongly prefers existing themes over creating new ones; the database enforces uniqueness via case-insensitive partial indexes. Each chunk can have multiple themes (primary + secondary) with confidence scores. Manual theme management is deferred to backlog.
5. **Clients as a first-class entity.** Separate `clients` table (not derived from unique session values) to support future enrichment and enterprise features.
6. **Architecture follows code, not the other way around.** This document is updated after implementation, never speculatively. If it's in this file, it exists in the codebase.
7. **AI prompts are DB-first with hardcoded fallback.** Active prompts are read from `prompt_versions` at runtime. If the DB is unreachable, the AI service falls back to the hardcoded constants in `lib/prompts/`.
8. **Team workspaces with personal fallback.** Users operate in either a personal workspace (no team) or a team workspace. The `active_team_id` cookie determines context. All data tables have a nullable `team_id` column — NULL means personal workspace. Data services read the active team ID and scope queries accordingly.
9. **Role-based access within teams.** Three roles: owner (one per team, full control), admin (manage members and content), sales (capture sessions, view data). Owner is a database concept (`teams.owner_id`), not a role value — the owner always has `role = 'admin'` in `team_members`.
10. **Team creation is a paid feature.** The `can_create_team` flag on `profiles` gates team creation. Developers enable this per user. No self-service payment gateway. **Beta override (current):** the column default is set to `true` and all existing profiles are backfilled so every user can create teams during beta testing. The gating machinery in `POST /api/teams` and `workspace-switcher.tsx` is intact — reverting is a single migration (`ALTER COLUMN ... SET DEFAULT false` + selective backfill) with no code change.
11. **Data retention on member departure.** When a member is removed or leaves, their sessions and other data remain in the team (owned by `team_id`). The `team_members.removed_at` timestamp records the departure. Re-inviting a departed member restores full access.
12. **Provider-agnostic email service.** Email sending is abstracted via `email-service.ts` with `resolveEmailProvider()` — supports Resend and Brevo, extensible to SMTP and others via `EMAIL_PROVIDER` env var.
13. **Dependency Inversion via repository pattern.** All 8 data-access services accept injected repository interfaces instead of importing Supabase directly. Repository interfaces live in `lib/repositories/`, Supabase adapters in `lib/repositories/supabase/`, and an in-memory mock in `lib/repositories/mock/`. Route handlers create Supabase clients, instantiate repositories via factory functions (`createSessionRepository`, etc.), and pass them to services. Services have zero coupling to Supabase — the `lib/services/` directory contains no `@/lib/supabase/server` imports. Workspace scoping (`team_id` filtering) is centralised in a shared `scopeByTeam()` helper within the adapter layer.
14. **Chat data isolation: anon client for reads, service-role for embeddings.** The RAG chat system uses two Supabase clients: the RLS-protected anon client for all data reads (via the `queryDatabase` tool), ensuring row-level security enforces both team scoping and personal workspace isolation (`created_by = auth.uid()`); and the service-role client only for the embedding repository (similarity search RPC). The embedding RPC adds explicit `filter_user_id` scoping for personal workspace queries. `teamId` is always resolved server-side from the `active_team_id` cookie — never accepted from the client request body. The chat tool's action enum and LLM-facing description are derived from the `ACTION_METADATA` registry in `lib/services/database-query/action-metadata.ts` — the single source of truth for which `QueryAction` values the LLM may invoke and what each does. Adding a new entry to `QueryAction` produces a TypeScript error in the registry until classified, structurally preventing drift between the chat tool's exposed surface and the service's actual capabilities. The chat tool's filter input mirrors the dashboard's filter dimensions (`severity`, `urgency`, `granularity`, `clientIds`, `confidenceMin`); `severity` is a per-chunk field in `structured_json` (painPoints/requirements/aspirations/blockers/custom.signals) and is honored via post-filter on session rows or via pre-resolved session-ID constraints on theme joins. (Gap E4)
**Identifier ownership for chat (Gaps E14 + E15 + P9).** Client owns the conversation UUID and the user message UUID end-to-end. `useChat.sendMessage` generates `userMessageId` via `crypto.randomUUID()` before the optimistic render and, when there's no active conversation, also generates the conversation UUID inline at the moment of first send (gap P9 — UUID materialises with the conversation, not at component mount). Both UUIDs are sent in the POST body. The server idempotently creates the conversations row on first POST (`getOrCreateConversation`) and inserts the user message with the explicit primary key. Server owns the assistant message UUID and surfaces it via the `X-Assistant-Message-Id` response header at fetch-response time, so the client has it during streaming (used by the cancel path to attach a real ID to cancelled bubbles instead of a temp ID). The `X-Conversation-Id` header is informational — the client already knows the id it just generated. Stream finalization paths (success / error / abort) all update the same placeholder row with `status` + accumulated partial content — abort flips to `cancelled`, error flips to `failed`, both preserve `fullText`. `request.signal` is propagated through to `streamText({ abortSignal })` so client cancels also cancel the upstream provider call. Duplicate inserts on idempotent retries: messages → 409 via `MessageDuplicateError`; conversations → reuse the existing row via `getOrCreateConversation`'s unique-violation fallback (cross-user UUID collisions surface as `ConversationNotAccessibleError` → 404 because RLS hides the row).

**Conversation routing (Gap P9).** The chat is a single persistent client component (`ChatPageContent`); in-app navigation never traverses Next.js's page boundary, so the shell never remounts. `activeConversationId: string | null` — `null` means fresh chat (URL `/chat`, no DB row, no messages). The two route files (`app/chat/page.tsx` and `app/chat/[id]/page.tsx`) exist solely to seed `initialConversationId` on first arrival, hard refresh, deep-link, or share — they do not participate in subsequent navigation. All in-session URL changes use raw `window.history` API: `pushState` for sidebar clicks, "New chat", and the silent first-send URL update fired from `useChat.onConversationCreated` after `X-Conversation-Id` arrives. `pushState` (not `replaceState`) preserves the natural browser history chain — back from `/chat/<id>` returns to `/chat` (empty fresh chat) before exiting the chat surface. Browser back/forward sync via a `popstate` listener that atomically calls `clearMessages()` + `setActiveConversationId(parsed)` in the same handler so React batches both state updates into one render commit (no flash of stale messages). Sidebar items are `<div role="button" onClick={onSelect}>` (NOT `<Link>`/router.push) — the row contains a `<DropdownMenuTrigger>` which is itself a real `<button>`, so nesting a button is invalid HTML; the WAI-ARIA "button role on non-button element" pattern is used with full keyboard-activation handling. Cross-user / non-existent UUIDs at `/chat/<id>` surface a "Conversation not found" panel (via `useChat.isConversationNotFound`, set when the messages-list fetch returns 404) with a "Start a new chat" CTA wired to the same `navigateToFreshChat` primitive the sidebar uses. The `useChat` load-messages effect uses a `prevConversationIdRef` + `messagesRef` discriminator to skip re-fetching on the `null → just-created` transition fired by `onConversationCreated` (messages already populated by the streaming flow). `ChatArea`'s empty-state branch is gated on `activeConversationId === null` (the raw id from the parent), NOT `activeConversation === null` (the looked-up sidebar entry) — during the conversations-list fetch window after a fresh mount of `app/chat/[id]/page.tsx` the lookup briefly returns null while the id is already set, and using the raw id prevents flashing the "Start a new conversation" starter panel during that window.
15. **Dashboard widgets are self-contained client components.** Each widget owns its own fetch lifecycle via the shared `useDashboardFetch` hook, reading global filter state from URL search params (bookmarkable/shareable). The `/api/dashboard` route validates action + filter params with Zod and delegates to `executeQuery()` using the anon Supabase client (RLS-protected). Chart colours and chunk-type labels are centralised in `chart-colours.ts` to avoid duplication. Recharts is the charting library for most widgets; the theme-client matrix uses an HTML grid for heatmap rendering (PRD-021 Parts 2–3). Theme query handlers share `fetchActiveThemeMap()` and `fetchSignalThemeRows()` to DRY the multi-table join chain (`signal_themes` → `session_embeddings` → `sessions`). The `confidenceMin` URL param filters theme assignments by confidence score (forward-compatible for Part 6 UI slider). Qualitative drill-down (PRD-021 Part 4) uses a two-layer architecture: `DrillDownContent` is a presentation-agnostic `<div>` owning data fetching, client accordion, and signal rows; `DrillDownPanel` is a thin `Sheet` shell (swappable to `Dialog` in one file change). All 7 clickable widgets pass a `DrillDownContext` discriminated union via `onDrillDown` callback to the coordinator (`dashboard-content.tsx`). The drill-down API action uses Zod validation on the JSON payload and dispatches to 7 internal query strategies (3 direct + 1 competitor + 3 theme), capping results at 100 signals. A separate `session_detail` action fetches a single session for the `SessionPreviewDialog`.
16. **AI-generated headline insights as a chained extraction side-effect.** Three to five classified insight cards (`trend`/`anomaly`/`milestone`) sit above the dashboard widget grid. Generation aggregates five dashboard queries in parallel via `executeQuery()`, fetches the previous batch for change-focused framing, and calls `callModelObject()` with `headlineInsightsResponseSchema`. Writes are batched (one `batch_id` per generation) to `dashboard_insights` via the service-role client. Two trigger paths: manual "Refresh Insights" button (`POST /api/dashboard/insights`) and the post-extraction fire-and-forget chain (`generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights`), which uses a staleness check (new-session count since last generation) to avoid regenerating on every save. Previous batches are lazy-loaded via `PreviousInsights`.
17. **Master Signal (retained backend, retired UI).** The master-signal page (`/m-signals`) has been removed from the navigation and deleted from the codebase, but the full backend remains wired: `master_signals` table, `master-signal-service.ts` (`generateOrUpdateMasterSignal`, cold-start vs incremental), `master-signal-repository.ts` (+ Supabase adapter), `master-signal-synthesis.ts` prompt, `GET /api/master-signal`, `POST /api/ai/generate-master-signal`, `is_tainted` taint propagation on session delete, and prompt variants under `prompt_versions.prompt_key` (`master_signal_cold_start`, `master_signal_incremental`). Rationale: the feature is deprecated in the UX direction (dashboards + chat replaced it), but the backend is retained as an optional re-entry point and to preserve historical data. Do not reference it in user-facing copy; do not delete it without a cleanup PRD that also migrates/archives the table.
18. **Filter persistence across surfaces.** Every filtered surface (dashboard, capture past-sessions, and any future equivalent) persists filter state via the shared `useFilterStorage` hook (`lib/hooks/use-filter-storage.ts`). Keys are `filters:<surface>:<userId>:<workspaceId ?? "personal">`. `userId` isolates users on shared tabs; `workspaceId` gives per-workspace memory. Browser tab close wipes sessionStorage; no explicit cleanup on signOut is required because stale keys from a prior user are inert (different `userId` segment). Workspace switches call `router.replace(pathname)` inside `setActiveTeam()` to strip URL query params — preventing workspace A's URL filters from applying to workspace B's data — after which each surface's mount/key-change effects hydrate from the new workspace's storage entry (URL-based surfaces re-populate the URL; state-based surfaces hydrate React state). URL remains the source of truth for rendering and sharing wherever it's used; storage is purely a rehydration layer. Dashboard (`filter-bar.tsx`) is URL-based; capture past-sessions (`past-sessions-table.tsx`) is React-state-based — the hook is intentionally a narrow primitive (`read`/`write`/`key`) so each surface wires its own sync policy.
19. **Post-response background chain via `after()` + `maxDuration = 60`.** The embeddings → themes → insights chain on session create (`POST /api/sessions`) and re-extract (`PUT /api/sessions/[id]`) lives in `runSessionPostResponseChain` (`lib/services/session-orchestrator.ts`) — owns sessionMeta construction, chunk selection, chain-repo creation, the three stage calls, per-stage timing logs, and the unconditional error log. Routes register it inside `after()` from `next/server` so Vercel keeps the function instance alive past the JSON response until the chain resolves; `export const maxDuration = 60` (declared in each route file because Next.js requires the literal there) raises the Hobby-tier hard ceiling from the 10s default. The user-perceived latency is unchanged (response is sent immediately after the DB insert). Per-stage timing logs (`chain timing — embeddings/themes/insights`) and the unconditional error log (with sessionId + elapsedMs + stack) are emitted on every run; the route's existing log prefix (`[POST /api/sessions]` or `[PUT /api/sessions/[id]]`) is passed as `logPrefix` so production grep patterns and dashboards continue to match (PRD-023 P3.R2). **Migration trigger:** when p95 chain duration approaches the 60s ceiling — or any stage's failure rate becomes non-trivial — move the chain off the request lifecycle entirely (queue worker: Inngest, QStash, or Supabase queues) for retries, replay, and unbounded execution time. The orchestrator's input contract (`SessionPostResponseChainInput`) is the migration boundary: a queue-job handler would re-create `serviceClient` from job context and call `runSessionPostResponseChain` unchanged. Until then, `after()` + `maxDuration` is the deliberate floor; the timing logs are the signal that determines when to escalate. See `gap-analysis.md` E2 and the corresponding TRD section.

20. **Route-handler auth layer (PRD-023 Part 2).** Auth + team/session role checks + canonical responses live in `lib/api/`. `requireAuth()` returns `AuthContext` (user + supabase + serviceClient) or a 401 NextResponse. `requireTeamMember/Admin/Owner(teamId, user, forbiddenMessage?)` extends it with `team`, `member`, `teamRepo` and enforces role hierarchy: member = membership exists; admin = `member.role === "admin"`; owner = `team.owner_id === user.id`. Owner is orthogonal to `team_members.role` (always also `admin` per `team-repository.create()`), so admin-level routes transparently allow owners. `requireSessionAccess(sessionId, user)` wraps the framework-agnostic `checkSessionAccess` from `session-service.ts` and translates the result via `lib/utils/map-access-error.ts`. Helpers return `T | NextResponse`; callers short-circuit via `if (result instanceof NextResponse) return result`. Helpers don't log — routes preserve their own entry/exit/error logs and helper logs would duplicate them. `idempotentNoOp(message)` (in `lib/api/idempotent-no-op.ts`) is the canonical 409 for "no-op: state already matches" (used by the role-update route's "already has role X" branch). `validateFileUpload(file)` (in `lib/api/file-validation.ts`) enforces per-file size + MIME constraints shared by `/api/sessions/[id]/attachments` POST and `/api/files/parse` POST; per-session caps (`MAX_ATTACHMENTS`) stay in routes as a collection-level concern. `canUserCreateTeam(profileRepo, userId)` in `team-service.ts` replaces the inline `profiles.can_create_team` query and returns a discriminated union (`{ allowed: true } | { allowed: false; reason: "profile_not_found" | "feature_disabled" }`); routes own HTTP framing. Server-side `getActiveTeamId()` lives in `lib/cookies/active-team-server.ts` (paired with the existing client-side `lib/cookies/active-team.ts`); `lib/supabase/server.ts` is now exclusively Supabase client factories.

22. **Two-layer theme deduplication at extraction time (PRD-026 Part 1).** Theme reuse used to be `ilike` name match only — semantic synonyms ("API Speed" vs "API Performance") slipped through as fresh rows. Part 1 adds two complementary defenses. **Layer 1 — prompt bias:** the theme-assignment system prompt (Rule 9 in `lib/prompts/theme-assignment.ts`) instructs the LLM to prefer umbrella names that fit closely-related future signals over names describing only the current signal, with worked examples in both directions and an explicit warning against collapsing distinct concerns. Cheap; catches the cold-start case where no existing themes are around. **Layer 2 — embedding guard:** every theme carries a `vector(1536)` embedding (HNSW indexed) of its name+description. During `assignSessionThemes`, a single batched embedding call resolves all proposed-new names against existing themes via in-memory cosine similarity (`runThemePrevention` in `lib/services/theme-prevention.ts`); proposals at or above `THEME_PREVENTION_SIMILARITY_THRESHOLD` (default `0.92`, env-tunable) collapse onto the matched theme; below threshold, the proposal becomes a new row carrying its precomputed embedding. The guard skips the case-insensitive exact-name fast path (P1.R6) — anything cached short-circuits before any embedding work. `buildThemeEmbeddingText` is the single source of truth for the name+description composition shared with the backfill script. The conservative threshold biases toward false-negatives (let some duplicates through) over false-positives (collapse distinct topics) per P1.R3; residual duplicates that slip through are absorbed by Parts 2–3 (admin-curated merge candidates, admin-confirmed merge). The guard's decisions are logged per-pair under `[theme-prevention] decision` so the threshold can be retuned from production telemetry without a deploy. Forward-compat: `themes.merged_into_theme_id` (FK, nullable) is reserved for Part 3's merge transaction; the HNSW index is reused by Part 2's candidate generation.

23. **Admin-curated merge-candidate surface (PRD-026 Part 2).** Builds on Part 1's prevention layer to absorb the residual duplicates that slipped past — and the duplicates that pre-dated prevention. Three architectural calls drive the design. **Persisted, not page-load-computed:** `theme_merge_candidates` stores the ranked candidate set so visits are O(1) reads against an indexed table, not O(N²) cosine math; `refreshCandidates()` rewrites the set transactionally (delete-then-bulk-insert under one `refresh_batch_id`). **Composite scoring by impact, not similarity alone:** `combined_score = 0.5·similarity + 0.3·volume + 0.2·recency`, with `volume_score` log-scaled around `MAX_VOLUME_NORM=200` and `recency_score` exponential-decay with a 30-day half-life — so a heavy-volume "merely good" pair sits above a trivial-volume "almost identical" pair (the PRD's intent). Threshold for inclusion (`THEME_CANDIDATE_SIMILARITY_THRESHOLD`, default `0.80`) is deliberately *lower* than Part 1's prevention threshold (`0.92`) — the surface is human-reviewed, so a wider net is safe. **Dismissals survive theme renames:** `theme_merge_dismissals` keys on `(theme_a_id, theme_b_id)` (FK cascade is the only invalidator), so the admin's "not a duplicate" judgment reflects domain identity, not surface labels. The transactional replace inside `refreshCandidates` runs the dismissal filter *before* the bulk insert, so the persisted set is always exactly what the admin should see — page reads stay simple. **Stale-on-mount auto-refresh, not Vercel cron** (Decision 20 revision): the page client checks `lastRefreshedAt` against `STALE_THRESHOLD_HOURS=24` on mount and silently triggers a refresh when stale. First admin visit per workspace per day pays the recompute cost; subsequent visits within the window read the snapshot directly. A real cron remains a backlog item if telemetry shows admin-perceived staleness becomes an issue. **Three-layer admin gating:** sidebar nav (via `useIsWorkspaceAdmin()` — hidden until role resolves), page server-component (renders an "admin-only" fallback panel when reached directly by non-admins), and API layer (`requireWorkspaceAdmin` on every endpoint). RLS on the new tables is intentionally read-only for workspace members; all writes go through the service-role client inside the service so the dismissal filter and the transactional replace cannot be bypassed. Part 3's "Merge…" button is wired as a disabled placeholder on the candidate row — the persisted candidate row already carries every field Part 3's confirmation dialog will display (similarity, signal counts, distinct sessions/clients).

24. **Atomic theme merge via PL/pgSQL function, not multi-statement client transactions (PRD-026 Part 3).** P3.R5 ("no observable intermediate state") rules out a multi-statement client-side transaction — Supabase JS doesn't expose `BEGIN; ... COMMIT;` cleanly, and round-trip overhead alone makes the multi-step approach slower than a single function call. Same security model as `match_session_embeddings` and `find_theme_candidate_pairs`: `SECURITY DEFINER`, service-role-only callers. Three architectural calls inside the function. **Conflict-aware re-point of `signal_themes`:** the `(embedding_id, theme_id)` unique index would fire if a single signal already had assignments to both sides of the merge (rare but real — same signal under two near-duplicate themes from different sessions). The function first DELETEs the duplicate side, then UPDATEs the remaining archived rows; `reassigned_count` reports the post-dedup total so the success toast matches reality. **Workspace-scoped concurrency lock:** both theme rows are locked `FOR UPDATE` up-front, so a second concurrent merge of an overlapping pair blocks until the first commits and then re-reads `is_archived = true` (failing with the right validation error). **Cleanup of stale candidates + dismissals lives inside the merge transaction** — any candidate row referencing the archived theme is meaningless after the merge, and surfacing it would 404 in the UI. Doing the cleanup atomically with the merge means the candidates list is consistent the moment the response returns. The audit log (`theme_merges`) snapshots theme names and stats; **no FK on `archived_theme_id` / `canonical_theme_id`** so the audit row survives any future hard-delete of the underlying theme. `MergeResult` (the service's return shape) is a strict superset of `themeMergedPayloadSchema` from `lib/notifications/events.ts` minus `actorName` — Part 4 will resolve the actor name and call `notificationService.emit({ eventType: "theme.merged", payload: { ...result, actorId, actorName }, teamId, broadcast: true })` as a single fire-and-forget call in the merge service's success path (no service-shape change). The service deliberately does not emit notifications in Part 3 (separation of concerns: Part 3 is "do the merge"; Part 4 is "tell the workspace"). The "Merge…" button on the candidate row, the modal dialog with canonical-flip toggle, the blast-radius preview from candidate-row snapshot stats (no extra round trip — TRD Decision 27), the P3.R2 chat-history disclaimer, and the recent-merges audit section all live on the same `/settings/themes` page so the action and its audit trail are one click apart.

25. **Streaming context as a module-level singleton (PRD-024).** The chat-streaming subsystem lives at module scope in `lib/streaming/` — not React Context, not Redux, not Zustand. Three reasons: **(a) Cross-page survival.** State persists across React tree changes (e.g., navigating from `/chat` to `/dashboard`). Module-level data lives as long as the JS bundle is loaded; navigation cannot tear it down. No state-persistence layer required. **(b) Selective re-rendering.** Plain `React.createContext` broadcasts to every consumer on every change — defeating per-conversation subscribers in the sidebar with many entries. `useSyncExternalStore` over a custom `Map<conversationId, slice>` + listener `Set` gives selector-based subscriptions with primitive snapshots; subscribers to conversation A bail out of re-renders on deltas in conversation B. **(c) No external state library.** CLAUDE.md mandates "React hooks only." The custom store is ~140 LOC in `streaming-store.ts`; `useSyncExternalStore` is React 18 native — same primitive Zustand and Jotai use internally, scoped to one feature without an extra dependency. Per-conversation slices keyed by `conversationId` and scoped by `teamId` make multi-stream concurrency a structural property — cancelling stream A does not affect stream B because each has its own slice + AbortController. The pre-PRD UI-bleed bug (streaming bubble rendering against the wrong conversation) is structurally impossible: the chat-area reads its own conversation's slice, and switching conversations switches which slice is read. The concurrency cap is **5 per workspace** (`MAX_CONCURRENT_STREAMS` in `streaming-types.ts`) — pinned high enough that real users never hit it, low enough to prevent abuse and keep resource usage reasonable. Enforced at the UI layer (`chat-area.tsx` + `chat-input.tsx` + `starter-questions.tsx`) AND defensively in `startStream` itself. The `useChat` hook is decomposed into a thin composer (~128 LOC) wiring two focused sub-hooks: `useConversationMessages` (message-list role, including the Gap P9 skip-refetch guard) and `useChatStreaming` (slice subscription + delegates + the `useLayoutEffect` fold for P2.R7's no-flicker bubble→message swap). The composition seam is `setMessages` + `messages` threaded between sub-hooks; three writers (optimistic add, retry trim, fold append) all converge on one setter. See the dedicated `## Streaming Context (PRD-024)` section above for the full architecture narrative.
