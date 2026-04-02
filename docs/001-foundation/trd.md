# TRD-001: Foundation

> **PRD:** `docs/001-foundation/prd.md`
> **Status:** Complete — implemented (2026-03-25)

---

## Part 1: App Shell and Navigation

### Technical Decisions

- **Routing:** Next.js App Router. The root `/` redirects to `/capture`. Each tab maps to a top-level route (`/capture`, and future tabs as needed).
- **Tab navigation:** Built as a custom `TabNav` component using `next/link` and `usePathname()` from `next/navigation` to detect the active route. Not using shadcn `Tabs` component since tab clicks are route navigations, not in-page content switches.
- **Icons:** `lucide-react` (already installed via shadcn). Capture tab uses `Pencil` icon.
- **User menu placeholder:** A static `UserMenu` component with a placeholder avatar and "Sign in" text. Will be wired to auth in Part 2.
- **Global CSS tokens:** Brand colours, accent colours, typography scale, and status badge colours defined as CSS custom properties in `globals.css`. Components reference these via Tailwind classes or `var()`.
- **Layout:** A single `RootLayout` wraps all pages. It renders the `TabNav` at the top and the user menu in the top-right corner. Page content renders below.

### Files Changed / Created

| Action | File | Purpose |
|--------|------|---------|
| Modify | `app/layout.tsx` | Root layout — render `AppHeader` (contains `TabNav` + `UserMenu`), set metadata |
| Modify | `app/page.tsx` | Redirect to `/capture` |
| Create | `app/capture/page.tsx` | Capture tab placeholder page |
| Create | `app/globals.css` (modify) | Add CSS custom properties for brand tokens, typography |
| Create | `components/layout/app-header.tsx` | Top bar — contains `TabNav` on left, `UserMenu` on right |
| Create | `components/layout/tab-nav.tsx` | Multi-tab navigation with active state indicator |
| Create | `components/layout/user-menu.tsx` | Placeholder user menu (avatar + text) |
| Modify | `lib/utils.ts` | Verify `cn()` utility exists (shadcn should have created it) |

### Increment 1.1: Global Tokens and Layout Shell

**PR scope:** globals.css tokens, RootLayout, AppHeader, TabNav, UserMenu placeholder, capture placeholder page, root redirect.

**Steps:**
1. Define CSS custom properties in `globals.css`: brand colours (`--color-primary`, `--color-primary-foreground`), neutral greys, typography tokens, status badge colours.
2. Modify `app/layout.tsx`: import `AppHeader`, set metadata (title: "Accelerate Synthesis", description), wrap children in a main content area with appropriate padding.
3. Create `components/layout/app-header.tsx`: flex container with `TabNav` on the left and `UserMenu` on the right. Full-width, border-bottom for visual separation.
4. Create `components/layout/tab-nav.tsx`: renders a list of tab links. Each tab is a `next/link` with an icon and label. Uses `usePathname()` to determine the active tab and applies the indigo underline indicator. Tab config is a simple array so adding future tabs is a one-line addition.
5. Create `components/layout/user-menu.tsx`: static placeholder — a grey avatar circle and "Sign in" text. No interactivity in this increment.
6. Create `app/capture/page.tsx`: simple placeholder with "Capture" heading and "Coming soon" message.
7. Modify `app/page.tsx`: redirect to `/capture` using `redirect()` from `next/navigation`.

**Verify:**
- `npm run dev` — app loads on `localhost:3000`, auto-redirects to `/capture`
- Tab nav visible with Capture tab highlighted (indigo underline)
- User menu placeholder visible in top-right
- No horizontal overflow at 375px viewport width
- Page title reads "Accelerate Synthesis"

---

## Part 2: Authentication

### Technical Decisions

- **Auth provider:** Supabase Auth with Google OAuth. Supabase handles token exchange, session management, and cookie persistence via `@supabase/ssr`.
- **Supabase client factories:** Two factory functions — `createClient()` in `lib/supabase/server.ts` for server components and API routes (reads cookies), and `createClient()` in `lib/supabase/client.ts` for browser components. Each is created once per request/render cycle, never inline.
- **Domain restriction:** Checked in the OAuth callback route (`app/auth/callback/route.ts`). After Supabase exchanges the code for a session, the callback reads the user's email and checks the domain. If it doesn't match `ALLOWED_EMAIL_DOMAIN`, the user is signed out and redirected to an error page.
- **Middleware:** `middleware.ts` at the project root. Checks for a valid Supabase session on every request. Unauthenticated users are redirected to `/login`. Excludes `/login`, `/auth/callback`, and static assets from protection.
- **AuthProvider:** A client-side React context (`components/providers/auth-provider.tsx`) that wraps the app. It reads the Supabase session on mount (via `onAuthStateChange`), exposes `user`, `isAuthenticated`, `isLoading`, and `signOut`. The `UserMenu` component consumes this context.
- **Login page:** A simple centered card with the app name and a "Sign in with Google" button. Clicking it calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/auth/callback' } })`.
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (client-safe, replaces the legacy anon key), `ALLOWED_EMAIL_DOMAIN` (server-only, read in callback and middleware).

### Supabase Dashboard Configuration (Manual Steps)

These are done by the developer in the Supabase dashboard before the auth code works:

1. Enable Google OAuth provider in Authentication → Providers → Google
2. Add Google OAuth client ID and secret (from Google Cloud Console)
3. Set the redirect URL to `<APP_URL>/auth/callback`
4. In Authentication → URL Configuration, set Site URL to the app's base URL

### Files Changed / Created

| Action | File | Purpose |
|--------|------|---------|
| Create | `lib/supabase/server.ts` | Server-side Supabase client factory (cookies) |
| Create | `lib/supabase/client.ts` | Browser-side Supabase client factory |
| Create | `lib/constants.ts` | `ALLOWED_EMAIL_DOMAIN` and other shared constants |
| Create | `middleware.ts` | Route protection — redirect unauthenticated users to `/login` |
| Create | `app/login/page.tsx` | Login page with "Sign in with Google" button |
| Create | `app/auth/callback/route.ts` | OAuth callback — exchange code, check domain, redirect |
| Create | `components/providers/auth-provider.tsx` | React context for auth state |
| Modify | `app/layout.tsx` | Wrap children with `AuthProvider` |
| Modify | `components/layout/user-menu.tsx` | Wire to auth context — show avatar, email, sign-out dropdown |

### Increment 2.1: Supabase Clients, Login Page, and OAuth Callback

**PR scope:** Supabase client factories, constants, login page, OAuth callback with domain check.

**Steps:**
1. Create `lib/supabase/server.ts`: export `createClient()` that uses `createServerClient` from `@supabase/ssr` with cookie helpers from `next/headers`.
2. Create `lib/supabase/client.ts`: export `createClient()` that uses `createBrowserClient` from `@supabase/ssr` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Create `lib/constants.ts`: export `ALLOWED_EMAIL_DOMAIN` (read from `process.env.ALLOWED_EMAIL_DOMAIN`, fallback to `'inmobi.com'`).
4. Create `app/login/page.tsx`: centered card with app logo/name, "Sign in with Google" button. On click, calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<APP_URL>/auth/callback' } })`. This is a `'use client'` component.
5. Create `app/auth/callback/route.ts`: GET handler that reads the `code` query param, exchanges it via `supabase.auth.exchangeCodeForSession(code)`, reads the user's email, checks domain against `ALLOWED_EMAIL_DOMAIN`. On match → redirect to `/capture`. On mismatch → sign out, redirect to `/login?error=domain_restricted`.
6. Update `app/login/page.tsx` to read the `error` query param and display "Access restricted to @inmobi.com accounts" if `error=domain_restricted`.

**Verify:**
- Login page renders with "Sign in with Google" button
- Clicking the button redirects to Google OAuth consent screen
- After consent with `@inmobi.com` account, user lands on `/capture`
- After consent with non-`@inmobi.com` account, user sees error and is signed out
- `.env.local` has correct Supabase and Google OAuth values

### Increment 2.2: Middleware, AuthProvider, and User Menu

**PR scope:** Route protection middleware, auth context provider, wired user menu with sign-out.

**Steps:**
1. Create `middleware.ts`: use `createServerClient` from `@supabase/ssr` to check session. If no session and route is not `/login` or `/auth/callback` → redirect to `/login`. Refresh session on every request to prevent stale cookies. Export `config.matcher` to exclude static assets and `_next`.
2. Create `components/providers/auth-provider.tsx`: `'use client'` component. On mount, call `supabase.auth.getSession()` and subscribe to `onAuthStateChange`. Expose via context: `user` (includes email, avatar_url), `isAuthenticated`, `isLoading`, `signOut` (calls `supabase.auth.signOut()` then `router.push('/login')`).
3. Modify `app/layout.tsx`: wrap children with `<AuthProvider>`.
4. Modify `components/layout/user-menu.tsx`: consume auth context. When `isLoading` → show skeleton. When `isAuthenticated` → show user's Google avatar (via `next/image`) and email, with a `DropdownMenu` containing "Sign Out". When not authenticated → show "Sign in" link. Use shadcn `DropdownMenu` component (already installed).

**Verify:**
- Visiting `/capture` while unauthenticated → redirected to `/login`
- After sign-in → user menu shows avatar and email
- Clicking "Sign Out" → session cleared, redirected to `/login`
- Refreshing page → stays authenticated (session persisted)
- `/login` and `/auth/callback` are accessible without auth
- Browser dev tools → no Supabase service role key or `ALLOWED_EMAIL_DOMAIN` in client bundle
