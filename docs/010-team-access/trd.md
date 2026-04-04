# TRD-010: Team Access — Workspaces, Invitations, and Role-Based Collaboration

> **Status:** Implemented (Parts 1–8)
> **PRD:** `docs/010-team-access/prd.md` (approved)
> **Mirrors:** PRD Parts 1–8. All parts are detailed below.

---

## Technical Decisions

1. **Owner tracked on `teams` table, not as a role.** `teams.owner_id` identifies the owner. `team_members.role` has two values: `admin` and `sales`. The owner is always an admin with extra privileges. Transfer is a single-column update on `teams`.

2. **Cookie-based workspace context.** The active team is stored in a cookie (`active_team_id`). All API routes and service functions read this cookie to scope data. `null` / empty = personal workspace. This avoids URL restructuring and keeps the existing route structure intact. (Detailed in future Part 4 TRD.)

3. **`team_id` nullable on all data tables.** `sessions`, `clients`, `master_signals`, and `prompt_versions` gain a nullable `team_id` column. `NULL` = personal workspace. This preserves all existing personal-workspace behavior — current RLS policies continue to work when `team_id IS NULL`.

4. **Email service follows the same provider abstraction pattern as `ai-service.ts`.** A `resolveEmailProvider()` function reads `EMAIL_PROVIDER` from env vars and returns a provider adapter. The public `sendEmail()` function delegates to the resolved provider. Adding a new provider means adding one factory entry — no changes to consuming code.

5. **Invite token is a crypto-random string, not a JWT.** Simpler, no expiry embedded in the token — expiry is checked against `team_invitations.expires_at` in the database. Tokens are 32-byte hex strings generated via `crypto.randomBytes(32).toString('hex')`.

6. **RLS uses a `SECURITY DEFINER` helper for team membership checks.** A `is_team_member(team_id UUID)` function avoids recursive RLS issues when policies on `team_members` reference themselves. Same pattern as the existing `is_admin()` function.

7. **Resend as the starting email provider.** The `resend` npm package is lightweight, has a simple API, and offers 3,000 free emails/month. The abstraction layer makes swapping to SMTP/Brevo/SendGrid trivial.

---

## Part 1: Database Schema and Email Service

### 1.1 Database Migrations

#### New tables

**`teams`**

```sql
CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES auth.users(id),
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
```

**`team_members`**

```sql
CREATE TABLE team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX team_members_active_unique
  ON team_members (team_id, user_id)
  WHERE removed_at IS NULL;

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
```

**`team_invitations`**

```sql
CREATE TABLE team_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
  invited_by  UUID NOT NULL REFERENCES auth.users(id),
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
```

#### Modifications to existing tables

**`profiles` — add `can_create_team`**

```sql
ALTER TABLE profiles
  ADD COLUMN can_create_team BOOLEAN NOT NULL DEFAULT false;
```

**`sessions` — add `team_id`**

```sql
ALTER TABLE sessions
  ADD COLUMN team_id UUID REFERENCES teams(id);
```

**`clients` — add `team_id` and update unique index**

```sql
ALTER TABLE clients
  ADD COLUMN team_id UUID REFERENCES teams(id);

-- Drop the existing per-user unique index
DROP INDEX clients_name_unique;

-- Personal clients: unique per user
CREATE UNIQUE INDEX clients_name_user_unique
  ON clients (LOWER(name), created_by)
  WHERE deleted_at IS NULL AND team_id IS NULL;

-- Team clients: unique per team
CREATE UNIQUE INDEX clients_name_team_unique
  ON clients (LOWER(name), team_id)
  WHERE deleted_at IS NULL AND team_id IS NOT NULL;
```

**`master_signals` — add `team_id`**

```sql
ALTER TABLE master_signals
  ADD COLUMN team_id UUID REFERENCES teams(id);
```

**`prompt_versions` — add `team_id` and update unique index**

```sql
ALTER TABLE prompt_versions
  ADD COLUMN team_id UUID REFERENCES teams(id);

-- Drop the existing per-user active unique index
DROP INDEX prompt_versions_active_unique;

-- Personal prompts: one active per key per user
CREATE UNIQUE INDEX prompt_versions_active_user_unique
  ON prompt_versions (prompt_key, created_by)
  WHERE is_active = true AND created_by IS NOT NULL AND team_id IS NULL;

-- Team prompts: one active per key per team
CREATE UNIQUE INDEX prompt_versions_active_team_unique
  ON prompt_versions (prompt_key, team_id)
  WHERE is_active = true AND team_id IS NOT NULL;
```

#### Helper function

```sql
CREATE OR REPLACE FUNCTION is_team_member(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND removed_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION get_team_role(p_team_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM team_members
  WHERE team_id = p_team_id
    AND user_id = auth.uid()
    AND removed_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_team_admin(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND removed_at IS NULL
      AND role = 'admin'
  );
$$;
```

#### RLS Policies — new tables

**`teams`**

```sql
-- Members can read their non-deleted teams
CREATE POLICY "Team members can read team"
  ON teams FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_team_member(id));

-- Authenticated users can create teams (app-level check for can_create_team)
CREATE POLICY "Authenticated users can create teams"
  ON teams FOR INSERT TO authenticated
  WITH CHECK (true);

-- Owner can update their team (rename)
CREATE POLICY "Owner can update team"
  ON teams FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (true);
```

**`team_members`**

```sql
-- Members can see other members of their teams
CREATE POLICY "Members can read team members"
  ON team_members FOR SELECT TO authenticated
  USING (is_team_member(team_id));

-- Admins can insert new members (via invite acceptance — service role handles this)
CREATE POLICY "Service role inserts team members"
  ON team_members FOR INSERT TO authenticated
  WITH CHECK (true);

-- Admins can update members (set removed_at)
CREATE POLICY "Admins can update team members"
  ON team_members FOR UPDATE TO authenticated
  USING (is_team_admin(team_id))
  WITH CHECK (true);
```

**`team_invitations`**

```sql
-- Admins can read invitations for their teams
CREATE POLICY "Admins can read team invitations"
  ON team_invitations FOR SELECT TO authenticated
  USING (is_team_admin(team_id));

-- Admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON team_invitations FOR INSERT TO authenticated
  WITH CHECK (is_team_admin(team_id));

-- Admins can update invitations (revoke — set accepted_at)
CREATE POLICY "Admins can update invitations"
  ON team_invitations FOR UPDATE TO authenticated
  USING (is_team_admin(team_id))
  WITH CHECK (true);

-- Public read for token validation (invite acceptance page — unauthenticated users need to see team name)
-- This is handled via service role client in the invite page API, not RLS.
```

### 1.2 Email Service

**New file: `lib/services/email-service.ts`**

```
resolveEmailProvider()        → reads EMAIL_PROVIDER env var, returns provider adapter
sendEmail({ to, subject, html }) → delegates to resolved provider
```

**Structure:**

```typescript
type SupportedEmailProvider = "resend";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

interface EmailProvider {
  send(payload: EmailPayload): Promise<void>;
}

const PROVIDER_MAP: Record<SupportedEmailProvider, () => EmailProvider>;

function resolveEmailProvider(): EmailProvider;
export async function sendEmail(payload: EmailPayload): Promise<void>;
export class EmailConfigError extends Error {}
export class EmailSendError extends Error {}
```

The Resend adapter:

```typescript
import { Resend } from "resend";

const resendProvider: EmailProvider = {
  async send({ to, subject, html }) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Synthesiser <noreply@synthesiser.app>",
      to,
      subject,
      html,
    });
    if (error) throw new EmailSendError(error.message);
  },
};
```

**Adding a new provider (e.g., SMTP):**

1. Add `"smtp"` to `SupportedEmailProvider`
2. Create an smtp adapter implementing `EmailProvider`
3. Add it to `PROVIDER_MAP`
4. Set `EMAIL_PROVIDER=smtp` in `.env`

No consuming code changes required.

### 1.3 Environment Variables

Add to `.env.example`:

```
# Email provider
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM="Synthesiser <noreply@yourdomain.com>"
```

### 1.4 New Dependencies

```
npm install resend
```

### 1.5 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Create | `lib/services/email-service.ts` | Provider-agnostic email service with `sendEmail()`, `resolveEmailProvider()`, Resend adapter, error classes |
| Modify | `.env.example` | Add `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Create | `docs/010-team-access/001-create-team-tables.sql` | SQL migration for `teams`, `team_members`, `team_invitations` tables |
| Create | `docs/010-team-access/002-modify-existing-tables.sql` | SQL migration adding `team_id` to `sessions`, `clients`, `master_signals`, `prompt_versions`, and `can_create_team` to `profiles` |
| Create | `docs/010-team-access/003-rls-and-functions.sql` | SQL for helper functions (`is_team_member`, `get_team_role`, `is_team_admin`) and RLS policies |

### 1.6 Implementation Increments

**Increment 1.1: Database migrations**
- Write and provide the three SQL migration files
- User runs them in Supabase SQL editor

**Increment 1.2: Email service**
- Install `resend` package
- Create `lib/services/email-service.ts` with `resolveEmailProvider()` + Resend adapter
- Update `.env.example` with email env vars
- Verify: config error when `EMAIL_PROVIDER` is missing or unsupported

**Verification:**
- All tables exist in Supabase with RLS enabled
- `is_team_member()`, `get_team_role()`, `is_team_admin()` functions exist
- Existing data untouched — all new columns are nullable or have defaults
- `sendEmail()` resolves to Resend and can send a test email
- No regressions — existing personal workspace flows work unchanged

---

## Part 2: Team Creation and Invite Flow

### 2.1 New API Routes

**`POST /api/teams`** — Create a team

```
Body: { name: string }
Auth: Required. Checks profiles.can_create_team = true.
Steps:
  1. Validate input (Zod: name min 1, max 100)
  2. Fetch profile, check can_create_team = true → 403 if false
  3. Insert into teams (name, owner_id = user.id, created_by = user.id)
  4. Insert into team_members (team_id, user_id, role = 'admin')
  5. Return 201 { team: { id, name } }
```

**`POST /api/teams/[teamId]/invitations`** — Send invitation(s)

```
Body: { emails: string[], role: 'admin' | 'sales' }
Auth: Required. Must be admin of the team.
Steps:
  1. Validate input (Zod: emails array of valid email strings, role)
  2. Verify caller is admin via get_team_role()
  3. For each email:
     a. Skip if already an active team member
     b. Skip if a pending (non-expired, non-accepted) invitation exists
     c. Generate token: crypto.randomBytes(32).toString('hex')
     d. Insert into team_invitations (team_id, email, role, invited_by, token, expires_at = now + 7 days)
     e. Send invite email via sendEmail()
  4. Return 200 { sent: string[], skipped: Array<{ email, reason }> }
```

**`GET /api/teams/[teamId]/invitations`** — List pending invitations

```
Auth: Required. Must be admin of the team.
Returns: { invitations: Array<{ id, email, role, invited_by, expires_at, accepted_at, created_at }> }
Filters: Non-accepted invitations, ordered by created_at DESC.
```

**`DELETE /api/teams/[teamId]/invitations/[invitationId]`** — Revoke invitation

```
Auth: Required. Must be admin of the team.
Steps:
  1. Delete the invitation row (or set accepted_at to a sentinel — delete is simpler)
  2. Return 200 { message: "Invitation revoked" }
```

**`POST /api/teams/[teamId]/invitations/[invitationId]/resend`** — Resend invitation

```
Auth: Required. Must be admin of the team.
Steps:
  1. Generate a new token and set expires_at = now + 7 days
  2. Update the invitation row
  3. Send invite email with new link
  4. Return 200 { message: "Invitation resent" }
```

### 2.2 New Service Layer

**New file: `lib/services/team-service.ts`**

```typescript
// Team CRUD
createTeam(name: string, userId: string): Promise<Team>
getTeamsForUser(userId: string): Promise<Team[]>
getTeamById(teamId: string): Promise<Team | null>

// Membership
getTeamMember(teamId: string, userId: string): Promise<TeamMember | null>
isTeamAdmin(teamId: string, userId: string): Promise<boolean>

// Invitations
createInvitations(teamId: string, emails: string[], role: string, invitedBy: string): Promise<InviteResult>
getPendingInvitations(teamId: string): Promise<TeamInvitation[]>
revokeInvitation(invitationId: string): Promise<void>
resendInvitation(invitationId: string): Promise<void>
```

Uses `createClient()` (anon/user-scoped) for RLS-protected operations. Uses `createServiceRoleClient()` only for operations that need to bypass RLS (e.g., reading invitation by token for unauthenticated invite acceptance — covered in Part 3).

### 2.3 Invite Email Template

HTML email built inline (no template engine needed for v1):

```
Subject: "You're invited to join {teamName} on Synthesiser"

Body:
- "{inviterName} invited you to join {teamName} on Synthesiser."
- "You've been invited as a {role}."
- CTA button: "Join Team" → {APP_URL}/invite/{token}
- Footer: "This invitation expires in 7 days."
```

Reads `NEXT_PUBLIC_APP_URL` for the link base URL.

### 2.4 Frontend Components

**Team creation:**

- Add a "Create Team" button in the app header or Settings page
- Visible only when `profiles.can_create_team = true` — fetched from the profile service
- Clicking opens a dialog with a team name input + "Create" button
- On success: sets `active_team_id` cookie to the new team's ID, refreshes the page

**New file: `app/settings/_components/team-settings.tsx`**

Team settings section within the Settings page (or a new tab). Contains:

1. **Team info** — name (editable by owner, shown in Part 7)
2. **Invite section:**
   - Single invite: email input + role select + "Send Invite" button
   - Bulk invite: "Bulk Invite" button → opens textarea + role select + "Send All" button
3. **Pending invitations table:** email, role, status (pending/expired), sent date, actions (revoke, resend)

Visibility: This section only renders when the active workspace is a team and the current user is an admin.

### 2.5 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Create | `lib/services/team-service.ts` | Team CRUD, membership queries, invitation management |
| Create | `app/api/teams/route.ts` | POST — create team |
| Create | `app/api/teams/[teamId]/invitations/route.ts` | GET — list invitations, POST — create invitation(s) |
| Create | `app/api/teams/[teamId]/invitations/[invitationId]/route.ts` | DELETE — revoke invitation |
| Create | `app/api/teams/[teamId]/invitations/[invitationId]/resend/route.ts` | POST — resend invitation |
| Create | `app/settings/_components/team-settings.tsx` | Team settings UI: invite single, bulk invite, pending invitations |
| Modify | `app/settings/_components/prompt-editor-page-content.tsx` | Add team settings tab/section (conditional on active team workspace) |
| Modify | `app/settings/page.tsx` | Pass team context to settings content |
| Modify | `components/layout/app-header.tsx` | Add "Create Team" button (conditional on `can_create_team`) |
| Modify | `lib/services/profile-service.ts` | Ensure `can_create_team` is included in `Profile` interface and `getCurrentProfile()` select |

### 2.6 Implementation Increments

**Increment 2.1: Team service + API routes**
- Create `lib/services/team-service.ts`
- Create API routes: `POST /api/teams`, team invitation CRUD routes
- Zod validation on all inputs
- Verify: team creation inserts into `teams` + `team_members`, invitation CRUD works

**Increment 2.2: Invite email integration**
- Build inline HTML email template for team invitations
- Wire invitation API routes to call `sendEmail()` with the template
- Verify: invite email is received with correct team name, role, and link

**Increment 2.3: Frontend — team creation**
- Add "Create Team" button (visible when `can_create_team = true`)
- Team name dialog + submission flow
- On success: set `active_team_id` cookie, refresh
- Update `profile-service.ts` to include `can_create_team`

**Increment 2.4: Frontend — team settings (invite + pending invitations)**
- Build `team-settings.tsx` with single invite, bulk invite, and pending invitations table
- Wire to invitation API routes
- Add team settings section to the Settings page (conditional on team context)
- Verify: full invite flow works end-to-end from UI

**Verification:**
- Users with `can_create_team = true` can create teams; others cannot
- Creating a team sets owner and adds creator as admin member
- Single invite sends one email with valid token link
- Bulk invite sends emails, skips invalid/duplicate, shows summary
- Pending invitations are visible with revoke and resend actions
- No regressions to personal workspace or existing settings page

---

## Part 3: Invite Acceptance and Join Flow

### 3.1 Technical Decisions

1. **Token validation uses the service role client.** The `/invite/[token]` page must be accessible to unauthenticated users (they haven't signed in yet). The page's server component uses `createServiceRoleClient()` to look up the invitation by token, bypassing RLS. Only the token, team name, role, and expiry status are exposed — no sensitive data.

2. **Invite token stored in a cookie during OAuth.** When a user clicks "Sign in with Google to join" on the invite page, the token is stored in a short-lived cookie (`pending_invite_token`, 10 min TTL). After OAuth completes, the auth callback reads this cookie, validates the invitation, creates the membership, and clears the cookie. This avoids passing the token through OAuth redirect URLs which have length limits and are logged.

3. **Invite acceptance uses the service role client.** The auth callback needs to: (a) read the invitation by token (bypassing RLS since the user may not have RLS-visible access to `team_invitations`), (b) insert into `team_members`, and (c) update the invitation's `accepted_at`. All three operations use `createServiceRoleClient()` to avoid RLS chicken-and-egg issues.

4. **The `/invite/[token]` route is public.** Middleware is updated to allow unauthenticated access to `/invite/` paths — same treatment as `/login` and `/auth/callback`.

### 3.2 New API Route

**`GET /api/invite/[token]`** — Validate an invite token (server-side, called by the invite page)

```
Auth: Not required (public).
Steps:
  1. Use service role client to find the invitation by token
  2. If not found → return 404 { status: "invalid" }
  3. If already accepted → return 410 { status: "already_accepted" }
  4. If expired (expires_at < now) → return 410 { status: "expired" }
  5. Fetch team name from teams table
  6. Return 200 { status: "valid", teamName, role }
```

This route is read-only and exposes only the team name and invited role — no IDs or emails.

### 3.3 Invite Acceptance in Auth Callback

**Modified file: `app/auth/callback/route.ts`**

After successful `exchangeCodeForSession()`, the callback checks for a `pending_invite_token` cookie:

```
Steps:
  1. Exchange code for session (existing)
  2. Read pending_invite_token cookie
  3. If no token → redirect to /capture (existing behavior)
  4. If token exists:
     a. Clear the cookie immediately
     b. Use service role client to fetch the invitation by token
     c. Validate: exists, not expired, not already accepted
     d. If invalid → redirect to /capture (graceful degradation — user is signed in)
     e. Get the user's email from the session
     f. Check if user is already a member of the team:
        - If yes → set active_team_id cookie, redirect to /capture
        - If no → insert into team_members (team_id, user_id, role from invitation)
     g. Set accepted_at = now() on the invitation
     h. Set active_team_id cookie to the invitation's team_id
     i. Redirect to /capture
```

### 3.4 Frontend — Invite Page

**New file: `app/invite/[token]/page.tsx`** (Server Component)

The page is a server component that fetches invite details on the server and renders the appropriate state.

```
Server-side:
  1. Use service role client to fetch invitation by token
  2. Determine status: valid, expired, already_accepted, invalid
  3. If valid: fetch team name
  4. Pass status + team name + role to the client component

Client component renders one of:
  - Valid: team name, role badge, "Sign in with Google to join" button
  - Expired: "This invitation has expired. Ask the team admin to send a new one."
  - Already accepted: "This invitation has already been used."
  - Invalid: "This invitation link is invalid."
```

**New file: `app/invite/[token]/_components/invite-page-content.tsx`** (Client Component)

Handles the "Sign in with Google to join" button:

```
Steps:
  1. Set pending_invite_token cookie (document.cookie, 10 min TTL)
  2. Call supabase.auth.signInWithOAuth({ provider: "google", redirectTo: /auth/callback })
```

If the user is already authenticated (checked via `useAuth()`), skip OAuth and call a `POST /api/invite/[token]/accept` endpoint directly.

### 3.5 Accept Endpoint for Already-Authenticated Users

**New file: `app/api/invite/[token]/accept/route.ts`**

```
Auth: Required.
Body: none (token is in the URL)
Steps:
  1. Use service role client to fetch invitation by token
  2. Validate: exists, not expired, not already accepted → 400/404/410
  3. Get the user from session
  4. Check email match: invitation.email must equal user.email (case-insensitive)
     - If mismatch → 403 { message: "This invitation was sent to a different email address" }
  5. Check if already a team member → if yes, skip insert, set accepted_at, return 200
  6. Insert into team_members
  7. Set accepted_at = now() on the invitation
  8. Return 200 { teamId, teamName }
```

The frontend then sets the `active_team_id` cookie and redirects to `/capture`.

### 3.6 Middleware Update

**Modified file: `middleware.ts`**

Add `/invite` to the public routes list:

```typescript
const isPublicRoute =
  pathname === "/login" ||
  pathname.startsWith("/auth/callback") ||
  pathname.startsWith("/invite");
```

### 3.7 New Service Layer

**New functions in `lib/services/invitation-service.ts`:**

```typescript
getInvitationByToken(token: string): Promise<InvitationWithTeam | null>
acceptInvitation(invitationId: string, userId: string, teamId: string, role: string): Promise<void>
```

`getInvitationByToken` uses the service role client to bypass RLS. Returns the invitation joined with the team name.

`acceptInvitation` uses the service role client to:
1. Check if user is already a member (skip insert if so)
2. Insert into `team_members`
3. Set `accepted_at = now()` on the invitation

### 3.8 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Create | `app/invite/[token]/page.tsx` | Server component — validates token, renders invite page |
| Create | `app/invite/[token]/_components/invite-page-content.tsx` | Client component — sign-in button, cookie handling |
| Create | `app/api/invite/[token]/accept/route.ts` | POST — accept invitation for already-authenticated users |
| Modify | `app/auth/callback/route.ts` | Check `pending_invite_token` cookie after OAuth, create membership |
| Modify | `middleware.ts` | Add `/invite` to public routes |
| Modify | `lib/services/invitation-service.ts` | Add `getInvitationByToken()`, `acceptInvitation()` |

### 3.9 Implementation Increments

**Increment 3.1: Invitation service extensions**
- Add `getInvitationByToken()` and `acceptInvitation()` to `invitation-service.ts`
- Both use `createServiceRoleClient()` to bypass RLS
- Verify: token lookup returns invitation + team name, acceptance creates membership and sets `accepted_at`

**Increment 3.2: Invite page (frontend)**
- Update middleware to allow `/invite` as a public route
- Create `app/invite/[token]/page.tsx` (server component) and `invite-page-content.tsx` (client component)
- Valid tokens show team name + role + sign-in button
- Invalid/expired/used tokens show appropriate error messages
- Verify: visiting `/invite/[valid-token]` shows the invite page

**Increment 3.3: Auth callback integration**
- Modify `app/auth/callback/route.ts` to check for `pending_invite_token` cookie
- On valid invite: create membership, set `active_team_id` cookie, redirect to `/capture`
- On invalid/missing invite: existing behavior (redirect to `/capture`)
- Verify: clicking "Sign in to join" → OAuth → callback → user is a team member

**Increment 3.4: Accept endpoint for authenticated users**
- Create `app/api/invite/[token]/accept/route.ts`
- Validates token, checks email match, creates membership
- Wire into `invite-page-content.tsx` — if user is already authenticated, call accept endpoint instead of OAuth
- Verify: authenticated user visiting an invite link can join without re-authenticating

**Verification:**
- `/invite/[valid-token]` shows team name and sign-in button
- `/invite/[expired-token]` shows expiry message
- `/invite/[used-token]` shows "already accepted" message
- `/invite/[garbage]` shows "invalid" message
- New user: clicks invite link → signs in with Google → lands in team workspace as a member
- Existing user (not signed in): clicks invite link → signs in → joins team
- Existing user (already signed in): clicks invite link → accepts directly → joins team
- Duplicate membership: already a member → redirects to team workspace, no duplicate row
- `pending_invite_token` cookie is cleared after use
- No regressions to existing login or auth callback flows

---

## Part 4: Workspace Switcher and Context Management

### 4.1 Technical Decisions

1. **`active_team_id` cookie is the single source of workspace context.** Every API route and service function reads this cookie to determine scope. Empty/missing = personal workspace. The cookie is already being set by the team creation dialog and invite acceptance flow.

2. **A shared `getActiveTeamId()` server utility reads the cookie.** Instead of every service function parsing cookies directly, a single helper in `lib/supabase/server.ts` reads the `active_team_id` cookie from the Next.js `cookies()` store. Service functions call this helper to scope queries.

3. **Workspace context is validated on read, not on write.** When the active workspace cookie points to a team the user is no longer a member of, the system treats it as "personal workspace" (clears the cookie via middleware). This avoids 403 errors and handles removal gracefully.

4. **The switcher is a client component in the header.** It fetches the user's teams from a new `GET /api/teams` endpoint and renders a dropdown. Switching sets the cookie and calls `router.refresh()` to re-render server components with the new context.

5. **Service-layer changes are deferred to Part 5.** Part 4 only builds the switcher UI and the context plumbing (cookie read helper, middleware validation, teams API). The actual query scoping in `session-service.ts`, `client-service.ts`, `master-signal-service.ts`, and `prompt-service.ts` is implemented in Parts 5–7 when team-scoped data flows are built.

### 4.2 Server Utility — Active Workspace Reader

**Modified file: `lib/supabase/server.ts`**

Add a new exported function:

```typescript
export async function getActiveTeamId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("active_team_id")?.value || null;
}
```

All service functions that need workspace context will import and call this helper. Returns `null` for personal workspace.

### 4.3 Middleware — Stale Team Validation

**Modified file: `middleware.ts`**

For authenticated users with an `active_team_id` cookie, the middleware validates that the user is still a member of that team. If not, it clears the cookie so the user falls back to personal workspace without an error.

```
Steps (after existing auth checks):
  1. Read active_team_id from request cookies
  2. If no active_team_id → continue (personal workspace)
  3. Query team_members for (team_id, user_id, removed_at IS NULL)
  4. If no matching row → clear active_team_id cookie on the response
  5. Continue with the (possibly modified) response
```

This adds one Supabase query per request for users with an active team — acceptable since middleware already makes a `getUser()` call. The check reuses the same Supabase client instance.

### 4.4 New API Route

**`GET /api/teams`** — List teams for the current user

```
Auth: Required.
Returns: { teams: Array<{ id, name, role }> }
Steps:
  1. Get user from session
  2. Fetch team_members where user_id = user.id AND removed_at IS NULL
  3. Fetch teams by those team_ids where deleted_at IS NULL
  4. For each team, include the user's role
  5. Return sorted by created_at ascending
```

This endpoint already has a route file for `POST /api/teams`. The `GET` handler is added to the same file.

### 4.5 Frontend — Workspace Switcher

**New file: `components/layout/workspace-switcher.tsx`**

A dropdown component placed in the app header between the logo and the tab navigation:

```
Structure:
  - Trigger: shows current workspace name ("Personal" or team name)
  - Dropdown content:
    - "Personal" option with a check icon if active
    - Divider
    - List of teams with name + role badge, check icon on active
  - Selecting an option sets the active_team_id cookie and calls router.refresh()
```

Visual details:
- Uses the existing `DropdownMenu` component from shadcn/ui
- Active workspace shows a check mark (`Check` icon from Lucide)
- Team entries show a small role badge (`admin` / `sales`)
- "Personal" is always the first option
- If the user has no teams, the switcher is not rendered — hidden entirely

**Cookie management (client-side):**

```typescript
function setActiveTeamCookie(teamId: string | null) {
  if (teamId) {
    document.cookie = `active_team_id=${teamId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } else {
    document.cookie = "active_team_id=; path=/; max-age=0; SameSite=Lax";
  }
}
```

Passing `null` clears the cookie (switches to personal workspace).

### 4.6 Header Integration

**Modified file: `components/layout/app-header.tsx`**

Insert the `WorkspaceSwitcher` between the logo and `TabNav`:

```
Before:
  <span>Synthesiser</span>
  <TabNav />

After:
  <span>Synthesiser</span>
  <WorkspaceSwitcher />
  <TabNav />
```

The switcher only renders when the user is authenticated and has at least one team membership. Solo users see no change in the header.

### 4.7 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Create | `components/layout/workspace-switcher.tsx` | Dropdown to switch between personal and team workspaces |
| Modify | `components/layout/app-header.tsx` | Integrate `WorkspaceSwitcher` between logo and tab nav |
| Modify | `lib/supabase/server.ts` | Add `getActiveTeamId()` helper |
| Modify | `middleware.ts` | Validate `active_team_id` cookie — clear if user is no longer a member |
| Modify | `app/api/teams/route.ts` | Add `GET` handler — list teams for current user with roles |

### 4.8 Implementation Increments

**Increment 4.1: Server utility + middleware validation**
- Add `getActiveTeamId()` to `lib/supabase/server.ts`
- Update `middleware.ts` to validate the `active_team_id` cookie against `team_members`
- If the user was removed from the team, clear the cookie silently
- Verify: setting an invalid `active_team_id` cookie results in it being cleared on next request

**Increment 4.2: Teams list API**
- Add `GET` handler to `app/api/teams/route.ts`
- Returns teams with the user's role in each
- Verify: authenticated user sees their teams, unauthenticated gets 401

**Increment 4.3: Workspace switcher UI**
- Create `components/layout/workspace-switcher.tsx`
- Integrate into `app-header.tsx`
- Fetches teams from `GET /api/teams` on mount
- Switching sets the cookie and refreshes the page
- Solo users (no teams) see no switcher
- Verify: switching workspaces changes the cookie value, page refreshes

**Verification:**
- Solo users (no team memberships) see no workspace switcher — header unchanged
- Users with teams see a switcher showing "Personal" + team names
- Switching to a team sets `active_team_id` cookie and refreshes the page
- Switching to "Personal" clears the `active_team_id` cookie
- Active workspace persists across page refreshes (cookie-based)
- If a user is removed from a team while it's active, next request clears the cookie silently
- Middleware validation does not break existing login, callback, or invite flows
- No regressions — personal workspace behavior unchanged when no cookie is set

---

## Part 5: Team-Scoped Data — Sessions and Clients

### 5.1 Technical Decisions

1. **Workspace context flows from cookie → service layer via `getActiveTeamId()`.** Every service function that reads or writes `sessions` or `clients` calls `getActiveTeamId()` and adds the appropriate `team_id` filter. `null` = personal workspace (existing behavior), non-null = team workspace.

2. **`createSession` and `createNewClient` set `team_id` based on active workspace.** The insert payload includes `team_id: activeTeamId` (null for personal). No API route changes needed — the service layer handles scoping transparently.

3. **RLS is the enforcement layer; service-level filters are the convenience layer.** Updated RLS policies on `sessions` and `clients` ensure that even if a service function omits a filter, users only see data they should. The dual approach (RLS + service filter) provides defense in depth.

4. **Session attribution uses a Supabase join to `profiles`.** When listing sessions in a team workspace, each session includes the email of the user who captured it. This is fetched via a join from `sessions.created_by` → `profiles.email`. Personal workspace sessions don't need this — they're all the current user's.

5. **Admin edit/delete permissions are checked at the API route level, not RLS.** RLS enforces visibility (team members can read all team sessions). Write permissions (sales can only edit/delete own, admins can edit/delete any) are checked in the `updateSession` and `deleteSession` API route handlers before calling the service. This avoids complex RLS write policies that would be hard to debug.

### 5.2 RLS Policy Updates

**`sessions` — drop and recreate policies**

```sql
-- Drop existing personal-only policies
DROP POLICY IF EXISTS "Users can read own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;

-- Personal sessions: team_id IS NULL, created_by = user
CREATE POLICY "Users can read own personal sessions"
  ON sessions FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND team_id IS NULL AND created_by = auth.uid());

-- Team sessions: team_id IS NOT NULL, user is a member
CREATE POLICY "Team members can read team sessions"
  ON sessions FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND team_id IS NOT NULL AND is_team_member(team_id));

-- Insert: personal or team member
CREATE POLICY "Users can insert sessions"
  ON sessions FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL) OR
    (team_id IS NOT NULL AND is_team_member(team_id))
  );

-- Update: personal (own) or team (own, or admin)
CREATE POLICY "Users can update sessions"
  ON sessions FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL AND (
      (team_id IS NULL AND created_by = auth.uid()) OR
      (team_id IS NOT NULL AND is_team_member(team_id) AND (
        created_by = auth.uid() OR is_team_admin(team_id)
      ))
    )
  )
  WITH CHECK (true);
```

**`clients` — drop and recreate policies**

```sql
-- Drop existing personal-only policies
DROP POLICY IF EXISTS "Users can read own clients" ON clients;
DROP POLICY IF EXISTS "Users can update own clients" ON clients;

-- Personal clients
CREATE POLICY "Users can read own personal clients"
  ON clients FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND team_id IS NULL AND created_by = auth.uid());

-- Team clients
CREATE POLICY "Team members can read team clients"
  ON clients FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND team_id IS NOT NULL AND is_team_member(team_id));

-- Insert: personal or team member
CREATE POLICY "Users can insert clients"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL) OR
    (team_id IS NOT NULL AND is_team_member(team_id))
  );

-- Update: personal (own) or team member
CREATE POLICY "Users can update clients"
  ON clients FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL AND (
      (team_id IS NULL AND created_by = auth.uid()) OR
      (team_id IS NOT NULL AND is_team_member(team_id))
    )
  )
  WITH CHECK (true);
```

### 5.3 Service Layer Changes

**`lib/services/session-service.ts`**

- `getSessions()` — reads `getActiveTeamId()`. If personal: existing behavior (RLS scopes to `created_by`). If team: adds `.eq("team_id", teamId)`. Also selects `created_by` for attribution. When in team context, uses a second query to fetch `profiles.email` for each unique `created_by` to display attribution.
- `createSession()` — reads `getActiveTeamId()` and includes `team_id` in the insert payload.
- `updateSession()` — no service changes needed. Permission checks happen at the API route level.
- `deleteSession()` — `taintLatestMasterSignal()` is updated to accept an optional `teamId` parameter. In team context, it taints the team's master signal instead of the user's personal one.

**`lib/services/client-service.ts`**

- `searchClients()` — reads `getActiveTeamId()`. If personal: existing behavior. If team: adds `.eq("team_id", teamId)` to filter team clients. The `hasSession` variant also scopes sessions by `team_id`.
- `createNewClient()` — reads `getActiveTeamId()` and includes `team_id` in the insert payload.

### 5.4 API Route Changes

**`app/api/sessions/[id]/route.ts`** — `PUT` and `DELETE` handlers

Add permission checks for team context:
- Read `active_team_id` cookie
- If team context: fetch the session's `created_by` and compare with the current user
  - If `created_by = user.id` → allow (any role)
  - If `created_by != user.id` → check if user is admin of the team → allow if admin, 403 if sales
- Personal context: existing behavior (RLS already scopes to own sessions)

**`app/api/sessions/route.ts`** — No changes needed. Service layer handles scoping.

**`app/api/clients/route.ts`** — No changes needed. Service layer handles scoping.

### 5.5 Frontend Changes

**`app/capture/_components/past-sessions-table.tsx`**

- In team context, each session row shows the creator's email/name alongside the client and date.
- The API response includes a `created_by_email` field when in team context.

**`app/capture/_components/expanded-session-row.tsx`**

- Edit and delete buttons are conditionally rendered:
  - Personal workspace: always visible (user owns all sessions)
  - Team workspace: visible if `created_by = currentUser.id` OR if current user is an admin

The frontend reads the `active_team_id` cookie and the user's role from the workspace switcher context or a prop to determine permissions.

### 5.6 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Modify | `lib/services/session-service.ts` | Add `team_id` scoping to `getSessions()`, `createSession()`; attribution query for team context |
| Modify | `lib/services/client-service.ts` | Add `team_id` scoping to `searchClients()`, `createNewClient()` |
| Modify | `lib/services/master-signal-service.ts` | `taintLatestMasterSignal()` accepts optional `teamId` |
| Modify | `app/api/sessions/[id]/route.ts` | Add admin permission check for team session edits/deletes |
| Modify | `app/capture/_components/past-sessions-table.tsx` | Show session attribution in team context |
| Modify | `app/capture/_components/expanded-session-row.tsx` | Conditional edit/delete based on ownership and role |
| Create | `docs/010-team-access/004-rls-sessions-clients-team.sql` | RLS migration for team-scoped sessions and clients |

### 5.7 Implementation Increments

**Increment 5.1: Database — RLS policies**
- Write and provide the SQL migration for updated RLS on `sessions` and `clients`
- User runs in Supabase SQL editor
- Verify: personal workspace queries still work, team queries return team-scoped data

**Increment 5.2: Service layer — session and client scoping**
- Modify `session-service.ts`: `getSessions()` and `createSession()` use `getActiveTeamId()`
- Modify `client-service.ts`: `searchClients()` and `createNewClient()` use `getActiveTeamId()`
- Modify `master-signal-service.ts`: `taintLatestMasterSignal()` accepts optional `teamId`
- Verify: sessions created in team context have `team_id` set; listing returns team-scoped data

**Increment 5.3: API routes — admin permission checks**
- Add admin check to `PUT` and `DELETE` in `app/api/sessions/[id]/route.ts`
- Sales members get 403 when editing/deleting others' team sessions
- Admins can edit/delete any team session
- Verify: permission matrix works (sales own, sales other → 403, admin other → OK)

**Increment 5.4: Frontend — attribution and permissions**
- Show creator email on session rows in team context
- Conditionally show edit/delete buttons based on ownership + role
- Verify: team members see all sessions with attribution, edit/delete controls respect roles

**Verification:**
- Sessions created in personal workspace have `team_id = NULL` — existing behavior
- Sessions created in team workspace have `team_id` set and are visible to all team members
- Clients created in team workspace are shared — all members see them in the combobox
- Sales members can only edit/delete their own team sessions
- Admins can edit/delete any team session
- Client name uniqueness is enforced per-team and per-user (personal)
- Session filters (client, date) work within team scope
- `taintLatestMasterSignal()` taints the team's signal when a team session is deleted
- No regressions in personal workspace

---

## Part 6: Team-Scoped Master Signal and Prompts

### 6.1 Technical Decisions

1. **Master signal scoping follows the same `getActiveTeamId()` pattern.** All functions in `master-signal-service.ts` read the active workspace and scope queries with `team_id`. Personal master signal behavior is unchanged when `team_id IS NULL`.

2. **Admin-only generation is checked at the API route level.** The `POST /api/ai/generate-master-signal` route checks the user's team role before proceeding. Sales members receive a 403. The frontend conditionally hides the generate button for sales members.

3. **Prompt scoping is transparent to the AI service.** `getActivePrompt()` reads `getActiveTeamId()` and queries for the team's active prompt (or the user's personal prompt). The AI service (`extractSignals`, `synthesiseMasterSignal`) calls `getActivePrompt()` which already returns the correct prompt for the active workspace — no AI service changes needed.

4. **Team prompts fallback to hardcoded defaults.** When no team-level prompt exists for a given key (e.g., freshly created team), `getActivePrompt()` returns `null` and the AI service uses the hardcoded default. This is the existing behavior — no special handling needed.

5. **Prompt save includes `team_id`.** When saving a new prompt version in team context, `savePromptVersion()` includes `team_id` in the insert. The deactivation step also scopes to the team (deactivate the team's current active prompt, not the user's personal one).

### 6.2 RLS Policy Updates

**`master_signals` — drop and recreate policies**

```sql
-- Drop existing personal-only policies
DROP POLICY IF EXISTS "Users can read own master signals" ON master_signals;
DROP POLICY IF EXISTS "Users can insert own master signals" ON master_signals;

-- Personal master signals
CREATE POLICY "Users can read own personal master signals"
  ON master_signals FOR SELECT TO authenticated
  USING (team_id IS NULL AND created_by = auth.uid());

-- Team master signals: any team member can read
CREATE POLICY "Team members can read team master signals"
  ON master_signals FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

-- Insert: personal (own) or team admin
CREATE POLICY "Users can insert master signals"
  ON master_signals FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL) OR
    (team_id IS NOT NULL AND is_team_admin(team_id))
  );
```

**`prompt_versions` — drop and recreate policies**

```sql
-- Drop existing personal-only policies
DROP POLICY IF EXISTS "Users can read own prompts" ON prompt_versions;
DROP POLICY IF EXISTS "Users can insert own prompts" ON prompt_versions;
DROP POLICY IF EXISTS "Users can update own prompts" ON prompt_versions;

-- Personal prompts
CREATE POLICY "Users can read own personal prompts"
  ON prompt_versions FOR SELECT TO authenticated
  USING (team_id IS NULL AND created_by = auth.uid());

-- Team prompts: any team member can read
CREATE POLICY "Team members can read team prompts"
  ON prompt_versions FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

-- Insert: personal (own) or team admin
CREATE POLICY "Users can insert prompts"
  ON prompt_versions FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL) OR
    (team_id IS NOT NULL AND is_team_admin(team_id))
  );

-- Update (deactivation): personal (own) or team admin
CREATE POLICY "Users can update prompts"
  ON prompt_versions FOR UPDATE TO authenticated
  USING (
    (team_id IS NULL AND created_by = auth.uid()) OR
    (team_id IS NOT NULL AND is_team_admin(team_id))
  )
  WITH CHECK (true);
```

### 6.3 Service Layer Changes

**`lib/services/master-signal-service.ts`**

All query functions add `team_id` scoping:

- `getLatestMasterSignal()` — reads `getActiveTeamId()`. Filters `.eq("team_id", teamId)` or `.is("team_id", null)` for personal.
- `getStaleSessionCount()` — scopes session count by `team_id`.
- `getAllSignalSessions()` — scopes by `team_id`.
- `getSignalSessionsSince()` — scopes by `team_id`.
- `saveMasterSignal()` — includes `team_id` in insert payload.
- `taintLatestMasterSignal()` — already updated in Part 5 to accept optional `teamId`; when provided, taints the team's latest signal instead of filtering by `created_by`.

**`lib/services/prompt-service.ts`**

- `getActivePrompt()` — reads `getActiveTeamId()`. If team: queries where `team_id = teamId`. If personal: existing behavior (RLS scopes to `created_by`).
- `getPromptHistory()` — same scoping pattern.
- `savePromptVersion()` — reads `getActiveTeamId()`. If team: includes `team_id` in insert and scopes deactivation to the team. If personal: existing behavior.

### 6.4 API Route Changes

**`app/api/ai/generate-master-signal/route.ts`**

Add admin check before generation:
- Read `active_team_id` cookie (via `getActiveTeamId()`)
- If team context: verify user is an admin of the team → 403 if not
- Personal context: no role check needed (user generates their own)

**`app/api/master-signal/route.ts`**

No changes needed — `getLatestMasterSignal()` and `getStaleSessionCount()` handle scoping internally via `getActiveTeamId()`.

**`app/api/prompts/route.ts`**

Add admin check for `POST` (save prompt) in team context:
- If team context: verify user is an admin → 403 if not
- `GET` (read) requires no role check — all team members can view prompts

### 6.5 Frontend Changes

**`app/m-signals/_components/master-signal-page-content.tsx`**

- In team context with a sales role: hide the "Generate" / "Regenerate" button, show a message like "Only admins can generate the master signal."
- PDF download remains visible to all team members.
- The component reads the user's role from the workspace context to determine visibility.

**`app/settings/_components/settings-page-content.tsx`**

- Already conditionally renders based on team context and admin role (implemented in Part 2).
- Sales members in a team context: show prompts in read-only mode with an info message.
- No structural changes needed — the existing `showTeamTab` logic handles this.

**`app/settings/_components/prompt-editor-page-content.tsx`**

- Accept a `readOnly` prop. When true: textarea is disabled, save button is hidden, and an info message explains that only admins can edit prompts.
- `SettingsPageContent` passes `readOnly={!teamCtx.isAdmin}` when rendering in team context for non-admin users.

### 6.6 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Modify | `lib/services/master-signal-service.ts` | Add `team_id` scoping to all query and save functions |
| Modify | `lib/services/prompt-service.ts` | Add `team_id` scoping to `getActivePrompt()`, `getPromptHistory()`, `savePromptVersion()` |
| Modify | `app/api/ai/generate-master-signal/route.ts` | Add admin role check for team context |
| Modify | `app/api/prompts/route.ts` | Add admin role check for `POST` in team context |
| Modify | `app/m-signals/_components/master-signal-page-content.tsx` | Hide generate button for sales; show read-only message |
| Modify | `app/settings/_components/prompt-editor-page-content.tsx` | Accept `readOnly` prop; disable editing for non-admins |
| Modify | `app/settings/_components/settings-page-content.tsx` | Pass `readOnly` to prompt editor when user is not admin |
| Create | `docs/010-team-access/005-rls-master-signals-prompts-team.sql` | RLS migration for team-scoped master signals and prompts |

### 6.7 Implementation Increments

**Increment 6.1: Database — RLS policies**
- Write and provide the SQL migration for updated RLS on `master_signals` and `prompt_versions`
- User runs in Supabase SQL editor
- Verify: personal workspace queries still work, team queries return team-scoped data

**Increment 6.2: Service layer — master signal scoping**
- Modify `master-signal-service.ts`: all functions use `getActiveTeamId()` for team scoping
- `saveMasterSignal()` includes `team_id` in insert
- `taintLatestMasterSignal()` scopes by `team_id` when provided
- Verify: generating master signal in team context creates a team-scoped row

**Increment 6.3: Service layer — prompt scoping**
- Modify `prompt-service.ts`: `getActivePrompt()`, `getPromptHistory()`, `savePromptVersion()` scope by `team_id`
- Deactivation step in `savePromptVersion()` scopes to team context
- Verify: prompts saved in team context have `team_id`; reading returns team prompts

**Increment 6.4: API routes — admin checks**
- Add admin role check to `POST /api/ai/generate-master-signal`
- Add admin role check to `POST /api/prompts`
- Sales members get 403 in team context
- Personal context: no change
- Verify: sales → 403, admin → success

**Increment 6.5: Frontend — read-only modes**
- `MasterSignalPageContent`: hide generate button for sales, show info message
- `PromptEditorPageContent`: accept `readOnly` prop, disable editing for non-admins
- `SettingsPageContent`: pass `readOnly` for non-admin team members
- Verify: sales see master signal and prompts in read-only; admins have full control

**Verification:**
- Master signal in personal workspace is scoped to user's sessions — unchanged
- Master signal in team workspace synthesises from all team sessions
- Only admins can generate/regenerate team master signal
- Sales members see master signal read-only with info message
- PDF download works for all team members
- Prompts in personal workspace are per-user — unchanged
- Prompts in team workspace are shared — one active set per team
- Only admins can edit team prompts
- Sales members see prompts read-only with info message
- New teams with no custom prompts fall back to hardcoded defaults
- Staleness count and tainted flag are correctly scoped by team
- No regressions in personal workspace for master signal or prompts

---

## Part 7: Team Management — Members, Roles, and Ownership

### 7.1 API Routes

**`app/api/teams/[teamId]/route.ts`** (new)

Handles team-level operations: reading team details, renaming, and deleting.

- `GET /api/teams/[teamId]` — Returns the team object including `owner_id` and the full member list (with profile data: email). Requires active membership.
- `PATCH /api/teams/[teamId]` — Rename the team. Body: `{ name: string }`. Only the owner can rename. Returns the updated team.
- `DELETE /api/teams/[teamId]` — Soft-delete the team (sets `deleted_at`). Only the owner can delete. Clears `active_team_id` cookie for any member who has this team active (handled client-side on next request via existing middleware validation).

Zod schemas:

```typescript
const renameTeamSchema = z.object({
  name: z.string().min(1).max(100),
});
```

**`app/api/teams/[teamId]/members/route.ts`** (new)

- `GET /api/teams/[teamId]/members` — Returns all active members with their profile data (email, name). Joins `team_members` with `profiles` to include `email`. Any team member can read.

**`app/api/teams/[teamId]/members/[userId]/route.ts`** (new)

- `DELETE /api/teams/[teamId]/members/[userId]` — Remove a member from the team. Sets `team_members.removed_at`. Permission logic:
  - Owner can remove anyone except themselves (use "leave" flow instead).
  - Admin can remove sales members only.
  - Sales cannot remove anyone.
  - Returns 403 with a descriptive message for unauthorized attempts.

**`app/api/teams/[teamId]/members/[userId]/role/route.ts`** (new)

- `PATCH /api/teams/[teamId]/members/[userId]/role` — Change a member's role. Body: `{ role: "admin" | "sales" }`. Only the owner can change roles. Cannot change own role (owner is always admin).

Zod schema:

```typescript
const changeRoleSchema = z.object({
  role: z.enum(["admin", "sales"]),
});
```

**`app/api/teams/[teamId]/transfer/route.ts`** (new)

- `POST /api/teams/[teamId]/transfer` — Transfer ownership. Body: `{ newOwnerId: string }`. Only the current owner can transfer. If the new owner is a sales member, they are promoted to admin. The previous owner retains admin role. Updates `teams.owner_id`.

Zod schema:

```typescript
const transferOwnershipSchema = z.object({
  newOwnerId: z.string().uuid(),
});
```

**`app/api/teams/[teamId]/leave/route.ts`** (new)

- `POST /api/teams/[teamId]/leave` — Current user leaves the team. Sets `team_members.removed_at` on their own row.
  - If the user is the owner:
    - If there are other admin members: ownership auto-transfers to the admin with the earliest `joined_at`, then the owner's membership is removed.
    - If there are no other admins: returns 400 with message "You must promote another member to admin before leaving, or delete the team."
  - If the user is not the owner: straightforward removal.
  - If the team was the user's active workspace, the response instructs the client to clear the `active_team_id` cookie.

### 7.2 Service Layer

**`lib/services/team-service.ts`** — add the following functions:

```typescript
// Rename a team (owner only — checked at route level)
export async function renameTeam(teamId: string, name: string): Promise<Team>

// Soft-delete a team (owner only — checked at route level)
export async function deleteTeam(teamId: string): Promise<void>

// Remove a member (sets removed_at)
export async function removeMember(teamId: string, userId: string): Promise<void>

// Change a member's role
export async function changeMemberRole(
  teamId: string,
  userId: string,
  role: "admin" | "sales"
): Promise<void>

// Transfer ownership — updates teams.owner_id, promotes transferee to admin if needed
export async function transferOwnership(
  teamId: string,
  newOwnerId: string
): Promise<void>

// Leave team — handles auto-transfer logic for owner departure
export async function leaveTeam(
  teamId: string,
  userId: string,
  isOwner: boolean
): Promise<{ autoTransferredTo?: string }>
```

`removeMember` uses `createServiceRoleClient()` to bypass RLS (similar to how `deleteSession` works — the update sets `removed_at` which would violate a `WITH CHECK` constraint through the regular client).

`transferOwnership` is a two-step operation:
1. If the new owner's current role is `sales`, update to `admin`.
2. Update `teams.owner_id` to the new owner's user ID.

`leaveTeam` logic:
1. If `isOwner`:
   a. Fetch all active admins (`role = 'admin' AND removed_at IS NULL AND user_id != userId`).
   b. If none exist, throw an error (blocked).
   c. Pick the earliest by `joined_at`, call `transferOwnership`.
   d. Set `removed_at` on the owner's membership row.
2. If not owner: set `removed_at` on the user's membership row.
3. Return `{ autoTransferredTo }` if a transfer happened (for logging/notification).

### 7.3 Frontend

**`app/settings/_components/team-settings.tsx`** — updated

Currently this component has three sections: single invite, bulk invite, and pending invitations. Add a new section **above** the invite sections:

1. **Team Info & Danger Zone** — shows team name with a rename input (owner only), and a "Delete Team" button (owner only) with confirmation dialog.
2. **Members List** — table of all active team members with columns: Email, Role, Joined, Actions.
3. Existing invite sections remain below.

The component now receives additional props: `isOwner: boolean`, `isAdmin: boolean`, `ownerId: string`.

**`app/settings/_components/team-members-table.tsx`** (new)

Props:
```typescript
interface TeamMembersTableProps {
  teamId: string;
  ownerId: string;
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
  refreshKey: number;
  onMemberChanged: () => void;
}
```

Fetches members from `GET /api/teams/[teamId]/members` on mount and when `refreshKey` changes. Renders a table:

| Email | Role | Joined | Actions |
|-------|------|--------|---------|

- The owner row shows an "Owner" badge next to the role.
- Actions column (contextual):
  - **Owner viewing a non-owner member:** "Remove" button + "Change Role" dropdown + "Transfer Ownership" button (with confirmation dialog).
  - **Admin viewing a sales member:** "Remove" button.
  - **All members viewing themselves:** "Leave Team" button (red text, with confirmation). If the user is the owner and no other admins exist, the button is disabled with a tooltip explaining they must promote someone first.
  - **Sales viewing others:** no actions.

Role change uses a `<Select>` inline or a dropdown with "Admin" / "Sales" options. On change, calls `PATCH /api/teams/[teamId]/members/[userId]/role`.

Remove calls `DELETE /api/teams/[teamId]/members/[userId]` with a confirmation dialog ("Remove {email} from the team?").

Transfer ownership calls `POST /api/teams/[teamId]/transfer` with a confirmation dialog ("Transfer ownership to {email}? You will remain as an admin.").

Leave calls `POST /api/teams/[teamId]/leave` with a confirmation dialog. On success:
- Clear `active_team_id` cookie.
- Redirect to `/capture` (personal workspace).

**`app/settings/_components/team-danger-zone.tsx`** (new)

Props:
```typescript
interface TeamDangerZoneProps {
  teamId: string;
  teamName: string;
  isOwner: boolean;
  onTeamRenamed: (newName: string) => void;
  onTeamDeleted: () => void;
}
```

Renders:
- **Rename:** An inline text input pre-filled with the current team name and a "Rename" button. Only visible to the owner. Calls `PATCH /api/teams/[teamId]`.
- **Delete:** A destructive "Delete Team" button (owner only) with a confirmation dialog that requires typing the team name to confirm. Calls `DELETE /api/teams/[teamId]`. On success: clears `active_team_id` cookie, redirects to `/capture`.

**`app/settings/_components/settings-page-content.tsx`** — updated

Pass `isOwner` and `ownerId` to `TeamSettings`:
- Resolve `isOwner` by comparing `teamCtx.ownerId` with `user.id`.
- Add `ownerId` to the `TeamContext` interface (fetched alongside team data).

### 7.4 Files Changed / Created

| Action | File | Details |
|--------|------|---------|
| Create | `app/api/teams/[teamId]/route.ts` | GET, PATCH (rename), DELETE (soft-delete) |
| Create | `app/api/teams/[teamId]/members/route.ts` | GET — list active members with profiles |
| Create | `app/api/teams/[teamId]/members/[userId]/route.ts` | DELETE — remove member |
| Create | `app/api/teams/[teamId]/members/[userId]/role/route.ts` | PATCH — change role |
| Create | `app/api/teams/[teamId]/transfer/route.ts` | POST — transfer ownership |
| Create | `app/api/teams/[teamId]/leave/route.ts` | POST — leave team |
| Modify | `lib/services/team-service.ts` | Add `renameTeam`, `deleteTeam`, `removeMember`, `changeMemberRole`, `transferOwnership`, `leaveTeam` |
| Create | `app/settings/_components/team-members-table.tsx` | Members list with role/remove/transfer/leave actions |
| Create | `app/settings/_components/team-danger-zone.tsx` | Rename + delete team (owner only) |
| Modify | `app/settings/_components/team-settings.tsx` | Integrate members table and danger zone, accept new props |
| Modify | `app/settings/_components/settings-page-content.tsx` | Resolve and pass `isOwner`, `ownerId` to `TeamSettings` |

### 7.5 Implementation Increments

**Increment 7.1: Service layer — team management functions**
- Add `renameTeam`, `deleteTeam`, `removeMember`, `changeMemberRole`, `transferOwnership`, `leaveTeam` to `team-service.ts`
- Verify: functions work with service role client where needed

**Increment 7.2: API routes — team operations**
- Create `app/api/teams/[teamId]/route.ts` (GET, PATCH, DELETE)
- Create `app/api/teams/[teamId]/members/route.ts` (GET)
- Create `app/api/teams/[teamId]/members/[userId]/route.ts` (DELETE)
- Create `app/api/teams/[teamId]/members/[userId]/role/route.ts` (PATCH)
- Create `app/api/teams/[teamId]/transfer/route.ts` (POST)
- Create `app/api/teams/[teamId]/leave/route.ts` (POST)
- All routes validate auth, team membership, and role permissions
- Verify: correct 403s for unauthorized actions, correct 200/204 for authorized actions

**Increment 7.3: Frontend — members table**
- Create `team-members-table.tsx` with member list, role badges, action buttons
- Integrate into `team-settings.tsx`
- Wire up remove, role change, transfer, and leave actions
- Update `settings-page-content.tsx` to resolve and pass `isOwner`, `ownerId`
- Verify: members table shows all team members, actions work correctly per role

**Increment 7.4: Frontend — danger zone (rename + delete)**
- Create `team-danger-zone.tsx` with rename input and delete button
- Owner-only visibility enforced in `team-settings.tsx`
- Delete requires typing team name to confirm
- On delete: clear cookie, redirect to `/capture`
- Verify: rename updates team name, delete soft-deletes and redirects

**Verification:**
- Owner can rename and delete the team
- Owner can remove any member (admin or sales)
- Owner can change any member's role
- Owner can transfer ownership — new owner becomes admin, old owner stays admin
- Admin can remove sales members but not other admins
- Sales members see no management actions (except leave)
- All members can leave the team
- Owner leaving auto-transfers to the oldest admin
- Owner blocked from leaving when no other admins exist
- Removed/left members are switched to personal workspace
- Data from removed members stays with the team (verified by Part 8)
- No regressions in invite flow or workspace switching

---

## Part 8: Data Retention on Member Departure

### 8.1 Design Rationale

Part 8 requires **no new code**. The existing architecture already satisfies all data retention requirements by design. This part serves as a verification checklist confirming the behavior.

Key design decisions that make this work:

1. **`team_id` on data tables, not `user_id` ownership.** Sessions, clients, master signals, and prompt versions are scoped to the team via `team_id`. They are **not** deleted or orphaned when a member departs — `removeMember()` only sets `team_members.removed_at`, which has no cascade or trigger on data tables.

2. **`created_by` is preserved as attribution, not as an access gate.** The `created_by` column on sessions and clients identifies who captured the data. RLS policies for team data check `is_team_member(team_id)`, not `created_by = auth.uid()`. Departed members' sessions remain visible to the team because the RLS condition is team membership, not authorship.

3. **RLS enforces access revocation automatically.** The `is_team_member(team_id)` function checks `removed_at IS NULL`. Once a member's `removed_at` is set, all RLS policies that reference this function will exclude them — they lose read and write access to team data without any explicit revocation step.

4. **Re-joining creates a new `team_members` row.** The `acceptInvitation()` function in `invitation-service.ts` checks for existing active membership before inserting. If a departed member (who has `removed_at` set) is re-invited, a new `team_members` row is created with `removed_at = NULL`. The unique index `(team_id, user_id) WHERE removed_at IS NULL` allows this because the old row has `removed_at` set. The rejoined member sees all team data — including their own old sessions — because RLS scopes by `team_id` membership, not by individual `created_by`.

5. **Master signal includes all team sessions.** `getAllSignalSessions()` and `getSignalSessionsSince()` filter by `team_id` and `deleted_at IS NULL`, not by `created_by`. A departed member's sessions continue to contribute to the team's master signal as long as the sessions are not soft-deleted.

### 8.2 Requirement Mapping

| PRD Requirement | How It's Satisfied |
|---|---|
| **P8.R1** Sessions from departed members remain, attributed to original creator | `sessions.team_id` stays set; `sessions.created_by` is immutable; RLS checks team membership, not authorship |
| **P8.R2** Clients from departed members remain accessible | `clients.team_id` stays set; same RLS pattern as sessions |
| **P8.R3** Departed member's sessions contribute to master signal | `getAllSignalSessions()` / `getSignalSessionsSince()` scope by `team_id`, not `created_by` |
| **P8.R4** Departed member loses access to team data | `is_team_member()` returns `false` once `removed_at` is set; all team RLS policies deny access |
| **P8.R5** Re-joining shows all team data including old contributions | New `team_members` row with `removed_at = NULL` restores `is_team_member()` → full team data visible again |

### 8.3 Files Changed / Created

None. Part 8 is satisfied by the existing implementation from Parts 1–7.

### 8.4 Implementation Increments

**Increment 8.1: Verification only**
- No code changes required
- Manually verify each requirement by testing the following scenarios:
  1. Remove a member who has sessions → confirm their sessions remain visible to team
  2. Generate master signal → confirm it includes the departed member's sessions
  3. Sign in as the departed member → confirm they see only their personal workspace, not team data
  4. Re-invite the departed member → confirm they see all team data again after accepting
  5. Confirm `created_by_email` attribution still resolves correctly for the departed member's sessions (the `profiles` table retains their record)

**Verification:**
- Sessions from departed members are visible in the team workspace
- Client names from departed members appear in comboboxes
- Master signal synthesises across all team sessions regardless of member status
- Departed members see only personal workspace when signing in
- Re-joining via new invite restores full team data access
- Attribution (captured by) shows correctly for all sessions
- No orphaned or inaccessible data after member departure
