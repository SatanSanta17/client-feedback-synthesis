# TRD-030: Landing Page Enterprise Polish

> **Status:** Part 1 in progress
>
> Mirrors **PRD-030**. Each part maps to the corresponding PRD part. Part 1 is detailed below; Parts 2–4 are stubbed and will be filled in once their respective PRD parts begin implementation.

---

## Part 1: Product Showcase Section

> Implements **P1.R1–P1.R9** from PRD-030.

### Overview

Insert a new full-viewport section between the existing hero and features sections on the public landing page. The section presents a real screenshot of the live `/dashboard` page wrapped in a device-frame treatment (rounded corners, border, soft shadow) with two to three floating callout chips overlaying the image at fixed relative positions. Both the image and the chips animate in on scroll using an `IntersectionObserver`-based reveal — image fades up first, chips fade in sequentially with a 150ms stagger. The section is responsive: chips suppress below the small breakpoint to avoid overlapping the scaled-down image on mobile.

The current `useScrollReveal` hook lives privately inside `app/_components/landing-page.tsx`. Part 1 extracts it into `lib/hooks/use-scroll-reveal.ts` so the new showcase component can reuse it without duplication. This extraction also benefits Parts 2–4 (bento features, persona strip, contact section) which will need the same hook from sibling components.

The screenshot itself is operator-supplied. Until the operator delivers the asset, the increment uses a placeholder image at the same path so the layout, sizing, and animation can be verified without blocking on the deliverable.

No database changes, no new API routes, no new npm dependencies. No new design tokens — every colour, surface, border, and radius reuses tokens already defined in `globals.css`.

### Dependencies (npm)

None. Uses only existing packages: React (`useEffect`, `useState`), Next.js (`Image`), lucide-react (icons), and existing utility helpers (`cn`).

### Database Changes

None.

### API Endpoints

None.

### Design Token Changes

None. The PRD explicitly forbids new tokens for this part (P1.R7). The device-frame treatment, chip surfaces, scroll-reveal opacity, and section background all reuse:

- `--surface-page` / `--surface-raised` for backgrounds and chip fills
- `--border-default` for the device frame and chip borders
- `--brand-primary` / `--brand-primary-light` for chip icons
- `--text-primary` / `--text-secondary` for headings and subtitles
- Existing Tailwind shadow utilities (`shadow-lg`, `shadow-xl`) for the device frame

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/hooks/use-scroll-reveal.ts` | **Create** | Extract the existing private `useScrollReveal` hook from `landing-page.tsx` into a project-level hook so multiple landing-page sections can share it |
| `app/_components/landing-page.tsx` | **Modify** | Remove the inline `useScrollReveal` definition (replace with import); render the new `<LandingProductShowcase />` between the hero `<section>` and the features `<section>` |
| `app/_components/landing-product-showcase.tsx` | **Create** | New section component — heading, subtitle, framed dashboard image with overlay chips, scroll-reveal animation |
| `public/landing/dashboard-showcase.png` | **Create** | Operator-supplied screenshot of `/dashboard`. Placeholder PNG committed initially so the layout works end-to-end; replaced in-place by the operator before merge |

### Frontend Components

#### `lib/hooks/use-scroll-reveal.ts` (new)

A standalone re-export of the existing `useScrollReveal` logic, unchanged in behaviour:

- Returns `{ ref: (node: HTMLDivElement | null) => void, isVisible: boolean }`.
- Uses `IntersectionObserver` with `threshold: 0.1`, calls `observer.unobserve(node)` after first intersection (one-shot reveal).
- File contains the hook only; no other exports.
- Naming convention follows CLAUDE.md (`use-scroll-reveal.ts` file, `useScrollReveal` function).

The behaviour is identical to the inlined version currently in `landing-page.tsx`. The extraction is mechanical — same body, same return shape — so the existing features and steps animations continue to work without change.

#### `app/_components/landing-product-showcase.tsx` (new)

A `"use client"` component co-located with the rest of the landing-page surface in `app/_components/`.

**Structure:**

```
<section> (full-viewport, border-top, max-width container)
  <header> heading + subtitle (centered)
  <div ref={reveal.ref} className="relative">  ← image container
    <div className="device-frame">             ← rounded corners + border + shadow
      <Image src=".../dashboard-showcase.png" />
    </div>
    <Chip position="top-left"     icon={LineChart}     label="Sentiment trends" />
    <Chip position="top-right"    icon={Grid3x3}       label="Theme matrix" />
    <Chip position="bottom-center" icon={MessagesSquare} label="RAG chat" />
  </div>
</section>
```

The `Chip` is a tiny private component within the same file (not exported, not extracted to `components/`) since it is only used by the showcase. It accepts `position`, `icon`, `label`, and an `index` prop for stagger calculation.

**Image rendering:**
- Uses `next/image` per CLAUDE.md.
- `src="/landing/dashboard-showcase.png"`.
- `alt="Synthesiser dashboard showing sentiment trends, theme matrix, and recent insights for a workspace's client portfolio"` (descriptive per P1.R9).
- `width` and `height` set to the asset's intrinsic dimensions (operator confirms; placeholder uses 2400×1500 = 8:5 aspect).
- `priority={false}` — the image is below the fold (after hero), so it should not preload.
- `sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1200px"` for responsive serving.

**Device-frame treatment:**
- Wrapper div with `rounded-2xl border border-[var(--border-default)] shadow-2xl bg-[var(--surface-raised)] overflow-hidden`.
- A small inner padding around the image is acceptable to evoke a "screen bezel" feel; final pixel values are tuned during increment 5 polish.

**Callout chips (overlay):**
- Absolutely positioned within the relative image container.
- Each chip is a pill: `inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium shadow-md`.
- Icon uses `--brand-primary` colouring; label uses `--text-primary`.
- Positions (desktop):
  - Chip 1: `top: 8%; left: -4%` (slightly extruding left edge to imply layering)
  - Chip 2: `top: 20%; right: -4%`
  - Chip 3: `bottom: 12%; left: 50%; transform: translateX(-50%)`
- Below the `sm` breakpoint, the chip container is hidden via `hidden sm:block` wrapping each chip, so the image alone shows on mobile (P1.R8).
- Each chip carries `aria-hidden="true"` (P1.R9 — chips decorate; alt text already conveys the dashboard's content).

**Scroll-reveal animation:**
- A single `useScrollReveal()` instance attached to the image container.
- The image fades in (`opacity 0 → 1`) and translates up (`translateY(40px) → 0`) over 600ms with `ease-out`.
- Each chip uses inline `style={{ opacity, transform, transition, transitionDelay }}` derived from the same `isVisible` value, with `transitionDelay = 200 + index * 150` ms (chips begin staggering 200ms after the image starts revealing, then each subsequent chip waits 150ms more).
- Animation triggers once on first reveal — no scroll-out toggling. This is structurally enforced by the hook (uses `observer.unobserve` after first hit).

**Section heading:**
- Heading: `<h2>` — "See your client landscape, in one screen" using the same type scale as the existing PRD-015 section headings (`text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight`).
- Subtitle: one short line — "Every conversation, structured. Every theme, surfaced. Every signal, searchable." — `text-base sm:text-lg text-[var(--text-secondary)]`.
- Both centered above the image, with consistent vertical rhythm (`mb-16` separating header from image, mirroring PRD-015's features section).

**Section container:**
- Outer `<section>` with `flex min-h-screen items-center border-t border-[var(--border-default)]` to match the existing full-viewport section pattern.
- Background: `--surface-page` (default page background — sandwiches between the hero and the gradient features section without introducing a third surface tier).
- Inner container: `mx-auto w-full max-w-6xl px-6 py-24` (same as PRD-015 sections).

**Responsive:**
- Image scales fluidly via `next/image` and the `sizes` attribute.
- Chips hide below `sm` (640px) so the image renders cleanly on phones.
- No horizontal scroll at any common viewport.

#### `app/_components/landing-page.tsx` (modify)

Two changes only:

1. Remove the inline `useScrollReveal` function definition (lines ~88–110 in the current file). Add `import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";` to the existing imports.
2. Insert `<LandingProductShowcase />` between the existing hero `<section>` and features `<section>` (around line ~221, immediately after the hero's closing `</section>`).

No other modifications to this file. Existing FEATURES and STEPS arrays, the scroll-aware nav, the bottom CTA, and the footer are untouched.

### Asset Pipeline

The dashboard screenshot is the only new binary asset. Two-stage delivery:

1. **Initial commit (placeholder):** A neutral grey 2400×1500 PNG with a single label ("Dashboard screenshot — placeholder") committed at `public/landing/dashboard-showcase.png`. This unblocks layout, sizing, and animation work without waiting on the operator's asset.
2. **Operator replacement:** Before this part is merged to main, the operator replaces the placeholder file in-place with the real screenshot. Same path, same intrinsic aspect ratio (8:5 — 2400×1500 or higher at the same ratio). No code change required because `next/image` reads the new file's dimensions at build time.

If the operator-supplied screenshot has a materially different aspect ratio, increment 5 (polish) adjusts the section's `max-width` constraints accordingly. Aspect ratios within the range 16:10 to 16:9 are accommodated without code changes.

### Forward Compatibility

The hook extraction in this part is the foundation that Parts 2–4 will build on:

- **Part 2** (`landing-features-bento.tsx`, `landing-personas.tsx`) imports `useScrollReveal` from `lib/hooks/use-scroll-reveal.ts` to drive its own bento card stagger and persona row reveal — same pattern as the showcase chips.
- **Part 3** (`landing-contact-section.tsx`) may reuse the hook for entry animation on the contact form.
- **Part 4** (`landing-footer.tsx`) does not need the hook but benefits from the section-extraction pattern this part establishes.

The chip rendering pattern (private sub-component, absolutely positioned, hidden on mobile) is also a reusable shape — Part 2's bento hero card may use a similar overlay treatment for its ambient visual element.

No database fields, route handlers, or shared services are pre-built for later parts in this increment — they introduce surfaces (a `contact_submissions` table, a public `/api/contact` route) that have no consumer in Part 1, so building them now would violate YAGNI. They land with their owning part.

### Implementation Increments

Each increment is a self-contained, verifiable unit. Increments 1–2 are independently mergeable; 3–5 layer onto 2.

#### Increment 1: Extract `useScrollReveal` to `lib/hooks/`

**Goal:** Move the existing hook out of `landing-page.tsx` without changing behaviour.

**Steps:**
1. Create `lib/hooks/use-scroll-reveal.ts` with the same hook body that currently lives in `landing-page.tsx`.
2. Add the named export `useScrollReveal`.
3. In `landing-page.tsx`, remove the inline definition and add the import.
4. Verify in dev that the existing features grid and steps section still animate identically to before.

**Acceptance:** No behavioural change to the live landing page. `npm run lint` and `npx tsc --noEmit` pass.

#### Increment 2: Scaffold the showcase section (no chips, no animation)

**Goal:** Get the new section rendering in the right position with the heading, subtitle, framed image, and a placeholder PNG — but no chips and no scroll-reveal animation yet. Static markup only.

**Steps:**
1. Add `public/landing/dashboard-showcase.png` (placeholder grey PNG, 2400×1500).
2. Create `app/_components/landing-product-showcase.tsx` with the section shell, heading, subtitle, and `<Image>` rendered inside the device-frame wrapper.
3. Import and render `<LandingProductShowcase />` from `landing-page.tsx`, between hero and features.
4. Verify the section renders with correct spacing, the image is centered and properly framed at desktop and mobile widths, and the page's overall vertical rhythm still feels right.

**Acceptance:** Section is visible at `/`, between hero and features, on desktop and mobile. Lint and tsc pass.

#### Increment 3: Add callout chips with absolute positioning and responsive hiding

**Goal:** Layer the two-to-three chips over the image with correct positioning and mobile suppression.

**Steps:**
1. Add the private `Chip` sub-component to `landing-product-showcase.tsx`.
2. Render three chips at the prescribed positions over the image.
3. Wrap each chip in `<div className="hidden sm:block">` (or apply `hidden sm:inline-flex` directly) so chips disappear on viewports below 640px.
4. Set `aria-hidden="true"` on each chip.
5. Verify on desktop that the chips are positioned cleanly (not overlapping the image's content in a confusing way) and on mobile that they are suppressed.

**Acceptance:** Chips render at desktop, hidden on mobile, do not overlap each other.

#### Increment 4: Add scroll-reveal animation with stagger

**Goal:** Bring the image and chips in via scroll-triggered animation.

**Steps:**
1. Import `useScrollReveal` from `lib/hooks/use-scroll-reveal.ts`.
2. Attach the returned `ref` to the image container.
3. Apply opacity and translate styles to the image based on `isVisible`.
4. Apply opacity, translate, and `transition-delay` styles to each chip, parameterised by chip index, so the chips stagger in 150ms apart starting 200ms after the image.
5. Verify the animation triggers exactly once when the section enters the viewport, in a smooth visual sequence.

**Acceptance:** On scroll into the section, the image fades up, then chips fade in one by one. Scrolling away and back does not retrigger the animation.

#### Increment 5: Polish, accessibility, and verification

**Goal:** Final pass before merge.

**Steps:**
1. Tune chip positions and section padding based on the actual operator-supplied screenshot (if available). If still using the placeholder, leave room for tuning during the asset replacement step.
2. Verify alt text reads naturally and describes the dashboard content (P1.R9).
3. Verify the section renders correctly in both light and dark mode. The placeholder image is theme-neutral; the real screenshot's theme behaviour follows P4.R4 (it may stay light-themed in dark mode without compensation).
4. Walk through 320 / 375 / 414 / 768 / 1024 / 1440 viewports and confirm there is no overflow, no horizontal scroll, and the image scales cleanly.
5. Run `npx tsc --noEmit` and `npm run lint`.
6. Run the full Quality Gates checklist from CLAUDE.md (code quality, PRD compliance, no regressions to existing landing page sections, ARCHITECTURE.md / README consistency).
7. Replace the placeholder image with the operator-supplied real screenshot before opening the PR for merge.

**Acceptance:** All P1.AC1–P1.AC9 pass. The page is visibly improved without any regression to PRD-015 acceptance criteria.

### Post-Part Documentation Updates

Per CLAUDE.md "After each TRD part completes":

- `ARCHITECTURE.md`:
  - Update the file map to include `lib/hooks/use-scroll-reveal.ts` and `app/_components/landing-product-showcase.tsx`
  - Update the file map to include `public/landing/dashboard-showcase.png`
  - Update the landing page's "Core features live" bullet to mention the product showcase section
- `CHANGELOG.md`:
  - New entry under PRD-030 Part 1 summarising the showcase section and the hook extraction

No database type regeneration, no env-var changes, no migration to record.

---

## Part 2: Bento Features Grid + "Built for" Personas Strip

> Implements **P2.R1–P2.R9** from PRD-030.

### Overview

Replace the current inline features grid in `landing-page.tsx` (a four-equal-card responsive grid) with an asymmetric bento layout in a dedicated component. The bento uses a 3-column × 2-row CSS grid: the hero card ("AI Signal Extraction") spans both rows on the left; "Capture Everything" and "Insights Dashboard" occupy the upper-right cells; "Ask Your Data" spans both columns on the bottom-right. This shape is asymmetric without being chaotic — every cell still aligns to the grid lines. On mobile the grid collapses to a single column where every card is full-width.

After the bento, insert a new compact "Built for" section (intentionally not full-viewport — it is a brief beat between two larger sections) with four persona rows: Founders, Sales, Customer Success, Product Managers. Each row is a horizontal flex of icon + label + one-line value statement. Rows are not clickable; per PRD they are self-identification cues, not navigation.

Both new sections consume the `useScrollReveal` hook extracted in Part 1. The bento staggers card reveal in z-shape order (hero → top-right pair → bottom span). The persona strip reveals as a single block — no per-row stagger, because four short rows benefit from arriving together.

No new design tokens, no new dependencies, no backend changes. Existing icons (`MessageSquareText`, `Sparkles`, `BarChart3`, `Brain`) are reused for the bento; four new lucide icons are introduced for the personas (`Rocket`, `TrendingUp`, `HeartHandshake`, `Map`) — these are pure additions to the existing import surface, not new packages.

### Dependencies (npm)

None.

### Database Changes

None.

### API Endpoints

None.

### Design Token Changes

None. Hero-card emphasis (P2.R2) is achieved via Tailwind utilities (`p-10` vs `p-8`, `text-2xl` vs `text-lg`, optional `bg-gradient-to-br` corner glow using `--brand-primary-light` already defined for PRD-015).

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/_components/landing-features-bento.tsx` | **Create** | Asymmetric bento layout — hero card + three standard cards. Wraps the existing FEATURES copy unchanged. |
| `app/_components/landing-personas.tsx` | **Create** | Compact "Built for" strip — four persona rows with icon, label, one-line value statement. |
| `app/_components/landing-page.tsx` | **Modify** | Remove the inline features `<section>` (lines ~196–232). Render `<LandingFeaturesBento />` and `<LandingPersonas />` in its place. Drop the now-unused `featuresReveal` variable and the four feature icon imports. |

### Frontend Components

#### `app/_components/landing-features-bento.tsx` (new)

Owns the FEATURES data array (moved from `landing-page.tsx` since it is no longer consumed there) and the bento layout. The four cards retain the existing copy and icons — only the layout changes.

**Bento layout (CSS grid):**

```
              col 1    col 2    col 3
       row 1  HERO     CAPTURE  INSIGHTS
       row 2  HERO     ASK DATA ASK DATA
```

Concretely:
- Container: `grid grid-cols-1 md:grid-cols-3 md:grid-rows-2 gap-6 lg:gap-8` — collapses to single column below the medium breakpoint.
- Hero card (`AI Signal Extraction`): `md:row-span-2`. Larger padding (`p-10`), larger title (`text-2xl`), and a subtle radial gradient corner glow (`absolute size-40 rounded-full bg-[var(--brand-primary-light)] opacity-50 blur-2xl` positioned bottom-right) for ambient emphasis.
- "Capture Everything": default placement (col 2, row 1).
- "Insights Dashboard": default placement (col 3, row 1).
- "Ask Your Data": `md:col-span-2` — spans the bottom-right two cells on row 2.

All four cards share the same border, surface, hover, and radius treatment from PRD-015 (`rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] hover:shadow-lg`). Hero is bigger, not different.

**Scroll reveal:**
- Single `useScrollReveal` instance attached to the grid container.
- Each card uses `transitionDelay` keyed off the card's index in z-shape order (hero=0, capture=1, insights=2, ask-data=3) with a 120ms stagger — same cadence as PRD-015's existing features animation, so the rhythm is preserved.

**Section shell:**
- Same `flex min-h-screen items-center border-t bg-gradient-to-b from-[var(--surface-raised)] to-[var(--surface-page)]` as the original PRD-015 features section. The visual envelope (gradient background, full-viewport, centered heading + subtitle, max-w-6xl container) is preserved unchanged — the only thing that changes inside is the grid.

#### `app/_components/landing-personas.tsx` (new)

A short, deliberately not-full-viewport section.

**Layout:**
- Outer `<section>` with `border-t border-[var(--border-default)] bg-[var(--surface-page)]` and `py-20` (compact relative to other sections' `py-24` + `min-h-screen`).
- Inner `mx-auto max-w-4xl px-6` container.
- Heading + subtitle (centered, smaller than other section headings since the section is shorter): "Built for the people who run client conversations" / one-line subtitle.
- A vertical stack of four rows.

**Persona rows:**
- Each row: `flex items-start gap-4 py-5 border-b border-[var(--border-default)]/60 last:border-b-0`.
- Icon container: `inline-flex size-10 items-center justify-center rounded-lg bg-[var(--brand-primary-light)] shrink-0` with the lucide icon at `size-5 text-[var(--brand-primary)]`.
- Text: persona label (`text-base font-semibold text-[var(--text-primary)]`) + one-line value statement (`text-sm text-[var(--text-secondary)]`).

**Persona data (as `as const`):**

```typescript
const PERSONAS = [
  { icon: Rocket,         label: "Founders",         value: "Capture every discovery call so investor and product decisions are evidence-backed, not memory-based." },
  { icon: TrendingUp,     label: "Sales",            value: "Turn prospect objections and competitor mentions into shared institutional memory the next deal can use." },
  { icon: HeartHandshake, label: "Customer Success", value: "Spot churn signals across QBRs and check-ins before they become churn." },
  { icon: Map,            label: "Product Managers", value: "Back the roadmap with what clients actually said, not what someone remembered three weeks later." },
] as const;
```

**Scroll reveal:**
- Single `useScrollReveal` instance attached to the row stack container.
- All four rows fade in together (no per-row stagger). The section is compact — staggering would be overkill.

#### `app/_components/landing-page.tsx` (modify)

1. Remove `MessageSquareText`, `Sparkles`, `BarChart3`, `Brain` from the lucide import — they move to `landing-features-bento.tsx` along with the FEATURES array.
2. Delete the FEATURES `as const` data block (lines ~26–58) — moves to the bento component.
3. Delete the `featuresReveal` variable in the component body — no longer used.
4. Delete the inline features `<section>` block (lines ~196–232) — replaced by `<LandingFeaturesBento />`.
5. Render `<LandingFeaturesBento />` and `<LandingPersonas />` in sequence between the product showcase and the how-it-works section.

The `Sparkles` icon import is preserved because the hero pill badge still uses it. `Target`, `ArrowRight`, `Mail`, `Github`, `Linkedin` are also preserved — bottom CTA, footer, and social links still consume them. `LucideIcon` type is preserved for the SOCIAL_LINKS typing.

### Implementation Increments

#### Increment 1: Bento features grid

1. Create `landing-features-bento.tsx`: section shell, FEATURES array (moved), 3×2 grid with hero spanning rows and "Ask Data" spanning columns, hero corner glow, scroll-reveal stagger.
2. Wire into `landing-page.tsx`: remove the inline features section, the FEATURES array, the four moved icon imports, and the `featuresReveal` variable. Render `<LandingFeaturesBento />` between the product showcase and the how-it-works section.
3. Verify: `npx tsc --noEmit`. Visual sanity at desktop and mobile widths — bento collapses to single column on mobile, hero is visibly emphasised on desktop.

#### Increment 2: Personas strip

1. Create `landing-personas.tsx`: section shell, PERSONAS data array, four-row vertical stack with icon containers, scroll reveal.
2. Wire into `landing-page.tsx`: render `<LandingPersonas />` immediately after `<LandingFeaturesBento />`.
3. Verify: `npx tsc --noEmit`. Visual sanity — section is short (not full-viewport), readable on mobile.

#### Increment 3: Verify + docs

1. `npx tsc --noEmit` clean.
2. `npm run lint` — confirm no new errors versus the post-Part-1 baseline.
3. `ARCHITECTURE.md`: extend the landing-page core-features bullet to mention the bento layout and personas strip; add the two new component files to the file map.
4. `CHANGELOG.md`: new entry under PRD-030 Part 2.

---

## Part 3: Contact Section with Working Form

> Implements **P3.R1–P3.R12** from PRD-030.

### Overview

Add a Contact section above the existing footer with a real working form. The form is a 3-field react-hook-form + zod composition (Name, Email, Message) that POSTs to a new public `/api/contact` route. The route validates input with Zod, enforces a per-IP rate limit, silently absorbs honeypot submissions, persists each successful submission to a new `contact_submissions` table (RLS denies all client reads), and triggers an email notification to the operator via the existing Resend email service. On success the form is replaced inline by a confirmation message; on failure a toast appears and the form re-enables for retry. The fixed nav gains a "Contact" anchor link that scrolls to the section.

The contact backend is the only new server surface introduced by PRD-030. Everything else in the PRD is presentational. To minimise risk, the backend is built first (Increment 1: schema + service), wired second (Increment 2: route + middleware), and presented third (Increment 3: UI). This ordering means the API can be tested with `curl` before any UI exists, which catches RLS, schema, and email-send issues earlier.

### Dependencies (npm)

None. Reuses:
- `react-hook-form` + `@hookform/resolvers/zod` (already in use across auth pages and the prompt editor).
- `zod` (already in use everywhere).
- The existing Resend email service (already wired for team invitations — `lib/email/email-service.ts` or equivalent).

### Database Changes

New table: `contact_submissions`. Migration file: `docs/030-landing-page-polish/001-contact-submissions.sql`.

**Schema:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `name` | `text` | not null, length ≤ 100 enforced at DB via `check (char_length(name) <= 100)` |
| `email` | `citext` | not null, length ≤ 254 (RFC 5321) |
| `message` | `text` | not null, length ≤ 2000 |
| `user_agent` | `text` | nullable — captured from the request `User-Agent` header |
| `ip_address` | `inet` | nullable — best-effort from forwarded headers |
| `created_at` | `timestamptz` | not null, default `now()` |

**RLS:**
- Enable RLS.
- Single SELECT policy: `using (false)` — no anon or authenticated user can read submissions. Only the service-role client (used by the API route's persistence call) bypasses RLS.
- No INSERT policy at the role level either — the API route uses the service-role client, which bypasses RLS. Anonymous client-side inserts are denied.

**Indexes:**
- `(created_at desc)` — for the operator's eventual admin UI (deferred to backlog) to read the most recent submissions efficiently.
- No email or name index — there is no query path that needs them at this scale.

**`citext` extension:** if not already enabled in the project's Supabase schema, the migration enables it (`create extension if not exists citext`). The email column is case-insensitive so duplicate detection (if added later) treats `Burhan@x.com` and `burhan@x.com` as the same address.

### API Endpoints

#### `POST /api/contact` (new)

**Request:** `application/json`

```typescript
{
  name: string,        // 1-100 chars
  email: string,       // valid email per zod's email() validator
  message: string,     // 1-2000 chars
  website?: string,    // honeypot field — must be empty or undefined
}
```

**Validation:** Zod schema in `lib/schemas/contact-schema.ts`. Reused by the form (client) and the route (server).

**Rate limit:** Per IP, 5 submissions per 10 minutes. In-memory `Map<ip, { count, windowStart }>` keyed by `getClientIp(request)` — pulled from `x-forwarded-for` (Vercel-aware) with a fallback to a synthetic key when the IP is unavailable. On limit breach, returns `429` with `{ message: "Too many submissions — please wait a few minutes and try again." }`. The map is process-local; on a serverless platform, instances may have independent counters. This is acceptable: a determined attacker would still hit roughly N×5 submissions across N instances per window, which is small enough to absorb. CAPTCHA upgrade is on the backlog if abuse becomes real.

**Honeypot:** If the `website` field is non-empty, the route logs the attempt (level info), returns a 200 with the same success body that real submissions return, and does NOT persist or email. Bots that fill every field believe they succeeded; humans never see the field (it is `display: none` and `tab-index="-1"` in the form).

**Payload size cap:** Next.js route handlers can read request bodies of arbitrary size by default. The route reads the body once via `request.json()`. Zod's max-length validators on each string field (100, 254, 2000) bound the persisted payload. To guard against abusive payloads, the route checks `request.headers.get("content-length")` first and rejects with 413 if it exceeds 10 KB. This is a defence-in-depth measure; the field-level zod limits are the primary bound.

**Persistence:** Calls `contactService.persistSubmission({ name, email, message, userAgent, ipAddress })` which uses the service-role Supabase client to insert.

**Email notification:** After successful persistence, calls `contactService.notifyOperator({ name, email, message })` which composes a plain-text email via the existing Resend service. The email body is `"From: ${name} <${email}>\n\n${message}"`. Reply-to header is set to the submitter's email so the operator can reply directly from their inbox. If the email send fails (Resend 4xx/5xx, network error), the failure is logged at error level but the API response still succeeds — the submission is durably persisted; the operator can recover the message from the database.

**Logging:** Per CLAUDE.md, the route logs:
- entry with redacted input (`name length: N, email domain: x@<domain>, message length: N`),
- exit with outcome (`persisted id: <uuid>, email status: sent | failed`),
- errors with stack traces.

The submitter's full email is logged at debug level only — info/error levels redact the local part.

**Response:**
- 200 `{ message: "Thanks — we'll get back to you within one business day." }` on success (and on honeypot).
- 400 with field-level zod errors on validation failure.
- 413 on oversized payload.
- 429 on rate limit.
- 500 on persistence failure.

### Design Token Changes

None. Form fields use the existing `Input`, `Textarea`, `Button`, and `Label` shadcn primitives.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/030-landing-page-polish/001-contact-submissions.sql` | **Create** | Migration: enable citext, create `contact_submissions` table, enable RLS with deny-all SELECT, create index. |
| `lib/schemas/contact-schema.ts` | **Create** | Shared Zod schema consumed by the form and the route. |
| `lib/services/contact-service.ts` | **Create** | `persistSubmission()` (service-role insert) + `notifyOperator()` (Resend email composition). |
| `app/api/contact/route.ts` | **Create** | Public POST: Zod validate, rate limit, honeypot absorb, content-length check, persist, notify, respond. |
| `middleware.ts` | **Modify** | Add `/api/contact` to the public-route allowlist so unauthenticated POSTs are not redirected to `/login`. |
| `app/_components/landing-contact-section.tsx` | **Create** | Section shell, two-column desktop layout, left pitch panel, right form, success-state swap. |
| `app/_components/landing-contact-form.tsx` | **Create** | The form itself — useForm + zodResolver, submit handler, loading/error/success states, honeypot input. |
| `app/_components/landing-page.tsx` | **Modify** | Add "Contact" anchor link in the nav, render `<LandingContactSection id="contact" />` between the bottom CTA and the footer. |
| `lib/types/database.types.ts` | **Modify** | Regenerate via `supabase gen types typescript` after the migration runs (CLAUDE.md). |

### Frontend Components

#### `lib/schemas/contact-schema.ts` (new)

```typescript
import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().trim().email("Enter a valid email").max(254, "Email too long"),
  message: z.string().trim().min(1, "Message is required").max(2000, "Message too long"),
  website: z.string().max(0).optional(), // honeypot — must be empty
});

export type ContactInput = z.infer<typeof contactSchema>;
```

#### `app/_components/landing-contact-form.tsx` (new)

`"use client"`. Uses `useForm<ContactInput>({ resolver: zodResolver(contactSchema), defaultValues: { name: "", email: "", message: "", website: "" } })` per CLAUDE.md.

**State machine:** `type FormState = 'idle' | 'submitting' | 'success' | 'error'` (discriminated union per CLAUDE.md TypeScript Patterns).

**On submit:** transition `idle → submitting`, POST to `/api/contact`, on 200 transition to `success` and render the confirmation panel inline; on non-200 transition to `error` and surface a toast (existing `sonner` `toast.error()`), then transition back to `idle`.

**Honeypot input:** `<input type="text" {...register("website")} aria-hidden="true" tabIndex={-1} className="absolute left-[-9999px] opacity-0" />`. Off-screen and not focusable; bots filling every field hit it.

**Field rendering:** uses shadcn `Label` + `Input` for name/email; `Label` + `Textarea` for message. Inline error text below each field driven by `errors.<field>?.message`.

**Submit button:** `type="submit"`, disabled when `isSubmitting`, label switches to "Sending…" with a small spinner.

**Success panel:** when state is `success`, the form is unmounted and replaced inline by a centered panel: a `Mail` icon in a brand-light circle, "Thanks — we'll get back to you within one business day", and a small "Send another" link that resets the form to `idle`.

#### `app/_components/landing-contact-section.tsx` (new)

`"use client"`. Composes the section shell and renders the form.

**Section shell:** `<section id="contact" className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-[var(--surface-raised)]">` — full-viewport, raised surface for visual contrast with the footer.

**Two-column desktop layout:** `grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl mx-auto px-6`:
- **Left:** heading "Have a question? Want a walkthrough?", a one-paragraph pitch, and an "Or reach out directly" block listing the operator's email (`mailto:` link) and an optional "Book time" Calendly link if a `NEXT_PUBLIC_CALENDLY_URL` env is set (graceful absence if not).
- **Right:** the `<LandingContactForm />`.

**Scroll reveal:** uses `useScrollReveal` on the grid container; both columns fade in together.

#### `app/_components/landing-page.tsx` (modify)

1. **Nav anchor:** add a "Contact" link in the existing nav between the "Synthesiser" wordmark and the "Get Started" CTA. The link is an in-page anchor (`<a href="#contact">`) — uses native smooth-scroll because `html { scroll-behavior: smooth }` is enabled (or will be added globally if not).
2. **Render the contact section:** `<LandingContactSection />` is rendered between the bottom CTA section and the footer. The section's outer element exposes `id="contact"` so the nav anchor lands correctly.

### Service Layer

#### `lib/services/contact-service.ts` (new)

Two pure functions, no class. Imported by the route handler.

```typescript
export async function persistSubmission(input: PersistInput): Promise<{ id: string }> {
  // Service-role Supabase client → insert into contact_submissions → return { id }.
  // Logs entry, exit, errors with stack.
}

export async function notifyOperator(input: NotifyInput): Promise<{ status: "sent" | "failed" }> {
  // Build plain-text body, call existing Resend email service with reply-to header,
  // return status. Never throws — caller decides.
  // Logs entry, exit, errors with stack.
}
```

The service is deliberately split into two functions, not one combined "submit" — this matches CLAUDE.md's Single Responsibility principle. The route orchestrates the two calls; either failure mode is observable independently in logs.

### Implementation Increments

#### Increment 1: contact_submissions migration + service

1. Write the SQL migration at `docs/030-landing-page-polish/001-contact-submissions.sql`. User runs it against the dev DB.
2. After migration runs, regenerate Supabase types (`supabase gen types typescript`) and commit `lib/types/database.types.ts`.
3. Create `lib/services/contact-service.ts` with `persistSubmission` and `notifyOperator`. No route yet — verify with a one-off scratch test if desired.

#### Increment 2: /api/contact route + middleware

1. Create `app/api/contact/route.ts` with full validation, rate limit, honeypot, content-length check, persist + notify orchestration, structured logging.
2. Create `lib/schemas/contact-schema.ts`.
3. Update `middleware.ts` to allow unauthenticated `POST /api/contact`.
4. Manual `curl` test: valid submission → 200, persisted, email sent. Invalid email → 400. Honeypot fill → 200 silent. Rate-limit breach → 429.

#### Increment 3: Contact section UI + form

1. Create `app/_components/landing-contact-form.tsx` with react-hook-form + zod, state machine, honeypot, success/error states.
2. Create `app/_components/landing-contact-section.tsx` with two-column layout, pitch panel, form.
3. Modify `landing-page.tsx`: add nav "Contact" anchor, render the contact section between the bottom CTA and the footer.

#### Increment 4: Verify + docs

1. `npx tsc --noEmit` clean.
2. `npm run lint`.
3. End-to-end manual flow: submit on `/`, verify row in DB, verify email arrives in operator inbox.
4. `ARCHITECTURE.md`: add `contact_submissions` to the database tables list, add the new files to the file map, add `/api/contact` to the API routes section.
5. `CHANGELOG.md`: new entry under PRD-030 Part 3.

---

## Part 4: Footer Expansion and Final Polish

> Implements **P4.R1–P4.R8** from PRD-030.

### Overview

Two distinct workstreams in one part:

1. **Footer expansion.** Extract the inline footer from `landing-page.tsx` into its own component (`landing-footer.tsx`) and convert it from a single horizontal row into a three-column desktop layout: wordmark + product tagline + developer credits on the left, in-page quick links in the middle, social icons + theme toggle on the right. On mobile the columns stack vertically.

2. **End-of-PRD polish + audit.** A pre-merge sweep that runs the full CLAUDE.md end-of-PRD audit checklist over every file touched by PRD-030 (Parts 1–4), verifies the page renders correctly across `320 / 375 / 414 / 768 / 1024 / 1440` viewport widths in both light and dark mode, audits scroll-reveal animation timing across adjacent sections, and re-verifies that every PRD-015 acceptance criterion still passes.

The audit produces fixes, not a report (per CLAUDE.md).

### Dependencies (npm)

None.

### Database Changes

None.

### API Endpoints

None.

### Design Token Changes

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/_components/landing-footer.tsx` | **Create** | Three-column footer extracted from `landing-page.tsx`. Owns SOCIAL_LINKS (moved from `landing-page.tsx`) since the footer is the only consumer. |
| `app/_components/landing-page.tsx` | **Modify** | Remove the inline footer (lines ~339–360), the SOCIAL_LINKS array, and the `Mail`/`Github`/`Linkedin` icon imports — they all move to the footer component. Render `<LandingFooter />` in their place. |

The audit step may produce additional file changes — those land under their respective Part 1/2/3 component files.

### Frontend Components

#### `app/_components/landing-footer.tsx` (new)

`"use client"` — needs to be a client component because it composes `<ThemeToggle />` (which is already a client component).

**Structure:**

```
<footer>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto px-6 py-12">
    {/* Left: brand */}
    <div>
      <span className="font-bold">Synthesiser</span>
      <p>One-line product tagline</p>
      <p>Developed by Burhanuddin C</p>
    </div>

    {/* Middle: quick links */}
    <nav>
      <ul>
        <li><a href="#features">Features</a></li>
        <li><a href="#how-it-works">How It Works</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>

    {/* Right: social + theme */}
    <div className="flex md:justify-end items-center gap-4">
      {SOCIAL_LINKS.map(...)}
      <ThemeToggle />
    </div>
  </div>
</footer>
```

**Anchor targets:** the features section gets `id="features"` added (currently has no id), how-it-works already has `id="how-it-works"` from PRD-015, contact gets `id="contact"` from Part 3.

**Typography + tokens:** `text-sm text-[var(--text-muted)]` for body text, `text-base font-bold text-[var(--text-primary)]` for the wordmark, hover `text-[var(--text-primary)]` for links. No new tokens.

**Mobile:** columns stack vertically via `grid-cols-1 md:grid-cols-3`. Padding adjusts (`py-12 md:py-16`) so mobile is comfortable but not wasteful.

#### `app/_components/landing-page.tsx` (modify)

1. Remove `Mail`, `Github`, `Linkedin` from the lucide import.
2. Remove the `SOCIAL_LINKS` array (lines ~78–82).
3. Remove the inline `<footer>` block (lines ~339–360).
4. Render `<LandingFooter />` in place of the inline footer.
5. Add `id="features"` to the `<section>` rendered by `<LandingFeaturesBento />` — this is done by passing it as a prop or by the bento exposing the id internally. The simpler path is to add the id at the top-level `<section>` inside `landing-features-bento.tsx`.

### End-of-PRD Audit Workstream

This is the second half of Part 4. It produces fixes inline (not a report) per CLAUDE.md.

**Audit checklist (full CLAUDE.md end-of-part audit + end-of-PRD checklist):**

1. **SRP** — each new component does one thing (showcase, bento, personas, contact section, contact form, footer). Confirmed by file size + scope; flag and split if any file exceeds ~200 LOC of meaningful logic.
2. **OCP** — adding a fifth feature card or fifth persona is an array entry, not a layout change.
3. **ISP** — no optional flags or fields with single callers across the new component props.
4. **DIP** — components consume props (FEATURES, PERSONAS arrays passed in or owned locally), not global state.
5. **DRY** — `useScrollReveal` is shared across sections (Part 1 set this up). Verify no duplicated card-render functions or chip-render logic across files.
6. **YAGNI** — no speculative extensibility hooks. Verify the `id` props on sections and the env-driven Calendly URL are the only "configurability" surfaces — anything else is over-engineering.
7. **Fail explicitly** — the contact route's catch blocks log before responding; the contact-service email failure logs at error level even though the response is 200 (intentional, documented).
8. **Design tokens** — grep new files for `text-white`, raw hex, raw `oklch(...)`, raw `rgb(...)`. Replace with token references if found.
9. **Logging** — every route and service function logs entry, exit, and errors with stack traces.
10. **Dead code** — verify the four icon imports moved to bento and the three icon imports moved to footer are no longer in `landing-page.tsx`. Verify FEATURES and SOCIAL_LINKS arrays are not duplicated anywhere.
11. **Convention compliance** — kebab-case files, PascalCase components, camelCase + Schema for Zod, named exports, import order per CLAUDE.md.

**Visual checks (manual, with dev server running):**

- Light mode: every section renders correctly at 320/375/414/768/1024/1440.
- Dark mode: same widths. The product showcase image stays light-themed in dark mode (P4.R4 — explicit decision).
- Scroll-reveal timing: scrolling continuously through hero → showcase → bento → personas → how-it-works → CTA → contact → footer should feel orchestrated. If two adjacent sections trigger reveal at the same scroll position and create a chaotic feel, adjust timing.
- Anchor links: clicking nav "Contact" and footer "Features" / "How It Works" / "Contact" smoothly scrolls to the target section.
- Form: submit a real test message; verify DB row, verify email lands in operator inbox.

**PRD-015 regression check:**

Re-verify P1.AC1–P1.AC13 from PRD-015 still pass after PRD-030's changes:
- AC1–AC2 (auth-aware redirect) — unchanged code path; smoke test by visiting `/` while authenticated and unauthenticated.
- AC3 (AppHeader/AppFooter hidden on `/`) — unchanged; visual check.
- AC4 (hero with gradient text + pill badge + CTA) — unchanged.
- AC5 (four feature cards) — STILL FOUR cards, just in a bento — verify count + content unchanged.
- AC6 (3-step how-it-works) — unchanged.
- AC7 (bottom CTA, no animation) — unchanged.
- AC8 (no hardcoded colours) — re-grep PRD-030 component files.
- AC9 (responsive) — manual mobile pass.
- AC10 (CTAs route to /login) — unchanged.
- AC11 (transparent → blur nav) — unchanged. Confirm the new nav anchor link does not break the scroll-state CSS.
- AC12 (footer credits + social icons) — STILL PRESENT in the new three-column footer.
- AC13 (scroll-reveal animations) — unchanged behaviour, more sections using the same pattern.

### Implementation Increments

#### Increment 1: Footer expansion

1. Create `landing-footer.tsx` with three-column desktop layout, anchor links to `#features`, `#how-it-works`, `#contact`, social icons, theme toggle.
2. Add `id="features"` to the bento component's outer `<section>`.
3. Modify `landing-page.tsx`: remove inline footer, SOCIAL_LINKS array, footer-only icon imports. Render `<LandingFooter />`.
4. Verify nav and footer anchors all resolve to live sections.

#### Increment 2: End-of-PRD audit

1. Run the audit checklist above. Each item that produces a fix is implemented inline (in the file that owns the issue).
2. Run `npx tsc --noEmit` and `npm run lint` final pass.
3. Update `ARCHITECTURE.md`: ensure file map covers every file landed by PRD-030 (Parts 1–4), update the landing-page core-features bullet to reflect the final shape (showcase + bento + personas + contact + 3-col footer).
4. Update `CHANGELOG.md`: new entry under PRD-030 Part 4 capturing the footer changes and the audit fixes.

---

## Part 3: Contact Section with Working Form

> Implements **P3.R1–P3.R12** from PRD-030. **TRD content to be written when Parts 1–2 ship and Part 3 begins.**

Anticipated shape (subject to refinement):
- New table: `contact_submissions` (RLS-enabled, service-role-only reads).
- New service: `lib/services/contact-service.ts` (persistence + Resend email composition, reusing the existing email service already wired for team invitations).
- New API route: `app/api/contact/route.ts` (public POST, Zod validation, rate limiting, honeypot handling).
- Middleware update: `/api/contact` added to the public routes allowlist.
- New components: `app/_components/landing-contact-section.tsx`, `app/_components/landing-contact-form.tsx`.
- Nav update in `landing-page.tsx`: add a "Contact" anchor link.

---

## Part 4: Footer Expansion and Final Polish

> Implements **P4.R1–P4.R8** from PRD-030. **TRD content to be written when Parts 1–3 ship and Part 4 begins.**

Anticipated shape (subject to refinement):
- New component: `app/_components/landing-footer.tsx` (extracted from the inline footer in `landing-page.tsx`).
- Three-column layout, anchor links to in-page sections.
- Cross-cutting verification: dark mode pass, animation timing audit, mobile-width walkthrough, PRD-015 acceptance regression check.
- No new tokens, no backend.
