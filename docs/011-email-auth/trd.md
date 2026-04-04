# TRD-011: Email + Password Authentication

> **Status:** Draft (Parts 1–3)
>
> Mirrors **PRD-011**. Each part maps to the corresponding PRD part.

---

## Part 1: Email + Password Sign-Up and Sign-In

> Implements **P1.R1–P1.R5** from PRD-011.

### Overview

Add email + password authentication alongside the existing Google OAuth flow. This requires a new `/signup` page, an updated `/login` page with an email + password form, shared auth UI components, and minimal middleware changes. Supabase Auth handles email confirmation internally — no custom email sending needed.

### Database Changes

None. Supabase Auth's `auth.users` table already supports email + password users. The existing `handle_new_user` trigger creates a `profiles` row on any new `auth.users` insert regardless of the auth provider.

### Supabase Dashboard Configuration

Before implementation, the following must be configured in the Supabase dashboard:

1. **Enable Email provider:** Settings → Authentication → Providers → Email → Enable
2. **Set Site URL:** Settings → Authentication → URL Configuration → Site URL → set to `NEXT_PUBLIC_APP_URL` value
3. **Set Redirect URLs:** Add `{NEXT_PUBLIC_APP_URL}/auth/callback` to the allowed redirect URLs
4. **Customize email templates (optional):** Settings → Authentication → Email Templates → Confirm signup

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `components/ui/google-icon.tsx` | **Create** | Shared Google SVG icon (extracted from duplicates) |
| `app/signup/page.tsx` | **Create** | Sign-up page — server component shell |
| `app/signup/_components/signup-form.tsx` | **Create** | Client component — email + password + confirm password form, Google OAuth, success state |
| `app/login/page.tsx` | **Modify** | Add email + password form above Google OAuth button, navigation links |
| `app/login/_components/login-form.tsx` | **Create** | Client component — email + password form, Google OAuth, error handling |
| `middleware.ts` | **Modify** | Add `/signup` to public routes, redirect authenticated users away from `/signup` |

### Implementation

#### Increment 1.1: Shared Google Icon Component

**What:** Extract the Google SVG icon that is currently duplicated in `app/login/page.tsx` (inline SVG) and `app/invite/[token]/_components/invite-page-content.tsx` (inline `GoogleIcon` function) into a single shared component.

**Files:**

1. **Create `components/ui/google-icon.tsx`**
   - Export `GoogleIcon` component — renders the 4-color Google "G" SVG
   - Accept optional `className` prop for sizing flexibility
   - Default size: `h-5 w-5`

2. **Modify `app/invite/[token]/_components/invite-page-content.tsx`**
   - Remove the local `GoogleIcon` function
   - Import `GoogleIcon` from `@/components/ui/google-icon`

**Verification:** Invite page renders identically. No visual change.

---

#### Increment 1.2: Sign-Up Page

**What:** Create the `/signup` page with email + password + confirm password form, Google OAuth button, and a "Check your email" success state after sign-up.

**Files:**

1. **Create `app/signup/page.tsx`**
   - Server component, exports `metadata` with title "Sign Up — Synthesiser"
   - Renders `SignupForm` client component
   - Wrapped in the same centered card layout as the login page

2. **Create `app/signup/_components/signup-form.tsx`**
   - `"use client"` component
   - Uses `react-hook-form` + `zod` for form validation
   - Zod schema:
     - `email`: `z.string().email()`
     - `password`: `z.string().min(8)` with regex refinement for at least 1 digit and 1 special character
     - `confirmPassword`: `z.string()` with `.refine()` to match `password`
   - Three form fields: Email (`Input`), Password (`Input type="password"`), Confirm Password (`Input type="password"`)
   - Submit button: "Create Account" (disabled while submitting, shows "Creating…" spinner)
   - On submit:
     - Calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin + '/auth/callback' } })`
     - On success: transitions to a "Check your email" confirmation state (same card, different content — checkmark icon, "We've sent a confirmation link to {email}", "Click the link in your email to activate your account")
     - On error: shows inline error below the form (e.g., "An account with this email already exists")
   - Below the form: horizontal divider with "or" text
   - Google OAuth button: `GoogleIcon` + "Continue with Google" — calls `supabase.auth.signInWithOAuth(...)` same as current login
   - Footer link: "Already have an account? [Sign in](/login)" — uses `next/link`

3. **Modify `middleware.ts`**
   - Add `pathname === "/signup"` to the `isPublicRoute` check
   - Add authenticated redirect: `if (user && pathname === "/signup")` → redirect to `/capture` (same pattern as the existing `/login` redirect)

**Verification:**
- Unauthenticated user can access `/signup`
- Authenticated user visiting `/signup` is redirected to `/capture`
- Form validates email format, password requirements, and password match
- Successful sign-up shows "Check your email" state
- Duplicate email shows inline error
- Google OAuth button works (redirects to Google consent screen)

---

#### Increment 1.3: Updated Login Page

**What:** Rewrite the login page to include an email + password form above the Google OAuth button, with navigation links to `/signup` and `/forgot-password`.

**Files:**

1. **Create `app/login/_components/login-form.tsx`**
   - `"use client"` component
   - Uses `react-hook-form` + `zod` for form validation
   - Zod schema:
     - `email`: `z.string().email()`
     - `password`: `z.string().min(1, "Password is required")`
   - Two form fields: Email (`Input`), Password (`Input type="password"`)
   - Below the password field (right-aligned): "Forgot password?" link → `/forgot-password` (using `next/link`, styled as a small text link — non-functional until Part 2 is implemented but the link is present)
   - Submit button: "Sign In" (disabled while submitting, shows "Signing in…")
   - On submit:
     - Calls `supabase.auth.signInWithPassword({ email, password })`
     - On success: `window.location.href = '/capture'` (full navigation to pick up the new session cookies)
     - On error: shows inline error below the form. Error messages:
       - `"Invalid login credentials"` → show "Invalid email or password"
       - `"Email not confirmed"` → show "Please check your email to confirm your account"
       - Other → show the error message as-is
   - Below the form: horizontal divider with "or" text
   - Google OAuth button: `GoogleIcon` + "Continue with Google" — same behavior as current
   - Footer link: "Don't have an account? [Sign up](/signup)" — uses `next/link`

2. **Modify `app/login/page.tsx`**
   - Replace the current inline `LoginCard` function with `LoginForm` import
   - Keep the server component shell with `metadata` export
   - The centered card layout moves into `LoginForm` (consistent with `SignupForm`)

**Verification:**
- Email + password sign-in works for confirmed users
- Invalid credentials show inline error (not toast, not redirect)
- Unconfirmed email shows appropriate error message
- Google OAuth continues to work
- "Sign up" link navigates to `/signup`
- "Forgot password?" link navigates to `/forgot-password` (page doesn't exist yet — that's Part 2)
- Authenticated users are still redirected away from `/login` (existing middleware behavior)

---

### Dependencies on Other Parts

- **Part 2 (Password Reset):** The "Forgot password?" link on the login page will be present but points to a page that doesn't exist until Part 2 is implemented. This is intentional — the link is UI-ready, the destination follows in the next part.
- **Part 3 (Invite Flow):** The shared `GoogleIcon` component created in Increment 1.1 will be reused when the invite page is updated in Part 3. The auth form patterns established here (Zod schemas, error handling, success states) will be adapted for the invite page forms.
- **Part 4 (Middleware and Callback):** Increment 1.2 includes the minimal middleware changes needed for Part 1 (`/signup` as public route + authenticated redirect). Part 2 adds `/forgot-password` and `/reset-password`. Part 4 is now largely absorbed into Parts 1 and 2 — only the invite email match verification (P3.R1) remains for Part 3.

---

## Part 2: Password Reset Flow

> Implements **P2.R1–P2.R3** from PRD-011. Also partially implements **P4.R1** and **P4.R2** (middleware and callback changes needed for the reset flow).

### Overview

Add a complete password reset flow: a "forgot password" page to request a reset email, an updated auth callback to handle recovery links, and a "reset password" page to set a new password. Supabase handles the reset email delivery via the configured SMTP provider (Brevo).

### Database Changes

None. Password reset is handled entirely by Supabase Auth.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/forgot-password/page.tsx` | **Create** | Forgot password page — server component shell |
| `app/forgot-password/_components/forgot-password-form.tsx` | **Create** | Client component — email input, request reset, success state |
| `app/reset-password/page.tsx` | **Create** | Reset password page — server component shell |
| `app/reset-password/_components/reset-password-form.tsx` | **Create** | Client component — new password + confirm, update user |
| `app/auth/callback/route.ts` | **Modify** | Detect `type=recovery` and redirect to `/reset-password` |
| `middleware.ts` | **Modify** | Add `/forgot-password` and `/reset-password` to public/auth route handling |

### Implementation

#### Increment 2.1: Forgot Password Page + Middleware

**What:** Create the `/forgot-password` page with a single email field. On submit, sends a password reset email via Supabase Auth. Shows a "Check your email" success state regardless of whether the email exists (prevents enumeration). Update middleware to allow unauthenticated access and redirect authenticated users.

**Files:**

1. **Create `app/forgot-password/_components/forgot-password-form.tsx`**
   - `"use client"` component
   - Uses `react-hook-form` + `zod` for validation
   - Zod schema: `email: z.string().email()`
   - Single form field: Email (`Input`)
   - Submit button: "Send Reset Link" (disabled while submitting, shows spinner)
   - On submit:
     - Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + '/auth/callback' })`
     - Always transitions to a success state after the call (regardless of whether the email exists in the system)
     - Success state: checkmark icon, "Check your email", "If an account exists for {email}, we've sent a password reset link."
   - Footer link: "Back to [sign in](/login)" — uses `next/link`

2. **Create `app/forgot-password/page.tsx`**
   - Server component, exports `metadata` with title "Forgot Password — Synthesiser"
   - Renders `ForgotPasswordForm`

3. **Modify `middleware.ts`**
   - Add `pathname === "/forgot-password"` to the `isPublicRoute` check
   - Add `/forgot-password` to the authenticated redirect condition (alongside `/login` and `/signup`) — authenticated users don't need to reset their password via this flow

**Verification:**
- Unauthenticated user can access `/forgot-password`
- Authenticated user visiting `/forgot-password` is redirected to `/capture`
- Submitting a valid email shows the success state
- Submitting a non-existent email still shows the success state (no enumeration)
- "Back to sign in" link navigates to `/login`

---

#### Increment 2.2: Auth Callback — Recovery Type Handling

**What:** Update the auth callback to detect the `type=recovery` query parameter from Supabase's password reset email link. When detected, redirect to `/reset-password` instead of `/capture`.

**Files:**

1. **Modify `app/auth/callback/route.ts`**
   - After successful code exchange, check `searchParams.get("type")`
   - If `type === "recovery"`: redirect to `/reset-password` (skip invite token handling — a recovery flow is never an invite acceptance)
   - Otherwise: existing behavior (check pending invite, redirect to `/capture`)

**Verification:**
- Clicking the reset link in the email lands on `/auth/callback?code=...&type=recovery`
- The callback exchanges the code and redirects to `/reset-password`
- The user has a valid authenticated session on `/reset-password`
- Non-recovery callbacks (OAuth, signup confirmation) continue to redirect to `/capture`

---

#### Increment 2.3: Reset Password Page

**What:** Create the `/reset-password` page with new password and confirm password fields. On submit, updates the user's password via `supabase.auth.updateUser()`. On success, redirects to `/capture` with a toast. The page requires an authenticated session — unauthenticated visitors are redirected to `/login` by the existing middleware.

**Files:**

1. **Create `app/reset-password/_components/reset-password-form.tsx`**
   - `"use client"` component
   - Uses `react-hook-form` + `zod` for validation
   - Zod schema:
     - `password`: `z.string().min(8)` with regex refinement for at least 1 digit and 1 special character (same rules as sign-up)
     - `confirmPassword`: `z.string()` with `.refine()` to match `password`
   - Two form fields: New Password (`Input type="password"`), Confirm New Password (`Input type="password"`)
   - Submit button: "Reset Password" (disabled while submitting, shows spinner)
   - On submit:
     - Calls `supabase.auth.updateUser({ password })`
     - On success: `window.location.href = '/capture'` (the `/capture` page will show a toast — or use `router.push('/capture')` and fire `toast.success("Password updated successfully")` before navigating)
     - On error: shows inline error below the form
   - Footer link: "Back to [sign in](/login)" — uses `next/link`

2. **Create `app/reset-password/page.tsx`**
   - Server component, exports `metadata` with title "Reset Password — Synthesiser"
   - Renders `ResetPasswordForm`

3. **Modify `middleware.ts`** (if needed)
   - `/reset-password` is NOT added to `isPublicRoute` — it requires authentication
   - `/reset-password` is NOT added to the authenticated redirect condition — authenticated users must be able to access it to complete the reset flow
   - Result: unauthenticated users are redirected to `/login`, authenticated users see the form. This is the correct behavior with no middleware changes.

**Verification:**
- Unauthenticated user visiting `/reset-password` is redirected to `/login`
- Authenticated user (via recovery link) sees the reset form
- Submitting a valid new password updates the password and redirects to `/capture`
- Password validation enforces the same rules as sign-up (min 8 chars, 1 digit, 1 special char)
- Mismatched passwords show inline error

---

### Dependencies on Other Parts

- **Part 1 (Sign-Up and Sign-In):** The "Forgot password?" link on the login page (Part 1, Increment 1.3) now points to a functional `/forgot-password` page.
- **Part 3 (Invite Flow):** No direct dependency. The callback changes in Increment 2.2 are backward-compatible with the existing invite flow.
- **Part 4 (Middleware and Callback):** P4.R1 (public routes) and P4.R2 (callback type handling) are now fully implemented across Parts 1 and 2. Part 4 is reduced to P4.R3 verification only — authenticated redirect behavior is already in place.

---

## Part 3: Invite Flow — Email Match Verification and Auth Choice

> Implements **P3.R1–P3.R7** from PRD-011.

### Overview

Harden the invite acceptance flow with email match verification and add email + password auth options to the invite page. Currently, the OAuth callback blindly accepts invitations without checking if the authenticated user's email matches the invited email. The invite page only shows a Google OAuth button for unauthenticated users, with no email + password option. This part fixes both gaps.

Three key changes:

1. **Auth callback email guard** — before accepting an invitation in the callback, verify that the authenticated user's email matches the invitation's target email. Reject mismatches.
2. **Server-side user existence check** — the invite page's server component checks whether the invited email already has an account, so the client knows whether to show a sign-in or sign-up form.
3. **Invite page UI rewrite** — the client component renders different auth UIs based on authentication state and email match: sign-in form, sign-up form, accept button, or mismatch warning.

### Database Changes

None. All changes are in the application layer. The `team_invitations` table and `profiles` table are queried but not modified.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/auth/callback/route.ts` | **Modify** | Add email match verification before accepting invitation |
| `app/invite/[token]/page.tsx` | **Modify** | Pass `invitedEmail` and `userExists` to client component |
| `app/invite/[token]/_components/invite-page-content.tsx` | **Rewrite** | Full rewrite — auth forms, mismatch state, sign-in/sign-up detection |

### Implementation

#### Increment 3.1: Auth Callback — Email Match Verification

**What:** Add an email comparison guard to the auth callback so that when a `pending_invite_token` is present, the callback verifies the authenticated user's email matches the invitation's email before accepting. If emails don't match, skip acceptance and redirect to the invite page with an error query parameter.

**Files:**

1. **Modify `app/auth/callback/route.ts`**
   - After fetching the invitation and the user, add:
     ```
     if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
       console.warn(`Auth callback: email mismatch — user ${user.email} tried to accept invite for ${invitation.email}`);
       return NextResponse.redirect(`${origin}/invite/${pendingToken}?error=email_mismatch`);
     }
     ```
   - This check goes between the `if (!user)` guard and the `acceptInvitation()` call
   - The redirect goes to the invite page (not `/capture`) so the user sees the mismatch context
   - The `pending_invite_token` cookie is still cleared (already handled above the check)

**Verification:**
- OAuth sign-in with matching email: invitation accepted, redirected to `/capture` with team active (existing behavior, unchanged)
- OAuth sign-in with mismatched email: invitation NOT accepted, redirected to `/invite/{token}?error=email_mismatch`
- No pending token: existing behavior unchanged (redirect to `/capture`)
- Recovery flow: existing behavior unchanged (redirect to `/reset-password`)

---

#### Increment 3.2: Invite Page Server Component — Pass Email and User Existence

**What:** Update the invite page server component to pass the invited email and a `userExists` boolean to the client component. The user existence check queries the `profiles` table using the service role client to determine whether the invited email already has an account.

**Files:**

1. **Modify `app/invite/[token]/page.tsx`**
   - After fetching the invitation, if status is `valid`:
     - Query: `createServiceRoleClient().from("profiles").select("id").eq("email", invitation.email.toLowerCase()).maybeSingle()`
     - Derive `userExists = !!profileData`
   - Pass new props to `<InvitePageContent>`:
     - `invitedEmail={invitation.email}` — the email the invitation was sent to
     - `userExists={userExists}` — whether an account already exists for that email
   - For non-valid statuses (`invalid`, `expired`, `already_accepted`), pass `invitedEmail={null}` and `userExists={false}` (not used in those states)
   - Import `createServiceRoleClient` from `@/lib/supabase/server`

**Verification:**
- Invite page for a new user (no profile for that email): `userExists` is `false`
- Invite page for an existing user (profile exists): `userExists` is `true`
- Invalid/expired/already_accepted states render unchanged

---

#### Increment 3.3: Invite Page Client Component — Full UI Rewrite

**What:** Rewrite the `valid` status rendering in `InvitePageContent` to handle four distinct states: (1) authenticated + email match, (2) authenticated + email mismatch, (3) unauthenticated + existing user (sign-in), (4) unauthenticated + new user (sign-up). Add email + password forms with pre-filled read-only email, Google OAuth as an alternative, and handle the `error=email_mismatch` query parameter.

**Props additions:**

```typescript
interface InvitePageContentProps {
  status: InvitationStatus;
  token: string;
  teamName: string | null;
  role: string | null;
  invitedEmail: string | null;  // NEW
  userExists: boolean;           // NEW
}
```

**Four UI states for `status === "valid"`:**

1. **Authenticated + email matches** (`isAuthenticated && user.email === invitedEmail`)
   - Show: "Signed in as {user.email}" + "Accept & Join Team" button
   - Behavior: calls `POST /api/invite/{token}/accept` → sets `active_team_id` cookie → redirects to `/capture`
   - This is the existing behavior, preserved as-is

2. **Authenticated + email mismatch** (`isAuthenticated && user.email !== invitedEmail`)
   - Show: mismatch warning card:
     - Alert icon (yellow/amber)
     - "This invitation is for **{invitedEmail}**"
     - "You're signed in as **{user.email}**"
     - Button: "Sign out and continue as {invitedEmail}" — calls `supabase.auth.signOut()` then `window.location.reload()` (reloads the invite page as unauthenticated)
   - The "Accept & Join Team" button is **hidden** in this state (P3.AC11)

3. **Unauthenticated + user exists** (`!isAuthenticated && userExists`)
   - Show: sign-in form:
     - Email field: `<Input>` pre-filled with `invitedEmail`, `readOnly`, visually muted
     - Password field: `<Input type="password">`
     - Submit button: "Sign in & Join"
     - Validation: `react-hook-form` + `zod` — email (pre-set, not user-editable), password required
   - On submit:
     - Call `supabase.auth.signInWithPassword({ email: invitedEmail, password })`
     - On success: call `POST /api/invite/{token}/accept` → set `active_team_id` cookie → redirect to `/capture`
     - On error: inline error below the form ("Invalid password", "Email not confirmed", etc.)
   - Below form: divider + Google OAuth button ("Or continue with Google") — sets `pending_invite_token` cookie, calls `signInWithOAuth`
   - Footer: "Don't have an account? [Sign up](/signup)" link

4. **Unauthenticated + new user** (`!isAuthenticated && !userExists`)
   - Show: sign-up form:
     - Email field: `<Input>` pre-filled with `invitedEmail`, `readOnly`, visually muted
     - Password field: `<Input type="password">`
     - Confirm Password field: `<Input type="password">`
     - Submit button: "Create Account & Join"
     - Validation: same Zod schema as `/signup` — password min 8 chars, 1 digit, 1 special character, confirm must match
   - On submit:
     - Set `pending_invite_token` cookie (for the callback to auto-accept after confirmation)
     - Call `supabase.auth.signUp({ email: invitedEmail, password, options: { emailRedirectTo: origin + '/auth/callback' } })`
     - On success: transition to "Check your email" state (same pattern as `/signup`)
     - On error: inline error below the form
   - Below form: divider + Google OAuth button — same as state 3
   - Footer: "Already have an account? [Sign in](/login)" link

**Error query parameter handling:**
- On mount, read `searchParams` for `error=email_mismatch`
- If present: show a toast "You signed in with a different email than the invitation was sent to"
- Clean the URL with `window.history.replaceState()` to prevent re-showing on refresh
- Use `useSearchParams()` from `next/navigation`

**Files:**

1. **Rewrite `app/invite/[token]/_components/invite-page-content.tsx`**
   - Add `invitedEmail` and `userExists` to `InvitePageContentProps`
   - Add imports: `useSearchParams` from `next/navigation`, `useForm` from `react-hook-form`, `zodResolver` from `@hookform/resolvers/zod`, `z` from `zod`, `Loader2` from `lucide-react`, `Input` from `@/components/ui/input`, `Label` from `@/components/ui/label`
   - Keep the `InviteShell`, `StatusIcon` helper components and `invalid`/`expired`/`already_accepted` renderers unchanged
   - Rewrite the `valid` status renderer with the four states above
   - Extract reusable form schemas:
     - `inviteSignInSchema = z.object({ password: z.string().min(1, "Password is required") })`
     - `inviteSignUpSchema = z.object({ password: ..., confirmPassword: ... }).refine(...)` (same rules as signup-form.tsx)
   - Keep `setInviteCookie`, `setActiveTeamCookie`, `handleSignInToJoin` (Google OAuth), and `handleAcceptDirectly` helper functions

**Verification:**
- Authenticated user with matching email sees "Accept & Join Team" button → works as before
- Authenticated user with mismatched email sees mismatch warning + sign-out button → no accept button visible
- Clicking "Sign out and continue as..." signs out and reloads as unauthenticated
- Unauthenticated user with existing account sees sign-in form with pre-filled read-only email
- Signing in with correct password accepts invitation and redirects to `/capture`
- Signing in with wrong password shows inline error
- Unauthenticated new user sees sign-up form with pre-filled read-only email
- Signing up shows "Check your email" state
- After email confirmation, callback auto-accepts invitation (email match verified by Increment 3.1)
- Google OAuth on invite page works — sets cookie, redirects through OAuth, callback verifies email
- `?error=email_mismatch` in URL shows a toast and cleans the URL
- Invalid/expired/already_accepted states render unchanged

---

### Dependencies on Other Parts

- **Part 1 (Sign-Up and Sign-In):** The Zod password schema, form patterns, and `GoogleIcon` component created in Part 1 are reused in the invite page forms.
- **Part 2 (Password Reset):** No direct dependency. The auth callback recovery check (Increment 2.2) is positioned before the invite token handling, so recovery flows are unaffected.
- **Part 4 (Middleware and Callback):** All middleware and callback changes needed for the invite flow are included in this part (Increment 3.1). Part 4 is fully absorbed into Parts 1–3 and requires no additional work.
