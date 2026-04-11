# TRD-020: RAG Chat Interface

> **Status:** Draft (Parts 1–3 detailed, Parts 1–2 implemented)
> **PRD:** `docs/020-rag-chat/prd.md` (approved)
> **Mirrors:** PRD Parts 1–4. Each part is written and reviewed one at a time. Parts 3–4 will be added after their preceding parts are implemented.

---

## Part 1: Sidebar Navigation

> Implements **P1.R1–P1.R8** from PRD-020.

### Overview

Replace the horizontal header tab navigation with a hover-to-expand sidebar (Instagram-style). The sidebar rests in icon-only mode and expands as an overlay on mouse hover — no toggle button, no persistent expanded state. The footer is removed from authenticated pages and retained only on public routes with the theme toggle. Workspace switcher moves to the top (below logo), user menu opens upward, and a "More" menu provides the theme toggle and future extensibility.

### Technical Decisions

1. **Hover-to-expand overlay, not a toggle-based sidebar.** The sidebar is always icon-only at rest (`--sidebar-width-collapsed: 64px`). On `mouseenter` the `<aside>` expands to `--sidebar-width-expanded: 240px` overlaying the content (via `position: fixed` + higher `z-index` + `box-shadow`). On `mouseleave` it collapses back. No cookie or localStorage is needed — there is no persistent expanded state. The main content area always has a fixed `md:ml-[var(--sidebar-width-collapsed)]` margin that never changes. This eliminates the layout-shift problem entirely and matches the Instagram pattern.

2. **CSS transition for smooth expand/collapse.** The `<aside>` uses `transition: width 200ms ease` (via Tailwind `transition-all duration-200`). Text labels inside nav links use `opacity` + `overflow-hidden` transitions so they fade in/out smoothly alongside the width change. Icons remain stationary (no horizontal shift) during the transition — the extra width appears to the right of the icons.

3. **"More" menu via shadcn `DropdownMenu` opening upward.** The "More" nav item at the bottom of the sidebar opens a `DropdownMenu` with `side="top"` alignment. This avoids the menu going off-screen (since the trigger is near the bottom). The dropdown currently contains only the theme toggle; future items (keyboard shortcuts, export, etc.) slot in as additional `DropdownMenuItem` entries with no structural change.

4. **User menu dropdown opens upward.** The `UserMenu` component is modified to accept a `side` prop (default `"bottom"`) that controls the `DropdownMenuContent` placement. The sidebar passes `side="top"`. In collapsed state, only the avatar is rendered as the trigger. On hover-expand, the avatar + truncated name are shown. The dropdown content (user info + sign out) is identical.

5. **Workspace switcher at top, below logo.** `WorkspaceSwitcher` moves from the bottom section to directly below the logo. In collapsed state, it renders a bordered team icon (`Users` for team, `User` for personal) + small `ChevronDown`, fitting within the 64px width. On hover-expand, it shows the full team name + chevron (existing trigger layout). The `DropdownMenuContent` is portal-mounted, so it opens correctly regardless of sidebar width.

6. **Footer removed from authenticated pages.** The `AuthenticatedLayout` wrapper renders no `AppFooter` for authenticated routes. The `AppFooter` (with developer links + theme toggle) renders only on public routes (landing, login, invite). The theme toggle returns to `AppFooter` for public routes (it was removed in increment 1.1 but is now restored for public-only use). Inside authenticated pages, theme switching lives in the "More" menu.

7. **AppHeader and TabNav deleted.** The current `AppHeader` composes `SynthesiserLogo`, `TabNav`, `WorkspaceSwitcher`, and `UserMenu`. All reusable components move into the sidebar. `AppHeader` and `TabNav` are deleted — dead code. `SynthesiserLogo`, `WorkspaceSwitcher`, and `UserMenu` are reused as-is (minor prop additions where noted).

8. **No new routes or database changes.** Part 1 is a pure frontend layout refactor. The `/chat` route is created in Part 3; Part 1 only adds the "Chat" nav link pointing to `/chat` (which will 404 until Part 3).

9. **M-Signals nav link removed immediately.** Per P1.R7, the Master Signals tab is removed from navigation. The `/m-signals` route and components remain in the codebase until Part 4 refactors them into the sliding panel. The redirect from `/m-signals` to `/chat` is added in Part 4.

### Forward Compatibility Notes

- **Part 2 (Chat Data Model):** No sidebar changes. The `/chat` nav link added here will resolve to a real page once Part 3 creates the route.
- **Part 3 (Chat Page UI):** The chat page renders inside the `{children}` slot of the layout, within the main content area. The sidebar's "Chat" link becomes active when `pathname.startsWith('/chat')`.
- **Part 4 (Master Signal Panel):** The M-Signals page components are refactored into a sliding panel on the chat page. The sidebar's removal of the M-Signals link (done here) means no further nav changes are needed in Part 4.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/globals.css` | **Edit** | Add `--sidebar-width-expanded` and `--sidebar-width-collapsed` CSS custom properties (remove `--sidebar-width` dynamic toggle and `[data-sidebar-collapsed]` rule — no longer needed) |
| `app/layout.tsx` | **Edit** | Replace `AppHeader` with `AuthenticatedLayout`. Remove `sidebar_collapsed` cookie read (no longer needed). |
| `components/layout/authenticated-layout.tsx` | **Edit** | Authenticated: render sidebar + fixed-margin content (no footer). Public: render children + `AppFooter`. |
| `components/layout/app-sidebar.tsx` | **Edit** | Rewrite to hover-to-expand overlay model. Restructure: logo → workspace switcher → nav links → spacer → "More" menu → user profile. Remove collapse toggle button. Add `mouseenter`/`mouseleave` handlers. |
| `components/layout/app-footer.tsx` | **Edit** | Restore theme toggle (for public routes only). |
| `components/layout/user-menu.tsx` | **Edit** | Add `side` prop to control dropdown direction (default `"bottom"`, sidebar passes `"top"`). In sidebar collapsed mode, render avatar-only trigger. |
| `components/layout/workspace-switcher.tsx` | **Edit** | Add `collapsed` prop. When `true`, render bordered icon + chevron trigger that fits 64px width. |
| `components/layout/app-header.tsx` | **Delete** | Replaced by sidebar. |
| `components/layout/tab-nav.tsx` | **Delete** | Navigation links are inline in sidebar. |
| `middleware.ts` | **No change** | Route protection unaffected. |

### Component Design

#### `AppSidebar` (rewritten)

**File:** `components/layout/app-sidebar.tsx`
**Directive:** `"use client"`
**Props:**

```typescript
interface AppSidebarProps {
  className?: string;
}
```

No `defaultCollapsed` prop — the sidebar is always collapsed at rest.

**Internal state:**

- `expanded: boolean` — `false` at rest, `true` on mouse hover. Driven by `onMouseEnter`/`onMouseLeave` on the `<aside>`.
- `mobileOpen: boolean` — mobile drawer open/closed state, default `false`.

**Desktop structure (top to bottom):**

1. **Logo** — `SynthesiserLogo` with `variant="icon"` at rest, `variant="full"` when expanded. Wrapped in a `Link` to `/capture`.
2. **Workspace switcher** — `WorkspaceSwitcher` with `collapsed={!expanded}`. Bordered container. In collapsed mode: team icon (`Users`/`User`) + small `ChevronDown`, centered in 64px. In expanded mode: full trigger (icon + team name + chevron).
3. **Navigation links** — Vertical list with gap. Each link: icon (always visible, `size-5`, centered in a 40px row when collapsed) + text label (visible only when `expanded`, with `opacity` transition). Links: Capture (`/capture`, `Pencil`), Chat (`/chat`, `MessageSquare`), Settings (`/settings`, `Settings`). Active route: `bg-[var(--brand-primary-light)] text-[var(--brand-primary)]`. Inactive: `text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]`.
4. **Spacer** — `flex-1`.
5. **"More" menu** — A nav-item-styled button with `Ellipsis` (or `MoreHorizontal`) icon. Opens a `DropdownMenu` with `side="top"`. Dropdown contains: theme toggle row (Sun/Moon icon + "Light mode"/"Dark mode" label, click toggles theme).
6. **User profile** — `UserMenu` with `side="top"` and `collapsed={!expanded}`. At rest: avatar only (32px circle). Expanded: avatar + truncated email/name. Dropdown opens upward with user info + sign out.

**Hover behavior (desktop):**

```
<aside
  onMouseEnter={() => setExpanded(true)}
  onMouseLeave={() => setExpanded(false)}
  className={cn(
    "fixed inset-y-0 left-0 z-40 hidden flex-col border-r bg-[var(--surface-page)] transition-all duration-200 md:flex",
    expanded
      ? "w-[var(--sidebar-width-expanded)] shadow-lg"
      : "w-[var(--sidebar-width-collapsed)]"
  )}
>
```

The `shadow-lg` on expand gives the overlay depth against the content behind it. The fixed position means it overlays without affecting content layout.

**Mobile structure:**

On viewports below `md`, the desktop `<aside>` is hidden (`hidden md:flex`). A hamburger button (`Menu` icon, `fixed top-4 left-4 z-50 md:hidden`) triggers a shadcn `Sheet` from the left. The sheet contains the same sidebar content with `expanded` forced to `true`. Navigating to a link closes the sheet.

#### `UserMenu` modifications

Add optional props:

```typescript
interface UserMenuProps {
  side?: "top" | "bottom";   // Dropdown direction, default "bottom"
  collapsed?: boolean;        // When true, show avatar only as trigger
  className?: string;
}
```

When `collapsed` is `true`, the trigger renders only the avatar circle (no email text). `DropdownMenuContent` uses `side` to position above or below.

#### `WorkspaceSwitcher` modifications

Add optional prop:

```typescript
interface WorkspaceSwitcherProps {
  collapsed?: boolean;  // When true, show icon + chevron only
  className?: string;
}
```

When `collapsed` is `true`, the trigger renders a bordered container with just the workspace icon (`Users` for team, `User` for personal) + `ChevronDown` — fitting within 64px. The `DropdownMenuContent` is unaffected (portal-mounted, opens normally).

### Layout Changes

#### `app/layout.tsx`

```tsx
// After:
<body>
  <AuthProvider>
    <AuthenticatedLayout>
      {children}
    </AuthenticatedLayout>
    <Toaster />
  </AuthProvider>
</body>
```

No `sidebar_collapsed` cookie read. No `defaultCollapsed` prop. The layout is simpler — `AuthenticatedLayout` handles everything.

#### `components/layout/authenticated-layout.tsx`

```tsx
// Authenticated pages:
<div className="flex h-full">
  <AppSidebar />
  <div className="flex flex-1 flex-col min-h-screen md:ml-[var(--sidebar-width-collapsed)]">
    <main className="flex flex-1 flex-col">{children}</main>
  </div>
</div>

// Public pages:
<>
  <main className="flex flex-1 flex-col">{children}</main>
  <AppFooter />
</>
```

The margin is always `--sidebar-width-collapsed` (64px) — it never changes. No footer in authenticated layout.

### CSS Changes

#### `app/globals.css`

The `:root` block contains:

```css
/* Sidebar dimensions */
--sidebar-width-expanded: 240px;
--sidebar-width-collapsed: 64px;
```

The `[data-sidebar-collapsed]` rule and `--sidebar-width` dynamic property are removed — no longer needed since the content margin is always the collapsed width.

### `AppFooter` Changes

The theme toggle is **restored** in `AppFooter` (it was removed in the prior increment 1.1 implementation). The footer now renders only on public routes (controlled by `AuthenticatedLayout`), so the theme toggle belongs here for unauthenticated users. Inside authenticated pages, the theme toggle lives in the sidebar's "More" menu.

### Implementation

#### Increment 1.1: CSS Tokens, Layout Shell, and Sidebar Structure (revised)

**What:** Update CSS custom properties in `globals.css`. Rewrite `AppSidebar` to the hover-to-expand overlay model with the new section ordering (logo → workspace switcher → nav → spacer → "More" → user). Update `AuthenticatedLayout` to remove footer from authenticated pages. Restore theme toggle in `AppFooter` for public routes. Update `layout.tsx` to remove the `sidebar_collapsed` cookie read.

**Steps:**

1. Edit `globals.css`: remove `--sidebar-width` and `[data-sidebar-collapsed]` rule. Keep `--sidebar-width-expanded` and `--sidebar-width-collapsed`.
2. Rewrite `components/layout/app-sidebar.tsx`: hover-to-expand overlay with `mouseenter`/`mouseleave`, new section order, "More" dropdown menu with theme toggle, no collapse toggle button.
3. Edit `components/layout/user-menu.tsx`: add `side` and `collapsed` props. Collapsed renders avatar-only trigger. `side="top"` places dropdown above.
4. Edit `components/layout/workspace-switcher.tsx`: add `collapsed` prop. Collapsed renders bordered icon + chevron trigger.
5. Edit `components/layout/authenticated-layout.tsx`: authenticated renders sidebar + fixed-margin content (no footer). Public renders children + `AppFooter`.
6. Edit `components/layout/app-footer.tsx`: restore theme toggle (for public routes).
7. Edit `app/layout.tsx`: remove `sidebar_collapsed` cookie read, remove `defaultSidebarCollapsed` prop from `AuthenticatedLayout`.
8. Verify all existing pages render correctly.

**Requirement coverage:** P1.R1 (sidebar in layout), P1.R2 (sidebar sections — logo, workspace switcher, nav, "More", user), P1.R3 (hover overlay, no content shift), P1.R5 (fixed margin), P1.R6 (existing pages unchanged), P1.R7 (M-Signals removed), P1.R8 (footer removed from auth pages).

#### Increment 1.2: Mobile Drawer

**What:** Add the mobile hamburger trigger and sheet-based drawer for viewports below `md`.

**Steps:**

1. Install shadcn `Sheet` component if not present (`npx shadcn@latest add sheet`).
2. In `AppSidebar`, add a `Sheet` wrapper for mobile. The desktop `<aside>` is `hidden md:flex`. The mobile trigger (`Menu` icon button) is `fixed top-4 left-4 z-50 md:hidden`.
3. The `Sheet` opens from the left, contains the sidebar content with `expanded` forced to `true`.
4. Navigating to a link closes the sheet.
5. Verify: resize to mobile width. Hamburger appears, sidebar hidden. Tap hamburger — drawer slides in. Tap a link — drawer closes.

**Requirement coverage:** P1.R4 (mobile drawer with hamburger trigger).

#### Increment 1.3: Cleanup and Audit

**What:** Delete dead code, verify all acceptance criteria.

**Steps:**

1. Delete `components/layout/app-header.tsx`.
2. Delete `components/layout/tab-nav.tsx`.
3. Remove any remaining `AppHeader` or `TabNav` imports across the codebase.
4. Run `npx tsc --noEmit` to verify no type errors.
5. Manually verify each acceptance criterion from the PRD:
   - Header tab navigation replaced with sidebar ✓
   - Sidebar rests in icon-only mode, expands on hover as overlay ✓
   - Sidebar displays branding, workspace switcher (top), nav links, "More" menu, user profile ✓
   - Workspace switcher: icon + chevron collapsed, full name expanded ✓
   - Active route highlighted ✓
   - "More" menu opens upward with theme toggle ✓
   - User profile: avatar only collapsed, dropdown opens upward ✓
   - Mobile hamburger + drawer overlay ✓
   - Content has fixed icon-only-width margin, no shift on hover ✓
   - All existing pages render correctly ✓
   - M-Signals removed from nav ✓
   - Footer removed from auth pages, retained on public routes with theme toggle ✓
6. Check for unused imports, dead CSS, convention compliance.

**Requirement coverage:** All P1.R1–P1.R8. End-of-part audit.

---

## Part 2: Chat Data Model and Streaming Infrastructure

> Implements **P2.R1–P2.R12** from PRD-020.

### Overview

Create the database tables for conversations and messages, build the chat service (repository + service layer), the database query service for quantitative tool use, the streaming API route with Vercel AI SDK tool calling, and the LLM-generated conversation title flow. This part produces the full server-side chat infrastructure that Part 3's UI will consume — no frontend components are created here.

### Technical Decisions

1. **Repository pattern for conversations and messages.** Following the existing codebase convention (session-repository, team-repository, etc.), create `ConversationRepository` and `MessageRepository` interfaces with Supabase adapters. The chat service composes both repositories. This maintains the Dependency Inversion principle — the service depends on interfaces, not Supabase directly.

2. **`streamText` with `stopWhen: stepCountIs(3)` for autonomous tool calling.** The Vercel AI SDK v6 `streamText()` function supports a `tools` parameter with Zod-typed tool definitions and a `stopWhen` parameter (v6 renamed from v5's `maxSteps`) that lets the model call tools and then generate a final text response in a single streaming invocation. We set `stopWhen: stepCountIs(3)` (tool calls + final generation). This avoids manual orchestration of tool calls — the SDK handles the tool call → result → continuation loop automatically. The streamed response includes both tool call events and text delta events.

3. **Custom SSE via `ReadableStream`.** The Vercel AI SDK v6 removed `toDataStreamResponse()`. Instead, we build a custom `ReadableStream` that emits typed SSE events (`status`, `delta`, `sources`, `follow_ups`, `done`, `error`). This gives full control over the event protocol — we can send custom status events during tool execution (e.g., "Searching across sessions...") and structured final events (sources, follow-ups) that the client parses directly. The streaming orchestration lives in `chat-stream-service.ts`, keeping the route handler thin.

4. **Tool definitions as `inputSchema: zodSchema(z.object(...))`.** Both `searchInsights` and `queryDatabase` tools are defined using the v6 `tool()` helper with `inputSchema: zodSchema(...)` (v6 renamed from v5's `parameters`). The SDK validates tool call arguments against the schema before invoking the `execute` function. This gives us type-safe tool parameters with zero manual parsing. `maxOutputTokens` (v6 renamed from v5's `maxTokens`) is set to `CHAT_MAX_TOKENS`.

5. **`queryDatabase` uses an action map, not raw SQL.** The `DatabaseQueryService` maps action strings (e.g., `count_clients`, `sessions_per_client`) to pre-built parameterized Supabase queries. The LLM never sees or generates SQL. Adding a new action is a single function + map entry — no schema migration. All queries scope by `team_id` using the existing `scopeByTeam()` helper.

6. **Fire-and-forget LLM title generation.** When a new conversation is created, the route inserts the conversation with a truncated placeholder title (first 80 chars), then fires an async `generateConversationTitle()` call that does not block the response stream. The function uses `generateText()` with a short prompt and low `maxTokens` (30). On success, it updates the conversation row. On failure, the placeholder stays. The client receives the conversation ID immediately and can poll or react to the title update on next load.

7. **Conversation context bounding.** The chat route builds the message history by walking backward from the most recent message, accumulating content until an 80,000-token budget (approximated as `characterCount / 4`) would be exceeded. Older messages are dropped. This is a simple truncation — no summarization of dropped context in v1.

8. **Server-side generation resilience.** The route handler inserts the assistant message with `status: 'streaming'` before starting the LLM call. If the stream completes normally, it updates to `status: 'completed'` with full content and sources. If the stream errors, it updates to `status: 'failed'`. If the server is torn down mid-stream (deployment, timeout), the row remains as `status: 'streaming'` with whatever partial content was last flushed. Part 3's client handles reconnection by detecting `streaming` status messages on load.

9. **Follow-up questions in the response.** The system prompt instructs the LLM to end its response with a JSON block containing 2-3 follow-up questions. After stream completion, the `chat-stream-service` parses this block from the accumulated text, strips it from the stored content, and sends it as a separate SSE event (`follow_ups`). This avoids polluting the rendered message with raw JSON. If parsing fails (LLM didn't follow the format), no follow-ups are sent — graceful degradation.

10. **`sources` derived from `searchInsights` tool results.** When the `searchInsights` tool returns results, the stream service captures the citation data (sessionId, clientName, sessionDate, chunkText, chunkType). After stream completion, these are deduplicated, written to the assistant message's `sources` jsonb column, and sent as a `sources` SSE event for the client to render as citation chips.

11. **SRP split: route → stream service → helpers.** The API route (`route.ts`) is a thin controller: auth, validation, conversation/message setup, and response formatting. Streaming orchestration (tool definitions, `streamText` call, event emission, message finalization) lives in `chat-stream-service.ts`. Pure utility functions (SSE encoding, follow-up parsing, source deduplication) live in `chat-helpers.ts`. This keeps each file focused on one concern.

### Database Migrations

#### Migration 1: `conversations` table

```sql
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_pinned   BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing: pinned first, then most recent
CREATE INDEX idx_conversations_user_list
  ON conversations (created_by, is_archived, is_pinned DESC, updated_at DESC);

-- RLS: user-private
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select ON conversations
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY conversations_insert ON conversations
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY conversations_update ON conversations
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY conversations_delete ON conversations
  FOR DELETE USING (created_by = auth.uid());

-- Auto-update updated_at trigger (reuse existing pattern if available)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### Migration 2: `messages` table

```sql
CREATE TABLE messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  role               TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content            TEXT NOT NULL DEFAULT '',
  sources            JSONB,
  status             TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'streaming', 'failed', 'cancelled')),
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for loading messages in a conversation (chronological)
CREATE INDEX idx_messages_conversation_created
  ON messages (conversation_id, created_at ASC);

-- RLS: derived from conversation ownership
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.created_by = auth.uid()
    )
  );

CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.created_by = auth.uid()
    )
  );

CREATE POLICY messages_update ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.created_by = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.created_by = auth.uid()
    )
  );

CREATE POLICY messages_delete ON messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.created_by = auth.uid()
    )
  );
```

#### Migration 3: `updated_at` trigger on conversations from message inserts

```sql
-- Automatically bump conversations.updated_at when a message is inserted
CREATE OR REPLACE FUNCTION update_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_update_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_updated_at();
```

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/020-rag-chat/001-conversations.sql` | **Create** | Migration 1: conversations table + RLS + indexes |
| `docs/020-rag-chat/002-messages.sql` | **Create** | Migration 2: messages table + RLS + indexes |
| `docs/020-rag-chat/003-conversation-updated-at-trigger.sql` | **Create** | Migration 3: auto-update conversations.updated_at on message insert |
| `lib/types/chat.ts` | **Create** | TypeScript types: `Conversation`, `Message`, `MessageRole`, `MessageStatus`, `ChatSource`, `ConversationListOptions` |
| `lib/repositories/conversation-repository.ts` | **Create** | `ConversationRepository` interface |
| `lib/repositories/message-repository.ts` | **Create** | `MessageRepository` interface |
| `lib/repositories/supabase/supabase-conversation-repository.ts` | **Create** | Supabase adapter for ConversationRepository |
| `lib/repositories/supabase/supabase-message-repository.ts` | **Create** | Supabase adapter for MessageRepository |
| `lib/repositories/index.ts` | **Edit** | Re-export conversation and message repository interfaces |
| `lib/repositories/supabase/index.ts` | **Edit** | Re-export conversation and message repository factory functions |
| `lib/services/chat-service.ts` | **Create** | Chat service — conversation CRUD, message CRUD, context bounding |
| `lib/services/database-query-service.ts` | **Create** | Database query service — action map with parameterized Supabase queries |
| `lib/prompts/chat-prompt.ts` | **Create** | Chat system prompt — tool usage instructions, citation rules, follow-up generation |
| `lib/prompts/generate-title.ts` | **Create** | Lightweight title generation prompt (5-8 word summary) |
| `lib/services/chat-stream-service.ts` | **Create** | Streaming orchestration — tool definitions, streamText call, SSE event emission, message finalization |
| `lib/utils/chat-helpers.ts` | **Create** | Pure utilities — SSE encoding, follow-up parsing, source mapping and deduplication |
| `app/api/chat/send/route.ts` | **Create** | POST — thin controller: auth, validation, conversation setup, delegates to chat-stream-service |
| `lib/services/ai-service.ts` | **Edit** | Add `generateConversationTitle()` function |

### Type Definitions

#### `lib/types/chat.ts`

```typescript
export type MessageRole = "user" | "assistant";
export type MessageStatus = "completed" | "streaming" | "failed" | "cancelled";

export interface ChatSource {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  chunkText: string;
  chunkType: string;
}

export interface Message {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: MessageRole;
  content: string;
  sources: ChatSource[] | null;
  status: MessageStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdBy: string;
  teamId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListOptions {
  archived?: boolean;
  search?: string;
  limit: number;
  cursor?: string; // updated_at of the oldest loaded conversation
}
```

### Repository Interfaces

#### `lib/repositories/conversation-repository.ts`

```typescript
import type { Conversation, ConversationListOptions } from "@/lib/types/chat";

export interface ConversationInsert {
  title: string;
  created_by: string;
  team_id: string | null;
}

export interface ConversationUpdate {
  title?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
}

export interface ConversationRepository {
  create(data: ConversationInsert): Promise<Conversation>;
  list(userId: string, teamId: string | null, options: ConversationListOptions): Promise<Conversation[]>;
  getById(id: string): Promise<Conversation | null>;
  update(id: string, data: ConversationUpdate): Promise<Conversation>;
  delete(id: string): Promise<void>;
  updateTitle(id: string, title: string): Promise<void>;
}
```

#### `lib/repositories/message-repository.ts`

```typescript
import type { Message, MessageStatus, ChatSource } from "@/lib/types/chat";

export interface MessageInsert {
  conversation_id: string;
  parent_message_id?: string | null;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[] | null;
  status?: MessageStatus;
  metadata?: Record<string, unknown> | null;
}

export interface MessageUpdate {
  content?: string;
  sources?: ChatSource[] | null;
  status?: MessageStatus;
  metadata?: Record<string, unknown> | null;
}

export interface MessageRepository {
  create(data: MessageInsert): Promise<Message>;
  getByConversation(conversationId: string, limit: number, cursor?: string): Promise<Message[]>;
  update(id: string, data: MessageUpdate): Promise<Message>;
  delete(id: string): Promise<void>;
}
```

### Service Design

#### `lib/services/chat-service.ts`

The chat service composes `ConversationRepository` and `MessageRepository`. It is framework-agnostic (no HTTP imports).

```typescript
export function createChatService(
  conversationRepo: ConversationRepository,
  messageRepo: MessageRepository
) {
  return {
    createConversation(title: string, userId: string, teamId: string | null): Promise<Conversation>;
    getConversations(userId: string, teamId: string | null, options: ConversationListOptions): Promise<Conversation[]>;
    getConversation(id: string): Promise<Conversation | null>;
    updateConversation(id: string, updates: ConversationUpdate): Promise<Conversation>;
    deleteConversation(id: string): Promise<void>;
    getMessages(conversationId: string, limit: number, cursor?: string): Promise<Message[]>;
    createMessage(input: MessageInsert): Promise<Message>;
    updateMessage(id: string, updates: MessageUpdate): Promise<Message>;
    buildContextMessages(conversationId: string, tokenBudget?: number): Promise<Array<{ role: string; content: string }>>;
  };
}
```

`buildContextMessages()` fetches all messages for a conversation, walks backward from the most recent, and includes messages until the 80,000-token budget (char count / 4) is exceeded. Returns the included messages in chronological order (oldest first) formatted for the LLM.

#### `lib/services/database-query-service.ts`

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export type QueryAction =
  | "count_clients"
  | "count_sessions"
  | "sessions_per_client"
  | "sentiment_distribution"
  | "urgency_distribution"
  | "recent_sessions"
  | "client_list";

export interface QueryFilters {
  teamId: string | null;
  dateFrom?: string;
  dateTo?: string;
  clientName?: string;
}

export interface DatabaseQueryResult {
  action: QueryAction;
  data: Record<string, unknown>;
}

export async function executeQuery(
  supabase: SupabaseClient,
  action: QueryAction,
  filters: QueryFilters
): Promise<DatabaseQueryResult>;
```

Internally, each action maps to a handler function:

```typescript
const ACTION_MAP: Record<QueryAction, (supabase: SupabaseClient, filters: QueryFilters) => Promise<Record<string, unknown>>> = {
  count_clients: handleCountClients,
  count_sessions: handleCountSessions,
  sessions_per_client: handleSessionsPerClient,
  sentiment_distribution: handleSentimentDistribution,
  urgency_distribution: handleUrgencyDistribution,
  recent_sessions: handleRecentSessions,
  client_list: handleClientList,
};
```

Each handler builds a parameterized Supabase query. Team scoping is applied via the `scopeByTeam()` helper from `lib/repositories/supabase/scope-by-team.ts`. The `sentiment_distribution` and `urgency_distribution` queries read from `sessions.structured_json` — the extraction JSON stores `overallSentiment` and `urgencyLevel` at the top level. We query these with Supabase's `->>'key'` jsonb operator.

> **Data isolation:** The `queryDatabase` tool passes the RLS-protected anon client (not the service-role client) to `executeQuery()`. This ensures row-level security policies enforce both team scoping and personal workspace isolation (`created_by = auth.uid()`). The service-role client is only used for the embedding repository, which applies its own user-level filtering via the `filter_user_id` parameter in the `match_session_embeddings` RPC function.

#### `lib/services/ai-service.ts` — additions

Add `generateConversationTitle()`:

```typescript
/**
 * Fire-and-forget: generates a 5-8 word title for a new conversation
 * based on the user's first message. Uses generateText() with low maxTokens.
 * Returns the title string, or null if the call fails.
 */
export async function generateConversationTitle(
  firstMessage: string
): Promise<string | null>;
```

Uses `resolveModel()`, `GENERATE_TITLE_SYSTEM_PROMPT` from `lib/prompts/generate-title.ts`, `maxTokens: 30`. Wrapped in try/catch — returns `null` on failure (caller keeps the truncated fallback).

### Prompt Definitions

#### `lib/prompts/chat-prompt.ts`

```typescript
export const CHAT_SYSTEM_PROMPT = `You are a client feedback analyst...`;
export const CHAT_MAX_TOKENS = 4096;
```

The system prompt instructs the LLM to:

- Use `searchInsights` when the question is about what clients said, felt, or experienced. Pass a reworded query optimized for semantic search, not necessarily the user's exact words.
- Use `queryDatabase` when the question involves counts, lists, distributions, or factual lookups. Select the appropriate action and provide filter parameters.
- Use both tools when the question requires qualitative context combined with quantitative data.
- Answer only from tool results and conversation history. If tools return insufficient data, say so explicitly.
- Cite sources by referencing client name and session date. Quantitative answers from `queryDatabase` do not require citations.
- Never disclose tool names, chunk metadata, embedding scores, or internal system details.
- End the response with a JSON block in the format `<!--follow-ups:["question1","question2","question3"]-->` containing 2-3 follow-up questions. This block is parsed and stripped by the server before storage.

#### `lib/prompts/generate-title.ts`

```typescript
export const GENERATE_TITLE_SYSTEM_PROMPT = `Generate a concise 5-8 word title...`;
export const GENERATE_TITLE_MAX_TOKENS = 30;
```

The prompt instructs the LLM to produce a short descriptive title for a conversation based on the user's first message. No preamble, no quotes, just the title text.

### API Route Design

#### `POST /api/chat/send`

**File:** `app/api/chat/send/route.ts`

**Input validation (Zod):**

```typescript
const chatSendSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  message: z.string().min(1).max(10000),
});
```

> **Data isolation:** `teamId` is always resolved server-side from the `active_team_id` cookie via `getActiveTeamId()` — never accepted from the client request body. This prevents workspace spoofing and matches how all other API routes resolve workspace context.

**Flow:**

1. **Auth check** — `createClient()` + `getUser()`. Return 401 if unauthenticated.
2. **Validate body** — parse with `chatSendSchema`. Return 400 on failure.
3. **Resolve or create conversation:**
   - If `conversationId` is provided: verify it exists and belongs to the user.
   - If `conversationId` is null: create a new conversation with placeholder title (first 80 chars of `message`). Fire-and-forget `generateConversationTitle()` → on success, update the row.
4. **Insert user message** — `role: 'user'`, `status: 'completed'`.
5. **Insert placeholder assistant message** — `role: 'assistant'`, `status: 'streaming'`, `content: ''`.
6. **Build context** — `chatService.buildContextMessages()` with 80,000-token budget.
7. **Delegate to chat-stream-service** — pass all dependencies:

```typescript
import { createChatStream } from "@/lib/services/chat-stream-service";

const stream = createChatStream({
  model,
  modelLabel,
  chatService,
  embeddingRepo,
  anonClient: supabase,    // RLS-protected — used for queryDatabase tool
  userId: user.id,          // For personal workspace isolation in embedding search
  teamId,
  conversationId,
  assistantMessageId: assistantMessage.id,
  isNewConversation,
  contextMessages,
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Conversation-Id": conversationId,
  },
});
```

The `chat-stream-service` internally uses `streamText()` with `tool()` + `inputSchema: zodSchema(...)` for tool definitions and `stopWhen: stepCountIs(3)` for max tool iterations. It consumes the `fullStream` async iterable, emitting SSE events via the `ReadableStream` controller, and finalizes the assistant message on completion or failure.

8. **Error handling:** Wrap the entire flow in try/catch. If an error occurs before streaming starts (e.g., conversation not found, message insert fails), return a standard JSON error response (500). Once streaming has started, errors are caught inside the `ReadableStream.start()` callback in `chat-stream-service`, which marks the message as `failed` and emits an `error` SSE event.

### Forward Compatibility Notes

- **Part 3 (Chat Page UI):** The client will consume the SSE stream from `/api/chat/send`. The custom SSE protocol includes typed events: `status`, `delta`, `sources`, `follow_ups`, `done`, `error`. Part 3 uses manual `fetch` + `EventSource`-style parsing (not `useChat` — the custom event protocol requires manual handling). The `follow_ups` and `sources` events are rendered as chips below the assistant message.
- **Part 4 (Master Signal Panel):** No impact on the chat API. The master signal panel is a separate UI component on the same page.
- **Future `queryDatabase` actions:** Adding a new action requires: (1) add the action string to the `QueryAction` union, (2) write a handler function, (3) add it to `ACTION_MAP`, (4) add it to the Zod enum in the tool definition. No migration needed.
- **`parent_message_id`:** The column exists but is always null in v1. Future edit/retry will set it to create message tree branches. The repository and type definitions already support it.

### Implementation

#### Increment 2.1: Database Tables and Migrations

**What:** Create the `conversations` and `messages` tables with all columns, indexes, RLS policies, and triggers. Run migrations against Supabase. Regenerate TypeScript types.

**Steps:**

1. Create `docs/020-rag-chat/001-conversations.sql` with the conversations table DDL, indexes, RLS policies, and `updated_at` trigger.
2. Create `docs/020-rag-chat/002-messages.sql` with the messages table DDL, indexes, and RLS policies.
3. Create `docs/020-rag-chat/003-conversation-updated-at-trigger.sql` with the trigger that bumps `conversations.updated_at` on message insert.
4. Run all three migrations against the Supabase instance.
5. Regenerate Supabase TypeScript types (`supabase gen types typescript`).
6. Verify tables, indexes, RLS, and triggers via Supabase dashboard or SQL queries.

**Requirement coverage:** P2.R1 (conversations table), P2.R2 (conversations RLS), P2.R3 (messages table), P2.R4 (messages RLS).

#### Increment 2.2: Types, Repositories, and Chat Service

**What:** Create the TypeScript types, repository interfaces, Supabase adapters, and chat service. No API route yet — this is the data access layer.

**Steps:**

1. Create `lib/types/chat.ts` with all type definitions.
2. Create `lib/repositories/conversation-repository.ts` (interface).
3. Create `lib/repositories/message-repository.ts` (interface).
4. Create `lib/repositories/supabase/supabase-conversation-repository.ts` (adapter). Implements cursor-based pagination using `updated_at` for conversation listing (pinned first, then by `updated_at` desc). Maps snake_case DB rows to camelCase `Conversation` objects.
5. Create `lib/repositories/supabase/supabase-message-repository.ts` (adapter). Implements cursor-based pagination using `created_at` for message loading (newest first in query, reversed in service). Maps snake_case DB rows to camelCase `Message` objects.
6. Update `lib/repositories/index.ts` and `lib/repositories/supabase/index.ts` with re-exports.
7. Create `lib/services/chat-service.ts` with conversation/message CRUD and `buildContextMessages()`.
8. Verify: TypeScript check passes, all exports resolve.

**Requirement coverage:** P2.R5 (chat service methods), P2.R9 (context bounding via `buildContextMessages`).

#### Increment 2.3: Database Query Service

**What:** Create the `queryDatabase` tool's backend — the database query service with all initial actions.

**Steps:**

1. Create `lib/services/database-query-service.ts` with the `QueryAction` union, `QueryFilters` interface, `executeQuery()` function, and individual handler functions for all 7 initial actions.
2. Each handler: builds a Supabase query, applies team scoping via `scopeByTeam()`, applies optional date/client filters, returns typed results.
3. `sentiment_distribution`: query `sessions.structured_json->>'overallSentiment'`, group and count. Filter `WHERE deleted_at IS NULL`.
4. `urgency_distribution`: query `sessions.structured_json->>'urgencyLevel'`, group and count. Filter `WHERE deleted_at IS NULL`.
5. `sessions_per_client`: join sessions to clients, group by client name, count. Filter soft-deleted rows.
6. `recent_sessions`: fetch recent sessions joined to clients, return client name + date + sentiment. Limit 20.
7. `count_clients`, `count_sessions`, `client_list`: straightforward count/list queries with team scoping and soft-delete filtering.
8. Add logging (entry, exit, errors) to `executeQuery()`.
9. Verify: TypeScript check passes.

**Requirement coverage:** P2.R6 (queryDatabase tool — backend), P2.R8 (database query service design).

#### Increment 2.4: Prompts and Title Generation

**What:** Create the chat system prompt, the title generation prompt, and the `generateConversationTitle()` function in ai-service.

**Steps:**

1. Create `lib/prompts/chat-prompt.ts` with `CHAT_SYSTEM_PROMPT` and `CHAT_MAX_TOKENS`. The prompt covers tool usage instructions, citation rules, follow-up question generation format.
2. Create `lib/prompts/generate-title.ts` with `GENERATE_TITLE_SYSTEM_PROMPT` and `GENERATE_TITLE_MAX_TOKENS`.
3. Add `generateConversationTitle()` to `lib/services/ai-service.ts`. Uses `generateText()` with `resolveModel()`, the title prompt, `maxTokens: 30`. Try/catch returns `null` on failure.
4. Verify: TypeScript check passes.

**Requirement coverage:** P2.R10 (chat system prompt), P2.R11 (prompt in `lib/prompts/chat-prompt.ts`), P2.R1 (LLM title generation).

#### Increment 2.5: Streaming API Route

**What:** Create the `/api/chat/send` POST route that ties everything together — conversation resolution, message insertion, tool-augmented streaming, follow-up parsing, and resilience handling.

**Steps:**

1. Create `app/api/chat/send/route.ts`.
2. Implement auth check, Zod validation, conversation create-or-resolve, user message insert, assistant placeholder insert.
3. Implement `buildContextMessages()` call for history.
4. Implement `streamText()` with both tool definitions (`searchInsights` wrapping `retrieveRelevantChunks`, `queryDatabase` wrapping `executeQuery`), `maxSteps: 3`.
5. Implement `onFinish` callback: parse follow-ups from response, strip from content, update assistant message with final content, sources, status, metadata.
6. Implement `onError` callback: update assistant message to `status: 'failed'`.
7. Implement fire-and-forget title generation for new conversations.
8. Return `result.toDataStreamResponse()`.
9. Add comprehensive logging: route entry, conversation resolved/created, messages inserted, stream started, tools called, stream completed/errored.
10. Verify: TypeScript check passes. Manual test with `curl` or Postman to confirm SSE stream.

**Requirement coverage:** P2.R6 (tool use flow), P2.R7 (full API route flow), P2.R10 (follow-up questions), P2.R12 (server-side resilience).

#### Increment 2.6: Cleanup and Audit

**What:** End-of-part audit across all files created/modified in Part 2.

**Steps:**

1. Run `npx tsc --noEmit` for a full type check.
2. Verify all file references in the TRD exist in the codebase.
3. SRP check: each file, function, and service does one thing.
4. DRY check: no duplicated patterns across repositories or services.
5. Logging check: all service functions and the API route log entry, exit, and errors.
6. Dead code check: no unused imports, variables, or functions.
7. Convention check: naming, exports, import order, TypeScript strictness.
8. Verify all PRD acceptance criteria for Part 2 are met.
9. Update `ARCHITECTURE.md` — add new files to file map, update Current State, add new tables to Data Model section, add any new env vars.
10. Update `CHANGELOG.md` with Part 2 deliverables.

**Requirement coverage:** All P2.R1–P2.R12. End-of-part audit.

---

## Part 3: Chat Page UI

> Implements **P3.R1–P3.R23** from PRD-020.

### Overview

Build the `/chat` route with a two-panel layout: a conversation list sidebar on the left and the main chat area on the right. The page consumes the Part 2 streaming API via SSE, renders messages with `react-virtuoso` for virtualized infinite scroll, and manages conversation lifecycle (create, rename, pin, archive). No new database tables — Part 3 is a pure frontend implementation that calls the existing Part 2 services and API routes, plus new thin CRUD routes for conversation management.

### Technical Decisions

1. **`react-virtuoso` for the message thread.** The message list uses `react-virtuoso`'s `Virtuoso` component in reverse mode (`firstItemIndex` shifting pattern). When the user scrolls upward and hits the sentinel, the next 50 messages are fetched and prepended by decrementing `firstItemIndex`. Virtuoso handles scroll position preservation natively. Only visible items plus an overscan buffer (~5 messages) are rendered in the DOM. This performs well at any conversation length without manual `scrollHeight` calculations.

2. **`react-markdown` + `remark-gfm` for assistant messages.** Already installed in the project. Wrap in a `<MemoizedMarkdown>` component that uses `React.memo` with a content equality check to avoid re-rendering the entire message tree on each streaming delta. During streaming, only the actively-streaming message re-renders — all completed messages above it are memoized.

3. **Custom SSE client hook (`useChat`).** A custom hook in `lib/hooks/use-chat.ts` manages the SSE connection to `/api/chat/send`. It does NOT use the Vercel AI SDK's `useChat` hook because our Part 2 API returns a custom SSE protocol with typed events (`status`, `delta`, `sources`, `follow_ups`, `done`, `error`) that the SDK's hook doesn't understand. The custom hook uses `fetch` + `ReadableStream` reader to consume the SSE, dispatches events into React state, and exposes: `sendMessage()`, `cancelStream()`, `isStreaming`, `streamingContent`, `statusText`, `sources`, `followUps`, and `error`.

4. **Conversation state management via `useConversations` hook.** A custom hook in `lib/hooks/use-conversations.ts` manages the conversation list, active conversation selection, and CRUD operations. It holds two separate lists: `activeConversations` and `archivedConversations`, each with their own pagination cursor. The archive toggle switches which list is displayed. All mutations (rename, pin, archive, unarchive) optimistically update the local list and roll back on API failure.

5. **New CRUD API routes for conversation management.** Part 2 only created `/api/chat/send`. Part 3 adds:
   - `GET /api/chat/conversations` — list conversations (paginated, filterable by archived/active, searchable by title)
   - `PATCH /api/chat/conversations/[id]` — update title, is_pinned, is_archived
   - `GET /api/chat/conversations/[id]/messages` — list messages (paginated)
   These are thin route handlers: auth → validate → call chat-service → return JSON. No business logic in the routes.

6. **Co-located `_components/` under `app/chat/`.** Following the capture page pattern, all chat-specific components live in `app/chat/_components/`. Shared components (if any emerge) are extracted to `components/`. The page file (`app/chat/page.tsx`) is a thin server component that renders `<ChatPageContent />`.

7. **Conversation list sidebar as a collapsible panel.** On desktop, the conversation list is a fixed-width panel (280px) on the left of the chat area, collapsible via a toggle button to icon-only width (0px — fully hidden, the chat area takes full width). The collapse state is stored in a `useState` — not persisted. On mobile, the conversation list is hidden by default and opens as a Sheet overlay (reusing the existing shadcn Sheet component from Part 1).

8. **Archive toggle with CSS transitions.** The archive toggle icon in the conversation list header swaps the displayed list between active and archived conversations. The transition uses a `opacity` + `transform: translateY` CSS animation on the list container: the current list fades down and out, then the new list fades up and in. A 150ms duration keeps it snappy. The toggle icon rotates or changes (e.g., `Archive` ↔ `ArchiveRestore` from lucide-react) to indicate the current view.

9. **Streaming state machine.** The chat area's state is a discriminated union:
   - `idle` — no active generation, input enabled, send button shown
   - `streaming` — generation in progress, input editable (type-ahead), stop button shown, streaming content updating
   - `error` — last generation failed, retry button shown on the message, input enabled
   This is managed inside `useChat` as a single `streamState` variable, not multiple booleans.

10. **Citation preview modal reuses `StructuredSignalView`.** Clicking a citation chip opens a `Dialog` that fetches the source session's structured JSON via the existing `GET /api/sessions/[id]` route and renders it using the existing `StructuredSignalView` component from `components/capture/structured-signal-view.tsx`. No new component needed for the signal rendering — just a dialog wrapper.

11. **Copy to clipboard via `navigator.clipboard.writeText()`.** Each message has a copy button in a hover-visible actions bar. For assistant messages, copy the raw markdown (the `content` field, not the rendered HTML). For user messages, copy the plain text. Show a "Copied" toast via the existing `sonner` toast setup.

12. **In-conversation search is client-side only.** A search bar in the chat header (triggered by a search icon or Cmd+F) filters and highlights matches across all loaded messages. Uses a simple `text.toLowerCase().includes(query)` check. Matching positions are highlighted with a `<mark>` wrapper injected during markdown rendering. Navigation arrows cycle through matches by scrolling to each one via `react-virtuoso`'s `scrollToIndex()`.

13. **`AbortController` for stream cancellation.** The `useChat` hook creates an `AbortController` when starting a `fetch` to `/api/chat/send`. The Stop button calls `controller.abort()`, which closes the fetch and the SSE stream. The hook then sends a `PATCH` to update the assistant message status to `cancelled` with whatever partial content was accumulated. This is a clean cancellation — no orphaned server processes because the server's `ReadableStream` detects the closed connection and stops.

### New API Routes

#### `GET /api/chat/conversations`

**File:** `app/api/chat/conversations/route.ts`

Query parameters:
- `archived` — boolean string (`"true"` or `"false"`), default `"false"`
- `search` — optional title substring filter
- `limit` — number, default 30
- `cursor` — optional `updated_at` ISO string for pagination

Returns: `{ conversations: Conversation[], hasMore: boolean }`

#### `PATCH /api/chat/conversations/[id]`

**File:** `app/api/chat/conversations/[id]/route.ts`

Body (Zod-validated):
```typescript
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  is_pinned: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});
```

Returns: `{ conversation: Conversation }`

#### `GET /api/chat/conversations/[id]/messages`

**File:** `app/api/chat/conversations/[id]/messages/route.ts`

Query parameters:
- `limit` — number, default 50
- `cursor` — optional `created_at` ISO string for pagination

Returns: `{ messages: Message[], hasMore: boolean }`

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/chat/page.tsx` | **Create** | Thin server component — metadata + `<ChatPageContent />` |
| `app/chat/_components/chat-page-content.tsx` | **Create** | Client coordinator — composes conversation sidebar + chat area, manages active conversation |
| `app/chat/_components/conversation-sidebar.tsx` | **Create** | Conversation list panel — header (new chat, search, archive toggle), list with infinite scroll, context menus |
| `app/chat/_components/conversation-item.tsx` | **Create** | Single conversation row — title, timestamp, pin indicator, context menu trigger |
| `app/chat/_components/conversation-context-menu.tsx` | **Create** | Right-click / overflow context menu — Rename, Pin/Unpin, Archive/Unarchive |
| `app/chat/_components/rename-dialog.tsx` | **Create** | Controlled dialog for renaming a conversation title |
| `app/chat/_components/chat-area.tsx` | **Create** | Main chat area — composes header, message thread, input; handles empty state and archived read-only state |
| `app/chat/_components/chat-header.tsx` | **Create** | Chat area header — conversation title, search toggle, collapse toggle |
| `app/chat/_components/message-thread.tsx` | **Create** | `react-virtuoso` Virtuoso wrapper — reverse mode, infinite scroll upward, auto-scroll on new messages |
| `app/chat/_components/message-bubble.tsx` | **Create** | Single message rendering — user vs assistant styling, markdown for assistant, status indicators, actions bar |
| `app/chat/_components/message-actions.tsx` | **Create** | Hover-visible actions bar — copy to clipboard button (+ future actions) |
| `app/chat/_components/streaming-message.tsx` | **Create** | Active streaming message — status text display, incremental markdown, blinking cursor indicator |
| `app/chat/_components/message-status-indicator.tsx` | **Create** | Status badges for failed/cancelled/incomplete messages with Retry button |
| `app/chat/_components/citation-chips.tsx` | **Create** | Source citation pills below assistant messages — client name + date |
| `app/chat/_components/citation-preview-dialog.tsx` | **Create** | Dialog wrapper around `StructuredSignalView` for viewing a source session |
| `app/chat/_components/follow-up-chips.tsx` | **Create** | Suggested follow-up question pills — click-to-insert into textarea |
| `app/chat/_components/starter-questions.tsx` | **Create** | Empty state — hardcoded global starter question chips |
| `app/chat/_components/chat-input.tsx` | **Create** | Auto-expanding textarea with Send/Stop button, Enter/Shift+Enter handling |
| `app/chat/_components/chat-search-bar.tsx` | **Create** | In-conversation text search with highlight and navigation arrows |
| `app/chat/_components/memoized-markdown.tsx` | **Create** | `React.memo`-wrapped `react-markdown` + `remark-gfm` renderer |
| `lib/hooks/use-chat.ts` | **Create** | Custom SSE hook — sendMessage, cancelStream, streaming state, status, sources, follow-ups |
| `lib/hooks/use-conversations.ts` | **Create** | Conversation list management — CRUD, pagination, archive toggle, optimistic updates |
| `app/api/chat/conversations/route.ts` | **Create** | GET — list conversations (paginated, filterable) |
| `app/api/chat/conversations/[id]/route.ts` | **Create** | PATCH — update conversation (title, pin, archive) |
| `app/api/chat/conversations/[id]/messages/route.ts` | **Create** | GET — list messages for a conversation (paginated) |

### Component Hierarchy

```
ChatPageContent (client coordinator)
├── ConversationSidebar
│   ├── Header: NewChatButton + SearchInput + ArchiveToggle
│   ├── ConversationItem[] (infinite scroll list)
│   │   └── ConversationContextMenu (per item)
│   └── RenameDialog (portal, controlled)
├── ChatArea
│   ├── ChatHeader (title, search toggle, sidebar collapse)
│   ├── ChatSearchBar (conditional, in-conversation search)
│   ├── StarterQuestions (empty state only)
│   ├── MessageThread (react-virtuoso)
│   │   ├── MessageBubble[] (completed messages)
│   │   │   ├── MemoizedMarkdown (assistant only)
│   │   │   ├── CitationChips (assistant only, if sources)
│   │   │   ├── FollowUpChips (assistant only, if follow-ups, last message only)
│   │   │   ├── MessageActions (copy button, hover-visible)
│   │   │   └── MessageStatusIndicator (failed/cancelled/incomplete, with Retry)
│   │   └── StreamingMessage (active streaming, if isStreaming)
│   │       ├── StatusText (ephemeral: "Searching...", "Generating...")
│   │       └── MemoizedMarkdown (incremental content)
│   ├── ArchivedBar (if conversation is archived — "Unarchive to continue")
│   └── ChatInput (if not archived)
│       ├── Textarea (auto-expanding)
│       └── SendButton | StopButton
└── CitationPreviewDialog (portal, controlled)
```

### Hook Interfaces

#### `lib/hooks/use-chat.ts`

```typescript
interface UseChatOptions {
  conversationId: string | null;
  teamId: string | null;
  onConversationCreated?: (id: string, isNew: boolean) => void;
  onTitleGenerated?: (id: string, title: string) => void;
}

interface UseChatReturn {
  /** Send a message. If conversationId is null, creates a new conversation. */
  sendMessage: (content: string) => Promise<void>;
  /** Cancel the in-progress stream. */
  cancelStream: () => void;
  /** Retry the latest failed/stale assistant message. */
  retryLastMessage: () => Promise<void>;
  /** Current streaming state. */
  streamState: "idle" | "streaming" | "error";
  /** Streaming content being accumulated (empty when idle). */
  streamingContent: string;
  /** Ephemeral status text from tool execution ("Searching...", etc.). */
  statusText: string | null;
  /** Sources from the latest completed stream (cleared on new send). */
  latestSources: ChatSource[] | null;
  /** Follow-up questions from the latest completed stream. */
  latestFollowUps: string[];
  /** Error message if streamState is "error". */
  error: string | null;
}
```

#### `lib/hooks/use-conversations.ts`

```typescript
interface UseConversationsOptions {
  teamId: string | null;
  activeConversationId: string | null;
}

interface UseConversationsReturn {
  /** Active (non-archived) conversations, paginated. */
  conversations: Conversation[];
  /** Archived conversations, paginated (loaded separately). */
  archivedConversations: Conversation[];
  /** Whether viewing archived or active list. */
  isArchiveView: boolean;
  /** Toggle between active and archived views. */
  toggleArchiveView: () => void;
  /** Loading state for initial fetch. */
  isLoading: boolean;
  /** Whether more conversations can be fetched. */
  hasMore: boolean;
  /** Fetch the next page of conversations (active or archived). */
  fetchMore: () => Promise<void>;
  /** Client-side title filter. */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Filtered conversations (applies searchQuery to current view). */
  filteredConversations: Conversation[];
  /** CRUD operations (optimistic). */
  renameConversation: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  archiveConversation: (id: string) => Promise<void>;
  unarchiveConversation: (id: string) => Promise<void>;
  /** Add a newly created conversation to the top of the active list. */
  prependConversation: (conversation: Conversation) => void;
  /** Update a conversation in-place (e.g., title from async LLM generation). */
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
}
```

### Forward Compatibility Notes

- **Part 4 (Master Signal Panel):** The `ChatArea` component's layout accommodates a right-side sliding panel. The panel overlays the chat area (via `position: fixed` + z-index), so no layout changes are needed in Part 3 — Part 4 adds the panel component and a trigger button.
- **Future branching/retry on past messages:** The `MessageBubble` component accepts a `canRetry` prop that is only `true` for the latest assistant message. Future branching changes this to `true` for any message, and the retry logic in `useChat` evolves to support `parent_message_id`.

### Implementation

#### Increment 3.1: Page Shell, API Routes, and Hooks

**What:** Create the `/chat` route, the conversation CRUD API routes, and the two core hooks (`useConversations`, `useChat`). Install `react-virtuoso`. This increment produces the data layer and page skeleton — no styled UI components yet.

**Steps:**

1. Install `react-virtuoso` (`npm install react-virtuoso`).
2. Create `app/chat/page.tsx` — thin server component with metadata, renders `<ChatPageContent />`.
3. Create `app/chat/_components/chat-page-content.tsx` — client component shell with `useConversations` + `useChat` wiring. Renders placeholder divs for sidebar and chat area.
4. Create `app/api/chat/conversations/route.ts` — GET handler: auth, parse query params, call `chatService.getConversations()`, return JSON with `hasMore` flag.
5. Create `app/api/chat/conversations/[id]/route.ts` — PATCH handler: auth, Zod validate body, call `chatService.updateConversation()`, return updated conversation.
6. Create `app/api/chat/conversations/[id]/messages/route.ts` — GET handler: auth, parse query params, call `chatService.getMessages()`, reverse for chronological order, return JSON with `hasMore` flag.
7. Create `lib/hooks/use-conversations.ts` — conversation list management with dual-list (active/archived), pagination, search, optimistic CRUD.
8. Create `lib/hooks/use-chat.ts` — SSE streaming hook with `fetch` + `ReadableStream` reader, `AbortController` for cancellation, streaming state machine, retry support.
9. Verify: TypeScript check passes. `/chat` route loads without errors.

**Requirement coverage:** P3.R1 (route exists), P3.R5 (conversation list loading — data layer), P3.R6 (message loading — data layer), P3.R14 (cancel via AbortController — data layer).

#### Increment 3.2: Conversation Sidebar

**What:** Build the conversation sidebar UI — list, search, new chat button, archive toggle, context menus, rename dialog.

**Steps:**

1. Create `app/chat/_components/conversation-sidebar.tsx` — panel layout with header and scrollable list. Collapsible on desktop (280px ↔ hidden), Sheet on mobile.
2. Create `app/chat/_components/conversation-item.tsx` — single row: truncated title, `formatRelativeTime()` timestamp, pin icon, overflow menu trigger.
3. Create `app/chat/_components/conversation-context-menu.tsx` — uses shadcn `DropdownMenu`. Items: Rename, Pin/Unpin, Archive/Unarchive. No Delete.
4. Create `app/chat/_components/rename-dialog.tsx` — controlled Dialog with text input, save/cancel.
5. Wire archive toggle icon in sidebar header — smooth list transition with CSS `opacity` + `translateY` animation (150ms).
6. Wire conversation selection: clicking a conversation sets `activeConversationId` in `ChatPageContent`.
7. Wire New Chat button: clears `activeConversationId` to null, chat area shows empty state.
8. Wire search input: drives `useConversations.setSearchQuery()`.
9. Verify: conversations load and display, context menu actions work, archive toggle switches views smoothly.

**Requirement coverage:** P3.R2 (conversation list display), P3.R3 (sidebar actions), P3.R4 (collapsible sidebar, mobile drawer), P3.R5 (conversation list pagination — UI), P3.R19 (auto-title display), P3.R20 (pin/unpin), P3.R21 (archive/unarchive).

#### Increment 3.3: Chat Area — Message Display and Virtualized Thread

**What:** Build the main chat area with the `react-virtuoso` message thread, message bubbles, markdown rendering, and auto-scroll behaviour.

**Steps:**

1. Create `app/chat/_components/chat-area.tsx` — layout: header + thread + input. Handles empty state (no conversation selected or new conversation) and archived state (read-only).
2. Create `app/chat/_components/chat-header.tsx` — shows conversation title, search icon toggle, sidebar collapse toggle.
3. Create `app/chat/_components/memoized-markdown.tsx` — `React.memo`-wrapped `ReactMarkdown` with `remarkGfm`. Equality check on `content` string. Applies `prose` CSS classes from `PROSE_CLASSES` constant.
4. Create `app/chat/_components/message-bubble.tsx` — user messages: right-aligned, coloured background. Assistant messages: left-aligned, neutral background, rendered with `MemoizedMarkdown`. Accepts `message`, `isLatest`, `canRetry` props.
5. Create `app/chat/_components/message-thread.tsx` — `Virtuoso` component in reverse mode. Initial load: fetch 50 messages, set `firstItemIndex = 10000 - messages.length`. On scroll-up past sentinel: fetch next 50, decrement `firstItemIndex`, prepend to list. `followOutput="auto"` for auto-scroll on new messages, disabled when user scrolls up (use `atBottomStateChange` callback).
6. Create `app/chat/_components/message-actions.tsx` — hover-visible bar with copy-to-clipboard button. Uses `navigator.clipboard.writeText()` + sonner toast.
7. Wire message loading: selecting a conversation triggers `useChat` context switch and initial message fetch via `GET /api/chat/conversations/[id]/messages`.
8. Verify: messages render correctly, virtualization works (check DOM node count), infinite scroll fetches older messages, auto-scroll follows streaming.

**Requirement coverage:** P3.R6 (virtualized infinite scroll), P3.R7 (message display styling), P3.R8 (markdown rendering), P3.R9 (auto-scroll), P3.R16b (copy to clipboard).

#### Increment 3.4: Streaming, Status Messages, and Stop/Retry

**What:** Wire the SSE streaming into the message thread — status messages, streaming content, blinking cursor, stop button, and retry on failure.

**Steps:**

1. Create `app/chat/_components/streaming-message.tsx` — displays ephemeral status text (fades between statuses) and incrementally-growing markdown content. Shows a blinking cursor CSS animation while streaming.
2. Create `app/chat/_components/message-status-indicator.tsx` — renders status badges for `failed`, `cancelled`, and stale `streaming` messages. Shows "Retry" button on the latest assistant message if it has a terminal/stale status.
3. Create `app/chat/_components/chat-input.tsx` — auto-expanding `<textarea>` (rows=1, max-rows=6) with Send button (disabled during streaming) and Stop button (visible during streaming). Enter sends, Shift+Enter newlines. Disabled (with unarchive bar) when conversation is archived.
4. Wire `useChat.sendMessage()` to `ChatInput`. On send: optimistically add user message to thread, call API, render `StreamingMessage` as the last item in the thread.
5. Wire `useChat.cancelStream()` to Stop button. On cancel: abort fetch, update message to `cancelled`, switch to idle state.
6. Wire `useChat.retryLastMessage()` to Retry button. On retry: re-send the preceding user message, create new assistant message.
7. Wire `onConversationCreated` callback: when a new conversation is created (first message in empty state), prepend it to the conversation list and set it as active.
8. Wire `onTitleGenerated` callback: when the async title arrives via periodic refetch or conversation list reload, update the sidebar entry.
9. Verify: full streaming flow works end-to-end, stop cancels cleanly, retry regenerates, status messages display and fade.

**Requirement coverage:** P3.R10 (ephemeral status messages), P3.R11 (streaming display), P3.R12 (reconnect/retry), P3.R13 (input behaviour), P3.R14 (stop button/cancel), P3.R22 (no delete).

#### Increment 3.5: Citations, Follow-ups, and Starter Questions

**What:** Add citation chips, follow-up suggestion chips, starter questions in empty state, and the citation preview modal.

**Steps:**

1. Create `app/chat/_components/citation-chips.tsx` — renders `sources` array as pill-shaped chips (client name — formatted date). Clickable: opens citation preview dialog.
2. Create `app/chat/_components/citation-preview-dialog.tsx` — Dialog that takes a `sessionId`, fetches the session via `GET /api/sessions/[id]`, and renders `StructuredSignalView` inside the dialog body. Loading skeleton while fetching.
3. Create `app/chat/_components/follow-up-chips.tsx` — renders follow-up questions as clickable pills below citations. On click: inserts the question text into the `ChatInput` textarea (via a callback prop or ref).
4. Create `app/chat/_components/starter-questions.tsx` — empty-state component with 4 hardcoded question chips. On click: calls `sendMessage()` with the question text.
5. Wire citations into `MessageBubble` — display below assistant content if `sources` is non-null.
6. Wire follow-ups into `MessageBubble` — display below citations only on the latest assistant message (ephemeral, from `useChat.latestFollowUps`).
7. Wire starter questions into `ChatArea` empty state.
8. Verify: citations display, preview modal loads session data, follow-ups insert into textarea, starter questions send messages.

**Requirement coverage:** P3.R15 (citation chips), P3.R16 (citation preview modal), P3.R17 (starter questions), P3.R18 (follow-up suggestions).

#### Increment 3.6: In-Conversation Search

**What:** Add the in-conversation search bar with text highlighting and match navigation.

**Steps:**

1. Create `app/chat/_components/chat-search-bar.tsx` — search input with match count display, up/down navigation arrows, close button. Triggered by search icon in `ChatHeader` or keyboard shortcut.
2. Implement search logic in `ChatArea`: filter loaded messages for `query` matches, compute match indices, track `currentMatchIndex`.
3. Highlight matches in `MemoizedMarkdown` — pass `searchQuery` prop; when active, wrap matching text spans in `<mark>` elements.
4. Navigation: up/down arrows cycle through `currentMatchIndex`, calling `react-virtuoso`'s `scrollToIndex()` to jump to the message containing the current match.
5. Close search: clear query, remove highlights, restore normal scroll position.
6. Verify: search highlights work across multiple messages, navigation cycles correctly, closing clears state.

**Requirement coverage:** P3.R23 (in-conversation search).

#### Increment 3.7: Archive Read-Only, Polish, and Cleanup Audit

**What:** Implement archived conversation read-only mode, UI polish, responsive design, and end-of-part audit.

**Steps:**

1. In `ChatArea`: when the active conversation's `isArchived === true`, replace `ChatInput` with an "Unarchive to continue this conversation" bar containing an Unarchive button. Wire button to `useConversations.unarchiveConversation()`.
2. Polish: verify all transitions/animations are smooth (archive toggle, message fade-in, streaming cursor), consistent spacing and typography with design tokens, responsive layout on mobile.
3. Mobile: verify conversation sidebar opens as Sheet overlay, chat area takes full width, input is usable on small screens.
4. Run `npx tsc --noEmit` for full type check.
5. SRP check: each component does one thing, no oversized components.
6. DRY check: extract any duplicated patterns.
7. Dead code check: no unused imports or components.
8. Convention check: naming, exports, import order, TypeScript strictness, design token adherence.
9. Verify all PRD Part 3 acceptance criteria are met (29 items).
10. Update `ARCHITECTURE.md` — add new files, update Current State.
11. Update `CHANGELOG.md` with Part 3 deliverables.

**Requirement coverage:** All P3.R1–P3.R23. End-of-part audit.
