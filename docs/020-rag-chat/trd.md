# TRD-020: RAG Chat Interface

> **Status:** Draft (Parts 1–2 detailed)
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

2. **`streamText` with `maxSteps` for autonomous tool calling.** The Vercel AI SDK v6 `streamText()` function supports a `tools` parameter with Zod-typed tool definitions and a `maxSteps` parameter that lets the model call tools and then generate a final text response in a single streaming invocation. We set `maxSteps: 3` (tool calls + final generation). This avoids manual orchestration of tool calls — the SDK handles the tool call → result → continuation loop automatically. The streamed response includes both tool call events and text delta events.

3. **SSE via `toDataStreamResponse()`.** The Vercel AI SDK's `streamText()` result exposes `toDataStreamResponse()` which returns a standard `Response` with the AI SDK's data stream protocol. The client will use the `useChat` hook or manual `EventSource`/`fetch` with the AI SDK's stream parsing. Tool call events, text deltas, and finish events are all multiplexed over this single stream. Custom SSE events for status messages (e.g., "Searching across N sessions...") are sent via the `sendDataStreamEvent()` callback within tool execution handlers.

4. **Tool definitions as Zod schemas.** Both `searchInsights` and `queryDatabase` tools are defined as Zod-typed objects passed to `streamText({ tools })`. The SDK validates tool call arguments against the schema before invoking the `execute` function. This gives us type-safe tool parameters with zero manual parsing.

5. **`queryDatabase` uses an action map, not raw SQL.** The `DatabaseQueryService` maps action strings (e.g., `count_clients`, `sessions_per_client`) to pre-built parameterized Supabase queries. The LLM never sees or generates SQL. Adding a new action is a single function + map entry — no schema migration. All queries scope by `team_id` using the existing `scopeByTeam()` helper.

6. **Fire-and-forget LLM title generation.** When a new conversation is created, the route inserts the conversation with a truncated placeholder title (first 80 chars), then fires an async `generateConversationTitle()` call that does not block the response stream. The function uses `generateText()` with a short prompt and low `maxTokens` (30). On success, it updates the conversation row. On failure, the placeholder stays. The client receives the conversation ID immediately and can poll or react to the title update on next load.

7. **Conversation context bounding.** The chat route builds the message history by walking backward from the most recent message, accumulating content until an 80,000-token budget (approximated as `characterCount / 4`) would be exceeded. Older messages are dropped. This is a simple truncation — no summarization of dropped context in v1.

8. **Server-side generation resilience.** The route handler inserts the assistant message with `status: 'streaming'` before starting the LLM call. If the stream completes normally, it updates to `status: 'completed'` with full content and sources. If the stream errors, it updates to `status: 'failed'`. If the server is torn down mid-stream (deployment, timeout), the row remains as `status: 'streaming'` with whatever partial content was last flushed. Part 3's client handles reconnection by detecting `streaming` status messages on load.

9. **Follow-up questions in the response.** The system prompt instructs the LLM to end its response with a JSON block containing 2-3 follow-up questions. The route's `onFinish` callback parses this block from the completed text, strips it from the stored content, and sends it as a separate data stream annotation. This avoids polluting the rendered message with raw JSON. If parsing fails (LLM didn't follow the format), no follow-ups are sent — graceful degradation.

10. **`sources` derived from `searchInsights` tool results.** When the `searchInsights` tool returns results, the route captures the citation data (sessionId, clientName, sessionDate, chunkText, chunkType). After stream completion, these are written to the assistant message's `sources` jsonb column and sent as a data stream annotation for the client to render as citation chips.

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
| `app/api/chat/send/route.ts` | **Create** | POST — streaming chat route with tool calling, SSE via `toDataStreamResponse()` |
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
  teamId: z.string().uuid().nullable(),
});
```

**Flow:**

1. **Auth check** — `createClient()` + `getUser()`. Return 401 if unauthenticated.
2. **Validate body** — parse with `chatSendSchema`. Return 400 on failure.
3. **Resolve or create conversation:**
   - If `conversationId` is provided: verify it exists and belongs to the user.
   - If `conversationId` is null: create a new conversation with placeholder title (first 80 chars of `message`). Fire-and-forget `generateConversationTitle()` → on success, update the row.
4. **Insert user message** — `role: 'user'`, `status: 'completed'`.
5. **Insert placeholder assistant message** — `role: 'assistant'`, `status: 'streaming'`, `content: ''`.
6. **Build context** — `chatService.buildContextMessages()` with 80,000-token budget.
7. **Stream with tools** — call `streamText()`:

```typescript
import { streamText, tool } from "ai";
import { z } from "zod";

const result = streamText({
  model: resolveModel().model,
  system: CHAT_SYSTEM_PROMPT,
  messages: contextMessages,
  tools: {
    searchInsights: tool({
      description: "Search client feedback sessions for qualitative insights",
      parameters: z.object({
        query: z.string().describe("Semantic search query"),
        filters: z.object({
          clientName: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          chunkTypes: z.array(z.string()).optional(),
        }).optional(),
      }),
      execute: async ({ query, filters }) => {
        // Send status event: "Searching across sessions..."
        const results = await retrieveRelevantChunks(query, {
          teamId,
          clientName: filters?.clientName,
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          chunkTypes: filters?.chunkTypes as ChunkType[],
        }, embeddingRepo);
        // Capture results for sources
        collectedSources.push(...results.map(toSource));
        return results;
      },
    }),
    queryDatabase: tool({
      description: "Query the database for quantitative data about clients and sessions",
      parameters: z.object({
        action: z.enum([
          "count_clients", "count_sessions", "sessions_per_client",
          "sentiment_distribution", "urgency_distribution",
          "recent_sessions", "client_list",
        ]),
        filters: z.object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          clientName: z.string().optional(),
        }).optional(),
      }),
      execute: async ({ action, filters }) => {
        // Send status event: "Looking up your data..."
        return executeQuery(serviceClient, action, {
          teamId,
          ...filters,
        });
      },
    }),
  },
  maxSteps: 3,
  maxTokens: CHAT_MAX_TOKENS,
  onFinish: async ({ text, toolCalls }) => {
    // Parse follow-up questions from the response
    const { cleanContent, followUps } = parseFollowUps(text);
    // Update assistant message: content, sources, status, metadata
    await messageRepo.update(assistantMessageId, {
      content: cleanContent,
      sources: collectedSources.length > 0 ? collectedSources : null,
      status: "completed",
      metadata: {
        model: modelLabel,
        toolsCalled: toolCalls?.map(tc => tc.toolName) ?? [],
      },
    });
  },
  onError: async () => {
    await messageRepo.update(assistantMessageId, { status: "failed" });
  },
});

return result.toDataStreamResponse();
```

8. **Error handling:** Wrap the entire flow in try/catch. If an error occurs before streaming starts (e.g., conversation not found, message insert fails), return a standard JSON error response. Once streaming has started, errors are handled by the `onError` callback.

### Forward Compatibility Notes

- **Part 3 (Chat Page UI):** The client will consume the SSE stream from `/api/chat/send`. The data stream protocol from `toDataStreamResponse()` includes text deltas, tool call events, and annotations. Part 3 can use the Vercel AI SDK's `useChat` hook or manual stream parsing. The `follow_ups` and `sources` are sent as data stream annotations that Part 3 renders as chips.
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
