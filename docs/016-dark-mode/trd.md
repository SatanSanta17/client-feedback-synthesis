# TRD-016: Dark Mode

> **Status:** Draft (Parts 1–2)
>
> Mirrors **PRD-016**. Each part maps to the corresponding PRD part.

---

## Part 1: Dark Theme Tokens

> Implements **P1.R1–P1.R4** from PRD-016.

### Overview

Add dark-mode overrides for all custom CSS tokens (`/* Brand tokens */`, `/* Status tokens */`, `/* AI action tokens */`) inside the existing `.dark` block in `globals.css`. Also correct the existing shadcn `--primary` dark value to maintain the indigo brand identity in dark mode instead of flipping to white. No new files — this is a single-file edit.

**Design philosophy: Clean, not fluorescent.** The dark palette uses desaturated, low-chroma colours. Background surfaces are warm dark greys (never pure black). Accent colours retain their hue but dial down saturation — they should be visible and branded, not glowing. Status colours stay semantically recognisable but are muted. The `-light` token variants (used for icon pill backgrounds, badge fills) become very dark tinted washes — barely visible colour on dark, not pastel.

### Dependencies (npm)

None.

### Database Changes

None.

### API Endpoints

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/globals.css` | **Modify** | Add custom token dark overrides inside the existing `.dark` block; adjust shadcn `--primary` and `--ring` for brand consistency |

### Token Mapping

Every custom token gets a dark variant. The design principles governing each value:

- **Surfaces:** Very dark greys with subtle lightness steps — `--surface-page` is the darkest, `--surface-raised` is one step lighter. No pure black (`oklch(0 0 0)`) anywhere.
- **Text:** Off-white primary (not pure white — reduces glare), stepping down through mid-greys for secondary and muted.
- **Borders:** White at low opacity (10%) — the same pattern the existing shadcn `.dark` block uses.
- **Brand accent:** Same hue (277°) with slightly bumped lightness for readability on dark, but NOT neon or fluorescent. Chroma stays moderate.
- **Status colours:** Same hues, reduced saturation (~65-75% of light mode chroma). The `-light` backgrounds flip from bright pastels to very dark tinted washes (lightness ~0.2).
- **AI action:** Same warm gold hue (75°), reduced chroma. The `-light` background becomes a dark tinted wash.

#### Brand tokens

| Token | Light value | Dark value | Rationale |
|-------|-------------|------------|-----------|
| `--brand-primary` | `oklch(0.457 0.24 277.023)` | `oklch(0.52 0.19 277.023)` | Slightly lighter to read on dark surfaces; chroma dropped from 0.24 → 0.19 to avoid glow |
| `--brand-primary-light` | `oklch(0.926 0.047 277.023)` | `oklch(0.24 0.05 277.023)` | Flips from bright wash to very dark tint for icon/badge backgrounds |
| `--brand-primary-vivid` | `oklch(0.6 0.24 300)` | `oklch(0.55 0.18 300)` | Dialled down for gradient endpoint — visible but not glowing |
| `--text-primary` | `oklch(0.145 0 0)` | `oklch(0.93 0 0)` | Off-white — not pure white to reduce eye strain |
| `--text-secondary` | `oklch(0.556 0 0)` | `oklch(0.65 0 0)` | Mid grey — readable but clearly secondary |
| `--text-muted` | `oklch(0.708 0 0)` | `oklch(0.45 0 0)` | Low-emphasis text on dark backgrounds |
| `--border-default` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 0.1)` | Matches shadcn `--border` dark pattern |
| `--surface-page` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | Matches shadcn `--background` dark |
| `--surface-page-translucent` | `oklch(1 0 0 / 0.8)` | `oklch(0.145 0 0 / 0.8)` | Translucent version for landing page nav |
| `--surface-raised` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` | Matches shadcn `--card` dark — cards and elevated surfaces |

#### Status tokens

| Token | Light value | Dark value | Rationale |
|-------|-------------|------------|-----------|
| `--status-error` | `oklch(0.637 0.237 25.331)` | `oklch(0.65 0.18 25.331)` | Same hue, reduced chroma — readable red, not neon |
| `--status-error-light` | `oklch(0.971 0.013 17.38)` | `oklch(0.22 0.04 17.38)` | Bright pastel → very dark red tint |
| `--status-error-border` | `oklch(0.885 0.062 18.334)` | `oklch(0.35 0.07 18.334)` | Muted border, visible but subtle |
| `--status-success` | `oklch(0.723 0.191 149.579)` | `oklch(0.65 0.15 149.579)` | Same hue, reduced chroma |
| `--status-success-light` | `oklch(0.982 0.018 155.826)` | `oklch(0.22 0.03 155.826)` | Bright pastel → very dark green tint |
| `--status-success-border` | `oklch(0.905 0.093 164.15)` | `oklch(0.35 0.06 164.15)` | Muted border |
| `--status-warning` | `oklch(0.769 0.188 70.08)` | `oklch(0.7 0.14 70.08)` | Same hue, reduced chroma |
| `--status-warning-light` | `oklch(0.987 0.022 95.277)` | `oklch(0.22 0.03 95.277)` | Bright pastel → very dark amber tint |
| `--status-warning-border` | `oklch(0.924 0.096 95.277)` | `oklch(0.35 0.06 95.277)` | Muted border |
| `--status-warning-text` | `oklch(0.555 0.163 48.998)` | `oklch(0.72 0.13 48.998)` | Bumped lightness for dark bg readability |
| `--status-info` | `oklch(0.623 0.214 259.815)` | `oklch(0.6 0.16 259.815)` | Same hue, reduced chroma |
| `--status-info-light` | `oklch(0.97 0.014 254.604)` | `oklch(0.22 0.03 254.604)` | Bright pastel → very dark blue tint |
| `--status-info-border` | `oklch(0.882 0.059 254.128)` | `oklch(0.35 0.05 254.128)` | Muted border |
| `--status-info-text` | `oklch(0.424 0.199 265.638)` | `oklch(0.65 0.15 265.638)` | Bumped lightness for dark bg readability |

#### AI action tokens

| Token | Light value | Dark value | Rationale |
|-------|-------------|------------|-----------|
| `--ai-action` | `oklch(0.78 0.16 75)` | `oklch(0.7 0.12 75)` | Warm gold, dialled down — not glowing |
| `--ai-action-foreground` | `oklch(0.25 0.05 60)` | `oklch(0.93 0.03 75)` | Flips from dark-on-gold to light-on-gold for dark bg context |
| `--ai-action-hover` | `oklch(0.72 0.17 75)` | `oklch(0.63 0.13 75)` | Slightly darker hover state |
| `--ai-action-light` | `oklch(0.95 0.04 75)` | `oklch(0.22 0.04 75)` | Bright wash → very dark gold tint |

#### Shadcn token corrections

The existing `.dark` block sets `--primary: oklch(0.922 0 0)` (near-white) which breaks the indigo brand identity — primary buttons become white instead of indigo. Correct these:

| Token | Current dark value | New dark value | Rationale |
|-------|-------------------|----------------|-----------|
| `--primary` | `oklch(0.922 0 0)` | `oklch(0.52 0.19 277.023)` | Brand indigo, matching `--brand-primary` dark — buttons stay branded |
| `--primary-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` | White text on indigo buttons |
| `--ring` | `oklch(0.556 0 0)` | `oklch(0.52 0.19 277.023)` | Focus ring matches brand |

### Implementation

#### Increment 1.1: Add all dark token overrides

**What:** Add dark variants for all custom tokens and correct the shadcn `--primary` / `--ring` values inside the `.dark` block.

**File:** `app/globals.css`

The `.dark` block currently contains only shadcn tokens (lines 121-153). Add three new comment-delimited sections after the existing shadcn tokens, before the closing `}`:

```css
.dark {
  /* ...existing shadcn tokens... */

  /* Corrected shadcn overrides for brand consistency */
  --primary: oklch(0.52 0.19 277.023);
  --primary-foreground: oklch(0.985 0 0);
  --ring: oklch(0.52 0.19 277.023);

  /* Brand tokens */
  --brand-primary: oklch(0.52 0.19 277.023);
  --brand-primary-light: oklch(0.24 0.05 277.023);
  --brand-primary-vivid: oklch(0.55 0.18 300);
  --text-primary: oklch(0.93 0 0);
  --text-secondary: oklch(0.65 0 0);
  --text-muted: oklch(0.45 0 0);
  --border-default: oklch(1 0 0 / 0.1);
  --surface-page: oklch(0.145 0 0);
  --surface-page-translucent: oklch(0.145 0 0 / 0.8);
  --surface-raised: oklch(0.205 0 0);

  /* Status tokens */
  --status-error: oklch(0.65 0.18 25.331);
  --status-error-light: oklch(0.22 0.04 17.38);
  --status-error-border: oklch(0.35 0.07 18.334);
  --status-success: oklch(0.65 0.15 149.579);
  --status-success-light: oklch(0.22 0.03 155.826);
  --status-success-border: oklch(0.35 0.06 164.15);
  --status-warning: oklch(0.7 0.14 70.08);
  --status-warning-light: oklch(0.22 0.03 95.277);
  --status-warning-border: oklch(0.35 0.06 95.277);
  --status-warning-text: oklch(0.72 0.13 48.998);
  --status-info: oklch(0.6 0.16 259.815);
  --status-info-light: oklch(0.22 0.03 254.604);
  --status-info-border: oklch(0.35 0.05 254.128);
  --status-info-text: oklch(0.65 0.15 265.638);

  /* AI action tokens */
  --ai-action: oklch(0.7 0.12 75);
  --ai-action-foreground: oklch(0.93 0.03 75);
  --ai-action-hover: oklch(0.63 0.13 75);
  --ai-action-light: oklch(0.22 0.04 75);
}
```

**Verification:**
1. Temporarily add `class="dark"` to `<html>` in `layout.tsx` to test.
2. Walk through every page: landing page, login, capture, master signals, settings.
3. Confirm: all surfaces are dark grey (not black), text is off-white, brand indigo is visible but not neon, status badges are readable, feature cards on the landing page are distinguishable from the background, borders are visible, AI action buttons retain their gold identity.
4. Remove the temporary `class="dark"` after verification.
5. Run `npx tsc --noEmit` — no type errors expected (CSS-only change).

---

## Part 2: Theme Toggle & Persistence

> Implements **P2.R1–P2.R6** from PRD-016.

### Overview

Add a theme switching mechanism: a custom `useTheme` hook for state management, a `ThemeToggle` button component, integration into both the `AppHeader` and the landing page nav, a blocking inline script for flash prevention, and cookie-based persistence. The user can cycle between light, dark, and system modes. The system mode follows the OS preference in real-time.

### Dependencies (npm)

None. Uses native browser APIs: `document.documentElement.classList`, `window.matchMedia`, `document.cookie`.

### Database Changes

None. The theme preference is stored client-side in a cookie.

### API Endpoints

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/hooks/use-theme.ts` | **Create** | Custom hook — theme state, persistence, system preference detection, class application |
| `components/layout/theme-toggle.tsx` | **Create** | Toggle button component — cycles light → dark → system with icons |
| `components/layout/app-header.tsx` | **Modify** | Add `ThemeToggle` next to `UserMenu` |
| `app/_components/landing-page.tsx` | **Modify** | Add `ThemeToggle` to the landing page nav |
| `app/layout.tsx` | **Modify** | Add `suppressHydrationWarning` to `<html>` and an inline blocking script for flash prevention |

### Frontend Pages & Components

#### `lib/hooks/use-theme.ts` (new)

A custom hook that manages the full theme lifecycle.

**Types:**

```typescript
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface UseThemeReturn {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}
```

**Cookie helpers (internal to the file):**

```typescript
const COOKIE_NAME = "theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getThemeCookie(): ThemePreference {
  // Parse document.cookie for "theme" value
  // Return "system" if not found or invalid
}

function setThemeCookie(value: ThemePreference): void {
  // Set cookie with path=/, max-age=1yr, SameSite=Lax
}
```

**Hook logic:**

1. **State initialisation:** `useState<ThemePreference>` initialised from `getThemeCookie()`.
2. **Resolved theme:** A derived `resolvedTheme` value. If `theme === "system"`, resolve via `window.matchMedia("(prefers-color-scheme: dark)").matches`. Otherwise use the explicit value.
3. **System preference listener:** When `theme === "system"`, subscribe to `matchMedia` `change` events via `useEffect`. When the OS preference changes, the resolved theme updates reactively. Cleanup the listener on unmount or when switching away from "system".
4. **Class application:** A `useEffect` that runs whenever `resolvedTheme` changes. Adds or removes `"dark"` on `document.documentElement.classList`. This is the only place the class is toggled at runtime.
5. **`setTheme` function:** Updates state, writes cookie via `setThemeCookie`, and the `useEffect` handles the rest.

**Export:** Named export `useTheme`.

#### `components/layout/theme-toggle.tsx` (new)

A button component that renders the current theme's icon and cycles on click.

**Props interface:**

```typescript
interface ThemeToggleProps {
  className?: string;
}
```

**Behavior:**

- Calls `useTheme()` to get `theme` and `setTheme`.
- Displays icon based on current `theme` value (not resolved):
  - `"light"` → `Sun` icon from lucide-react
  - `"dark"` → `Moon` icon from lucide-react
  - `"system"` → `Monitor` icon from lucide-react
- On click, cycles: `light → dark → system → light → ...`
- Uses the existing `Button` component with `variant="ghost"` and `size="icon"` for a minimal, unobtrusive look.
- Includes `aria-label` that describes the current mode (e.g. `"Switch to dark mode"`).

**Cycle logic:**

```typescript
function handleToggle() {
  const next: Record<ThemePreference, ThemePreference> = {
    light: "dark",
    dark: "system",
    system: "light",
  };
  setTheme(next[theme]);
}
```

**Tooltip / visual indicator:** A `title` attribute on the button shows the current mode name on hover (e.g. "Light mode", "Dark mode", "System"). No tooltip library needed — native `title` is sufficient.

#### `components/layout/app-header.tsx` (modified)

Add `ThemeToggle` inside the right-side `div`, before `UserMenu`:

```tsx
<div className="flex items-center gap-3">
  <ThemeToggle />
  <UserMenu />
</div>
```

Import: `import { ThemeToggle } from "@/components/layout/theme-toggle";`

#### `app/_components/landing-page.tsx` (modified)

Add `ThemeToggle` in the landing page nav, to the left of the "Get Started" button:

```tsx
<div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
  <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
    Synthesiser
  </span>
  <div className="flex items-center gap-3">
    <ThemeToggle />
    <Link href="/login">
      <Button size="lg" className="cursor-pointer px-6">
        Get Started
      </Button>
    </Link>
  </div>
</div>
```

Import: `import { ThemeToggle } from "@/components/layout/theme-toggle";`

#### `app/layout.tsx` (modified)

Two changes:

**1. `suppressHydrationWarning` on `<html>`:**

The blocking script (below) adds the `dark` class before React hydrates. This causes a mismatch between server-rendered HTML (no `dark` class) and the client (has `dark` class). `suppressHydrationWarning` tells React to ignore this expected mismatch on the `<html>` element only — it does not suppress warnings on children.

```tsx
<html
  lang="en"
  suppressHydrationWarning
  className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
>
```

**2. Blocking inline script in `<head>`:**

Add a `<script>` tag inside `<head>` (before `<body>`) that runs synchronously before the first paint. This prevents the flash of wrong theme.

```tsx
<head>
  <script
    dangerouslySetInnerHTML={{
      __html: `
        (function() {
          try {
            var cookie = document.cookie.match(/(?:^|; )theme=([^;]*)/);
            var pref = cookie ? cookie[1] : 'system';
            var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            if (dark) document.documentElement.classList.add('dark');
          } catch(e) {}
        })();
      `,
    }}
  />
</head>
```

This script:
- Reads the `theme` cookie (no dependency on React or any JS framework).
- If preference is `"dark"`, or preference is `"system"` and OS prefers dark, adds `dark` class.
- Wrapped in try/catch for safety — if anything fails, the page renders light (safe default).
- Runs before any CSS or React rendering, so the `.dark` tokens are active from the very first paint.

### Implementation

#### Increment 2.1: Theme Hook

**What:** Create the `useTheme` hook with state, cookie persistence, system preference detection, and class application.

**Files:**
1. **Create `lib/hooks/use-theme.ts`**

**Verification:** Import the hook in a test component, call `setTheme("dark")` — the `dark` class appears on `<html>`, the cookie is set, and refreshing the page preserves the choice.

#### Increment 2.2: Theme Toggle Component + Header Integration

**What:** Create the toggle button and add it to the `AppHeader`.

**Files:**
1. **Create `components/layout/theme-toggle.tsx`**
2. **Modify `components/layout/app-header.tsx`** — Add `<ThemeToggle />` before `<UserMenu />`.

**Verification:** On any authenticated page, the toggle icon is visible in the header. Clicking cycles through light (Sun) → dark (Moon) → system (Monitor). The theme applies instantly. The icon reflects the current mode.

#### Increment 2.3: Landing Page Integration

**What:** Add the toggle to the landing page nav.

**Files:**
1. **Modify `app/_components/landing-page.tsx`** — Add `<ThemeToggle />` before the "Get Started" button.

**Verification:** Visiting `/` as an unauthenticated user shows the toggle in the nav. Clicking it changes the theme. The landing page renders correctly in both themes (hero gradient, feature cards, steps, footer all respect dark tokens).

#### Increment 2.4: Flash Prevention

**What:** Add the blocking script and `suppressHydrationWarning` to the root layout.

**Files:**
1. **Modify `app/layout.tsx`** — Add `suppressHydrationWarning` to `<html>` and the inline `<script>` in `<head>`.

**Verification:**
1. Set theme to dark, close the tab, reopen — page loads directly in dark mode with no white flash.
2. Set theme to system, change OS to dark, reload — page loads dark with no flash.
3. Set theme to light, reload — page loads light (no `dark` class).
4. Clear the cookie, reload with OS set to light — page loads light (default behavior).
5. Clear the cookie, reload with OS set to dark — page loads dark (system preference detected by script).
6. Run `npx tsc --noEmit` — no type errors.
