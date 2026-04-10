# PRD-020: RAG Chat Interface

> **Master PRD Section:** Section 20 — RAG Chat Interface
> **Status:** Draft
> **Deliverable:** Users can interact with their client feedback data through a natural-language chat interface backed by vector search, with a redesigned sidebar navigation and the master signal accessible as a sliding panel.

## Purpose

The master signal document is a static, lossy summary: the LLM decides what to emphasise, and if a user cares about something the LLM deemed unimportant, they have no way to dig deeper. The RAG chat interface flips this — the user decides what matters by asking questions, and the system retrieves everything relevant from the vector database (PRD-019), grounded in actual session data with full attribution.

This PRD introduces three things: a sidebar navigation that replaces the current header tabs (making room for a richer chat experience and future features), the chat interface itself (conversations, messages, streaming, citations), and the master signal as a companion panel within the chat page rather than a standalone tab.

The chat is user-private — each user's conversations are visible only to them, not to team admins or other members. This encourages candid exploration of client feedback without self-censoring.

## User Story

"As a user with captured client sessions, I want to ask natural-language questions about my feedback data and get answers grounded in actual session content — with citations showing which clients said what and when — so that I can investigate patterns, prepare for meetings, and make product decisions based on real evidence."

---

## Part 1: Sidebar Navigation

**Scope:** Replace the current header tab navigation with a hover-to-expand sidebar (Instagram-style). This is a layout refactor that touches the root layout, footer, and all existing pages. No new features — just a navigation redesign that scales better for the growing feature set (Capture, Chat, Settings, and future Dashboard). The footer is removed from authenticated pages and retained only on public routes (landing, login, invite) with theme toggle.

### Requirements

- **P1.R1** Replace the top-level header tab navigation with a vertical sidebar. The sidebar is a persistent element in the root layout, visible on all authenticated pages. The sidebar rests in icon-only (collapsed) mode by default and expands on mouse hover to reveal text labels — then collapses back on mouse leave (Instagram-style). There is no toggle button; the expanded state is transient, not persistent.

- **P1.R2** Sidebar layout, top to bottom:
  - **Top:** Synthesiser branding/logo (icon variant at rest, full logo on hover). Below the logo, workspace switcher (team/personal toggle) — in collapsed state shows a team icon with a small chevron indicating it's a dropdown, bordered as it is today. On hover-expand shows the full team name + chevron.
  - **Middle:** Navigation links — Capture, Chat, Settings. Each link has an icon (always visible) and a text label (visible only on hover-expand). The active route is visually highlighted (indigo accent, matching the existing brand).
  - **Bottom:** A "More" menu item that opens an upward popover with additional options (currently: theme toggle; extensible for future options). Below that, user profile display (avatar only at rest, avatar + name on hover-expand). Clicking the user profile opens a dropdown menu that opens **upward**. Sign-out action is inside the user dropdown.

- **P1.R3** The sidebar expands as an **overlay** on hover — it does not push or shift the main content area. The main content area always has a fixed left margin equal to the icon-only sidebar width. The expanded sidebar overlays the content with a subtle shadow. No cookie or localStorage persistence is needed (no persistent expanded/collapsed toggle).

- **P1.R4** On mobile viewports (below `md` breakpoint), the sidebar becomes a slide-out drawer triggered by a hamburger menu icon. The drawer overlays the content area and dismisses on outside click or navigation.

- **P1.R5** The main content area has a fixed left margin equal to the icon-only sidebar width on desktop. Full width on mobile (sidebar is an overlay drawer).

- **P1.R6** All existing pages (Capture, Settings, and any other authenticated routes) continue to function without changes to their content. Only the navigation shell around them changes.

- **P1.R7** The M-Signals tab is removed from navigation. Master signal functionality moves into the Chat page (Part 4 of this PRD) as a sliding panel.

- **P1.R8** The footer is removed from all authenticated pages. It is retained only on public routes (landing page, login, invite) with the developer contact links and the dark/light theme toggle.

### Acceptance Criteria

- [ ] Header tab navigation is replaced with a vertical sidebar
- [ ] Sidebar rests in icon-only mode and expands on mouse hover (Instagram-style overlay, no content shift)
- [ ] Sidebar displays branding (icon/full on hover), workspace switcher (top, below logo), nav links (Capture, Chat, Settings), "More" menu, and user profile
- [ ] Workspace switcher shows team icon + chevron when collapsed, full name + chevron when hovered
- [ ] Active route is visually highlighted
- [ ] "More" menu opens upward with theme toggle
- [ ] User profile shows avatar only at rest; dropdown opens upward on click
- [ ] Mobile viewport shows a hamburger menu that opens a drawer overlay
- [ ] Main content area has fixed icon-only-width left margin (no shift on hover)
- [ ] All existing pages render correctly within the new layout
- [ ] M-Signals tab is removed from navigation
- [ ] Footer is removed from authenticated pages, retained on public routes with theme toggle

---

## Part 2: Chat Data Model and Streaming Infrastructure

**Scope:** Create the database tables for conversations and messages, build the streaming API infrastructure, and establish the server-side generation flow that the chat UI (Part 3) will consume.

### Requirements

- **P2.R1** Create the `conversations` table:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `title` — text, NOT NULL. Auto-generated from the user's first message (first 80 characters or a lightweight LLM-generated summary). Editable by the user.
  - `created_by` — UUID, FK to `auth.users`, NOT NULL. The user who created the conversation.
  - `team_id` — UUID, nullable. The team context in which the conversation was created (null for personal workspace). Used for scoping which embeddings the retrieval service searches, not for sharing conversations.
  - `is_pinned` — boolean, NOT NULL, default `false`. Pinned conversations float to the top of the conversation list.
  - `is_archived` — boolean, NOT NULL, default `false`. Archived conversations are hidden from the default list view but not deleted.
  - `created_at` — timestamptz, NOT NULL, default `now()`.
  - `updated_at` — timestamptz, NOT NULL, default `now()`. Updated on every new message.

- **P2.R2** RLS on `conversations`: **user-private**. Policies enforce `created_by = auth.uid()` for all operations (select, insert, update, delete). No admin override, no team-wide read access. A user can only see and manage their own conversations, regardless of role.

- **P2.R3** Create the `messages` table:
  - `id` — UUID, primary key, default `gen_random_uuid()`.
  - `conversation_id` — UUID, FK to `conversations.id`, NOT NULL. On conversation delete, cascade delete messages.
  - `parent_message_id` — UUID, nullable, FK to `messages.id`. Null for linear conversation flow. Enables future edit/retry as a tree structure: a retried message points to the same parent as the message it replaces, creating branches. Not used in v1 but the column exists from day one.
  - `role` — text, NOT NULL. One of: `user`, `assistant`.
  - `content` — text, NOT NULL. The message text. For assistant messages, this is the full generated response. For user messages, this is the user's question.
  - `sources` — jsonb, nullable. Array of citation objects for assistant messages. Each citation: `{ sessionId: string, clientName: string, sessionDate: string, chunkText: string, chunkType: string }`. Null for user messages.
  - `status` — text, NOT NULL, default `completed`. One of: `completed`, `streaming`, `failed`, `cancelled`. `streaming` indicates generation is in progress. `failed` indicates the generation errored. `cancelled` indicates the user or system interrupted generation.
  - `metadata` — jsonb, nullable. Extensible field for future use: model name, token count, latency, retrieval stats, generation parameters. Not actively populated in v1 but the column exists.
  - `created_at` — timestamptz, NOT NULL, default `now()`.

- **P2.R4** RLS on `messages`: access is derived from conversation ownership. A user can read/write messages only in conversations where `conversations.created_by = auth.uid()`. Implemented via a policy that joins on `conversations`.

- **P2.R5** Create a chat service in `lib/services/chat-service.ts` with methods:
  - `createConversation(title, userId, teamId): Promise<Conversation>` — creates a new conversation row.
  - `getConversations(userId, teamId, options): Promise<Conversation[]>` — lists conversations for a user, sorted by pinned first then most recent. Supports filtering: archived/active, search by title.
  - `updateConversation(id, updates): Promise<Conversation>` — update title, is_pinned, is_archived.
  - `deleteConversation(id): Promise<void>` — hard delete (cascades to messages).
  - `getMessages(conversationId): Promise<Message[]>` — fetch all messages in a conversation, ordered by created_at ascending.
  - `createMessage(input): Promise<Message>` — insert a single message.
  - `updateMessage(id, updates): Promise<Message>` — update content, status, sources, metadata.

- **P2.R6** The chat LLM call uses **tool use** (not a single retrieval-then-generate pipeline). The LLM is given two tools and decides which to call — one, both, or neither — based on the user's question. This enables qualitative, quantitative, and hybrid queries in a single unified flow.

  **Tool 1: `searchInsights`** — Semantic search over session embeddings (wraps the retrieval service from PRD-019). Parameters: `query` (string — the search query, which may differ from the user's exact wording), `filters` (optional — client name, date range, chunk types). Returns: array of relevant chunks with text, client name, session date, chunk type, and similarity score. Used for qualitative questions ("What are clients saying about onboarding?").

  **Tool 2: `queryDatabase`** — Structured database queries for quantitative answers. Parameters: `action` (enum — one of the predefined query types), `filters` (optional — date range, client name, team scope). Returns: the query result as a typed object. The LLM never writes SQL — it selects an action and provides filter values, and the server maps that to a safe, parameterized query.

  Initial `queryDatabase` actions:
  - `count_clients` — total number of clients. Returns `{ count: number }`.
  - `count_sessions` — total sessions, filterable by date range. Returns `{ count: number }`.
  - `sessions_per_client` — session count grouped by client. Returns `{ clients: { name: string, count: number }[] }`.
  - `sentiment_distribution` — count of sessions by sentiment, filterable by date range. Returns `{ positive: number, negative: number, neutral: number, mixed: number }`.
  - `urgency_distribution` — count of sessions by urgency level. Returns `{ low: number, medium: number, high: number, critical: number }`.
  - `recent_sessions` — list of recent sessions with client name and date. Returns `{ sessions: { clientName: string, sessionDate: string, sentiment: string }[] }`.
  - `client_list` — list of all client names. Returns `{ clients: string[] }`.

  New actions are added by defining a new case in the query handler — no schema migration required. The action set is designed to grow as user query patterns emerge.

- **P2.R7** Create a chat API route at `/api/chat/send` (POST) that handles the full generation flow:
  1. Validate input: `conversationId` (optional — if null, create a new conversation), `message` (the user's question), `teamId`.
  2. If new conversation: create conversation row with auto-generated title (first 80 characters of the message).
  3. Insert user message row (role: `user`, status: `completed`).
  4. Insert assistant message row (role: `assistant`, status: `streaming`, content: empty string).
  5. Call the LLM with streaming enabled via the Vercel AI SDK, providing both tools (`searchInsights` and `queryDatabase`) and the conversation history. The LLM autonomously decides which tools to call based on the question. It may call `searchInsights` for qualitative questions, `queryDatabase` for quantitative questions, both for hybrid questions (e.g., "Which clients mentioned pricing and how many sessions does each have?"), or neither if the answer is in the conversation history.
  6. As the LLM invokes tools, send ephemeral `status` SSE events to the client describing what is happening:
     - On `searchInsights` call: "Searching across N sessions..."
     - On `searchInsights` result: "Found N relevant insights from N clients"
     - On `queryDatabase` call: "Looking up your data..."
     - On generation start: "Generating answer..."
  7. Stream response tokens to the client via SSE `delta` events.
  8. On stream completion: send `sources` (citations from `searchInsights` results), `follow_ups` (contextual suggestions), and `done` events. Update the assistant message row with full content, sources, status: `completed`, and metadata (model, tools called, token count if available).
  9. On stream error: update the assistant message row with status: `failed`, log the error server-side.

- **P2.R8** The `queryDatabase` tool handler lives in `lib/services/database-query-service.ts`. It is a pure service function (no HTTP imports) that takes an action string and filters, executes the corresponding parameterized Supabase query, and returns typed results. Each action is a separate function internally. New actions are added by creating a new function and registering it in the action map. All queries respect team scoping via `team_id`.

- **P2.R9** Conversation context bounding: when building the LLM prompt, include conversation history up to an 80,000-token budget. Walk backward from the most recent message, including messages until the budget would be exceeded. Older messages beyond the budget are excluded. Token counting uses a fast approximation (character count / 4) rather than a tokenizer library — precision is not critical here, the budget has ample margin.

- **P2.R10** The chat system prompt instructs the LLM to:
  - Use the `searchInsights` tool when the question is about what clients said, felt, or experienced. Use the `queryDatabase` tool when the question involves counts, lists, distributions, or factual lookups. Use both when the question requires qualitative context combined with quantitative data.
  - Answer based only on the data returned by tools and the conversation history. If the tools do not return enough information to answer, say so explicitly rather than guessing.
  - Cite sources by referencing the client name and session date for each claim derived from `searchInsights`. Do not fabricate citations. Quantitative answers from `queryDatabase` do not require citations (the data comes from the database directly).
  - Return a structured `followUpQuestions` array (2-3 questions) as part of the response, suggesting what the user might want to explore next based on the current answer.
  - Never disclose raw chunk metadata, embedding scores, tool names, or internal system details to the user.

- **P2.R11** The chat system prompt and its structured response expectations are defined in `lib/prompts/chat-prompt.ts`, following the existing prompt file conventions. The prompt is version-controlled in code (not user-editable via the prompt editor in v1).

- **P2.R12** Server-side generation resilience (v1): if the client disconnects mid-stream (browser close, refresh), the server attempts to complete the generation and write the final result to the database. If the server cannot complete (e.g., the request handler is torn down), the assistant message remains with status: `streaming` and partial or empty content. The client handles this on reconnect (see Part 3).

### Acceptance Criteria

- [ ] `conversations` table exists with all specified columns and user-private RLS
- [ ] `messages` table exists with all specified columns, cascade delete, and conversation-scoped RLS
- [ ] `parent_message_id` column exists for future edit/retry tree structure
- [ ] Chat service provides CRUD operations for conversations and messages
- [ ] LLM receives two tools: `searchInsights` and `queryDatabase`
- [ ] `searchInsights` tool wraps the retrieval service and returns relevant chunks with metadata
- [ ] `queryDatabase` tool supports all initial actions: count_clients, count_sessions, sessions_per_client, sentiment_distribution, urgency_distribution, recent_sessions, client_list
- [ ] LLM autonomously decides which tools to call (one, both, or neither) based on the question
- [ ] Hybrid queries (qualitative + quantitative) produce a unified answer combining both tool results
- [ ] `/api/chat/send` handles the full flow: create conversation, insert messages, invoke LLM with tools, stream response
- [ ] SSE events include `status`, `delta`, `sources`, `follow_ups`, and `done` types
- [ ] Ephemeral status events reflect which tool is being called
- [ ] On completion, assistant message is updated with full content, sources, and status: `completed`
- [ ] On error, assistant message is updated with status: `failed`
- [ ] Conversation history is bounded by 80,000-token budget
- [ ] Chat system prompt enforces citation accuracy and prohibits fabrication
- [ ] Quantitative answers from `queryDatabase` do not require citations
- [ ] Chat prompt is defined in `lib/prompts/chat-prompt.ts`
- [ ] Database query service is framework-agnostic with no HTTP imports
- [ ] All database queries respect team scoping
- [ ] Server attempts to complete generation even if client disconnects

---

## Part 3: Chat Page UI

**Scope:** Build the chat page at `/chat` with conversation management, message display, streaming rendering, citations, ephemeral status messages, and suggested questions. This is the primary user-facing feature of this PRD.

### Requirements

#### Page Layout

- **P3.R1** Create a new route at `/chat` (replaces the M-Signals route in navigation). The page layout has two sections: a conversation list sidebar on the left, and the main chat area on the right.

- **P3.R2** The conversation list sidebar displays the user's conversations sorted by: pinned conversations first (sorted by most recent within pinned), then unpinned conversations sorted by most recent `updated_at`. Each conversation entry shows: title (truncated if long), a relative timestamp ("2h ago", "Yesterday"), and a pin icon indicator if pinned.

- **P3.R3** Conversation list sidebar actions:
  - **"New Chat" button** at the top — starts a new conversation (clears the chat area to the empty state).
  - **Search input** — filters conversations by title (client-side filter on loaded conversations, or server-side search if the list is large).
  - **Context menu on each conversation** (right-click or overflow icon) with: Rename, Pin/Unpin, Archive, Delete. Delete shows a confirmation dialog.

- **P3.R4** The conversation list sidebar is collapsible on desktop (independent of the main navigation sidebar). On mobile, the conversation list is hidden by default and accessible via a toggle.

#### Data Loading Strategy

- **P3.R5** Conversation list loading: fetch the most recent 30 conversations on initial page load (pinned first, then by `updated_at` descending). Archived conversations are excluded from the default load. If the user scrolls to the bottom of the conversation list, fetch the next batch of 30 (cursor-based pagination using `updated_at` of the oldest loaded conversation). Archived conversations load only when the user activates the "Archived" filter.

- **P3.R6** Message loading within a conversation: on opening a conversation, fetch the most recent 50 messages (ordered by `created_at` descending from the database, then reversed for chronological display in the UI). If the conversation has more than 50 messages, show a "Load earlier messages" button at the top of the thread. Clicking it fetches the next 50 (cursor-based pagination using `created_at` of the oldest currently loaded message). Not infinite scroll — an explicit button prevents scroll-position jank when prepending messages at the top. After loading earlier messages, the user's current viewport position is preserved so they don't lose their place.

#### Message Display

- **P3.R7** The main chat area displays the message thread for the active conversation. User messages are styled distinctly from assistant messages (e.g., user messages right-aligned with a coloured background, assistant messages left-aligned with a neutral background). Messages are rendered in chronological order (oldest at top, newest at bottom).

- **P3.R8** Assistant message content is rendered as markdown (the LLM may use headers, lists, bold, etc. in its responses). Use a markdown renderer that supports inline formatting, lists, and code blocks.

- **P3.R9** The chat area auto-scrolls to the latest message when a new message is added or when streaming content updates. If the user has manually scrolled up to read history, auto-scroll pauses until they scroll back to the bottom.

#### Streaming and Status Messages

- **P3.R10** When the user sends a message, the UI immediately displays the user message in the thread and shows the assistant response area in a "generating" state. Ephemeral status messages appear in the assistant message area as the backend progresses:
  - "Searching across N sessions..." — displayed while the retrieval service runs.
  - "Found N relevant insights from N clients" — displayed after retrieval, before LLM generation starts.
  - "Generating answer..." — displayed while waiting for the first token from the LLM.
  These status messages fade out and are replaced by the streaming response once tokens begin arriving.

- **P3.R11** Streaming display: as `delta` SSE events arrive, tokens are appended to the assistant message content in real-time. The markdown renderer re-renders incrementally as content grows. The message shows a subtle streaming indicator (e.g., a blinking cursor) until the `done` event is received.

- **P3.R12** On reconnect after a page refresh during generation:
  - If the assistant message has status `streaming` and content is empty: display "Generating your answer..." with a polling mechanism that checks the message status every 2-3 seconds until it changes to `completed` or `failed`.
  - If the assistant message has status `streaming` and content is non-empty: display the partial content with a "This response may be incomplete" indicator.
  - If the assistant message has status `completed`: display normally.
  - If the assistant message has status `failed`: display an error message with a "Retry" button.

#### Message Input

- **P3.R13** The message input is an auto-expanding textarea fixed at the bottom of the chat area. Enter sends the message. Shift+Enter inserts a newline. The send button is disabled while a response is streaming (one generation at a time).

- **P3.R14** The input is disabled with a visual indicator while an assistant response is being generated. The user cannot send a new message until the current generation completes, fails, or is cancelled.

#### Citations

- **P3.R15** After an assistant message completes, sources are displayed below the message content as clickable citation chips. Each chip shows: client name and session date (e.g., "Acme Corp — Mar 15, 2026"). Chips are visually distinct from message content (smaller font, muted colour, pill-shaped).

- **P3.R16** Clicking a citation chip navigates to the source session in the Capture page with that session expanded/highlighted, or opens a preview modal showing the relevant structured notes for that session. The specific interaction (navigate vs. modal) should favour the least disruptive option — a modal that shows the session's structured signal view without leaving the chat.

#### Suggested Questions

- **P3.R17** In the empty chat state (new conversation, no messages), display a set of hardcoded global starter questions as clickable chips:
  - "What are the most common pain points?"
  - "Which clients have the highest urgency?"
  - "What competitors are being mentioned?"
  - "Summarise feedback from the last month"
  Clicking a starter question sends it as the first message in a new conversation.

- **P3.R18** After each assistant response, display 2-3 contextual follow-up suggestions as clickable chips below the citations. These are generated by the LLM as part of the response (received via the `follow_ups` SSE event). Clicking a follow-up sends it as the next user message. Follow-up suggestions are not persisted to the database — they are ephemeral, rendered from the SSE response only.

#### Conversation Management

- **P3.R19** Auto-title: when a new conversation is created, the title is set to the first 80 characters of the user's first message. This provides an immediate, recognisable title without an extra LLM call. Users can rename via the conversation context menu.

- **P3.R20** Pin/Unpin: toggling the pin on a conversation updates `is_pinned` and immediately reorders the conversation list (pinned float to top).

- **P3.R21** Archive: archiving a conversation sets `is_archived = true` and removes it from the default list view. An "Archived" filter option in the conversation list reveals archived conversations. Archived conversations can be unarchived.

- **P3.R22** Delete: deleting a conversation permanently removes it and all its messages (cascade). A confirmation dialog is shown before deletion. If the deleted conversation is the currently active one, the chat area returns to the empty state.

#### In-Conversation Search

- **P3.R23** A search input within the active conversation (triggered by a search icon in the chat header or a keyboard shortcut like Ctrl+F / Cmd+F) that filters and highlights matching text across all messages in the current thread. This is entirely client-side — it filters over the messages already loaded in memory. Matching messages are highlighted with the search term visually marked. Navigation arrows (up/down) allow jumping between matches. Closing the search clears highlights.

### Acceptance Criteria

- [ ] `/chat` route exists and is accessible from the sidebar navigation
- [ ] Conversation list sidebar displays conversations sorted by pinned-first then most recent
- [ ] Conversation list loads initial 30 conversations with infinite scroll for more
- [ ] Archived conversations load only when the Archived filter is active
- [ ] New Chat, search, rename, pin/unpin, archive, and delete all function correctly
- [ ] Messages load the most recent 50 on conversation open with "Load earlier messages" button for older messages
- [ ] Loading earlier messages preserves the user's current scroll position
- [ ] Message thread displays user and assistant messages with distinct styling
- [ ] Assistant messages render markdown content correctly
- [ ] Auto-scroll works during streaming, pauses when user scrolls up
- [ ] Ephemeral status messages display during retrieval and generation phases
- [ ] Streaming tokens render in real-time with a streaming indicator
- [ ] Reconnect after refresh handles all status states (streaming, completed, failed)
- [ ] Message input auto-expands, sends on Enter, newline on Shift+Enter
- [ ] Input is disabled during active generation
- [ ] Citations display as clickable chips with client name and date
- [ ] Clicking a citation opens a session preview modal
- [ ] In-conversation search highlights matching text and supports navigation between matches
- [ ] Hardcoded global starter questions display in empty chat state
- [ ] Contextual follow-up suggestions display after each assistant response
- [ ] Auto-title sets conversation title from first message
- [ ] Pin/unpin reorders the conversation list
- [ ] Archive hides conversation, with option to view and unarchive
- [ ] Delete removes conversation with confirmation dialog

---

## Part 4: Master Signal Sliding Panel

**Scope:** Integrate the master signal functionality into the chat page as a sliding panel, replacing the standalone M-Signals page. The master signal becomes a companion reference alongside the chat, not a separate destination.

### Requirements

- **P4.R1** Add a floating action button in the top-right corner of the chat area labelled "View Master Signal" (or an icon with tooltip). The button is always visible when the sliding panel is closed.

- **P4.R2** Clicking the floating button opens a sliding panel from the right edge of the screen. The panel overlays the chat area (does not push it). The floating button hides while the panel is open. The panel can be closed via a close button in the panel header or by clicking outside the panel. When the panel closes, the floating button reappears.

- **P4.R3** The sliding panel contains the existing master signal rendering — the same content and formatting currently shown on the M-Signals page. This includes:
  - The master signal document content (markdown rendered as formatted text).
  - A "Generate Master Signal" / "Regenerate" button for creating or updating the master signal.
  - A stale session count badge showing how many new sessions have been added since the last generation.
  - The existing generation state handling (loading, error, empty state).

- **P4.R4** A "Download PDF" button in the panel header downloads the master signal as a PDF, using the existing PDF generation functionality from the M-Signals page.

- **P4.R5** The sliding panel is responsive: on desktop it occupies approximately 40-50% of the viewport width. On mobile it occupies the full width as a full-screen overlay with a back/close button.

- **P4.R6** The M-Signals page route (`/m-signals`) is removed. Any direct navigation to `/m-signals` redirects to `/chat`. The M-Signals page components are refactored into the sliding panel — no code duplication, shared components are extracted.

### Acceptance Criteria

- [ ] Floating "View Master Signal" button is visible in the top-right corner of the chat area
- [ ] Clicking the button opens a sliding panel from the right
- [ ] Floating button hides while panel is open, reappears on close
- [ ] Panel displays the full master signal content with current rendering
- [ ] Generate/Regenerate button works within the panel
- [ ] Stale session count badge displays correctly
- [ ] Download PDF button generates and downloads the master signal as PDF
- [ ] Panel is responsive: 40-50% width on desktop, full width on mobile
- [ ] `/m-signals` route redirects to `/chat`
- [ ] No code duplication — M-Signals components are shared/refactored

---

## Backlog (deferred from this PRD)

- **Progressive DB writes during streaming** — write assistant message content to the database every N seconds during generation for true refresh resilience (v2 streaming)
- **Supabase Realtime for stream delivery** — fully decouple generation from client connection using Supabase Realtime channels as the pub/sub layer (v2 streaming)
- **Edit and retry messages** — tree structure is ready via `parent_message_id`. UI for editing a past user message and regenerating from that point, showing branching conversation paths
- **Conversation sharing** — share a conversation link with teammates (requires relaxing user-private RLS for shared conversations)
- **Export conversation** — download a conversation as PDF or markdown
- **Multi-modal chat** — attach files or images to chat messages for context-aware Q&A
- **User-editable chat prompt** — expose the chat system prompt in the prompt editor settings (similar to extraction prompt customisation)
- **Smart conversation titles** — use a lightweight LLM call to generate a descriptive title after the first exchange (instead of truncating the first message)
- **Conversation search by content** — search across message content, not just conversation titles
- **Chat analytics** — track most-asked question patterns, most-cited sessions, retrieval quality metrics
- **Additional `queryDatabase` actions** — expand the action set as user query patterns emerge (e.g., trend_over_time, top_pain_points_by_count, sessions_without_extraction, client_sentiment_history). New actions require only a new function and action map entry, no schema migration
