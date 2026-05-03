# Landing Page — Working Plan

A living plan for landing-page evolution. Sits outside the numbered PRD sequence because the landing page changes weekly. Past landing PRDs ([015-landing-page](015-landing-page/prd.md), [030-landing-page-polish](030-landing-page-polish/prd.md)) remain as historical record of what was originally built and the polish pass.

## Why this plan exists

A customer on a recent call said the page does not convey what the product does. Diagnosis: the page leads with **mechanism + poetry** ("AI-powered feedback intelligence", "turn every conversation into a product signal") instead of **category + pain**. Visitors who do not already know what "feedback intelligence" means have no mental bucket to put us in. Tools in this domain (Productboard, Cycle, Dovetail, Enjoy HQ) consistently anchor first to **Customer Feedback Management / Voice of Customer**, then differentiate. We skip the anchor step.

Three compounding issues:

1. No concrete "before" picture of the chaos visitors actually live in (Slack threads, call transcripts, Gong notes, sticky notes in someone's head).
2. "Ask Your Data" is told, not shown — the single biggest "aha" for this category is a real example query, and we do not have one on the page.
3. Personas are below Features, so a confused visitor cannot self-identify before reading feature copy.

## Goals

1. A first-time visitor with zero context understands the category in 5 seconds.
2. The page concretely shows the "ask your data" capability rather than describing it.
3. The page reflects the strategic positioning captured in the [README](../README.md#strategy--positioning).

## Non-goals

- Design system changes, new tokens, new components beyond what each phase explicitly adds.
- New routes, new APIs, backend work.
- A/B testing infrastructure.
- Video / heavy animation.
- Replacing the existing dashboard screenshot in the product showcase.

## Competitor benchmarks

Captured by fetching live landing pages (Productboard, Dovetail, Canny, Gong). Cycle.app's marketing site failed fetch (heavy client-side rendering); Enjoy HQ has been folded into UserTesting and is no longer a comparable peer.

| | Eyebrow / Pill | H1 | Subhead words | First section below hero |
|---|---|---|---|---|
| Productboard | "Productboard Spark: AI built for PMs. Now available & free to try in public beta." | *Spark, the AI platform for product managers* | 21 | Logo wall — "Trusted by 6,000+ leading product teams" |
| Dovetail | "The best never guess" | *Get total clarity from scattered user feedback* | 24 | "How it works" |
| Canny | "New — Capture feedback automatically with AI ✨" | *Build better products with customer feedback* | 11 | Logo wall — "Trusted by both industry leaders and startups" |
| Gong | "Trusted by 5,000+ customers" | *Gong Revenue AI OS* | 24 | Customer logos + case study |

**Patterns we're aligning to:**

- **Subheads run 11–24 words.** Our existing 35 is over the band; the first draft at 50 was way over.
- **H1s are short, declarative, outcome-framed.** Dovetail's *"Get total clarity from scattered user feedback"* is the closest tonal match — pain → outcome, no jargon.
- **Concrete verbs:** centralize, synthesize, uncover, pinpoint. Not "transform" or "turn into a signal".
- **Eyebrows announce a feature or establish credibility.** They almost never describe the category — that's the H1's job. We are deliberately breaking this pattern (using the eyebrow as a category anchor) because the explicit customer feedback was that visitors do not know our category.
- **First section below the hero is usually a logo wall.** We don't have logos yet, so the "Where feedback lives today" framing (P2) is the right substitute until we do.
- **Primary CTA is sales-led for enterprise** (Request a demo / Contact sales). We're keeping a self-serve `Try It Yourself` primary because there's no sales motion yet — adding a `Book a demo` CTA is a follow-up if/when that changes.

## Phases

Each phase is a self-contained, pushable increment. Ship one at a time, verify in the browser, move on.

---

### P1 — Hero rewrite (highest leverage, smallest change)

**Files:** [app/_components/landing-page.tsx](../app/_components/landing-page.tsx) (hero section), [app/_components/landing-product-showcase.tsx](../app/_components/landing-product-showcase.tsx) (add `id="showcase"` for anchor-jump target).

**Final copy (signed off):**

- **Pill:** *Customer Feedback Management, powered by AI*
- **H1:** *All your client feedback, finally answerable.* (gradient on the word *answerable*)
- **Subhead** (~30 words, within enterprise band): *Synthesiser captures every client conversation — sales calls, CS check-ins, Zoom recordings — extracts the signals with AI, and lets your whole team ask questions across all of it.*
- **Primary CTA:** `Try It Yourself` → `/login`
- **Secondary CTA:** `See an example dashboard` → `#showcase`

**Acceptance:**

- [ ] Pill, H1, subhead, two CTAs render correctly on desktop and mobile.
- [ ] Secondary CTA scrolls smoothly to the product showcase, with offset so the section title is not hidden under the fixed nav.
- [ ] No regressions in the auth-redirect / scroll-state behaviour.
- [ ] `npx tsc --noEmit` clean.

---

### P2 — "Where feedback lives today" section (the "before" picture)

**Files:** new component `app/_components/landing-feedback-sources.tsx`. Inserted in [landing-page.tsx](../app/_components/landing-page.tsx) between the hero and the product showcase.

**What it shows:**

A short visual section. Heading: *"Right now, your feedback is everywhere except one place."* Below it, source chips/cards (Sales calls, CS check-ins, Slack threads, Email replies, Gong / Zoom recordings, Support tickets) with subtle visual flow into a single Synthesiser node. This is the "oh, *that's* what this is" moment.

**Implementation note:** static SVG or pure CSS for the flow lines — no animation library, no Canvas. Reuse existing design tokens (`--brand-primary`, `--surface-raised`, `--border-default`).

**Acceptance:**

- [ ] Renders responsively (chip grid on mobile, fanned layout on desktop).
- [ ] Uses only existing design tokens.
- [ ] Section has scroll-reveal consistent with the rest of the page (`useScrollReveal`).

---

### P3 — Reorder: Personas above Features

**Files:** [app/_components/landing-page.tsx](../app/_components/landing-page.tsx) — JSX reorder only. Optional copy tighten in [landing-personas.tsx](../app/_components/landing-personas.tsx).

**Why:** A confused visitor needs to self-identify ("I'm a CS lead — this is for me") *before* reading feature copy. Currently the order is Showcase → Features → Personas, which means the visitor reads four feature cards through no lens at all and only later finds out the persona that would have made them resonate.

**New order:** Hero → Feedback Sources (P2) → Showcase → **Personas** → **Features** → How It Works → Bottom CTA → Contact → Footer.

**Acceptance:**

- [ ] Section anchors (`#features`, `#how-it-works`) still resolve to the right scroll target.
- [ ] Visual rhythm holds — no two `bg-[var(--surface-raised)]` sections back-to-back.

---

### P4 — Replace "Ask Your Data" feature card with a faux-chat preview

**Files:** [app/_components/landing-features-bento.tsx](../app/_components/landing-features-bento.tsx). Possibly extract the faux-chat into its own component if it gets bigger than ~80 lines.

**What it shows:**

The bento cell that today says *"Ask Your Data — skip the spreadsheet safari…"* becomes a static mocked chat exchange. Three example prompts cycle (or one is shown statically — pick whichever ships first):

1. *"Which Enterprise clients flagged pricing concerns in Q1?"*
2. *"Top 3 themes from churned accounts in the last 90 days?"*
3. *"What did Acme say about onboarding across their last 4 calls?"*

Show a snippet of an answer with a citation chip. Make it feel like the real chat UI without being interactive.

**Why:** This is the single biggest "aha" for the category. Telling visitors we can answer questions does not land — showing one real question does.

**Acceptance:**

- [ ] Visually consistent with the real chat UI (citation chip styling matches).
- [ ] Static — no real fetches, no real animation beyond the existing scroll reveal.
- [ ] Bento layout still works on mobile.

---

### P5 — Tighten "How it works" + bottom CTA

**Files:** [app/_components/landing-page.tsx](../app/_components/landing-page.tsx) — STEPS array (lines 21–37) and the bottom CTA section (lines 218–246).

**Changes:**

- Tie each of the three steps to a persona JTBD (e.g. step 3 is currently *"Your dashboard lights up with trends, and Chat answers any question…"* — sharpen to a concrete persona outcome like *"Your CS lead opens chat 30 minutes before a renewal and pulls every concern this client has raised, with quotes."*).
- Bottom CTA currently echoes the hero. Sharpen to a different angle — e.g. *"The next time a client tells you something important, make sure your team finds out."*

**Acceptance:**

- [ ] Three steps each name an outcome, not just a feature.
- [ ] Bottom CTA does not duplicate hero language.

---

## Status

| Phase | Status | Notes |
|---|---|---|
| P1 — Hero rewrite | shipped (code) | New pill, H1 with gradient on *answerable*, 30-word subhead, dual CTA. `id="showcase"` + `scroll-mt-20` on showcase, `scroll-smooth` on `<html>`. Awaiting visual QA. |
| P2 — Feedback sources section | shipped (code) | New `landing-feedback-sources.tsx` — six source chips (Sales calls, CS check-ins, Slack, Email, Zoom, Support) → arrow → branded Synthesiser node. Inserted between hero and showcase. Surface-raised bg to break rhythm. Awaiting visual QA. |
| P3 — Persona / feature reorder | shipped (code) | New order: Hero → Feedback Sources → Showcase → Personas → Features → How It Works → Bottom CTA → Contact → Footer. Awaiting visual QA. |
| P4 — Faux-chat preview | shipped (code) | New `landing-chat-preview.tsx` replaces the wide "Ask Your Data" feature card. Static mocked exchange: "Which Enterprise clients flagged pricing in Q1?" → cited 3-client answer with citation chips. Awaiting visual QA. |
| P5 — How-it-works + bottom CTA | shipped (code) | Steps tied to persona JTBDs (Capture / Extract / Decide). Bottom CTA rewritten to "The insights are already there. Get them out of someone's head." Awaiting visual QA. |

## Workflow

For each phase:

1. Implement against the file list above.
2. Run the dev server, verify in browser at desktop and mobile breakpoints.
3. `npx tsc --noEmit` clean.
4. Commit. Push.
5. Mark the phase ✅ in the status table above with a one-line note.
6. Move to the next phase.
