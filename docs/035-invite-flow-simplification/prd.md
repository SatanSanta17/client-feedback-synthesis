# PRD-035: Invite Flow Simplification

> **Status:** Draft — pending approval
> **Depends on:** PRD-010 (Team Access), PRD-011 (Email + Password Auth)
> **Deliverable:** Remove the intermediate invitation acceptance page so invited users land in the right place in one click — straight into the workspace if already signed in, straight to login or signup with invite context if not — and stop sending a redundant verification email to invited new users.

## Purpose

Today an invited user clicks a link in their email and lands on an interstitial page (`/invite/{token}`) that asks them to do a second action — click "Accept & Join Team", or fill in a sign-in/sign-up form embedded in the page. New users then have to wait for and click a verification email on top of that. This is two extra clicks (and for new users, a second email) for what is fundamentally one decision the user already made when they clicked the original invite.

This PRD collapses the invite flow so that a single click on the email CTA resolves to the correct destination based on the user's auth state, and removes the verification email for invited signups since clicking the invite already proves email ownership.

## User Story

As an invited user, I want one click on the invite email to take me directly where I need to go — into the workspace if I'm already signed in with the right account, or to a sign-in / sign-up screen pre-pointed at the invitation if I'm not — without an extra "accept" button or a second verification email.

As a workspace admin, I want invitations to be marked accepted only once the user has actually joined the team, so the pending-invitations list reflects reality.

---

## Part 1: Single-Click Acceptance for Signed-In Users

**Scope:** When the invited user is already signed in with the matching email, the invite link takes them straight into the invited team's workspace. No interstitial page, no "Accept" button.

### Requirements

**P1.R1 — Auto-accept on email match.** When an authenticated user opens an invite link and their account email matches the invited email, the invitation is accepted automatically and the user is taken directly to the team's primary workspace landing page (today: `/dashboard` for returning users, `/capture` for users with no sessions yet — same rule as the post-login redirect).

**P1.R2 — Active team is set on accept.** Accepting via this path makes the invited team the user's active team (i.e. the workspace they land in is the one they were invited to, not whatever team they had open before).

**P1.R3 — Acceptance is recorded only after team membership exists.** The invitation is marked accepted only after the user has been added as a team member. A click on the invite link alone does not mark the invitation accepted — the membership write must succeed first.

**P1.R4 — No "Accept & Join" page.** The dedicated acceptance card / button page is removed entirely for this case.

### Acceptance Criteria

- [ ] P1.AC1 — A signed-in user with the matching email clicking an invite link lands directly in the invited team's workspace
- [ ] P1.AC2 — The invited team is the active team after acceptance (workspace switcher reflects this)
- [ ] P1.AC3 — `accepted_at` is set in the same operation that adds team membership
- [ ] P1.AC4 — There is no intermediate "Accept & Join Team" screen in this path
- [ ] P1.AC5 — Pending-invitations admin list no longer shows this invitation after the user lands

---

## Part 2: Direct Routing for Signed-Out Users

**Scope:** When the invited user is not signed in, the invite link routes them directly to the login or signup screen (whichever applies) with the invitation context preserved in the URL. After they authenticate, they're taken straight into the invited team's workspace.

### Requirements

**P2.R1 — Existing account, signed out → login.** If the invited email belongs to an existing account, the invite link routes the user to the login page with the invitation context attached in the URL. The user signs in (email + password or Google), and on success is taken directly into the invited team's workspace with the invitation accepted.

**P2.R2 — No existing account → signup.** If the invited email does not belong to an existing account, the invite link routes the user to the signup page with the invitation context attached in the URL. After they complete signup, they are taken directly into the invited team's workspace.

**P2.R3 — Email is fixed by the invitation.** On both login and signup when accessed through an invite link, the email field is pre-filled with the invited email and is read-only. The user cannot change it. This guarantees the account they authenticate as matches the invitation.

**P2.R4 — Invitation context is URL-driven.** The mechanism that carries the invitation across the login or signup hop is a URL parameter, not a cookie or session storage. There is no stale state to clean up after a failed or abandoned attempt.

**P2.R5 — Invitation context survives OAuth round-trip.** If the user picks Google sign-in / sign-up from an invite-routed login or signup page, the invitation context is preserved across the OAuth redirect so the invited team is still the post-auth destination.

**P2.R6 — Acceptance is recorded only after authentication and email match.** The invitation is marked accepted only after the user successfully authenticates and the resulting account email matches the invitation email. A user opening the login page from an invite link but never completing sign-in does not mark the invitation accepted.

**P2.R7 — Login / signup remain usable without an invite.** Direct visits to `/login` and `/signup` (no invite context) behave exactly as today.

### Acceptance Criteria

- [ ] P2.AC1 — Signed-out invited user with an existing account lands on the login page with email pre-filled and read-only
- [ ] P2.AC2 — Signed-out invited user with no existing account lands on the signup page with email pre-filled and read-only
- [ ] P2.AC3 — On successful login from an invite-routed login page, user lands in the invited team's workspace
- [ ] P2.AC4 — On successful signup from an invite-routed signup page, user lands in the invited team's workspace
- [ ] P2.AC5 — Choosing Google sign-in / sign-up from an invite-routed page preserves the invitation context across the OAuth bounce
- [ ] P2.AC6 — Abandoning the flow (closing the tab, failing the password) does not mark the invitation accepted
- [ ] P2.AC7 — Direct (non-invite) login and signup are unchanged

---

## Part 3: No Verification Email for Invited Signups

**Scope:** Skip the email verification step for users signing up via an invitation. Clicking the invite link is itself proof of email ownership.

### Requirements

**P3.R1 — No verification email on invited signup.** A new user completing signup through an invite link is not sent a verification email. Their email is treated as confirmed at the moment of signup.

**P3.R2 — Direct sign-in after invited signup.** After completing the invite-routed signup form, the user is signed in immediately and lands in the invited team's workspace. No "check your email" screen, no second click required.

**P3.R3 — Verification still required for non-invite signups.** A direct (non-invite) signup at `/signup` continues to send a verification email and require confirmation before the user can sign in. This requirement is unchanged.

**P3.R4 — Invitation must be valid and unaccepted.** Skipping verification only happens when the signup is genuinely tied to a valid, unexpired, unaccepted invitation matching the email being signed up. Any of: invalid token, expired invitation, already-accepted invitation, mismatched email — falls back to the normal verification flow or an error state.

### Acceptance Criteria

- [ ] P3.AC1 — A new user completing signup from an invite link receives no verification email
- [ ] P3.AC2 — That user is signed in immediately and lands in the invited team's workspace
- [ ] P3.AC3 — A direct signup at `/signup` (no invite) still receives and requires a verification email
- [ ] P3.AC4 — Attempting to use the invite-signup path with an invalid / expired / already-accepted token fails cleanly without creating an unverified account

---

## Part 4: Mismatch and Error States

**Scope:** Keep small, focused screens for the cases the simplified flow cannot silently resolve: a user signed in with the wrong account, and invitations that are invalid, expired, or already accepted.

### Requirements

**P4.R1 — Email mismatch screen.** When an authenticated user opens an invite link but their account email does not match the invited email, they see a screen that:
- States clearly that the invitation is for `invited@email.com` and they're signed in as `you@email.com`
- Offers a "Sign out and continue as `invited@email.com`" action
- Does not silently auto-accept and does not give an option to accept as the wrong account

**P4.R2 — Sign-out from mismatch resumes the invite.** Clicking the sign-out action on the mismatch screen signs the user out and routes them through the invite flow again — i.e. they end up on the login or signup screen for the invited email, with the invitation context still attached.

**P4.R3 — Invalid invitation screen.** A token that does not exist (typo, wrong link, never issued) shows an "Invalid invitation" screen with a clear message and no auth action.

**P4.R4 — Expired invitation screen.** A token that exists but is past its expiry shows an "Invitation expired" screen with a clear message and no auth action.

**P4.R5 — Already-accepted screen.** A token whose invitation has already been accepted shows an "Already accepted" screen with a link back to sign in (so a user with the matching account can still get into the team via the normal route).

### Acceptance Criteria

- [ ] P4.AC1 — A signed-in user with a mismatched email sees the mismatch screen with both emails surfaced clearly
- [ ] P4.AC2 — The sign-out action on the mismatch screen returns the user to the invite flow for the correct email
- [ ] P4.AC3 — An invalid token shows the invalid-invitation screen
- [ ] P4.AC4 — An expired token shows the expired-invitation screen
- [ ] P4.AC5 — An already-accepted token shows the already-accepted screen with a path back to sign-in

---

## Part 5: Cleanup

**Scope:** Once the new flow is in place, remove the parts of the old flow that no longer have a job.

### Requirements

**P5.R1 — Remove the embedded sign-in and sign-up forms on the invite page.** Authentication for invited users happens on `/login` and `/signup` (with invite context), not duplicated inside the invite page.

**P5.R2 — Remove the "Accept & Join Team" card.** Acceptance happens automatically; there is no longer a button-driven acceptance step for any user.

**P5.R3 — Remove the cookie-based invite-context mechanism.** The simplified flow uses a URL parameter (P2.R4) end-to-end. Any cookie used to persist the invitation across redirects is removed once nothing reads it.

**P5.R4 — Update documentation.** `ARCHITECTURE.md` invite-flow section and `CHANGELOG.md` reflect the simplified flow once the change ships.

### Acceptance Criteria

- [ ] P5.AC1 — Invite-page sign-in / sign-up form components are removed from the codebase
- [ ] P5.AC2 — The accept-card component and its API endpoint are removed (or repurposed) — no UI reaches them
- [ ] P5.AC3 — The cookie previously used to carry invitation context across auth is no longer set or read anywhere
- [ ] P5.AC4 — `ARCHITECTURE.md` invite-flow section is rewritten to describe the new flow
- [ ] P5.AC5 — `CHANGELOG.md` has an entry for PRD-035

---

## Backlog (out of scope for v1)

- Decline-invitation explicit action (today, ignoring the email is the only "decline")
- Multi-invitation handling — show all pending invitations on first login if a user has more than one
- Inline preview of team members or recent activity on the invite landing for context before authenticating
- Invitation analytics (sent / opened / accepted / expired) for admins
- Magic-link variant of invited signup (one-click, no password set up front)
- Passkey / SSO support on invited signups
- Custom-branded invite emails per workspace
