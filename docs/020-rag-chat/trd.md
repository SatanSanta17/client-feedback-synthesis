# TRD-020: RAG Chat Interface

> **Status:** Draft (Part 1 detailed)
> **PRD:** `docs/020-rag-chat/prd.md` (approved)
> **Mirrors:** PRD Parts 1–4. Each part is written and reviewed one at a time. Parts 2–4 will be added after their preceding parts are implemented.

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
