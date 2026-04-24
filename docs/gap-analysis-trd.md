# Gap Analysis — TRD

> Technical design for the fixes captured in `docs/gap-analysis.md`.
> Mirrors that doc's Engineering / Product structure 1:1. Parts whose "Fix" section has been locked in the gap file get a full technical plan here; others are placeholders awaiting fix approval in the gap file.
> `gap-analysis.md` is the PRD-equivalent (gap = problem, Fix section = PRD). This file is the TRD.

---

## Engineering Fixes

### E1 — `signOut()` doesn't clear `active_team_id` cookie ✅ Fixed
Implemented. `components/providers/auth-provider.tsx` — `signOut()` calls `clearActiveTeamCookie()` before resolving.

### E2 — Fire-and-forget chain is unsafe on Vercel free tier
_Fix not yet defined in gap file. TRD pending._

### E3 — No rate limiting on AI endpoints
_Fix not yet defined in gap file. TRD pending._

### E4 — `queryDatabase` chat tool frozen at 7 actions; service has 17
_Fix not yet defined in gap file. TRD pending._

### E5 — No dev/prod database separation
_Fix not yet defined in gap file. TRD pending._

### E6 — Supabase storage not cleaned on session soft-delete
_Fix not yet defined in gap file. TRD pending._

### E7 — `MAX_COMBINED_CHARS` is a single static value for every model
_Fix not yet defined in gap file. TRD pending._

### E8 — `stopWhen: stepCountIs(3)` limits complex chat queries
_Fix not yet defined in gap file. TRD pending._

### E9 — Re-extraction race condition within teams
_Fix not yet defined in gap file. TRD pending._

### E10 — Theme taxonomy grows noisy with no deduplication
_Fix not yet defined in gap file. TRD pending._

### E11 — No observability layer
_Fix not yet defined in gap file. TRD pending._

### E12 — Embedding dimension migration has no documented path
_Fix not yet defined in gap file. TRD pending._

### E13 — No automated test suite
_Fix not yet defined in gap file. TRD pending._

---

## Product Fixes

### P1 — Master Signals page — UI retired; backend intentionally retained ✅ Decided
No further technical work in scope. A future cleanup PRD will either revive the UI or remove the backend (incl. a data migration for `master_signals`).

### P2 — Post-login redirect lands on Capture, not Dashboard ✅ Fixed
Implemented. `DEFAULT_AUTH_ROUTE` + `ONBOARDING_ROUTE` constants in `lib/constants.ts`; auth callback picks based on session count.

### P3 — Chat can't answer theme or competitive questions
_Fix not yet defined in gap file. TRD pending. (Blocked on E4 design — share a `QueryAction` source of truth.)_

### P4 — Starter questions are hardcoded and workspace-blind
_Fix not yet defined in gap file. TRD pending._

### P5 — No shared filter-persistence pattern across surfaces

**Scope.** A shared sessionStorage-based persistence primitive for filter state, consumable by any filtered surface regardless of whether that surface stores filters in the URL (dashboard) or local React state (capture past-sessions). URL remains source of truth for rendering/sharing where it's used; storage is purely a rehydration layer.

**Key format:** `filters:<surface>:<userId>:<workspaceId ?? "personal">`
- `userId` isolates users on a shared tab.
- `workspaceId` gives per-workspace memory; `"personal"` sentinel for null.
- Both segments present → stale keys from logged-out users are inert (different `userId` = never read by a subsequent user).

**Files changed.**
- **New:** `lib/hooks/use-filter-storage.ts` — the primitive hook.
- **Modified:** `components/providers/auth-provider.tsx` — `setActiveTeam()` calls `router.replace(pathname)` to strip stale URL query params on workspace switch.
- **Modified:** `app/dashboard/_components/filter-bar.tsx` — wires URL ↔ storage via the hook.
- **Modified:** `app/capture/_components/past-sessions-table.tsx` — wires React state ↔ storage via the hook.

**No database changes. No API changes. No prompt changes.**

**Implementation increments.**

**Increment 1 — Primitive hook (`lib/hooks/use-filter-storage.ts`).**
Shape:
```ts
interface UseFilterStorageReturn<T> {
  /** null until user loads, then stable until user or workspace changes */
  key: string | null;
  read: () => T | null;
  write: (value: T) => void;
}

function useFilterStorage<T>(surface: string): UseFilterStorageReturn<T>
```
- Derives key from `useAuth()` — `filters:${surface}:${user.id}:${activeTeamId ?? "personal"}`.
- Returns `key: null` while `user` is not yet loaded; `read`/`write` become no-ops in that state so callers never crash.
- SSR guard: both ops check `typeof window !== "undefined"`.
- JSON parse/stringify for values; caught with a debug warn on failure, returns `null`.
- Logs prefix `[useFilterStorage]` at debug level; no-op on production console clutter.

Why a primitive (not a `usePersistedFilters` state-style hook): the two initial consumers have different source-of-truth models (URL vs. React state). A narrow primitive lets each surface wire its own sync policy without the hook making assumptions. If more surfaces emerge and duplication grows, extract a state-style variant then.

**Increment 2 — Auth provider URL strip on workspace switch.**
Modify `setActiveTeam()` in `components/providers/auth-provider.tsx`:
- After `setActiveTeamId(teamId)`, call `router.replace(pathname)` to drop all query params (requires `usePathname()`).
- Rationale: prevents workspace A's URL filter params from applying to workspace B's refetched data. Per the gap-file contract — "switching workspaces is as good as signing out of one team and into another" — the URL is part of what gets reset.
- Non-filter query params on other pages (if any emerge later) would also be stripped. Accepted tradeoff for a uniform policy; flag if a page needs query-param survival across workspace switches.

**Increment 3 — Wire `filter-bar.tsx` (dashboard, URL-based).**
Use the primitive:
```ts
const filterStorage = useFilterStorage<Record<string, string>>("dashboard");
```
Two effects:
1. **Hydrate on key change with empty URL.** When `filterStorage.key` changes (mount, workspace switch, user change), if the URL has no filter params, read storage; if a stored value exists, `router.replace("/dashboard?<params>")`.
2. **Mirror URL → storage.** Whenever `searchParams` changes, write the current filter param subset to storage.

Filter keys tracked: `clients`, `dateFrom`, `dateTo`, `severity`, `urgency` (what `FilterBar` already reads).

**Increment 4 — Wire `past-sessions-table.tsx` (capture, state-based).**
Use the primitive:
```ts
const filterStorage = useFilterStorage<SessionFiltersState>("capture-sessions");
```
Two effects:
1. **Hydrate on key change.** When `filterStorage.key` changes, read storage; call `setFilters(stored ?? defaultFilters)`. This also covers workspace switch — the key changes, state resets to the new workspace's stored value (or defaults).
2. **Mirror state → storage.** Wrap `handleFiltersChange` to call `filterStorage.write(newFilters)` in addition to `setFilters(newFilters)`.

Default filter value stays `{ dateFrom: "", dateTo: "" }` as currently defined.

**End-of-part audit:**
- **SRP.** Hook owns storage I/O only. Auth provider owns URL strip only. Each surface owns its own sync policy.
- **DRY.** Storage-key derivation and SSR/auth guards live once in the hook. Surfaces share the same primitive.
- **Design tokens.** No style changes.
- **Logging.** Hook logs key read/write failures. Auth provider existing logs untouched.
- **Dead code.** No removals.
- **Convention compliance.** `"use client"`, named export, `use-filter-storage.ts` (kebab-case file), `useFilterStorage` (use-prefix function), returns an object.

**Documentation updates after the part:**
- `ARCHITECTURE.md` — add `use-filter-storage.ts` to the hooks file map; add a "Filter persistence contract" note under Key Design Decisions (key format, workspace-switch behavior, per-surface consumption pattern).
- `CHANGELOG.md` — entry under `[Unreleased]`: "Filter persistence — shared `useFilterStorage` hook with user+workspace-keyed sessionStorage. Dashboard and capture past-sessions now restore filters on return; workspace switch clears URL filter params."
- `gap-analysis.md` — mark P5 with ✅ Fixed.

**Verification:** `npx tsc --noEmit` passes; manual smoke — apply filter on dashboard → navigate away → return → filter restored; switch workspace → filter cleared; log out then log in as different user on same tab → clean slate.

### P7 — No feedback loop from manual signal edits
_Fix not yet defined in gap file. TRD pending._

### P8 — Master Signal cold-start corpus is unbounded
_Fix not yet defined in gap file. TRD pending._
