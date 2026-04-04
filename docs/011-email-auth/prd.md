# PRD-011: Email + Password Authentication

> **Status:** Draft

## Purpose

Currently Synthesiser only supports Google OAuth for authentication. This limits adoption — users with non-Google email addresses (custom domains, Microsoft, etc.) cannot sign in at all. Adding email + password authentication makes the product accessible to anyone with an email address, which is critical for enterprise adoption.

This PRD also fixes a security gap in the invite flow: the current OAuth redirect path does not verify that the authenticated user's email matches the invited email, allowing any Google account to accept an invitation meant for someone else.

## User Story

As a user with a custom email domain, I want to sign up and sign in with my email and password, so that I can use Synthesiser without needing a Google account.

As an invited user, I want the invite page to pre-fill my email and guide me to sign in or sign up, so that I join the team with the correct account.

---

## Part 1: Email + Password Sign-Up and Sign-In

### Requirements

**P1.R1 — Sign-up page.** A new `/signup` page allows users to create an account with email and password. Fields: email (required, valid email), password (required, minimum 8 characters with 1 integer and 1 special character), confirm password (required, must match). On submit, calls `supabase.auth.signUp({ email, password })`. On success, shows a "Check your email" confirmation message. On error (e.g., email already in use), shows inline error.

**P1.R2 — Email confirmation.** After sign-up, Supabase sends a confirmation email with a link. The link redirects to `/auth/callback` which exchanges the code for a session and redirects to `/capture`. Unconfirmed users cannot sign in. The confirmation email template is configured in the Supabase dashboard — no custom email sending needed (Supabase handles this internally).

**P1.R3 — Updated login page.** The existing `/login` page is updated to include an email + password form above the Google OAuth button. Fields: email (required), password (required). On submit, calls `supabase.auth.signInWithPassword({ email, password })`. On error (invalid credentials, email not confirmed), shows inline error. A "Forgot password?" link navigates to `/forgot-password`. A "Don't have an account? Sign up" link navigates to `/signup`.

**P1.R4 — Updated sign-up page links.** The `/signup` page includes a "Already have an account? Sign in" link to `/login` and a Google OAuth button below the form as an alternative sign-up method.

**P1.R5 — Google OAuth remains.** The existing Google OAuth sign-in button remains on both `/login` and `/signup` pages. It works exactly as before. Users can use either method to authenticate.

### Acceptance Criteria

- [ ] P1.AC1 — A new user can sign up with email + password at `/signup`
- [ ] P1.AC2 — After sign-up, the user sees a "Check your email" confirmation message
- [ ] P1.AC3 — Clicking the confirmation link in the email signs the user in and redirects to `/capture`
- [ ] P1.AC4 — An existing user can sign in with email + password at `/login`
- [ ] P1.AC5 — Invalid credentials show an inline error message (not a toast)
- [ ] P1.AC6 — Attempting to sign in with an unconfirmed email shows an appropriate error
- [ ] P1.AC7 — Google OAuth continues to work on both pages
- [ ] P1.AC8 — Navigation links between `/login` and `/signup` work correctly

---

## Part 2: Password Reset Flow

### Requirements

**P2.R1 — Forgot password page.** A new `/forgot-password` page with a single email field. On submit, calls `supabase.auth.resetPasswordForEmail(email, { redirectTo })`. Shows a "Check your email" message regardless of whether the email exists (to prevent enumeration). A "Back to sign in" link navigates to `/login`.

**P2.R2 — Password reset callback.** The reset email link redirects to `/auth/callback` with a `type=recovery` parameter. The callback detects this and redirects to `/reset-password` instead of `/capture`.

**P2.R3 — Reset password page.** A new `/reset-password` page with new password and confirm password fields. On submit, calls `supabase.auth.updateUser({ password })`. On success, redirects to `/capture` with a toast "Password updated successfully". On error, shows inline error. This page is only accessible with a valid recovery session — if no session exists, redirects to `/login`.

### Acceptance Criteria

- [ ] P2.AC1 — User can request a password reset from `/forgot-password`
- [ ] P2.AC2 — Password reset email is received with a valid link
- [ ] P2.AC3 — Clicking the reset link lands on `/reset-password` with a valid session
- [ ] P2.AC4 — User can set a new password and is redirected to `/capture`
- [ ] P2.AC5 — Accessing `/reset-password` without a recovery session redirects to `/login`

---

## Part 3: Invite Flow — Email Match Verification and Auth Choice

### Requirements

**P3.R1 — Email match on OAuth invite acceptance.** The auth callback (`/auth/callback`) must verify that the authenticated user's email matches the pending invitation's email before accepting. If emails don't match, the invitation is not accepted and the user is redirected to `/capture` with an error query param. The invite page displays this error as a toast.

**P3.R2 — Invite page shows auth options with pre-filled email.** When an unauthenticated user visits `/invite/[token]`, the page displays:
- The team name and role (as today)
- An email + password form with the invited email pre-filled and **read-only**
- A "Sign in" or "Sign up" submit button (label depends on whether the email exists — see P3.R3)
- A Google OAuth button below as an alternative ("Or continue with Google")

**P3.R3 — Sign-in vs sign-up detection.** The invite page checks whether the invited email already exists as a Supabase user (via a lightweight server-side check or API call). If the user exists, the form shows "Sign in" with email + password fields. If the user does not exist, the form shows "Create account" with email + password + confirm password fields. In both cases, the email is pre-filled and read-only.

**P3.R4 — Invite sign-up flow.** When a new user signs up from the invite page, the `pending_invite_token` cookie is set before calling `supabase.auth.signUp()`. After email confirmation and callback, the invitation is auto-accepted (same as current OAuth flow, but with email match verification from P3.R1).

**P3.R5 — Invite sign-in flow.** When an existing user signs in from the invite page with email + password, after successful authentication the invitation is accepted directly (no need for email confirmation redirect). The user is redirected to `/capture` with the team active.

**P3.R6 — Google OAuth on invite page.** The Google OAuth button on the invite page works as today — sets `pending_invite_token` cookie and redirects through OAuth. The callback now verifies email match (P3.R1) before accepting.

**P3.R7 — Email mismatch state for signed-in users.** When an authenticated user visits an invite page and their email does not match the invitation's email, the page shows a clear mismatch message: "This invitation is for **invited@email.com**. You're signed in as **you@email.com**." Below the message, a "Sign out and continue as invited@email.com" button signs the user out and reloads the invite page, allowing them to sign in with the correct account. The "Accept & Join Team" button is hidden in this state to prevent a confusing 403 error.

### Acceptance Criteria

- [ ] P3.AC1 — OAuth callback verifies email match before accepting an invitation
- [ ] P3.AC2 — Mismatched email shows an error and does not accept the invitation
- [ ] P3.AC3 — Invite page pre-fills the invited email as read-only
- [ ] P3.AC4 — Invite page shows "Sign in" form for existing users
- [ ] P3.AC5 — Invite page shows "Create account" form for new users
- [ ] P3.AC6 — New user signing up from invite page receives confirmation email
- [ ] P3.AC7 — After confirmation, invitation is auto-accepted and team is set active
- [ ] P3.AC8 — Existing user signing in from invite page auto-accepts invitation
- [ ] P3.AC9 — Google OAuth on invite page verifies email match before accepting
- [ ] P3.AC10 — Signed-in user with mismatched email sees mismatch message and sign-out option
- [ ] P3.AC11 — "Accept & Join Team" button is hidden when emails don't match

---

## Part 4: Middleware and Auth Callback Updates

### Requirements

**P4.R1 — Public route additions.** Middleware must allow unauthenticated access to `/signup`, `/forgot-password`, and `/reset-password` in addition to existing public routes.

**P4.R2 — Auth callback type handling.** The `/auth/callback` route must handle multiple callback types:
- `type=signup` (email confirmation) — exchange code, redirect to `/capture`
- `type=recovery` (password reset) — exchange code, redirect to `/reset-password`
- No type (OAuth) — existing behavior (exchange code, check pending invite, redirect to `/capture`)

**P4.R3 — Authenticated redirect updates.** Authenticated users visiting `/signup` or `/forgot-password` are redirected to `/capture` (same as `/login` today).

### Acceptance Criteria

- [ ] P4.AC1 — Unauthenticated users can access `/signup`, `/forgot-password`, `/reset-password`
- [ ] P4.AC2 — Auth callback correctly handles signup confirmation, recovery, and OAuth flows
- [ ] P4.AC3 — Authenticated users are redirected away from `/signup` and `/forgot-password`

---

## Backlog

- Magic link (passwordless) sign-in as an alternative to email + password
- Additional OAuth providers (GitHub, Microsoft/Azure AD, Apple)
- Account linking — allow users to link Google and email auth to the same account
- Password strength indicator on sign-up and reset pages
- Rate limiting on sign-in attempts to prevent brute force
- "Remember me" option for extended session duration
