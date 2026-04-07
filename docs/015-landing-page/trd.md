# TRD-015: Public Landing Page

> **Status:** Draft (Part 1)
>
> Mirrors **PRD-015**. Each part maps to the corresponding PRD part.

---

## Part 1: Landing Page

> Implements **P1.R1–P1.R10** from PRD-015.

### Overview

Replace the current root route (`/`) redirect-to-`/capture` with a public landing page. The page is a single client component that checks auth state — authenticated users are redirected to `/capture`, unauthenticated users see the marketing page. The `AppHeader` and `AppFooter` hide on `/` so the landing page can render its own lightweight nav and footer. No database changes, no new API routes, no new dependencies.

### Dependencies (npm)

None. The landing page uses only existing packages: React, Next.js, lucide-react, and the existing component library.

### Database Changes

None.

### API Endpoints

None. The landing page is entirely client-rendered static content.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/page.tsx` | **Modify** | Replace redirect with landing page server component (metadata + render `LandingPage`) |
| `app/_components/landing-page.tsx` | **Create** | Client component — auth check, redirect, full landing page UI |
| `middleware.ts` | **Modify** | Add `/` (exact match) to `isPublicRoute` check |
| `components/layout/app-header.tsx` | **Modify** | Return `null` when `pathname === "/"` |
| `components/layout/app-footer.tsx` | **Modify** | Accept `pathname` and return `null` when `pathname === "/"` (requires converting to client component or wrapping) |

### Frontend Pages & Components

#### `app/_components/landing-page.tsx` (new)

A `"use client"` component co-located with the root page. This is the only new file with significant content.

**Auth-aware rendering:**
- Reads `isAuthenticated` and `isLoading` from `useAuth()`.
- While `isLoading` or `isAuthenticated`: renders a centred spinner (prevents flash of landing page for logged-in users).
- On `isAuthenticated === true`: calls `router.replace("/capture")` via `useEffect`.
- On `isAuthenticated === false && isLoading === false`: renders the full landing page.

**Data constants (top of file):**

```typescript
const FEATURES = [
  {
    icon: MessageSquareText,
    title: "Capture Everything",
    description: "Paste raw notes, upload chat logs (WhatsApp, Slack), PDFs, CSVs — every conversation becomes structured data in seconds.",
  },
  {
    icon: Sparkles,
    title: "AI Signal Extraction",
    description: "Your notes go in messy. They come out as clear signals — pain points, feature requests, praise, and priorities — all tagged and ready.",
  },
  {
    icon: Brain,
    title: "Cross-Client Synthesis",
    description: "One click generates a master signal document that surfaces recurring themes, rising urgency, and roadmap gaps across every client.",
  },
  {
    icon: Users,
    title: "Team Workspaces",
    description: "Invite your sales and CS team. Everyone captures, AI synthesises across all sessions, and the whole team sees the same truth.",
  },
] as const;

const STEPS = [
  { number: "01", title: "Capture", description: "Paste notes or upload files after every client call." },
  { number: "02", title: "Extract", description: "AI pulls structured signals — themes, sentiment, action items." },
  { number: "03", title: "Synthesise", description: "A living master document shows cross-client patterns at a glance." },
] as const;
```

Adding a new feature = appending to the `FEATURES` array. No layout changes needed (P1.R10).

**Page sections (top to bottom):**

1. **Nav** — Sticky top bar with `backdrop-blur-lg`. Left: "Synthesiser" logo text (`text-lg font-bold`). Right: "Get Started" `Button` linking to `/login` with `ArrowRight` icon. Max-width container (`max-w-6xl`).

2. **Hero** — Centred layout within `max-w-4xl`.
   - Decorative gradient glow: absolutely-positioned `div` with `radial-gradient` from `--brand-primary`, `opacity-20`, `blur-3xl`. `pointer-events-none` + `aria-hidden`.
   - Pill badge: inline-flex with border, `--surface-raised` bg, `Sparkles` icon in `--brand-primary`.
   - Headline: `h1` with `text-4xl sm:text-5xl lg:text-6xl font-extrabold`. Key phrase uses `bg-gradient-to-r` + `bg-clip-text text-transparent` for a brand-coloured gradient effect.
   - Subtitle: `p` with `text-lg sm:text-xl`, `max-w-2xl`, `--text-secondary`.
   - CTAs: flex row — primary `Button size="lg"` → `/login`, outline `Button size="lg"` → `#how-it-works` anchor scroll.

3. **Features** — Background `--surface-raised`, `max-w-6xl` container.
   - Section heading + subtitle centred.
   - `grid sm:grid-cols-2 gap-6 lg:gap-8` renders `FEATURES` array.
   - Each card: `rounded-xl border` with `hover:shadow-md` transition. Icon in a `rounded-lg bg-[var(--brand-primary-light)]` container. Title (`text-lg font-semibold`) + description (`text-sm`).

4. **How It Works** — `id="how-it-works"` with `scroll-mt-20` for anchor offset.
   - Section heading + subtitle centred.
   - `grid sm:grid-cols-3 gap-10 sm:gap-8` renders `STEPS` array.
   - Each step: number badge (filled `--brand-primary` circle, white text), title, description.

5. **Bottom CTA** — Background `--surface-raised`. Centred `max-w-3xl`.
   - `Target` icon from lucide-react, headline, paragraph, "Get Started" button → `/login`.

6. **Footer** — Minimal. Left: `© {year} Synthesiser`. Right: "Sign in" link → `/login`.

**Styling rules:**
- All colours reference CSS custom properties (`--brand-primary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-default`, `--surface-page`, `--surface-raised`, `--brand-primary-light`).
- Spacing uses Tailwind scale (`px-6`, `py-20`, `gap-6`, etc.).
- Responsive: all grids collapse to single column below `sm` breakpoint. Hero text sizes scale down. CTA buttons stack vertically on mobile.

#### `app/page.tsx` (modified)

Replace the current one-line redirect with:

```typescript
import type { Metadata } from "next";
import { LandingPage } from "./_components/landing-page";

export const metadata: Metadata = {
  title: "Synthesiser — Turn Client Conversations into Product Signals",
  description:
    "AI-powered client feedback capture and synthesis for sales and product teams. Extract signals, spot cross-client themes, and never lose an insight again.",
};

export default function HomePage() {
  return <LandingPage />;
}
```

The server component provides SEO metadata. The client component handles auth-aware rendering.

#### `middleware.ts` (modified)

Add `pathname === "/"` to the `isPublicRoute` check:

```typescript
const isPublicRoute =
  pathname === "/" ||
  pathname === "/login" ||
  pathname === "/signup" ||
  pathname === "/forgot-password" ||
  pathname.startsWith("/auth/callback") ||
  pathname.startsWith("/invite");
```

This allows unauthenticated visitors to reach `/` without being redirected to `/login`.

#### `components/layout/app-header.tsx` (modified)

Add `pathname === "/"` to the `isAuthPage` check so the header returns `null` on the landing page:

```typescript
const isAuthPage =
  pathname === "/" ||
  pathname === "/login" ||
  pathname === "/signup" ||
  pathname === "/forgot-password" ||
  pathname === "/reset-password";
```

#### `components/layout/app-footer.tsx` (modified)

The footer is currently a server component. To conditionally hide on `/`, convert to a client component with `"use client"` and `usePathname()`:

```typescript
"use client";

import { usePathname } from "next/navigation";
// ...existing imports...

export function AppFooter() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  // ...existing JSX...
}
```

### Implementation

#### Increment 1.1: Middleware + Layout Updates

**What:** Make `/` a public route and hide AppHeader/AppFooter on the landing page.

**Files:**
1. **Modify `middleware.ts`** — Add `pathname === "/"` to `isPublicRoute`.
2. **Modify `components/layout/app-header.tsx`** — Add `pathname === "/"` to the `isAuthPage` check.
3. **Modify `components/layout/app-footer.tsx`** — Add `"use client"`, `usePathname()`, and early return for `pathname === "/"`.

**Verification:** Unauthenticated requests to `/` are no longer redirected to `/login`. The app header and footer do not render on `/`.

#### Increment 1.2: Landing Page Component + Root Page

**What:** Create the landing page component and update the root page to render it.

**Files:**
1. **Create `app/_components/landing-page.tsx`** — Full landing page as described above.
2. **Modify `app/page.tsx`** — Replace redirect with metadata + `<LandingPage />`.

**Verification:**
- Unauthenticated: visiting `/` shows the full landing page (nav, hero, features, how-it-works, CTA, footer).
- Authenticated: visiting `/` shows a brief spinner then redirects to `/capture`.
- All "Get Started" and "Sign in" links navigate to `/login`.
- "See How It Works" scrolls to the `#how-it-works` section.
- Page is responsive — features grid collapses to single column on mobile.
- All colours use CSS custom properties (no hardcoded values).

#### Cleanup

**What:** Remove the unused `app/(public)/` route group files created during initial exploration.

**Files:**
1. **Delete `app/(public)/page.tsx`**
2. **Delete `app/(public)/layout.tsx`**
