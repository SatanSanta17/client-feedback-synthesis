# PRD-022: Layout Cleanup

## Purpose

The current layout has accumulated structural debt — Settings lives as a tabbed page, page headers are inconsistent across routes, and the landing page still references the deprecated master signal feature. This PRD cleans up the layout layer: restructures navigation, introduces a shared page header, splits settings into dedicated routes, and refreshes the marketing page to reflect the product's actual value proposition (Dashboard + Chat).

## User Story

As a user, I want a cleaner, more intuitive navigation experience where settings are easily accessible from the sidebar without replacing my current view, each page has a consistent header, and the landing page accurately represents what the product does — so I can find what I need faster and new visitors get an honest first impression.

---

## Part 1 — Settings Accordion in Sidebar + Shared Page Header

### Requirements

**P1.R1 — Settings accordion replaces the Settings nav link.**
The current "Settings" entry in `NAV_ITEMS` is removed. In its place, a collapsible accordion section is rendered **below** the main nav links (after Dashboard, Capture, Chat) but **above** the bottom section (More menu, User menu). The accordion trigger displays a Settings icon and the label "Settings" when the sidebar is expanded, or just the icon when collapsed.

**P1.R2 — Accordion reveals two sub-links.**
When expanded, the accordion shows two indented navigation links:

- "Team Management" → `/settings/team`
- "Extraction Prompt" → `/settings/prompts`

Each sub-link highlights when its route is active. The accordion trigger also highlights when any `/settings/*` route is active.

**P1.R3 — Accordion state resets on navigation.**
The accordion open/closed state is managed via `useState` (not persisted). It resets to collapsed whenever the user navigates to a different route (detected via `pathname` change). This applies to both desktop and mobile sidebar.

**P1.R4 — Accordion works in both sidebar modes.**
On desktop (hover-to-expand), the accordion is fully functional when the sidebar is expanded. When collapsed (icon-only), clicking the Settings icon expands the sidebar and opens the accordion. On mobile (Sheet drawer), the accordion works normally with full labels.

**P1.R5 — Shared `PageHeader` component.**
A reusable `PageHeader` component is created in `components/layout/`. It renders a consistent header across all authenticated pages **except** Chat (which has its own `ChatHeader`). The component accepts a `title` (string) and an optional `description` (string). It is used on: Dashboard, Capture, Team Management, and Extraction Prompt pages.

**P1.R6 — Old Settings page and route removed.**
The `/settings` route no longer renders the tabbed `SettingsPageContent`. Visiting `/settings` redirects to `/settings/team` (or `/settings/prompts` if the user is not in a team context). The `SettingsPageContent` component (with its tab-based layout) is deleted.

### Acceptance Criteria

- [ ] P1.R1 — Sidebar shows a Settings accordion below the main nav links, not a direct Settings link.
- [ ] P1.R2 — Accordion expands to reveal "Team Management" and "Extraction Prompt" sub-links with correct routing.
- [ ] P1.R3 — Accordion collapses when the user navigates to any non-settings route.
- [ ] P1.R4 — Accordion is functional in desktop expanded, desktop collapsed (triggers expand), and mobile drawer modes.
- [ ] P1.R5 — Dashboard, Capture, Team Management, and Extraction Prompt pages all use the shared `PageHeader` component with consistent styling.
- [ ] P1.R6 — `/settings` redirects appropriately; old tabbed settings page is removed.

---

## Part 2 — Dedicated Team Management Page (`/settings/team`)

### Requirements

**P2.R1 — Team Management page at `/settings/team`.**
A new page route is created at `app/settings/team/page.tsx`. It is only accessible when the user is in a team workspace context and has admin permissions. Non-admin team members see a read-only view or are redirected. Personal workspace users are shown a message that team management is not available in personal workspace.

**P2.R2 — Page uses `PageHeader`.**
The page renders the shared `PageHeader` with title "Team Management" and a description reflecting the team name (e.g., "Manage members, invitations, and settings for {teamName}.").

**P2.R3 — Three sections in order.**

1. **Access** — Contains the existing invitation functionality: `InviteSingleForm`, `InviteBulkDialog`, `PendingInvitationsTable`, and `TeamMembersTable`. This section has a visible section heading.
2. **Manage Team** — Contains the existing rename and delete functionality (`TeamDangerZone`). This section has a visible section heading. This is where rename and delete team actions live.

**P2.R4 — Content is migrated, not rewritten.**
The existing components (`TeamMembersTable`, `InviteSingleForm`, `InviteBulkDialog`, `PendingInvitationsTable`, `TeamDangerZone`) are reused. The team context resolution logic (checking membership, role, ownership) is preserved from the current `SettingsPageContent`.

### Acceptance Criteria

- [ ] P2.R1 — `/settings/team` renders the team management page for admin users in a team workspace.
- [ ] P2.R2 — Page header is consistent with other pages via the shared `PageHeader` component.
- [ ] P2.R3 — Page has two clearly labelled sections: "Access" and "Manage Team", in that order.
- [ ] P2.R4 — All existing team management functionality (members, invitations, rename, delete) works as before.

---

## Part 3 — Dedicated Extraction Prompt Page (`/settings/prompts`)

### Requirements

**P3.R1 — Extraction Prompt page at `/settings/prompts`.**
A new page route is created at `app/settings/prompts/page.tsx`. It renders the prompt editor for the session extraction prompt only.

**P3.R2 — Master signal prompt is removed.**
The prompt editor no longer shows tabs for master signal prompts. The `PromptMasterSignalNotice` component is no longer rendered. Only the single session extraction prompt is displayed — no tabs UI if there is only one prompt.

**P3.R3 — Page uses `PageHeader`.**
The page renders the shared `PageHeader` with title "Extraction Prompt" and a description (e.g., "Edit the AI system prompt used for session signal extraction.").

**P3.R4 — Read-only for non-admins.**
In a team workspace, non-admin members see the prompt in read-only mode with the existing info banner. In personal workspace, the user has full edit access.

**P3.R5 — Existing editor functionality preserved.**
Version history, revert, save, reset, unsaved changes dialog, and character count all continue to work as before.

### Acceptance Criteria

- [ ] P3.R1 — `/settings/prompts` renders the extraction prompt editor.
- [ ] P3.R2 — No master signal prompt tab or notice is shown.
- [ ] P3.R3 — Page header is consistent via the shared `PageHeader`.
- [ ] P3.R4 — Non-admin team members see a read-only view.
- [ ] P3.R5 — Version history, save, reset, revert, and unsaved changes dialog all work.

---

## Part 4 — Landing Page Refresh

### Requirements

**P4.R1 — Remove all master signal references.**
The "Cross-Client Synthesis" feature card and its description ("master signal document") are removed. The "Synthesise" step in How It Works is replaced. No mention of "master signal" remains on the landing page.

**P4.R2 — Add Dashboard feature card.**
A new feature card is added highlighting the insights dashboard. Catchy, concise copy that communicates the value — e.g.:

- **Title:** "Insights Dashboard"
- **Description:** "Sentiment shifts, urgency spikes, theme trends — your entire client landscape distilled into one interactive view. Spot what matters before it becomes a fire."

**P4.R3 — Add Chat feature card.**
A new feature card is added highlighting the RAG chat. Catchy, concise copy — e.g.:

- **Title:** "Ask Your Data"
- **Description:** "Skip the spreadsheet safari. Ask a question in plain English and get answers grounded in every session your team has ever captured — with citations."

**P4.R4 — Update How It Works step 3.**
The third step ("Synthesise") is updated to reflect Dashboard and Chat instead of master signal. E.g.:

- **Title:** "Understand"
- **Description:** "Your dashboard lights up with trends, and Chat answers any question across all your sessions — instantly."

**P4.R5 — Hero copy remains unchanged.**
The hero headline ("Turn every client conversation into a product signal") and subheading are kept as-is. The term "product signal" is a general concept, not a reference to the master signal feature.

### Acceptance Criteria

- [ ] P4.R1 — No mention of "master signal" or "master document" on the landing page.
- [ ] P4.R2 — Dashboard feature card is present with compelling copy.
- [ ] P4.R3 — Chat feature card is present with compelling copy.
- [ ] P4.R4 — How It Works step 3 reflects Dashboard + Chat, not master signal synthesis.
- [ ] P4.R5 — Hero section is unchanged.

---

## Backlog

- Persist accordion open/closed state via `localStorage` for cross-navigation persistence.
- Clear `activeConversationId` on workspace switch to prevent stale selection.
- Add breadcrumb navigation for `/settings/*` sub-pages.
- Consider adding a settings overview page if more settings categories are added in the future.
