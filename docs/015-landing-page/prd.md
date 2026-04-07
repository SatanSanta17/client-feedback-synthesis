# PRD-015: Public Landing Page

> **Status:** Draft
> **Depends on:** PRD-001 (Foundation — implemented), PRD-011 (Email Auth — implemented)
> **Deliverable:** A public-facing landing page at `/` that sells the product to unauthenticated visitors, explains core features and the workflow, and funnels them to sign up. Authenticated users bypass the landing page entirely and are redirected to `/capture`.

## Purpose

Today, unauthenticated visitors hitting `/` are immediately redirected to `/login` — a functional but dead-end experience. There is no place that explains what Synthesiser does, why it matters, or who it's for. The login page assumes the visitor already knows the product.

A landing page fixes this. It's the first impression for every new visitor — whether they arrive from a referral link, a search result, or a colleague's recommendation. The page must do three things in under 30 seconds: (1) communicate the value proposition clearly, (2) show the core capabilities, and (3) make starting effortless.

The audience is dual: **sales/CS teams** who run client conversations and need to track feedback across accounts, and **product managers** who want to synthesise feedback into roadmap signals. The language must resonate with both without picking a side.

This page is designed to evolve. As new features ship, new feature cards can be added without restructuring the page. The architecture is intentionally simple — static content, no data fetching, no backend changes.

## User Story

As a visitor who has never used Synthesiser, I want to understand what the product does, see its key features, and get started quickly so that I can decide whether it's worth trying — all without digging through documentation or asking someone.

---

## Part 1: Landing Page

**Scope:** Public landing page at `/`, custom navigation bar, hero section, feature cards, "how it works" steps, bottom CTA, and minimal footer. Middleware and routing updates to make `/` public and redirect authenticated users.

### Requirements

**P1.R1 — Public route at `/`.** The root URL (`/`) serves the landing page for unauthenticated visitors. The middleware must allow unauthenticated access to `/` without redirecting to `/login`. This replaces the current redirect-to-`/capture` behavior.

**P1.R2 — Authenticated redirect.** Authenticated users visiting `/` are immediately redirected to `/capture` client-side. There should be no flash of the landing page — a loading spinner is shown while auth state resolves.

**P1.R3 — Independent layout.** The landing page does not render the standard `AppHeader` or `AppFooter`. It has its own lightweight navigation bar (logo + "Get Started" button) and its own minimal footer (copyright + sign-in link). The `AppHeader` and `AppFooter` components must be updated to return `null` when the pathname is `/`.

**P1.R4 — Hero section.** A full-width hero at the top with:
- A small pill badge (e.g. "AI-powered feedback intelligence") for context
- A bold, benefit-first headline (not a feature description — sell the outcome)
- A subtitle paragraph (2-3 sentences) explaining the problem and how Synthesiser solves it
- Two CTAs: primary "Start for Free" → `/login`, secondary "See How It Works" → scrolls to the how-it-works section
- A subtle gradient glow behind the hero for visual polish

**P1.R5 — Feature cards section.** A grid of 4 feature cards, each containing an icon, a short title, and a one-line description. Initial features:
1. **Capture Everything** — multi-format input (notes, chat logs, PDFs, CSVs)
2. **AI Signal Extraction** — raw notes → structured signals (pain points, requests, praise)
3. **Cross-Client Synthesis** — one-click master signal document with recurring themes
4. **Team Workspaces** — shared team context with role-based access

Each card uses an icon from `lucide-react`, the brand colour palette, and a subtle hover effect. The section is preceded by a heading and a short subtitle.

**P1.R6 — How It Works section.** A 3-step horizontal layout:
1. **Capture** — paste notes or upload files after every client call
2. **Extract** — AI pulls structured signals (themes, sentiment, action items)
3. **Synthesise** — a living master document shows cross-client patterns

Each step has a number badge, title, and description. An anchor ID (`#how-it-works`) supports the hero's secondary CTA scroll link.

**P1.R7 — Bottom CTA section.** A centred call-to-action block below the how-it-works section. Includes a motivating headline, a short paragraph, and a "Get Started" button → `/login`. This catches visitors who scrolled all the way down.

**P1.R8 — Design system compliance.** All colours, typography, spacing, and border radii use existing CSS custom properties and Tailwind tokens defined in `globals.css`. No hardcoded colour values. The landing page must feel like it belongs to the same product as the app.

**P1.R9 — Responsive.** Desktop-first design. The hero, features grid, and steps layout must be fully usable on mobile (single-column stack). The nav bar must remain functional at all viewport widths.

**P1.R10 — Feature-awareness for future evolution.** The features array is defined as a data constant at the top of the component file. Adding a new feature card is a one-line addition to the array — no layout changes required.

### Acceptance Criteria

- [ ] P1.AC1 — Unauthenticated visitors see the landing page at `/`
- [ ] P1.AC2 — Authenticated visitors at `/` are redirected to `/capture` with no landing page flash
- [ ] P1.AC3 — AppHeader and AppFooter are hidden on the landing page
- [ ] P1.AC4 — Hero section displays with headline, subtitle, pill badge, and two CTAs
- [ ] P1.AC5 — Four feature cards render in a responsive grid
- [ ] P1.AC6 — How-it-works section shows three steps and is reachable via anchor link
- [ ] P1.AC7 — Bottom CTA section is present with a working link to `/login`
- [ ] P1.AC8 — All colours and spacing use design tokens (no hardcoded values)
- [ ] P1.AC9 — Page is fully responsive — functional on mobile and polished on desktop
- [ ] P1.AC10 — "Get Started" and "Sign in" links all navigate to `/login`

### Backlog

- **Demo video or animated walkthrough.** Deferred — video production is expensive and goes stale as the UI evolves. A well-designed static page converts better than a poorly produced video. Revisit once the product UI is stable.
- **Social proof section.** Testimonials, logos, or usage stats. Deferred until there are real users to quote.
- **Pricing section.** Deferred until pricing model is defined.
- **Changelog / "What's new" section.** Could auto-populate from `CHANGELOG.md`. Deferred.
