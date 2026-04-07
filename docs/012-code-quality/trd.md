# TRD-012: Code Quality — SOLID, DRY, and Design Consistency

> **Status:** Parts 1–4 complete — Part 5 pending
> **PRD:** `docs/012-code-quality/prd.md` (draft)
> **Mirrors:** PRD Parts 1–4. Part 5 TRD will be added after Part 4 implementation.

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

---
---

## Part 3: SRP — Component Decomposition

### Technical Decisions

1. **Decomposition splits responsibilities, not features.** Each extraction produces files grouped by concern: data fetching hooks, presentational subcomponents, and a thin coordinator parent. No feature behaviour changes — only file boundaries move. All exports remain co-located in the route's `_components/` directory (never promoted to `components/` unless used by 2+ routes).

2. **Custom hooks for data-fetching and orchestration.** Components like `MasterSignalPageContent` and `PromptEditorPageContent` mix API orchestration with rendering. The hooks (`useMasterSignal`, `usePromptEditor`) encapsulate fetch, generate, save, revert, and state machine logic. The parent component receives hook output and composes presentational children. This follows Dependency Inversion — the view depends on a hook interface, not raw fetch calls.

3. **`SessionTableRow` becomes its own file but stays private to the route.** It lives at `app/capture/_components/session-table-row.tsx`, not in `components/`. It is only rendered by `PastSessionsTable` — no other route imports it. The helper functions `formatDate`, `truncateNotes`, and `formatEmail` move with it since they are presentation concerns.

4. **`expanded-session-row.tsx` splits into a coordinator + 3 section components.** The coordinator holds the editing state, attachment state, and delegates to: (a) a metadata section (client/date fields or read-only display), (b) a notes-and-attachments section (raw notes, file upload, saved/pending attachments, char counter), and (c) an action bar (save/cancel/delete buttons). The signal extraction panel stays inline in the coordinator because it's a single `MarkdownPanel` + button — extracting it would create a component with almost zero logic of its own. The coordinator remains the largest file at ~150 lines.

5. **`session-capture-form.tsx` splits into form coordinator + 2 section components.** The capture form extracts: (a) an attachment section (upload zone, attachment list, char counter) — identical pattern to expanded-row attachments but simpler (no saved attachments), and (b) a structured notes panel (the post-extraction markdown display). The form coordinator keeps react-hook-form, submit logic, and the extract button because they are tightly coupled to the form's `getValues` and `reset`.

6. **`master-signal-page-content.tsx` splits into hook + banner component + content states.** The `useMasterSignal` hook handles fetch, generate, download-PDF, and all state (pageState, staleCount, isTainted, isTeamAdmin). A shared `StatusBanner` presentational component replaces the three near-identical banner blocks (tainted, stale, info). The page content becomes composition of header, banners, and content area — each driven by hook state.

7. **`prompt-editor-page-content.tsx` splits into hook + unsaved-changes dialog + master-signal tab notice.** The `usePromptEditor` hook encapsulates: fetch, save, reset, revert, dirty tracking, tab switch guard, and version history. The master-signal tab notice (the contextual cold-start/incremental info box) becomes a separate component because it has its own toggle logic. The unsaved-changes dialog is extracted as a local component. The page content renders tabs + editor + action bar, driven by hook state.

8. **Forward compatibility with Part 4.** Part 4 extracts orchestration from API routes into services. The client-side hooks created here call the same API endpoints — Part 4 only changes server-side internals. No hook interfaces change.

9. **Forward compatibility with Part 5.** Part 5 introduces repository interfaces for services. The hooks created here don't import from services — they call HTTP endpoints. No impact.

---

### Files Changed

| File | Change |
|------|--------|
| `app/capture/_components/expanded-session-row.tsx` | Thin coordinator; delegates to 3 subcomponents |
| `app/capture/_components/expanded-session-metadata.tsx` | **New.** Client/date fields (edit) or read-only display |
| `app/capture/_components/expanded-session-notes.tsx` | **New.** Raw notes + attachments section with char counter |
| `app/capture/_components/expanded-session-actions.tsx` | **New.** Save/cancel/delete action bar |
| `app/capture/_components/session-capture-form.tsx` | Thin form coordinator; delegates to subcomponents |
| `app/capture/_components/capture-attachment-section.tsx` | **New.** Upload zone + attachment list + char counter for new sessions |
| `app/capture/_components/structured-notes-panel.tsx` | **New.** Post-extraction markdown display |
| `app/capture/_components/past-sessions-table.tsx` | Remove `SessionTableRow` + helpers to own file |
| `app/capture/_components/session-table-row.tsx` | **New.** `SessionTableRow` + `formatDate`, `truncateNotes`, `formatEmail` |
| `app/m-signals/_components/master-signal-page-content.tsx` | Thin composition; delegates to hook + subcomponents |
| `app/m-signals/_components/use-master-signal.ts` | **New.** Hook: fetch, generate, download PDF, all state |
| `app/m-signals/_components/master-signal-status-banner.tsx` | **New.** Presentational banner for tainted/stale/info states |
| `app/m-signals/_components/master-signal-empty-state.tsx` | **New.** Empty state displays (no-sessions, ready, generating) |
| `app/m-signals/_components/master-signal-content.tsx` | **New.** Rendered markdown content + metadata bar |
| `app/settings/_components/prompt-editor-page-content.tsx` | Thin composition; delegates to hook + subcomponents |
| `app/settings/_components/use-prompt-editor.ts` | **New.** Hook: fetch, save, reset, revert, dirty guard, tab state |
| `app/settings/_components/prompt-master-signal-notice.tsx` | **New.** Cold-start/incremental contextual notice with toggle |
| `app/settings/_components/prompt-unsaved-dialog.tsx` | **New.** Unsaved changes confirmation dialog |

---

### Increment 1: Extract `SessionTableRow` from `past-sessions-table.tsx`

**Covers:** P3.R4, P3.AC4

This is the lowest-risk extraction — `SessionTableRow` is already a separate function at the bottom of the file with its own props interface. It's a straight cut-and-paste into its own file.

#### Step 1: Create `app/capture/_components/session-table-row.tsx`

Move from `past-sessions-table.tsx`:
- `formatDate` function (lines 21–28)
- `truncateNotes` function (lines 30–33)
- `formatEmail` function (lines 330–334)
- `SessionTableRowProps` interface (lines 317–328)
- `SessionTableRow` component (lines 336–401)

The new file imports `SessionRow` from `./expanded-session-row` and `ExpandedSessionRow` from `./expanded-session-row`. It imports `Sparkles`, `Paperclip` from `lucide-react`.

Export: `export function SessionTableRow(...)` as a named export.

#### Step 2: Update `past-sessions-table.tsx`

- Remove `formatDate`, `truncateNotes`, `formatEmail`, `SessionTableRowProps`, and the `SessionTableRow` component
- Add import: `import { SessionTableRow } from "./session-table-row"`
- Remove `Sparkles`, `Paperclip` from lucide-react import (they were only used by `SessionTableRow`)
- Keep `SessionRow` import from `./expanded-session-row` (still used for the `sessions` state type)

**Verification:**
- `past-sessions-table.tsx` should be ~215 lines (down from 401)
- `session-table-row.tsx` should be ~90 lines
- Sessions table renders, rows expand, unsaved changes dialog works
- `npx tsc --noEmit` passes

---

### Increment 2: Split `expanded-session-row.tsx` into coordinator + subcomponents

**Covers:** P3.R1, P3.AC1

#### Step 1: Create `app/capture/_components/expanded-session-metadata.tsx`

Extract the metadata section (lines 254–292 in the current file). This component renders either editable fields (client combobox + date picker) or a read-only display.

```typescript
interface ExpandedSessionMetadataProps {
  canEdit: boolean
  client: ClientSelection
  onClientChange: (client: ClientSelection) => void
  sessionDate: string
  onSessionDateChange: (date: string) => void
  session: Pick<SessionRow, "client_name" | "session_date" | "created_by_email">
}
```

Imports: `ClientCombobox`, `DatePicker`, `Label` from co-located files.

#### Step 2: Create `app/capture/_components/expanded-session-notes.tsx`

Extract the notes + attachments grid column (lines 295–351). This component renders raw notes, the attachments subsection (saved, pending, upload zone), and the character counter.

```typescript
interface ExpandedSessionNotesProps {
  rawNotes: string
  onRawNotesChange?: (notes: string) => void
  canEdit: boolean
  sessionId: string
  savedAttachments: SessionAttachment[]
  pendingAttachments: ParsedAttachment[]
  isLoadingAttachments: boolean
  structuredNotes: string | null
  extractionState: ExtractionState
  isSaving: boolean
  totalChars: number
  isOverLimit: boolean
  totalAttachmentCount: number
  onSavedAttachmentDeleted: (id: string) => void
  onAddPendingAttachment: (a: ParsedAttachment) => void
  onRemovePendingAttachment: (index: number) => void
}
```

Imports: `MarkdownPanel`, `FileUploadZone`, `AttachmentList`, `SavedAttachmentList`, `Label`, `Loader2`, `cn`, `MAX_COMBINED_CHARS`.

#### Step 3: Create `app/capture/_components/expanded-session-actions.tsx`

Extract the action bar (lines 403–483). This component renders save/cancel/delete buttons (or close + view-only message).

```typescript
interface ExpandedSessionActionsProps {
  canEdit: boolean
  isFormValid: boolean
  isDirty: boolean
  isSaving: boolean
  isDeleting: boolean
  isOverLimit: boolean
  showDeleteConfirm: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onShowDeleteConfirm: (show: boolean) => void
}
```

Imports: `Button`, `Loader2`, `Save`, `X`, `Trash2`.

#### Step 4: Update `expanded-session-row.tsx`

The coordinator keeps:
- All `useState` declarations (client, date, notes, saving, deleting, attachments)
- The attachment fetch `useEffect`
- `useSignalExtraction` hook call
- `isDirty`, `hasInput`, `isFormValid` derived state
- Character counting logic
- `handleSave`, `handleDelete`, and attachment handlers
- `registerSave` effect

The render becomes:
```tsx
<div className="flex flex-col gap-4 p-4 bg-muted/20 border-t border-border">
  <ExpandedSessionMetadata ... />
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <ExpandedSessionNotes ... />
    <div className="flex flex-col gap-1.5">
      {/* Extract signals button + panel — stays inline */}
    </div>
  </div>
  <ExpandedSessionActions ... />
  <ReextractConfirmDialog ... />
</div>
```

**Verification:**
- `expanded-session-row.tsx` should be ~180 lines (down from 493)
- `expanded-session-metadata.tsx` should be ~55 lines
- `expanded-session-notes.tsx` should be ~85 lines
- `expanded-session-actions.tsx` should be ~95 lines
- All editing, save, delete, extraction, attachment flows work identically
- `npx tsc --noEmit` passes

---

### Increment 3: Split `session-capture-form.tsx` into coordinator + subcomponents

**Covers:** P3.R5, P3.AC5

#### Step 1: Create `app/capture/_components/capture-attachment-section.tsx`

Extract the attachments block (lines 224–253). This component renders the upload zone, attachment list, and character counter.

```typescript
interface CaptureAttachmentSectionProps {
  attachments: ParsedAttachment[]
  onFileParsed: (attachment: ParsedAttachment) => void
  onRemove: (index: number) => void
  disabled: boolean
  totalChars: number
  isOverLimit: boolean
}
```

Imports: `FileUploadZone`, `AttachmentList`, `Label`, `cn`, `MAX_COMBINED_CHARS`.

#### Step 2: Create `app/capture/_components/structured-notes-panel.tsx`

Extract the post-extraction display (lines 296–306). This component renders the "Extracted Signals" heading and `MarkdownPanel` when extraction is done.

```typescript
interface StructuredNotesPanelProps {
  structuredNotes: string | null
  onChange: (notes: string | null) => void
}
```

Imports: `MarkdownPanel`.

#### Step 3: Update `session-capture-form.tsx`

The coordinator keeps:
- `useForm`, `useSignalExtraction`, submit handler, attachment state
- Form fields (client, date, raw notes)
- Extract and Submit buttons

The render replaces the inline attachment block with `<CaptureAttachmentSection ... />` and the inline structured notes with `<StructuredNotesPanel ... />`.

**Verification:**
- `session-capture-form.tsx` should be ~230 lines (down from 315)
- `capture-attachment-section.tsx` should be ~55 lines
- `structured-notes-panel.tsx` should be ~30 lines
- Capture form works: type notes → attach files → extract → save
- `npx tsc --noEmit` passes

---

### Increment 4: Split `master-signal-page-content.tsx` into hook + subcomponents

**Covers:** P3.R3, P3.AC3

#### Step 1: Create `app/m-signals/_components/use-master-signal.ts`

Extract all state and logic into a custom hook:

```typescript
interface UseMasterSignalReturn {
  pageState: PageState
  masterSignal: MasterSignal | null
  staleCount: number
  isTainted: boolean
  isGenerating: boolean
  isDownloading: boolean
  isTeamAdmin: boolean
  canGenerate: boolean
  handleGenerate: () => Promise<void>
  handleDownloadPdf: () => Promise<void>
}

export function useMasterSignal(): UseMasterSignalReturn
```

The hook owns:
- All `useState` declarations
- Team admin check `useEffect`
- `fetchMasterSignal` callback + mount effect
- `handleGenerate` callback
- `handleDownloadPdf` callback
- `canGenerate` derived state

Imports: `useAuth` from auth-provider.

#### Step 2: Create `app/m-signals/_components/master-signal-status-banner.tsx`

A presentational component for the three banner types:

```typescript
type BannerVariant = "tainted" | "stale" | "info"

interface MasterSignalStatusBannerProps {
  variant: BannerVariant
  staleCount?: number
}
```

Uses `AlertTriangle` for tainted/stale, `Info` for info. Maps variant to border/bg/text token classes.

#### Step 3: Create `app/m-signals/_components/master-signal-empty-state.tsx`

Extract the three empty/generating states (lines 248–294):

```typescript
interface MasterSignalEmptyStateProps {
  pageState: PageState
  isGenerating: boolean
  masterSignal: MasterSignal | null
  staleCount: number
}
```

#### Step 4: Create `app/m-signals/_components/master-signal-content.tsx`

Extract the signal display (lines 297–327):

```typescript
interface MasterSignalContentProps {
  masterSignal: MasterSignal
}
```

Renders metadata bar + markdown content.

#### Step 5: Update `master-signal-page-content.tsx`

The page content becomes pure composition:

```tsx
export function MasterSignalPageContent() {
  const { pageState, masterSignal, staleCount, isTainted, ... } = useMasterSignal()

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <MasterSignalHeader ... />
      {masterSignal && isTainted && <MasterSignalStatusBanner variant="tainted" staleCount={staleCount} />}
      {masterSignal && !isTainted && staleCount > 0 && <MasterSignalStatusBanner variant="stale" staleCount={staleCount} />}
      {!canGenerate && <MasterSignalStatusBanner variant="info" />}
      <MasterSignalEmptyState ... />
      {masterSignal && <MasterSignalContent masterSignal={masterSignal} />}
    </div>
  )
}
```

Note: the header (title + buttons) stays inline in the page content — it's only ~30 lines and tightly coupled to hook state (`isGenerating`, `canGenerate`, `masterSignal`). Extracting it would create a component with 8+ props for minimal gain.

**Verification:**
- `master-signal-page-content.tsx` should be ~75 lines (down from 330)
- `use-master-signal.ts` should be ~120 lines
- `master-signal-status-banner.tsx` should be ~45 lines
- `master-signal-empty-state.tsx` should be ~55 lines
- `master-signal-content.tsx` should be ~40 lines
- All master signal flows work: loading, empty, generate, regenerate, tainted banner, stale banner, PDF download
- `npx tsc --noEmit` passes

---

### Increment 5: Split `prompt-editor-page-content.tsx` into hook + subcomponents

**Covers:** P3.R2, P3.AC2

#### Step 1: Create `app/settings/_components/use-prompt-editor.ts`

Extract all state and orchestration:

```typescript
interface UsePromptEditorReturn {
  activeTab: PromptKey
  effectiveKey: PromptKey
  autoSelectedMasterKey: PromptKey
  displayedMasterKey: PromptKey
  promptTabs: { key: PromptKey; label: string }[]
  currentContent: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  isReverting: boolean
  history: PromptVersion[]
  isHistoryOpen: boolean
  pendingTab: PromptKey | null
  isViewingAlternate: boolean
  hasMasterSignal: boolean
  viewingVersion: PromptVersion | null
  viewingVersionNumber: number
  setCurrentContent: (content: string) => void
  setIsHistoryOpen: (open: boolean) => void
  setViewingVersion: (version: PromptVersion | null) => void
  setViewingVersionNumber: (n: number) => void
  handleTabChange: (value: string) => void
  handleTogglePromptVariant: () => void
  handleSave: () => Promise<void>
  handleReset: () => Promise<void>
  handleRevert: (version: PromptVersion) => Promise<void>
  handleDiscardAndSwitch: () => void
  handleCancelSwitch: () => void
}

export function usePromptEditor(): UsePromptEditorReturn
```

The hook owns:
- All `useState` declarations
- `DEFAULT_PROMPTS` config
- Master signal check effect
- `fetchPrompt` callback + effect
- `beforeunload` effect
- Tab switch with dirty guard
- Toggle prompt variant
- Save, reset, revert handlers

#### Step 2: Create `app/settings/_components/prompt-master-signal-notice.tsx`

Extract the contextual cold-start/incremental info box (lines 347–382):

```typescript
interface PromptMasterSignalNoticeProps {
  displayedMasterKey: PromptKey
  autoSelectedMasterKey: PromptKey
  onToggle: () => void
  disabled: boolean
}
```

#### Step 3: Create `app/settings/_components/prompt-unsaved-dialog.tsx`

Extract the unsaved changes dialog (lines 441–465):

```typescript
interface PromptUnsavedDialogProps {
  open: boolean
  onStay: () => void
  onDiscard: () => void
}
```

#### Step 4: Update `prompt-editor-page-content.tsx`

The page content becomes composition:

```tsx
export function PromptEditorPageContent({ embedded, readOnly }: PromptEditorPageContentProps) {
  const editor = usePromptEditor()

  const content = (
    <>
      <Tabs value={editor.activeTab} onValueChange={editor.handleTabChange} ...>
        <TabsList>...</TabsList>
        {editor.promptTabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} ...>
            {tab.key === editor.autoSelectedMasterKey && (
              <PromptMasterSignalNotice ... />
            )}
            {readOnly && <ReadOnlyBanner />}
            <PromptEditor ... />
            <ActionBar ... />
            <VersionHistoryPanel ... />
          </TabsContent>
        ))}
      </Tabs>
      <PromptUnsavedDialog ... />
      <VersionViewDialog ... />
    </>
  )

  if (embedded) return content
  return <div className="flex flex-1 flex-col p-6">...</div>
}
```

**Verification:**
- `prompt-editor-page-content.tsx` should be ~120 lines (down from 497)
- `use-prompt-editor.ts` should be ~230 lines
- `prompt-master-signal-notice.tsx` should be ~50 lines
- `prompt-unsaved-dialog.tsx` should be ~40 lines
- All prompt editor flows work: load, edit, save, reset, revert, tab switch with dirty guard, version history, master signal toggle
- `npx tsc --noEmit` passes

---

### Increment 6: End-of-part audit and documentation updates

**Covers:** CLAUDE.md Quality Gates (end-of-part audit) + post-part documentation

This increment produces fixes (if any violations are found) and documentation updates — not a report.

#### End-of-part audit checklist

1. **SRP violations** — Every new file has a single responsibility: hooks contain state + logic, presentational components render UI from props, coordinators compose children. No file should exceed ~230 lines (the `usePromptEditor` hook will be the largest).
2. **DRY violations** — The `MasterSignalStatusBanner` eliminates the 3× duplicated banner markup. `CaptureAttachmentSection` is used only once — it's an SRP extraction, not a DRY extraction; if a second consumer appears, it's already isolated.
3. **Design token adherence** — No new hardcoded colours. All banners use existing `--status-*` tokens.
4. **Logging** — All existing `console.error` logging preserved inside hooks and handlers. No logging moved to presentational components.
5. **Dead code** — All removed inline code confirmed unused after extraction. No orphaned imports.
6. **Convention compliance** — File names: kebab-case. Components: PascalCase. Hooks: `use-` prefix with `.ts` extension. Props interfaces: `*Props` suffix. Named exports.

#### Documentation updates

1. **`ARCHITECTURE.md`** — Add entries for all new files under their respective `_components/` directories. Update descriptions for the 5 decomposed files to note their new coordinator role.
2. **`CHANGELOG.md`** — Add entry summarising Part 3 delivery.

**Verification:** Read back both files after editing to confirm accuracy. Verify line counts for all modified files match expectations (±10 lines). Run `npx tsc --noEmit` for final type check. Cross-reference file map entries against actual files on disk.

---

## Part 4: SRP — API Route and Service Layer Cleanup

### Technical Decisions

12. **The generate-master-signal orchestration moves to `master-signal-service.ts`, not a new file.** The cold-start/tainted/incremental branching logic is master-signal domain logic — it decides *which* sessions to fetch and *how* to call the AI service. It belongs alongside the existing `getLatestMasterSignal`, `getAllSignalSessions`, `getSignalSessionsSince`, and `saveMasterSignal` functions that it already calls. Creating a separate orchestration file would split the domain in two. The new function is `generateOrUpdateMasterSignal()` and returns a result object the route handler maps to HTTP responses.

13. **The orchestration function returns a discriminated union, not HTTP responses.** The service layer must not import from `next/server` (per CLAUDE.md). The return type uses a discriminated union: `{ outcome: "created" | "unchanged"; masterSignal: MasterSignal }` or `{ outcome: "no-sessions"; message: string }`. The route handler maps outcomes to status codes — `created` → 200 with masterSignal, `unchanged` → 200 with `unchanged: true`, `no-sessions` → 422. This keeps the service framework-agnostic.

14. **Team members data assembly moves to `team-service.ts` as `getTeamMembersWithProfiles()`.** The route currently makes two sequential Supabase queries (team_members + profiles) and joins them in-route. This is data assembly — it belongs in the service layer. The new function takes `teamId` and returns `{ user_id, role, joined_at, email }[]`. The route handler reduces to auth check + service call + JSON response.

15. **`checkSessionAccess` moves to `session-service.ts` as a pure service function.** Currently in `app/api/sessions/_helpers.ts`, it imports `NextResponse` and returns HTTP error objects — mixing concerns. The service version returns a discriminated union (`{ allowed: true; userId; teamId }` | `{ allowed: false; reason: "unauthenticated" | "not-found" | "forbidden" }`), and the route handler maps reasons to HTTP status codes. The `_helpers.ts` file is deleted.

16. **`checkSessionAccess` needs the Supabase client passed in.** Currently it calls `createClient()` internally. Since the route handler already creates a client for auth, we pass it through to avoid a second client instantiation. The service function signature becomes `checkSessionAccess(supabase, sessionId)` where `supabase` is the anon client already created by the route. This is consistent with Dependency Inversion — the function receives its dependency rather than creating it.

17. **Zod validation for GET query params uses `.safeParse()` on extracted params.** For `GET /api/clients`, we validate `q` (string, optional, max 255) and `hasSession` (boolean-like string, optional). For `GET /api/prompts`, we validate `key` against the `PromptKey` enum. The existing inline `VALID_PROMPT_KEYS` check is replaced by a Zod schema. Validation errors return 400 with descriptive messages, matching the existing POST handler pattern.

18. **`SignalSession` moves to `lib/types/signal-session.ts`.** Currently defined in `master-signal-service.ts` and imported by both `master-signal-synthesis.ts` (prompts layer) and `ai-service.ts` (service layer). The prompts layer importing from the service layer violates the dependency direction — prompts are consumed by services, not the other way around. Moving the type to a shared `lib/types/` location breaks the circular dependency. Both `master-signal-service.ts`, `ai-service.ts`, and `master-signal-synthesis.ts` import from the shared location.

19. **The `GET /api/teams` route's inline membership query moves to `team-service.ts`.** The route currently calls `getTeamsForUser()` for team data, then makes a separate inline Supabase query for `team_members` to get roles — splitting the domain logic between route and service. The new `getTeamsWithRolesForUser()` function in `team-service.ts` returns `{ id, name, role }[]` in a single call, and the route handler becomes auth check + service call + JSON response.

20. **Forward compatibility with Part 5.** Part 5 introduces repository interfaces. The service functions created/modified here will be the primary targets for repository injection. By ensuring services don't make direct Supabase calls in Part 4 (they delegate to existing service-level query functions or to the newly centralised query functions), Part 5 has clear extraction points. The discriminated union return types created here carry over unchanged — Part 5 only changes how the data is fetched internally.

---

### Files Changed

| File | Change |
|------|--------|
| `lib/services/master-signal-service.ts` | Add `generateOrUpdateMasterSignal()` orchestration function with discriminated union return |
| `app/api/ai/generate-master-signal/route.ts` | Reduce to auth check + admin check + `generateOrUpdateMasterSignal()` call + outcome mapping |
| `lib/services/team-service.ts` | Add `getTeamMembersWithProfiles(teamId)` and `getTeamsWithRolesForUser(userId)` |
| `app/api/teams/[teamId]/members/route.ts` | Remove inline Supabase queries; delegate to `getTeamMembersWithProfiles()` |
| `app/api/teams/route.ts` | Remove inline membership query from GET; delegate to `getTeamsWithRolesForUser()` |
| `lib/services/session-service.ts` | Add `checkSessionAccess(supabase, sessionId)` with discriminated union return |
| `app/api/sessions/_helpers.ts` | **Deleted.** Logic moved to `session-service.ts` |
| `app/api/sessions/[id]/route.ts` | Import `checkSessionAccess` from session-service; map result to HTTP responses |
| `app/api/sessions/[id]/attachments/route.ts` | Import `checkSessionAccess` from session-service (if it uses `_helpers.ts`) |
| `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` | Import `checkSessionAccess` from session-service (if it uses `_helpers.ts`) |
| `app/api/clients/route.ts` | Add Zod schema for GET query params; validate before calling service |
| `app/api/prompts/route.ts` | Replace `VALID_PROMPT_KEYS` check with Zod schema for GET query params |
| `lib/types/signal-session.ts` | **New.** `SignalSession` interface (moved from `master-signal-service.ts`) |
| `lib/services/master-signal-service.ts` | Remove `SignalSession` export; re-export from `lib/types/signal-session.ts` |
| `lib/services/ai-service.ts` | Import `SignalSession` from `lib/types/signal-session.ts` |
| `lib/prompts/master-signal-synthesis.ts` | Import `SignalSession` from `lib/types/signal-session.ts` |

### Files not changed

| File | Reason |
|------|--------|
| `app/api/sessions/route.ts` | GET handler already uses Zod for query params (added in PRD-013). POST handler already validates with Zod. No orchestration to extract. |
| `app/api/ai/extract-signals/route.ts` | Already thin — auth check + Zod validation + service call + `mapAIErrorToResponse`. No orchestration to extract. |
| `lib/services/ai-service.ts` | Only `SignalSession` import path changes. No structural changes. |

---

### Increment 1: Move `SignalSession` to shared types

**Covers:** P4.R5, P4.AC5

This is the lowest-risk change — a type relocation with no runtime impact. Ship first to unblock the rest.

#### Step 1: Create `lib/types/signal-session.ts`

Move the `SignalSession` interface from `lib/services/master-signal-service.ts`:

```typescript
export interface SignalSession {
  id: string
  clientName: string
  sessionDate: string
  structuredNotes: string
  updatedAt: string
}
```

#### Step 2: Update imports in 3 files

- `lib/services/master-signal-service.ts` — Remove `SignalSession` interface definition. Add `import type { SignalSession } from "@/lib/types/signal-session"`. Keep `export type { SignalSession }` re-export for backward compatibility (other files may import from here).
- `lib/services/ai-service.ts` — Change `import type { SignalSession } from "@/lib/services/master-signal-service"` to `import type { SignalSession } from "@/lib/types/signal-session"`.
- `lib/prompts/master-signal-synthesis.ts` — Change `import type { SignalSession } from "@/lib/services/master-signal-service"` to `import type { SignalSession } from "@/lib/types/signal-session"`.

**Verification:**
- `npx tsc --noEmit` passes
- `master-signal-synthesis.ts` no longer imports from `lib/services/`
- `grep -r "from.*master-signal-service" lib/prompts/` returns no results

---

### Increment 2: Extract generate-master-signal orchestration to service

**Covers:** P4.R1, P4.AC1

#### Step 1: Add orchestration function to `lib/services/master-signal-service.ts`

Add `generateOrUpdateMasterSignal()` below the existing query functions. The function encapsulates the cold-start/tainted/incremental branching:

```typescript
type GenerateResult =
  | { outcome: "created"; masterSignal: MasterSignal }
  | { outcome: "unchanged"; masterSignal: MasterSignal }
  | { outcome: "no-sessions"; message: string }

export async function generateOrUpdateMasterSignal(): Promise<GenerateResult> {
  const latest = await getLatestMasterSignal()

  if (!latest || latest.isTainted) {
    const mode = latest?.isTainted ? "tainted cold start" : "cold start"
    console.log(`[master-signal-service] generateOrUpdateMasterSignal — ${mode}`)

    const sessions = await getAllSignalSessions()
    if (sessions.length === 0) {
      const message = latest?.isTainted
        ? "No extracted signals found. All sessions with signals have been deleted."
        : "No extracted signals found. Extract signals from individual sessions on the Capture page first."
      return { outcome: "no-sessions", message }
    }

    console.log(`[master-signal-service] generateOrUpdateMasterSignal — synthesising from ${sessions.length} sessions`)
    const content = await synthesiseMasterSignal({ sessions })
    const saved = await saveMasterSignal(content, sessions.length)
    console.log(`[master-signal-service] generateOrUpdateMasterSignal — saved: ${saved.id}`)
    return { outcome: "created", masterSignal: saved }
  }

  // Incremental
  console.log(`[master-signal-service] generateOrUpdateMasterSignal — incremental since ${latest.generatedAt}`)
  const newSessions = await getSignalSessionsSince(latest.generatedAt)

  if (newSessions.length === 0) {
    console.log("[master-signal-service] generateOrUpdateMasterSignal — no new sessions")
    return { outcome: "unchanged", masterSignal: latest }
  }

  console.log(`[master-signal-service] generateOrUpdateMasterSignal — merging ${newSessions.length} new session(s)`)
  const content = await synthesiseMasterSignal({
    previousMasterSignal: latest.content,
    sessions: newSessions,
  })
  const totalSessions = latest.sessionsIncluded + newSessions.length
  const saved = await saveMasterSignal(content, totalSessions)
  console.log(`[master-signal-service] generateOrUpdateMasterSignal — saved: ${saved.id}`)
  return { outcome: "created", masterSignal: saved }
}
```

Note: `synthesiseMasterSignal` is imported from `ai-service.ts` — this is an existing cross-service dependency (service calls service). The import already exists in the route; moving it to the service is cleaner because the orchestration logic belongs here.

#### Step 2: Rewrite `app/api/ai/generate-master-signal/route.ts`

The route handler reduces to:

```typescript
export async function POST() {
  // 1. Auth check (same as before)
  // 2. Team admin check (same as before)
  // 3. Call generateOrUpdateMasterSignal()
  // 4. Map outcome to HTTP response:
  //    - "created" → 200 { masterSignal }
  //    - "unchanged" → 200 { masterSignal, unchanged: true }
  //    - "no-sessions" → 422 { message }
  // 5. catch → mapAIErrorToResponse (same as before)
}
```

**Verification:**
- Route handler is ≤50 lines (target: ~45)
- `generateOrUpdateMasterSignal` contains all branching logic with full logging
- Master signal generation works: cold start, tainted, incremental, no-sessions
- `npx tsc --noEmit` passes

---

### Increment 3: Extract team data assembly to service

**Covers:** P4.R2, P4.AC2

#### Step 1: Add `getTeamMembersWithProfiles()` to `lib/services/team-service.ts`

Extract the two-query join from the members route:

```typescript
export interface TeamMemberWithProfile {
  user_id: string
  role: string
  joined_at: string
  email: string
}

export async function getTeamMembersWithProfiles(
  teamId: string
): Promise<TeamMemberWithProfile[]> {
  const serviceClient = createServiceRoleClient()

  const { data: members, error } = await serviceClient
    .from("team_members")
    .select("user_id, role, joined_at")
    .eq("team_id", teamId)
    .is("removed_at", null)
    .order("joined_at", { ascending: true })

  if (error) {
    console.error("[team-service] getTeamMembersWithProfiles — error:", error.message)
    throw new Error("Failed to fetch team members")
  }

  const userIds = (members ?? []).map((m) => m.user_id)
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id, email")
    .in("id", userIds)

  const emailByUserId = new Map(
    (profiles ?? []).map((p) => [p.id, p.email])
  )

  return (members ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    joined_at: m.joined_at,
    email: emailByUserId.get(m.user_id) ?? "unknown",
  }))
}
```

#### Step 2: Add `getTeamsWithRolesForUser()` to `lib/services/team-service.ts`

Extract the teams + membership join from `GET /api/teams`:

```typescript
export interface TeamWithRole {
  id: string
  name: string
  role: string
}

export async function getTeamsWithRolesForUser(
  userId: string
): Promise<TeamWithRole[]> {
  const teams = await getTeamsForUser()

  const supabase = await createClient()
  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .is("removed_at", null)

  const roleByTeamId = new Map(
    (memberships ?? []).map((m) => [m.team_id, m.role])
  )

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    role: roleByTeamId.get(t.id) ?? "sales",
  }))
}
```

#### Step 3: Simplify `app/api/teams/[teamId]/members/route.ts`

The route reduces to auth check + membership check + `getTeamMembersWithProfiles(teamId)` + JSON response. Remove the inline `createServiceRoleClient` import and both Supabase queries.

#### Step 4: Simplify `GET` handler in `app/api/teams/route.ts`

The route reduces to auth check + `getTeamsWithRolesForUser(user.id)` + JSON response. Remove the inline `team_members` query and the `roleByTeamId` mapping.

**Verification:**
- Members route is ~30 lines (down from 83)
- Teams GET handler is ~25 lines (down from ~50)
- Team members page loads correctly with roles and emails
- Workspace switcher loads teams correctly
- `npx tsc --noEmit` passes

---

### Increment 4: Move session permission check to service layer

**Covers:** P4.R3, P4.AC3

#### Step 1: Add `checkSessionAccess()` to `lib/services/session-service.ts`

The service version accepts a Supabase client and returns a discriminated union:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"

type SessionAccessResult =
  | { allowed: true; userId: string; teamId: string | null }
  | { allowed: false; reason: "unauthenticated" | "not-found" | "forbidden" }

export async function checkSessionAccess(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionAccessResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false, reason: "unauthenticated" }

  const teamId = await getActiveTeamId()

  const { data: session } = await supabase
    .from("sessions")
    .select("id, created_by")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single()

  if (!session) return { allowed: false, reason: "not-found" }

  if (teamId && session.created_by !== user.id) {
    const member = await getTeamMember(teamId, user.id)
    if (member?.role !== "admin") {
      return { allowed: false, reason: "forbidden" }
    }
  }

  return { allowed: true, userId: user.id, teamId }
}
```

Note: `getActiveTeamId` is imported from `@/lib/supabase/server` (already imported in this file). `getTeamMember` is imported from `team-service.ts` (need to add this import).

#### Step 2: Create a route-level helper for HTTP mapping

Add a small mapping helper in the route file (or inline) that converts reasons to HTTP responses:

```typescript
function mapAccessError(reason: "unauthenticated" | "not-found" | "forbidden"): NextResponse {
  const map = {
    unauthenticated: { message: "Authentication required", status: 401 },
    "not-found": { message: "Session not found", status: 404 },
    forbidden: { message: "You can only modify your own sessions", status: 403 },
  } as const
  const { message, status } = map[reason]
  return NextResponse.json({ message }, { status })
}
```

#### Step 3: Update `app/api/sessions/[id]/route.ts`

Replace `import { checkSessionAccess } from "@/app/api/sessions/_helpers"` with `import { checkSessionAccess } from "@/lib/services/session-service"`. Update the call site: `const access = await checkSessionAccess(supabase, id)` and `if (!access.allowed) return mapAccessError(access.reason)`.

#### Step 4: Update attachment routes that use `_helpers.ts`

Check `app/api/sessions/[id]/attachments/route.ts` and `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` — if they import from `_helpers.ts`, update to import from session-service and use the same mapping pattern.

#### Step 5: Delete `app/api/sessions/_helpers.ts`

Confirm no remaining imports, then delete.

**Verification:**
- `_helpers.ts` is deleted; `grep -r "_helpers" app/api/sessions/` returns no results
- Session PUT, DELETE, and attachment routes work correctly
- Permission checks work: own sessions editable, team admin can edit others, sales cannot edit others
- `npx tsc --noEmit` passes

---

### Increment 5: Add Zod validation to GET routes

**Covers:** P4.R4, P4.AC4

#### Step 1: Add Zod schema to `GET /api/clients`

```typescript
const clientSearchSchema = z.object({
  q: z.string().max(255).optional().default(""),
  hasSession: z.enum(["true", "false"]).optional().default("false"),
})
```

Parse `Object.fromEntries(request.nextUrl.searchParams)` with `.safeParse()`. Map `hasSession` string to boolean after validation. Return 400 with descriptive message on failure.

#### Step 2: Replace `VALID_PROMPT_KEYS` check in `GET /api/prompts`

```typescript
const promptQuerySchema = z.object({
  key: z.enum(["signal_extraction", "master_signal_cold_start", "master_signal_incremental"]),
})
```

Parse `{ key: searchParams.get("key") }` with `.safeParse()`. Remove the manual `VALID_PROMPT_KEYS` array and `includes()` check. The `PromptKey` type inference now comes from Zod.

**Verification:**
- `GET /api/clients?q=test&hasSession=true` works as before
- `GET /api/clients?q=` + 256-char string returns 400
- `GET /api/prompts?key=signal_extraction` works as before
- `GET /api/prompts?key=invalid` returns 400 with descriptive message
- `GET /api/prompts` (no key param) returns 400
- `npx tsc --noEmit` passes

---

### Increment 6: End-of-part audit and documentation updates

**Covers:** CLAUDE.md Quality Gates (end-of-part audit) + post-part documentation

This increment produces fixes (if any violations are found) and documentation updates — not a report.

#### End-of-part audit checklist

1. **SRP violations** — Route handlers only do: auth, validation, service call, response mapping. Service functions only do: data queries, business logic, return typed results. No route imports from `next/server` leak into services.
2. **DRY violations** — `mapAccessError` is used 3× (sessions PUT, DELETE, attachments) — if duplicated, extract to a shared utility. The `generateOrUpdateMasterSignal` eliminates the 160-line branching block in the route.
3. **Design token adherence** — N/A for this part (no CSS changes).
4. **Logging** — All existing `console.log`/`console.error` logging preserved in service functions. Route handlers retain entry/exit logs.
5. **Dead code** — `_helpers.ts` is deleted. `VALID_PROMPT_KEYS` array is removed. No orphaned imports.
6. **Convention compliance** — Service function names: camelCase. Return types: discriminated unions with `outcome`/`allowed` discriminants. Interface names: PascalCase with descriptive suffix (`TeamMemberWithProfile`, `TeamWithRole`, `SessionAccessResult`, `GenerateResult`).

#### Documentation updates

1. **`ARCHITECTURE.md`** — Remove `_helpers.ts` entry. Add `lib/types/signal-session.ts` entry. Update descriptions for modified route handlers and service files.
2. **`CHANGELOG.md`** — Add entry summarising Part 4 delivery.

**Verification:** Read back both files after editing to confirm accuracy. Run `npx tsc --noEmit` for final type check. Test all affected API routes end-to-end.
