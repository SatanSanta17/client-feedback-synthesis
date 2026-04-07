# PRD-015: Public Landing Page

> **Status:** Implemented (Part 1)
> **Depends on:** PRD-001 (Foundation — implemented), PRD-011 (Email Auth — implemented), PRD-012 (Design Tokens — implemented)
> **Deliverable:** A public-facing landing page at `/` that sells the product to unauthenticated visitors, explains core features and the workflow, and funnels them to sign up. Authenticated users bypass the landing page entirely and are redirected to `/capture`. The page uses scroll-driven animations, full-viewport sections, and a transparent-to-blur navigation bar for a polished SaaS feel.

## Purpose

Today, unauthenticated visitors hitting `/` are immediately redirected to `/login` — a functional but dead-end experience. There is no place that explains what Synthesiser does, why it matters, or who it's for. The login page assumes the visitor already knows the product.

A landing page fixes this. It's the first impression for every new visitor — whether they arrive from a referral link, a search result, or a colleague's recommendation. The page must do three things in under 30 seconds: (1) communicate the value proposition clearly, (2) show the core capabilities, and (3) make starting effortless.

The audience is dual: **sales/CS teams** who run client conversations and need to track feedback across accounts, and **product managers** who want to synthesise feedback into roadmap signals. The language must resonate with both without picking a side.

This page is designed to evolve. As new features ship, new feature cards can be added without restructuring the page. The architecture is intentionally simple — static content, no data fetching, no backend changes.

## User Story

As a visitor who has never used Synthesiser, I want to understand what the product does, see its key features, and get started quickly so that I can decide whether it's worth trying — all without digging through documentation or asking someone.

---

## Part 1: Landing Page

**Scope:** Public landing page at `/`, scroll-aware navigation bar, full-viewport hero section, animated feature cards, animated "how it works" steps with connector line, impactful bottom CTA, and developer footer with social links. Middleware and routing updates to make `/` public and redirect authenticated users. New design tokens for gradient and translucent surfaces.

### Requirements

**P1.R1 — Public route at `/`.** The root URL (`/`) serves the landing page for unauthenticated visitors. The middleware must allow unauthenticated access to `/` without redirecting to `/login`. This replaces the current redirect-to-`/capture` behavior.

**P1.R2 — Authenticated redirect.** Authenticated users visiting `/` are immediately redirected to `/capture` client-side. There should be no flash of the landing page — a loading spinner is shown while auth state resolves.

**P1.R3 — Independent layout.** The landing page does not render the standard `AppHeader` or `AppFooter`. It has its own scroll-aware navigation bar and its own minimal footer. The `AppHeader` and `AppFooter` components must be updated to return `null` when the pathname is `/`.

**P1.R4 — Scroll-aware navigation bar.** The nav bar is fixed at the top with:
- Fully transparent background when at the top of the page (scroll position ≤ 20px)
- Translucent background with `backdrop-filter: blur(16px)` and a bottom border when scrolled past 20px
- Smooth transition between states (300ms)
- Left: "Synthesiser" logo text. Right: prominent "Get Started" CTA button (`size="lg"`) linking to `/login`
- A new `--surface-page-translucent` design token for the scrolled state background

**P1.R5 — Hero section (full viewport).** A vertically centred, full-viewport hero with:
- A small pill badge (e.g. "AI-powered feedback intelligence") for context
- A bold, benefit-first headline with the key phrase ("product signal") rendered in a gradient using `--brand-primary` and `--brand-primary-vivid` tokens. The gradient must use a 135° three-stop pattern for strong visibility against the white background — no blending into the background
- A subtitle paragraph (2-3 sentences) explaining the problem and how Synthesiser solves it
- A single prominent CTA: "Try It Yourself" → `/login` with `size="lg"` and larger padding (`py-6 px-10 text-lg`). No secondary button — the page speaks for itself
- A subtle radial gradient glow behind the hero text using `--brand-primary` for visual polish

**P1.R6 — Feature cards section (full viewport, animated).** A vertically centred, full-viewport section with a grid of 4 feature cards. Each card contains an icon, a short title, and a one-line description. Initial features:
1. **Capture Everything** — multi-format input (notes, chat logs, PDFs, CSVs)
2. **AI Signal Extraction** — raw notes → structured signals (pain points, requests, praise)
3. **Cross-Client Synthesis** — one-click master signal document with recurring themes
4. **Team Workspaces** — shared team context with role-based access

Each card uses an icon from `lucide-react`, the brand colour palette, and a subtle hover shadow effect. The section background uses a gradient (`from-surface-raised to-surface-page`) instead of a flat colour for depth. The section is preceded by a heading and a short subtitle.

**Scroll-reveal animation:** Cards fade in (`opacity: 0 → 1`) and slide up (`translateY(40px) → 0`) as the user scrolls into view. Each card is staggered by 120ms. When the user scrolls away, cards fade out. When scrolling back, they reappear. This is implemented via `IntersectionObserver` with a 15% visibility threshold.

**P1.R7 — How It Works section (full viewport, animated).** A vertically centred, full-viewport 3-step layout:
1. **Capture** — paste notes or upload files after every client call
2. **Extract** — AI pulls structured signals (themes, sentiment, action items)
3. **Synthesise** — a living master document shows cross-client patterns

Each step has a circular number badge (filled `--brand-primary` background), title, and description — all centred. A horizontal connector line runs behind all three badges (desktop only) using a gradient from transparent through `--brand-primary-light` back to transparent, connecting all steps evenly.

**Scroll-reveal animation:** Steps fade in and scale up (`translateY(30px) scale(0.95) → translateY(0) scale(1)`) as the user scrolls into view. Each step is staggered by 200ms. Same `IntersectionObserver` pattern as the feature cards — elements disappear on scroll-out and reappear on scroll-in.

**P1.R8 — Bottom CTA section (full viewport, no animation).** A vertically centred, full-viewport call-to-action block. The text here is impactful and must be immediately readable — no scroll animations that would delay visibility. Includes:
- A `Target` icon inside a branded circle container (`--brand-primary-light` background)
- A large, multi-line headline (`text-3xl sm:text-4xl lg:text-5xl font-extrabold`) with a deliberate line break for emphasis
- A supporting paragraph in `text-lg sm:text-xl`
- A prominent "Start Capturing Today" CTA button → `/login` with the same large sizing as the hero CTA
- Background: `--surface-raised` for subtle contrast with the previous section

**P1.R9 — Footer with developer credits and social links.** A minimal footer replacing the sign-in link with developer attribution. Left: "Developed by Burhanuddin C". Right: icon-only social links (Email, GitHub, LinkedIn) matching the data from the app's `AppFooter`. Icons transition colour on hover from `--text-muted` to `--text-primary`.

**P1.R10 — Design system compliance.** All colours, typography, spacing, and border radii use CSS custom properties and Tailwind tokens defined in `globals.css`. No hardcoded colour values anywhere. New tokens added for this page:
- `--brand-primary-vivid` — vibrant gradient endpoint for the hero headline
- `--surface-page-translucent` — translucent surface for the scroll-triggered nav background

The landing page must feel like it belongs to the same product as the app.

**P1.R11 — Responsive.** Desktop-first design. All sections use `min-h-screen` with flex centering. The hero, features grid, and steps layout collapse to single-column on mobile. CTAs stack vertically on mobile. The nav bar remains functional at all viewport widths.

**P1.R12 — Feature-awareness for future evolution.** The features array and steps array are defined as `as const` data constants at the top of the component file. Adding a new feature card is a one-line addition to the array — no layout changes required.

**P1.R13 — All CTAs sized prominently.** Every CTA button uses `size="lg"` at minimum. Hero and bottom CTA buttons use additional `py-6 px-10 text-lg` for extra prominence. No small or easily-missed buttons.

### Acceptance Criteria

- [x] P1.AC1 — Unauthenticated visitors see the landing page at `/`
- [x] P1.AC2 — Authenticated visitors at `/` are redirected to `/capture` with no landing page flash
- [x] P1.AC3 — AppHeader and AppFooter are hidden on the landing page
- [x] P1.AC4 — Hero section is full viewport with headline, gradient text, subtitle, pill badge, and single prominent CTA
- [x] P1.AC5 — Four feature cards render in a responsive grid with scroll-reveal animations
- [x] P1.AC6 — How-it-works section shows three steps with connector line and scroll-reveal animations
- [x] P1.AC7 — Bottom CTA section is full viewport with impactful text and prominent button — no animation
- [x] P1.AC8 — All colours and spacing use design tokens (no hardcoded values including `text-white` or inline oklch)
- [x] P1.AC9 — Page is fully responsive — all sections vertically centred, single-column on mobile, polished on desktop
- [x] P1.AC10 — All CTA buttons navigate to `/login` and are prominently sized
- [x] P1.AC11 — Nav is transparent at top, gains blur + border on scroll
- [x] P1.AC12 — Footer shows "Developed by Burhanuddin C" with social icon links (no sign-in button)
- [x] P1.AC13 — Feature cards and steps animate in/out on scroll using IntersectionObserver

### Backlog

- **Demo video or animated walkthrough.** Deferred — video production is expensive and goes stale as the UI evolves. A well-designed static page converts better than a poorly produced video. Revisit once the product UI is stable.
- **Social proof section.** Testimonials, logos, or usage stats. Deferred until there are real users to quote.
- **Pricing section.** Deferred until pricing model is defined.
- **Changelog / "What's new" section.** Could auto-populate from `CHANGELOG.md`. Deferred.
- **Dark mode support.** The landing page uses design tokens throughout, so dark mode is a token-level change. Deferred to a dedicated dark mode PRD.
