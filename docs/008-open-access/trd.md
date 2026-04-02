# TRD-008: Open Access — Remove Domain Restriction and Per-User Data Isolation

> **Status:** Draft
> **PRD:** `docs/008-open-access/prd.md` (approved)
> **Mirrors:** PRD Parts 1, 2, 3

---

## Part 1: Remove Email Domain Restriction

### Technical Decisions

- **Simplify the callback route.** Remove the `getUser()` call and domain check entirely. After a successful code exchange, redirect straight to `/capture`. The `getUser()` call was only there to read the email domain — Supabase Auth handles session creation during `exchangeCodeForSession()`.
- **Delete `lib/constants.ts`.** Its only export was `ALLOWED_EMAIL_DOMAIN`. No other file depends on it.
- **Clean up the login page.** Remove the `domain_restricted` error block. Keep the other error states (`missing_code`, `exchange_failed`) since those are still valid.

### Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `app/auth/callback/route.ts` | Remove domain check, remove `ALLOWED_EMAIL_DOMAIN` import |
| Modify | `app/login/page.tsx` | Remove `domain_restricted` error block |
| Delete | `lib/constants.ts` | Only export was `ALLOWED_EMAIL_DOMAIN` |
| Modify | `.env.example` | Remove `ALLOWED_EMAIL_DOMAIN` line |
| Modify | `ARCHITECTURE.md` | Remove `ALLOWED_EMAIL_DOMAIN` from env vars table, update auth flow description |
| Modify | `CLAUDE.md` | Remove domain restriction references |

### Implementation Increments

#### Increment 1.1: Remove Domain Restriction

**PR scope:** All Part 1 changes in a single increment.

**Steps:**

1. Modify `app/auth/callback/route.ts`: remove the `ALLOWED_EMAIL_DOMAIN` import, remove the `getUser()` call and domain check block (lines 23–46). After successful `exchangeCodeForSession()`, redirect to `/capture`.
2. Modify `app/login/page.tsx`: remove the `domain_restricted` error block (lines 34–38).
3. Delete `lib/constants.ts`.
4. Modify `.env.example`: remove the `ALLOWED_EMAIL_DOMAIN=inmobi.com` line.
5. Update `ARCHITECTURE.md`: remove `ALLOWED_EMAIL_DOMAIN` from the environment variables table, update the authentication flow to remove domain check steps.
6. Update `CLAUDE.md`: remove the domain restriction rule under the authentication section.

**Verify:**
- App compiles with no import errors
- Sign in with any Google account reaches `/capture`
- No references to `ALLOWED_EMAIL_DOMAIN` in codebase (`rg ALLOWED_EMAIL_DOMAIN`)
- Login page shows no domain-related error UI

---

## Part 2: Per-User Data Isolation

### Technical Decisions

- **RLS does the heavy lifting.** Adding `created_by = auth.uid()` to SELECT and UPDATE policies on `sessions`, `master_signals`, and `clients` means every query through `createClient()` (the publishable key client) automatically scopes to the current user. No service layer query changes needed.
- **`clients` gets a `created_by` column.** Currently `clients` has no ownership. Add `created_by UUID NOT NULL DEFAULT auth.uid()` and update the unique index to `(LOWER(name), created_by)` so two users can have the same client name.
- **`prompt_versions` gets a `created_by` column.** Add `created_by UUID DEFAULT auth.uid()` (nullable for existing system-seeded rows). Update the partial unique index to `(prompt_key, created_by) WHERE is_active = true`.
- **`taintLatestMasterSignal` needs a userId parameter.** Since `deleteSession` uses the service role client (bypasses RLS), the taint function must explicitly filter by `created_by` to target the correct user's master signal. The session deletion service passes the user ID from the session's `created_by` field.
- **`getActivePrompt` switches to `createClient()`.** Instead of the service role client, use the user-scoped client so RLS returns only the current user's active prompt. The hardcoded fallback handles the case where no user-specific prompt exists.
- **`savePromptVersion` switches to `createClient()`.** The deactivate + insert flow works through RLS since the user owns both the old and new rows. No service role needed.
- **Existing system-seeded prompt rows.** The 3 seed rows in `prompt_versions` have `created_by = NULL` (system-seeded, no user). After the RLS change, these rows are invisible to all users via `created_by = auth.uid()`. This is correct — new users fall back to hardcoded prompts. The seed rows become historical artifacts.

### Database Migrations

**Migration 1: Add `created_by` to `clients` + update RLS and index**

```sql
-- Add created_by column to clients
ALTER TABLE clients
  ADD COLUMN created_by UUID NOT NULL DEFAULT auth.uid();

-- Drop old unique index (global name uniqueness)
DROP INDEX clients_name_unique;

-- Create per-user unique index
CREATE UNIQUE INDEX clients_name_unique
  ON clients (LOWER(name), created_by)
  WHERE deleted_at IS NULL;

-- Drop old RLS policies
DROP POLICY "Authenticated users can read clients" ON clients;
DROP POLICY "Authenticated users can update clients" ON clients;

-- Per-user SELECT
CREATE POLICY "Users can read own clients"
  ON clients FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND created_by = auth.uid());

-- Per-user UPDATE
CREATE POLICY "Users can update own clients"
  ON clients FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND created_by = auth.uid())
  WITH CHECK (true);
```

**Migration 2: Update `sessions` RLS policies**

```sql
-- Drop old RLS policies
DROP POLICY "Authenticated users can read sessions" ON sessions;
DROP POLICY "Authenticated users can update sessions" ON sessions;

-- Per-user SELECT
CREATE POLICY "Users can read own sessions"
  ON sessions FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND created_by = auth.uid());

-- Per-user UPDATE
CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND created_by = auth.uid())
  WITH CHECK (true);
```

**Migration 3: Update `master_signals` RLS policy**

```sql
-- Drop old SELECT policy
DROP POLICY "Authenticated users can read master signals" ON master_signals;

-- Per-user SELECT
CREATE POLICY "Users can read own master signals"
  ON master_signals FOR SELECT TO authenticated
  USING (created_by = auth.uid());
```

**Migration 4: Add `created_by` to `prompt_versions` + update RLS and index**

```sql
-- Add created_by column (nullable for existing system-seeded rows)
ALTER TABLE prompt_versions
  ADD COLUMN created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

-- Drop old unique index
DROP INDEX prompt_versions_active_unique;

-- Create per-user unique index (NULL created_by excluded — system rows don't conflict)
CREATE UNIQUE INDEX prompt_versions_active_unique
  ON prompt_versions (prompt_key, created_by)
  WHERE is_active = true AND created_by IS NOT NULL;

-- Drop old RLS policies
DROP POLICY "Authenticated users can read active prompts" ON prompt_versions;
DROP POLICY "Admins can read all prompt versions" ON prompt_versions;
DROP POLICY "Admins can insert prompt versions" ON prompt_versions;
DROP POLICY "Admins can update prompt versions" ON prompt_versions;

-- Per-user SELECT (own rows only)
CREATE POLICY "Users can read own prompt versions"
  ON prompt_versions FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- Per-user INSERT
CREATE POLICY "Users can insert own prompt versions"
  ON prompt_versions FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Per-user UPDATE (deactivate own prompts)
CREATE POLICY "Users can update own prompt versions"
  ON prompt_versions FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
```

### Service Layer Changes

#### `lib/services/master-signal-service.ts`

- **`taintLatestMasterSignal(userId: string)`** — add a `userId` parameter. Filter the "get latest" query by `.eq("created_by", userId)` so it targets the correct user's master signal. Still uses the service role client (called from `deleteSession` which bypasses RLS).

#### `lib/services/session-service.ts`

- **`deleteSession`** — after fetching the session (which includes `created_by`), pass the session's `created_by` value to `taintLatestMasterSignal(session.created_by)`.
- Add `created_by` to the select in the delete query: `.select("id, structured_notes, created_by")`.

#### `lib/services/prompt-service.ts`

- **`getActivePrompt()`** — change from `createServiceRoleClient()` to `await createClient()`. RLS scopes to the current user's prompts. Returns `null` if no user-specific prompt exists, triggering the hardcoded fallback.
- **`getPromptHistory()`** — no change needed. Already uses `createClient()`.
- **`savePromptVersion()`** — change from `createServiceRoleClient()` to `await createClient()`. The deactivate step filters by `prompt_key` and `is_active = true` — RLS ensures it only touches the current user's row. The insert auto-sets `created_by` via the database default.

#### `lib/services/client-service.ts`

- No changes needed. `createClient()` is already used. RLS handles per-user scoping.

### Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `lib/services/master-signal-service.ts` | `taintLatestMasterSignal` takes `userId`, filters by `created_by` |
| Modify | `lib/services/session-service.ts` | Pass `created_by` to taint function, select `created_by` in delete |
| Modify | `lib/services/prompt-service.ts` | `getActivePrompt` and `savePromptVersion` switch to `createClient()` |

### Implementation Increments

#### Increment 2.1: Database Migrations

**PR scope:** Run all 4 migrations in Supabase SQL Editor.

**Verify:**
- All tables have correct RLS policies (check via Supabase dashboard)
- `clients` and `prompt_versions` have `created_by` column
- Unique indexes are updated

#### Increment 2.2: Service Layer Changes

**PR scope:** Update `master-signal-service.ts`, `session-service.ts`, `prompt-service.ts`.

**Steps:**

1. Modify `taintLatestMasterSignal` to accept `userId: string` parameter. Add `.eq("created_by", userId)` to the latest master signal query.
2. Modify `deleteSession` to select `created_by` and pass it to `taintLatestMasterSignal(data.created_by)`.
3. Modify `getActivePrompt` to use `await createClient()` instead of `createServiceRoleClient()`. Make the function async (it already returns a Promise).
4. Modify `savePromptVersion` to use `await createClient()` instead of `createServiceRoleClient()`.

**Verify:**
- TypeScript compiles
- Signal extraction falls back to hardcoded prompt for users with no custom prompts
- Deleting a session with signals taints only the deleting user's master signal

---

## Part 3: Remove Admin Role System

### Technical Decisions

- **Remove all `isAdmin` checks from application code.** RLS now handles access control — the admin gate is redundant.
- **Keep `is_admin` column and `is_admin()` SQL function in the database.** Dropping them requires a migration and may break existing RLS policies during the transition. They're harmless to leave and can be cleaned up later.
- **Delete `use-profile.ts` hook entirely.** Its only purpose was fetching the admin flag.
- **Simplify `AuthProvider`.** Remove `isAdmin` from the context value, remove the `useProfile` import, remove `isProfileLoading` from the `isLoading` calculation.
- **`profile-service.ts` keeps `getCurrentProfile()`, removes `isCurrentUserAdmin()`.** The profile fetch is still useful for other purposes (e.g., displaying user email). Only the admin check function is removed.

### Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `app/settings/page.tsx` | Remove `isCurrentUserAdmin` import and check, always render `PromptEditorPageContent` |
| Modify | `components/layout/tab-nav.tsx` | Always include Settings tab, remove `useAuth` import and `isAdmin` check |
| Modify | `app/api/prompts/route.ts` | Remove `isCurrentUserAdmin` import and admin checks from GET and POST |
| Modify | `components/providers/auth-provider.tsx` | Remove `isAdmin`, `useProfile` import, `isProfileLoading` |
| Delete | `lib/hooks/use-profile.ts` | No longer needed |
| Modify | `lib/services/profile-service.ts` | Remove `isCurrentUserAdmin()` |

### Implementation Increments

#### Increment 3.1: Remove Admin Gating

**PR scope:** All Part 3 changes in a single increment.

**Steps:**

1. Modify `app/settings/page.tsx`: remove `isCurrentUserAdmin` import. Remove the admin check and access-denied block. Always render `<PromptEditorPageContent />`.
2. Modify `components/layout/tab-nav.tsx`: remove `useAuth` import and `isAdmin` destructure. Always include `settingsTab` in the `tabs` array. Merge `baseTabs` and `settingsTab` into a single `tabs` constant.
3. Modify `app/api/prompts/route.ts`: remove `isCurrentUserAdmin` import. Remove the admin check blocks from both GET and POST handlers.
4. Modify `components/providers/auth-provider.tsx`: remove `useProfile` import. Remove `isAdmin` and `isProfileLoading` from the component. Remove `isAdmin` from the `AuthContextValue` interface. Change `isLoading` to just use the auth loading state.
5. Delete `lib/hooks/use-profile.ts`.
6. Modify `lib/services/profile-service.ts`: remove `isCurrentUserAdmin()` function. Keep `getCurrentProfile()`.

**Verify:**
- TypeScript compiles with no errors
- Any authenticated user can access `/settings`
- Settings tab visible in navigation for all users
- Prompt API routes accept requests from any authenticated user
- No references to `isCurrentUserAdmin` or `isAdmin` in application code (`rg isAdmin`, `rg isCurrentUserAdmin`)

---

## Documentation Updates

After all increments are complete:

1. **`ARCHITECTURE.md`** — Update:
   - Remove `ALLOWED_EMAIL_DOMAIN` from env vars table
   - Update auth flow description (no domain check)
   - Update RLS descriptions for `sessions`, `clients`, `master_signals`, `prompt_versions`
   - Add `created_by` column to `clients` and `prompt_versions` data model sections
   - Update Settings page description (no admin gate)
   - Remove references to admin-only access in prompt API routes
   - Update key design decisions

2. **`CLAUDE.md`** — Update:
   - Remove domain restriction authentication rule
   - Remove admin gating references
   - Update prompt editor description

3. **`CHANGELOG.md`** — Add PRD-008 entry with all changes.

---

## Full File Impact Summary

| Action | File |
|--------|------|
| Modify | `app/auth/callback/route.ts` |
| Modify | `app/login/page.tsx` |
| Delete | `lib/constants.ts` |
| Modify | `.env.example` |
| Modify | `app/settings/page.tsx` |
| Modify | `components/layout/tab-nav.tsx` |
| Modify | `app/api/prompts/route.ts` |
| Modify | `components/providers/auth-provider.tsx` |
| Delete | `lib/hooks/use-profile.ts` |
| Modify | `lib/services/profile-service.ts` |
| Modify | `lib/services/prompt-service.ts` |
| Modify | `lib/services/master-signal-service.ts` |
| Modify | `lib/services/session-service.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `CLAUDE.md` |
| Modify | `CHANGELOG.md` |
