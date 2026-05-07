# TRD-035: Invite Flow Simplification

> **Status:** Draft — pending implementation
>
> Mirrors **PRD-035**. Each TRD part maps to the corresponding PRD part by number. Implementation order is **Part 4 → Part 1 → Part 2 → Part 3 → Part 5** (Part 4's status/mismatch screens are a prerequisite for the Part 1 dispatcher; cleanup in Part 5 lands once everything else has stabilised). The PRD-order numbering is retained here for cross-reference clarity.

---

## Architecture Summary (read first)

The current flow renders a client-side dispatcher at `/invite/[token]` ([invite-page-content.tsx](app/invite/%5Btoken%5D/_components/invite-page-content.tsx)) that fans into 5 UI states and uses a `pending_invite_token` cookie to carry context across OAuth and email-confirmation hops. The new flow inverts this:

- **`/invite/[token]` becomes a server-side dispatcher.** It resolves the invite, inspects the auth state, and either (a) accepts and redirects, (b) redirects to `/login?invite=...` or `/signup?invite=...`, or (c) renders a small fixed status / mismatch screen.
- **Invitation context is carried in the URL** (`?invite={token}`) end-to-end. The `pending_invite_token` cookie is removed.
- **Invited signups bypass email verification** via a new server route that uses the Supabase Admin API to create a pre-confirmed user.
- **Acceptance is always written server-side** (in the dispatcher, in the post-login accept call, or in the invited-signup route) — never on a client button click.

```
                                              ┌─ valid token ─┐
                          ┌──────────────────►│ dispatcher    │──┐
   Invite email link ────►│ /invite/{token}   │ (server)      │  │
                          │ (server component)│               │  │
                          └───────────────────┘               │  │
                                                              ▼  │
            ┌─────────────────────────────────────────────────┐  │
            │ Auth state + email match decision               │  │
            └─────┬──────────────┬──────────────┬─────────────┘  │
                  │              │              │                │
            authed+match    authed+mismatch    !authed           │
                  │              │              │                │
                  ▼              ▼              ▼                │
       acceptInvitation()   render mismatch  profile lookup      │
       set active_team_id   (P4)             ┌─────┴─────┐       │
       redirect → workspace                  │           │       │
                                          exists?     no profile │
                                             │           │       │
                                             ▼           ▼       │
                              redirect /login?invite=  /signup?invite= │
                                       │                         │     │
                              auth completes                     │     │
                                       │                         │     │
                                       ▼                         ▼     │
                              accept + redirect    invited-signup API  │
                              → workspace          (admin createUser   │
                                                    email_confirm=true)│
                                                                       │
                                                       invalid/expired/│
                                                       already-accepted│ ◄─┘
                                                       render status (P4)
```

---

## Cross-Cutting Conventions

These conventions apply across every part. Stated once here so individual parts can stay focused on their own scope.

- **URL parameter name.** The invite token is carried as `?invite={token}` on `/login` and `/signup`. Never re-encoded, never URL-double-escaped. Validation: the value must match the existing `token` column shape (64 hex chars from `crypto.randomBytes(32).toString("hex")` in [invitation-service.ts:31-33](lib/services/invitation-service.ts#L31-L33)). Anything else is treated as absent.
- **No cookies for invitation context.** The `pending_invite_token` cookie is read for backward compatibility only during the rollout window of Part 5 and then removed.
- **Server redirects use `redirect()` from `next/navigation`.** Server components throw `redirect()`; route handlers use `NextResponse.redirect()`. Both are 307 by default — fine for our flow.
- **`active_team_id` cookie write is centralised.** Setting the active team cookie always uses the existing `active_team_id` cookie name with `path: "/"`, `maxAge: 60 * 60 * 24 * 365`, `sameSite: "lax"`. Server-side: `response.cookies.set(...)`; server component context: a small helper in `lib/cookies/active-team-server.ts` (new — see Part 1).
- **Acceptance write site.** All paths funnel into one helper, `acceptAndActivate(repo, invitation, userId)` (new in Part 1), which calls `acceptInvitation()` and returns the `teamId` to set as active. This is the only place acceptance happens — no other code path writes `accepted_at`.
- **Email match check is case-insensitive.** Compare `user.email?.toLowerCase()` against `invitation.email.toLowerCase()`, never raw.
- **Logging.** Every server-side decision in the dispatcher and the new signup route logs `[invite-dispatch] <decision> token=<short> user=<email-or-anon>` with token shortened to first 8 chars.

---

## Part 1: Single-Click Acceptance for Signed-In Users

> Implements **P1.R1–P1.R4** from PRD-035.

### Overview

Convert `/invite/[token]/page.tsx` from a client-dispatching shell into a true server dispatcher. When the request arrives with an authenticated session whose email matches the invitation, the page accepts the invite server-side, writes `active_team_id`, and 307s the user to their post-auth landing page (using existing `DEFAULT_AUTH_ROUTE` / `ONBOARDING_ROUTE` rules from [lib/constants.ts:4-5](lib/constants.ts#L4-L5)). No client component renders for this case.

### Database Changes

None. Uses the existing `team_invitations` and `team_members` tables. `accepted_at` continues to be the source of truth for invitation status.

### API Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| (none new) | — | All work happens inside the server component for `/invite/[token]` | Mixed |

The existing `POST /api/invite/[token]/accept` is **not removed in this part** — it's left in place so the in-flight UI in Part 5 cleanup phase has nothing untested. It is removed in Part 5.

### Files Changed

| File | Action | Purpose |
|---|---|---|
| `app/invite/[token]/page.tsx` | **Rewrite** | Becomes server-side dispatcher: resolves invite, reads auth, redirects or renders status |
| `lib/services/invitation-service.ts` | **Modify** | Add `acceptAndActivate()` helper that wraps `acceptInvitation()` + returns `{ teamId, postAuthPath }` |
| `lib/cookies/active-team-server.ts` | **Create** | Thin helper to set `active_team_id` cookie from a server action / server component context (using `next/headers` `cookies()`) |
| `app/invite/[token]/_components/invite-page-content.tsx` | **Delete** | No longer needed — server dispatcher replaces this client orchestrator. Status / mismatch rendering is handled by the new server-rendered components from Part 4. |

> **Forward-compat note.** The dispatcher in this part already needs to handle the four downstream cases (auto-accept, mismatch, redirect-to-login, redirect-to-signup). The redirect-to-login / redirect-to-signup branches simply 307 to the new query-param-bearing URLs that Part 2 makes invite-aware. Until Part 2 lands, the redirect targets exist but the destination pages ignore the param — i.e. the user falls through to a normal login experience. This is intentional and safe.

### Implementation

#### Increment 1.1: `acceptAndActivate()` Service Helper

**What.** Add a single-call helper that, given a valid invitation and a user id, performs `acceptInvitation()` and returns `{ teamId, postAuthPath }`. `postAuthPath` is `DEFAULT_AUTH_ROUTE` if the user has any non-deleted sessions in any team, else `ONBOARDING_ROUTE` (mirrors the rule already in [app/auth/callback/route.ts:35-40](app/auth/callback/route.ts#L35-L40)).

**Files.**

1. **Modify `lib/services/invitation-service.ts`**
   - Add `export async function acceptAndActivate(repo, supabase, invitation, userId): Promise<{ teamId: string; postAuthPath: string }>`.
   - Internally calls existing `acceptInvitation(repo, invitation.id, userId, invitation.team_id, invitation.role)`.
   - Performs the `sessions` count check using the passed `supabase` client (RLS-bound, like the auth callback does today).
   - Logs `[invitation-service] acceptAndActivate — user ${userId} → team ${invitation.team_id} (postAuthPath ${postAuthPath})`.

**Verification.**
- Unit-callable from the dispatcher and from the existing `/auth/callback` (callback adoption deferred to Part 2 to keep this increment scoped).
- Returns `/dashboard` for users with sessions, `/capture` otherwise.

---

#### Increment 1.2: `setActiveTeamCookie` (Server-Component Variant)

**What.** A small helper that wraps `cookies().set("active_team_id", teamId, ...)` for use inside server components and server actions, where we don't have a `NextResponse` to attach cookies to.

**Files.**

1. **Create `lib/cookies/active-team-server.ts`**
   - `export async function setActiveTeamCookieServer(teamId: string): Promise<void>` — uses `cookies()` from `next/headers`.
   - Same options as the existing client/route-handler writes: `path: "/"`, `maxAge: 60 * 60 * 24 * 365`, `sameSite: "lax"`.

**Verification.**
- Type-check passes.
- The auth callback continues to use `response.cookies.set(...)` — this helper is only for the new dispatcher path.

---

#### Increment 1.3: Server Dispatcher Rewrite

**What.** Replace the body of [app/invite/[token]/page.tsx](app/invite/%5Btoken%5D/page.tsx) with a dispatcher that:

1. Resolves the invitation via `getInvitationByToken()`.
2. If invalid / expired / already-accepted → render the corresponding status component (Part 4).
3. Reads the current user via `supabase.auth.getUser()`.
4. **Authenticated branch:**
   - If `user.email === invitation.email` (case-insensitive): call `acceptAndActivate()`, write the active-team cookie via `setActiveTeamCookieServer()`, then `redirect(postAuthPath)`.
   - Else: render mismatch component (Part 4) with both emails surfaced.
5. **Unauthenticated branch:**
   - Look up `profiles.email` via the service-role client (same query as today at [app/invite/[token]/page.tsx:36-44](app/invite/%5Btoken%5D/page.tsx#L36-L44)).
   - If a profile exists: `redirect(`/login?invite=${token}`)`.
   - Else: `redirect(`/signup?invite=${token}`)`.

**Files.**

1. **Rewrite `app/invite/[token]/page.tsx`**
   - Server async component. No `"use client"` anywhere downstream of it for the redirect / accept paths.
   - Imports: `redirect` from `next/navigation`, `getInvitationByToken`, `acceptAndActivate` (1.1), `setActiveTeamCookieServer` (1.2), Part 4's status / mismatch components.
   - Logging: each decision branch logs once with the format defined in Cross-Cutting Conventions.

2. **Delete `app/invite/[token]/_components/invite-page-content.tsx`**
   - No remaining importers after this rewrite.

**Verification.**
- Authenticated + match: cookie set, redirected to `/dashboard` or `/capture`, `accepted_at` populated, `team_members` row created. The user does **not** see any invite UI.
- Authenticated + mismatch: mismatch screen renders (Part 4), no acceptance, no cookie change.
- Unauthenticated + profile exists: redirected to `/login?invite={token}`. URL contains the token. (Login page behaviour comes in Part 2 — pre-Part 2 the user sees a normal login.)
- Unauthenticated + no profile: redirected to `/signup?invite={token}`. (Signup page behaviour comes in Part 2.)
- Invalid / expired / already-accepted: status screen renders (Part 4).

### Cross-References

- **Part 2** uses the redirect targets emitted here. Until Part 2 lands, they fall through to normal login/signup.
- **Part 4** provides the status and mismatch components rendered by branches 2 and 5 of the dispatcher — Part 4 must ship before or alongside this increment (recommended sequencing: Part 4 first).
- **Part 5** removes the now-orphaned `_components/invite-page-content.tsx`, the accept-card component, and the `POST /api/invite/[token]/accept` route handler.

### Risks & Edge Cases

- **Token shape validation.** A malformed `[token]` segment must not crash the dispatcher. `getInvitationByToken()` already returns `null` for unknown tokens — keep that contract; dispatcher renders `invalid` status.
- **Race: invitation accepted between resolve and accept.** If two tabs hit the dispatcher concurrently, the second one will see `accepted_at` already set on its read, OR `acceptInvitation()` will be a no-op (the `addTeamMember` is gated by `isUserTeamMember`). Either is correct behaviour; no extra locking needed.
- **Same user, different team, same email.** The current `addTeamMember` check is per-team. A user already a member of *another* team being invited to this one is a normal new-membership write — works.
- **`createServiceRoleClient` cost.** The dispatcher always opens a service-role client for the profile lookup (unauth branch) and the invitation join. Same pattern as today, no regression.

---

## Part 2: Direct Routing for Signed-Out Users

> Implements **P2.R1–P2.R7** from PRD-035.

### Overview

Make `/login` and `/signup` invite-aware: when the URL carries `?invite={token}`, the email field is fixed to the invited email and read-only, and on successful authentication the invitation is accepted + active team is set in one round-trip. OAuth from these pages preserves the invite token across the Google round-trip by attaching it to `redirectTo`. The auth callback adopts URL-driven invite resolution and stops relying on the `pending_invite_token` cookie.

### Database Changes

None.

### API Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/invite/[token]/accept` | Reused for post-login auto-accept call from invite-aware login form | Yes |
| `GET` | `/auth/callback` | Modified to read `?invite={token}` from the redirect URL in addition to (and eventually instead of) the cookie | No |

> Forward-compat: the existing `/api/invite/[token]/accept` already does exactly what we need (auth + email match guard + accept). We keep using it from the invite-aware login form. It is removed in Part 5 only after the form switches to a server action — see "Risks & Edge Cases" below.

### Files Changed

| File | Action | Purpose |
|---|---|---|
| `app/login/_components/login-form.tsx` | **Modify** | Read `invite` query param; in invite mode, pre-fill + lock email, accept post-login |
| `app/signup/_components/signup-form.tsx` | **Modify** | Read `invite` query param; in invite mode, pre-fill + lock email, route through Part 3 invited-signup endpoint |
| `app/login/page.tsx` | **Modify** | Server-side: resolve invitation if `?invite=` present, pass `invitedEmail` + `inviteToken` props to `LoginForm` |
| `app/signup/page.tsx` | **Modify** | Same shape as login — pass `invitedEmail` + `inviteToken` to `SignupForm` |
| `app/auth/callback/route.ts` | **Modify** | Read invite token from query param first, fall back to cookie during Part 5's deprecation window; use `acceptAndActivate()` |
| `lib/invite/url.ts` | **Create** | Single helper `appendInviteParam(url, token)` so callers don't hand-build URLs |
| `lib/invite/token.ts` | **Create** | Single helper `parseInviteToken(value: string \| null \| undefined)` — returns `string | null`, validates 64-hex shape |

### Implementation

#### Increment 2.1: Invite-Token URL Helpers

**What.** Two pure utility modules so login, signup, callback, and dispatcher all parse / serialise the invite token identically.

**Files.**

1. **Create `lib/invite/token.ts`**
   - `export function parseInviteToken(raw: string | null | undefined): string | null` — returns `null` unless input matches `/^[a-f0-9]{64}$/i`.

2. **Create `lib/invite/url.ts`**
   - `export function appendInviteParam(path: string, token: string | null): string` — returns `path` unchanged if token is null; otherwise appends `?invite=...` (or `&invite=...` if path already has a query string).

**Verification.** Pure functions; trivial type-check + manual smoke from the dispatcher and forms.

---

#### Increment 2.2: Invite-Aware Login Page

**What.** Login server component reads `?invite=` from `searchParams`. If present and resolves to a valid invitation, it passes `invitedEmail` and `inviteToken` to `LoginForm`. The form locks the email and, on success, accepts the invite and redirects to the workspace. If the token is invalid / expired / already-accepted, `searchParams` is silently dropped — the user sees a normal login (and the invite link itself, if reused, will land on the dispatcher status screen).

**Files.**

1. **Modify `app/login/page.tsx`**
   - Convert to async server component.
   - `searchParams: Promise<{ invite?: string }>`.
   - If `parseInviteToken(searchParams.invite)` returns a value, call `getInvitationByToken()` server-side.
   - If `status === "valid"`: pass `invitedEmail={invitation.email}` and `inviteToken={token}` to `<LoginForm>`.
   - Otherwise: pass `invitedEmail={null}` / `inviteToken={null}`.

2. **Modify `app/login/_components/login-form.tsx`**
   - Add props: `invitedEmail?: string | null; inviteToken?: string | null`.
   - When `invitedEmail` is set:
     - Default `email` value = `invitedEmail`; field is `readOnly` and visually muted (mirror the styling already used in [invite-sign-in-form.tsx:104-112](app/invite/%5Btoken%5D/_components/invite-sign-in-form.tsx#L104-L112)).
     - Schema: same as today (`email` required, `password` required); but the field is locked.
     - On successful `signInWithPassword`: call `POST /api/invite/{inviteToken}/accept`, set `active_team_id` cookie client-side via existing helper, then `router.push("/capture")` (or `/dashboard` if the API response indicates the user has prior sessions — the API already returns `teamId`; for the redirect target we either (a) always go to `/capture` for invited joins as the PRD allows it being the "primary workspace landing page", or (b) extend the API response to include `postAuthPath`. **Decision: extend the response with `postAuthPath` so behaviour matches the dispatcher.**).
   - When `invitedEmail` is null: existing behaviour, no change.
   - For the Google OAuth button in invite mode: call `signInWithOAuth({ redirectTo: `${origin}/auth/callback?invite=${inviteToken}` })`. No cookie write.

3. **Modify `app/api/invite/[token]/accept/route.ts`**
   - Add `postAuthPath` to the JSON response, computed via the same rule as `acceptAndActivate()`. Backward-compatible (existing client ignores extra fields).

**Verification.**
- `/login?invite={validToken}` shows the email pre-filled and locked.
- Sign-in with correct password → invitation accepted → land on workspace (correct path per session-count rule) → invited team is active.
- Sign-in with wrong password → inline error, invitation not accepted.
- `/login?invite={garbage}` shows normal login (no email pre-fill).
- `/login?invite={expiredToken}` shows normal login.
- Google OAuth from invite-mode login completes through `/auth/callback?invite=...`.

---

#### Increment 2.3: Invite-Aware Signup Page (Form Wiring Only — Verification Skip in Part 3)

**What.** Same shape as 2.2 but for `/signup`. In this increment the form still uses `supabase.auth.signUp()` (i.e. verification email is still sent for invited users). Part 3 swaps the submit handler to the new server route. We split the wiring from the verification-skip change so each PR is testable independently.

**Files.**

1. **Modify `app/signup/page.tsx`**
   - Same pattern as `/login`: resolve `?invite=`, pass `invitedEmail` and `inviteToken` to `SignupForm`.

2. **Modify `app/signup/_components/signup-form.tsx`**
   - Add props: `invitedEmail?: string | null; inviteToken?: string | null`.
   - When `invitedEmail` is set: default `email` = `invitedEmail`, field is `readOnly`. Submit still calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo: ${origin}/auth/callback?invite=${inviteToken} } })`.
   - When `invitedEmail` is null: existing behaviour.
   - For Google OAuth in invite mode: same `redirectTo` extension as 2.2.

**Verification.**
- `/signup?invite={validToken}` shows pre-filled locked email.
- Submitting → "Check your email" panel.
- Confirmation email link hits `/auth/callback?invite=...&code=...` → callback (2.4) auto-accepts.
- `/signup` without `?invite=` is unchanged.

---

#### Increment 2.4: Auth Callback — URL-First Invite Resolution

**What.** Modify [app/auth/callback/route.ts](app/auth/callback/route.ts) to read the invite token from the query string first, falling back to the legacy `pending_invite_token` cookie during the rollout window. Use the new `acceptAndActivate()` helper instead of the inline `acceptInvitation()` call. Continue to enforce email match.

**Files.**

1. **Modify `app/auth/callback/route.ts`**
   - After `exchangeCodeForSession`: `const inviteToken = parseInviteToken(searchParams.get("invite")) ?? getCookie(request, "pending_invite_token");`
   - If `inviteToken`: resolve invitation, enforce email match (existing logic at [route.ts:79-91](app/auth/callback/route.ts#L79-L91)), then call `acceptAndActivate(repo, supabase, invitation, user.id)`.
   - Use the returned `postAuthPath` for the redirect target.
   - Set `active_team_id` cookie on the response (existing pattern at [route.ts:101-105](app/auth/callback/route.ts#L101-L105)).
   - Always clear `pending_invite_token` if it was set (existing behaviour).
   - Mismatch redirect: `/invite/{inviteToken}?error=email_mismatch` (existing behaviour preserved — the dispatcher in Part 4 renders the mismatch screen for this case).

**Verification.**
- OAuth from invite-aware login: `/auth/callback?code=...&invite=...` → user joined → land on workspace.
- Confirmation-email click for an invited signup (post-Part-3 the email won't exist; pre-Part-3 it does and this path must work): same outcome.
- Email mismatch: user is signed in, invitation NOT accepted, redirected to `/invite/{token}?error=email_mismatch` — the dispatcher in Part 4 reads `error=email_mismatch` and renders the mismatch toast / screen.
- Cookie fallback still works for in-flight invite emails sent before this PR shipped (those carry the cookie, not the URL param).
- Recovery flow unchanged.

### Cross-References

- **Part 1's dispatcher** generates the redirect URLs that this part's pages consume. The two parts can be developed in parallel; the dispatcher's redirects are no-ops UI-wise until 2.2/2.3 ship.
- **Part 3** replaces 2.3's `signUp()` call with the admin-API-backed server route, making invited signups one-click.
- **Part 4** owns the mismatch screen rendered when 2.4 redirects with `?error=email_mismatch`.
- **Part 5** removes the cookie fallback in 2.4 once telemetry shows no in-flight email is still relying on it (≥7 days post-rollout = invite TTL).

### Risks & Edge Cases

- **OAuth `redirectTo` allowlist.** Google OAuth requires the `redirectTo` URL to be on the allowed list configured in the Supabase dashboard. `/auth/callback?invite=...` is the same path with a query string — Supabase's allowlist matches by path + origin, not full query string. Verify in staging before prod rollout.
- **Token leakage via Referer.** The login and signup pages contain a few outbound links (footer / "back to sign in"). All of these are internal `next/link` navigations; Referer leakage to a third-party origin is not possible from these pages. No additional `Referrer-Policy` change required.
- **API route auth-only guard.** `POST /api/invite/[token]/accept` already returns 401 if not authenticated (route.ts:21-23). The invite-aware login form calls this *after* `signInWithPassword` resolves successfully — sequencing matters. Guard with `await supabase.auth.getUser()` after sign-in if the SDK's session-write isn't yet visible to the next fetch. **In practice the SDK writes session cookies synchronously on success and the next same-origin fetch picks them up; if any flakiness shows up in QA, switch to a server action that reads the session in the same request.**
- **Existing `pending_invite_token` cookie writes.** The old form at [invite-sign-up-form.tsx:64](app/invite/%5Btoken%5D/_components/invite-sign-up-form.tsx#L64) still writes the cookie. Once the dispatcher (Part 1) replaces those forms, no new writes happen, but cookies on existing in-flight invite tabs persist for 10 minutes. This is why 2.4 keeps the fallback.

---

## Part 3: No Verification Email for Invited Signups

> Implements **P3.R1–P3.R4** from PRD-035.

### Overview

Add `POST /api/invite/[token]/signup` — a server route that creates an invited user with the email pre-confirmed (via Supabase Admin API), signs them in, accepts the invitation, and returns the post-auth redirect target. The invite-aware signup form (Part 2.3) submits to this endpoint instead of `supabase.auth.signUp()` when an invite token is present. Direct (non-invite) signups continue to send a verification email — only the invited path is changed.

### Database Changes

None.

### API Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/invite/[token]/signup` | Create pre-verified user, sign in, accept invitation. Body: `{ password: string }`. Returns `{ teamId, postAuthPath }`. | No (gated by valid invite token + matching email) |

### Files Changed

| File | Action | Purpose |
|---|---|---|
| `app/api/invite/[token]/signup/route.ts` | **Create** | Admin-API user creation + sign-in + accept |
| `app/signup/_components/signup-form.tsx` | **Modify** | Submit to new endpoint when `inviteToken` is set |
| `lib/services/invitation-service.ts` | **Modify** | Add `signupAndAcceptInvitation(repo, adminSupabase, supabase, invitation, password)` orchestration helper |

### Implementation

#### Increment 3.1: `signupAndAcceptInvitation()` Service Helper

**What.** A single service function that owns the create-user → sign-in → accept sequence. Keeps the route handler thin (validation + response shaping only), per CLAUDE.md service convention.

**Files.**

1. **Modify `lib/services/invitation-service.ts`**
   - `export async function signupAndAcceptInvitation(repo, adminSupabase, supabase, invitation, password): Promise<{ userId: string; teamId: string; postAuthPath: string }>`.
   - Steps:
     1. `adminSupabase.auth.admin.createUser({ email: invitation.email, password, email_confirm: true })`.
        - On `User already registered` (Supabase error code): throw a typed `InvitedSignupError("user_already_exists")`. The route handler maps this to 409 with a message telling the user to sign in instead.
     2. Use the returned user record's `id`.
     3. `supabase.auth.signInWithPassword({ email, password })` — this binds the session to the request's cookie store (the `supabase` client passed in is the cookie-bound server client).
     4. `acceptAndActivate(repo, supabase, invitation, userId)` (Part 1.1).
   - Logs each step.

**Verification.**
- Calling with a fresh email creates a confirmed user, signs them in, accepts the invite.
- Calling with an already-registered email throws `InvitedSignupError("user_already_exists")`.

---

#### Increment 3.2: `POST /api/invite/[token]/signup` Route Handler

**What.** New route handler that validates input, resolves the invitation (must be `valid`), and orchestrates via `signupAndAcceptInvitation()`.

**Files.**

1. **Create `app/api/invite/[token]/signup/route.ts`**
   - Body schema: `z.object({ password: passwordField })` (reuse the shared schema from `lib/schemas/password-schema.ts`).
   - Resolve the token via `getInvitationByToken()`.
     - 404 if not found.
     - 410 if expired or already accepted.
   - If `valid`: call `signupAndAcceptInvitation()`.
     - On `InvitedSignupError("user_already_exists")` → 409 `{ message: "An account with this email already exists. Please sign in instead." }`.
     - On any other error → 500 with sanitised message; log full error server-side.
   - On success: 200 `{ teamId, postAuthPath }`. Set `active_team_id` cookie on the response.

**Verification.**
- New email + valid invite → 200, user can immediately access the team.
- Existing email + valid invite → 409 with sign-in hint.
- Invalid / expired / already-accepted → appropriate 4xx.
- No verification email is sent (manual check via SMTP logs / Supabase auth log).

---

#### Increment 3.3: Wire Signup Form to the New Endpoint

**What.** Switch [app/signup/_components/signup-form.tsx](app/signup/_components/signup-form.tsx) so that, **when `inviteToken` is set**, submission posts to `/api/invite/{inviteToken}/signup` instead of calling `supabase.auth.signUp()`. Direct signups are unchanged.

**Files.**

1. **Modify `app/signup/_components/signup-form.tsx`**
   - Branch in `onSubmit`:
     - Invite mode: `fetch("/api/invite/{inviteToken}/signup", { method: "POST", body: JSON.stringify({ password }) })`. On 200, `router.push(postAuthPath)`. On 409, show inline error with a `[Sign in](/login?invite=...)` link.
     - Non-invite mode: existing `supabase.auth.signUp()` path.
   - Remove the "Check your email" success state for invite mode (the user is already signed in).

**Verification.**
- Direct signup at `/signup` still hits `supabase.auth.signUp()` and shows the email-confirmation panel.
- Invited signup at `/signup?invite=...` posts to the new endpoint, no email sent, user lands directly in the workspace.
- Invited signup with an already-existing email shows a clear inline error pointing to login.

### Cross-References

- **Part 2.3** wires up the form with the invite props. Part 3.3 swaps its submit handler. The two-step split lets us land each PR independently and observe behaviour before activating the admin-API path.
- **Part 1.1** (`acceptAndActivate`) is reused by 3.1.
- **Part 5** removes the now-orphaned `EmailConfirmationPanel` import from the invite branch in `signup-form.tsx`.

### Risks & Edge Cases

- **Service-role key exposure.** The Admin API requires the Supabase service role key. The new route runs entirely on the server and the key is read from `process.env.SUPABASE_SERVICE_ROLE_KEY` (already used by [lib/supabase/server.ts:41](lib/supabase/server.ts#L41) `createServiceRoleClient()`). No client-side leak. The route must never be reachable without a valid unaccepted invite — the token check at the top of 3.2 enforces this.
- **Replay protection.** A leaked invite link grants account creation. We mitigate via (a) one-time token (the existing `accepted_at` write), (b) 7-day TTL (existing), and (c) email is fixed by the token (the user can't change which email gets the new account). An attacker who intercepts the email gets the same level of access today's flow gives them — no new attack surface.
- **Password strength.** Reuse `passwordField` from `lib/schemas/password-schema.ts` so rules match the rest of the app.
- **Race: invitation accepted between resolve and signup completion.** If the invited user clicks the link in two tabs and starts signup in both, the second `admin.createUser` call returns `User already registered`, which we already handle (409). The user sees the message and signs in — correct outcome.
- **Rate limiting.** Out of scope for this PRD; tracked in PRD-011 backlog. The invite token itself is rate-limiting (one valid token per email per 7 days, max 10 attempts before expiry is irrelevant since each attempt either succeeds or fails terminally).

---

## Part 4: Mismatch and Error States

> Implements **P4.R1–P4.R5** from PRD-035.

### Overview

Keep the small set of fixed-content screens that the dispatcher renders directly: invalid token, expired token, already-accepted, and email mismatch (with sign-out CTA). All four are server-rendered components — no client orchestrator, no `useEffect`, no `searchParams` reads other than `error=email_mismatch`.

The mismatch screen's "Sign out and continue as `invited@email.com`" action **does** require a client component (it calls `signOut()`), but it's a leaf component — it doesn't decide which state to render, the dispatcher does.

### Database Changes

None.

### API Endpoints

None new. Sign-out happens via the existing `signOut()` from `useAuth()`, which calls `supabase.auth.signOut()` and clears the active-team cookie ([as documented in CLAUDE.md auth section](CLAUDE.md)).

### Files Changed

| File | Action | Purpose |
|---|---|---|
| `app/invite/[token]/_components/invite-status-card.tsx` | **Modify** | Trim to the three terminal states (invalid / expired / already-accepted); accept props from server, no `useRouter` |
| `app/invite/[token]/_components/invite-mismatch-card.tsx` | **Modify** | Keep, simplified — receives `invitedEmail`, `userEmail`, `teamName`, `role`, `inviteToken` props; sign-out reloads to `/invite/{token}` |
| `app/invite/[token]/_components/invite-shell.tsx` | **Keep** | Layout primitive, reused |

### Implementation

#### Increment 4.1: Status Card — Server-Render Trim

**What.** Convert [invite-status-card.tsx](app/invite/%5Btoken%5D/_components/invite-status-card.tsx) so it can be rendered directly from the server dispatcher. Remove `"use client"` and the `useRouter` dependency. The "Already Accepted" CTA becomes a plain `<Link href="/login">` instead of a `router.push("/login")` button.

**Files.**

1. **Modify `app/invite/[token]/_components/invite-status-card.tsx`**
   - Drop `"use client"`.
   - Replace `useRouter` + `<Button onClick>` with `<Link href="/login">` + `<Button asChild>`.
   - Props unchanged: `{ status: "invalid" | "expired" | "already_accepted"; teamName: string | null }`.

**Verification.**
- All three statuses render server-side with no JS bundle for this branch.
- "Go to Sign In" link works (full navigation, no client routing).

---

#### Increment 4.2: Mismatch Card — Toast on `?error=email_mismatch`

**What.** Update [invite-mismatch-card.tsx](app/invite/%5Btoken%5D/_components/invite-mismatch-card.tsx) so the dispatcher can render it directly with all needed data. The sign-out action stays client-side. Move the `?error=email_mismatch` toast out of the deleted `invite-page-content.tsx` and into the mismatch card itself (or, cleaner, into a tiny `use client` sibling that the server component renders only when the query param is present).

**Files.**

1. **Modify `app/invite/[token]/_components/invite-mismatch-card.tsx`**
   - Already a `"use client"` component — keep that, since `signOut` needs the auth provider.
   - Add `inviteToken` prop. After `signOut()` completes, navigate to `/invite/{inviteToken}` (a fresh GET that re-runs the dispatcher and now renders the unauth branch → redirects to `/login?invite=...`).
   - Surface the existing email-mismatch toast on mount when `searchParams.get("error") === "email_mismatch"` — pulled in from the deleted dispatcher in Part 5.

**Verification.**
- Authed-mismatch state from the dispatcher (Part 1) renders this card with both emails surfaced.
- Click "Sign out and continue as ..." → signs out → reloads invite URL → dispatcher (now unauth) → `/login?invite=...`.
- `?error=email_mismatch` from the auth callback (Part 2.4) surfaces the toast on this same card.

### Cross-References

- **Part 1's dispatcher** is the only consumer of these components after Part 5 cleanup. Until Part 5, the legacy `invite-page-content.tsx` also imports them — leave the imports until Part 5 deletes that file.
- **Part 2.4's email-mismatch redirect** lands here.

### Risks & Edge Cases

- **Sign-out re-loop.** If the user signs out and the invitation has been accepted in the meantime (e.g. by another tab), the dispatcher will render the "already accepted" status next — correct, expected behaviour.
- **`useAuth` context availability.** `invite-mismatch-card.tsx` uses `useAuth()` for `signOut`. This requires the `AuthProvider` to wrap the route. The current root layout already does this — confirmed via [components/providers/auth-provider.tsx](components/providers/auth-provider.tsx). No change needed.

---

## Part 5: Cleanup

> Implements **P5.R1–P5.R4** from PRD-035.

### Overview

Once Parts 1–4 are live and stable (≥7 days post-rollout, matching the invite TTL so no in-flight email is still using the cookie path), delete the orphaned client orchestrator, embedded forms, the `pending_invite_token` cookie code, the `POST /api/invite/[token]/accept` route, and update documentation.

### Database Changes

None.

### API Endpoints

| Method | Path | Action |
|---|---|---|
| `POST` | `/api/invite/[token]/accept` | **Delete** |

### Files Changed

| File | Action | Purpose |
|---|---|---|
| `app/invite/[token]/_components/invite-accept-card.tsx` | **Delete** | Replaced by server-side auto-accept (Part 1) |
| `app/invite/[token]/_components/invite-sign-in-form.tsx` | **Delete** | Replaced by invite-aware `/login` (Part 2) |
| `app/invite/[token]/_components/invite-sign-up-form.tsx` | **Delete** | Replaced by invite-aware `/signup` + Part 3 endpoint |
| `app/invite/[token]/_components/invite-page-content.tsx` | **Delete** | Server dispatcher replaces this client orchestrator |
| `app/invite/[token]/_components/invite-helpers.ts` | **Delete or trim** | Remove `setInviteCookie` and the `acceptInviteApi` client wrapper. Keep `setActiveTeamCookie` if it's still used elsewhere; otherwise delete file. |
| `app/api/invite/[token]/accept/route.ts` | **Delete** | No remaining UI consumer once Part 2.2 stops calling it (it now goes through the dispatcher's server-side accept path; the post-login accept can be a server action instead of a route handler — see Increment 5.2) |
| `app/auth/callback/route.ts` | **Modify** | Remove the `pending_invite_token` cookie fallback added in Part 2.4; URL-only |
| `app/login/_components/login-form.tsx` | **Modify** | Switch post-login accept from `fetch("/api/invite/.../accept")` to a server action |
| `ARCHITECTURE.md` | **Modify** | Rewrite the invite-flow section to reflect server dispatcher + URL token; update the file map |
| `CHANGELOG.md` | **Modify** | Add PRD-035 entry per part |

### Implementation

#### Increment 5.1: Remove `pending_invite_token` Cookie Path

**What.** Remove the cookie-fallback added defensively in Part 2.4. By the time this ships, no in-flight invite email should still be using the cookie path (TTL is 10 minutes; rollout is ≥7 days post-Part-2).

**Files.**

1. **Modify `app/auth/callback/route.ts`**
   - Remove the `?? getCookie(request, "pending_invite_token")` fallback.
   - Remove the `getCookie` helper and the cookie-clearing branch (cookie is no longer set anywhere; no need to clear).

**Verification.**
- OAuth callback works for `/auth/callback?invite=...&code=...` — accepts invite, redirects.
- OAuth callback works for `/auth/callback?code=...` (no invite) — same as today, redirects to dashboard / capture.
- Search the codebase for `pending_invite_token` — zero references remain.

---

#### Increment 5.2: Convert Post-Login Accept to Server Action

**What.** The invite-aware login form (Part 2.2) currently calls `POST /api/invite/[token]/accept`. Convert this to a server action so the route handler can be deleted, removing one round-trip and one piece of public API surface.

**Files.**

1. **Modify `app/login/_components/login-form.tsx`**
   - Replace the `fetch("/api/invite/.../accept", ...)` with a server action `acceptInviteAction(token)` that calls `acceptAndActivate()` and `setActiveTeamCookieServer()`.
   - Server action lives in `app/login/_actions/accept-invite-action.ts` (new file).

2. **Create `app/login/_actions/accept-invite-action.ts`**
   - `"use server"` directive at top.
   - `export async function acceptInviteAction(token: string): Promise<{ postAuthPath: string }>`.
   - Validates auth, resolves token, enforces email match, calls `acceptAndActivate`, sets cookie, returns `postAuthPath`.

**Verification.**
- Sign-in via invite-aware login still ends in the invited workspace.
- The route handler `/api/invite/[token]/accept` has no callers (search for the path).

---

#### Increment 5.3: Delete Orphaned Files

**What.** Once 5.1 and 5.2 ship and the network logs show no traffic to `/api/invite/[token]/accept`, delete the orphaned components and the route handler.

**Files.**

1. **Delete:**
   - `app/invite/[token]/_components/invite-accept-card.tsx`
   - `app/invite/[token]/_components/invite-sign-in-form.tsx`
   - `app/invite/[token]/_components/invite-sign-up-form.tsx`
   - `app/invite/[token]/_components/invite-page-content.tsx` (already deleted in Part 1.3 — confirm no resurrection)
   - `app/api/invite/[token]/accept/route.ts`

2. **Trim `app/invite/[token]/_components/invite-helpers.ts`:**
   - Remove `setInviteCookie` and `acceptInviteApi`.
   - If `setActiveTeamCookie` (the client-side one) is no longer used anywhere, remove the re-export and consider deleting the file. The dispatcher uses the server-side variant from Part 1.2.

3. **Verify each deletion** with `grep -r <symbol> app/ components/ lib/` — no remaining importers.

**Verification.**
- `npx tsc --noEmit` passes.
- `npm run build` succeeds.
- All invite flows still work end-to-end (smoke test all 5 PRD scenarios).

---

#### Increment 5.4: Documentation Updates

**What.** Update `ARCHITECTURE.md` and `CHANGELOG.md` to reflect the simplified flow.

**Files.**

1. **Modify `ARCHITECTURE.md`**
   - File map (around [ARCHITECTURE.md:239-250](ARCHITECTURE.md#L239-L250)): replace the per-component invite directory listing with the new server-dispatcher structure.
   - Auth section (around [ARCHITECTURE.md:936-943](ARCHITECTURE.md#L936-L943)): rewrite the "Invite acceptance flow" bullets to describe the server dispatcher + URL token + direct login/signup routing + admin-API invited signup. Remove cookie references.
   - API table (around [ARCHITECTURE.md:1117](ARCHITECTURE.md#L1117)): remove `POST /api/invite/[token]/accept`. Add `POST /api/invite/[token]/signup`.

2. **Modify `CHANGELOG.md`**
   - Add a `## [Unreleased] — PRD-035` section (or the current convention).
   - One bullet per part summarising user-facing change:
     - Part 1: One-click acceptance for already-signed-in invitees.
     - Part 2: Invite emails route signed-out users directly to the right login or signup screen.
     - Part 3: Invited signups no longer require a separate email verification step.
     - Part 4: Mismatch / invalid / expired / already-accepted screens preserved.
     - Part 5: Removed legacy invite acceptance page and cookie-based token persistence.

**Verification.**
- File map paths in `ARCHITECTURE.md` match the actual filesystem.
- API endpoint table reflects the current route set.
- `CHANGELOG.md` entry is present.

### Cross-References

- **Part 1's** `acceptAndActivate()` is now the only invite-acceptance code path.
- **Part 2's** cookie fallback is removed here.
- **Part 3's** invited-signup route is the only remaining `/api/invite/[token]/*` endpoint.

### Risks & Edge Cases

- **In-flight invite emails using the cookie path.** Anyone who clicked an invite email between Part 1 and Part 2's rollout and still has the `pending_invite_token` cookie will lose context once 5.1 ships. With a 10-minute cookie TTL and a ≥7-day gap, this is an empty set in practice.
- **Bookmarked `/api/invite/[token]/accept`.** The endpoint is only called via JS — no human-bookmarkable URL. Delete is safe.
- **Documentation drift.** Per CLAUDE.md, `ARCHITECTURE.md` reflects what exists in the code, not what's planned. 5.4 must run after 5.3 lands, in the same PR or the immediately-following one.

---

## End-of-PRD Audit (after Part 5)

Per CLAUDE.md's end-of-PRD audit checklist:

- [ ] SOLID + DRY + YAGNI sweep across all touched files
- [ ] `ARCHITECTURE.md` invite section + file map + API table reflect reality
- [ ] `CHANGELOG.md` has entries for every part
- [ ] All file references in this TRD point to files that exist (or were deleted as planned)
- [ ] `npx tsc --noEmit` passes
- [ ] Smoke test all 5 PRD scenarios end-to-end:
  1. Existing user, signed in, matching email → one click, lands in workspace
  2. Existing user, signed in, different account → mismatch screen → sign out → /login?invite=... → workspace
  3. Existing user, signed out → /login?invite=... → workspace
  4. New user (no profile) → /signup?invite=... → workspace, no verification email
  5. Invalid / expired / already-accepted token → corresponding status screen
