# PRD-010: Team Access — Workspaces, Invitations, and Role-Based Collaboration

> **Master PRD Section:** New section — Team Access
> **Status:** Implemented
> **Deliverable:** Users can create teams, invite members via email, and collaborate on shared sessions, clients, master signals, and prompts with role-based access control. Solo users continue to operate in a personal workspace unchanged.

---

## Purpose

Synthesiser currently operates as a single-user tool — every user works in complete isolation. As the product moves to market, teams need to collaborate: sales reps capture sessions, product leads synthesise signals, and everyone needs to see the same cross-client picture.

This feature introduces **team workspaces** where data is shared across members, roles control who can do what, and an invite flow brings new members onboard via email. The personal workspace remains available for solo use.

Team creation is a **paid feature** gated by a developer-set flag. No payment gateway is built — the developer manually enables access for paying users.

---

## User Stories

- As a **team admin**, I want to create a team and invite my colleagues, so that we can collaborate on client feedback in a shared workspace.
- As a **sales rep**, I want to capture session notes in my team's workspace, so that my team can see all client interactions in one place.
- As a **team admin**, I want to generate a master signal from all team members' sessions, so that the entire team benefits from cross-client synthesis.
- As a **solo user**, I want to continue using Synthesiser exactly as I do today, without being forced into a team.
- As a **new user**, I want to accept a team invitation by signing in with Google, so that I can join my team without a separate registration flow.

---

## Roles

Three levels of access exist within a team:

| Capability | Owner | Admin | Sales |
|---|---|---|---|
| Capture sessions & extract signals | Yes | Yes | Yes |
| View all team sessions, clients, master signal, prompts | Yes | Yes | Yes |
| Download master signal PDF | Yes | Yes | Yes |
| Generate / regenerate master signal | Yes | Yes | No |
| Edit prompts | Yes | Yes | No |
| Invite members (admin or sales) | Yes | Yes | No |
| Remove sales members | Yes | Yes | No |
| Remove admin members | Yes | No | No |
| Transfer ownership | Yes | No | No |
| Rename team | Yes | No | No |
| Delete team | Yes | No | No |

**Owner** is not a separate role value — it is tracked as a field on the team itself (`teams.owner_id`). The owner always has admin privileges plus exclusive powers (remove admins, transfer ownership, delete team). There is exactly one owner per team at all times.

---

## Parts

### Part 1: Database Schema and Email Service

Foundation tables and the provider-agnostic email service.

**Requirements:**

- **P1.R1** Create a `teams` table with `id`, `name`, `owner_id` (FK → auth.users), `created_by`, `created_at`, `deleted_at`.
- **P1.R2** Create a `team_members` table with `id`, `team_id`, `user_id`, `role` (CHECK: `admin`, `sales`), `joined_at`, `removed_at`. Unique index on `(team_id, user_id) WHERE removed_at IS NULL`.
- **P1.R3** Create a `team_invitations` table with `id`, `team_id`, `email`, `role` (CHECK: `admin`, `sales`), `invited_by`, `token` (unique), `expires_at`, `accepted_at`, `created_at`.
- **P1.R4** Add `can_create_team` (BOOLEAN, NOT NULL, default `false`) to the `profiles` table. This flag is set by the developer in the Supabase dashboard to enable paid team access.
- **P1.R5** Add `team_id` (UUID, FK → teams, nullable) to `sessions`, `clients`, `master_signals`, and `prompt_versions`. NULL means personal workspace.
- **P1.R6** Build a provider-agnostic email service at `lib/services/email-service.ts`. It reads `EMAIL_PROVIDER` from environment variables and delegates to the active provider. Starting provider: Resend. The abstraction must support easy addition of SMTP, Brevo, SendGrid, or any other provider without modifying consuming code.
- **P1.R7** Add `EMAIL_PROVIDER` and `RESEND_API_KEY` to `.env.example`.
- **P1.R8** Enable RLS on `teams`, `team_members`, and `team_invitations` with appropriate policies.

**Acceptance Criteria:**

- [ ] `teams`, `team_members`, `team_invitations` tables exist with RLS enabled
- [ ] `profiles.can_create_team` column exists, defaults to `false`
- [ ] `sessions`, `clients`, `master_signals`, `prompt_versions` have a nullable `team_id` column
- [ ] `email-service.ts` exists with a `sendEmail()` function and `resolveEmailProvider()` pattern
- [ ] Sending an email via Resend works from a Next.js API route
- [ ] Switching `EMAIL_PROVIDER` to an unsupported value throws a clear config error

---

### Part 2: Team Creation and Invite Flow

Users with the `can_create_team` flag can create teams and invite members.

**Requirements:**

- **P2.R1** Add a "Create Team" option in the UI, visible only to users where `profiles.can_create_team = true`. The user provides a team name and submits.
- **P2.R2** On team creation, the user is added to `team_members` with role `admin` and `teams.owner_id` is set to their user ID. The app switches to the new team's workspace context.
- **P2.R3** Team settings page (or section within Settings) allows admins to invite a single member. Admin enters one email address and selects a role (`admin` or `sales`). A row is created in `team_invitations` with a unique token and an expiry of 7 days. An invite email is sent via the email service with the team name, inviter's name, and a link: `/invite/[token]`.
- **P2.R4** A separate "Bulk Invite" button opens a textarea where the admin can paste multiple email addresses (comma-separated or one per line) and select a single role for all invitees. A `team_invitations` row is created for each email and an invite email is sent to each. Invalid or duplicate emails are skipped with a summary of what was sent and what was skipped.
- **P2.R5** Admins can view pending invitations and revoke them (sets `accepted_at` to a sentinel or deletes the row).
- **P2.R6** Admins can resend an expired or pending invitation (generates a new token and expiry, sends a new email).

**Acceptance Criteria:**

- [ ] Users with `can_create_team = true` see the "Create Team" option; others do not
- [ ] Creating a team makes the user the owner and an admin member
- [ ] Admins can invite a single member via email input + role selection
- [ ] Admins can bulk invite via a separate textarea flow with a single role for all
- [ ] Bulk invite skips invalid/duplicate emails and shows a summary
- [ ] Invite emails are received by each invitee with a valid link
- [ ] Pending invitations are visible in team settings
- [ ] Invitations can be revoked and resent

---

### Part 3: Invite Acceptance and Join Flow

New or existing users can accept an invitation and join a team.

**Requirements:**

- **P3.R1** Build an `/invite/[token]` page that validates the token (exists, not expired, not already accepted). Shows the team name and a "Sign in with Google to join" button.
- **P3.R2** If the token is invalid, expired, or already used, the page shows an appropriate error message.
- **P3.R3** After Google OAuth sign-in (or sign-up for new users), the auth callback checks for a pending invitation matching the user's email. If found: creates a `team_members` row with the invited role, marks the invitation as accepted, and redirects to the team workspace.
- **P3.R4** If a user is already a member of the team, accepting the invite shows a message and redirects to the team workspace without creating a duplicate membership.
- **P3.R5** The invite link works for both new users (first Google sign-in creates their account) and existing users.

**Acceptance Criteria:**

- [ ] `/invite/[token]` page shows team name and sign-in button for valid tokens
- [ ] Invalid/expired tokens show clear error messages
- [ ] New users can sign up and join a team in a single flow
- [ ] Existing users can join a team via invite link
- [ ] Duplicate membership is handled gracefully
- [ ] After joining, the user lands in the team workspace

---

### Part 4: Workspace Switcher and Context Management

Users can switch between their personal workspace and team workspaces.

**Requirements:**

- **P4.R1** Add a workspace switcher dropdown in the app header (next to the "Synthesiser" logo). It lists "Personal" plus all teams the user belongs to (non-removed memberships).
- **P4.R2** The active workspace is stored in a cookie (`active_team_id`). A null/empty value means personal workspace. The cookie persists across page refreshes and browser sessions.
- **P4.R3** All API routes and service functions read the active workspace from the cookie and scope data queries accordingly.
- **P4.R4** Switching workspaces updates the cookie and refreshes the current page data.
- **P4.R5** If a user is removed from a team while that team is their active workspace, they are automatically switched to personal workspace on next request.
- **P4.R6** The workspace switcher shows the team name and a visual indicator for the currently active workspace.

**Acceptance Criteria:**

- [ ] Workspace switcher is visible in the header for users with team memberships
- [ ] Solo users (no teams) do not see the switcher — they are always in personal workspace
- [ ] Switching workspaces changes the data context across all pages
- [ ] Active workspace persists across page refreshes
- [ ] Removed members are gracefully redirected to personal workspace

---

### Part 5: Team-Scoped Data — Sessions and Clients

Sessions and clients are shared within a team workspace.

**Requirements:**

- **P5.R1** When a user captures a session in a team workspace, `sessions.team_id` is set to the active team. `created_by` still records the individual user for attribution.
- **P5.R2** In a team workspace, the past sessions table shows all team members' sessions. Each session displays the name (or avatar) of the user who captured it.
- **P5.R3** Sales members can only edit or delete sessions they created. Admins and the owner can edit or delete any session in the team.
- **P5.R4** Clients are shared within a team. When a user creates a client in a team workspace, `clients.team_id` is set. The unique constraint for team clients is `(LOWER(name), team_id) WHERE deleted_at IS NULL AND team_id IS NOT NULL`. Personal clients retain the existing `(LOWER(name), created_by) WHERE deleted_at IS NULL AND team_id IS NULL` constraint.
- **P5.R5** The client combobox in the capture form shows all team clients (not just the current user's).
- **P5.R6** Update RLS policies on `sessions` and `clients` to support both personal and team contexts. Personal: `team_id IS NULL AND created_by = auth.uid()`. Team: `team_id IS NOT NULL AND user is an active member of the team`.
- **P5.R7** Session filters (client, date range) continue to work within the team scope.

**Acceptance Criteria:**

- [ ] Sessions captured in a team context are visible to all team members
- [ ] Session attribution (who captured it) is displayed
- [ ] Sales members can only edit or delete their own sessions
- [ ] Admins and the owner can edit or delete any team session
- [ ] Clients are shared and deduplicated within a team
- [ ] Client combobox shows all team clients
- [ ] RLS enforces team-scoped access
- [ ] Personal workspace continues to work as before (regression-free)

---

### Part 6: Team-Scoped Master Signal and Prompts

Master signal and prompts operate at the team level with admin-only controls.

**Requirements:**

- **P6.R1** In a team workspace, the master signal is generated from all team members' sessions (all sessions where `team_id = active team` and `structured_notes IS NOT NULL`).
- **P6.R2** Only admins (and the owner) can generate or regenerate the master signal. Sales members see a read-only view with a message indicating they cannot trigger generation.
- **P6.R3** `master_signals.team_id` is set when generating in a team context. The staleness count and tainted flag logic scope to team sessions.
- **P6.R4** Master signal PDF download is available to all team members.
- **P6.R5** In a team workspace, prompts are team-level. `prompt_versions.team_id` is set. Only one set of active prompts per team (not per user within the team).
- **P6.R6** Only admins can edit team prompts. Sales members see the Settings page in read-only mode with a message indicating they cannot edit.
- **P6.R7** When a team is first created, no team-level prompts exist — the system falls back to hardcoded defaults until an admin saves a custom prompt.
- **P6.R8** Update RLS policies on `master_signals` and `prompt_versions` to support team-scoped access with admin-only write for prompts.

**Acceptance Criteria:**

- [ ] Master signal synthesises from all team sessions
- [ ] Only admins can trigger master signal generation
- [ ] Sales members see master signal in read-only mode
- [ ] Prompts are shared at team level
- [ ] Only admins can edit team prompts
- [ ] Sales members see prompts in read-only mode
- [ ] Staleness and tainted logic work correctly with team-scoped sessions
- [ ] Personal workspace master signal and prompts remain independent

---

### Part 7: Team Management — Members, Roles, and Ownership

Admins and owners manage the team roster and settings.

**Requirements:**

- **P7.R1** Team settings page shows a member list with: name, email, role, joined date. The owner is visually distinguished (e.g., "Owner" badge).
- **P7.R2** Admins can remove sales members. The owner can remove both sales and admin members. Removal sets `team_members.removed_at` — the member's data (sessions, clients) stays with the team.
- **P7.R3** The owner can transfer ownership to any active team member. If the transferee is a sales member, they are promoted to admin. The previous owner retains admin role.
- **P7.R4** Any member can leave a team voluntarily. If the owner leaves:
  - If they explicitly transfer ownership before leaving, the transfer happens first.
  - If they leave without transferring, ownership auto-transfers to the admin with the earliest `joined_at`.
  - If no other admins exist, the owner is blocked from leaving — they must promote someone to admin first or delete the team.
- **P7.R5** The owner can rename the team.
- **P7.R6** The owner can delete the team. Deletion is a soft delete (`teams.deleted_at`). All team data becomes inaccessible but is not permanently destroyed.
- **P7.R7** When a member is removed or leaves, if the team was their active workspace, they are switched to personal workspace.

**Acceptance Criteria:**

- [ ] Member list shows all active members with roles
- [ ] Owner is visually distinguished
- [ ] Admins can remove sales; owner can remove admins
- [ ] Ownership transfer works and updates `teams.owner_id`
- [ ] Owner leaving auto-transfers to oldest admin
- [ ] Owner without other admins is blocked from leaving
- [ ] Owner can rename and delete the team
- [ ] Removed/left members are switched to personal workspace
- [ ] Data from removed members stays with the team

---

### Part 8: Data Retention on Member Departure

When a user leaves or is removed from a team, their contributed data is retained.

**Requirements:**

- **P8.R1** Sessions captured by a departed member remain in the team workspace, attributed to the original creator. The `created_by` reference is preserved.
- **P8.R2** Clients created by a departed member remain accessible to the team.
- **P8.R3** The departed member's sessions continue to contribute to the team's master signal.
- **P8.R4** The departed member can no longer access the team's data (RLS enforces active membership).
- **P8.R5** If a departed member is re-invited and rejoins, they see all team data (including their old sessions) but do not get a duplicate membership.

**Acceptance Criteria:**

- [ ] Sessions from departed members are visible in the team
- [ ] Master signal includes departed members' sessions
- [ ] Departed members cannot access team data
- [ ] Re-joining shows all team data including previous contributions

---

## Backlog

- **Payment gateway integration** — Stripe or similar to automate team access provisioning instead of developer-set flags.
- **Team analytics** — dashboard showing capture activity per member, session volume trends, signal extraction rates.

- **Custom roles** — define granular permissions beyond admin/sales (e.g., "viewer" who can only read, "analyst" who can generate master signals but not edit prompts).
- **Team-level API keys** — allow teams to bring their own AI provider API keys instead of using the platform's.
- **Audit log** — track who invited whom, role changes, ownership transfers, session captures, master signal generations.
- **Cross-team data sharing** — share specific sessions or master signals between teams without merging workspaces.
- **SSO / SAML** — enterprise single sign-on for teams that require it.
- **Email templates** — branded, customisable invite email templates per team.
