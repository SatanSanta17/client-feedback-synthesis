# TRD-023: Codebase Cleanup

> **Note on scope.** This TRD is being written one part at a time per CLAUDE.md. Parts 1–3 are detailed below; Parts 4–10 will be drafted as each preceding part lands. Forward-compatibility notes inside each part reference later parts where relevant.

---
# Part 1
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

---

# Part 2
## Part 2 — Shared Route Helpers (Auth, File Validation, Inline Queries)

This part covers P2.R1 through P2.R5. The 7-line `createClient → getUser → 401 → service-client → repo → role-check` block currently duplicated across ~15 API routes is collapsed into a small set of named helpers; file-upload validation duplicated across two routes is collapsed into one helper; the inline `profiles.can_create_team` query in `POST /api/teams` is moved into `team-service.ts`.

**Database models:** None.
**API endpoints:** ~15 routes migrated; no contract changes (status codes, error bodies, happy-path payloads, and logging granularity preserved per P2.R5).
**Frontend:** None.
**New modules:** `lib/api/route-auth.ts` (auth + team-context + session-context helpers), `lib/api/file-validation.ts` (upload constraints).

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | `requireAuth` foundation + types | 1 new file | small |
| 2 | Team-context helpers (`requireTeamMember`, `requireTeamAdmin`, `requireTeamOwner`) + `idempotentNoOp` | extend file 1 | small |
| 3 | `requireSessionAccess` helper | extend file 1 | tiny |
| 4 | File-validation helper | 1 new file | tiny |
| 5 | `canUserCreateTeam` moves into `team-service.ts` | 1 service + 1 route migration | small |
| 6 | Migrate team routes to helpers | ~9 routes | medium |
| 7 | Migrate session + attachment routes to helpers | ~5 routes | medium |
| 8 | Migrate AI + file-parse routes to helpers | 3 routes | small |

Increments 1–4 are pure additions (no callers yet) and are independently shippable. Increments 5–8 are the migration phase; each is independently shippable but should land sequentially so a single failed migration is easy to bisect. Increments 6–8 may be bundled if the diff stays reviewable.

---

### Increment 1 — `requireAuth` foundation (P2.R1)

**What:** Create `lib/api/route-auth.ts` with the auth-context types and `requireAuth()`. No callers yet — this is a pure addition that later increments build on.

**Files changed:**

| File | Action |
|------|--------|
| `lib/api/route-auth.ts` | **Create** — types + `requireAuth()` |

**Helper signature and contract:**

```ts
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ServiceSupabaseClient = ReturnType<typeof createServiceRoleClient>;

export interface AuthContext {
  user: User;
  supabase: ServerSupabaseClient;
  serviceClient: ServiceSupabaseClient;
}

export async function requireAuth(): Promise<AuthContext | NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ message: "Unauthenticated" }, { status: 401 });
  }
  const serviceClient = createServiceRoleClient();
  return { user, supabase, serviceClient };
}
```

**Caller pattern (used by Increments 6–8):**

```ts
const auth = await requireAuth();
if (auth instanceof NextResponse) return auth;
const { user, supabase, serviceClient } = auth;
```

The `instanceof NextResponse` discriminator matches the PRD's "destructure or short-circuit" requirement and is idiomatic with how callers already return early on 401.

**Failure body matches existing routes.** A spot-check across the surveyed routes shows the existing 401 body is `{ message: "Unauthenticated" }` (some routes use `{ message: "Unauthorized" }` — see Increment 6 verification step; if a route uses the latter today, P2.R5 requires it stays the same after migration, so the helper must support both messages or the message must be normalized intentionally and called out in the audit).

**Verify:**

- Module type-checks in isolation: `npx tsc --noEmit`.
- No new runtime callers — `grep -rn "requireAuth" app lib --include="*.ts"` returns only the export line.
- The helper does not duplicate cookie or auth logic — it composes existing `createClient` / `createServiceRoleClient` from `lib/supabase/server.ts`.

**Forward compatibility:** Future routes consume this helper instead of inlining `auth.getUser()`. The `AuthContext` shape is the extension point — additional fields (e.g., `activeTeamId` resolved from cookie) can be added without breaking callers because callers destructure by name.

---

### Increment 2 — Team-context helpers + `idempotentNoOp` (P2.R1)

**What:** Add `requireTeamMember`, `requireTeamAdmin`, `requireTeamOwner` to `lib/api/route-auth.ts`. Each composes `requireAuth`'s output with a team-role check using existing `team-repository` primitives. Also add `idempotentNoOp(message)` so the canonical 409-no-op response (introduced in Part 1 Increment 3) is callable without re-typing the body.

**Why three helpers, not the two named in the PRD:** The PRD requires `requireTeamAdmin` and `requireTeamOwner` "at minimum." The route survey shows four routes (`teams/[teamId]/route.ts` GET, `teams/[teamId]/leave/route.ts`, `teams/[teamId]/members/route.ts` GET, `teams/[teamId]/invitations/route.ts` GET) need only *membership* (any role), not admin. Adding `requireTeamMember` removes the temptation to call `requireTeamAdmin` for read-only endpoints and prevents false-positive 403s on member-only checks.

**Files changed:**

| File | Action |
|------|--------|
| `lib/api/route-auth.ts` | **Modify** — add three team helpers, `TeamContext`, `idempotentNoOp` |

**Helper signatures:**

```ts
import { createTeamRepository } from "@/lib/repositories";
import type { Tables } from "@/lib/types/database"; // generated types
type TeamRepo = ReturnType<typeof createTeamRepository>;

export interface TeamContext extends AuthContext {
  team: Tables<"teams">;
  member: Tables<"team_members"> & { role: "owner" | "admin" | "member" };
  teamRepo: TeamRepo;
}

export async function requireTeamMember(teamId: string, user: User): Promise<TeamContext | NextResponse>;
export async function requireTeamAdmin(teamId: string, user: User): Promise<TeamContext | NextResponse>;
export async function requireTeamOwner(teamId: string, user: User): Promise<TeamContext | NextResponse>;

export function idempotentNoOp(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 409 });
}
```

**Implementation outline (single private helper, three thin specializations):**

```ts
type RequiredRole = "member" | "admin" | "owner";

async function loadTeamContext(
  teamId: string,
  user: User,
  required: RequiredRole
): Promise<TeamContext | NextResponse> {
  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const team = await teamRepo.getTeamById(teamId);
  if (!team) return NextResponse.json({ message: "Team not found" }, { status: 404 });

  const member = await teamRepo.getMember(teamId, user.id);
  if (!member) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  // Role hierarchy: owner satisfies admin satisfies member.
  const rank = { member: 0, admin: 1, owner: 2 } as const;
  if (rank[member.role] < rank[required]) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return { user, supabase, serviceClient, team, member, teamRepo };
}

export const requireTeamMember = (teamId: string, user: User) => loadTeamContext(teamId, user, "member");
export const requireTeamAdmin  = (teamId: string, user: User) => loadTeamContext(teamId, user, "admin");
export const requireTeamOwner  = (teamId: string, user: User) => loadTeamContext(teamId, user, "owner");
```

**Important:** the PRD signatures `requireTeamAdmin(teamId, user)` and `requireTeamOwner(teamId, user)` are preserved verbatim. The internal `loadTeamContext` is a private implementation detail — callers never see it. This honours the user's call (2026-04-26) to keep two named helpers rather than a parameterized `requireRole`.

**Note on duplicated client creation.** Each `requireTeam*` call creates fresh `supabase` + `serviceClient` instances. Since `requireAuth` already created them, callers that use both helpers pay for two creations. This is acceptable: client creation is cookie-read + object construction (sub-millisecond) and Supabase pools the underlying HTTP connection. Optimizing this is deferred to backlog if profiling later flags it.

**Caller pattern:**

```ts
const auth = await requireAuth();
if (auth instanceof NextResponse) return auth;

const ctx = await requireTeamAdmin(teamId, auth.user);
if (ctx instanceof NextResponse) return ctx;
const { team, member, teamRepo, supabase, serviceClient } = ctx;
```

**`idempotentNoOp` migration.** Part 1 Increment 3 inlined the 409 response in `app/api/teams/[teamId]/members/[userId]/role/route.ts`. After Increment 2, that line becomes:

```ts
if (targetMember.role === parsed.data.role) {
  return idempotentNoOp(`Member already has role '${targetMember.role}'`);
}
```

This is a one-line swap — no behavioural change.

**Verify:**

- Module type-checks: `npx tsc --noEmit`.
- The role hierarchy is correct: a unit-style spot check (manual, by reading the code) confirms `owner` satisfies `admin` and `member` checks.
- Failure-response bodies match what Increment 6 expects each migrated route to keep returning (`Unauthenticated`, `Team not found`, `Forbidden`).

**Forward compatibility:** New roles (e.g., `viewer`) require a single change: extend `RequiredRole`, the `rank` table, and add a `requireTeamViewer` factory line. The existing helpers are untouched. The user's concern about "future-proofing for more roles" is satisfied by the internal `loadTeamContext` without exposing a parameterized public API.

---

### Increment 3 — `requireSessionAccess` helper (P2.R1)

**What:** Add `requireSessionAccess(sessionId, user)` to `lib/api/route-auth.ts`. This helper wraps the existing framework-agnostic `checkSessionAccess` from `lib/services/session-service.ts` and translates its discriminated-union result into a `NextResponse` on failure. The service stays framework-agnostic; the helper handles HTTP framing.

**Files changed:**

| File | Action |
|------|--------|
| `lib/api/route-auth.ts` | **Modify** — add `requireSessionAccess` + `SessionContext` |

**Helper signature:**

```ts
import { checkSessionAccess } from "@/lib/services/session-service";
import { createSessionRepository, createTeamRepository } from "@/lib/repositories";
import { getActiveTeamId } from "@/lib/server/active-team"; // existing helper used by current routes

type SessionRepo = ReturnType<typeof createSessionRepository>;

export interface SessionContext extends AuthContext {
  sessionId: string;
  teamId: string | null;
  sessionRepo: SessionRepo;
  teamRepo: TeamRepo;
}

export async function requireSessionAccess(
  sessionId: string,
  user: User
): Promise<SessionContext | NextResponse> {
  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient);
  const teamRepo = createTeamRepository(supabase, serviceClient);
  const teamId = await getActiveTeamId();

  const result = await checkSessionAccess(sessionRepo, teamRepo, sessionId, user.id, teamId);
  if (!result.allowed) {
    if (result.reason === "not_found") return NextResponse.json({ message: "Session not found" }, { status: 404 });
    if (result.reason === "forbidden") return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    return NextResponse.json({ message: "Failed to verify session access" }, { status: 500 });
  }

  return { user, supabase, serviceClient, sessionId, teamId, sessionRepo, teamRepo };
}
```

The exact reason → status-code mapping mirrors what each existing session route does today; Increment 7 verifies that no message string changes during migration.

**Verify:**

- `npx tsc --noEmit` passes.
- The helper does not redefine the access-rule logic — it imports `checkSessionAccess` and only translates the result.

**Forward compatibility:** Part 3 (session orchestrator) routes will use `requireSessionAccess` after migration. Part 9 (smaller cleanups) does not change session access logic — this helper is stable for both.

---

### Increment 4 — File-validation helper (P2.R3)

**What:** Extract size + MIME-type validation duplicated across `app/api/sessions/[id]/attachments/route.ts:130–142` and `app/api/files/parse/route.ts:53–71` into a single helper.

**Files changed:**

| File | Action |
|------|--------|
| `lib/api/file-validation.ts` | **Create** — `validateFileUpload` |

**Helper signature and contract:**

```ts
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/constants";

export type FileValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export function validateFileUpload(file: File): FileValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, message: "File exceeds 10MB limit" };
  }
  if (!(file.type in ACCEPTED_FILE_TYPES)) {
    return { valid: false, message: `Unsupported file type: ${file.type}` };
  }
  return { valid: true };
}
```

The two error message strings are pulled verbatim from the current inline checks (the attachments route currently says `"File exceeds 10MB limit"`; the parse route currently says `"File exceeds 10MB limit"`; both routes use a similar `"Unsupported file type"` phrasing — Increment 4 verification reconciles any wording drift). P2.R5 requires the migrated routes return identical messages; if the two existing wordings differ, the helper picks one and Increment 4 is the single line where the wording change is documented.

**Caller pattern (used by Increments 7 and 8):**

```ts
const result = validateFileUpload(file);
if (!result.valid) {
  return NextResponse.json({ message: result.message }, { status: 400 });
}
```

**Verify:**

- `npx tsc --noEmit` passes.
- Constants are imported from `lib/constants.ts` (the existing source of truth) — the helper does not redeclare the size limit or the MIME map.
- A grep for `MAX_FILE_SIZE_BYTES` and `ACCEPTED_FILE_TYPES` in `app/api/` returns only the routes that will be migrated in Increments 7 and 8.

**Forward compatibility:** Adding a new file constraint (e.g., reject files with an empty body) is a single-edit on this helper. Future upload routes call the helper without re-implementing constraints.

---

### Increment 5 — `canUserCreateTeam` moves into `team-service.ts` (P2.R4)

**What:** Move the inline `supabase.from("profiles").select("can_create_team")` query from `app/api/teams/route.ts:66–85` into `team-service.ts` as `canUserCreateTeam(supabase, userId)`. The route calls the service.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/team-service.ts` | **Modify** — add exported `canUserCreateTeam` |
| `app/api/teams/route.ts` | **Modify** — POST handler replaces inline query with service call |

**Implementation details:**

1. **Service function (`team-service.ts`).** Append:

   ```ts
   export async function canUserCreateTeam(
     supabase: ServerSupabaseClient,
     userId: string
   ): Promise<{ allowed: boolean; reason?: "profile_not_found" | "feature_disabled" }> {
     const { data: profile, error } = await supabase
       .from("profiles")
       .select("can_create_team")
       .eq("id", userId)
       .single();

     if (error || !profile) {
       console.error("[team-service] canUserCreateTeam — profile lookup failed", { userId, error });
       return { allowed: false, reason: "profile_not_found" };
     }
     if (!profile.can_create_team) {
       return { allowed: false, reason: "feature_disabled" };
     }
     return { allowed: true };
   }
   ```

   The discriminated-union return type lets the caller surface a precise error message without the service knowing about HTTP. This matches `checkSessionAccess`'s shape — same convention.

2. **Route migration (`app/api/teams/route.ts`).** Replace lines 66–85 with:

   ```ts
   const permission = await canUserCreateTeam(supabase, user.id);
   if (!permission.allowed) {
     const status = permission.reason === "profile_not_found" ? 500 : 403;
     return NextResponse.json(
       { message: permission.reason === "profile_not_found"
           ? "Could not verify team-creation permission"
           : "Your account does not have permission to create teams" },
       { status }
     );
   }
   ```

   The status codes and messages must match what the inline query produces today (verify during Increment 5 — read the current route, confirm the existing 500/403 wording, and make the new call site emit identical bodies).

**Verify:**

- `grep -rn 'from("profiles")' app/api` returns no hits in `app/api/teams/route.ts`.
- Manual: a user with `can_create_team = true` can still create a team; a user with `false` still gets the same 403 they got before; an orphaned profile still gets the same 500.
- `npx tsc --noEmit` passes.

**Forward compatibility:** Other profile-permission flags (e.g., `can_invite_members`) follow the same pattern in this service — single function per flag, discriminated-union result, route only handles HTTP framing. If profile-permission logic grows, the function moves to `profile-service.ts`; Increment 5 leaves a TODO comment to that effect.

---

### Increment 6 — Migrate team routes to helpers (P2.R2)

**What:** Replace the inline `createClient → getUser → 401 → service-client → repo → role-check` block in every team route with a call to the appropriate helper from Increments 1–2.

**Files changed (route → helper mapping):**

| Route | Methods | Helper(s) used |
|-------|---------|----------------|
| `app/api/teams/route.ts` | GET, POST | `requireAuth` (POST also calls `canUserCreateTeam` from Inc. 5) |
| `app/api/teams/[teamId]/route.ts` | GET | `requireTeamMember` |
| `app/api/teams/[teamId]/route.ts` | PATCH, DELETE | `requireTeamOwner` |
| `app/api/teams/[teamId]/transfer/route.ts` | POST | `requireTeamOwner` |
| `app/api/teams/[teamId]/leave/route.ts` | POST | `requireTeamMember` (owner-leaving guard remains inline — it's logic, not auth) |
| `app/api/teams/[teamId]/members/route.ts` | GET | `requireTeamMember` |
| `app/api/teams/[teamId]/members/[userId]/route.ts` | DELETE | `requireTeamAdmin` |
| `app/api/teams/[teamId]/members/[userId]/role/route.ts` | PATCH | `requireTeamOwner` (also adopts `idempotentNoOp` from Inc. 2) |
| `app/api/teams/[teamId]/invitations/route.ts` | GET, POST | `requireTeamMember` (GET), `requireTeamAdmin` (POST) |
| `app/api/teams/[teamId]/invitations/[invitationId]/route.ts` | DELETE | `requireTeamAdmin` |
| `app/api/teams/[teamId]/invitations/[invitationId]/resend/route.ts` | POST | `requireTeamAdmin` |

**Migration recipe (applied identically per route):**

1. Delete inline `createClient()` + `auth.getUser()` + 401 check + `createServiceRoleClient()` + `createTeamRepository(...)` + (if present) inline `team.owner_id !== user.id` or `member.role !== "admin"` check.
2. Replace with the two-step `requireAuth` + `requireTeam*` calls (or just `requireAuth` for the team-list/POST route).
3. Destructure the helper's success result for the variables the rest of the handler uses (`user`, `team`, `member`, `teamRepo`, `supabase`, `serviceClient`).
4. Preserve the rest of the handler verbatim — validation, business logic, response construction, logging.
5. Preserve the existing entry/exit/error logs (P2.R5). Helper-level logs are not added — if a helper fails, the route still owns the error log for its own context.

**Per-route specifics worth pinning:**

- **`teams/route.ts` POST.** Uses `requireAuth` only (no team context yet — the team is being created). After auth, calls `canUserCreateTeam` (Inc. 5). The rest of the handler — validation, `teamRepo.createTeam`, response — stays.
- **`teams/[teamId]/leave/route.ts`.** `requireTeamMember` confirms membership. The "owner cannot leave without transfer" guard — `if (member.role === "owner" && !req.body.transferToUserId) return 409` — is *business logic* and stays inline; it is not part of the auth boilerplate.
- **`role/route.ts`.** `requireTeamOwner` replaces the inline `team.owner_id !== user.id` check. The Part 1 Increment 3 no-op response is rewritten as `idempotentNoOp(...)`. The role-permission validation (e.g., "only owner can promote to owner") stays inline — same reason as above: business logic, not auth.

**Verify (per-route):**

- For each migrated route: `grep -n "auth.getUser\|createClient\(\)" <file>` returns zero hits inside the handler body. The only acceptable hit is inside import statements (which should also be removed if no longer used).
- For each migrated route: HTTP contracts unchanged. Manual smoke per route on the happy path + the dominant failure (401, 403, 404, 409) using the existing UI flows (settings page, invites flow, etc.).
- After all team routes migrated: `grep -rn "from(\"profiles\")" app/api` returns zero hits (Inc. 5 already ensured this for the one offender).
- `npx tsc --noEmit` passes after each route migration.

**Forward compatibility:** New team routes inherit this pattern. Adding a new role check or context field touches `lib/api/route-auth.ts` only.

---

### Increment 7 — Migrate session + attachment routes to helpers (P2.R2, P2.R3)

**What:** Migrate session and attachment routes onto `requireAuth` + `requireSessionAccess` (Increment 3), and onto `validateFileUpload` (Increment 4) for upload routes.

**Files changed (route → helper mapping):**

| Route | Methods | Helper(s) used |
|-------|---------|----------------|
| `app/api/sessions/route.ts` | GET, POST | `requireAuth` (no session yet for POST; team scoping comes from `getActiveTeamId` as today) |
| `app/api/sessions/[id]/route.ts` | PUT, DELETE | `requireAuth` + `requireSessionAccess` |
| `app/api/sessions/[id]/attachments/route.ts` | GET | `requireAuth` + `requireSessionAccess` |
| `app/api/sessions/[id]/attachments/route.ts` | POST | `requireAuth` + `requireSessionAccess` + `validateFileUpload` |
| `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` | DELETE | `requireAuth` + `requireSessionAccess` |
| `app/api/sessions/[id]/attachments/[attachmentId]/download/route.ts` | GET | `requireAuth` + `requireSessionAccess` |
| `app/api/sessions/prompt-versions/route.ts` | GET | `requireAuth` |

**Migration recipe:** identical to Increment 6, except the team-context helper is replaced by `requireSessionAccess`.

**Attachment-upload specifics (POST `/api/sessions/[id]/attachments`):**

- Lines 130–142 (size + MIME inline checks) are replaced with:

  ```ts
  const validation = validateFileUpload(file);
  if (!validation.valid) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }
  ```

- The `MAX_ATTACHMENTS = 5` cap (currently checked separately) stays in the route — it is per-session count, not per-file constraint, so it is not part of `validateFileUpload`. (If a future PRD wants to consolidate the per-session cap too, it can extend `validateFileUpload` to take a `currentCount` parameter; out of scope for P2.)

**Verify:**

- `grep -rn "MAX_FILE_SIZE_BYTES\|ACCEPTED_FILE_TYPES" app/api` returns hits only in `app/api/files/parse/route.ts` (until Increment 8 migrates it) — never in attachment routes after this increment.
- Manual smoke: create session, edit session, upload attachment (valid + oversize + wrong-MIME), delete attachment, download attachment. Each path returns identical status + body to pre-cleanup.
- `npx tsc --noEmit` passes.

**Forward compatibility:** Part 3 (session orchestrator) will edit the body of `POST/PUT /api/sessions/[id]` again — but only the `after()` block, not the auth scaffolding. The migration in Increment 7 leaves the auth-shape stable for Part 3 to slot into.

---

### Increment 8 — Migrate AI + file-parse routes to helpers (P2.R2, P2.R3)

**What:** Migrate the three remaining routes named in the PRD (P2.R2 + P2.R3) onto the helpers.

**Files changed:**

| Route | Methods | Helper(s) used |
|-------|---------|----------------|
| `app/api/ai/extract-signals/route.ts` | POST | `requireAuth` |
| `app/api/ai/generate-master-signal/route.ts` | POST | `requireAuth` |
| `app/api/files/parse/route.ts` | POST | `requireAuth` + `validateFileUpload` |

**Migration recipe:** same as Increments 6 and 7. The AI routes use only `requireAuth` — they do not perform team or session role checks today. The file-parse route also uses only `requireAuth` and adds `validateFileUpload`.

**Verify:**

- `grep -rn "MAX_FILE_SIZE_BYTES\|ACCEPTED_FILE_TYPES" app/api` returns zero hits — both upload routes now go through `validateFileUpload`.
- Manual smoke: trigger an extract from the capture flow (requires auth), trigger a master-signal generation, parse a file via the file-parse endpoint. Each path returns identical status + body to pre-cleanup.
- `npx tsc --noEmit` passes.
- Final repo-wide grep: `grep -rn "auth.getUser()" app/api` returns zero hits in route-handler bodies. Helper bodies are the only acceptable callers.

**Forward compatibility:** AI routes will likely grow team-scoping in a future PRD (e.g., per-team prompt versioning, per-team rate limits). Adding `requireTeamMember` to those routes is a one-line change once the team scope lands.

---

## Part 2 — End-of-part audit checklist

Per CLAUDE.md, after Increment 8 lands:

- [ ] **SRP.** `lib/api/route-auth.ts` does one thing per export (each helper enforces one auth condition); `lib/api/file-validation.ts` does one thing (validate a single file).
- [ ] **DRY.** No route handler still inlines `createClient → getUser → 401`; no route still inlines size/MIME checks; the `profiles.can_create_team` query exists in exactly one location (`team-service.ts`).
- [ ] **Logging.** Every migrated route preserves its entry/exit/error logs with the same context fields (`teamId`, `sessionId`, etc.) it had pre-migration. Helpers do not add logs that would duplicate route-level logs.
- [ ] **Behavior parity.** Status codes, error bodies, and happy-path payloads are unchanged for every migrated route (P2.R5). Verified via the Increment 6/7/8 manual smoke tests.
- [ ] **Convention compliance.** Helpers use named exports; types are exported alongside; `lib/api/` is added to the import-order conventions of CLAUDE.md if needed (it slots into "internal services/hooks").
- [ ] **Dead code.** Imports of `createClient`, `createServiceRoleClient`, `createTeamRepository`, `MAX_FILE_SIZE_BYTES`, `ACCEPTED_FILE_TYPES` are removed from any route that no longer uses them directly.
- [ ] **Type safety.** `npx tsc --noEmit` and `npm run build` pass.

After Part 2 completes:

- [ ] Update `ARCHITECTURE.md`: add `lib/api/route-auth.ts` and `lib/api/file-validation.ts` to the file map; add a brief note to the data-flow section describing how route handlers compose helpers.
- [ ] Add a `CHANGELOG.md` entry for PRD-023 P2 listing the eight increments and the three structural outcomes (auth helpers, file validation, profile query → service).
- [ ] Verify Decision-table entries in `ARCHITECTURE.md`: if any decision named an inlined auth pattern as "the canonical shape," update it to point at the helper module.

---

## Forward references to later parts (Part 2)

- **→ Part 3 (session orchestrator).** Both session write routes (`POST /api/sessions`, `PUT /api/sessions/[id]`) end Part 2 with `requireAuth` + `requireSessionAccess` already in place. Part 3 only edits the `after()` body and extracts the orchestration chain — the auth scaffolding above it is stable.
- **→ Part 5 (database-query-service split).** The dashboard route (`/api/dashboard/route.ts`) was not migrated in Part 2 (it's not in the PRD's P2.R2 list). When Part 5 touches it, adopting `requireAuth` is a free win — Part 5 should add it as part of the route-side cleanup.
- **→ Part 9 (smaller cleanups).** The two prompt-version routes (`/api/prompts/[id]`, `/api/sessions/prompt-versions`) — the second is migrated in Increment 7, the first is not (not in P2 scope). Part 9's prompt-version-number consolidation should adopt `requireAuth` on `/api/prompts/[id]` as a small additional cleanup.
- **→ Part 10 (docs refresh).** The `lib/api/` directory introduction, the new helpers, the `team-service` addition, and the file map all flow into the documentation refresh.
- **→ Backlog.** Two items surface during Part 2 that don't fit the cleanup scope: (1) consolidating client creation across multiple helper calls (perf optimization, sub-ms today), and (2) extending `validateFileUpload` to also enforce `MAX_ATTACHMENTS` per-session cap. Both belong on the cleanup backlog if measurable pressure ever appears.

---

# Part 3
## Part 3 — Session Orchestration Extracted from Routes

This part covers P3.R1 through P3.R5. The ~50-line `after(generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights)` chain currently inlined and duplicated across `POST /api/sessions` and `PUT /api/sessions/[id]` is moved into a single orchestrator function. Both routes call it with the same arguments shape. `after()` registration and `maxDuration = 60` stay in the routes — only the *body* of the `after()` callback changes.

**Database models:** None.
**API endpoints:** Same routes (`POST /api/sessions`, `PUT /api/sessions/[id]`); identical contracts (status codes, response payloads, post-response observability).
**Frontend:** None.
**New module:** `lib/services/session-orchestrator.ts` (one exported function: `runSessionPostResponseChain`).

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Create `runSessionPostResponseChain` orchestrator | 1 new file | small |
| 2 | Migrate `POST /api/sessions` to call the orchestrator | 1 route | small |
| 3 | Migrate `PUT /api/sessions/[id]` to call the orchestrator | 1 route | small |

Each increment is independently shippable. Increment 1 is a pure addition (no callers yet) and de-risks Increments 2–3 — if the orchestrator is wrong, the migration step surfaces it immediately. Increments 2 and 3 can be bundled if the diff stays reviewable.

---

### Increment 1 — Create `runSessionPostResponseChain` orchestrator (P3.R1, P3.R2, P3.R4)

**What:** Create `lib/services/session-orchestrator.ts` exporting a single async function that owns the post-response chain end-to-end: builds `sessionMeta`, computes chunks (via `chunkStructuredSignals` or `chunkRawNotes`), creates the four repos used by the chain, runs `generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights`, and emits the same per-stage timing logs and the same unconditional error log the routes produce today.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/session-orchestrator.ts` | **Create** — `runSessionPostResponseChain` + `SessionPostResponseChainInput` type |

**Why a new module (not `session-service.ts`):** `session-service.ts` already owns CRUD and access control and is on the larger side. The chain has different concerns — it composes embeddings, themes, insights — and lives downstream of CRUD. Keeping it in its own module preserves SRP and makes it the natural target if/when a queue worker (Inngest, QStash, Supabase queues) replaces `after()` per Decision #19 of `ARCHITECTURE.md`.

**Function contract:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/schemas/extraction-schema";
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type { SessionMeta } from "@/lib/types/embedding-chunk";
import {
  chunkStructuredSignals,
  chunkRawNotes,
} from "@/lib/services/chunking-service";
import { generateSessionEmbeddings } from "@/lib/services/embedding-orchestrator";
import { assignSessionThemes } from "@/lib/services/theme-service";
import { maybeRefreshDashboardInsights } from "@/lib/services/insight-service";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";
import { createSignalThemeRepository } from "@/lib/repositories/supabase/supabase-signal-theme-repository";
import { createInsightRepository } from "@/lib/repositories/supabase/supabase-insight-repository";

export interface SessionPostResponseChainInput {
  sessionId: string;
  userId: string;
  teamId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredJson: ExtractedSignals | null;
  serviceClient: SupabaseClient;
  /** Set true for re-extract on PUT — controls embedding-orchestrator's
   *  behavior of deleting existing embeddings before re-embedding. */
  isReExtraction?: boolean;
  /** Log prefix used for chain-timing and chain-failure log lines.
   *  Routes pass `[POST /api/sessions]` or `[PUT /api/sessions/[id]]`
   *  so production grep patterns match pre-cleanup output (P3.R2). */
  logPrefix: string;
}

export async function runSessionPostResponseChain(
  input: SessionPostResponseChainInput
): Promise<void> {
  const {
    sessionId, userId, teamId,
    clientName, sessionDate, rawNotes, structuredJson,
    serviceClient, isReExtraction = false, logPrefix,
  } = input;

  const sessionMeta: SessionMeta = {
    sessionId,
    clientName,
    sessionDate,
    teamId,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  };

  const chunks = structuredJson
    ? chunkStructuredSignals(structuredJson, sessionMeta)
    : chunkRawNotes(rawNotes, sessionMeta);

  const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
  const themeRepo = createThemeRepository(serviceClient, teamId);
  const signalThemeRepo = createSignalThemeRepository(serviceClient);

  const chainStart = Date.now();

  try {
    const embeddingIds = await generateSessionEmbeddings({
      sessionMeta,
      structuredJson,
      rawNotes,
      embeddingRepo,
      isReExtraction,
      preComputedChunks: chunks,
    });
    console.log(
      `${logPrefix} chain timing — embeddings: ${Date.now() - chainStart}ms — sessionId: ${sessionId}`
    );

    if (!embeddingIds || embeddingIds.length === 0) return;

    const themeStart = Date.now();
    await assignSessionThemes({
      chunks,
      embeddingIds,
      teamId,
      userId,
      themeRepo,
      signalThemeRepo,
    });
    console.log(
      `${logPrefix} chain timing — themes: ${Date.now() - themeStart}ms — sessionId: ${sessionId}`
    );

    const insightStart = Date.now();
    const insightRepo = createInsightRepository(serviceClient);
    await maybeRefreshDashboardInsights({
      teamId,
      userId,
      insightRepo,
      supabase: serviceClient,
    });
    console.log(
      `${logPrefix} chain timing — insights: ${Date.now() - insightStart}ms; total: ${Date.now() - chainStart}ms — sessionId: ${sessionId}`
    );
  } catch (err) {
    console.error(
      `${logPrefix} EMBEDDING+THEME+INSIGHTS CHAIN FAILED — sessionId:`,
      sessionId,
      "elapsedMs:",
      Date.now() - chainStart,
      "error:",
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
  }
}
```

**Notes on the rewrite:**

- **`async/await + try/catch` instead of `.then().then().catch()`.** Functionally identical — sequencing semantics are preserved (each stage awaits the previous; catch wraps the whole chain). More readable and standard for this codebase. The per-stage timing logs print at the same boundaries as the existing chain (after embeddings resolves; after themes resolves; after insights resolves).
- **`logPrefix` is a parameter, not a constant.** Strict P3.R2 compliance — current grep patterns like `grep "\[POST /api/sessions\] chain timing"` continue to match. An alternative single prefix (e.g., `[session-orchestrator]`) was considered but would change production observability dashboards/alerts that key on the route prefix. Kept as a parameter; routes pass their existing prefix verbatim.
- **`isReExtraction` defaults to false.** POST passes nothing (default false); PUT passes `true`. Matches the current PUT-only `isReExtraction: true` flag passed to `generateSessionEmbeddings`.
- **Repositories are constructed inside the orchestrator.** Routes don't need to import any of `createEmbeddingRepository`, `createThemeRepository`, `createSignalThemeRepository`, `createInsightRepository`, `chunkStructuredSignals`, `chunkRawNotes`, `EXTRACTION_SCHEMA_VERSION`, `SessionMeta`, or `ExtractedSignals` after the migration — those imports move with the chain. P3.R5's "shrink meaningfully" benefit comes mostly from this import-block cleanup.
- **`serviceClient` is the only external dependency the route still passes through.** It comes from `requireAuth()` / `requireSessionAccess()` (Part 2 helpers) and threads into the orchestrator. The orchestrator never creates Supabase clients itself — keeps the request-scoped cookie/user binding intact.

**Verify:**

- Module type-checks in isolation: `npx tsc --noEmit`.
- No new runtime callers — `grep -rn "runSessionPostResponseChain" app lib --include="*.ts"` returns only the export line.
- All chain-internal symbols (`chunkStructuredSignals`, `generateSessionEmbeddings`, `assignSessionThemes`, `maybeRefreshDashboardInsights`, `createEmbeddingRepository`, etc.) resolve to the same modules the routes currently import — no behavior change in the underlying primitives.

**Forward compatibility:**

- **Queue-worker migration path.** When `after()` is replaced by a queue worker (Decision #19), `runSessionPostResponseChain` becomes the queue-job handler with no change to its body — the migration boundary is the orchestrator's stable input shape (`SessionPostResponseChainInput`), serialisable except for `serviceClient`. The queue worker would re-create `serviceClient` from the job context. The orchestrator's existing log structure (with `sessionId`, `elapsedMs`, stack) is already what the queue's retry/replay logs need.
- **New stages.** Adding a stage (e.g., post-extraction notification) is a single-file edit to the orchestrator. Routes are untouched.
- **Per-route variations.** If a future route needs a different chain (e.g., a bulk re-extract route runs only embeddings + themes, no insights refresh), expose a second orchestrator function or accept a stage-flag input. Out of scope for P3 — flagged as a backlog candidate.

---

### Increment 2 — Migrate `POST /api/sessions` to the orchestrator (P3.R1, P3.R3, P3.R4, P3.R5)

**What:** Replace the inlined `after(...)` chain in `POST /api/sessions` with a single `after(runSessionPostResponseChain({...}))` call. Remove all chain-only imports from the route.

**Files changed:**

| File | Action |
|------|--------|
| `app/api/sessions/route.ts` | **Modify** — replace lines ~184–255 (sessionMeta, structuredJson, chunks, repos, chain) with one orchestrator call; clean up imports |

**Implementation details:**

1. **Replace the chain block.** Lines that currently build `sessionMeta`, derive `structuredJson`, compute `chunks`, build the three repos (`embeddingRepo`, `themeRepo`, `signalThemeRepo`), capture `chainStart`, and run the `after(generateSessionEmbeddings(...).then(...).then(...).catch(...))` chain become:

   ```ts
   after(
     runSessionPostResponseChain({
       sessionId: session.id,
       userId: user.id,
       teamId,
       clientName: parsed.data.clientName,
       sessionDate: parsed.data.sessionDate,
       rawNotes: parsed.data.rawNotes,
       structuredJson: (parsed.data.structuredJson as ExtractedSignals | null) ?? null,
       serviceClient,
       logPrefix: "[POST /api/sessions]",
     })
   );
   ```

   Note: `structuredJson` derivation in POST is `(parsed.data.structuredJson as ExtractedSignals | null) ?? null` — the cast goes inline at the call site to avoid moving `ExtractedSignals` into the route's import block (the orchestrator owns the type internally; the route's payload is the parsed Zod result).

   Actually — the cleaner move is to *not* import `ExtractedSignals` into the route at all. The orchestrator's `structuredJson` parameter is typed as `ExtractedSignals | null`; the route passes `parsed.data.structuredJson ?? null` and TypeScript narrowing through the Zod schema's inferred type plus the orchestrator's contract handles the rest. If a cast is still needed (because `structuredJson` is typed as `Record<string, unknown> | null` from Zod), keep the cast inline as `as ExtractedSignals | null`. This keeps `ExtractedSignals` out of the route's imports.

2. **Remove now-unused imports from the route.** After this increment, `app/api/sessions/route.ts` no longer needs:

   - `EXTRACTION_SCHEMA_VERSION` — only used in `sessionMeta` build, which is now in the orchestrator
   - `createEmbeddingRepository`, `createThemeRepository`, `createSignalThemeRepository`, `createInsightRepository` — all used by the chain
   - `generateSessionEmbeddings`, `assignSessionThemes`, `maybeRefreshDashboardInsights` — chain stages
   - `chunkStructuredSignals`, `chunkRawNotes` — chunk computation
   - `SessionMeta` type — used only in `sessionMeta` build
   - `ExtractedSignals` type — only if the cast strategy in step 1 keeps it inline; if a `satisfies` or inline cast removes the need, drop this too

   Add the single new import: `import { runSessionPostResponseChain } from "@/lib/services/session-orchestrator";`.

3. **`after()` registration stays in the route (P3.R3).** The route continues to wrap the orchestrator call in `after()` — the function-instance lifetime extension is unchanged. `export const maxDuration = 60` stays at the top of the file (Next.js requires it as a literal in the route module — moving it would regress).

4. **No business logic stays inline.** After migration, the POST handler does only: parse body → validate → `requireAuth` → resolve teamId → build repos → `createSession` → `after(runSessionPostResponseChain(...))` → return 201. P3.R5's "no inline `.then().then().catch()` chain" is satisfied; the route file shrinks by ~70 LOC (the chain + chain-only imports + `sessionMeta`/`chunks` setup).

**Verify:**

- `grep -n ".then(.*).then(" app/api/sessions/route.ts` returns zero hits.
- `grep -n "runSessionPostResponseChain\|after(" app/api/sessions/route.ts` shows exactly one orchestrator call inside one `after()` registration.
- `wc -l app/api/sessions/route.ts` is under 200.
- Production-equivalent log lines: trigger a session create on a local stack with a structured-extraction payload; tail the dev server console — the four chain logs (`embeddings`, `themes`, `insights`, plus on a forced failure the `EMBEDDING+THEME+INSIGHTS CHAIN FAILED` line) match the pre-cleanup format byte-for-byte (sessionId, elapsedMs, prefix `[POST /api/sessions]`).
- `npx tsc --noEmit` and `npm run build` pass.

**Forward compatibility:** Inc. 2 leaves the POST route's auth scaffolding (Part 2's `requireAuth`) and CRUD call (`createSession`) untouched. Future cleanup increments that touch the POST handler (e.g., Part 9's session-service decomposition) start from a route file that's now ~200 LOC and contains no orchestration.

---

### Increment 3 — Migrate `PUT /api/sessions/[id]` to the orchestrator (P3.R1, P3.R3, P3.R4, P3.R5)

**What:** Same migration recipe as Increment 2, applied to the PUT route. The only differences from POST are the `structuredJson` derivation rule, the `isReExtraction: true` flag, and the log prefix.

**Files changed:**

| File | Action |
|------|--------|
| `app/api/sessions/[id]/route.ts` | **Modify** — replace lines ~138–215 (chain block) with one orchestrator call; clean up imports |

**Implementation details:**

1. **Replace the chain block.** The PUT chain currently derives `structuredJson` based on the `isExtraction` flag in the request body:

   ```ts
   const structuredJson = parsed.data.isExtraction
     ? ((parsed.data.structuredJson as ExtractedSignals | null) ?? null)
     : null;
   ```

   This logic stays at the *route* level — it's a route-specific request-shape concern (PUT distinguishes "this is a re-extraction; structuredJson is fresh from the AI" vs "this is a manual edit; structuredJson is irrelevant to the chain"). The route passes the resolved value to the orchestrator:

   ```ts
   const chainStructuredJson = parsed.data.isExtraction
     ? ((parsed.data.structuredJson as ExtractedSignals | null) ?? null)
     : null;

   after(
     runSessionPostResponseChain({
       sessionId: id,
       userId: user.id,
       teamId,
       clientName: parsed.data.clientName,
       sessionDate: parsed.data.sessionDate,
       rawNotes: parsed.data.rawNotes,
       structuredJson: chainStructuredJson,
       serviceClient,
       isReExtraction: true,
       logPrefix: "[PUT /api/sessions/[id]]",
     })
   );
   ```

   The 3-line `chainStructuredJson` derivation is route-specific business logic and remains inline. The orchestrator stays generic — it accepts a resolved `structuredJson` and chunks accordingly.

2. **`isReExtraction: true`** is the PUT-only flag. POST omits it (defaults to false). This preserves the existing behavior of `generateSessionEmbeddings`'s "delete previous embeddings before re-embedding" path.

3. **Log prefix** is `[PUT /api/sessions/[id]]` (verbatim from the existing route). Production grep patterns are unchanged.

4. **Remove now-unused imports from the route.** Same set as Inc. 2: `EXTRACTION_SCHEMA_VERSION`, the four chain repo factories, `generateSessionEmbeddings`, `assignSessionThemes`, `maybeRefreshDashboardInsights`, `chunkStructuredSignals`, `chunkRawNotes`, `SessionMeta`. The `ExtractedSignals` import may need to stay if the inline cast in step 1 references it; this is a minor judgement call at edit time.

5. **PUT-specific concerns that don't change.** The session-existence error handling (`SessionNotFoundError → 404`), the `ClientDuplicateError → 409` mapping, the body validation, and the access check (`requireSessionAccess` from Part 2) all stay. Only the *post-response* chain block is replaced.

**Verify:**

- Same grep, wc, and runtime-log checks as Inc. 2 (replacing `[POST /api/sessions]` with `[PUT /api/sessions/[id]]`).
- Manual smoke: re-extract a session, verify the chain still runs to completion (embeddings re-generated, themes re-assigned, insights potentially refreshed). Log output matches pre-cleanup format.
- `npx tsc --noEmit` and `npm run build` pass.

**Forward compatibility:** PUT inherits the same forward-compat properties as POST. Both routes are now thin: validation, auth, CRUD, orchestrator dispatch, response.

---

## Part 3 — End-of-part audit checklist

Per CLAUDE.md, after Increment 3 lands:

- [ ] **SRP.** `session-orchestrator.ts` does one thing — runs the post-response chain end-to-end. Routes do request validation, CRUD, and post-response dispatch — no chain primitives leaked back into them.
- [ ] **DRY.** `sessionMeta` construction, chunk selection (`chunkStructuredSignals` vs `chunkRawNotes`), the four chain-repo creations, and the `.then().then().catch()` pattern exist in exactly one place (the orchestrator) — verified by grep.
- [ ] **Logging.** All four chain log lines (embeddings/themes/insights timings + `EMBEDDING+THEME+INSIGHTS CHAIN FAILED`) emit verbatim with the route's original prefix on both POST and PUT. Verified manually by triggering a successful chain and a forced failure.
- [ ] **Behavior parity.** `after()` registration and `maxDuration = 60` remain in both route files (P3.R3). The chain still completes post-response on Vercel — verified via Vercel function logs after a deployed test. `isReExtraction: true` flag preserved on PUT.
- [ ] **LOC.** `wc -l app/api/sessions/route.ts` and `wc -l app/api/sessions/[id]/route.ts` are both under 200.
- [ ] **Dead code.** Unused imports removed from both route files (the eight+ chain-only imports listed in Inc. 2). ESLint reports zero unused-vars in both files.
- [ ] **Convention compliance.** New module is named-exported, kebab-case file (`session-orchestrator.ts`), camelCase function (`runSessionPostResponseChain`), PascalCase input interface (`SessionPostResponseChainInput`), import order respected.
- [ ] **Type safety.** `npx tsc --noEmit` (strict) and `npm run build` both clean.

After Part 3 completes:

- [ ] Update `ARCHITECTURE.md`: add `lib/services/session-orchestrator.ts` to the file map; update Decision #19 ("Post-response background chain via `after()` + `maxDuration = 60`") to point at the new module — currently it says "the chain ... is registered with `after()` from `next/server`" without naming the module that owns it; updating it to "the chain — `runSessionPostResponseChain` in `lib/services/session-orchestrator.ts` — is registered with `after()`" makes the queue-worker migration boundary explicit.
- [ ] Add a `CHANGELOG.md` entry for PRD-023 P3 covering: the new orchestrator module, the route LOC reductions, and the explicit "log prefix preserved verbatim per P3.R2" note (so future reviewers don't normalize the prefix without thinking about production grep patterns).
- [ ] Verify no doc references to "the after() chain in /api/sessions" treat the chain as in-route logic — update any decision notes or comments that still imply the chain is route-owned.

---

## Forward references to later parts (Part 3)

- **→ Part 5 (database-query-service split).** Independent of Part 3. The orchestrator does not call any query-service action; the chain operates on embedding/theme/signal-theme/insight repos directly. Part 5's domain-module split has no impact on the orchestrator.
- **→ Part 9 (smaller cleanups).** `session-service.ts#updateSession`'s staleness decomposition (P9.R5) sits *upstream* of the orchestrator (CRUD → orchestrator). Decomposing the staleness logic doesn't touch the chain; the two cleanups are orthogonal and can land in either order.
- **→ Part 10 (docs refresh).** Decision #19 in `ARCHITECTURE.md` should name the orchestrator module after Part 3 lands (see end-of-part audit). The file map gains `lib/services/session-orchestrator.ts`.
- **→ Backlog.** Two items surface during Part 3 that don't fit the cleanup scope: (1) per-route variations of the chain (e.g., a bulk re-extract path that skips insights) — would warrant a stage-flag input on the orchestrator or a second orchestrator function; (2) replacing `after()` with a real queue worker (Inngest, QStash, Supabase queues) per Decision #19's migration trigger — Part 3 deliberately preserves the existing `after()` mechanism; the queue migration is a future PRD when chain duration or failure-rate signals demand it. The orchestrator's stable input contract (`SessionPostResponseChainInput`) is the migration boundary.

---

# Part 5
## Part 5 — `database-query-service` Domain Split

This part covers P5.R1 through P5.R7. The 2,036-LOC `lib/services/database-query-service.ts` monolith is split into a directory of domain modules under `lib/services/database-query/` while the public surface — `executeQuery`, `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ACTION_METADATA`, `CHAT_TOOL_ACTIONS`, `buildChatToolDescription` — is preserved verbatim. No SQL behavior, no filter semantics, no log line, and no result shape changes. This is a structural refactor; consumers (the dashboard route, `chat-stream-service`, `insight-service`) compile and behave identically.

**Database models:** None.
**API endpoints:** No contract changes. The dashboard route, the chat `queryDatabase` tool, the chat citation dialog (via `session_detail`), and the insight generation pipeline all produce identical responses.
**Frontend pages/components:** None.
**New module(s):**
- `lib/services/database-query/index.ts` (public re-exports)
- `lib/services/database-query/types.ts`
- `lib/services/database-query/action-metadata.ts`
- `lib/services/database-query/execute-query.ts` (the thin router: `executeQuery` + `ACTION_MAP`)
- `lib/services/database-query/shared/base-query-builder.ts`
- `lib/services/database-query/shared/severity-filter.ts`
- `lib/services/database-query/shared/row-helpers.ts`
- `lib/services/database-query/shared/theme-helpers.ts`
- `lib/services/database-query/domains/counts.ts`
- `lib/services/database-query/domains/distributions.ts`
- `lib/services/database-query/domains/sessions.ts`
- `lib/services/database-query/domains/themes.ts`
- `lib/services/database-query/domains/drilldown.ts`
- `lib/services/database-query/domains/drilldown-direct.ts`
- `lib/services/database-query/domains/drilldown-theme.ts`
- `lib/services/database-query/domains/session-detail.ts`
- `lib/services/database-query/domains/insights.ts`

**Removed:** `lib/services/database-query-service.ts` (replaced by the directory). All three consumers (`app/api/dashboard/route.ts`, `lib/services/chat-stream-service.ts`, `lib/services/insight-service.ts`) update their import path to `@/lib/services/database-query`.

**Note on action count.** The PRD-023 P5 narrative says "18 query actions"; the actual `QueryAction` union has 17 (`count_clients`, `count_sessions`, `sessions_per_client`, `sentiment_distribution`, `urgency_distribution`, `recent_sessions`, `client_list`, `sessions_over_time`, `client_health_grid`, `competitive_mention_frequency`, `top_themes`, `theme_trends`, `theme_client_matrix`, `drill_down`, `session_detail`, `insights_latest`, `insights_history`). `ARCHITECTURE.md` line 372 already records 17. The TRD operates against the registry, not the PRD prose. Acceptance criteria are interpreted as "all actions in the registry are partitioned" — no actions are added or removed by this part.

### Behavior Preservation Contract

This part is a **pure code-quality / maintainability refactor**. Every commitment below is structurally enforced by the increments and verified by the audit checklist; no user-visible behavior, observability, or developer-facing surface changes. Any reviewer who finds a diff against this contract should treat it as a regression.

| Dimension | Pre-cleanup | Post-cleanup | Enforced by |
|---|---|---|---|
| **`executeQuery` signature** | `(supabase, action, filters) → Promise<DatabaseQueryResult>` | Identical | Re-exported from `index.ts` (Inc. 5) |
| **`QueryAction` enum** | 17 string literals | Identical 17 string literals; same order, same spellings | Type moves to `types.ts` verbatim (Inc. 1) |
| **`QueryFilters` shape** | All 9 fields | Identical 9 fields, same names, same optionality | Type moves verbatim (Inc. 1) |
| **`DatabaseQueryResult` shape** | `{ action, data }` with `data: Record<string, unknown>` | Identical | Type moves verbatim (Inc. 1) |
| **Per-action result JSON** | Specific keys per action (`count`, `clients`, `themes`, `buckets`, `cells`, `batch`, `batches`, etc.) | Byte-identical for every action and every drill-down strategy | Pre/post snapshot diff (Inc. 5 verify step 3) — must be empty |
| **Sort order of returned arrays** | `clients` desc by count; `sessions` desc by session_date; drill-down rows desc by session_date; insight `batches` chronological reverse | Identical sort orders | Handler bodies move verbatim; verified by snapshot diff |
| **Severity equality** | `s.severity === requested` (strict, case-sensitive) | Identical | `sessionHasSeverity` body moved verbatim from `sessionHasSignalWithSeverity` |
| **Drill-down direct equality** | scalar JSON field `===` (case-sensitive) | Identical — call site supplies its own predicate | `fetchDirectDrillDownRows` thin wrapper; predicate uses `===` (Inc. 4) |
| **Drill-down competitor equality** | `.toLowerCase()` on both session-level mention and embedding-level metadata | Identical case-insensitive comparison; same `.toLowerCase()` calls in both predicates | `handleCompetitorDrillDown` rewrite preserves both `.toLowerCase()` calls explicitly (Inc. 4) |
| **`DRILL_DOWN_LIMIT` cap** | 100 signals after grouping | Identical | Constant moves to `drilldown.ts` verbatim (Inc. 4) |
| **Filter-label strings** | Per-strategy formatting in `buildFilterLabel` | Identical strings (`"Sentiment: Negative"`, `"Theme: X (2026-04-20)"`, etc.) | Function moves verbatim (Inc. 4) |
| **Empty-result short-circuits** | `[]` returned at session-fetch / session-filter / embedding-fetch boundaries; `{ batch: null }` for `insights_latest` with no batches | Identical short-circuits at identical boundaries | Handler bodies move verbatim |
| **`LOG_PREFIX` string** | `"[database-query-service]"` | **Identical literal** — preserved so production grep, alerting, and dashboards continue to match | `LOG_PREFIX` exported from `action-metadata.ts`; every domain module imports it (Inc. 1) |
| **`executeQuery` entry log** | `executeQuery — action: X, teamId: Y, filters: {...}` | Identical format and field order | Function moves verbatim (Inc. 5) |
| **`executeQuery` exit log** | `executeQuery — action: X completed in Nms` | Identical format | Function moves verbatim (Inc. 5) |
| **Per-handler error logs** | `${LOG_PREFIX} <action> error: <err>` | Identical strings | Handlers move verbatim |
| **`Error` message text** | `"Failed to count sessions"`, `"Failed to fetch drill-down sessions"`, etc. | **Identical message text** — surfaced through `executeQuery` to the dashboard route and to the chat tool result; users may see them | Handlers move verbatim |
| **Dev-time registry-sync check** | `assertChatToolActionsInSync()` runs at module load in non-prod | Runs at the same moment (first import of `action-metadata.ts`, transitively triggered by any consumer of `index.ts`) | Module-scope `if (process.env.NODE_ENV !== "production")` block moves with the registry (Inc. 1) |
| **Public exports** | 7 symbols (`executeQuery`, `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ACTION_METADATA`, `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `buildChatToolDescription`) | Identical 7 symbols, identical types, exposed via `index.ts` | `index.ts` re-export block (Inc. 5) |
| **Consumer import surface** | 3 files import from `@/lib/services/database-query-service` | 3 files import from `@/lib/services/database-query` (path swap; symbol names unchanged) | Inc. 5 import-edit step |
| **SQL plans** | Specific `select(...)`, `eq/in/is/gte/lte/order` chains per handler | Identical SQL emitted to Supabase | Handler bodies move verbatim; `baseSessionQuery`, `baseClientQuery`, `applyThemeJoinFilters` are the *same chain* extracted into a function — no clauses added or removed |
| **RLS / team-scoping** | All reads go through anon client with team filter (or `is null` for personal) | Identical — `scopeByTeam` continues to govern team scoping at the same call sites | Inc. 1 preserves the wrapper helpers verbatim |
| **Module-load side effects** | One-time dev assertion on first import of monolith | One-time dev assertion on first import of `action-metadata.ts` (same logical moment in the import graph) | Manual verify in Inc. 5 with a temp `console.log` (removed before merge) |
| **Bundle-graph reachability** | All 17 handlers reachable from `executeQuery` | Identical reachability through `ACTION_MAP` in `execute-query.ts` | TypeScript exhaustiveness on `Record<QueryAction, ...>` |

**Pre-merge gate (the no-regression test plan).** Before Increment 5 merges, the following must all be green:

1. `npx tsc --noEmit` clean, `npm run build` clean.
2. Pre/post JSON snapshot capture for all 17 actions plus all 7 drill-down strategies. `diff -r tmp/p5-snapshots tmp/p5-snapshots/post` returns nothing. (Snapshot fixtures must include at least one row per non-empty path: severity-set vs. unset, with/without dateFrom/dateTo, with/without clientIds, with/without confidenceMin, every drill-down strategy.)
3. Manual UI walkthrough on dashboard: every widget renders identical data; every drill-down panel opens with identical totals, ordering, and filter labels.
4. Manual chat walkthrough: representative quantitative questions exercise each LLM-exposed action; the underlying `queryDatabase` tool result is byte-identical to a pre-cleanup capture (LLM phrasing variation is OK; tool I/O must not vary).
5. Insight refresh path: trigger `maybeRefreshDashboardInsights`; the aggregates passed to the LLM (logged in `insight-service.ts`) match a pre-cleanup capture.
6. `grep -rn "database-query-service" app lib --include="*.ts"` returns zero hits — no stale references.
7. `LOG_PREFIX` literal is unchanged: `grep -rn "\\[database-query-service\\]" lib/services/database-query` returns the prefix consistently across all domain modules.

If any of these fail, the failing increment is not mergeable. The cleanup is paused until the diff is reconciled. There is no "small acceptable behavior change" — the refactor's value is exactly that it doesn't change behavior.

### Increments at a glance

| # | Increment | Scope | PR target |
|---|---|---|---|
| 1 | Scaffold the directory; extract types, action metadata, and shared helpers (severity, base-query, row, theme) | 8 new files; monolith re-imports them; consumers untouched | medium |
| 2 | Move count, distribution, and session-domain handlers into domain modules | 3 new files; monolith delegates | small |
| 3 | Move theme-domain handlers into a domain module | 1 new file; monolith delegates | small |
| 4 | Move drill-down handlers; deduplicate direct vs. competitor via shared row-fetch helper | 3 new files; monolith delegates | medium |
| 5 | Move session-detail + insights handlers; collapse the monolith into `execute-query.ts`; delete the old file; redirect three consumers' imports | 2 new files; 1 deletion; 3 consumer-import edits | medium |

Increments are ordered for safety: each increment is independently shippable, the public surface stays stable until Increment 5, and rollback at any increment touches only that increment's diff. Increments 1–4 leave `lib/services/database-query-service.ts` in place as the externally-imported entry point; only Increment 5 swaps consumers off it and deletes it.

---

### Increment 1 — Scaffold directory; extract types, metadata, and shared helpers (P5.R2, P5.R3)

**What:** Create the `lib/services/database-query/` directory and lift four kinds of content out of the monolith without changing handler bodies:

1. **Types and metadata.** Move `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ActionMeta`, `ACTION_METADATA`, `CHAT_TOOL_ACTIONS_TUPLE`, `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `assertChatToolActionsInSync`, and `buildChatToolDescription` into `types.ts` + `action-metadata.ts`.
2. **Severity filter — collapsed into one cohesive API (P5.R2).** Replace the three current helpers (`sessionHasSignalWithSeverity`, `applySeverityRowFilter`, `fetchSessionIdsMatchingSeverity`) with a single module exposing one cohesive surface.
3. **Base query builders (P5.R3).** Move `baseSessionQuery`, `baseClientQuery` into `shared/base-query-builder.ts`. Move the inline team/date/clientIds filtering currently duplicated by `fetchSignalThemeRows` and `fetchThemeDrillDownRows` into a shared **theme-join filter helper** in `shared/theme-helpers.ts` so subsequent increments can use it.
4. **Common row helpers.** Move `extractClientName`, `aggregateJsonField`, `dateTrunc` into `shared/row-helpers.ts` (`dateTrunc` is used by `theme_trends` and `drill_down/theme_bucket`; placing it in row-helpers avoids a circular import with theme-helpers).
5. **Theme helpers.** Move `fetchActiveThemeMap`, `fetchSignalThemeRows`, and the `SignalThemeJoinRow` type into `shared/theme-helpers.ts`.

The monolith file is **not deleted** in this increment. It re-imports every moved symbol and continues to expose the same public API. All three consumers are unchanged.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/database-query/types.ts` | **Create** — `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ActionMeta`, the shared `DrillDownRow` row type used by the drill-down family (defined here so domain modules import it without cycles) |
| `lib/services/database-query/action-metadata.ts` | **Create** — `ACTION_METADATA`, `CHAT_TOOL_ACTIONS_TUPLE`, `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `assertChatToolActionsInSync`, `buildChatToolDescription`, `LOG_PREFIX` |
| `lib/services/database-query/shared/base-query-builder.ts` | **Create** — `baseSessionQuery`, `baseClientQuery` |
| `lib/services/database-query/shared/severity-filter.ts` | **Create** — single severity API (see contract below) |
| `lib/services/database-query/shared/row-helpers.ts` | **Create** — `extractClientName`, `aggregateJsonField`, `dateTrunc` |
| `lib/services/database-query/shared/theme-helpers.ts` | **Create** — `fetchActiveThemeMap`, `fetchSignalThemeRows`, `SignalThemeJoinRow`, `applyThemeJoinFilters` (extracted team/date/clientIds filter that both `fetchSignalThemeRows` and the future `fetchThemeDrillDownRows` will share) |
| `lib/services/database-query-service.ts` | **Modify** — remove the moved bodies; replace with re-imports from the new modules. Public exports preserved verbatim |

**Severity-filter contract (P5.R2):**

```ts
// lib/services/database-query/shared/severity-filter.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryFilters } from "../types";
import { baseSessionQuery } from "./base-query-builder";

/**
 * Returns true if the session's `structured_json` contains at least one signal
 * chunk whose `severity` matches. Severity is per-chunk, not session-level —
 * scans painPoints/requirements/aspirations/blockers/custom.signals.
 */
export function sessionHasSeverity(
  json: Record<string, unknown> | null,
  severity: string
): boolean { /* moved verbatim from sessionHasSignalWithSeverity */ }

/**
 * Post-filter for handler rows that already include `structured_json`.
 * Returns rows untouched when no severity filter is set. Used by
 * count_sessions (severity path), sessions_per_client, sentiment_distribution,
 * urgency_distribution, recent_sessions.
 */
export function filterRowsBySeverity<T extends { structured_json: unknown }>(
  rows: T[],
  severity: string | undefined
): T[] { /* moved verbatim from applySeverityRowFilter, generic-typed */ }

/**
 * Pre-filter for handlers that don't fetch `structured_json` directly
 * (theme joins, drill-down theme paths). Resolves the set of session IDs
 * matching `severity` within team/date scope. Returns null when no severity
 * filter is set so callers can skip the in-clause cleanly. Returns an empty
 * Set when severity is set but no sessions match — callers must short-circuit.
 */
export async function resolveSessionIdsBySeverity(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Set<string> | null> { /* moved verbatim from fetchSessionIdsMatchingSeverity */ }
```

**Why three exports (not one).** The three call patterns are genuinely distinct: synchronous predicate (used at row level), synchronous filter (used in array .filter()), and async ID resolver (used to constrain a downstream join). Folding them into a single function would force callers to discriminate at the call site or pay an extra DB round-trip. The PRD's "single cohesive API" requirement is interpreted as one module with a shared mental model and consistent naming — not literally one function. The three current helpers (`sessionHasSignalWithSeverity`, `applySeverityRowFilter`, `fetchSessionIdsMatchingSeverity`) are renamed and moved (no behavior change), and live together in one module. P5.R2's "are gone or are thin re-exports for one release" is satisfied by deletion of the old names — no transitional re-exports because there are no external callers.

**`applyThemeJoinFilters` contract (P5.R3):**

```ts
// shared/theme-helpers.ts
/**
 * Applies the standard team/date-range/clientIds filter set to a
 * signal_themes ⨝ session_embeddings ⨝ sessions query. The exact same chain
 * is used by fetchSignalThemeRows (theme widgets) and fetchThemeDrillDownRows
 * (theme drill-down family), modulo extra filters specific to each.
 */
export function applyThemeJoinFilters<Q>(
  query: Q,
  filters: QueryFilters
): Q { /* team scoping + date range + clientIds, all on session_embeddings.* */ }
```

**Notes on the rewrite:**

- **`LOG_PREFIX` is moved to `action-metadata.ts`.** Every domain module imports `LOG_PREFIX` from there and emits identical log strings (`${LOG_PREFIX} <action> error:`). The literal prefix `[database-query-service]` stays unchanged so production grep/alerting patterns don't break.
- **No-explicit-any annotations carry over.** The `eslint-disable-next-line` comments on `baseSessionQuery`, `baseClientQuery`, `aggregateJsonField`, `applySeverityRowFilter`, and `extractClientName` move with the code. Part 1 already audited these as legitimately untyped (Supabase query-builder generics); Part 5 doesn't re-audit them.
- **Import ordering inside the monolith.** After this increment, the monolith's import block is dominated by intra-package imports from `./database-query/...`. Imports follow the project order (React/Next → third-party → internal utilities → internal services).
- **The `assertChatToolActionsInSync()` dev-time check moves with the registry.** It runs at module load on import of `action-metadata.ts`. Importing the registry from any domain module triggers the check exactly once per process; the existing `if (process.env.NODE_ENV !== "production")` guard remains.
- **`scopeByTeam` is *not* moved** — it lives in `lib/repositories/supabase/scope-by-team.ts` and is consumed by `base-query-builder.ts` and `theme-helpers.ts` directly. P5.R3's "no inline `.eq("team_id", teamId)` chains in domain handlers" is satisfied by routing all team scoping through `baseSessionQuery` / `baseClientQuery` / `applyThemeJoinFilters`. The two places that *do* call `scopeByTeam` directly today (`fetchActiveThemeMap` for the themes table, `handleSessionDetail` for the single-session lookup) are different tables (themes, single-row sessions) where the wrapper helpers don't fit; they remain as direct `scopeByTeam` calls and that's accepted by P5.R3 (the requirement is no inline `.eq("team_id", ...)`, which neither does).

**Verify:**

- `npx tsc --noEmit` clean.
- `grep -rn "from \"@/lib/services/database-query-service\"" app lib --include="*.ts"` returns the same 4 import statements as before (consumers unchanged).
- `grep -rn "sessionHasSignalWithSeverity\|applySeverityRowFilter\|fetchSessionIdsMatchingSeverity" lib --include="*.ts"` returns zero hits — the legacy names are gone.
- A unit-style spot check: instantiate a `QueryFilters` with `severity: "high"` and call `resolveSessionIdsBySeverity` against a fixture; the resulting Set membership matches what `fetchSessionIdsMatchingSeverity` would have produced.

**Forward compatibility:**

- The `DrillDownRow` type defined in `types.ts` is the canonical row shape for all drill-down strategies. Increment 4 adds the deduped helper that returns `DrillDownRow[]`; theme drill-down (also in Increment 4) returns the same shape.
- `applyThemeJoinFilters` becomes the single seam for adding new theme-join filters (e.g., a future `themeId in [...]` filter for multi-theme drill-down).

---

### Increment 2 — Count, distribution, and session-domain handlers (P5.R1)

**What:** Move three groups of handlers out of the monolith and into dedicated domain modules. The monolith's `ACTION_MAP` updates to import them; nothing else changes.

- `domains/counts.ts` — `handleCountClients`, `handleCountSessions`, `handleSessionsPerClient`, `handleClientList`.
- `domains/distributions.ts` — `handleSentimentDistribution`, `handleUrgencyDistribution`, `handleCompetitiveMentionFrequency`.
- `domains/sessions.ts` — `handleRecentSessions`, `handleSessionsOverTime`, `handleClientHealthGrid`.

Why this grouping: counts return scalar/grouped counts; distributions aggregate `structured_json` fields into bucketed maps; the session-domain bundle covers per-session listings and time-series. `client_list` lives with counts (it returns a list of clients, not per-client metrics) — `client_health_grid` is the per-client metrics handler and lives with sessions because it operates on session rows.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/database-query/domains/counts.ts` | **Create** — four handlers; imports from shared modules |
| `lib/services/database-query/domains/distributions.ts` | **Create** — three handlers |
| `lib/services/database-query/domains/sessions.ts` | **Create** — three handlers |
| `lib/services/database-query-service.ts` | **Modify** — remove the 10 handler bodies; `ACTION_MAP` imports them from the new modules |

**Implementation details:**

1. **Verbatim moves.** Each `handle*` function is moved unchanged. Only its imports rebind: `baseSessionQuery` from `../shared/base-query-builder`, `filterRowsBySeverity` and `sessionHasSeverity` from `../shared/severity-filter`, `extractClientName` and `aggregateJsonField` from `../shared/row-helpers`, `LOG_PREFIX` from `../action-metadata`.
2. **`handleCountSessions` retains its two-path body.** The severity-path uses `filterRowsBySeverity`; the no-severity path uses the count-only query. No optimization changes.
3. **`handleClientHealthGrid` retains its inline severity check.** It calls `sessionHasSeverity(row.structured_json, filters.severity)` directly because the filter happens after the per-client latest-row reduction; using `filterRowsBySeverity` would change ordering semantics. The call name updates from `sessionHasSignalWithSeverity` to `sessionHasSeverity` — the only diff is the rename.
4. **`handleSessionsOverTime` is RPC-based.** It moves to `domains/sessions.ts` unchanged. Its non-honoring of `severity` is documented in `ACTION_METADATA` already; that comment moves with the metadata in Increment 1.

**LOC budget check:** counts ~150, distributions ~110, sessions (incl. `client_health_grid`) ~140 — well under the ~400-LOC ceiling.

**Verify:**

- `npx tsc --noEmit` clean.
- For each of the 10 actions, manually trigger the dashboard widget or chat tool that calls it and compare the response JSON to a pre-cleanup capture (saved before this PR opens — see Increment 5 verification plan for how the captures are produced). Diff is empty.
- `wc -l lib/services/database-query-service.ts` shows the file shrunk by ~600 LOC.

**Forward compatibility:** Adding a new count action (per P5.R7) edits only `counts.ts` and the action-map registration in the still-monolith file. Increment 5 will move the action map to `execute-query.ts`, after which the registration is a single-file edit there + the domain module — no cross-domain changes.

---

### Increment 3 — Theme-domain handlers (P5.R1)

**What:** Move the three theme widget handlers into `domains/themes.ts`.

- `domains/themes.ts` — `handleTopThemes`, `handleThemeTrends`, `handleThemeClientMatrix`.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/database-query/domains/themes.ts` | **Create** — three handlers; imports `fetchActiveThemeMap`, `fetchSignalThemeRows` from `../shared/theme-helpers`; imports `dateTrunc`, `extractClientName` from `../shared/row-helpers`; imports `baseClientQuery` from `../shared/base-query-builder` (for the `theme_client_matrix` clients-list fetch) |
| `lib/services/database-query-service.ts` | **Modify** — remove the three handler bodies; `ACTION_MAP` imports them |

**Implementation details:**

- **`handleThemeClientMatrix`'s parallel `Promise.all` block stays intact.** The inline `clientData` IIFE that fetches `clients(id, name)` continues to live in the handler — it's not generic enough to extract (it's specific to the matrix's need for *all* active clients in scope, not just clients that appear in `signal_themes`). Hoisting it would prematurely abstract.
- **No changes to `fetchSignalThemeRows`'s severity short-circuit.** When `severitySessionIds` is non-null and empty, the function returns `[]` — the three theme handlers all handle empty arrays correctly today. Already verified in `theme_trends` (returns `{ themes: [], buckets: [] }`) and `theme_client_matrix` (returns empty `themes`/`clients`/`cells`).

**LOC budget check:** themes module ~200 LOC; theme-helpers (already in `shared/`) ~140 LOC. Both well under the ceiling.

**Verify:**

- `npx tsc --noEmit` clean.
- Open the dashboard with theme widgets present and verify all three render identical data to a pre-cleanup snapshot. Test with `severity` and `confidenceMin` filters set — the join semantics must match exactly.
- Chat smoke test: ask "what are the top themes?" and confirm the `top_themes` tool returns identical results.

**Forward compatibility:** Adding a new theme widget action edits only `themes.ts` and the action map. The shared theme-join filter helper is the seam for new join filters.

---

### Increment 4 — Drill-down split with shared helper (P5.R1, P5.R4)

**What:** Move drill-down logic into three modules and deduplicate the ~40% overlap between `fetchDirectDrillDownRows` and `handleCompetitorDrillDown` via a shared row-fetch helper.

- `domains/drilldown.ts` — `handleDrillDown` (router), `drillDownSchema`, `buildFilterLabel`, `groupByClient`, `DRILL_DOWN_LIMIT`.
- `domains/drilldown-direct.ts` — `fetchDirectDrillDownRows`, `handleCompetitorDrillDown` reimplemented atop the shared helper.
- `domains/drilldown-theme.ts` — `fetchThemeDrillDownRows`.

**Why three modules instead of one:** dropping the entire drill-down family into a single file produces ~600 LOC, breaching the ~400-LOC ceiling. Splitting by strategy family (direct vs. theme) keeps each under the ceiling and aligns with the actual call graph in `handleDrillDown`.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/database-query/domains/drilldown.ts` | **Create** — router + schema + label + group helpers |
| `lib/services/database-query/domains/drilldown-direct.ts` | **Create** — direct-row fetcher + competitor variant + the shared helper they call |
| `lib/services/database-query/domains/drilldown-theme.ts` | **Create** — theme-row fetcher (calls `applyThemeJoinFilters`) |
| `lib/services/database-query-service.ts` | **Modify** — remove the drill-down bodies; `ACTION_MAP.drill_down` imports `handleDrillDown` |

**Shared helper contract (P5.R4):**

The dedupe target is the row-fetch + JSON-filter + row-building skeleton currently duplicated between `fetchDirectDrillDownRows` and `handleCompetitorDrillDown`. The helper accepts predicates and chunk-type filters as parameters, preserving every semantic difference between the two call paths:

```ts
// lib/services/database-query/domains/drilldown-direct.ts

interface SessionRow {
  id: string;
  session_date: string;
  client_id: string;
  structured_json: Record<string, unknown> | null;
  clients: { name: string } | null;
}

interface EmbeddingRow {
  id: string;
  session_id: string;
  chunk_text: string;
  chunk_type: string;
  metadata: Record<string, unknown> | null;
}

interface DrillDownFetchOptions {
  /** Optional client_id filter applied at the SQL level on sessions. */
  clientId?: string;
  /** Optional in-memory predicate to filter sessions before the embedding fetch. */
  sessionPredicate?: (session: SessionRow) => boolean;
  /** Optional chunk_type filter applied at the SQL level on session_embeddings. */
  embeddingChunkType?: string;
  /** Optional in-memory predicate to filter embeddings post-fetch. */
  embeddingPredicate?: (embedding: EmbeddingRow) => boolean;
}

/**
 * Shared row-fetch + filter + merge skeleton used by direct and competitor
 * drill-downs. Returns flat DrillDownRow[] sorted by session_date desc
 * (sort order inherited from the SQL `.order("session_date", { ascending: false })`).
 *
 * Behavior preservation contract (P5.R4):
 * - Session SQL: same select, same `.not("structured_json", "is", null)`,
 *   same baseSessionQuery filter chain, same order. clientId filter applied
 *   only if options.clientId is set.
 * - Session in-memory filter: only runs if options.sessionPredicate is set.
 *   Direct paths today use `=== ` (case-sensitive) on a scalar JSON field;
 *   competitor uses case-insensitive array search. The predicate encodes
 *   each call site's exact equality semantics — the helper does not impose
 *   a uniform comparison.
 * - Embedding SQL: same select, same in-clause on session_id, same team
 *   scoping (eq team_id when set, is null otherwise), same created_at desc
 *   order. chunk_type eq filter applied only if options.embeddingChunkType
 *   is set.
 * - Embedding in-memory filter: only runs if options.embeddingPredicate is
 *   set. Used by competitor today to match metadata.competitor case-
 *   insensitively.
 * - themeName is null on every returned row (direct drill-downs don't carry
 *   theme info; competitor matches a chunk_type, not a theme).
 */
async function fetchDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  options: DrillDownFetchOptions
): Promise<DrillDownRow[]> { /* see body sketch below */ }
```

**Helper body sketch (the four-step skeleton, parameterized):**

```ts
// 1. Sessions
let sessionQuery = baseSessionQuery(
  supabase
    .from("sessions")
    .select("id, session_date, client_id, structured_json, clients(name)")
    .not("structured_json", "is", null)
    .order("session_date", { ascending: false }),
  filters
);
if (options.clientId) {
  sessionQuery = sessionQuery.eq("client_id", options.clientId);
}
const { data: sessions, error: sessError } = await sessionQuery;
if (sessError) {
  console.error(`${LOG_PREFIX} drill_down session fetch error:`, sessError);
  throw new Error("Failed to fetch drill-down sessions");
}
if (!sessions || sessions.length === 0) return [];

// 2. Optional session-level predicate
let filtered = sessions as SessionRow[];
if (options.sessionPredicate) {
  filtered = filtered.filter(options.sessionPredicate);
}
if (filtered.length === 0) return [];

// 3. Embeddings
const sessionIds = filtered.map((s) => s.id);
const sessionLookup = new Map<string, SessionRow>();
for (const s of filtered) sessionLookup.set(s.id, s);

let embeddingQuery = supabase
  .from("session_embeddings")
  .select("id, session_id, chunk_text, chunk_type, metadata")
  .in("session_id", sessionIds)
  .order("created_at", { ascending: false });
if (options.embeddingChunkType) {
  embeddingQuery = embeddingQuery.eq("chunk_type", options.embeddingChunkType);
}
if (filters.teamId) {
  embeddingQuery = embeddingQuery.eq("team_id", filters.teamId);
} else {
  embeddingQuery = embeddingQuery.is("team_id", null);
}
const { data: embeddings, error: embError } = await embeddingQuery;
if (embError) {
  console.error(`${LOG_PREFIX} drill_down embedding fetch error:`, embError);
  throw new Error("Failed to fetch drill-down embeddings");
}

// 4. Merge with optional embedding-level predicate
const rows: DrillDownRow[] = [];
for (const emb of (embeddings ?? []) as EmbeddingRow[]) {
  if (options.embeddingPredicate && !options.embeddingPredicate(emb)) continue;
  const session = sessionLookup.get(emb.session_id);
  if (!session) continue;
  rows.push({
    embeddingId: emb.id,
    sessionId: emb.session_id,
    sessionDate: session.session_date,
    chunkText: emb.chunk_text,
    chunkType: emb.chunk_type,
    themeName: null,
    metadata: emb.metadata ?? {},
    clientId: session.client_id,
    clientName: session.clients?.name ?? "Unknown",
  });
}
return rows;
```

**Call-site rewrites:**

```ts
// fetchDirectDrillDownRows → thin wrapper retained for the router's switch arms
async function fetchDirectDrillDownRows(
  supabase: SupabaseClient,
  filters: QueryFilters,
  sessionFilter: { jsonField?: string; jsonValue?: string; clientId?: string }
): Promise<DrillDownRow[]> {
  return fetchDrillDownRows(supabase, filters, {
    clientId: sessionFilter.clientId,
    sessionPredicate:
      sessionFilter.jsonField && sessionFilter.jsonValue
        ? (s) =>
            (s.structured_json?.[sessionFilter.jsonField!] as string | undefined) ===
            sessionFilter.jsonValue
        : undefined,
  });
}

// handleCompetitorDrillDown → single helper call with the competitor-specific knobs
async function handleCompetitorDrillDown(
  supabase: SupabaseClient,
  filters: QueryFilters,
  competitor: string
): Promise<DrillDownRow[]> {
  const lower = competitor.toLowerCase();
  return fetchDrillDownRows(supabase, filters, {
    sessionPredicate: (s) => {
      const mentions = s.structured_json?.competitiveMentions as
        | Array<{ competitor?: string }>
        | undefined;
      return mentions?.some((m) => m.competitor?.toLowerCase() === lower) ?? false;
    },
    embeddingChunkType: "competitive_mention",
    embeddingPredicate: (emb) => {
      const meta = emb.metadata ?? {};
      const embCompetitor = (meta.competitor as string) ?? "";
      return embCompetitor.toLowerCase() === lower;
    },
  });
}
```

**Behavior preservation — the four asymmetries (audit):**

| Axis | Direct (sentiment/urgency/client) | Competitor | Preserved by |
|---|---|---|---|
| Session predicate equality | scalar `===` (case-sensitive) | array `.some()` with `.toLowerCase()` | `sessionPredicate` callback — each call site supplies its own |
| Optional `clientId` SQL filter | yes (client drill-down) | no | `options.clientId` is undefined for competitor |
| Embedding `chunk_type` SQL filter | none (all chunk types) | `eq("chunk_type", "competitive_mention")` | `options.embeddingChunkType` set only on competitor |
| Per-embedding metadata predicate | none | `metadata.competitor` case-insensitive match | `options.embeddingPredicate` set only on competitor |

These four axes are exhaustive — no other behavioral difference exists between the two functions. Verified by reading both bodies side by side (lines 1233–1361 vs. 1368–1500 in the current monolith).

**Theme drill-down stays separate.** `fetchThemeDrillDownRows` is structurally different — it joins `signal_themes ⨝ session_embeddings ⨝ sessions` rather than fetching sessions first then embeddings. Forcing it through the shared helper would either produce a fundamentally different SQL plan or add too many opt-in parameters. P5.R4 explicitly scopes the dedupe to the direct/competitor pair; theme drill-down lives in `drilldown-theme.ts` and reuses `applyThemeJoinFilters` from `shared/theme-helpers.ts` (Increment 1) for its team/date/clientIds filter chain — that's the DRY win for the theme branch.

**`handleDrillDown` router stays the same.** The Zod-validated discriminated-union dispatch remains in `drilldown.ts`; only the imports change to point at `drilldown-direct.ts` / `drilldown-theme.ts`. The 7-strategy switch is unchanged.

**LOC budget check:** drilldown.ts ~180, drilldown-direct.ts ~150 (after dedupe — down from ~280 combined), drilldown-theme.ts ~180. All under the ceiling. Total drill-down LOC reduces by ~120 from the dedupe.

**Verify:**

- `npx tsc --noEmit` clean.
- **Pre/post diff snapshots for all seven drill-down strategies.** Before opening the PR, capture JSON output of `executeQuery` for each strategy with a representative payload against a fixture dataset:
  1. `{ type: "sentiment", value: "negative" }`
  2. `{ type: "urgency", value: "critical" }`
  3. `{ type: "client", clientId: "<id>", clientName: "<name>" }`
  4. `{ type: "competitor", competitor: "Acme" }` — verify case-insensitive matching by also testing `competitor: "acme"` and `competitor: "ACME"`
  5. `{ type: "theme", themeId: "<id>", themeName: "<name>" }`
  6. `{ type: "theme_bucket", themeId: "<id>", themeName: "<name>", bucket: "2026-04-20" }`
  7. `{ type: "theme_client", themeId: "<id>", themeName: "<name>", clientId: "<id>", clientName: "<name>" }`
- After the PR's last commit, re-run each capture against the same fixture dataset and `diff` the JSON. Required: byte-identical output.
- Manual UI smoke: dashboard widget click → drill-down panel renders the same `filterLabel`, same `totalSignals`, same `totalClients`, same client ordering.

**Forward compatibility:**

- Adding a new direct drill-down variant (e.g., `{ type: "blocker_severity", value: "high" }`) is a new switch arm in `drilldown.ts` plus a new `fetchDrillDownRows(...)` call with a `sessionPredicate` — no other modules touched.
- The shared helper's option shape is the migration boundary if the schema-driven filter approach in the backlog ever lands.

---

### Increment 5 — Session-detail + insights; collapse the monolith; redirect consumers (P5.R1, P5.R5, P5.R6, P5.R7)

**What:** Move the last two domain modules, lift `executeQuery` and the `ACTION_MAP` into `execute-query.ts`, expose the public surface from `index.ts`, delete `database-query-service.ts`, and redirect the three consumers' imports.

**Files changed:**

| File | Action |
|------|--------|
| `lib/services/database-query/domains/session-detail.ts` | **Create** — `handleSessionDetail` |
| `lib/services/database-query/domains/insights.ts` | **Create** — `handleInsightsLatest`, `handleInsightsHistory` |
| `lib/services/database-query/execute-query.ts` | **Create** — `ACTION_MAP`, `executeQuery`. Imports every handler from its domain module |
| `lib/services/database-query/index.ts` | **Create** — re-exports the public surface (`executeQuery`, `QueryAction`, `QueryFilters`, `DatabaseQueryResult`, `ACTION_METADATA`, `CHAT_TOOL_ACTIONS`, `ChatToolAction`, `buildChatToolDescription`) |
| `lib/services/database-query-service.ts` | **Delete** |
| `app/api/dashboard/route.ts` | **Modify** — change import from `@/lib/services/database-query-service` to `@/lib/services/database-query` |
| `lib/services/chat-stream-service.ts` | **Modify** — same import path swap, both import statements (lines 22 and 35) |
| `lib/services/insight-service.ts` | **Modify** — same import path swap (line 14) |

**`execute-query.ts` shape:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOG_PREFIX } from "./action-metadata";
import type { QueryAction, QueryFilters, DatabaseQueryResult } from "./types";
import { handleCountClients, handleCountSessions, handleSessionsPerClient, handleClientList } from "./domains/counts";
import { handleSentimentDistribution, handleUrgencyDistribution, handleCompetitiveMentionFrequency } from "./domains/distributions";
import { handleRecentSessions, handleSessionsOverTime, handleClientHealthGrid } from "./domains/sessions";
import { handleTopThemes, handleThemeTrends, handleThemeClientMatrix } from "./domains/themes";
import { handleDrillDown } from "./domains/drilldown";
import { handleSessionDetail } from "./domains/session-detail";
import { handleInsightsLatest, handleInsightsHistory } from "./domains/insights";

const ACTION_MAP: Record<
  QueryAction,
  (supabase: SupabaseClient, filters: QueryFilters) => Promise<Record<string, unknown>>
> = {
  count_clients: handleCountClients,
  count_sessions: handleCountSessions,
  sessions_per_client: handleSessionsPerClient,
  sentiment_distribution: handleSentimentDistribution,
  urgency_distribution: handleUrgencyDistribution,
  recent_sessions: handleRecentSessions,
  client_list: handleClientList,
  sessions_over_time: handleSessionsOverTime,
  client_health_grid: handleClientHealthGrid,
  competitive_mention_frequency: handleCompetitiveMentionFrequency,
  top_themes: handleTopThemes,
  theme_trends: handleThemeTrends,
  theme_client_matrix: handleThemeClientMatrix,
  drill_down: handleDrillDown,
  session_detail: handleSessionDetail,
  insights_latest: handleInsightsLatest,
  insights_history: handleInsightsHistory,
};

export async function executeQuery(
  supabase: SupabaseClient,
  action: QueryAction,
  filters: QueryFilters
): Promise<DatabaseQueryResult> {
  console.log(
    `${LOG_PREFIX} executeQuery — action: ${action}, teamId: ${filters.teamId ?? "personal"}, filters: ${JSON.stringify({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      clientName: filters.clientName,
      clientIds: filters.clientIds,
      severity: filters.severity,
      urgency: filters.urgency,
      granularity: filters.granularity,
      confidenceMin: filters.confidenceMin,
      drillDown: filters.drillDown ? "(present)" : undefined,
      sessionId: filters.sessionId,
    })}`
  );

  const handler = ACTION_MAP[action];
  if (!handler) {
    console.error(`${LOG_PREFIX} unknown action: ${action}`);
    throw new Error(`Unknown query action: ${action}`);
  }

  const start = Date.now();
  const data = await handler(supabase, filters);
  const elapsed = Date.now() - start;

  console.log(
    `${LOG_PREFIX} executeQuery — action: ${action} completed in ${elapsed}ms`
  );

  return { action, data };
}
```

LOC: ~80 — comfortably under the 300-LOC ceiling for the router (P5.R5).

**`index.ts` shape:**

```ts
export { executeQuery } from "./execute-query";
export type { QueryAction, QueryFilters, DatabaseQueryResult } from "./types";
export {
  ACTION_METADATA,
  CHAT_TOOL_ACTIONS,
  buildChatToolDescription,
  type ChatToolAction,
} from "./action-metadata";
```

This is the entire surface that the three consumers depend on — verified by `grep -rn "from \"@/lib/services/database-query-service\"" app lib`. Nothing else is exported.

**Consumer-import edits:**

Each of the three consumers has one or two import statements to update. The path changes from `@/lib/services/database-query-service` to `@/lib/services/database-query`. Symbol names are unchanged. The imports resolve to `index.ts` via the directory entry-point convention.

```diff
- import { executeQuery, type QueryAction, type QueryFilters } from "@/lib/services/database-query-service";
+ import { executeQuery, type QueryAction, type QueryFilters } from "@/lib/services/database-query";
```

(Same shape for the other two consumers; `chat-stream-service.ts` has two import lines and both update.)

**`assertChatToolActionsInSync` invocation.** The dev-time check fires at module load on `action-metadata.ts`. After Increment 5, importing `index.ts` transitively imports `action-metadata.ts` (via `execute-query.ts` and the export re-statement). The check still runs exactly once per process in non-production builds — verified by adding a `console.log("registry sync check ran")` at the top of `assertChatToolActionsInSync` and confirming a single emission on a dev-server boot. (Remove the temp log before merging.)

**Verify (end-to-end behavior parity — P5.R6):**

This increment is the moment to prove "no behavior change." Before opening the PR:

1. **Capture pre-cleanup outputs.** With `main` (or the commit before this part starts), run a fixture script that calls `executeQuery` for every `QueryAction` value with a representative filter payload — including the 7 drill-down strategies from Increment 4. Save each result as JSON under `tmp/p5-snapshots/<action>.json`.
2. **Capture post-cleanup outputs.** With this PR's branch, re-run the same fixture script. Save under `tmp/p5-snapshots/post/<action>.json`.
3. **Diff.** `diff -r tmp/p5-snapshots tmp/p5-snapshots/post` must be empty.
4. **Manual UI walkthrough.** Open the dashboard with all widgets present. Click each widget for a drill-down. Verify the panel renders identical totals, ordering, and filter labels. Open the chat and ask quantitative questions that exercise each LLM-exposed action; verify replies are equivalent (LLM phrasing varies, but the underlying tool result is byte-identical).
5. **Insight refresh path.** Trigger `maybeRefreshDashboardInsights` (e.g., create a session with structured signals) and verify the insight generation continues to call `executeQuery` and produces the same insight content (modulo nondeterministic LLM output — verify the *aggregates passed to the LLM* are identical via the existing log line in `insight-service.ts`).

**P5.R7 walkthrough (adding a hypothetical action):**

Documented as a checklist item, not an actual code change: to add `count_archived_sessions`,
1. Add `"count_archived_sessions"` to the `QueryAction` union in `types.ts`.
2. Add an `ACTION_METADATA` entry in `action-metadata.ts`. (TypeScript flags any miss.)
3. Add `handleCountArchivedSessions` to `domains/counts.ts`.
4. Add `count_archived_sessions: handleCountArchivedSessions` to `ACTION_MAP` in `execute-query.ts`.
5. If LLM-exposed, add it to `CHAT_TOOL_ACTIONS_TUPLE` in `action-metadata.ts`. The `assertChatToolActionsInSync` dev-time check guards against tuple/registry drift.

Files touched: `types.ts`, `action-metadata.ts`, `domains/counts.ts`, `execute-query.ts` — exactly the modules predicted by P5.R7. No theme/insight/drill-down module touched.

**Forward compatibility:**

- **Streaming actions.** If a future action returns a stream rather than a single `Record<string, unknown>` (e.g., paginated insights), the entry shape changes — `ACTION_MAP`'s value type widens to a union, and `executeQuery` learns to dispatch by return type. Out of scope.
- **Per-action telemetry.** A future "log per-action latency to a metrics sink" requirement edits `executeQuery` only — no domain module touched.
- **Tool-tier routing.** If LLM-exposed vs. UI-only actions ever diverge in their access pattern (e.g., LLM actions need additional rate limiting), the seam is the `ACTION_METADATA.llmToolExposed` flag — a thin wrapper around `executeQuery` reads it and gates the call.

---

## Part 5 — End-of-part audit checklist

Per CLAUDE.md, after Increment 5 lands:

- [ ] **SRP.** Each domain module owns one query family. The `execute-query.ts` router only dispatches; no business logic. Shared modules (`base-query-builder`, `severity-filter`, `row-helpers`, `theme-helpers`) own one cross-cutting concern each.
- [ ] **DRY.** The drill-down direct/competitor row-fetch + filter + merge skeleton appears in exactly one place (`fetchDrillDownRows` in `drilldown-direct.ts`). Theme/date/clientIds filtering on signal_themes joins lives in `applyThemeJoinFilters`. Severity filtering lives in one module with three named exports for three call patterns.
- [ ] **LOC.** `wc -l` on every file under `lib/services/database-query/`: each handler/shared module ≤ 400 LOC; `execute-query.ts` ≤ 300 LOC. The deleted `database-query-service.ts` (2,036 LOC) does not exist.
- [ ] **Behavior parity.** Pre/post snapshot diff (Increment 5 verification step 3) is empty for all 17 actions and all 7 drill-down strategies.
- [ ] **Logging.** `LOG_PREFIX` is `"[database-query-service]"` everywhere — domain modules emit identical log strings to pre-cleanup. The `executeQuery` entry/exit logs match verbatim.
- [ ] **Dead code.** `database-query-service.ts` is deleted. `grep -rn "database-query-service" app lib --include="*.ts"` returns zero hits. The three legacy severity helper names (`sessionHasSignalWithSeverity`, `applySeverityRowFilter`, `fetchSessionIdsMatchingSeverity`) are gone.
- [ ] **Convention compliance.** All new files are kebab-case (`base-query-builder.ts`, `drilldown-direct.ts`, etc.). All exported functions use camelCase, types/interfaces PascalCase. Named exports only (no default exports). Import order follows the project convention.
- [ ] **`any` annotations carried over.** The `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments on the Supabase query-builder helpers are present in their new homes. Part 1's audit holds.
- [ ] **Type safety.** `npx tsc --noEmit` (strict) and `npm run build` both clean.
- [ ] **Dev-time registry sync check.** `assertChatToolActionsInSync` still runs at module load in dev. Verified by adding a temporary `console.log` and observing one emission per process boot; temp log removed before merge.

After Part 5 completes:

- [ ] Update `ARCHITECTURE.md` file map: replace the `database-query-service.ts` entry (line 372) with the new directory tree under `lib/services/database-query/`. Each new file gets a one-line description matching the depth of the existing entry.
- [ ] Update Decision #14 ("Chat data isolation") in `ARCHITECTURE.md`: any reference to `database-query-service.ts` becomes `lib/services/database-query/` (or, where the discussion is about the action registry, `database-query/action-metadata.ts`).
- [ ] Add a `CHANGELOG.md` entry for PRD-023 P5: split monolith into directory-per-domain; deduped drill-down direct/competitor; collapsed three severity helpers into one cohesive module; LOC reduction (~2,036 → ~80 router + ~1,800 spread across 14 files); zero behavior change.
- [ ] Verify no doc references to "the 2,000-line query service" remain in any in-repo doc. Update `gap-analysis.md` if it points at line numbers in the old file.
- [ ] Run `npx tsc --noEmit` and `npm run build` for a final clean check.

---

## Forward references to later parts (Part 5)

- **→ Part 6 (capture row decomposition).** Independent. The row component does not call any query-service action.
- **→ Part 7 (optimistic mutation hook).** Independent. The hook touches conversations and team members; neither flows through the query service.
- **→ Part 8 (`ai-service` consolidation).** Independent. The AI service is upstream of `executeQuery` calls (e.g., `insight-service` calls `callModelObject` and `executeQuery` in sequence); Part 5's split doesn't change the call contract.
- **→ Part 9 (smaller cleanups).** Independent. The session-service staleness decomposition (P9.R5) and the prompt-version consolidation (P9.R1) do not interact with the query service.
- **→ Part 10 (docs refresh).** The directory tree, the deleted file, and the updated Decision #14 wording all flow into the docs refresh. Architecture-map walk after Part 5 must reflect the new layout.
- **→ Backlog.** Items surfaced during Part 5 planning that don't fit the cleanup scope:
  1. **Schema-driven action registry.** Instead of three places to update (`QueryAction`, `ACTION_METADATA`, `ACTION_MAP`), a config object keyed by action name with `{ description, llmToolExposed, handler }` reduces it to one. Defer — current TypeScript-error-on-miss already prevents drift, and the redundancy is small.
  2. **Per-action latency metrics.** `executeQuery` already logs elapsed ms; sending those to a metrics sink is a structured-logger requirement (already on the master backlog).
  3. **Streaming insights.** `insights_latest` and `insights_history` could stream — would change `ACTION_MAP`'s return type to a union. Out of scope until a UI requirement appears.
  4. **Linting `@typescript-eslint/no-explicit-any` as `error`.** Part 1's note carries through; Part 5's split moves the annotated `any`s but doesn't change their count. Lint-rule activation is the master-backlog item.
