# TRD-022: Layout Cleanup

## Part 1 — Settings Accordion in Sidebar + Shared Page Header

This part covers P1.R1 through P1.R6 from the PRD.

---

### Increment 1: Shared `PageHeader` component

**What:** Create a reusable `PageHeader` component and adopt it on Dashboard and Capture pages.

**Files changed:**

| File | Action |
|------|--------|
| `components/layout/page-header.tsx` | **Create** — new shared component |
| `app/dashboard/page.tsx` | **Modify** — replace inline `<h1>` with `<PageHeader>` |
| `app/capture/page.tsx` | **Modify** — add `<PageHeader>` above `<CapturePageContent>` |

**Component design:**

```tsx
// components/layout/page-header.tsx

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}
```

**Dashboard adoption (`app/dashboard/page.tsx`):**

Replace the inline `<h1 className="mb-6 text-2xl font-bold ...">Dashboard</h1>` with `<PageHeader title="Dashboard" />`. The outer wrapper div and `<DashboardContent />` remain unchanged.

**Capture adoption (`app/capture/page.tsx`):**

Add `<PageHeader title="Capture" className="w-full max-w-4xl" />` as the first child inside the wrapper div, above `<CapturePageContent />`. The `max-w-4xl` keeps alignment consistent with the form and table below it.

**Verify:**
- Dashboard and Capture pages render identical header typography.
- No visual regression on either page.

---

### Increment 2: Settings accordion in sidebar

**What:** Replace the "Settings" nav link with a collapsible accordion that reveals two sub-links. Accordion state resets on navigation.

**Files changed:**

| File | Action |
|------|--------|
| `components/layout/app-sidebar.tsx` | **Modify** — remove Settings from `NAV_ITEMS`, add accordion section |

**Implementation details:**

1. **Remove Settings from `NAV_ITEMS`.**
   Delete the Settings entry from the `NAV_ITEMS` array (lines 63–67). The array retains Dashboard, Capture, and Chat.

2. **Add `ChevronDown` to imports.**
   Import `ChevronDown` from `lucide-react` alongside the existing icon imports.

3. **Add accordion state to `SidebarContent`.**
   Add a `settingsOpen` / `onSettingsToggle` prop pair to `SidebarContentProps`. The state itself (`useState<boolean>(false)`) lives in `AppSidebar` and is passed down. This keeps `SidebarContent` stateless and allows both desktop and mobile instances to share or own their accordion state independently.

4. **Reset on navigation.**
   Inside `AppSidebar`, add a `useEffect` that watches `pathname` and calls `setSettingsOpen(false)` on change. This satisfies P1.R3.

5. **Define sub-link config.**

   ```ts
   const SETTINGS_ITEMS: { label: string; href: string }[] = [
     { label: "Team Management", href: "/settings/team" },
     { label: "Extraction Prompt", href: "/settings/prompts" },
   ];
   ```

6. **Render accordion between nav and bottom section.**
   Inside `SidebarContent`, after the `<nav>` block and before the bottom `<div>`, render the accordion:

   ```tsx
   {/* ---- Settings accordion ---- */}
   <div className="px-3 pb-2">
     <button
       type="button"
       onClick={onSettingsToggle}
       className={cn(
         "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
         isSettingsRouteActive
           ? "text-[var(--brand-primary)]"
           : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
       )}
     >
       <Settings className="size-5 shrink-0" />
       <span className={cn(/* same show/hide logic as other labels */)}>
         Settings
       </span>
       {showLabels && (
         <ChevronDown
           className={cn(
             "ml-auto size-4 transition-transform duration-200",
             settingsOpen && "rotate-180"
           )}
         />
       )}
     </button>

     {settingsOpen && showLabels && (
       <div className="mt-1 flex flex-col gap-0.5 pl-5">
         {SETTINGS_ITEMS.map((item) => {
           const isActive = pathname.startsWith(item.href);
           return (
             <Link
               key={item.href}
               href={item.href}
               onClick={onNavigate}
               className={cn(
                 "rounded-md px-3 py-1.5 text-sm transition-colors",
                 isActive
                   ? "bg-[var(--brand-primary-light)] font-medium text-[var(--brand-primary)]"
                   : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
               )}
             >
               {item.label}
             </Link>
           );
         })}
       </div>
     )}
   </div>
   ```

7. **Collapsed sidebar (icon-only) behaviour.**
   When `!showLabels`, clicking the Settings icon button triggers `onSettingsToggle`. On desktop, the sidebar expansion is already handled by `onMouseEnter`. The accordion sub-links only render when `showLabels` is true, so the flow is: user hovers → sidebar expands → clicks Settings → accordion opens → sub-links visible. The `isSettingsRouteActive` check uses `pathname.startsWith("/settings")`.

8. **Mobile drawer.**
   The mobile `SidebarContent` instance receives its own `settingsOpen` state (or the shared one since both are rendered by `AppSidebar`). The `onNavigate` callback already closes the mobile drawer, and the `pathname` effect resets the accordion.

**Verify:**
- Accordion renders below Chat link, above More/User menu.
- Clicking "Team Management" navigates to `/settings/team`.
- Clicking "Extraction Prompt" navigates to `/settings/prompts`.
- Navigating to `/dashboard` collapses the accordion.
- On mobile, accordion works and drawer closes on sub-link click.
- Settings icon highlights when on any `/settings/*` route.

---

### Increment 3: `/settings` redirect + old page removal

**What:** Remove the old tabbed settings page. Redirect `/settings` to the appropriate sub-route.

**Files changed:**

| File | Action |
|------|--------|
| `app/settings/page.tsx` | **Modify** — replace with redirect logic |
| `app/settings/_components/settings-page-content.tsx` | **Delete** |

**Redirect logic (`app/settings/page.tsx`):**

Replace the current page with a server-side redirect using Next.js `redirect()` from `next/navigation`:

```tsx
import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/settings/team");
}
```

This is a simple server-side redirect. The `/settings/team` page itself will handle the "not in a team context" case (Part 2 will address this — for now the redirect target is `/settings/team`).

**Delete `settings-page-content.tsx`:**

This component housed the tabbed layout that combined prompts and team settings. With both now on dedicated routes, it's dead code. The components it imported (`PromptEditorPageContent`, `TeamSettings`) are preserved — they're reused by the new pages in Parts 2 and 3.

**Verify:**
- Visiting `/settings` redirects to `/settings/team`.
- No imports reference `settings-page-content.tsx` anywhere in the codebase.
- Existing prompt and team components are intact and importable.

---

### Summary of all files touched in Part 1

| File | Action | Increment |
|------|--------|-----------|
| `components/layout/page-header.tsx` | Create | 1 |
| `app/dashboard/page.tsx` | Modify | 1 |
| `app/capture/page.tsx` | Modify | 1 |
| `components/layout/app-sidebar.tsx` | Modify | 2 |
| `app/settings/page.tsx` | Modify | 3 |
| `app/settings/_components/settings-page-content.tsx` | Delete | 3 |

---

## Part 2 — Dedicated Team Management Page (`/settings/team`)

This part covers P2.R1 through P2.R4 from the PRD.

---

### Increment 1: Create Team Management Page

**What:** Create the `/settings/team` route with the shared `PageHeader` and migrate the existing team management components into distinct "Access" and "Manage Team" sections.

**Files changed:**

| File | Action |
|------|--------|
| `app/settings/team/page.tsx` | **Create** — new page route |

**Implementation details:**

1. **Context Resolution & Access Control:**
   - Create a Server Component `TeamManagementPage` at `app/settings/team/page.tsx`.
   - Retrieve the current session and workspace context (preserving logic from the old `SettingsPageContent` or existing context resolvers).
   - **Personal Workspace:** If the user is in a personal workspace context, show a message stating that team management is not available in personal workspaces.
   - **Team Workspace (Non-Admin):** If the user is a team member without admin permissions, render a read-only view of the members.

2. **PageHeader:**
   - Import the shared `PageHeader` component.
   - Render it at the top of the page content:
     ```tsx
     <PageHeader 
       title="Team Management" 
       description={`Manage members, invitations, and settings for ${teamName}.`} 
     />
     ```

3. **Sections Layout:**
   - Import existing components: `TeamMembersTable`, `InviteSingleForm`, `InviteBulkDialog`, `PendingInvitationsTable`, and `TeamDangerZone`.
   - Organize the layout into two clearly labelled sections:
   
   **Section 1: Access**
   ```tsx
   <section className="mt-8 space-y-6">
     <h2 className="text-lg font-semibold text-[var(--text-primary)]">Access</h2>
     {/* Wrapper for invite forms */}
     <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
       <InviteSingleForm teamId={teamId} />
       <InviteBulkDialog teamId={teamId} />
     </div>
     <PendingInvitationsTable teamId={teamId} />
     <TeamMembersTable teamId={teamId} />
   </section>
   ```

   **Section 2: Manage Team**
   ```tsx
   <section className="mt-12 space-y-6 border-t border-[var(--border-subtle)] pt-8">
     <h2 className="text-lg font-semibold text-[var(--text-primary)]">Manage Team</h2>
     <TeamDangerZone teamId={teamId} />
   </section>
   ```
   *(Note: The exact props like `teamId` will depend on how the existing components expect their data, but the components themselves will not be rewritten.)*

**Verify:**
- `/settings/team` renders correctly for admin users in a team workspace.
- The shared `PageHeader` displays the correct title and description (including the dynamically populated team name).
- The "Access" section is present and correctly displays all invitation and member management components.
- The "Manage Team" section is present and displays the rename and delete functionality.
- Existing functionality (inviting, revoking, changing roles, renaming, deleting) works as it did previously.
- Non-admins and personal workspace users see the correct restricted/empty states.

---

### Summary of all files touched in Part 2

| File | Action | Increment |
|------|--------|-----------|
| `app/settings/team/page.tsx` | Create | 1 |
