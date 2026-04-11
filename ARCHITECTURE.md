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

**Status:** PRD-002 through PRD-010 implemented. PRD-012 Parts 1–5 (Design Tokens and Typography + DRY Extraction + SRP Component Decomposition + API Route/Service Cleanup + Dependency Inversion) implemented. PRD-013 Parts 1–2 (File Upload Infrastructure + Persistence & Signal Extraction Integration) implemented. PRD-014 Parts 1–4 (Session Traceability & Staleness Data Model + View Prompt on Capture Page + Show Prompt Version in Past Sessions + Staleness Indicators & Re-extraction Warnings) implemented. PRD-015 Part 1 (Public Landing Page) implemented. PRD-019 Parts 1–4 (pgvector Setup & Embeddings Table + Chunking Logic + Embedding Pipeline + Retrieval Service) implemented. PRD-020 Parts 1–3 (Sidebar Navigation + Chat Data Model and Streaming Infrastructure + Chat UI Components) implemented. PRD-021 Parts 1–2 (Theme Assignment at Extraction Time + Dashboard Layout, Navigation, and Direct Widgets) implemented. The app is a fully functional team-capable client feedback capture and synthesis platform with a public landing page, vector search infrastructure, Instagram-style hover-to-expand sidebar navigation, complete RAG chat interface (conversations sidebar, message thread with virtualized scrolling, streaming with markdown, citations, follow-ups, in-conversation search, archive read-only mode), and full server-side RAG chat infrastructure (conversations, messages, tool-augmented streaming, LLM title generation). Google OAuth login (open to any Google account), working capture form with AI signal extraction and file attachment upload with server-side persistence, past sessions table with filters/inline editing/soft delete, master signal page with AI synthesis and PDF download, prompt editor with version history, team access with role-based permissions, automatic embedding generation on session save/extraction, and semantic retrieval service with adaptive query classification for downstream RAG and insights features.

**Core features live:**
- Public landing page at `/` with hero, feature cards, how-it-works flow, and CTA (authenticated users auto-redirect to `/capture`)
- Session capture with AI signal extraction (Vercel AI SDK, multi-provider) and file attachment upload (TXT, PDF, CSV, DOCX, JSON) with server-side parsing and chat format detection (WhatsApp, Slack)
- Master signal synthesis (cold start + incremental, tainted flag on deletion)
- Per-user prompt editor with version history and revert
- Team workspaces with role-based access (owner, admin, sales)
- Email invitations via provider-agnostic email service (Resend)
- Workspace switcher (personal ↔ team contexts)
- Team-scoped sessions, clients, master signals, and prompts
- Team management (members, roles, ownership transfer, rename, delete)
- Data retention on member departure
- RAG chat interface at `/chat` — conversation sidebar (search, pin, archive, rename, delete), virtualized message thread, markdown rendering with citations, follow-up suggestions, in-conversation search with match navigation, starter questions, archive read-only with unarchive
- AI-powered theme assignment — automatic topic-based classification of signal chunks during extraction, chained after embedding generation (fire-and-forget), workspace-scoped themes with many-to-many signal-theme junction, primary/secondary themes with confidence scores
- AI-powered insights dashboard at `/dashboard` — sentiment distribution (donut chart), urgency distribution (bar chart), session volume over time (area chart with week/month toggle), client health grid (scatter plot), competitive mentions (horizontal bar chart); global filter bar (client multi-select, date range, severity, urgency) with URL-encoded state; all widgets consume a shared `queryDatabase` service layer via `/api/dashboard` route

**Database tables:** `clients`, `sessions`, `session_attachments`, `session_embeddings`, `themes`, `signal_themes`, `master_signals`, `profiles`, `prompt_versions`, `teams`, `team_members`, `team_invitations`, `conversations`, `messages` — all with RLS. **RPC functions:** `match_session_embeddings` (vector similarity search), `sessions_over_time` (time-bucketed session counts by week/month for dashboard).

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
│   ├── page.tsx                 # Landing page (public) — authenticated users redirect to /capture
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
│   │   │       ├── route.ts     # PUT/DELETE — update/soft-delete session (checkSessionAccess via session-service)
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
│   │       └── route.ts         # GET — dashboard query route: Zod-validated action + filter params, delegates to executeQuery() via anon client (RLS-protected)
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts         # OAuth callback — code exchange, pending invite auto-accept
│   ├── chat/
│   │   ├── page.tsx             # Chat tab — server component with metadata, renders ChatPageContent
│   │   └── _components/
│   │       ├── chat-area.tsx               # Main chat area — composes header, search bar, message thread, input, error banner; manages in-conversation search state
│   │       ├── chat-header.tsx             # Conversation title bar — sidebar toggle, mobile menu, search toggle
│   │       ├── chat-input.tsx              # Auto-expanding textarea (1–6 rows) with send/stop buttons, Enter/Shift+Enter, archived unarchive bar
│   │       ├── chat-page-content.tsx       # Client coordinator — wires useConversations + useChat, manages active conversation, sidebar state
│   │       ├── chat-search-bar.tsx         # In-conversation search — input, match count, prev/next navigation, keyboard shortcuts
│   │       ├── citation-chips.tsx          # Pill-shaped citation chips with client name · date, opens CitationPreviewDialog
│   │       ├── citation-preview-dialog.tsx # Dialog showing source chunk text, metadata, "View full session" link
│   │       ├── conversation-context-menu.tsx # Right-click context menu — rename, pin, archive/unarchive, delete
│   │       ├── conversation-item.tsx       # Single conversation row — title, date, pin/archive badges, context menu
│   │       ├── conversation-sidebar.tsx    # Collapsible sidebar — search, active/archived lists, new chat button, desktop panel + mobile Sheet
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
│   │       ├── chart-colours.ts            # Shared chart colour constants for Recharts widgets (sentiment, urgency hex maps)
│   │       ├── client-health-widget.tsx    # Client health grid — ScatterChart positioning clients by sentiment × urgency, custom tooltip
│   │       ├── competitive-mentions-widget.tsx # Competitive mentions — horizontal BarChart sorted by frequency
│   │       ├── dashboard-card.tsx          # Shared widget card — title, loading skeleton, error/retry, empty state, content slot
│   │       ├── dashboard-content.tsx       # Client coordinator — FilterBar + responsive widget grid (Suspense boundary)
│   │       ├── filter-bar.tsx             # Global filter bar — client multi-select (Popover+Command), date range, severity, urgency dropdowns, URL search params
│   │       ├── sentiment-widget.tsx        # Sentiment distribution — PieChart (donut) with clickable segments
│   │       ├── session-volume-widget.tsx   # Session volume over time — AreaChart with local week/month granularity toggle
│   │       ├── urgency-widget.tsx          # Urgency distribution — BarChart with colour-coded bars
│   │       └── use-dashboard-fetch.ts     # Shared fetch hook — action + filter params from URL, loading/error/data lifecycle, re-fetch on filter change
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
│   │           └── invite-page-content.tsx # Client component — validate token, accept/sign-in flow
│   ├── login/
│   │   └── page.tsx             # Login page with "Sign in with Google" button
│   ├── m-signals/
│   │   ├── page.tsx             # Master Signals tab — server component
│   │   └── _components/
│   │       ├── master-signal-content.tsx       # Rendered markdown content + metadata bar
│   │       ├── master-signal-empty-state.tsx   # Empty/loading/generating state displays
│   │       ├── master-signal-page-content.tsx  # Coordinator — composes header, banners, empty states, content
│   │       ├── master-signal-pdf.ts            # Client-side PDF generation via pdf-lib
│   │       ├── master-signal-status-banner.tsx # Presentational banner for tainted/stale/info states
│   │       └── use-master-signal.ts           # Hook — fetch, generate, download PDF, all state + derived values
│   └── settings/
│       ├── page.tsx             # Settings page — renders SettingsPageContent
│       └── _components/
│           ├── invite-bulk-dialog.tsx          # Bulk invite dialog (CSV/paste, max 20 emails)
│           ├── invite-single-form.tsx          # Single email invite form
│           ├── pending-invitations-table.tsx   # Table of pending invitations with revoke/resend
│           ├── prompt-editor-page-content.tsx  # Coordinator — composes tabs, editor, notices, dialogs
│           ├── prompt-editor.tsx               # Monospace textarea with loading skeleton
│           ├── prompt-master-signal-notice.tsx # Contextual cold-start/incremental info box with toggle
│           ├── prompt-unsaved-dialog.tsx       # Unsaved changes confirmation dialog
│           ├── settings-page-content.tsx       # Orchestrator — tabs for Prompts + Team Settings
│           ├── use-prompt-editor.ts           # Hook — fetch, save, reset, revert, dirty guard, tab state
│           ├── team-danger-zone.tsx            # Rename + delete team (owner only)
│           ├── team-members-table.tsx          # Members list with role change, remove, transfer, leave
│           ├── team-settings.tsx               # Team settings orchestrator — members, invites, danger zone
│           ├── version-history-panel.tsx       # Collapsible version history with view/revert
│           └── version-view-dialog.tsx         # Read-only dialog for viewing past prompt versions
├── components/
│   ├── auth/
│   │   ├── auth-form-shell.tsx          # Shared centered auth card layout (title, subtitle, children)
│   │   └── email-confirmation-panel.tsx # Shared "Check your email" success panel (children, linkText, linkHref)
│   ├── capture/
│   │   ├── reextract-confirm-dialog.tsx # Shared re-extract confirmation dialog (show, hasManualEdits, onConfirm, onCancel)
│   │   └── structured-signal-view.tsx   # Renders ExtractedSignals JSON as typed UI — sections, severity/priority/sentiment badges, quotes (PRD-018 P2)
│   ├── providers/
│   │   └── auth-provider.tsx    # AuthProvider context — user, isAuthenticated, isLoading, canCreateTeam, activeTeamId, setActiveTeam, signOut
│   ├── settings/
│   │   ├── role-picker.tsx      # Controlled role picker (value, onValueChange) + exported Role type
│   │   └── table-shell.tsx      # Shared bordered table wrapper (TableShell) + standardised header cell (TableHeadCell)
│   ├── layout/
│   │   ├── app-footer.tsx       # Footer — public routes only (developer contact + theme toggle)
│   │   ├── app-sidebar.tsx      # Instagram-style hover-to-expand sidebar — icon-only at rest, overlay on hover, mobile drawer via Sheet; nav links (Dashboard, Capture, Chat, Settings), workspace switcher, more menu, user menu
│   │   ├── authenticated-layout.tsx # Auth-aware layout wrapper — sidebar + margin for authenticated routes, footer-only for public routes
│   │   ├── create-team-dialog.tsx # Controlled team creation dialog (opened from workspace switcher)
│   │   ├── synthesiser-logo.tsx # SVG logo component — full (wordmark) and icon-only variants
│   │   ├── theme-toggle.tsx     # Theme toggle button — Sun/Moon icon with label
│   │   ├── user-menu.tsx        # Auth-aware user menu — avatar, email, sign-out dropdown; supports side/collapsed/onOpenChange props for sidebar integration
│   │   └── workspace-switcher.tsx # Always-visible workspace dropdown — switch, create team, CTA; supports collapsed/onOpenChange props for sidebar integration
│   └── ui/                      # shadcn/ui primitives (do not modify) + shared dialogs
│       ├── badge.tsx
│       ├── confirm-dialog.tsx    # Reusable confirmation dialog (config-driven: title, description, destructive variant, loading state)
│       ├── button.tsx           # Includes `ai` variant (gold) for AI action buttons
│       ├── command.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── popover.tsx
│       ├── select.tsx
│       ├── sheet.tsx            # Slide-out drawer (left/right/top/bottom) built on Radix Dialog primitives
│       ├── sonner.tsx
│       ├── tabs.tsx
│       └── textarea.tsx
├── lib/
│   ├── constants.ts             # Shared constants (file upload limits, accepted types)
│   ├── constants/
│   │   └── file-icons.ts        # FILE_ICONS map (MIME type → lucide icon component)
│   ├── cookies/
│   │   └── active-team.ts       # Client-side active team cookie helpers (getActiveTeamId, setActiveTeamCookie, clearActiveTeamCookie)
│   ├── hooks/
│   │   ├── use-chat.ts          # Chat streaming hook — SSE parsing, AbortController cancellation, sendMessage/cancelStream/retryLastMessage/fetchMoreMessages (PRD-020 Part 2–3)
│   │   ├── use-conversations.ts # Conversation list management — dual active/archived lists, optimistic CRUD, cursor-based pagination, search (PRD-020 Part 2–3)
│   │   ├── use-signal-extraction.ts # Shared extraction state machine hook (ExtractionState, promptVersionId, getInput callback, re-extract confirm flow, forceConfirmOnReextract for server-side manual edit flag)
│   │   └── use-theme.ts         # Theme hook — reads/writes theme cookie, returns { theme, setTheme }
│   ├── types/
│   │   ├── chat.ts              # MessageRole, MessageStatus, ChatSource, Message, Conversation, ConversationListOptions — types for the chat system (PRD-020)
│   │   ├── embedding-chunk.ts   # ChunkType, EmbeddingChunk, SessionMeta — types for the vector search chunking/embedding pipeline (PRD-019)
│   │   ├── retrieval-result.ts  # QueryClassification, ClassificationResult, RetrievalOptions, RetrievalResult — types for the retrieval service (PRD-019)
│   │   ├── signal-session.ts    # SignalSession interface — shared between ai-service and master-signal-service
│   │   └── theme.ts             # Theme, SignalTheme, LLMThemeAssignment, ThemeAssignmentResult — types for the theme assignment system (PRD-021)
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
│   │   └── theme-assignment.ts    # Theme assignment system prompt, max tokens, and buildThemeAssignmentUserMessage() for generateObject() classification (PRD-021)
│   ├── schemas/
│   │   ├── extraction-schema.ts   # Zod schema for structured extraction output — signalChunkSchema, extractionSchema, type exports
│   │   └── theme-assignment-schema.ts # Zod schema for theme assignment LLM response — themeAssignmentResponseSchema, ThemeAssignmentResponse type (PRD-021)
│   ├── repositories/
│   │   ├── index.ts                    # Re-exports all repository interfaces and SessionNotFoundRepoError
│   │   ├── attachment-repository.ts    # AttachmentRepository interface
│   │   ├── client-repository.ts        # ClientRepository interface
│   │   ├── conversation-repository.ts  # ConversationRepository interface + ConversationInsert, ConversationUpdate types (PRD-020)
│   │   ├── embedding-repository.ts    # EmbeddingRepository interface + EmbeddingRow, SearchOptions, SimilarityResult types (PRD-019)
│   │   ├── invitation-repository.ts    # InvitationRepository interface
│   │   ├── theme-repository.ts        # ThemeRepository interface + ThemeInsert, ThemeUpdate types (PRD-021)
│   │   ├── signal-theme-repository.ts # SignalThemeRepository interface + SignalThemeInsert type (PRD-021)
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
│   │   ├── database-query-service.ts # Database query service — action map (10 actions: 7 chat + 3 dashboard) with parameterized Supabase queries, team-scoped; extended filters (clientIds, severity, urgency, granularity) for dashboard (PRD-020, PRD-021)
│   │   ├── embedding-service.ts # Provider-agnostic embedding service — embedTexts() with batching, retry, dimension validation (PRD-019)
│   │   ├── embedding-orchestrator.ts # Coordination layer — generateSessionEmbeddings() ties chunking → embedding → persistence, returns embedding IDs for downstream chaining, fire-and-forget (PRD-019, PRD-021)
│   │   ├── theme-service.ts     # Theme assignment orchestrator — assignSessionThemes() fetches themes, calls LLM, resolves/creates themes, bulk inserts assignments; chained after embedding generation (PRD-021)
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
│   │   └── team-service.ts      # Team CRUD + getTeamMembersWithProfiles(), getTeamsWithRolesForUser() — accepts TeamRepository
│   ├── utils/
│   │   ├── chat-helpers.ts        # Pure utilities — SSE encoding, follow-up parsing, source mapping and deduplication (PRD-020)
│   │   ├── compose-ai-input.ts    # Composes raw notes + attachments into a single AI input string
│   │   ├── format-file-size.ts    # File size formatting (bytes → "1.2 KB", "3.4 MB")
│   │   ├── format-relative-time.ts # Relative time formatting ("just now", "5m ago", "3d ago")
│   │   ├── map-access-error.ts    # mapAccessError() — maps session access denial reasons to HTTP responses
│   │   ├── map-ai-error.ts       # mapAIErrorToResponse() — shared AI error-to-HTTP mapper (5 error types + unexpected)
│   │   ├── render-extracted-signals-to-markdown.ts # Converts ExtractedSignals JSON to markdown (backward compat for structured_notes)
│   │   └── upload-attachments.ts  # Uploads pending attachments to a session (shared by capture form + expanded row)
│   └── supabase/
│       ├── server.ts            # Server-side Supabase clients (anon + service role) + getActiveTeamId()
│       └── client.ts            # Browser-side Supabase client factory
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
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:** `themes_team_id_idx` — on `team_id` for workspace-scoped queries. Partial unique indexes: `themes_unique_name_team` — `UNIQUE (LOWER(name), team_id) WHERE team_id IS NOT NULL` for team dedup; `themes_unique_name_personal` — `UNIQUE (LOWER(name), initiated_by) WHERE team_id IS NULL` for personal workspace dedup.
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

**Provider:** Google OAuth via Supabase Auth. Open to any Google account.

**Standard flow:**

1. **Middleware** (`middleware.ts`) runs on every request. It refreshes the Supabase session via `getUser()`, redirects unauthenticated users to `/login`, and validates the `active_team_id` cookie (clears if user is no longer a member). Public routes (`/`, `/login`, `/auth/callback`, `/invite`) are excluded.
2. User visits `/login` and clicks "Sign in with Google."
3. `supabase.auth.signInWithOAuth({ provider: 'google' })` redirects to Google consent screen.
4. Google redirects back to `/auth/callback?code=...`.
5. The callback route handler exchanges the code for a session via `supabase.auth.exchangeCodeForSession(code)`.
6. On success: redirect to `/capture`. On failure: redirect to `/login?error=exchange_failed`.
7. **AuthProvider** (`components/providers/auth-provider.tsx`) wraps the app in `layout.tsx`. It reads the initial session on mount and subscribes to `onAuthStateChange`. Exposes `user`, `isAuthenticated`, `isLoading`, `canCreateTeam`, `activeTeamId`, `setActiveTeam`, and `signOut` via React context.
8. **UserMenu** consumes the auth context. Shows a loading skeleton while `isLoading`, a "Sign in" link when unauthenticated, and the user's Google avatar + email with a sign-out dropdown when authenticated.

**Invite acceptance flow:**

1. User receives an email with a link to `/invite/[token]`.
2. If authenticated: page shows team name, role, and "Accept & Join Team" button. Accepting calls `POST /api/invite/[token]/accept`, which creates a `team_members` entry and sets `active_team_id` cookie.
3. If unauthenticated: page shows "Sign in with Google to join" button. A `pending_invite_token` cookie is set before redirecting to OAuth.
4. After OAuth callback, if `pending_invite_token` exists, the callback auto-accepts the invitation, sets `active_team_id`, and clears the pending token cookie.

**Workspace context:**

- The `active_team_id` cookie determines the current workspace (personal or team). Absence = personal workspace.
- The **AuthProvider** exposes `activeTeamId` and `setActiveTeam()` via React context. `setActiveTeam` writes the cookie and updates context state, triggering reactive re-renders in all consuming components — no page reload needed.
- The **WorkspaceSwitcher** and **CreateTeamDialog** call `setActiveTeam()` to switch workspaces. Client-side cookie helpers live in `lib/cookies/active-team.ts`.
- Route handlers read the active team ID via `getActiveTeamId()` from `lib/supabase/server.ts`, then pass it to repository factories. Services receive pre-scoped repositories — they never call `getActiveTeamId()` directly.

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
10. **Team creation is a paid feature.** The `can_create_team` flag on `profiles` gates team creation. Developers enable this per user. No self-service payment gateway.
11. **Data retention on member departure.** When a member is removed or leaves, their sessions and other data remain in the team (owned by `team_id`). The `team_members.removed_at` timestamp records the departure. Re-inviting a departed member restores full access.
12. **Provider-agnostic email service.** Email sending is abstracted via `email-service.ts` with `resolveEmailProvider()` — supports Resend and Brevo, extensible to SMTP and others via `EMAIL_PROVIDER` env var.
13. **Dependency Inversion via repository pattern.** All 8 data-access services accept injected repository interfaces instead of importing Supabase directly. Repository interfaces live in `lib/repositories/`, Supabase adapters in `lib/repositories/supabase/`, and an in-memory mock in `lib/repositories/mock/`. Route handlers create Supabase clients, instantiate repositories via factory functions (`createSessionRepository`, etc.), and pass them to services. Services have zero coupling to Supabase — the `lib/services/` directory contains no `@/lib/supabase/server` imports. Workspace scoping (`team_id` filtering) is centralised in a shared `scopeByTeam()` helper within the adapter layer.
14. **Chat data isolation: anon client for reads, service-role for embeddings.** The RAG chat system uses two Supabase clients: the RLS-protected anon client for all data reads (via the `queryDatabase` tool), ensuring row-level security enforces both team scoping and personal workspace isolation (`created_by = auth.uid()`); and the service-role client only for the embedding repository (similarity search RPC). The embedding RPC adds explicit `filter_user_id` scoping for personal workspace queries. `teamId` is always resolved server-side from the `active_team_id` cookie — never accepted from the client request body.
15. **Dashboard widgets are self-contained client components.** Each widget owns its own fetch lifecycle via the shared `useDashboardFetch` hook, reading global filter state from URL search params (bookmarkable/shareable). The `/api/dashboard` route validates action + filter params with Zod and delegates to `executeQuery()` using the anon Supabase client (RLS-protected). Chart colours are centralised in `chart-colours.ts` to avoid duplication. Recharts is the charting library (PRD-021 Part 2).
