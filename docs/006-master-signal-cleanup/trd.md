# TRD-006: Master Signal Cleanup on Session Deletion

> **Status:** Part 1 Increments 1.1–1.4 implemented
> **PRD:** `docs/006-master-signal-cleanup/prd.md` (approved)
> **Mirrors:** PRD Part 1

---

## Part 1: Tainted Flag and Auto Cold-Start Regeneration

### Overview

When a session is soft-deleted, the master signal retains that session's signals because the incremental generation flow only appends new data — it never removes. This TRD adds a `is_tainted` flag to the `master_signals` table. The session deletion flow sets this flag when the deleted session contributed signals. The generation flow checks the flag and forces a cold-start (full rebuild from all active sessions) instead of incremental when tainted. The frontend staleness banner and the Settings page prompt selection both reflect the tainted state.

---

### Database Model

#### `master_signals` (modified table)

Add one column:

| Column | Type | Notes |
|--------|------|-------|
| `is_tainted` | BOOLEAN | NOT NULL, default `false`. Set to `true` when a session with structured notes is deleted. Cleared when a new master signal is generated. |

**Migration SQL:**

```sql
-- Add tainted flag to master_signals
ALTER TABLE master_signals
  ADD COLUMN is_tainted BOOLEAN NOT NULL DEFAULT false;

-- Allow authenticated users to UPDATE is_tainted (restricted to this single column via service role usage)
-- No RLS change needed — the service role client bypasses RLS for the update.
```

**Design notes:**
- Only the latest master signal row matters for the tainted check. Older rows are historical snapshots and their `is_tainted` value is irrelevant.
- The flag is set by the session deletion service (service role client, bypasses RLS).
- The flag is effectively cleared by inserting a new master signal row (which defaults to `is_tainted = false`). We do not update the old row — the new row replaces it as the "current" master signal.

---

### Service Layer

#### `lib/services/session-service.ts` (modified)

**Modified function: `deleteSession(id: string)`**

After the existing soft-delete succeeds, add logic to conditionally taint the master signal:

1. Before soft-deleting, fetch the session to check if `structured_notes IS NOT NULL`. We need this check because the current `deleteSession` only selects `id` after the update. Modify the `.select()` call to also return `structured_notes`.
2. If the deleted session had non-null `structured_notes`, call `taintLatestMasterSignal()` from the master signal service.
3. If the session had no structured notes, skip tainting.

```typescript
// Updated deleteSession — after soft-delete, conditionally taint master signal
export async function deleteSession(id: string): Promise<void> {
  console.log("[session-service] deleteSession — id:", id);

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, structured_notes")  // <-- also fetch structured_notes
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      console.warn("[session-service] deleteSession not found:", id);
      throw new SessionNotFoundError(`Session ${id} not found`);
    }
    console.error("[session-service] deleteSession error:", error);
    throw new Error("Failed to delete session");
  }

  console.log("[session-service] deleteSession success:", data.id);

  // Taint master signal if the deleted session had extracted signals
  if (data.structured_notes) {
    try {
      await taintLatestMasterSignal();
    } catch (taintErr) {
      // Log but don't fail the deletion — tainting is best-effort
      console.error(
        "[session-service] failed to taint master signal:",
        taintErr instanceof Error ? taintErr.message : taintErr
      );
    }
  }
}
```

**New import:** `import { taintLatestMasterSignal } from "./master-signal-service";`

**Error handling:** Tainting is best-effort. If it fails (e.g., no master signal exists, DB error), the deletion still succeeds. The worst case is the user isn't warned about stale data — but the next cold-start regeneration will still produce correct output.

---

#### `lib/services/master-signal-service.ts` (modified)

**Updated interface: `MasterSignal`**

Add `isTainted` to the interface:

```typescript
export interface MasterSignal {
  id: string;
  content: string;
  generatedAt: string;
  sessionsIncluded: number;
  createdBy: string;
  createdAt: string;
  isTainted: boolean;  // <-- new
}
```

**Updated function: `getLatestMasterSignal()`**

Include `is_tainted` in the select and map it:

```typescript
const { data, error } = await supabase
  .from("master_signals")
  .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
  .order("generated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

// ... in the return:
return {
  id: data.id,
  content: data.content,
  generatedAt: data.generated_at,
  sessionsIncluded: data.sessions_included,
  createdBy: data.created_by,
  createdAt: data.created_at,
  isTainted: data.is_tainted,  // <-- new
};
```

**New function: `taintLatestMasterSignal()`**

Sets `is_tainted = true` on the latest master signal row. Uses the service role client (same as `deleteSession`).

```typescript
/**
 * Mark the latest master signal as tainted (contains data from a now-deleted session).
 * No-op if no master signal exists.
 */
export async function taintLatestMasterSignal(): Promise<void> {
  console.log("[master-signal-service] taintLatestMasterSignal");

  const supabase = createServiceRoleClient();

  // Find the latest master signal
  const { data: latest, error: fetchError } = await supabase
    .from("master_signals")
    .select("id, is_tainted")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error("[master-signal-service] taintLatestMasterSignal fetch error:", fetchError);
    throw new Error("Failed to fetch latest master signal for tainting");
  }

  if (!latest) {
    console.log("[master-signal-service] taintLatestMasterSignal — no master signal exists, skipping");
    return;
  }

  if (latest.is_tainted) {
    console.log("[master-signal-service] taintLatestMasterSignal — already tainted, skipping");
    return;
  }

  const { error: updateError } = await supabase
    .from("master_signals")
    .update({ is_tainted: true })
    .eq("id", latest.id);

  if (updateError) {
    console.error("[master-signal-service] taintLatestMasterSignal update error:", updateError);
    throw new Error("Failed to taint master signal");
  }

  console.log("[master-signal-service] taintLatestMasterSignal — tainted:", latest.id);
}
```

**New import needed in `master-signal-service.ts`:** `createServiceRoleClient` from `@/lib/supabase/server` (currently only imports `createClient`).

**Updated function: `saveMasterSignal()`**

No change needed — new rows default to `is_tainted = false`, which is the correct behaviour after a regeneration.

---

### API Endpoints

#### `POST /api/ai/generate-master-signal` (modified)

**Current logic:**
1. If no master signal → cold start
2. If master signal exists → check for new sessions → incremental or unchanged

**New logic:**
1. If no master signal → cold start
2. If master signal exists AND `isTainted` → **force cold start** (fetch all active sessions, ignore previous master signal content)
3. If master signal exists AND NOT tainted → check for new sessions → incremental or unchanged

```typescript
// After fetching latestMasterSignal:

if (!latestMasterSignal) {
  // Cold start — same as before
  // ...
}

// NEW: Force cold start if tainted
if (latestMasterSignal.isTainted) {
  console.log("[api/ai/generate-master-signal] tainted — forcing cold start");

  const sessions = await getAllSignalSessions();

  if (sessions.length === 0) {
    return NextResponse.json(
      { message: "No extracted signals found. All sessions with signals have been deleted." },
      { status: 422 }
    );
  }

  const content = await synthesiseMasterSignal({ sessions });
  const saved = await saveMasterSignal(content, sessions.length);

  console.log(`[api/ai/generate-master-signal] tainted cold start — saved: ${saved.id}`);
  return NextResponse.json({ masterSignal: saved });
}

// Existing incremental logic continues unchanged below...
```

**Key detail:** The new master signal row inserted by `saveMasterSignal()` has `is_tainted = false` by default. This effectively "clears" the tainted state because `getLatestMasterSignal()` always reads the newest row.

#### `GET /api/master-signal` (modified)

Add `isTainted` to the response so the frontend can show the appropriate banner:

```typescript
return NextResponse.json({
  masterSignal,
  staleCount,
  isTainted: masterSignal?.isTainted ?? false,  // <-- new
});
```

---

### Frontend

#### `app/m-signals/_components/master-signal-page-content.tsx` (modified)

**State changes:**

```typescript
const [isTainted, setIsTainted] = useState(false);
```

**Fetch update:** Read `isTainted` from the API response:

```typescript
const data = await response.json();
setMasterSignal(data.masterSignal ?? null);
setStaleCount(data.staleCount ?? 0);
setIsTainted(data.isTainted ?? false);  // <-- new
```

**Generate handler update:** Clear tainted state on successful generation:

```typescript
// After successful generation:
setIsTainted(false);  // <-- new (alongside existing setStaleCount(0))
```

**Staleness banner update:** Show tainted-specific message, with priority over the standard stale message:

```typescript
{/* Tainted banner — takes priority */}
{masterSignal && isTainted && (
  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    <AlertTriangle className="size-4 shrink-0" />
    <span>
      A session with extracted signals was deleted — regenerate to remove
      its data from the master signal.
      {staleCount > 0 && (
        <>
          {" "}Additionally, <strong>{staleCount}</strong> new/updated session
          {staleCount === 1 ? "" : "s"} since last generation.
        </>
      )}
    </span>
  </div>
)}

{/* Standard staleness banner — only when NOT tainted */}
{masterSignal && !isTainted && staleCount > 0 && (
  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    <AlertTriangle className="size-4 shrink-0" />
    <span>
      Master signal may be out of date — <strong>{staleCount}</strong>{" "}
      new/updated session{staleCount === 1 ? "" : "s"} since last
      generation.
    </span>
  </div>
)}
```

---

#### `app/settings/_components/prompt-editor-page-content.tsx` (modified)

**Current logic (line 61):**
```typescript
const masterSignalKey: PromptKey = hasMasterSignal
  ? "master_signal_incremental"
  : "master_signal_cold_start";
```

**New logic:** Also check if the master signal is tainted. If tainted, the next generation will use cold-start, so show the cold-start prompt:

**State changes:**

```typescript
const [isMasterSignalTainted, setIsMasterSignalTainted] = useState(false);
```

**Updated `checkMasterSignal` effect:**

```typescript
useEffect(() => {
  async function checkMasterSignal() {
    try {
      const res = await fetch("/api/master-signal");
      if (res.ok) {
        const data = await res.json();
        setHasMasterSignal(data.masterSignal !== null);
        setIsMasterSignalTainted(data.isTainted ?? false);  // <-- new
      }
    } catch {
      // Silently default to cold start if the check fails
    }
  }
  checkMasterSignal();
}, []);
```

**Updated prompt key resolution:**

```typescript
const masterSignalKey: PromptKey = (hasMasterSignal && !isMasterSignalTainted)
  ? "master_signal_incremental"
  : "master_signal_cold_start";
```

This means:
- No master signal → cold-start prompt (existing behaviour)
- Master signal exists, not tainted → incremental prompt (existing behaviour)
- Master signal exists, tainted → cold-start prompt (new behaviour)

---

### Files Changed Summary

| File | Action | What Changes |
|------|--------|-------------|
| `lib/services/master-signal-service.ts` | Modified | Add `isTainted` to `MasterSignal` interface, include `is_tainted` in `getLatestMasterSignal()` select/mapping, add `taintLatestMasterSignal()` function, import `createServiceRoleClient` |
| `lib/services/session-service.ts` | Modified | Update `deleteSession()` to select `structured_notes`, call `taintLatestMasterSignal()` if session had signals, import `taintLatestMasterSignal` |
| `app/api/ai/generate-master-signal/route.ts` | Modified | Add tainted cold-start branch between "no master signal" and "incremental" |
| `app/api/master-signal/route.ts` | Modified | Add `isTainted` to GET response |
| `app/m-signals/_components/master-signal-page-content.tsx` | Modified | Add `isTainted` state, read from API, show tainted-specific banner, clear on regeneration |
| `app/settings/_components/prompt-editor-page-content.tsx` | Modified | Add `isMasterSignalTainted` state, fetch from API, use in prompt key resolution |
| `ARCHITECTURE.md` | Modified | Add `is_tainted` column to `master_signals` data model |
| `CHANGELOG.md` | Modified | Add PRD-006 entries |

---

### Database Migration

**SQL to run in Supabase SQL Editor:**

```sql
-- PRD-006: Add tainted flag to master_signals
-- This column tracks whether the master signal contains data from a
-- session that has since been deleted. When true, the next generation
-- will force a cold-start rebuild instead of an incremental merge.

ALTER TABLE master_signals
  ADD COLUMN is_tainted BOOLEAN NOT NULL DEFAULT false;

-- No RLS changes needed — taint updates use the service role client.
-- No index needed — only the latest row is ever checked.
```

Save this as `docs/006-master-signal-cleanup/001-add-is-tainted-column.sql`.

---

### Implementation Increments

#### Increment 1.1: Database Migration + Service Layer

**Scope:**
- Run the `ALTER TABLE` migration to add `is_tainted` to `master_signals`.
- Update `MasterSignal` interface in `master-signal-service.ts` to include `isTainted`.
- Update `getLatestMasterSignal()` to select and map `is_tainted`.
- Add `taintLatestMasterSignal()` function.
- Import `createServiceRoleClient` in `master-signal-service.ts`.
- Update `deleteSession()` in `session-service.ts` to select `structured_notes` and conditionally call `taintLatestMasterSignal()`.

**Files modified:**
- `lib/services/master-signal-service.ts`
- `lib/services/session-service.ts`

**Files created:**
- `docs/006-master-signal-cleanup/001-add-is-tainted-column.sql`

**Verification:** TypeScript compiles. `taintLatestMasterSignal()` is callable from `deleteSession()`. New column exists in database.

---

#### Increment 1.2: API Route Updates

**Scope:**
- Update `POST /api/ai/generate-master-signal` to check `isTainted` and force cold-start when true.
- Update `GET /api/master-signal` to include `isTainted` in the response.

**Files modified:**
- `app/api/ai/generate-master-signal/route.ts`
- `app/api/master-signal/route.ts`

**Verification:** When the latest master signal has `is_tainted = true`, the generate endpoint runs cold-start instead of incremental. The GET endpoint returns `isTainted: true`.

---

#### Increment 1.3: Frontend Updates

**Scope:**
- Update `master-signal-page-content.tsx` to read `isTainted`, show the tainted banner, and clear state on regeneration.
- Update `prompt-editor-page-content.tsx` to read `isTainted` and resolve the correct master signal prompt key.

**Files modified:**
- `app/m-signals/_components/master-signal-page-content.tsx`
- `app/settings/_components/prompt-editor-page-content.tsx`

**Verification:** After deleting a session with signals, the master signal page shows the tainted banner. The settings page shows the cold-start prompt. After regenerating, the tainted banner disappears and the settings page switches back to the incremental prompt.

---

#### Increment 1.4: Documentation + Changelog

**Scope:**
- Update `ARCHITECTURE.md`: add `is_tainted` to `master_signals` data model, update Current State paragraph.
- Update `CHANGELOG.md` with PRD-006 entries.
- Update `docs/` file map entry in ARCHITECTURE.md.

**Files modified:**
- `ARCHITECTURE.md`
- `CHANGELOG.md`

**Verification:** All file paths in ARCHITECTURE.md exist. Data model matches the actual database schema.
