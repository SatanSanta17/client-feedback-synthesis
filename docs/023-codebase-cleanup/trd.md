# TRD-023: Codebase Cleanup

> **Note on scope.** This TRD is being written one part at a time per CLAUDE.md. Only Part 1 is detailed below; Parts 2–10 will be drafted as each preceding part lands. Forward-compatibility notes inside Part 1 reference later parts where relevant.

---

## Part 1 — Quick Wins

This part covers P1.R1 through P1.R6 from the PRD. Six independent fixes grouped into one part because each is small, isolated, and low-risk; they share no shared module.

**Database models:** None.
**API endpoints:** One status-code change to `PATCH /api/teams/[teamId]/members/[userId]/role`.
**Frontend pages/components:** Sidebar, landing page, team-members table, two dashboard widgets, and a handful of files that use template-literal classNames.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Delete dead code | 2 file deletions | tiny |
| 2 | Theme toggle consolidation | 1 component change + 2 callers | small |
| 3 | Role-update conflict response | 1 route + 1 caller | small |
| 4 | Template-literal classNames → `cn()` | 5 files | small |
| 5 | Chart hex centralization | 2 widgets + 1 constants file | small |
| 6 | `any` annotation audit | grep + targeted fixes | small |

Each increment is independently shippable and can be a separate PR. They can also be bundled into one PR if the diff stays reviewable.

---

### Increment 1 — Delete dead code (P1.R1, P1.R2 prerequisite check)

**What:** Remove the empty `_helpers.ts` API helper file. (The `theme-toggle.tsx` deletion proposed earlier is *no longer correct* — Increment 2 keeps the file and adopts it instead.)

**Files changed:**

| File | Action |
|------|--------|
| `app/api/sessions/_helpers.ts` | **Delete** — 0-byte file, no imports reference it |

**Verify:**

- `grep -r "sessions/_helpers" .` returns no hits.
- `npx tsc --noEmit` passes.
- `npm run build` passes.

**Forward compatibility:** None. This is a pure cleanup.

---

### Increment 2 — Theme toggle consolidation (P1.R2)

**What:** Replace the two inline theme toggles (sidebar + landing footer) with the existing shared `ThemeToggle` component. The shared component becomes the single source of truth for the icon, aria-label, and toggle behaviour.

**Files changed:**

| File | Action |
|------|--------|
| `components/layout/theme-toggle.tsx` | **Modify** — minor: ensure `className` propagation supports both call sites (already does); confirm no functional change needed |
| `components/layout/app-sidebar.tsx` | **Modify** — replace the inline `<button onClick={onThemeToggle}>` block (around line 220–235) with `<ThemeToggle className="..." />` |
| `app/_components/landing-page.tsx` | **Modify** — replace the inline `<button>` block (lines 368–375) with `<ThemeToggle className="..." />`; remove the now-unused `useTheme()` call (line 121), `setTheme`/`theme` references, and the `Sun`/`Moon` imports if unused elsewhere in the file |

**Implementation details:**

1. **Sidebar (`app-sidebar.tsx`).** The current implementation accepts an `onThemeToggle` callback prop drilled through `SidebarContent`. Replace the prop drill with direct rendering of `<ThemeToggle />` inside `SidebarContent`. Drop `onThemeToggle` from `SidebarContentProps` and from the parent `AppSidebar` (it no longer needs `useTheme()` either — the shared component owns that hook). The wrapper element keeps the same Tailwind classes for layout (positioning + opacity transitions when collapsed). The `aria-label` and icon swap come from the shared component, so the existing inline `aria-label` lines are removed.

2. **Landing page (`landing-page.tsx`).** Replace the inline `<button type="button" onClick={() => setTheme(...)}>` (lines 368–375) with `<ThemeToggle className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />`. Remove the `useTheme()` import and its destructure on line 121 if no other usage remains in the file. Remove `Sun` and `Moon` from the lucide imports if they have no other usage in the file (they are only used by the inline toggle).

3. **Shared component (`theme-toggle.tsx`).** No code change required — it already accepts `className` and uses `useTheme()`. Confirm only that the rendered `<Button variant="ghost" size="icon">` styling visually matches what the landing footer needs; if the footer specifically requires a non-Button look (it currently renders a bare `<button>` styled like an icon), the shared component is acceptable because `Button variant="ghost" size="icon"` is visually equivalent to a bare icon button — this is verified in the manual smoke test below, not changed in code.

**Verify:**

- `grep -rn "setTheme(theme === \"dark\" ? \"light\" : \"dark\")" app components` returns only the line inside `theme-toggle.tsx`.
- Sidebar (desktop expanded, desktop collapsed, mobile drawer) shows the toggle button and switching theme works in all three modes.
- Landing-page footer toggle still toggles theme and shows the correct icon for the current mode.
- No visual regression on either surface (compare side-by-side before/after).
- `npx tsc --noEmit` passes.

**Forward compatibility:** Future surfaces that need a theme switch (settings page, mobile-only menu, etc.) reuse `<ThemeToggle />` directly. The `className` passthrough is the extension point; no further API on `ThemeToggle` is needed.

---

### Increment 3 — Role-update conflict response (P1.R3)

**What:** Change the role-update route to return `409 Conflict` with a descriptive message when the requested role equals the current role. Update the frontend caller to surface this as a warning toast (not a success toast and not a generic error toast).

**API change:**

| Endpoint | Before | After |
|---|---|---|
| `PATCH /api/teams/[teamId]/members/[userId]/role` | `200 { message: "Role unchanged" }` when target role equals current | `409 { message: "Member already has role 'admin'" }` (role name interpolated from `targetMember.role`) |

**Files changed:**

| File | Action |
|------|--------|
| `app/api/teams/[teamId]/members/[userId]/role/route.ts` | **Modify** — line 93–95: change response to 409 with a templated message |
| `app/settings/_components/team-members-table.tsx` | **Modify** — `handleRoleChange` (line 146–166): branch on `res.status === 409` and call `toast.warning(...)` instead of `toast.error(...)` |

**Implementation details:**

1. **Route change (`role/route.ts`).** Replace lines 93–95:

   ```ts
   if (targetMember.role === parsed.data.role) {
     return NextResponse.json({ message: "Role unchanged" });
   }
   ```

   with:

   ```ts
   if (targetMember.role === parsed.data.role) {
     return NextResponse.json(
       { message: `Member already has role '${targetMember.role}'` },
       { status: 409 }
     );
   }
   ```

   The message format is single-quoted around the role for human readability (`'admin'`, `'sales'`). No other route logic changes.

2. **Frontend caller (`team-members-table.tsx`).** The current `handleRoleChange` (line 146) catches `!res.ok` and re-throws as `Error`, which lands in `toast.error(err.message)`. Branch on the status before throwing:

   ```ts
   if (!res.ok) {
     const body = await res.json().catch(() => ({}));
     if (res.status === 409) {
       toast.warning(body.message ?? "Role unchanged");
       return;
     }
     throw new Error(body.message ?? "Failed to change role");
   }
   ```

   `toast.warning` is already used elsewhere in the codebase (`invite-single-form.tsx:44`, `invite-bulk-dialog.tsx:66`) — sonner supports it as a first-class variant. The early `return` skips the success toast and the `onMemberChanged()` / `fetchMembers()` calls because no change occurred.

3. **Logging.** Add an `info`-level log on the server side when the no-op branch is hit, for observability:

   ```ts
   console.log(
     `[api/teams/[teamId]/members/[userId]/role] PATCH — no-op: target already has role '${targetMember.role}'`
   );
   ```

**Verify:**

- Manual: change a member's role to their existing role → warning toast appears with `Member already has role 'admin'` (or the correct role); no server-side error log; no `onMemberChanged` triggered.
- Manual: change a member's role to a different role → success toast as before; member-list refreshes.
- Manual: trigger a real failure (e.g., revoke owner privilege server-side) → error toast as before.
- DevTools network: 409 response, JSON body has `message`.
- `npx tsc --noEmit` passes.

**Forward compatibility:** This establishes the convention `409 Conflict + descriptive message + toast.warning` for idempotent no-ops on PATCH/PUT routes. **Part 2** will likely consolidate this pattern into a shared route-helper (e.g., `idempotentNoOp(message)` returning the standard 409 response). When other no-op cases surface (Part 9 cleanups, future PRDs), the same pattern applies. The current change introduces only the one-call-site usage; the helper extraction is deferred to Part 2 and is a non-breaking refactor.

---

### Increment 4 — Template-literal classNames → `cn()` (P1.R4)

**What:** Replace every backtick-interpolated `className` with a `cn()` call so Tailwind class-merge semantics are consistent.

**Files changed:**

| File | Locations |
|------|-----------|
| `app/layout.tsx` | line 41 (html className) |
| `app/capture/_components/prompt-version-filter.tsx` | line 65 |
| `app/capture/_components/session-table-row.tsx` | lines 58–60 |
| `app/chat/_components/message-thread.tsx` | lines 29–30 |
| `app/invite/[token]/_components/invite-shell.tsx` | lines 70–72 |

**Implementation pattern:**

For each occurrence, the rewrite is mechanical — replace `` className={`<base-classes> ${cond ? "<a>" : "<b>"}`} `` with `className={cn("<base-classes>", cond ? "<a>" : "<b>")}`. Where the conditional class is empty (`isActive ? "..." : ""`), use `cn("<base>", isActive && "<a>")` to drop the empty branch.

**Per-file specifics:**

1. **`app/layout.tsx:41`** — the html element's className mixes a fixed font class with a conditional theme class. Use `cn()`; ensure the result is identical at runtime.

2. **`prompt-version-filter.tsx:65`** — `` `flex items-center gap-2 ${className ?? ""}` ``. Rewrite as `cn("flex items-center gap-2", className)`. `cn` handles `undefined` correctly so the `?? ""` becomes unnecessary.

3. **`session-table-row.tsx:58–60`** — multi-line conditional className for an expandable row. Migrate to `cn()` with each line as a separate argument; preserve the conditional branches.

4. **`message-thread.tsx:29–30`** — spinner div className with a conditional visibility class. Same pattern.

5. **`invite-shell.tsx:70–72`** — `StatusIcon` element className with status-based variant. Same pattern.

**Verify:**

- `grep -rn 'className={\`' app components` returns zero hits.
- Manual smoke on each surface: page renders identically; conditional classes still apply (active-row highlight, spinner visibility, status-icon colour).
- `npx tsc --noEmit` passes.

**Forward compatibility:** None — convention is already documented in CLAUDE.md, this just brings the codebase into compliance.

---

### Increment 5 — Chart hex centralization (P1.R5)

**What:** Move inline hex values in two dashboard widgets into named constants in `chart-colours.ts`.

**Files changed:**

| File | Action |
|------|--------|
| `app/dashboard/_components/chart-colours.ts` | **Modify** — add new named constants (see below) |
| `app/dashboard/_components/session-volume-widget.tsx` | **Modify** — lines 120–121: replace `"#6366f1"` with `BRAND_PRIMARY_HEX` |
| `app/dashboard/_components/theme-client-matrix-widget.tsx` | **Modify** — line 239: replace `"#fff"` with named constant |

**Implementation details:**

1. **`chart-colours.ts` additions.** `BRAND_PRIMARY_HEX = "#6366f1"` already exists (line 7) — `session-volume-widget.tsx` references it as a string instead. Just import.

   For the matrix widget's `"#fff"`, add a named constant:

   ```ts
   /** Foreground colour for chart cells with high background opacity. White ensures
    *  AAA contrast against the brand-primary fill at opacity > 0.5. */
   export const CHART_HIGH_CONTRAST_TEXT_HEX = "#ffffff";
   ```

   Use `#ffffff` (six-digit form) for consistency with the rest of the file.

2. **`session-volume-widget.tsx`.** Add `BRAND_PRIMARY_HEX` to the import from `./chart-colours`. Replace the two literal `"#6366f1"` strings on lines 120–121 with `BRAND_PRIMARY_HEX`.

3. **`theme-client-matrix-widget.tsx`.** Add `CHART_HIGH_CONTRAST_TEXT_HEX` to the import (already imports `BRAND_PRIMARY_RGB`). Replace `"#fff"` on line 239 with `CHART_HIGH_CONTRAST_TEXT_HEX`.

**Verify:**

- `grep -rn '#6366f1\|#fff\|#FFF' app/dashboard/_components/` returns only matches inside `chart-colours.ts`.
- Both widgets render identically (compare screenshots before/after).
- `npx tsc --noEmit` passes.

**Forward compatibility:** Future widget additions reference named constants from `chart-colours.ts`. If the brand palette changes, the swap is a single-file edit. CLAUDE.md's "design tokens" rule explicitly covers chart colours via this module.

---

### Increment 6 — `any` annotation audit (P1.R6)

**What:** Verify every `: any` in the repository either has a preceding `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>` comment or is replaced with a concrete type. The audit is mostly verification — most occurrences already have justifications — but a few need attention.

**Files to audit:**

A repo-wide grep produces these candidates (verified during this TRD draft):

| File | Line | Status |
|------|------|--------|
| `app/dashboard/_components/top-themes-widget.tsx` | 53 (`payload?: any[]`) | ✅ Already justified (line 52) — no action |
| `lib/repositories/supabase/scope-by-team.ts` | 17 (`<T extends { eq: any; is: any }>`) | ✅ Already justified (line 16) — no action |
| `lib/repositories/supabase/supabase-conversation-repository.ts` | 22 (`function toConversation(row: any)`) | ⚠️ Verify justification; add comment if missing |
| `lib/repositories/supabase/supabase-message-repository.ts` | 23 (`function toMessage(row: any)`) | ⚠️ Verify justification; add comment if missing |
| `lib/services/database-query-service.ts` | 252, 272, 284, 339, 396 | ⚠️ Verify justifications; add comments if missing (Note: this file is fully replaced in Part 5; consider deferring) |
| `lib/services/insight-service.ts` | 211 (`let query: any = supabase`) | ⚠️ Verify justification; add comment if missing |

**Implementation details:**

1. **For each `⚠️` row above:** read the file, check whether the line above the `any` has a `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>` comment. If not, add one with a one-sentence reason. Reasons should be honest:

   - For Supabase row mappers: `Supabase generated row types vary across query shapes; mapping to a domain type is the narrowing step` or similar.
   - For dynamically-built query builders: `Supabase query builder types narrow per-call; broader typing here would force a cast on every chain`.

2. **For `database-query-service.ts`:** this file is the subject of Part 5 (the 2,036-LOC split). Adding comments to lines that will be moved or rewritten is wasted effort. **Defer the `any` audit on this file to Part 5** — the new domain modules will be written with proper annotations from the start. Document this decision inline in the file with a single TODO comment if helpful, or just note it in the CHANGELOG entry.

3. **Lint enforcement (optional, deferred to backlog).** Adding `@typescript-eslint/no-explicit-any` as `error` in `eslint.config.mjs` would prevent regressions. Not in scope for Part 1 — would require fixing every legitimate `any` first, which Part 5 partially addresses.

**Verify:**

- `grep -rn ": any" app components lib --include="*.ts" --include="*.tsx"` and visually confirm that every match either has an eslint-disable on the preceding line, or is inside `database-query-service.ts` (deferred to Part 5).
- `npx tsc --noEmit` passes.
- `npm run lint` (if configured) shows no new warnings.

**Forward compatibility:** The convention is now: every `any` in the codebase carries a comment that explains why it can't be typed. Part 5 completes this for the query service. Future code follows the same rule.

---

## Part 1 — End-of-part audit checklist

Per CLAUDE.md, after the last increment of every part:

- [ ] **SRP.** Each touched file does one thing — no new responsibility added.
- [ ] **DRY.** No new duplication introduced (notably: the role-conflict response will be repeated if/when other routes need it; **Part 2** will extract the shared helper).
- [ ] **Design tokens.** No new hardcoded colours/sizes; `CHART_HIGH_CONTRAST_TEXT_HEX` follows the existing pattern.
- [ ] **Logging.** Role-route gains a no-op log line; no logging removed.
- [ ] **Dead code.** `_helpers.ts` removed. No new dead exports.
- [ ] **Convention compliance.** Naming, exports, import order all match.

After Part 1 completes:

- [ ] Update `ARCHITECTURE.md` if any structural reference changed (none expected for this part).
- [ ] Add a `CHANGELOG.md` entry for PRD-023 P1 listing the six increments.
- [ ] Run `npx tsc --noEmit` and `npm run build` for a final clean check.

---

## Forward references to later parts

These notes capture how Part 1 decisions feed Parts 2–10, so subsequent TRD parts inherit the right shape:

- **→ Part 2 (route helpers).** The 409 + descriptive-message pattern from Increment 3 should be reusable. Part 2's `route-auth-helpers.ts` (or a peer module) will likely include `idempotentNoOp(message: string)` returning the canonical 409 response. Migrating the role route to that helper is a Part 2 concern.
- **→ Part 5 (database-query-service split).** The `any` audit defers untouched lines in this file to Part 5, where the rewrite covers them organically.
- **→ Part 10 (docs refresh).** Removed file (`_helpers.ts`) and the new constant (`CHART_HIGH_CONTRAST_TEXT_HEX`) flow into the file map / Key Design Decisions update.
- **→ Backlog.** Linting `@typescript-eslint/no-explicit-any` as `error` is a candidate for the cleanup backlog; Part 1 establishes the convention, the lint rule enforces it.
