# PRD-030: Landing Page Enterprise Polish

> **Status:** Draft
> **Depends on:** PRD-015 (Public Landing Page — implemented), PRD-021 (Insights Dashboard — implemented, source of the product showcase screenshot), PRD-010 (Team Access — implemented, owns the Resend email service reused by the contact form)
> **Deliverable:** A refreshed public landing page at `/` that feels enterprise-ready without becoming heavier or more cluttered. Adds a product showcase centerpiece, a bento-style features grid, a "Built for" personas strip that lets visitors self-identify, and a working Contact section with a real form that persists submissions and notifies the operator by email. Authenticated redirect, scroll-aware nav, and design-token discipline from PRD-015 are preserved unchanged.

## Purpose

The current landing page (PRD-015) is clean and on-brand but sells the product entirely through copy. There is no pixel of the actual product, the feature grid is the standard four-equal-cards layout that most SaaS pages used in 2019, no visitor can quickly tell whether the product is meant for *them* (a founder versus a CS lead versus a PM), and there is no path to contact the operator without leaving the page or hunting for a footer email.

Enterprise buyers — and the operators who decide whether to expense a tool — make a decision in seconds based on (a) does the product *look* serious, (b) is it for someone like me, and (c) can I talk to a human if I need to. This PRD addresses all three without adding noise or breaking the calm, single-page rhythm that PRD-015 established.

The page must remain instantly understandable. Adding sections is allowed; adding cognitive load is not. The signature visual upgrade is concentrated in one place — the product showcase — so the rest of the page can stay quiet.

The work is intentionally split into four small parts so each is a self-contained PR and the page can ship one improvement at a time. The contact form is the only part that introduces a backend surface (table, route handler, email notification); the other three parts are pure frontend.

## User Story

As a visitor evaluating Synthesiser for the first time — whether I am a founder running discovery calls, a sales lead chasing pipeline signal, a CS manager triaging feedback, or a PM building a roadmap — I want to see the actual product, recognise that it was built for someone like me, and reach the operator if I have a question, all without leaving the landing page or feeling overwhelmed.

---

## Part 1: Product Showcase Section

**Scope:** A new full-viewport section placed immediately after the hero that shows a real screenshot of the dashboard with a small number of floating callout chips highlighting key surfaces. This is the page's signature visual — every other addition in this PRD stays calm because this section carries the "wow."

### Requirements

**P1.R1 — Section placement.** The product showcase is inserted between the hero section and the features section. Existing sections (hero, features, how-it-works, bottom CTA, footer) are not reordered or restructured beyond this insertion.

**P1.R2 — Real product screenshot.** The section centres on a single high-resolution screenshot of the live `/dashboard` page. The screenshot is supplied by the operator and stored in the project's static assets. No placeholder, no stylised illustration, no Figma mock — the value is in showing the *real* product.

**P1.R3 — Image presentation.** The screenshot is rendered with a subtle device-frame treatment (rounded corners, a faint shadow, and a thin border using existing tokens) so it reads as "a product surface" rather than a raw PNG. The image scales responsively and never exceeds the section's max-width.

**P1.R4 — Callout chips.** Two to three small floating chips overlay the screenshot at fixed relative positions. Each chip is a pill containing an icon (lucide) and a short label (max two words). Suggested labels: "Sentiment trends", "Theme matrix", "RAG chat". Chips use existing brand and surface tokens, not raw colours.

**P1.R5 — Scroll-reveal animation.** The screenshot fades in and translates upward as it enters the viewport (same `IntersectionObserver` pattern as PRD-015's feature cards). The callout chips fade in with a 150ms stagger after the image, drawing the eye sequentially. Animation triggers once on first reveal — no scroll-out / scroll-in toggling for this section, because the image is the focal point and visual stability matters.

**P1.R6 — Section heading.** A short heading and one-line subtitle precede the image, framing what the visitor is about to see (suggested: "See your client landscape, in one screen" with a one-line subtitle). The heading uses the same type scale as PRD-015's other section headings.

**P1.R7 — Background continuity.** The section background uses an existing surface token (`--surface-page` or `--surface-raised`) chosen to provide gentle contrast with the hero above and the features section below. No new gradients or surface tokens are introduced.

**P1.R8 — Responsive.** The screenshot scales down on tablet and mobile viewports. Callout chips reposition or hide on viewports below the small breakpoint to avoid overlapping the image; on mobile, the section may show the image alone with chips suppressed.

**P1.R9 — Accessibility.** The screenshot has descriptive alt text. Callout chips have `aria-hidden="true"` because they decorate, not inform — the alt text already describes the dashboard.

### Acceptance Criteria

- [ ] P1.AC1 — A new section renders between the hero and features sections on `/`
- [ ] P1.AC2 — A real dashboard screenshot is displayed with rounded corners, border, and shadow using design tokens
- [ ] P1.AC3 — Two to three callout chips overlay the image at desktop widths
- [ ] P1.AC4 — The image fades in on scroll; chips fade in with a stagger
- [ ] P1.AC5 — The section is fully responsive; chips suppress on mobile rather than overlapping
- [ ] P1.AC6 — No new colour, gradient, or surface tokens are introduced; existing tokens are reused
- [ ] P1.AC7 — Alt text is present and descriptive

---

## Part 2: Bento Features Grid + "Built for" Personas Strip

**Scope:** Replace the current four-equal-cards features grid with an asymmetric bento layout (one large feature card plus three smaller cards) and add a compact "Built for" strip with one row per target persona (Founders, Sales, Customer Success, Product Managers). Both changes use existing copy and assets — this part introduces no new icons, no new tokens, and no new content beyond the four persona one-liners.

### Requirements

**P2.R1 — Bento layout for features.** The four feature cards from PRD-015 (Capture Everything, AI Signal Extraction, Insights Dashboard, Ask Your Data) are reorganised into an asymmetric grid:
- One **hero card** that spans two columns and contains the most product-defining feature (suggested: "AI Signal Extraction")
- Three **standard cards** that occupy the remaining cells in a balanced layout
- The total card count remains four; copy and icons are unchanged

**P2.R2 — Hero card emphasis.** The hero card is visually heavier than the others — larger title type, more padding, and optionally a small ambient visual element (e.g. a faint gradient corner glow using existing brand tokens). It must remain readable, not decorative — the copy is still the point.

**P2.R3 — Card consistency.** All four cards share the same border treatment, hover behaviour, icon container, and corner radius. The hero card is bigger, not different.

**P2.R4 — Scroll-reveal preservation.** The existing scroll-reveal stagger from PRD-015 (`IntersectionObserver`, 120ms stagger) is preserved. The hero card reveals first, followed by the three standard cards.

**P2.R5 — "Built for" strip placement.** A new "Built for" section is added immediately after the features section. It is a horizontal strip — not a full-viewport section — containing four compact rows or columns, one per persona.

**P2.R6 — Persona content.** The four personas and their one-line value statements are:
- **Founders** — capturing every discovery call so investor and product decisions are evidence-backed
- **Sales** — turning prospect objections into shared institutional memory the next deal can use
- **Customer Success** — spotting churn signals across QBRs before they become churn
- **Product Managers** — backing the roadmap with what clients actually said, not what someone remembered

The exact copy may be tuned during implementation; the *structure* (four personas, one short value statement each) is fixed.

**P2.R7 — Persona row layout.** Each row contains an icon, a persona label (e.g. "Founders"), and the one-line value statement. Icons use lucide and existing brand tokens. Layout collapses to single column on mobile; rows stack vertically.

**P2.R8 — No persona-specific landing pages in this part.** The "Built for" strip is a self-identification cue, not a navigation hub. None of the persona rows are clickable. ICP-specific landing pages are explicitly deferred to the backlog.

**P2.R9 — Section spacing.** The "Built for" strip is shorter than a full viewport. It uses comfortable vertical padding but is intentionally not `min-h-screen` — visitors should land on it as a brief beat between the features section and the how-it-works section, not a wall.

### Acceptance Criteria

- [ ] P2.AC1 — The features section renders four cards in an asymmetric bento grid (one large + three smaller)
- [ ] P2.AC2 — Card content (titles, descriptions, icons) from PRD-015 is preserved unchanged
- [ ] P2.AC3 — Scroll-reveal stagger continues to work after the layout change
- [ ] P2.AC4 — A new "Built for" section appears between the features section and the how-it-works section
- [ ] P2.AC5 — The "Built for" section contains exactly four persona rows, each with an icon, label, and one-line value statement
- [ ] P2.AC6 — Persona rows are not clickable and do not navigate
- [ ] P2.AC7 — All copy and tokens come from existing sources; no new icons or colour tokens are introduced
- [ ] P2.AC8 — Layout is responsive: bento collapses to single column on mobile, persona rows stack vertically

---

## Part 3: Contact Section with Working Form

**Scope:** Add a Contact section near the bottom of the landing page (above the footer, paired with the existing bottom CTA) that includes a real working form. Submissions persist to a new database table and trigger an email notification to the operator via the existing Resend integration. Adds a sign of legitimacy ("you can talk to a human") and a path for early enterprise interest. This is the only part of this PRD that introduces a backend surface.

### Requirements

**P3.R1 — Section placement.** The Contact section appears immediately above the footer. The existing bottom CTA section ("Stop letting insights slip through the cracks") is preserved — the contact section does not replace it. The two coexist with the bottom CTA above and the contact section below it.

**P3.R2 — Two-column layout on desktop.** On desktop, the contact section is split into two columns:
- **Left:** A short pitch ("Have a question? Want a walkthrough? Let's talk.") plus alternative contact pointers — operator email and an optional Calendly link, both pulled from existing footer constants where possible
- **Right:** The contact form

On mobile, the layout collapses to a single column with the pitch above the form.

**P3.R3 — Form fields.** The form contains exactly three fields:
- **Name** — required, free text, max 100 characters
- **Email** — required, must be a valid email address
- **Message** — required, free text, max 2,000 characters

No phone field, no company field, no dropdowns. The form's value is its low friction.

**P3.R4 — Form validation.** Client-side validation uses `react-hook-form` + `zod` per the project convention (CLAUDE.md). Field-level error messages render inline. Empty submissions are blocked client-side.

**P3.R5 — Submit behaviour.** On submit, the form is disabled and a loading state replaces the submit button label. On success, the form is replaced inline by a confirmation message ("Thanks — we'll get back to you within one business day"). On failure, an error toast is shown and the form re-enables so the visitor can retry. The form does not navigate away on success — the visitor stays on the landing page.

**P3.R6 — Persistence.** Each submission is stored as a row in a new `contact_submissions` table. The schema captures name, email, message, the visitor's user agent, the visitor's IP (if available from request headers), and a created-at timestamp. RLS is enabled and denies all client reads — only the service role can read this table. There is no UI for browsing submissions in this PRD.

**P3.R7 — Email notification.** On successful persistence, the API route triggers an email to the operator via the existing Resend integration. The email contains the submitter's name, email, and message in plain readable form. The reply-to header is set to the submitter's email so the operator can reply directly from their inbox. Email send failures are logged but do not fail the API response — the submission is still persisted and the visitor still sees success.

**P3.R8 — Public unauthenticated route.** The contact form posts to a new public API route. The route is excluded from the middleware's authentication redirect (it is allowed without a session) but still validates input with Zod and returns standard HTTP status codes per CLAUDE.md.

**P3.R9 — Abuse protection.** The route enforces a simple rate limit (per-IP, per-window — exact thresholds defined in the TRD) and a payload size cap. The form also includes an invisible honeypot field that, if filled, causes the route to silently accept the submission without persisting or notifying — standard low-friction spam mitigation that does not require a CAPTCHA.

**P3.R10 — Logging.** Per CLAUDE.md, the route logs entry with redacted input context, exit with outcome, and any errors with full stack traces. The email-send step is logged independently so a notification failure is visible without obscuring submission success.

**P3.R11 — Design consistency.** The Contact section uses the same surface, border, and typography tokens as the rest of the landing page. The form fields use the project's existing form primitives (shadcn `Input`, `Textarea`, `Button`). No new form components are introduced.

**P3.R12 — Nav anchor.** The fixed scroll-aware navigation bar gains a "Contact" anchor link that scrolls smoothly to the Contact section. The "Get Started" CTA in the nav is preserved unchanged. On mobile, the Contact link is visible alongside the CTA.

### Acceptance Criteria

- [ ] P3.AC1 — A Contact section renders above the footer on `/` with a two-column desktop layout and stacked mobile layout
- [ ] P3.AC2 — The form contains Name, Email, and Message fields with client-side validation
- [ ] P3.AC3 — Submitting a valid form persists a row in `contact_submissions` and triggers an email to the operator
- [ ] P3.AC4 — On success, the form is replaced inline by a confirmation message with no page navigation
- [ ] P3.AC5 — On failure, an error toast appears and the form re-enables
- [ ] P3.AC6 — `contact_submissions` has RLS enabled and denies all client reads
- [ ] P3.AC7 — The email notification has reply-to set to the submitter's email
- [ ] P3.AC8 — The new API route is publicly accessible without a session and is excluded from middleware auth redirects
- [ ] P3.AC9 — The route enforces rate limiting and a payload size cap; honeypot submissions are silently accepted
- [ ] P3.AC10 — The nav bar exposes a "Contact" anchor that scrolls to the section
- [ ] P3.AC11 — All UI uses existing form primitives and design tokens — no new components or colours

---

## Part 4: Footer Expansion and Final Polish

**Scope:** Expand the current minimal footer into a slightly richer (but still calm) layout with quick navigation links, a product description line, and the existing developer credits and social icons. Run a full pre-ship pass over the page: dark mode parity, mobile polish, animation timing, and a sanity check that nothing introduced in Parts 1–3 broke an existing acceptance criterion from PRD-015.

### Requirements

**P4.R1 — Footer columns.** The footer expands from its current single horizontal row into a small multi-column layout on desktop:
- **Left column:** "Synthesiser" wordmark, a short product description line, and developer credits ("Developed by Burhanuddin C")
- **Middle column:** Quick links — anchor links to "Features", "How It Works", and "Contact" sections on the same page
- **Right column:** Social icons (Email, GitHub, LinkedIn — same as PRD-015) and the existing theme toggle

On mobile, columns stack vertically.

**P4.R2 — No new social or external links.** The footer reuses the exact `SOCIAL_LINKS` array from PRD-015. No Twitter, LinkedIn company page, or product Twitter account is added in this PRD.

**P4.R3 — Footer typography and spacing.** The footer remains visually quiet. It uses existing muted text tokens, comfortable padding, and a single top border. It is not full-viewport.

**P4.R4 — Dark mode parity.** Every section added or modified in Parts 1–3 must look correct in dark mode. The product showcase image is the most likely problem — if the screenshot is light-themed, it is allowed to remain light-themed in dark mode (the device frame can adapt) rather than maintaining two screenshots. This is an explicit decision recorded here so it is not relitigated during the audit.

**P4.R5 — Animation timing audit.** Scroll-reveal animations across the page (PRD-015 features, PRD-015 steps, PRD-030 product showcase) are reviewed together. If two adjacent sections trigger reveal animations at the same scroll position, their timings are adjusted so the page feels orchestrated rather than chaotic. No new animation libraries are introduced.

**P4.R6 — Mobile polish.** The full page is walked through at common mobile widths (320, 375, 414). Specific checks: bento cards stack cleanly, persona rows are readable, the contact form's Message textarea does not overflow, the nav bar's Contact anchor does not crowd the CTA.

**P4.R7 — Acceptance regression check.** Every acceptance criterion from PRD-015 (P1.AC1–P1.AC13) is re-verified after Parts 1–3 land. Any regression is fixed in this part rather than deferred.

**P4.R8 — Performance sanity.** The dashboard screenshot from Part 1 is the heaviest new asset on the page. It is served with appropriate compression and Next.js `Image` optimisation. The page's largest contentful paint should not visibly worsen versus the pre-PRD-030 baseline on a desktop connection.

### Acceptance Criteria

- [ ] P4.AC1 — Footer renders three columns on desktop and stacks vertically on mobile
- [ ] P4.AC2 — Quick-link anchors scroll smoothly to the correct on-page sections
- [ ] P4.AC3 — Developer credits and social icons are preserved exactly from PRD-015
- [ ] P4.AC4 — Every Part 1–3 addition renders correctly in dark mode
- [ ] P4.AC5 — Scroll-reveal animations across the page feel coordinated, not overlapping or jittery
- [ ] P4.AC6 — Mobile experience is verified at 320, 375, and 414 widths with no overflow or crowding
- [ ] P4.AC7 — All PRD-015 acceptance criteria still pass
- [ ] P4.AC8 — Dashboard screenshot is served via `next/image` with appropriate optimisation

---

## Backlog

- **ICP-specific landing pages.** Dedicated landing pages per persona (Founders, Sales, CS, PMs) with audience-specific hero copy and example sessions. Deferred — the "Built for" strip in Part 2 is the lighter, lower-risk first move. Revisit once there is enough traffic to A/B test.
- **Social proof section.** Logo strip and testimonial quotes. Deferred per operator decision until there are real users to quote — placeholder social proof reads worse than none.
- **Contact submissions admin UI.** A page for the operator to browse and respond to `contact_submissions` rows from inside the app. Deferred — email notifications cover the early-stage need, and adding an admin UI is wasted effort if submission volume is low.
- **CAPTCHA.** Replace or supplement the honeypot with a real CAPTCHA if spam volume becomes a problem. Deferred — adds friction that hurts conversion, only worth introducing reactively.
- **Marketing video / animated walkthrough.** Tracked separately as a follow-on conversation after this PRD ships. Not part of PRD-030's scope.
- **A "What's new" or changelog strip.** Auto-populated from `CHANGELOG.md`. Deferred — adds noise without clear conversion value at this stage.
- **Pricing section.** Deferred until pricing model is defined.
