# PRD-016: Dark Mode

> **Status:** Draft
> **Depends on:** PRD-012 (Design Tokens — implemented), PRD-015 (Landing Page — implemented)
> **Deliverable:** A user-togglable dark theme that applies across the entire application — landing page, auth pages, and all authenticated views. The toggle respects the user's system preference as a default and persists the choice across sessions.

## Purpose

The current UI is bright white throughout — every surface, every page, every section. For users who work in low-light environments or simply prefer darker interfaces, this creates eye strain and feels like the product wasn't built with them in mind. Dark mode is table stakes for modern SaaS tools, especially ones used daily by sales and product teams who often work late reviewing feedback or preparing for morning standups.

The foundation is already in place. PRD-012 moved every UI colour to CSS custom properties, and the codebase has zero hardcoded colour values (verified — only the Google brand logo SVG contains fixed hex values, which are third-party and intentionally excluded). The existing `.dark` block in `globals.css` already defines dark variants for all shadcn/ui tokens. What's missing is the dark variants for the custom brand/surface/status/AI tokens, the toggle mechanism, and preference persistence.

This is a low-effort, high-impact feature. The token architecture makes it a single-file colour change plus a small toggle component.

## User Story

As a user who prefers dark interfaces (or who works in low-light environments), I want to switch Synthesiser to a dark theme so that the UI is comfortable to use without straining my eyes — and I want my preference to stick across sessions.

---

## Part 1: Dark Theme Tokens

**Scope:** Add dark-mode variants for all custom CSS tokens in `globals.css`. No UI components changed — this part is pure token work that enables Part 2.

### Requirements

**P1.R1 — Dark variants for brand tokens.** Add dark-mode overrides inside the existing `.dark` block for all custom tokens defined under `/* Brand tokens */`:
- `--brand-primary` — may need a lighter/brighter variant for dark backgrounds to maintain contrast
- `--brand-primary-light` — inverted to a dark-tinted version (not a bright wash)
- `--brand-primary-vivid` — adjusted for dark background contrast
- `--text-primary` — near-white
- `--text-secondary` — light grey
- `--text-muted` — mid grey
- `--border-default` — subtle light border on dark (e.g. white at 10-15% opacity)
- `--surface-page` — dark background (not pure black — use a very dark grey for depth)
- `--surface-page-translucent` — translucent version of the dark surface for the landing page nav
- `--surface-raised` — slightly lighter than `--surface-page` for cards and elevated surfaces

**P1.R2 — Dark variants for status tokens.** Add dark-mode overrides for all status tokens (`error`, `success`, `warning`, `info` — each has a base, `-light`, `-border`, and optionally `-text` variant). In dark mode, the `-light` backgrounds should be very dark tinted versions (not bright pastels), the base colours may need slight brightness adjustments for contrast, and the `-border` colours should be muted.

**P1.R3 — Dark variants for AI action tokens.** Add dark-mode overrides for `--ai-action`, `--ai-action-foreground`, `--ai-action-hover`, and `--ai-action-light`. The gold tones should remain recognisable but adjust lightness for dark background readability.

**P1.R4 — Palette coherence.** The dark palette must feel intentional — not just "inverted light mode." Guidelines:
- No pure black (`#000`) for backgrounds. Use very dark greys (e.g. `oklch(0.145 0 0)` or similar) for depth and to avoid the "OLED hole" effect.
- Maintain the indigo brand identity — the accent colour should pop more on dark, not wash out.
- Status colours remain semantically recognisable (red = error, green = success) but their lightness adjusts so they're readable on dark surfaces.
- Sufficient contrast ratios: text on backgrounds must meet WCAG AA (4.5:1 for normal text, 3:1 for large text).

### Acceptance Criteria

- [ ] P1.AC1 — Every custom token under `/* Brand tokens */`, `/* Status tokens */`, and `/* AI action tokens */` has a corresponding override in the `.dark` block
- [ ] P1.AC2 — When the `dark` class is applied to `<html>`, all UI surfaces, text, borders, and accents switch to dark variants
- [ ] P1.AC3 — Brand indigo remains recognisable and prominent on dark backgrounds
- [ ] P1.AC4 — Status colours (error/success/warning/info) remain semantically clear in dark mode
- [ ] P1.AC5 — No visual artefacts — cards are distinguishable from the page background, borders are visible, shadows work

---

## Part 2: Theme Toggle & Persistence

**Scope:** A toggle component in the header, a custom hook for theme state management, system preference detection, cookie-based persistence, and a layout update to apply the `dark` class. Also includes the landing page's theme toggle integration.

### Requirements

**P2.R1 — Theme state hook (`useTheme`).** A custom hook in `lib/hooks/use-theme.ts` that manages theme state:
- Three possible values: `"light"`, `"dark"`, `"system"`.
- On mount, reads the persisted preference from a cookie (`theme`). If no cookie exists, defaults to `"system"`.
- When set to `"system"`, resolves the actual theme from `window.matchMedia("(prefers-color-scheme: dark)")` and subscribes to changes (e.g. user changes OS preference mid-session).
- When set to `"light"` or `"dark"`, applies that choice directly.
- Writes the resolved `dark` class to `document.documentElement` (`<html>`).
- Persists the user's explicit choice (not the resolved value) to a cookie with `path=/` and a long expiry (1 year).
- Returns `{ theme, resolvedTheme, setTheme }` where `theme` is the user's preference and `resolvedTheme` is the actual applied value (`"light"` or `"dark"`).

**P2.R2 — Theme toggle component.** A toggle button placed in the app header (inside `AppHeader`, next to the `UserMenu`) that cycles between light, dark, and system modes. Uses icons from `lucide-react` (`Sun`, `Moon`, `Monitor` or similar). Shows the current mode visually. Accessible — includes `aria-label` describing the current state.

**P2.R3 — Landing page theme toggle.** The landing page has its own nav (not `AppHeader`). The theme toggle must also appear in the landing page nav so visitors can switch themes before signing in.

**P2.R4 — Flash prevention.** When a user with a dark preference loads the page, there must be no flash of light theme before the dark class is applied. This requires a blocking script in the `<head>` (via `layout.tsx` or a `<Script strategy="beforeInteractive">`) that reads the cookie and applies the `dark` class synchronously before the first paint.

**P2.R5 — Persistence via cookie.** The theme preference is stored in a cookie (not localStorage) so that it's readable server-side for flash prevention. Cookie name: `theme`. Values: `"light"`, `"dark"`, `"system"`. Path: `/`. Max-age: 1 year. `SameSite=Lax`.

**P2.R6 — No impact on existing functionality.** The theme toggle is purely additive. All existing features — capture, extraction, synthesis, team management, settings, prompts — continue to function identically. The toggle only affects visual presentation via CSS custom properties.

### Acceptance Criteria

- [ ] P2.AC1 — A theme toggle button is visible in the app header
- [ ] P2.AC2 — A theme toggle button is visible in the landing page nav
- [ ] P2.AC3 — Clicking the toggle cycles through light → dark → system modes
- [ ] P2.AC4 — The chosen theme is applied immediately (no page reload)
- [ ] P2.AC5 — The preference persists across page refreshes and new sessions (cookie)
- [ ] P2.AC6 — "System" mode follows the OS preference and reacts to changes in real-time
- [ ] P2.AC7 — No flash of wrong theme on initial page load
- [ ] P2.AC8 — All authenticated pages render correctly in dark mode (capture, master signals, settings, prompts)
- [ ] P2.AC9 — Auth pages (login, signup, invite) render correctly in dark mode
- [ ] P2.AC10 — The landing page renders correctly in dark mode

### Backlog

- **Per-workspace theme.** Allow different themes for different team workspaces. Deferred — the cookie approach is global and simple.
- **Custom accent colours.** Let users pick their own brand accent beyond light/dark. Deferred — requires a more complex theming system.
- **High-contrast mode.** A third theme optimised for accessibility with stronger contrast ratios. Deferred.
- **Theme scheduling.** Auto-switch between light and dark based on time of day. Deferred — system preference already handles this for most users.
