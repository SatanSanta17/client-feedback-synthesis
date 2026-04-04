# TRD-011: Email + Password Authentication

> **Status:** Draft (Part 1)
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
- **Part 4 (Middleware and Callback):** Increment 1.2 includes the minimal middleware changes needed for Part 1 (`/signup` as public route + authenticated redirect). Part 4 will add the remaining public routes (`/forgot-password`, `/reset-password`) and the callback type handling.
