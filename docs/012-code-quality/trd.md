# TRD-012: Code Quality — SOLID, DRY, and Design Consistency

> **Status:** Draft — Part 1 only
> **PRD:** `docs/012-code-quality/prd.md` (draft)
> **Mirrors:** PRD Part 1 (Design Tokens and Typography). Parts 2–5 will be added after Part 1 implementation.

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

### End-of-Part Audit Checklist

Per CLAUDE.md Quality Gates (end-of-part):

1. **SRP violations** — Part 1 does not introduce new components or split existing ones. Each file change has a single concern (token migration or variant swap).
2. **DRY violations** — Status token names are defined once in `globals.css`. No duplication introduced.
3. **Design token adherence** — This is the entire point of Part 1. After completion, zero hardcoded status colours remain.
4. **Logging** — No API routes or services are modified. No logging changes.
5. **Dead code** — No imports or variables become unused. The old Tailwind colour classes are replaced, not left alongside new ones.
6. **Convention compliance** — Token naming follows the existing pattern (`--brand-primary`, `--text-primary`). New tokens use `--status-*` and `--ai-action-*` prefixes consistently.

### Post-Part Documentation Updates

1. **`ARCHITECTURE.md`** — Update the `globals.css` entry in the File Map to mention status and AI action tokens.
2. **`CHANGELOG.md`** — Add entry: "PRD-012 Part 1: Centralised status colour tokens and AI action tokens in globals.css. Added `ai` button variant. Replaced all hardcoded status colours with CSS custom properties. Replaced `window.location.href` navigation with Next.js router."
