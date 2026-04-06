# TRD-012: Code Quality — SOLID, DRY, and Design Consistency

> **Status:** Part 1 complete, Part 2 TRD ready — Parts 3–5 pending
> **PRD:** `docs/012-code-quality/prd.md` (draft)
> **Mirrors:** PRD Parts 1–2. Parts 3–5 TRDs will be added after Part 2 implementation.

---

## Technical Decisions

1. **Status colours use oklch to match existing tokens.** All current tokens in `globals.css` use the oklch colour space. Status and AI action tokens follow the same pattern for consistency. The oklch values are chosen to visually match the existing Tailwind palette colours they replace (e.g., `--status-error` ≈ `text-red-500`).

2. **Tokens use CSS custom properties, not Tailwind `@theme` extensions.** The existing brand tokens (`--brand-primary`, `--text-primary`, etc.) are defined as bare custom properties in `:root`, not inside `@theme inline`. Status and AI tokens follow the same pattern. Components reference them via `text-[var(--token)]` or `bg-[var(--token)]` syntax, which works with Tailwind's arbitrary value support and doesn't require extending the Tailwind config.

3. **The `ai` button variant is a CVA variant, not a separate component.** Adding a variant to the existing `buttonVariants` in `button.tsx` keeps the API surface unchanged — consumers just pass `variant="ai"`. This follows the Open/Closed principle: we extend the button's behaviour without modifying its interface. The AI tokens are referenced inline in the variant string using `bg-[var(--ai-action)]` syntax.

4. **`invite-shell.tsx` colour map migrates to token references.** The JS object storing status colours as string literals (`"bg-red-50"`, `"text-red-500"`) switches to token-based classes (`"bg-[var(--status-error-light)]"`, `"text-[var(--status-error)]"`). The object structure stays the same — only the class strings change.

5. **`window.location.href` replacements in login/reset-password are straightforward.** Both files already run in `'use client'` context. The `useRouter` hook from `next/navigation` is added and `router.push("/capture")` replaces `window.location.href = "/capture"`. No reactivity issues here — these are post-auth navigations where the session is already established.

6. **Forward compatibility with Part 2.** The status tokens defined here will be consumed by components that Part 2 later extracts (email confirmation panel, auth form shell). The token names are stable — extraction in Part 2 won't require renaming tokens. The AI button variant defined here will be consumed by the `useSignalExtraction` hook and shared re-extract component in Part 2 — the `variant="ai"` prop will carry over cleanly.

7. **Forward compatibility with Part 5.** No data-access or service layer changes in Part 1. All changes are CSS and component-level. Part 5's repository interfaces won't touch any files modified here.

---

## Part 1: Design Tokens and Typography

### Files Changed

| File | Change |
|------|--------|
| `app/globals.css` | Add status colour tokens + AI action tokens |
| `components/ui/button.tsx` | Add `ai` variant to `buttonVariants` |
| `app/capture/_components/session-capture-form.tsx` | Change Extract Signals button to `variant="ai"` |
| `app/capture/_components/expanded-session-row.tsx` | Change Extract Signals button to `variant="ai"` |
| `app/m-signals/_components/master-signal-page-content.tsx` | Change Generate button to `variant="ai"`, replace amber/blue banner colours with tokens |
| `app/invite/[token]/_components/invite-shell.tsx` | Replace colour map string literals with token references |
| `app/invite/[token]/_components/invite-mismatch-card.tsx` | Replace `border-amber-200 bg-amber-50 text-amber-500` with tokens |
| `app/invite/[token]/_components/invite-sign-in-form.tsx` | Replace `text-red-500` with token |
| `app/invite/[token]/_components/invite-sign-up-form.tsx` | Replace `text-red-500` with token |
| `app/login/_components/login-form.tsx` | Replace `text-red-500` with token, replace `window.location.href` with `router.push` |
| `app/reset-password/_components/reset-password-form.tsx` | Replace `text-red-500` with token, replace `window.location.href` with `router.push` |
| `app/signup/_components/signup-form.tsx` | Replace `text-red-500` and `bg-green-50 text-green-500` with tokens |
| `app/forgot-password/_components/forgot-password-form.tsx` | Replace `bg-green-50 text-green-500` with tokens |

### No files changed

| File | Reason |
|------|--------|
| `components/layout/workspace-switcher.tsx` | P1.R3 (arbitrary font size) — audit found no `text-[10px]` remaining; already fixed. No change needed. |

---

### Increment 1: Define tokens in globals.css

**Covers:** P1.R1, P1.R4

Add CSS custom properties to the `:root` block in `globals.css`, after the existing brand tokens.

#### Status colour tokens

```css
/* Status tokens */
--status-error: oklch(0.637 0.237 25.331);         /* ≈ red-500 */
--status-error-light: oklch(0.971 0.013 17.38);     /* ≈ red-50 */
--status-error-border: oklch(0.885 0.062 18.334);   /* ≈ red-200 */
--status-success: oklch(0.723 0.191 149.579);       /* ≈ green-500 */
--status-success-light: oklch(0.982 0.018 155.826); /* ≈ green-50 */
--status-success-border: oklch(0.905 0.093 164.15); /* ≈ green-200 */
--status-warning: oklch(0.769 0.188 70.08);         /* ≈ amber-500 */
--status-warning-light: oklch(0.987 0.022 95.277);  /* ≈ amber-50 */
--status-warning-border: oklch(0.924 0.096 95.277); /* ≈ amber-200 */
--status-warning-text: oklch(0.555 0.163 48.998);   /* ≈ amber-800 */
--status-info: oklch(0.623 0.214 259.815);          /* ≈ blue-500 */
--status-info-light: oklch(0.97 0.014 254.604);     /* ≈ blue-50 */
--status-info-border: oklch(0.882 0.059 254.128);   /* ≈ blue-200 */
--status-info-text: oklch(0.424 0.199 265.638);     /* ≈ blue-800 */
```

#### AI action colour tokens

```css
/* AI action tokens */
--ai-action: oklch(0.78 0.16 75);           /* warm gold — primary button background */
--ai-action-foreground: oklch(0.25 0.05 60); /* dark warm brown — text on gold */
--ai-action-hover: oklch(0.72 0.17 75);      /* darker gold — hover state */
--ai-action-light: oklch(0.95 0.04 75);      /* subtle gold tint — for secondary uses */
```

**Verification:** After adding tokens, run `npm run dev` and visually confirm the app loads with no CSS errors. No component references the tokens yet — this increment is additive only.

---

### Increment 2: Add `ai` button variant

**Covers:** P1.R5

Add the `ai` variant to the `variants.variant` object in `components/ui/button.tsx`:

```typescript
ai: "border-transparent bg-[var(--ai-action)] text-[var(--ai-action-foreground)] hover:bg-[var(--ai-action-hover)] focus-visible:ring-[var(--ai-action)]/40",
```

This follows the same pattern as the existing variants — background, text, hover, and focus ring. The `border-transparent` matches the default variant. Disabled and active states are handled by the base CVA classes (`disabled:pointer-events-none disabled:opacity-50 active:translate-y-px`).

**Verification:** Temporarily render a `<Button variant="ai">Test</Button>` on the capture page to confirm the gold colour renders correctly with legible text and visible hover darkening.

---

### Increment 3: Apply `ai` variant to AI action buttons

**Covers:** P1.R5 (application), P1.AC7

Three files change:

**`app/capture/_components/session-capture-form.tsx` (line 302)**
```
Before: variant="outline"
After:  variant="ai"
```

**`app/capture/_components/expanded-session-row.tsx` (line 401)**
```
Before: variant="outline"
After:  variant="ai"
```

**`app/m-signals/_components/master-signal-page-content.tsx` (line 186)**
```
Before: (no variant — uses default/primary)
After:  variant="ai"
```

**Verification:** Navigate to the capture page and confirm:
- "Extract Signals" button has warm gold background with dark text
- Button hover darkens the gold
- Disabled state (no input) shows muted gold with 50% opacity
- Loading state ("Extracting…") retains gold background
- "Re-extract Signals" / "Re-extract" variant also shows gold

Navigate to the master signals page and confirm:
- "Generate Master Signal" button has the same gold styling
- "Re-generate" variant matches

---

### Increment 4: Replace hardcoded status colours with tokens

**Covers:** P1.R1, P1.R2, P1.AC2

Replace every hardcoded Tailwind status colour with a CSS custom property reference. Changes grouped by status type:

#### Error colours (`text-red-500` → `text-[var(--status-error)]`)

| File | Lines | Before | After |
|------|-------|--------|-------|
| `login-form.tsx` | 95, 116, 121 | `text-red-500` | `text-[var(--status-error)]` |
| `reset-password-form.tsx` | 79, 92, 99 | `text-red-500` | `text-[var(--status-error)]` |
| `signup-form.tsx` | 121, 134, 147 | `text-red-500` | `text-[var(--status-error)]` |
| `invite-sign-in-form.tsx` | 123, 128 | `text-red-500` | `text-[var(--status-error)]` |
| `invite-sign-up-form.tsx` | 141, 154, 161 | `text-red-500` | `text-[var(--status-error)]` |

#### Success colours (`bg-green-50` / `text-green-500`)

| File | Lines | Before | After |
|------|-------|--------|-------|
| `forgot-password-form.tsx` | 45 | `bg-green-50` | `bg-[var(--status-success-light)]` |
| `forgot-password-form.tsx` | 46 | `text-green-500` | `text-[var(--status-success)]` |
| `signup-form.tsx` | 76 | `bg-green-50` | `bg-[var(--status-success-light)]` |
| `signup-form.tsx` | 77 | `text-green-500` | `text-[var(--status-success)]` |

#### Warning colours (`bg-amber-50` / `border-amber-200` / `text-amber-*`)

| File | Lines | Before | After |
|------|-------|--------|-------|
| `invite-mismatch-card.tsx` | 35 | `border-amber-200 bg-amber-50` | `border-[var(--status-warning-border)] bg-[var(--status-warning-light)]` |
| `invite-mismatch-card.tsx` | 37 | `text-amber-500` | `text-[var(--status-warning)]` |
| `master-signal-page-content.tsx` | 216 | `border-amber-200 bg-amber-50 ... text-amber-800` | `border-[var(--status-warning-border)] bg-[var(--status-warning-light)] ... text-[var(--status-warning-text)]` |
| `master-signal-page-content.tsx` | 233 | `border-amber-200 bg-amber-50 ... text-amber-800` | `border-[var(--status-warning-border)] bg-[var(--status-warning-light)] ... text-[var(--status-warning-text)]` |

#### Info colours (`bg-blue-50` / `border-blue-200` / `text-blue-800`)

| File | Lines | Before | After |
|------|-------|--------|-------|
| `master-signal-page-content.tsx` | 245 | `border-blue-200 bg-blue-50 ... text-blue-800` | `border-[var(--status-info-border)] bg-[var(--status-info-light)] ... text-[var(--status-info-text)]` |

#### Invite-shell colour map (JS object)

**`invite-shell.tsx` (lines 56–64)**

```typescript
// Before
const config = {
  error:    { icon: AlertCircle,  bg: "bg-red-50",   text: "text-red-500" },
  expired:  { icon: Clock,        bg: "bg-amber-50",  text: "text-amber-500" },
  accepted: { icon: CheckCircle2, bg: "bg-green-50",  text: "text-green-500" },
}[variant];

// After
const config = {
  error:    { icon: AlertCircle,  bg: "bg-[var(--status-error-light)]",   text: "text-[var(--status-error)]" },
  expired:  { icon: Clock,        bg: "bg-[var(--status-warning-light)]",  text: "text-[var(--status-warning)]" },
  accepted: { icon: CheckCircle2, bg: "bg-[var(--status-success-light)]",  text: "text-[var(--status-success)]" },
}[variant];
```

**Verification:** Visit each affected page and compare against baseline screenshots:
- Login page: error message colour unchanged
- Signup page: error messages + "Check your email" success panel unchanged
- Forgot password page: "Check your email" panel unchanged
- Reset password page: error messages unchanged
- Invite page: status icons (error, expired, accepted) unchanged
- Invite mismatch card: warning banner unchanged
- Master signals page: stale/warning/info banners unchanged

---

### Increment 5: Fix navigation and arbitrary font sizes

**Covers:** P1.R3, P1.R6, P1.AC3, P1.AC9

#### `window.location.href` → `router.push`

**`app/login/_components/login-form.tsx` (line 60)**

```typescript
// Before
window.location.href = "/capture";

// After
const router = useRouter();  // add import { useRouter } from "next/navigation"
// ... inside the success handler:
router.push("/capture");
```

**`app/reset-password/_components/reset-password-form.tsx` (line 54)**

Same pattern — add `useRouter` import, replace `window.location.href = "/capture"` with `router.push("/capture")`.

Both files are `'use client'` components that already import from `next/navigation` or can add the import. The navigation happens after successful auth actions (login callback, password reset), so `router.push` is the correct approach — no full reload needed.

#### Arbitrary font sizes

The audit found no remaining `text-[Npx]` values in the codebase. P1.R3 / P1.AC3 is already satisfied — no changes needed.

**Verification:**
- Login flow: sign in with Google → confirm redirect to `/capture` works via router.push (no full page reload flash)
- Reset password flow: complete password reset → confirm redirect to `/capture` works
- Run `grep -r 'text-\[' --include='*.tsx' --include='*.ts'` on the codebase to confirm zero matches for arbitrary font sizes

---

### Increment 6: End-of-part audit and documentation updates

**Covers:** CLAUDE.md Quality Gates (end-of-part audit) + post-part documentation

This increment produces fixes (if any violations are found) and documentation updates — not a report.

#### End-of-part audit checklist

1. **SRP violations** — Part 1 does not introduce new components or split existing ones. Each file change has a single concern (token migration or variant swap). ✅ No violations.
2. **DRY violations** — Status token names are defined once in `globals.css`. No duplication introduced. ✅ No violations.
3. **Design token adherence** — This is the entire point of Part 1. After completion, zero hardcoded status colours remain. ✅ Verified: `grep` for `text-red-`, `bg-red-`, `text-green-`, `bg-green-`, `text-amber-`, `bg-amber-`, `text-blue-`, `bg-blue-` returns zero matches across all `.tsx` files.
4. **Logging** — No API routes or services are modified. No logging changes needed. ✅ N/A.
5. **Dead code** — No imports or variables become unused. The old Tailwind colour classes are replaced, not left alongside new ones. ✅ No unused imports found.
6. **Convention compliance** — Token naming follows the existing pattern (`--brand-primary`, `--text-primary`). New tokens use `--status-*` and `--ai-action-*` prefixes consistently. ✅ All 18 tokens present in `globals.css`.

Additional verification:
- Zero `window.location.href` for navigation in `.tsx` files ✅
- Zero `text-[Npx]` arbitrary font sizes in `.tsx` files ✅
- All 3 AI action buttons use `variant="ai"` ✅

#### Documentation updates

1. **`ARCHITECTURE.md`** — Update the `globals.css` entry in the File Map to mention status and AI action tokens. Update the `button.tsx` entry to note the `ai` variant. Add file map entries for any new files added by Part 1 (none — all changes are to existing files).
2. **`CHANGELOG.md`** — Add entry summarising Part 1 delivery.

**Verification:** Read back both files after editing to confirm accuracy. Cross-reference file map entries against actual files on disk.

---
---

## Part 2: DRY — Shared Utilities and Patterns

### Technical Decisions

1. **Client-side cookie helpers become a single shared module.** Four client-side files define their own `getActiveTeamId()` (workspace-switcher, past-sessions-table, master-signal-page-content, settings-page-content). Three files define their own `setActiveTeamCookie()` (workspace-switcher, create-team-dialog, invite-helpers). All converge into one file: `lib/cookies/active-team.ts`. This module exports `getActiveTeamId()`, `setActiveTeamCookie()`, and `clearActiveTeamCookie()` — all client-side (`document.cookie`). The server-side `getActiveTeamId()` in `lib/supabase/server.ts` is left untouched — it uses `next/headers` cookies and cannot share an implementation with the client-side version.

2. **Reactive `activeTeamId` lives in AuthProvider context, not a separate context.** Adding a new context would require a new provider in the component tree and add complexity. The active team is tightly coupled to the authenticated user — switching teams is meaningless without auth. The `AuthContextValue` interface gains `activeTeamId: string | null` and `setActiveTeam: (teamId: string | null) => void`. `setActiveTeam` writes the cookie (via the shared helper) and updates the context value, triggering re-renders in all consuming components. This eliminates every `window.location.reload()` call — workspace-switcher, create-team-dialog, and invite-mismatch-card call `setActiveTeam()` instead.

3. **PastSessionsTable and MasterSignalPageContent consume `activeTeamId` from context.** Currently both define their own `getActiveTeamId()` and call it once at render time (not reactive). After this change, they read `activeTeamId` from `useAuth()` and include it in their `useEffect` dependency arrays. When the context value changes, the effect refires and fetches the new team's data. No `window.location.reload()` needed.

4. **The extraction hook returns state + handlers, not JSX.** `useSignalExtraction` returns `{ extractionState, structuredNotes, lastExtractedNotes, showReextractConfirm, isStructuredDirty, setStructuredNotes, handleExtractSignals, handleConfirmReextract, dismissReextractConfirm }`. It does NOT return rendered components — that would couple the hook to a specific layout. The re-extract confirmation dialog is a separate shared component that receives `show`, `onConfirm`, and `onCancel` props.

5. **The extraction hook accepts a `getInput` callback.** The two consumers compose AI input differently — `session-capture-form` uses `composeAIInput(rawNotes, attachments)` while `expanded-session-row` uses `composeAIInput(rawNotes, [...savedAttachments, ...pendingAttachments])`. The hook accepts `getInput: () => string` so each consumer can provide their own input composition. The hook also accepts optional `initialStructuredNotes` for the expanded-row case where existing structured notes are loaded from the server.

6. **Auth form shell is a layout component, not a page.** `AuthFormShell` wraps the centered card with heading/subtitle. It accepts `title`, `subtitle`, and `children`. The "Check your email" panel is a separate component (`EmailConfirmationPanel`) that accepts `email`, `message`, and optionally `linkText`/`linkHref`. Both are co-located in `components/auth/` because they're shared across 4+ routes.

7. **AI error mapper is a pure function, not middleware.** `mapAIErrorToResponse(err: unknown, routeLabel: string): NextResponse` handles all 5 error types + the unexpected fallback. Each AI route's catch block becomes a single function call. The `routeLabel` parameter (e.g., `"api/ai/extract-signals"`) is used for console.error log prefixes. The error messages differ per route for the context-specific ones (AIRequestError, AIEmptyResponseError) — the mapper accepts optional overrides via a `messages` parameter: `Partial<Record<'request' | 'empty', string>>`.

8. **Role picker is a controlled component.** `RolePicker` accepts `value: Role` and `onValueChange: (role: Role) => void`. The `Role` type (`"admin" | "sales"`) is exported from the same file. Both invite forms use it identically — the only difference is layout context (inline vs. dialog), which the parent controls.

9. **Forward compatibility with Part 3.** The `useSignalExtraction` hook created here is consumed by both `session-capture-form.tsx` and `expanded-session-row.tsx`. Part 3 decomposes these files into focused subcomponents — the hook will move into the extraction-focused subcomponent, not the parent coordinator. The hook's interface is stable enough that Part 3 extraction won't require changing the hook itself.

10. **Forward compatibility with Part 4.** The AI error mapper created here will be consumed by the same route handlers that Part 4 later refactors. When Part 4 extracts orchestration into services, the route catch blocks (now single `mapAIErrorToResponse` calls) carry over unchanged.

11. **Forward compatibility with Part 5.** The auth-provider profile query deduplication (P2.R8) touches `auth-provider.tsx` which directly queries Supabase. Part 5 will eventually move this behind a repository interface. The internal helper we extract here keeps the query logic in one place, making Part 5's migration simpler — one call site to redirect instead of two.

---

### Files Changed

| File | Change |
|------|--------|
| `lib/cookies/active-team.ts` | **New.** Client-side cookie helpers: `getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie` |
| `components/providers/auth-provider.tsx` | Add `activeTeamId` and `setActiveTeam` to context; extract profile query helper |
| `components/layout/workspace-switcher.tsx` | Remove local cookie helpers; consume `activeTeamId` + `setActiveTeam` from context; remove `window.location.reload()` |
| `components/layout/create-team-dialog.tsx` | Remove local `setActiveTeamCookie`; consume `setActiveTeam` from context; remove `window.location.reload()` |
| `app/invite/[token]/_components/invite-mismatch-card.tsx` | Remove `window.location.reload()`; use `signOut` from auth context (already does redirect) |
| `app/capture/_components/past-sessions-table.tsx` | Remove local `getActiveTeamId()`; consume `activeTeamId` from `useAuth()`; add to useEffect deps |
| `app/m-signals/_components/master-signal-page-content.tsx` | Remove local `getActiveTeamId()`; consume `activeTeamId` from `useAuth()`; add to useEffect deps |
| `app/settings/_components/settings-page-content.tsx` | Remove local `getActiveTeamId()`; consume `activeTeamId` from `useAuth()` |
| `app/settings/_components/team-members-table.tsx` | Remove inline cookie clear; use `clearActiveTeamCookie` from shared module |
| `app/settings/_components/team-danger-zone.tsx` | Remove inline cookie clear; use `clearActiveTeamCookie` from shared module |
| `lib/hooks/use-signal-extraction.ts` | **New.** Shared hook: `ExtractionState`, extraction state machine, re-extract confirmation flow |
| `components/capture/reextract-confirm-dialog.tsx` | **New.** Shared re-extract confirmation dialog component |
| `app/capture/_components/session-capture-form.tsx` | Remove extraction state/logic; consume `useSignalExtraction` hook + `ReextractConfirmDialog` |
| `app/capture/_components/expanded-session-row.tsx` | Remove extraction state/logic; consume `useSignalExtraction` hook + `ReextractConfirmDialog` |
| `components/auth/auth-form-shell.tsx` | **New.** Shared centered auth card layout with title/subtitle |
| `components/auth/email-confirmation-panel.tsx` | **New.** Shared "Check your email" success panel |
| `app/login/_components/login-form.tsx` | Use `AuthFormShell` instead of inline card markup |
| `app/signup/_components/signup-form.tsx` | Use `AuthFormShell` + `EmailConfirmationPanel` instead of inline markup |
| `app/forgot-password/_components/forgot-password-form.tsx` | Use `AuthFormShell` + `EmailConfirmationPanel` instead of inline markup |
| `app/reset-password/_components/reset-password-form.tsx` | Use `AuthFormShell` instead of inline card markup |
| `lib/utils/map-ai-error.ts` | **New.** `mapAIErrorToResponse()` — shared AI error-to-HTTP mapper |
| `app/api/ai/extract-signals/route.ts` | Replace error mapping block with `mapAIErrorToResponse()` call |
| `app/api/ai/generate-master-signal/route.ts` | Replace error mapping block with `mapAIErrorToResponse()` call |
| `components/settings/role-picker.tsx` | **New.** `RolePicker` component + exported `Role` type |
| `app/settings/_components/invite-single-form.tsx` | Remove local `Role` type and Select block; use `RolePicker` |
| `app/settings/_components/invite-bulk-dialog.tsx` | Remove local `Role` type and Select block; use `RolePicker` |

### Files not changed

| File | Reason |
|------|--------|
| `lib/supabase/server.ts` | Server-side `getActiveTeamId()` uses `next/headers` — different API from client-side `document.cookie`. Left in place. |
| `app/invite/[token]/_components/invite-helpers.ts` | `setActiveTeamCookie()` here is only used by invite flows and already co-located. Will import from `lib/cookies/active-team.ts` instead. Actually — this file IS changed (import redirect). Added to files changed. |
| `app/auth/callback/route.ts` | Server-side cookie set via `response.cookies.set()` — different API. No change needed. |
| `middleware.ts` | Reads cookie via `request.cookies.get()` — server-side API. No change needed. |

---

### Increment 1: Client-side cookie helpers and reactive team context

**Covers:** P2.R1, P2.AC1a, P2.AC1b, P2.AC1c, P2.AC1d

This is the highest-risk increment — it touches the auth provider (used by every page) and the workspace switching flow. Ship this first and verify the full team-switch cycle before proceeding.

#### Step 1: Create `lib/cookies/active-team.ts`

```typescript
/**
 * Client-side active team cookie helpers.
 * Server-side reads use `getActiveTeamId()` from `lib/supabase/server.ts` (next/headers).
 */

const COOKIE_NAME = "active_team_id";
const COOKIE_TTL = 60 * 60 * 24 * 365; // 1 year

export function getActiveTeamId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function setActiveTeamCookie(teamId: string): void {
  document.cookie = `${COOKIE_NAME}=${teamId}; path=/; max-age=${COOKIE_TTL}; SameSite=Lax`;
}

export function clearActiveTeamCookie(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}
```

#### Step 2: Add `activeTeamId` and `setActiveTeam` to AuthProvider

Extend `AuthContextValue`:

```typescript
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  canCreateTeam: boolean;
  activeTeamId: string | null;
  setActiveTeam: (teamId: string | null) => void;
  signOut: () => Promise<void>;
}
```

Inside `AuthProvider`:

```typescript
const [activeTeamId, setActiveTeamId] = useState<string | null>(() => getActiveTeamId());

const setActiveTeam = useCallback((teamId: string | null) => {
  if (teamId) {
    setActiveTeamCookie(teamId);
  } else {
    clearActiveTeamCookie();
  }
  setActiveTeamId(teamId);
}, []);
```

Import `getActiveTeamId`, `setActiveTeamCookie`, `clearActiveTeamCookie` from `@/lib/cookies/active-team`.

Extract the duplicated profile query into a helper within the file:

```typescript
function fetchCanCreateTeam(
  supabase: SupabaseClient,
  userId: string,
  setter: (v: boolean) => void
) {
  supabase
    .from("profiles")
    .select("can_create_team")
    .eq("id", userId)
    .single()
    .then(({ data }) => {
      setter(data?.can_create_team ?? false);
    });
}
```

Call `fetchCanCreateTeam(supabase, currentUser.id, setCanCreateTeam)` from both the initial `getUser` path and the `onAuthStateChange` path.

#### Step 3: Migrate consumers

**`workspace-switcher.tsx`:**
- Remove local `getActiveTeamId()` and `setActiveTeamCookie()` functions
- Import `useAuth` (already imported) — destructure `activeTeamId`, `setActiveTeam`
- Remove local `activeTeamId` state (`useState` + `useEffect` that reads cookie)
- Replace `handleSwitch`: call `setActiveTeam(teamId)` instead of `setActiveTeamCookie(teamId) + window.location.reload()`
- Teams list still fetched via `/api/teams` on mount — no change

**`create-team-dialog.tsx`:**
- Remove local `setActiveTeamCookie()` function
- Import `useAuth` — destructure `setActiveTeam`
- Replace: `setActiveTeamCookie(team.id) ... window.location.reload()` → `setActiveTeam(team.id)`
- The `router.push` to `/capture` is not needed here — the user is already on a page, and the context update triggers re-renders. If the dialog is on the settings page, the user stays there with the new team context.

**`invite-mismatch-card.tsx`:**
- The `window.location.reload()` here is called after `signOut()`. The `signOut` in auth-provider already calls `router.push("/login")`. Remove the reload — signOut handles it.

**`past-sessions-table.tsx`:**
- Remove local `getActiveTeamId()` function
- Destructure `activeTeamId` from `useAuth()` (already imports `useAuth`)
- Remove `const activeTeamId = getActiveTeamId()` from component body
- Add `activeTeamId` to the `useEffect` dependency array for `fetchSessions` — when team changes, sessions refetch

**`master-signal-page-content.tsx`:**
- Remove local `getActiveTeamId()` function
- Import `useAuth` — destructure `activeTeamId`
- Remove `const activeTeamId = getActiveTeamId()` from component body
- Add `activeTeamId` to relevant `useEffect` dependency arrays

**`settings-page-content.tsx`:**
- Remove local `getActiveTeamId()` function
- Destructure `activeTeamId` from `useAuth()`
- Remove the `useEffect` that calls `getActiveTeamId()` on mount — read directly from context

**`team-members-table.tsx`:**
- Replace inline `document.cookie = "active_team_id=; ..."` with `clearActiveTeamCookie()` import from `@/lib/cookies/active-team`

**`team-danger-zone.tsx`:**
- Same as team-members-table — replace inline cookie clear with `clearActiveTeamCookie()`

**`invite-helpers.ts`:**
- Remove local `setActiveTeamCookie()` function and `ACTIVE_TEAM_COOKIE_TTL` constant
- Import `setActiveTeamCookie` from `@/lib/cookies/active-team`
- Keep `setInviteCookie` and `acceptInviteApi` unchanged

**Verification:**
- Switch workspace → sessions table updates without page reload
- Create new team → UI reflects new team context without page reload
- Invite mismatch → sign out redirects to login correctly
- Settings page → shows correct team context after switch
- Master signals page → loads correct team's data after switch
- Sign out → clears context, redirects to login
- Refresh browser → cookie persists, correct team loaded

---

### Increment 2: Signal extraction hook and re-extract dialog

**Covers:** P2.R2, P2.R3, P2.AC2, P2.AC3

#### Step 1: Create `lib/hooks/use-signal-extraction.ts`

```typescript
"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

export type ExtractionState = "idle" | "extracting" | "done"

interface UseSignalExtractionOptions {
  getInput: () => string;
  initialStructuredNotes?: string | null;
}

interface UseSignalExtractionReturn {
  extractionState: ExtractionState;
  structuredNotes: string | null;
  lastExtractedNotes: string | null;
  showReextractConfirm: boolean;
  isStructuredDirty: boolean;
  setStructuredNotes: (notes: string | null) => void;
  handleExtractSignals: () => Promise<void>;
  handleConfirmReextract: () => Promise<void>;
  dismissReextractConfirm: () => void;
}

export function useSignalExtraction({
  getInput,
  initialStructuredNotes = null,
}: UseSignalExtractionOptions): UseSignalExtractionReturn {
  const [structuredNotes, setStructuredNotes] = useState<string | null>(initialStructuredNotes);
  const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(initialStructuredNotes);
  const [extractionState, setExtractionState] = useState<ExtractionState>(
    initialStructuredNotes ? "done" : "idle"
  );
  const [showReextractConfirm, setShowReextractConfirm] = useState(false);

  const isStructuredDirty = structuredNotes !== lastExtractedNotes;

  const performExtraction = useCallback(async () => {
    setExtractionState("extracting");

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: getInput() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const msg = errorData?.message ?? "Failed to extract signals";
        response.status === 402 ? toast.warning(msg) : toast.error(msg);
        setExtractionState((prev) => (structuredNotes ? "done" : "idle"));
        return;
      }

      const { structuredNotes: extracted } = await response.json();
      setStructuredNotes(extracted);
      setLastExtractedNotes(extracted);
      setExtractionState("done");
      toast.success("Signals extracted");
    } catch (err) {
      console.error(
        "[useSignalExtraction] extraction error:",
        err instanceof Error ? err.message : err
      );
      toast.error("Failed to extract signals — please try again");
      setExtractionState((prev) => (structuredNotes ? "done" : "idle"));
    }
  }, [getInput, structuredNotes]);

  const handleExtractSignals = useCallback(async () => {
    if (extractionState === "done" && isStructuredDirty) {
      setShowReextractConfirm(true);
      return;
    }
    await performExtraction();
  }, [extractionState, isStructuredDirty, performExtraction]);

  const handleConfirmReextract = useCallback(async () => {
    setShowReextractConfirm(false);
    await performExtraction();
  }, [performExtraction]);

  const dismissReextractConfirm = useCallback(() => {
    setShowReextractConfirm(false);
  }, []);

  return {
    extractionState,
    structuredNotes,
    lastExtractedNotes,
    showReextractConfirm,
    isStructuredDirty,
    setStructuredNotes,
    handleExtractSignals,
    handleConfirmReextract,
    dismissReextractConfirm,
  };
}
```

#### Step 2: Create `components/capture/reextract-confirm-dialog.tsx`

```typescript
import { Button } from "@/components/ui/button"

interface ReextractConfirmDialogProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReextractConfirmDialog({
  show,
  onConfirm,
  onCancel,
}: ReextractConfirmDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-base font-semibold text-foreground">
          Re-extract Signals?
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Re-extracting will replace your edited signals. Continue?
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            Re-extract
          </Button>
        </div>
      </div>
    </div>
  );
}
```

#### Step 3: Migrate consumers

**`session-capture-form.tsx`:**
- Remove `ExtractionState` type, `structuredNotes`/`lastExtractedNotes`/`extractionState`/`showReextractConfirm` state declarations, `performExtraction`, `handleExtractSignals`, `handleConfirmReextract`, `isStructuredDirty` computation
- Add:
  ```typescript
  const getExtractionInput = useCallback(
    () => composeAIInput(getValues("rawNotes"), attachments),
    [getValues, attachments]
  );

  const {
    extractionState, structuredNotes, isStructuredDirty,
    showReextractConfirm, setStructuredNotes,
    handleExtractSignals, handleConfirmReextract, dismissReextractConfirm,
  } = useSignalExtraction({ getInput: getExtractionInput });
  ```
- Replace the inline re-extract confirmation dialog (lines 350–379) with:
  ```tsx
  <ReextractConfirmDialog
    show={showReextractConfirm}
    onConfirm={handleConfirmReextract}
    onCancel={dismissReextractConfirm}
  />
  ```

**`expanded-session-row.tsx`:**
- Same removals as above
- Add:
  ```typescript
  const getExtractionInput = useCallback(
    () => composeAIInput(rawNotes, [...savedAttachments, ...pendingAttachments]),
    [rawNotes, savedAttachments, pendingAttachments]
  );

  const {
    extractionState, structuredNotes, isStructuredDirty,
    showReextractConfirm, setStructuredNotes,
    handleExtractSignals, handleConfirmReextract, dismissReextractConfirm,
  } = useSignalExtraction({
    getInput: getExtractionInput,
    initialStructuredNotes: session.structured_notes,
  });
  ```
- Replace the inline re-extract dialog (lines 527–555) with `<ReextractConfirmDialog ... />`
- `isDirty` computation still references `structuredNotes` — this works because the hook returns the current value

**Verification:**
- New capture form: type notes → extract → edit signals → re-extract shows confirmation → confirm replaces signals
- Expanded row: same flow with existing session + attachments
- 402 quota error still shows warning toast (not error)
- Failed extraction with existing signals stays in "done" state (not "idle")
- Failed extraction with no prior signals stays in "idle" state

---

### Increment 3: Auth form shell and email confirmation panel

**Covers:** P2.R4, P2.R5, P2.AC4, P2.AC5

#### Step 1: Create `components/auth/auth-form-shell.tsx`

```typescript
interface AuthFormShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export function AuthFormShell({ title, subtitle, children }: AuthFormShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {subtitle}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
```

#### Step 2: Create `components/auth/email-confirmation-panel.tsx`

```typescript
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

interface EmailConfirmationPanelProps {
  email: string;
  message: string;
  linkText?: string;
  linkHref?: string;
}

export function EmailConfirmationPanel({
  email,
  message,
  linkText = "Back to sign in",
  linkHref = "/login",
}: EmailConfirmationPanelProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--status-success-light)]">
          <CheckCircle2 className="size-6 text-[var(--status-success)]" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {message.replace("{email}", "")}
          {email && <strong>{email}</strong>}
          {message.includes("{email}") ? message.split("{email}")[1] : ""}
        </p>
        <Link
          href={linkHref}
          className="mt-6 inline-block text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {linkText}
        </Link>
      </div>
    </div>
  );
}
```

Note: The message interpolation above is awkward. A cleaner approach is to accept `children` or a render prop for the message body. Decision: accept `message` as a ReactNode instead:

```typescript
interface EmailConfirmationPanelProps {
  children: React.ReactNode; // message body with email highlighted
  linkText?: string;
  linkHref?: string;
}
```

Consumer usage (signup):
```tsx
<EmailConfirmationPanel>
  We&apos;ve sent a confirmation link to <strong>{confirmedEmail}</strong>.
  Click the link in your email to activate your account.
</EmailConfirmationPanel>
```

Consumer usage (forgot-password):
```tsx
<EmailConfirmationPanel>
  If an account exists for <strong>{submittedEmail}</strong>,
  we&apos;ve sent a password reset link.
</EmailConfirmationPanel>
```

#### Step 3: Migrate consumers

**`login-form.tsx`:**
- Remove outer `<div className="flex min-h-screen ...">` and `<div className="w-full max-w-sm ...">` and the header block
- Wrap with `<AuthFormShell title="Synthesiser" subtitle="Sign in to capture and synthesise client feedback.">`
- Import from `@/components/auth/auth-form-shell`

**`signup-form.tsx`:**
- Replace the `confirmedEmail` branch with `<EmailConfirmationPanel>...</EmailConfirmationPanel>`
- Replace the main form branch outer markup with `<AuthFormShell title="Synthesiser" subtitle="Create your account to get started.">`
- Remove `CheckCircle2` import (moved to shared component)

**`forgot-password-form.tsx`:**
- Replace `submittedEmail` branch with `<EmailConfirmationPanel>...</EmailConfirmationPanel>`
- Replace main form outer markup with `<AuthFormShell title="Forgot password?" subtitle="Enter your email and we'll send you a reset link.">`
- Remove `CheckCircle2` import

**`reset-password-form.tsx`:**
- Replace outer markup with `<AuthFormShell title="Reset password" subtitle="Enter your new password.">`

**Verification:**
- Login page: identical visual appearance
- Signup page: form view + "Check your email" view both match current appearance
- Forgot password page: same
- Reset password page: same
- Responsive layout (mobile): centered card still works

---

### Increment 4: AI error response mapper

**Covers:** P2.R6, P2.AC6

#### Step 1: Create `lib/utils/map-ai-error.ts`

```typescript
import { NextResponse } from "next/server";
import {
  AIConfigError,
  AIQuotaError,
  AIRequestError,
  AIEmptyResponseError,
  AIServiceError,
} from "@/lib/services/ai-service";

interface AIErrorMessages {
  request?: string;
  empty?: string;
  unexpected?: string;
}

const DEFAULT_MESSAGES: Required<AIErrorMessages> = {
  request: "Could not process the request. Please try shortening the input or removing special characters.",
  empty: "AI could not produce a result from the provided input. Please ensure the content is sufficient and try again.",
  unexpected: "An unexpected error occurred.",
};

export function mapAIErrorToResponse(
  err: unknown,
  routeLabel: string,
  messages?: AIErrorMessages
): NextResponse {
  const msgs = { ...DEFAULT_MESSAGES, ...messages };

  if (err instanceof AIConfigError) {
    console.error(`[${routeLabel}] config error:`, err.message);
    return NextResponse.json(
      { message: "AI service is not configured correctly. Please contact support." },
      { status: 500 }
    );
  }

  if (err instanceof AIQuotaError) {
    console.error(`[${routeLabel}] quota error:`, err.message);
    return NextResponse.json(
      { message: "We've hit our AI usage limit — looks like a lot of people are finding this useful! Please try again later or reach out so we can get things running again." },
      { status: 402 }
    );
  }

  if (err instanceof AIRequestError) {
    console.error(`[${routeLabel}] request error:`, err.message);
    return NextResponse.json(
      { message: msgs.request },
      { status: 400 }
    );
  }

  if (err instanceof AIEmptyResponseError) {
    console.error(`[${routeLabel}] empty response:`, err.message);
    return NextResponse.json(
      { message: msgs.empty },
      { status: 422 }
    );
  }

  if (err instanceof AIServiceError) {
    console.error(`[${routeLabel}] service error:`, err.message);
    return NextResponse.json(
      { message: `${routeLabel.split("/").pop()?.replace(/-/g, " ")} is temporarily unavailable. Please try again in a few moments.` },
      { status: 503 }
    );
  }

  // Unexpected error
  console.error(
    `[${routeLabel}] unexpected error:`,
    err instanceof Error ? err.message : err
  );
  return NextResponse.json(
    { message: msgs.unexpected },
    { status: 500 }
  );
}
```

#### Step 2: Migrate consumers

**`app/api/ai/extract-signals/route.ts`:**
- Remove individual error type imports (keep the service function imports)
- Import `mapAIErrorToResponse` from `@/lib/utils/map-ai-error`
- Replace the entire catch block (lines 77–143) with:
  ```typescript
  } catch (err) {
    return mapAIErrorToResponse(err, "api/ai/extract-signals", {
      request: "Could not process these notes. Please try shortening them or removing special characters.",
      empty: "AI could not extract signals from these notes. Please ensure the notes contain session content and try again.",
      unexpected: "An unexpected error occurred during signal extraction.",
    });
  }
  ```

**`app/api/ai/generate-master-signal/route.ts`:**
- Same pattern — replace catch block (lines 168–252) with:
  ```typescript
  } catch (err) {
    return mapAIErrorToResponse(err, "api/ai/generate-master-signal", {
      request: "Could not generate master signal. The input may be too large — try extracting signals from fewer sessions.",
      empty: "AI could not produce a master signal from the available data. Please ensure sessions have extracted signals and try again.",
      unexpected: "An unexpected error occurred during master signal generation.",
    });
  }
  ```

**Verification:**
- Trigger each error type (config, quota, request, empty, service, unexpected) in both routes and verify:
  - HTTP status codes match (500, 402, 400, 422, 503, 500)
  - Response messages match current behaviour
  - Console logs include the correct route label prefix
- Run the extract-signals and generate-master-signal happy paths to confirm no regression

---

### Increment 5: Role picker component

**Covers:** P2.R7, P2.AC7

#### Step 1: Create `components/settings/role-picker.tsx`

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Role = "admin" | "sales";

interface RolePickerProps {
  value: Role;
  onValueChange: (role: Role) => void;
  className?: string;
}

export function RolePicker({ value, onValueChange, className }: RolePickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as Role)}>
      <SelectTrigger className={className ?? "w-28"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sales">Sales</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

#### Step 2: Migrate consumers

**`invite-single-form.tsx`:**
- Remove local `type Role = "admin" | "sales"`
- Remove `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` imports
- Import `RolePicker, type Role` from `@/components/settings/role-picker`
- Replace Select block (lines 77–85) with `<RolePicker value={role} onValueChange={setRole} />`

**`invite-bulk-dialog.tsx`:**
- Same changes as above
- Replace Select block (lines 112–120) with `<RolePicker value={role} onValueChange={setRole} />`

**Verification:**
- Single invite: role picker renders, defaults to "Sales", switching to "Admin" sends correct role in API call
- Bulk invite: same behaviour in dialog context
- Visual appearance unchanged

---

### Increment 6: Auth provider profile query deduplication

**Covers:** P2.R8, P2.AC8

This is a small, self-contained change within `auth-provider.tsx`.

#### Change

Extract the duplicated profile query into a helper function within `auth-provider.tsx`:

```typescript
function fetchCanCreateTeam(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  setter: (v: boolean) => void
) {
  supabase
    .from("profiles")
    .select("can_create_team")
    .eq("id", userId)
    .single()
    .then(({ data }) => {
      setter(data?.can_create_team ?? false);
    });
}
```

Replace both call sites (lines 41–48 and lines 59–66) with:
```typescript
fetchCanCreateTeam(supabase, currentUser.id, setCanCreateTeam);
```

Note: this helper was already added as part of Increment 1's auth-provider changes. If Increment 1 already included the extraction, this increment is a no-op verification. If Increment 1 deferred it, this is where it lands. Either way, the verification step confirms only one call site for the profile query exists.

**Verification:**
- Sign in → `canCreateTeam` correctly reflects the user's profile
- Auth state change (e.g., token refresh) → `canCreateTeam` still works
- Search `auth-provider.tsx` for `profiles` — only one function contains the query string

---

### Increment 7: End-of-part audit and documentation updates

**Covers:** CLAUDE.md Quality Gates (end-of-part audit) + post-part documentation

This increment produces fixes (if any violations are found) and documentation updates — not a report.

#### End-of-part audit checklist

1. **SRP violations** — Each new file has a single responsibility: `active-team.ts` (cookie I/O), `use-signal-extraction.ts` (extraction state machine), `reextract-confirm-dialog.tsx` (confirmation UI), `auth-form-shell.tsx` (card layout), `email-confirmation-panel.tsx` (success state), `map-ai-error.ts` (error mapping), `role-picker.tsx` (role select).
2. **DRY violations** — Verify zero duplicate implementations of: `getActiveTeamId` (client), `setActiveTeamCookie`, `ExtractionState` type, re-extract dialog markup, auth card shell markup, AI error catch blocks, `Role` type.
3. **Design token adherence** — No new hardcoded colours introduced. All new components use existing tokens.
4. **Logging** — `mapAIErrorToResponse` preserves all existing `console.error` logging with route labels. `useSignalExtraction` preserves extraction error logging.
5. **Dead code** — All removed local implementations are confirmed unused. No orphaned imports.
6. **Convention compliance** — File names: kebab-case. Components: PascalCase. Hooks: `use-` prefix. Props interfaces: `*Props` suffix. Named exports (except pages).

#### Documentation updates

1. **`ARCHITECTURE.md`** — Add entries for new files: `lib/cookies/active-team.ts`, `lib/hooks/use-signal-extraction.ts`, `components/capture/reextract-confirm-dialog.tsx`, `components/auth/auth-form-shell.tsx`, `components/auth/email-confirmation-panel.tsx`, `lib/utils/map-ai-error.ts`, `components/settings/role-picker.tsx`. Update `auth-provider.tsx` description to mention `activeTeamId` context. Note the reactive team context in the data flow section.
2. **`CHANGELOG.md`** — Add entry summarising Part 2 delivery.

**Verification:** Read back both files after editing to confirm accuracy. `grep` for all eliminated patterns to confirm zero remaining duplicates. Cross-reference file map entries against actual files on disk.
