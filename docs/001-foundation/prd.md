# PRD-001: Foundation

> **Master PRD Section:** Section 1 — Foundation
> **Status:** Approved (2026-03-25)
> **Deliverable:** User can sign in with Google and see the app shell with tab navigation.

## Purpose

Before any feature can be built, the application needs a working foundation: a visible app shell users can navigate and an authentication gate that restricts access to the team. This PRD covers both.

## User Story

As a team member, I want to sign in with my Google account and see the app's main navigation, so that I know the tool is live, I have access, and I'm ready to start capturing sessions once the Capture tab is built.

---

## Part 1: App Shell and Navigation

**Scope:** Root layout, multi-tab navigation, visual foundation, placeholder pages.

### Requirements

- **P1.R1** The app uses a top-level multi-tab layout. initially just 1 tab "Capture" (with a pencil icon).
- **P1.R2** The active tab is underlined with a brand-coloured indicator (indigo/purple). Inactive tabs are neutral grey.
- **P1.R3** Clicking a tab navigates to its corresponding route (`/capture`). The Capture tab is the default on app load.
- **P1.R4** Each tab route renders a placeholder page with the tab name and a "Coming soon" message. These placeholders will be replaced by real content in later PRDs.
- **P1.R5** The top-right corner of the layout reserves space for the user menu (avatar + email + sign-out dropdown). In this part, it can be a static placeholder since auth is not yet wired.
- **P1.R6** The visual style is clean and utilitarian: white background, neutral grey for borders and secondary text, indigo/purple as the single brand accent colour. No unnecessary visual complexity.
- **P1.R7** The layout is desktop-first. It should be legible on mobile (no horizontal overflow) but is not optimised for mobile use.
- **P1.R8** The root layout includes proper metadata (title, description) for the application.

### Acceptance Criteria

- [ ] App loads and displays the multi-tab navigation bar
- [ ] Capture tab is selected by default on first load
- [ ] Clicking Capture tab navigates to `/capture` with active indicator
- [ ] Placeholder content renders on tab pages
- [ ] User menu placeholder is visible in the top-right corner
- [ ] Visual style matches the utilitarian design spec (white bg, grey borders, indigo accent)
- [ ] No horizontal overflow on mobile viewport widths
- [ ] Page title and metadata are set correctly

---

## Part 2: Authentication

**Scope:** Google OAuth login restricted to a configurable domain, session persistence, user menu with sign-out, route protection.

### Requirements

- **P2.R1** Authentication uses Google OAuth, restricted to a configurable email domain.
- **P2.R2** On first visit (unauthenticated), the user is redirected to a login page with a "Sign in with Google" button.
- **P2.R3** After successful Google sign-in, the user is redirected to `/capture`.
- **P2.R4** After authentication, the user's email domain is verified against the allowed domain (configured via `ALLOWED_EMAIL_DOMAIN` env var). This check must happen server-side, not just on the client.
- **P2.R5** Users outside the allowed domain see a clear error: "Access restricted to authorised email domains." They are signed out and cannot proceed.
- **P2.R6** The auth session is persisted across browser refreshes. The user is not forced to re-authenticate on every visit.
- **P2.R7** The user menu placeholder from Part 1 is replaced with the real user menu: signed-in user's Google avatar and email, with a dropdown containing a "Sign Out" option.
- **P2.R8** Clicking "Sign Out" clears the session and redirects to the login page.
- **P2.R9** All routes except the login page and the auth callback are protected. Unauthenticated requests to any protected route are redirected to login.
- **P2.R10** The allowed email domain is configurable (not hardcoded).

### Acceptance Criteria

- [ ] Visiting any protected route while unauthenticated redirects to the login page
- [ ] The login page shows a "Sign in with Google" button
- [ ] Clicking "Sign in with Google" initiates the Google OAuth flow
- [ ] After sign-in with an allowed-domain account, the user lands on `/capture` with the tab layout
- [ ] After sign-in with a non-allowed-domain account, the user sees the "Access restricted" error and is signed out
- [ ] Refreshing the page after sign-in does not require re-authentication
- [ ] The user menu shows the user's avatar and email
- [ ] Clicking "Sign Out" clears the session and shows the login page
- [ ] The login page and auth callback route are accessible without authentication
- [ ] All other routes redirect to login when unauthenticated
- [ ] No auth secrets are exposed in client-side code

---

## Backlog (deferred from this PRD)

- Database schema setup — moved to Section 2 (Capture Tab) where the data model is informed by the actual capture user journey
- Custom 404 and error pages (will be addressed in Section 4: Hardening)
- Loading skeletons for auth state resolution (will be addressed in Section 4)
