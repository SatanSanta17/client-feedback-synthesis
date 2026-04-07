# TRD-015: Public Landing Page

> **Status:** Implemented (Part 1)
>
> Mirrors **PRD-015**. Each part maps to the corresponding PRD part.

---

## Part 1: Landing Page

> Implements **P1.R1–P1.R13** from PRD-015.

### Overview

Replace the current root route (`/`) redirect-to-`/capture` with a public landing page. The page is a single client component that checks auth state — authenticated users are redirected to `/capture`, unauthenticated users see the marketing page. The page features full-viewport sections, a transparent-to-blur scroll-aware nav, IntersectionObserver-driven scroll-reveal animations on feature cards and steps, and an impactful static bottom CTA. The `AppHeader` and `AppFooter` hide on `/` so the landing page can render its own nav and footer. No database changes, no new API routes, no new npm dependencies.

### Dependencies (npm)

None. The landing page uses only existing packages: React (hooks: `useState`, `useEffect`, `useRef`), Next.js (`useRouter`, `usePathname`, `Link`), lucide-react (icons), and the existing Button component.

### Database Changes

None.

### API Endpoints

None. The landing page is entirely client-rendered static content.

### Design Token Changes

Two new tokens added to `globals.css` under `:root`:

| Token | Value | Purpose |
|-------|-------|---------|
| `--brand-primary-vivid` | `oklch(0.6 0.24 300)` | Vibrant gradient endpoint for the hero headline gradient |
| `--surface-page-translucent` | `oklch(1 0 0 / 0.8)` | Translucent surface for scroll-triggered nav background |

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/page.tsx` | **Modify** | Replace redirect with landing page server component (metadata + render `LandingPage`) |
| `app/_components/landing-page.tsx` | **Create** | Client component — auth check, redirect, scroll-aware nav, full-viewport animated landing page |
| `app/globals.css` | **Modify** | Add `--brand-primary-vivid` and `--surface-page-translucent` tokens |
| `middleware.ts` | **Modify** | Add `/` (exact match) to `isPublicRoute` check |
| `components/layout/app-header.tsx` | **Modify** | Return `null` when `pathname === "/"` |
| `components/layout/app-footer.tsx` | **Modify** | Convert to client component, return `null` when `pathname === "/"` |

### Frontend Pages & Components

#### `app/_components/landing-page.tsx` (new)

A `"use client"` component co-located with the root page. This is the only new file with significant content.

**Auth-aware rendering:**
- Reads `isAuthenticated` and `isLoading` from `useAuth()`.
- While `isLoading` or `isAuthenticated`: renders a centred spinner (prevents flash of landing page for logged-in users).
- On `isAuthenticated === true`: calls `router.replace("/capture")` via `useEffect`.
- On `isAuthenticated === false && isLoading === false`: renders the full landing page.

**Custom hook — `useScrollReveal()`:**
- Uses `useRef<HTMLDivElement>` and `useState<boolean>` to track element visibility.
- Creates an `IntersectionObserver` with `threshold: 0.15` and `rootMargin: "0px 0px -60px 0px"`.
- Sets `isVisible` to `true` when the element enters the viewport, `false` when it leaves.
- Used by both the features section and the steps section.
- Each section gets its own instance (`featuresReveal`, `stepsReveal`).

**Scroll state for nav:**
- `useState<boolean>(false)` tracks whether the page is scrolled past 20px.
- A `scroll` event listener (passive) updates this state.
- The nav's `style` prop conditionally applies `--surface-page-translucent` background, `backdrop-filter: blur(16px)`, and `border-bottom` based on `scrolled`.

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

const SOCIAL_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Email", href: "mailto:burhanuddinchital25151@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/SatanSanta17/", icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/cburhanuddin/", icon: Linkedin },
];
```

Adding a new feature = appending to the `FEATURES` array. No layout changes needed (P1.R12).

**Page sections (top to bottom):**

1. **Nav** — Fixed position, `z-50`, `w-full`. Transparent by default, transitions to `--surface-page-translucent` with blur on scroll. Left: "Synthesiser" (`text-lg font-bold`). Right: "Get Started" `Button size="lg"` → `/login`. Max-width `max-w-6xl`.

2. **Hero** — `min-h-screen` with `flex items-center justify-center`. Centred within `max-w-4xl`.
   - Decorative gradient glow: absolutely-positioned at `top-1/3`, `h-[600px] w-[800px]`, `radial-gradient` from `--brand-primary`, `opacity-15`, `blur-3xl`. `pointer-events-none` + `aria-hidden`.
   - Pill badge: inline-flex with border, `--surface-raised` bg, `Sparkles` icon in `--brand-primary`.
   - Headline: `h1` with `text-4xl sm:text-5xl lg:text-6xl font-extrabold`. Key phrase uses `background-image: linear-gradient(135deg, --brand-primary 0%, --brand-primary-vivid 50%, --brand-primary 100%)` with `bg-clip-text text-transparent` for a three-stop gradient with strong contrast.
   - Subtitle: `p` with `text-lg sm:text-xl`, `max-w-2xl`, `--text-secondary`.
   - Single CTA: `Button size="lg"` with `py-6 px-10 text-lg` → `/login`. Text: "Try It Yourself".

3. **Features** — `min-h-screen` with `flex items-center`. Background: `bg-gradient-to-b from-[var(--surface-raised)] to-[var(--surface-page)]`.
   - Container `ref={featuresReveal.ref}`. Section heading + subtitle centred.
   - `grid sm:grid-cols-2 gap-6 lg:gap-8` renders `FEATURES` array.
   - Each card: `rounded-xl border p-8` with `hover:shadow-lg` transition. Icon in `rounded-lg bg-[var(--brand-primary-light)] p-3`. Title (`text-lg font-semibold`) + description (`text-sm`).
   - **Animation:** Each card gets inline `style` with `opacity` and `transform` driven by `featuresReveal.isVisible`. `transition: "all 0.5s"`, `transitionDelay: index * 120ms`. Cards slide up from `translateY(40px)` to `translateY(0)` and fade from `opacity: 0` to `1`.

4. **How It Works** — `min-h-screen` with `flex items-center`. `id="how-it-works"`.
   - Container `ref={stepsReveal.ref}`. Section heading + subtitle centred.
   - **Connector line**: absolutely-positioned `div` behind the step badges. Full width, `h-0.5`, `bg-gradient-to-r from-transparent via-[var(--brand-primary-light)] to-transparent opacity-60`. Desktop only (`hidden sm:block`). Positioned at `top-5` to align with badge centres.
   - `grid sm:grid-cols-3 gap-12 sm:gap-8` renders `STEPS` array. All content centred.
   - Each step badge: `size-10 rounded-full bg-[var(--brand-primary)]` with `--primary-foreground` text. `relative z-10` to sit above the connector line. `shadow-md` for depth.
   - **Animation:** Each step gets inline `style` with `opacity` and `transform` driven by `stepsReveal.isVisible`. `transition: "opacity 0.6s ease, transform 0.6s ease"`, `transitionDelay: index * 200ms`. Steps scale from `scale(0.95) translateY(30px)` to `scale(1) translateY(0)`.

5. **Bottom CTA** — `min-h-screen` with `flex items-center`. Background `--surface-raised`. No animation (P1.R8).
   - `Target` icon in a `rounded-full bg-[var(--brand-primary-light)] p-5` container, `size-12`.
   - Headline: `h2` with `text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-snug`. Deliberate `<br />` for two-line impact.
   - Subtitle: `p` with `text-lg sm:text-xl`, `max-w-xl`.
   - CTA: `Button size="lg"` with `py-6 px-10 text-lg` → `/login`. Text: "Start Capturing Today".

6. **Footer** — `border-t`, `--surface-page` bg.
   - Left: "Developed by Burhanuddin C" (`text-sm --text-muted`).
   - Right: social icon links from `SOCIAL_LINKS` array. Icon-only (`size-4`), `--text-muted` transitioning to `--text-primary` on hover. Each wrapped in `<Link>` with `target="_blank"` and `aria-label`.
   - Responsive: stacks vertically on mobile (`flex-col sm:flex-row sm:justify-between`).

#### `app/page.tsx` (modified)

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

#### `app/globals.css` (modified)

Added two tokens under the `/* Brand tokens */` section in `:root`:

```css
--brand-primary-vivid: oklch(0.6 0.24 300);
```

And under the surface tokens:

```css
--surface-page-translucent: oklch(1 0 0 / 0.8);
```

#### `middleware.ts` (modified)

Added `pathname === "/"` to the `isPublicRoute` check. Allows unauthenticated visitors to reach `/` without being redirected to `/login`.

#### `components/layout/app-header.tsx` (modified)

Added `pathname === "/"` to the `isAuthPage` check so the header returns `null` on the landing page.

#### `components/layout/app-footer.tsx` (modified)

Converted from server component to client component (`"use client"` + `usePathname()`). Returns `null` when `pathname === "/"` so the landing page renders its own footer.

### Implementation

#### Increment 1.1: Design Tokens + Middleware + Layout Updates

**What:** Add new CSS tokens, make `/` a public route, and hide AppHeader/AppFooter on the landing page.

**Files:**
1. **Modify `app/globals.css`** — Add `--brand-primary-vivid` and `--surface-page-translucent`.
2. **Modify `middleware.ts`** — Add `pathname === "/"` to `isPublicRoute`.
3. **Modify `components/layout/app-header.tsx`** — Add `pathname === "/"` to the `isAuthPage` check.
4. **Modify `components/layout/app-footer.tsx`** — Add `"use client"`, `usePathname()`, and early return for `pathname === "/"`.

**Verification:** Unauthenticated requests to `/` are no longer redirected to `/login`. The app header and footer do not render on `/`. New tokens are available in the CSS cascade.

#### Increment 1.2: Landing Page Component + Root Page

**What:** Create the landing page component with scroll-aware nav, full-viewport animated sections, and developer footer. Update the root page to render it.

**Files:**
1. **Create `app/_components/landing-page.tsx`** — Full landing page as described above.
2. **Modify `app/page.tsx`** — Replace redirect with metadata + `<LandingPage />`.

**Verification:**
- Unauthenticated: visiting `/` shows the full landing page (nav, hero, features, how-it-works, CTA, footer).
- Authenticated: visiting `/` shows a brief spinner then redirects to `/capture`.
- Nav is transparent at top, gains blur + translucent bg + border on scroll.
- All CTAs navigate to `/login` and are prominently sized (`size="lg"` minimum).
- Feature cards animate in/out on scroll (fade + slide up, staggered 120ms).
- Steps animate in/out on scroll (fade + scale, staggered 200ms).
- Connector line runs behind all three step badges evenly.
- Bottom CTA has no animation — text is immediately visible and impactful.
- Footer shows "Developed by Burhanuddin C" with social icons.
- Page is responsive — all sections vertically centred, single-column on mobile.
- All colours use CSS custom properties (no hardcoded values).
- `npx tsc --noEmit` passes with no errors.
