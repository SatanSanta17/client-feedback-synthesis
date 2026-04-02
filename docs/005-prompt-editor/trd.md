# TRD-005: System Prompt Editor

> **PRD:** `docs/005-prompt-editor/prd.md`
> **Status:** Complete — Parts 1–4 implemented (2026-03-27)

---

## Part 1: Admin Role System

### Technical Decisions

- **New `profiles` table, not modifying `auth.users`.** Supabase's `auth.users` is a managed table in the `auth` schema — adding custom columns is unsupported and would break schema updates. The standard Supabase pattern is a `public.profiles` table with a FK to `auth.users.id`. This also sets us up for any future user-level metadata (display name, preferences, etc.).
- **Database trigger for auto-creation.** A Postgres trigger on `auth.users` fires `AFTER INSERT` and creates a corresponding `profiles` row. This guarantees every authenticated user has a profile without relying on application-level logic. The trigger copies `id` and `email` from the new auth user. New profiles default to `is_admin = false`.
- **Seed admins in the migration, not via env var.** The initial admin list is set directly in the migration SQL. This avoids adding a new env var and keeps the admin list version-controlled. Future admin changes are manual DB updates or a future admin management UI. For the initial deployment, existing `auth.users` rows get profiles backfilled by the migration.
- **Admin check via a profile service function.** A new `profile-service.ts` exposes `getProfile(userId)` and `isAdmin(userId)`. API routes call `isAdmin()` to gate admin endpoints. This keeps the admin check in one place — no scattered Supabase queries.
- **AuthProvider extended with `isAdmin`.** The auth context gains an `isAdmin` boolean so client components can conditionally render admin-only UI (e.g., the Settings nav link). The flag is fetched once on auth state change by querying the `profiles` table from the browser client. This is a lightweight read protected by RLS.
- **Middleware does NOT check `is_admin`.** Middleware runs on every request and must be fast. It continues to do auth-only checks (is the user logged in?). Admin gating happens at the page level (server component) and API route level. This avoids a Supabase round-trip on every navigation.
- **Settings page access denied via server component.** The `/settings` page is a server component that reads the profile and renders an access-denied state for non-admins. This prevents any admin UI from reaching the client bundle for non-admin users.

### Database Schema

#### Migration: Create `profiles` table

```sql
-- Create profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apply the shared updated_at trigger
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- NOTE: An "Admins can read all profiles" policy is NOT included here.
-- A naive self-referencing policy (querying profiles to check is_admin)
-- causes infinite recursion in Postgres RLS evaluation. If admin-reads-all
-- is needed in the future (e.g., admin user management UI), use a
-- SECURITY DEFINER function:
--
--   CREATE OR REPLACE FUNCTION public.is_admin()
--   RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
--   SET search_path = '' STABLE AS $$
--     SELECT COALESCE(
--       (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
--       false
--     );
--   $$;
--
--   CREATE POLICY "Admins can read all profiles"
--     ON profiles FOR SELECT TO authenticated
--     USING (public.is_admin());

-- Only the trigger inserts profiles, but the service role client
-- needs INSERT for the trigger function. No user-facing INSERT policy.

-- Trigger: auto-create profile on new auth user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for existing auth users
INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Seed initial admin(s)
UPDATE profiles
SET is_admin = true
WHERE email = '<admin-email>';
```

#### Table Definition

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK, FK → auth.users.id) | CASCADE on delete |
| `email` | TEXT | NOT NULL, copied from auth.users |
| `is_admin` | BOOLEAN | NOT NULL, default `false` |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Auto-updated via `update_updated_at()` trigger |

**RLS policies:** Authenticated users can SELECT their own row. No admin-reads-all policy (avoided due to recursive RLS — see migration comments for the SECURITY DEFINER pattern if needed in the future). No user-facing INSERT/UPDATE/DELETE — profile creation is handled by the trigger, and admin status changes are manual DB operations for now.

### Service Layer

#### New file: `lib/services/profile-service.ts`

```typescript
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches the profile for the currently authenticated user.
 * Uses the anon client (respects RLS — user can only read own profile).
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Failed to fetch profile:", error.message);
    return null;
  }

  return data;
}

/**
 * Checks if the currently authenticated user is an admin.
 * Returns false if the user is not authenticated or the query fails.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.is_admin ?? false;
}
```

#### New file: `lib/hooks/use-profile.ts`

Client-side hook for the auth provider to fetch the admin flag.

```typescript
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface ProfileState {
  isAdmin: boolean;
  isProfileLoading: boolean;
}

export function useProfile(user: User | null): ProfileState {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);

    supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to fetch profile:", error.message);
          setIsAdmin(false);
        } else {
          setIsAdmin(data?.is_admin ?? false);
        }
        setIsProfileLoading(false);
      });
  }, [user, supabase]);

  return { isAdmin, isProfileLoading };
}
```

### Frontend Changes

#### `components/providers/auth-provider.tsx`

**Changes:**
- Import and call `useProfile(user)` inside `AuthProvider`.
- Add `isAdmin` and `isProfileLoading` to the context value and interface.

```typescript
// Added to AuthContextValue interface:
isAdmin: boolean;

// Inside AuthProvider:
const { isAdmin, isProfileLoading } = useProfile(user);

// Updated context value:
<AuthContext value={{
  user,
  isAuthenticated: !!user,
  isLoading: isLoading || isProfileLoading,
  isAdmin,
  signOut,
}}>
```

Note: `isLoading` now includes `isProfileLoading` so consumers don't render until the admin flag is resolved. This prevents a flash of non-admin UI for admin users.

#### `components/layout/tab-nav.tsx`

**Changes:**
- Import `useAuth` and read `isAdmin`.
- Add a conditional Settings tab that only renders when `isAdmin` is true.

```typescript
// Static tabs (always visible)
const tabs: TabConfig[] = [
  { label: "Capture", href: "/capture", icon: <Pencil /> },
  { label: "Master Signals", href: "/m-signals", icon: <BarChart3 /> },
];

// Inside TabNav component:
const { isAdmin } = useAuth();

const visibleTabs = isAdmin
  ? [...tabs, { label: "Settings", href: "/settings", icon: <Settings /> }]
  : tabs;
```

The `Settings` icon is imported from `lucide-react`.

#### New file: `app/settings/page.tsx`

Server component that checks admin status before rendering.

```typescript
import { redirect } from "next/navigation";
import { isCurrentUserAdmin } from "@/lib/services/profile-service";

export const metadata = { title: "Settings — Synthesiser" };

export default async function SettingsPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    // Non-admin: render access-denied in-place (not a redirect,
    // so they see a clear message rather than a mysterious bounce)
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            Access Denied
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            You don&apos;t have permission to access settings.
            Contact an admin if you need access.
          </p>
        </div>
      </div>
    );
  }

  // Admin: render settings content (placeholder for Part 3)
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">
        Settings
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Prompt editor coming in Part 3.
      </p>
    </div>
  );
}
```

### API Route Protection Pattern

Admin-only API routes (introduced in Parts 2–4) will follow this pattern:

```typescript
import { isCurrentUserAdmin } from "@/lib/services/profile-service";

export async function POST(request: Request) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  // ... admin-only logic
}
```

This is documented here as the established pattern. No admin-only API routes are created in Part 1 — they arrive in Part 2 with the prompt CRUD endpoints.

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `docs/005-prompt-editor/trd.md` | **Create** | This file |
| `lib/services/profile-service.ts` | **Create** | Server-side profile fetch + admin check |
| `lib/hooks/use-profile.ts` | **Create** | Client-side hook for admin flag |
| `components/providers/auth-provider.tsx` | **Modify** | Add `isAdmin` to context via `useProfile` |
| `components/layout/tab-nav.tsx` | **Modify** | Conditional Settings tab for admins |
| `app/settings/page.tsx` | **Create** | Settings page with admin gate |

### Implementation Increments

#### Increment 1.1: Database migration

- Create the `profiles` table with schema, RLS, trigger, backfill, and admin seed.
- Run migration against Supabase.
- Verify: profile row exists for existing users, `is_admin = true` for seeded admin.

#### Increment 1.2: Service layer + auth provider

- Create `profile-service.ts` and `use-profile.ts`.
- Modify `auth-provider.tsx` to expose `isAdmin` via context.
- Verify: `useAuth()` returns `isAdmin: true` for the seeded admin, `false` for others.

#### Increment 1.3: Settings page + nav

- Create `app/settings/page.tsx` with admin gate.
- Modify `tab-nav.tsx` to show Settings tab for admins.
- Verify: admin sees Settings tab and can visit `/settings`. Non-admin does not see the tab and sees access-denied if they navigate directly.

---

## Part 2: Prompt Storage & Versioning

### Technical Decisions

- **Single `prompt_versions` table, not one table per prompt.** All three prompt types share a table, differentiated by `prompt_key`. This keeps the schema simple — one table, one set of RLS policies, one service function. The `prompt_key` is constrained via a CHECK to the three known values.
- **`is_active` flag with a partial unique index.** Only one row per `prompt_key` can have `is_active = true` at a time. This is enforced at the database level via `CREATE UNIQUE INDEX ... WHERE is_active = true`. The application toggles the flag atomically in a transaction — deactivate old, insert new with `is_active = true`.
- **Service role client for atomic activation swap.** The activation swap (deactivate old → insert new) must happen in a single operation with elevated privileges to bypass RLS. We use `createServiceRoleClient()` for this. The API route gates access via `isCurrentUserAdmin()` before calling the service.
- **`author_id` nullable for system-seeded rows.** The initial seed rows (from the migration) have no real user — `author_id` is NULL and `author_email` is `'system'`. All subsequent versions from the UI have a real `author_id` and `author_email`.
- **AI service reads active prompt with hardcoded fallback.** A new `prompt-service.ts` function `getActivePrompt(promptKey)` queries the active prompt from the database using the service role client (since the AI service runs server-side, not in a user context). If the query fails for any reason, the AI service falls back to the hardcoded constants — this ensures signal extraction and master signal synthesis never break because of a prompt storage issue.
- **Hardcoded prompts remain in `lib/prompts/`.** The TypeScript files are not deleted. They serve as: (1) fallback defaults when the DB is unreachable, (2) the source for "Reset to Default" in the UI, and (3) a version-controlled reference of the original prompts.
- **RLS uses the `SECURITY DEFINER` `is_admin()` function.** Since we need admin-only INSERT and admin-only read of version history, we create the `public.is_admin()` function (documented in Part 1 as a future pattern) and use it in the `prompt_versions` RLS policies. This avoids the recursion issue we hit with `profiles`.

### Database Schema

#### Migration: Create `prompt_versions` table

```sql
-- Create the is_admin() helper function for RLS policies.
-- Uses SECURITY DEFINER to bypass RLS on the profiles table,
-- avoiding infinite recursion when used in other tables' policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Create prompt_versions table
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key TEXT NOT NULL CHECK (
    prompt_key IN ('signal_extraction', 'master_signal_cold_start', 'master_signal_incremental')
  ),
  content TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email TEXT NOT NULL DEFAULT 'system',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce: only one active version per prompt_key
CREATE UNIQUE INDEX prompt_versions_active_unique
  ON prompt_versions (prompt_key)
  WHERE is_active = true;

-- Index for fetching version history by prompt_key (newest first)
CREATE INDEX prompt_versions_key_created_idx
  ON prompt_versions (prompt_key, created_at DESC);

-- RLS
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active prompts (needed by AI service via anon client)
CREATE POLICY "Authenticated users can read active prompts"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can read all versions (history view)
CREATE POLICY "Admins can read all prompt versions"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admins can insert new versions
CREATE POLICY "Admins can insert prompt versions"
  ON prompt_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Admins can update (deactivate) existing versions
CREATE POLICY "Admins can update prompt versions"
  ON prompt_versions FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Seed initial prompt versions from hardcoded defaults
INSERT INTO prompt_versions (prompt_key, content, author_email, is_active)
VALUES
  ('signal_extraction', E'You are a signal extraction analyst. Your job is to read raw session notes from client calls and extract structured signals into a consistent markdown report.\n\nSessions are typically discovery, onboarding, or requirements-gathering calls with prospective or existing customers.\n\n## Output Format\n\nReturn a markdown document with the following sections in this exact order. Use ## for section headings and - for bullet points. Use **bold** for labels in the Session Overview and Client Profile sections.\n\n### Section 1: Session Overview\n\n## Session Summary\nA single sentence summarising what this session was about.\n\n## Sentiment\n**Overall:** [Positive | Mixed | Negative] \u2014 [1-2 sentence explanation of why]\n\n## Urgency\n**Level:** [Critical | High | Medium | Low] \u2014 [1-2 sentence explanation with context from the notes]\n\n## Decision Timeline\n**Timeline:** [Specific timeline extracted from notes, e.g., \"Q3 2026\", \"End of April\", \"Exploring, no fixed timeline\"]\n\n### Section 2: Client Profile\n\n## Client Profile\n- **Industry / Vertical:** [e.g., E-commerce, Gaming, Fintech, Travel \u2014 or \"Not mentioned\" if absent]\n- **Market / Geography:** [e.g., Southeast Asia, North America, Global \u2014 or \"Not mentioned\" if absent]\n- **Monthly Ad Spend:** [e.g., \"$50K\u2013$100K\", \"$1M+\" \u2014 or \"Not mentioned\" if absent]\n\n### Section 3: Signal Categories\n\nFor each category below, extract individual signals as bullet points. Each bullet should be a clear, concise statement of the signal \u2014 not a copy-paste from the notes, but a distilled insight.\n\n## Pain Points\nWhat is broken, frustrating, or costly in the customer''s current setup. What they are running away from.\n\n## Must-Haves / Requirements\nDeal-breaker capabilities. Table stakes the customer considers non-negotiable to even consider the platform.\n\n## Aspirations\nForward-looking wants. \"Nice to haves\" that would delight but won''t block a deal.\n\n## Competitive Mentions\nWho the customer is currently using, who else they are evaluating, and what they like or dislike about those tools. Include the competitor name and the context.\n\n## Blockers / Dependencies\nWhat stands between interest and commitment. Technical, organisational, contractual, or timeline-based obstacles.\n\n## Platforms & Channels\nWhich ad platforms matter to the customer (Google, Meta, Bing, TikTok, programmatic, etc.) and their relative importance or priority.\n\n## Current Stack / Tools\nThe customer''s existing workflow, tools, and systems for campaign management, reporting, attribution, and related operations.\n\n## Other / Uncategorised\nAny signals or information from the notes that do not fit the categories above. For each item, suggest which category it might belong to or note that a new category may be needed. Do not force signals into irrelevant categories.\n\n## Rules\n\n1. Only extract information that is explicitly stated or clearly inferable from the notes. Do not fabricate, assume, or hallucinate signals.\n2. If a category has no relevant signals in the notes, write \"No signals identified.\" under that heading. Do not omit the heading.\n3. Do not include conversational filler, disclaimers, apologies, or meta-commentary (e.g., \"Based on the notes provided...\").\n4. Do not wrap the output in a code block or return JSON. Return clean markdown only.\n5. Distill signals into clear, concise statements. Do not copy-paste raw sentences from the notes verbatim unless the exact wording is important.\n6. If the same signal is relevant to multiple categories, place it in the most specific category and do not duplicate it.', 'system', true),

  ('master_signal_cold_start', E'<COLD_START_PROMPT_CONTENT>', 'system', true),

  ('master_signal_incremental', E'<INCREMENTAL_PROMPT_CONTENT>', 'system', true);
```

> **Note:** The seed INSERT values above are abbreviated for the cold start and incremental prompts. The actual migration must use the full prompt text from `lib/prompts/master-signal-synthesis.ts`. The signal extraction seed is shown in full as a reference for escaping.

#### Table Definition

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `prompt_key` | TEXT | NOT NULL, CHECK constraint: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental` |
| `content` | TEXT | NOT NULL, full prompt body |
| `author_id` | UUID (FK → auth.users.id) | Nullable. NULL for system-seeded rows. SET NULL on user delete. |
| `author_email` | TEXT | NOT NULL, default `'system'`. Denormalised for display. |
| `is_active` | BOOLEAN | NOT NULL, default `false`. Partial unique index enforces one active row per `prompt_key`. |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:**
- `prompt_versions_active_unique` — unique on `(prompt_key) WHERE is_active = true`
- `prompt_versions_key_created_idx` — on `(prompt_key, created_at DESC)` for history queries

**RLS policies:**
- All authenticated users can SELECT rows where `is_active = true` (AI service needs this).
- Admins can SELECT all rows (version history).
- Admins can INSERT (create new versions).
- Admins can UPDATE (deactivate old versions during activation swap).

### Service Layer

#### New file: `lib/services/prompt-service.ts`

```typescript
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

// Valid prompt keys
export type PromptKey =
  | "signal_extraction"
  | "master_signal_cold_start"
  | "master_signal_incremental";

export interface PromptVersion {
  id: string;
  prompt_key: PromptKey;
  content: string;
  author_id: string | null;
  author_email: string;
  is_active: boolean;
  created_at: string;
}

/**
 * Fetches the currently active prompt for a given key.
 * Uses the service role client — called from AI service (server-side, no user context).
 * Returns null if no active prompt is found.
 */
export async function getActivePrompt(
  promptKey: PromptKey
): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("content")
    .eq("prompt_key", promptKey)
    .eq("is_active", true)
    .single();

  if (error) {
    console.error(
      `[prompt-service] Failed to fetch active prompt for ${promptKey}:`,
      error.message
    );
    return null;
  }

  return data?.content ?? null;
}

/**
 * Fetches the version history for a given prompt key, newest first.
 * Uses the anon client (respects RLS — admin-only).
 */
export async function getPromptHistory(
  promptKey: PromptKey
): Promise<PromptVersion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("prompt_key", promptKey)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      `[prompt-service] Failed to fetch prompt history for ${promptKey}:`,
      error.message
    );
    return [];
  }

  return data ?? [];
}

/**
 * Saves a new prompt version and makes it active.
 * Atomically deactivates the previous active version.
 * Uses the service role client for the deactivation (bypasses RLS).
 */
export async function savePromptVersion(input: {
  promptKey: PromptKey;
  content: string;
  authorId: string;
  authorEmail: string;
}): Promise<PromptVersion> {
  const { promptKey, content, authorId, authorEmail } = input;
  const supabase = createServiceRoleClient();

  // Step 1: Deactivate the current active version
  const { error: deactivateError } = await supabase
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("prompt_key", promptKey)
    .eq("is_active", true);

  if (deactivateError) {
    console.error(
      `[prompt-service] Failed to deactivate current prompt for ${promptKey}:`,
      deactivateError.message
    );
    throw new Error(
      `Failed to deactivate current prompt: ${deactivateError.message}`
    );
  }

  // Step 2: Insert the new active version
  const { data, error: insertError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_key: promptKey,
      content,
      author_id: authorId,
      author_email: authorEmail,
      is_active: true,
    })
    .select()
    .single();

  if (insertError) {
    console.error(
      `[prompt-service] Failed to insert new prompt version for ${promptKey}:`,
      insertError.message
    );
    throw new Error(
      `Failed to save prompt version: ${insertError.message}`
    );
  }

  console.log(
    `[prompt-service] Saved new active prompt for ${promptKey}: ${data.id}`
  );

  return data;
}
```

#### Modified file: `lib/services/ai-service.ts`

**Changes:**
- Import `getActivePrompt` from `prompt-service.ts`.
- In `extractSignals()`, fetch the active `signal_extraction` prompt from the DB. Fall back to the hardcoded `SIGNAL_EXTRACTION_SYSTEM_PROMPT` if the DB returns null.
- In `synthesiseMasterSignal()`, fetch the active `master_signal_cold_start` or `master_signal_incremental` prompt from the DB. Fall back to the hardcoded constants if the DB returns null.
- The hardcoded imports from `lib/prompts/` remain for fallback.

```typescript
// In extractSignals():
export async function extractSignals(rawNotes: string): Promise<string> {
  const dbPrompt = await getActivePrompt("signal_extraction");
  const systemPrompt = dbPrompt ?? SIGNAL_EXTRACTION_SYSTEM_PROMPT;

  const userMessage = buildSignalExtractionUserMessage(rawNotes);

  return callClaude({
    systemPrompt,
    userMessage,
    maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
    operationName: "extractSignals",
  });
}

// In synthesiseMasterSignal():
export async function synthesiseMasterSignal(
  input: MasterSignalInput
): Promise<string> {
  const { previousMasterSignal, sessions } = input;
  const isIncremental = !!previousMasterSignal;

  const promptKey = isIncremental
    ? "master_signal_incremental"
    : "master_signal_cold_start";

  const dbPrompt = await getActivePrompt(promptKey);
  const systemPrompt = dbPrompt
    ?? (isIncremental
      ? MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT
      : MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT);

  // ... rest unchanged
}
```

### API Routes

#### New file: `app/api/prompts/route.ts`

```
GET /api/prompts?key=<prompt_key>
```

Returns the active prompt and full version history for the given key. Admin-only (403 for non-admins).

```typescript
// Response shape:
{
  active: PromptVersion;
  history: PromptVersion[];
}
```

```
POST /api/prompts
```

Saves a new prompt version and makes it active. Admin-only.

```typescript
// Request body (validated with Zod):
{
  promptKey: "signal_extraction" | "master_signal_cold_start" | "master_signal_incremental";
  content: string; // min 1 char, max 50000 chars
}

// Response:
{ version: PromptVersion }
```

Both routes use the `isCurrentUserAdmin()` guard and return 403 for non-admin callers.

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `lib/services/prompt-service.ts` | **Create** | `getActivePrompt()`, `getPromptHistory()`, `savePromptVersion()` |
| `lib/services/ai-service.ts` | **Modify** | Read active prompt from DB with hardcoded fallback |
| `app/api/prompts/route.ts` | **Create** | GET (active + history) and POST (save new version), admin-gated |

Plus one SQL migration for the `prompt_versions` table, `is_admin()` function, indexes, RLS policies, and seed data.

### Implementation Increments

#### Increment 2.1: Database migration

- Create the `public.is_admin()` SECURITY DEFINER function.
- Create the `prompt_versions` table with schema, CHECK constraint, partial unique index, RLS policies.
- Seed the three hardcoded prompts as initial active versions.
- Verify: `prompt_versions` has 3 rows, all `is_active = true`, one per `prompt_key`.

#### Increment 2.2: Prompt service + AI service integration

- Create `lib/services/prompt-service.ts` with `getActivePrompt()`, `getPromptHistory()`, and `savePromptVersion()`.
- Modify `lib/services/ai-service.ts` to read active prompts from the DB with hardcoded fallback.
- Verify: signal extraction and master signal synthesis still work (reading from DB). If DB seed is missing, fallback to hardcoded prompts.

#### Increment 2.3: API routes

- Create `app/api/prompts/route.ts` with GET and POST handlers, admin-gated.
- Verify: admin can GET prompt history and POST a new version. Non-admin gets 403. The new version becomes active and is used by subsequent AI calls.

---

## Part 3: Prompt Editor UI

### Technical Decisions

- **Server component page + client component content.** The `/settings` page remains a server component for the admin gate (Part 1). It renders a new `PromptEditorPageContent` client component that handles all interactive state — tab switching, editing, saving, dirty tracking.
- **Tabs via shadcn/ui `Tabs` component.** The three prompts are displayed using the existing `Tabs` primitive. Tab values map directly to `PromptKey` values: `signal_extraction`, `master_signal_cold_start`, `master_signal_incremental`. Readable labels are derived from a config map.
- **Plain `<textarea>` with monospace styling.** No external code editor library. The prompts are markdown-formatted plain text — a monospace textarea with adequate height (min 24 rows) is sufficient and keeps the bundle small. The textarea uses `font-mono` from Tailwind (which maps to `var(--font-mono)` / Geist Mono).
- **Dirty tracking via string comparison.** The editor tracks `originalContent` (fetched from the API) and `currentContent` (live textarea value). `isDirty = originalContent !== currentContent`. This drives: save button enabled state, reset button visibility, and the unsaved changes confirmation.
- **Unsaved changes guard on tab switch and browser navigation.** Switching prompt tabs with unsaved changes shows a confirmation dialog (reusing the existing `Dialog` + `Button` pattern from the capture page). Browser navigation (back, close tab) is caught via `beforeunload` event.
- **Reset to Default uses hardcoded prompts.** The reset button POST's the original hardcoded prompt text from `lib/prompts/` to the API. This creates a new version in the history (reset is a versioned event, not a deletion). The hardcoded defaults are imported into the client component — they are not secrets and are already in the codebase.
- **Toast notifications via `sonner`.** Consistent with the existing app pattern — `toast.success()` on save, `toast.error()` on failure.
- **Co-located `_components/` directory.** All Part 3 components live in `app/settings/_components/` and are not imported outside the settings route.

### Frontend Components

#### Modified file: `app/settings/page.tsx`

The server component is updated to render the client component for admin users instead of the placeholder.

```typescript
import { isCurrentUserAdmin } from "@/lib/services/profile-service";
import { PromptEditorPageContent } from "./_components/prompt-editor-page-content";

export const metadata = {
  title: "Settings — Synthesiser",
};

export default async function SettingsPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    // ... access denied state (unchanged from Part 1)
  }

  return <PromptEditorPageContent />;
}
```

#### New file: `app/settings/_components/prompt-editor-page-content.tsx`

Top-level client component for the settings page. Manages:
- Active tab state (which prompt is being edited)
- Fetching the active prompt content from `GET /api/prompts?key=<key>` on tab change
- Dirty state tracking (`originalContent` vs `currentContent`)
- Save handler: `POST /api/prompts` with `{ promptKey, content }`
- Reset handler: `POST /api/prompts` with hardcoded default content
- Unsaved changes dialog on tab switch
- `beforeunload` listener for browser navigation

```typescript
// State shape:
const [activeTab, setActiveTab] = useState<PromptKey>("signal_extraction");
const [originalContent, setOriginalContent] = useState("");
const [currentContent, setCurrentContent] = useState("");
const [isLoading, setIsLoading] = useState(true);
const [isSaving, setIsSaving] = useState(false);
const [pendingTab, setPendingTab] = useState<PromptKey | null>(null);

const isDirty = originalContent !== currentContent;
```

Layout structure:
```
<div className="p-6 max-w-5xl">
  <h1>Settings</h1>
  <p>Edit the AI system prompts...</p>
  <Tabs value={activeTab} onValueChange={handleTabChange}>
    <TabsList>
      <TabsTrigger value="signal_extraction">Signal Extraction</TabsTrigger>
      <TabsTrigger value="master_signal_cold_start">Master Signal (Cold Start)</TabsTrigger>
      <TabsTrigger value="master_signal_incremental">Master Signal (Incremental)</TabsTrigger>
    </TabsList>
    <TabsContent>
      <PromptEditor
        content={currentContent}
        onChange={setCurrentContent}
        isLoading={isLoading}
      />
      <div className="action bar">
        <CharacterCount count={currentContent.length} />
        <ResetToDefaultButton />
        <SaveButton disabled={!isDirty || isSaving} />
      </div>
    </TabsContent>
  </Tabs>
  <UnsavedChangesDialog ... />
</div>
```

#### New file: `app/settings/_components/prompt-editor.tsx`

The textarea component. Receives `content`, `onChange`, and `isLoading` as props.

```typescript
interface PromptEditorProps {
  content: string;
  onChange: (value: string) => void;
  isLoading: boolean;
  className?: string;
}
```

Renders a monospace `<textarea>` with:
- `font-mono` class for monospace font
- `min-h-[480px]` (~24 lines visible)
- `resize-y` to allow vertical resizing
- `whitespace-pre-wrap` to preserve formatting
- Disabled state while loading (shows skeleton or muted placeholder)

#### Unsaved changes dialog

Reuses the `Dialog` + `Button` pattern from the capture page. When the user attempts to switch tabs with unsaved changes:
1. The tab switch is intercepted (`pendingTab` is set instead of immediately switching).
2. A dialog appears: "You have unsaved changes. Discard and switch, or stay?"
3. "Discard" → resets content, switches to `pendingTab`.
4. "Stay" → closes dialog, keeps current tab.

For browser navigation, `beforeunload` fires when `isDirty` is true.

### API Integration

The component calls two endpoints:

**On tab mount / tab switch:**
```
GET /api/prompts?key=signal_extraction
→ { active: { content, ... }, history: [...] }
```
Sets `originalContent` and `currentContent` from `active.content`.

**On save / reset:**
```
POST /api/prompts
Body: { promptKey: "signal_extraction", content: "..." }
→ { version: { ... } }
```
On success: updates `originalContent` to match `currentContent` (clears dirty state), shows success toast.

### Hardcoded Defaults for Reset

The reset button imports the hardcoded prompts directly:

```typescript
import { SIGNAL_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/signal-extraction";
import {
  MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
} from "@/lib/prompts/master-signal-synthesis";

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  signal_extraction: SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  master_signal_cold_start: MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  master_signal_incremental: MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
};
```

Reset calls `POST /api/prompts` with `DEFAULT_PROMPTS[activeTab]` as the content. This creates a new version in history, attributed to the current admin.

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `app/settings/page.tsx` | **Modify** | Render `PromptEditorPageContent` for admin users |
| `app/settings/_components/prompt-editor-page-content.tsx` | **Create** | Main client component — tabs, fetch, save, dirty tracking |
| `app/settings/_components/prompt-editor.tsx` | **Create** | Monospace textarea with loading state |

### Implementation Increments

#### Increment 3.1: Prompt editor textarea + tabs

- Create `prompt-editor.tsx` (monospace textarea component).
- Create `prompt-editor-page-content.tsx` with tab layout, API fetch on tab switch, character count.
- Update `settings/page.tsx` to render the new component.
- Verify: admin sees three tabs, each loads the active prompt content from the API, character count is live.

#### Increment 3.2: Save, Reset, and dirty tracking

- Add save handler (POST to API, success/error toast).
- Add reset-to-default handler (POST hardcoded default, success toast).
- Add dirty tracking (enable/disable save button, unsaved changes dialog on tab switch, `beforeunload` on browser nav).
- Verify: save creates a new active version, reset restores the default, switching tabs with unsaved changes shows confirmation.

---

## Part 4: Version History & Revert

### Technical Decisions

- **History panel as a collapsible section below the editor, not a side drawer.** The editor already takes full width and height. A side drawer would compress the editor or overlay it. A collapsible panel below the action bar is simpler — it pushes content down when open and collapses cleanly. This keeps the editor at full size when history is closed (the common case).
- **History data is already fetched.** The `GET /api/prompts?key=<key>` endpoint already returns `{ active, history }`. Part 3 only uses `active` — Part 4 uses the `history` array. No new API endpoints are needed.
- **Version numbers are derived, not stored.** The history is ordered newest-first by `created_at`. The "version number" displayed to the user is computed by reversing the index: the oldest entry is v1, the newest is vN. This avoids adding a column to the database — it's purely a display concern.
- **Relative timestamps via a utility function.** A small `formatRelativeTime(dateString)` helper computes "just now", "5 minutes ago", "3 days ago", etc. No external library (date-fns, dayjs) — the logic is simple enough for a plain function.
- **Read-only version view in a Dialog.** Clicking a history entry opens a Dialog with the full prompt content in a read-only monospace textarea. This avoids navigating away from the editor or disrupting the current editing state. The dialog shows the version number, author, and timestamp in the header.
- **Revert creates a new version via existing POST endpoint.** The "Revert to this version" button calls `POST /api/prompts` with the old version's content. This is the same endpoint used by save and reset — it creates a new active version attributed to the current admin. The history grows; nothing is deleted.
- **Active version badge.** The history entry whose `is_active` is true gets a small "Active" badge next to its version number, styled with the brand colour. All other entries are unstyled.
- **History is refetched after save/reset/revert.** Any mutation that creates a new version triggers a refetch of the prompt data (active + history) to keep the list current.

### Frontend Components

#### Modified file: `app/settings/_components/prompt-editor-page-content.tsx`

**Changes:**
- Store `history` array from the API response alongside `originalContent`.
- Pass `history` to a new `VersionHistoryPanel` component.
- After any successful save/reset/revert, refetch the prompt data to update the history list.
- Add a "Version History" toggle button in the action bar.

```typescript
// Additional state:
const [history, setHistory] = useState<PromptVersion[]>([]);
const [isHistoryOpen, setIsHistoryOpen] = useState(false);
const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null);

// Updated fetch — store history:
const data = await res.json();
setOriginalContent(data.active?.content ?? DEFAULT_PROMPTS[key]);
setCurrentContent(data.active?.content ?? DEFAULT_PROMPTS[key]);
setHistory(data.history ?? []);

// After save/reset — refetch:
await fetchPrompt(activeTab);
```

#### New file: `app/settings/_components/version-history-panel.tsx`

Collapsible panel showing the version history list.

```typescript
interface VersionHistoryPanelProps {
  history: PromptVersion[];
  isOpen: boolean;
  onToggle: () => void;
  onViewVersion: (version: PromptVersion) => void;
  onRevert: (version: PromptVersion) => void;
  isReverting: boolean;
  className?: string;
}
```

Renders:
- A toggle header ("Version History" + chevron icon + entry count). Clicking toggles `isOpen`.
- When open, a scrollable list (max-h with overflow-y-auto) of history entries, newest first.
- Each entry shows:
  - **Version number** (computed: `history.length - index`), with an "Active" badge if `is_active === true`.
  - **Author email** (truncated if long).
  - **Relative timestamp** (e.g., "3 days ago").
  - **Content preview** — first 100 characters of `content`, truncated with ellipsis.
  - A "View" button that calls `onViewVersion(version)`.
  - A "Revert" button that calls `onRevert(version)`. Hidden on the currently active version (revert to self is a no-op). Disabled while `isReverting`.

#### New file: `app/settings/_components/version-view-dialog.tsx`

Dialog for viewing a past version's full content.

```typescript
interface VersionViewDialogProps {
  version: PromptVersion | null;
  versionNumber: number;
  onClose: () => void;
  onRevert: (version: PromptVersion) => void;
  isReverting: boolean;
}
```

Renders a Dialog with:
- Header: "Version {N}" + author email + relative timestamp.
- Body: read-only monospace textarea (same styling as the editor, but with `readOnly` and muted background).
- Footer: "Close" button + "Revert to this version" button (hidden if the version is currently active).

#### New file: `lib/utils/format-relative-time.ts`

Utility function for relative time display.

```typescript
export function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  // Fall back to formatted date for older entries
  return new Date(dateString).toLocaleDateString();
}
```

### API Integration

No new endpoints. All operations use the existing routes:

- **Fetch history:** `GET /api/prompts?key=<key>` → `{ active, history }` (already implemented in Part 2).
- **Revert:** `POST /api/prompts` with `{ promptKey, content: oldVersion.content }` (same as save — creates a new active version).

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `app/settings/_components/prompt-editor-page-content.tsx` | **Modify** | Add history state, history toggle, refetch after mutations |
| `app/settings/_components/version-history-panel.tsx` | **Create** | Collapsible history list with version entries |
| `app/settings/_components/version-view-dialog.tsx` | **Create** | Read-only dialog for viewing a past version |
| `lib/utils/format-relative-time.ts` | **Create** | Relative time formatting utility |

### Implementation Increments

#### Increment 4.1: Version history panel

- Create `format-relative-time.ts` utility.
- Create `version-history-panel.tsx` with collapsible list, version numbers, author, timestamp, content preview, active badge.
- Modify `prompt-editor-page-content.tsx` to store history from API, render the panel below the action bar, toggle open/closed.
- Verify: admin sees "Version History" toggle, opening it shows all past versions newest-first, active version has a badge.

#### Increment 4.2: Version view dialog + revert

- Create `version-view-dialog.tsx` with read-only content view.
- Wire "View" button in history panel to open the dialog.
- Wire "Revert" button (both in panel and dialog) to POST the old content and refetch.
- Verify: clicking View shows the full prompt in a dialog, clicking Revert creates a new active version and refreshes the history list.
