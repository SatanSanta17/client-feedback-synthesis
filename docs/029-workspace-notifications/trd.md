# TRD-029: Workspace Notifications

> **Status:** Drafting — Part 1 specified.
> **PRD:** `docs/029-workspace-notifications/prd.md` (approved)
> **Mirrors:** PRD Parts 1–5. Each part is written and reviewed one at a time. This document currently specifies Part 1 (Notification Data Model & Service); Parts 2–5 will be appended in subsequent revisions and must not regress the structures introduced here.

---

## Technical Decisions

These decisions apply across the PRD; Part 1 establishes the data and service foundation that the later parts compose against. Each decision documents a path *not* taken, so the reasoning survives the next person's "why didn't we just…" question.

1. **One table, two flavours of row, distinguished by nullable `user_id`.** Broadcast notifications (`user_id IS NULL`) reach every member of `team_id`; targeted notifications (`user_id IS NOT NULL`) reach only the named user. A separate `notification_recipients` join table was considered for future fan-out (broadcast to a sub-group) — rejected because no consumer needs sub-group fan-out and the join table would multiply row count, complicate RLS, and obscure the "delete one row to cancel a notification" semantics. If that need ever lands, it can be added without breaking the current shape.

2. **`team_id` is `NOT NULL`.** Every notification today belongs to a workspace context — `theme.merged` happens *in* a team, `supersession.proposed` happens *in* a team, `bulk_re_extract.completed` happens *in* a team. A future team-agnostic event (e.g., "your invitation was accepted") would relax the constraint then; it does not justify weakening the invariant now. The bell renders a workspace label per row (PRD §P2.R10), so `team_id` is also the source of that UI affordance.

3. **`payload` is `JSONB`, not a per-event-type column set.** Each event type has a different payload shape. JSONB lets the table absorb new event types without migrations. The application-layer event registry (Decision 5) is the source of truth for shape; Postgres treats payload as opaque. This trades schema-level type safety for extensibility — the right trade because (a) renderers are versioned in code anyway, and (b) every read flows through the typed registry.

4. **No `event_type` `CHECK` constraint at the database level.** A `CHECK (event_type IN (...))` would force a migration every time a new event type is added — directly conflicting with PRD §P3.R3 ("adding a new event type is a single-file change"). The application registry is the gate; the database trusts the application. The same precedent exists in `dashboard_insights` (insight types are constrained by app code, not enforced by every consumer).

5. **Closed event-type registry in code (`lib/notifications/events.ts`), Zod payload schemas keyed on event type.** Adding a new event = adding one entry to one map (event type id + Zod payload schema). The service rejects emits with an unknown event type and emits that fail Zod validation. This is the contract every later part (renderers, bell UI, retention) reads from.

6. **RLS scopes `SELECT` and `UPDATE`; `INSERT` and `DELETE` go through the service-role client.** The user reads their notifications and marks them read — both are user-authenticated actions and route through the anon client + RLS. Inserts originate from server-side application code (theme merge, bulk re-extract); they use the service-role client and are gated by the application-layer event registry. Cleanup deletes (Part 5) are also service-role. This mirrors the dashboard_insights pattern (TRD-021 §Part 5).

7. **Cross-workspace queries by default.** The repository's `listForUser`, `unreadCount`, and `markAllRead` accept `userId` and an *optional* `teamId` filter. The default (no `teamId`) returns every row visible to the user across every team they belong to — driven by PRD §P2.R10 ("the bell aggregates across the user's workspaces"). RLS enforces the visibility set; the queries simply ride on top.

8. **`expires_at` column from day 1, indexed.** Part 5 (retention) needs a per-row override even though the default policy is age-based. Adding the column + partial index now costs near-zero on a low-write table and avoids a second `ALTER TABLE` later when Part 5 lands. Most rows leave it NULL.

9. **Indexed for the three hot reads.** `(user_id, created_at DESC) WHERE user_id IS NOT NULL` for the targeted dropdown; `(team_id, created_at DESC) WHERE user_id IS NULL` for the broadcast dropdown; `(user_id, read_at) WHERE user_id IS NOT NULL AND read_at IS NULL` for the unread count. Broadcast unread count is computed inline against the same broadcast index — separate index not justified at expected volumes. All indexes are partial to keep them small.

10. **No realtime infrastructure in Part 1.** The table is realtime-friendly (small, append-mostly, RLS-scoped) but the delivery mechanism is a Part 4 decision. Part 1's contract is satisfied by polling alone — consumers can ship without Part 4. This is what lets PRD-026 P4 and PRD-028 P5.R9 unblock the moment Part 1 lands.

11. **Repository + service split mirrors the rest of the codebase.** `notification-repository.ts` (interface) + `supabase-notification-repository.ts` (adapter) + `notification-service.ts` (orchestration, validation, logging). No new architectural pattern — same DI shape as `conversation-repository`, `theme-repository`, `insight-repository`. Reading code in this PRD should feel identical to reading TRD-020 / TRD-021 / TRD-026 because it is.

12. **Service is the only entry point for emits.** Direct repository inserts are a footgun (skip Zod, skip event-registry validation, skip logging). Every consumer imports `notification-service.emit`, never the repository. Repository methods exist because the service needs them; they are not part of the public API.

---

## Part 1: Notification Data Model & Service

> Implements **P1.R1–P1.R7** from PRD-029.

### Overview

Stand up the persistent notification primitive: one table, RLS, a typed event registry, a repository, a service. After Part 1 lands, internal code can emit `theme.merged` / `supersession.proposed` / `bulk_re_extract.completed` events; rows land in `workspace_notifications`; the rows are visible (via RLS) to the right users. **No UI** in Part 1 — that is Part 2's job. **No realtime delivery** in Part 1 — that is Part 4's job. Verifiability of Part 1 is "the row is in the table and visible to the right people," tested via SQL probes.

The deliverables are five files (one migration, one domain type, one event registry, one repository pair, one service) plus the Supabase types regen and the ARCHITECTURE.md update.

### Forward Compatibility Notes

- **Part 2 (Header bell UI & dropdown):** consumes `notificationService.listForUser({ userId })` for the dropdown, `unreadCount({ userId })` for the badge, and `markRead` / `markAllRead` for the read flow. The default (no `teamId`) behaviour is what Part 2 needs for its cross-workspace bell (PRD §P2.R10). The repository's `listForUser` returns a stable shape (rows + nextCursor) so Part 2 can paginate without changing the repo. Part 2 introduces the API routes that wrap these service methods; Part 1 ships the service only.
- **Part 3 (Event-type catalogue & renderers):** Part 3 adds `lib/notifications/renderers.ts` (icon + title-template + deep-link per event type) as a sibling of `lib/notifications/events.ts` (Part 1). Renderers key off the event registry — they must use the same `NotificationEventType` enum and the same payload Zod schemas Part 1 defines. No schema or service change in Part 3.
- **Part 4 (Delivery mechanism):** Realtime, polling, or hybrid — all read from the same table and call the same service methods. The table's structure (partial indexes on `(user_id, created_at)` and `(team_id, created_at)`) keeps the polling query plan flat regardless of approach. If Realtime is chosen, Supabase Realtime requires no schema changes for `RLS`-aware subscriptions on this table.
- **Part 5 (Retention & cleanup):** Part 5 adds a scheduled job (cron, edge function, or pg_cron) that deletes rows older than the configured cutoff. The `expires_at` column added in Part 1's migration provides the per-row override Part 5 honours. The partial index `(expires_at) WHERE expires_at IS NOT NULL` makes Part 5's cleanup query cheap.
- **Future event consumers (PRD-025 purge run, additional bulk operations):** add to `NOTIFICATION_EVENTS` registry, add a Zod payload schema, add a renderer (Part 3 surface). No schema or service change.
- **Backlog (per-user notification preferences, mute event types):** would land as a new `notification_preferences` table keyed on `(user_id, event_type)` and a join in the service's read path. Today's API stays — preferences become an additional filter, not a refactor.
- **Backlog (email digest):** consumes the same table via a scheduled job that aggregates unread rows per user. No schema change.

### Database Changes

#### Migration: `001-create-workspace-notifications.sql`

```sql
-- ============================================================
-- PRD-029 Part 1: Workspace notifications primitive
-- ============================================================

CREATE TABLE workspace_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id     UUID                  REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

-- Hot path: targeted dropdown listing for one user
CREATE INDEX workspace_notifications_user_recent_idx
  ON workspace_notifications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Hot path: targeted unread count for badge
CREATE INDEX workspace_notifications_user_unread_idx
  ON workspace_notifications (user_id)
  WHERE user_id IS NOT NULL AND read_at IS NULL;

-- Hot path: broadcast dropdown listing per team (covers unread too;
-- broadcast volume is bounded so a separate unread index is unjustified).
CREATE INDEX workspace_notifications_team_recent_idx
  ON workspace_notifications (team_id, created_at DESC)
  WHERE user_id IS NULL;

-- Forward-compat: Part 5 cleanup query reads through this.
CREATE INDEX workspace_notifications_expires_idx
  ON workspace_notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------

ALTER TABLE workspace_notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: targeted rows the user owns OR broadcast rows for teams they belong to.
CREATE POLICY "Users can read their own and broadcast notifications"
  ON workspace_notifications
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = workspace_notifications.team_id
          AND team_members.user_id = auth.uid()
      )
    )
  );

-- UPDATE: same visibility set as SELECT. Service layer enforces that only
-- read_at is mutated; column-level enforcement is not offered by RLS.
CREATE POLICY "Users can mark visible notifications as read"
  ON workspace_notifications
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = workspace_notifications.team_id
          AND team_members.user_id = auth.uid()
      )
    )
  );

-- INSERT and DELETE: no policy = no anon access. Service-role client only.
```

**Why no `event_type` `CHECK` constraint:** Decision 4 — adding a new event type would otherwise require a migration. The application registry is the source of truth.

**Why `team_id` `NOT NULL`:** Decision 2 — every notification today is workspace-bound. Future team-agnostic events relax this when needed.

**Why `payload` defaults to `'{}'::jsonb`:** event types with no meaningful payload still have a syntactically valid value; service-layer Zod schemas decide whether the default is acceptable per-event.

**Why a separate broadcast index instead of a unified `(team_id, user_id, created_at)`:** the queries are partitioned by `user_id IS NULL` — a single composite index would not be selective for either side. Partial indexes match the query shape exactly and stay smaller.

**Why no FK from `team_id` to a soft-deleted check:** the `teams` cascade fires on hard delete; soft-deleted teams are filtered at the query layer like everywhere else in the codebase. No special-case here.

#### RLS interaction with `markRead`

The `UPDATE` policy lets the user update *any* column on rows they can see — not just `read_at`. This is intentional: enforcing column-level update restrictions in plain RLS is awkward (would require triggers or `SECURITY DEFINER` RPCs). The service layer is the gate: `notificationService.markRead` issues an update that sets only `read_at`, never any other column. Direct repository access is not exposed outside the service module. The same pattern holds for `dashboard_insights` and `conversations` — RLS scopes rows; the service scopes columns.

#### Generated types

After the migration applies, run `npx supabase gen types typescript --project-id <id> > lib/types/database.ts` and commit. The generated `Database['public']['Tables']['workspace_notifications']` shape is the input to the repository's `mapRow`.

### Type and Schema Changes

#### `lib/types/notification.ts` (new)

```typescript
import type { NotificationEventType } from "@/lib/notifications/events";

/**
 * Domain type for a workspace notification row. Mirrors the database shape
 * with snake_case → camelCase normalisation applied by the repository.
 *
 * The `payload` is typed as `unknown` here because the shape varies by
 * `eventType`. Callers narrow it via the registry's payload Zod schema:
 *
 *     const schema = NOTIFICATION_EVENTS[notification.eventType].payloadSchema;
 *     const payload = schema.parse(notification.payload);
 *
 * Never read `payload` without going through the registry — that is what
 * makes the closed event-type contract enforceable at runtime.
 */
export interface WorkspaceNotification {
  id: string;
  teamId: string;
  userId: string | null;          // null => broadcast to team
  eventType: NotificationEventType;
  payload: unknown;
  readAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Cursor for paginating `listForUser`. Stable across inserts because it
 *  uses `(createdAt, id)` rather than `OFFSET`. */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}
```

**Why `payload: unknown`:** the row's payload shape is a function of `eventType`. Typing it as a discriminated union per event would couple the domain type to the registry and force a circular import. `unknown` forces consumers through the registry's Zod schema, which is what Decision 5 requires.

**Why no `team` or `user` joined fields:** the primitive returns identifiers only. UI surfaces (Part 2) join names in their own queries or via the auth/team context they already have. Keeps the read query single-table and cheap.

#### `lib/notifications/events.ts` (new directory + file)

```typescript
import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-event payload schemas
//
// One `z.object(...)` per event type. Schemas are the contract between
// emitters (server-side code that fires an event) and consumers (the bell
// renderer in Part 3, retention in Part 5, future external delivery).
// ---------------------------------------------------------------------------

export const themeMergedPayloadSchema = z.object({
  archivedThemeId: z.string().uuid(),
  archivedThemeName: z.string().min(1),
  canonicalThemeId: z.string().uuid(),
  canonicalThemeName: z.string().min(1),
  actorId: z.string().uuid(),
  actorName: z.string().min(1),
  signalAssignmentsRepointed: z.number().int().nonnegative(),
});
export type ThemeMergedPayload = z.infer<typeof themeMergedPayloadSchema>;

export const supersessionProposedPayloadSchema = z.object({
  proposalCount: z.number().int().positive(),
  source: z.enum([
    "bulk_re_extract",
    "single_session_re_extract",
    "inline_dialog_timeout",
  ]),
  /** Operation id (e.g., the bulk-run id) when available. Null for sources
   *  with no first-class operation row to point at. */
  sourceOperationId: z.string().uuid().nullable(),
});
export type SupersessionProposedPayload = z.infer<typeof supersessionProposedPayloadSchema>;

export const bulkReExtractCompletedPayloadSchema = z.object({
  sessionsProcessed: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type BulkReExtractCompletedPayload = z.infer<typeof bulkReExtractCompletedPayloadSchema>;

// ---------------------------------------------------------------------------
// Closed event-type registry
//
// Adding a new event type is a single-file change here:
//   1. Define a payload schema above.
//   2. Add an entry below.
// Renderers (Part 3) and consumers see the new type the moment this file ships.
// ---------------------------------------------------------------------------

export const NOTIFICATION_EVENTS = {
  "theme.merged": {
    payloadSchema: themeMergedPayloadSchema,
  },
  "supersession.proposed": {
    payloadSchema: supersessionProposedPayloadSchema,
  },
  "bulk_re_extract.completed": {
    payloadSchema: bulkReExtractCompletedPayloadSchema,
  },
} as const satisfies Record<string, { payloadSchema: z.ZodSchema }>;

export type NotificationEventType = keyof typeof NOTIFICATION_EVENTS;

/** Type guard — returns true if a string is a registered event type. */
export function isNotificationEventType(value: string): value is NotificationEventType {
  return value in NOTIFICATION_EVENTS;
}

/** Look up the Zod schema for an event's payload. Throws if the event is
 *  unregistered (caller should have validated via `isNotificationEventType`
 *  first if the source is untrusted). */
export function payloadSchemaFor(eventType: NotificationEventType) {
  return NOTIFICATION_EVENTS[eventType].payloadSchema;
}
```

**Why `lib/notifications/` rather than `lib/services/notification/` or `lib/types/notification/`:** events + (future) renderers belong together as a domain primitive. They are not a service in their own right (no DB, no API), and not just types (they include logic). A dedicated folder lets Part 3 add `renderers.ts` next door without spilling across `lib/`.

**Why `as const satisfies ...`:** `as const` preserves the narrow string-literal keys for `NotificationEventType`; `satisfies` enforces that every entry has the right shape without widening the inferred type. Per CLAUDE.md ("Prefer `satisfies` over `as`").

**Why a `payloadSchemaFor` helper:** every consumer parses payloads through this — the closed registry is the single source of truth. Going through a helper means a future change (e.g., adding metadata per event) lands in one place.

#### `lib/repositories/notification-repository.ts` (new)

```typescript
import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";
import type { NotificationEventType } from "@/lib/notifications/events";

/** Insert payload — service has already validated event_type and payload shape. */
export interface NotificationInsert {
  team_id: string;
  user_id: string | null;
  event_type: NotificationEventType;
  payload: Record<string, unknown>;
  expires_at?: string | null;
}

export interface ListForUserOptions {
  userId: string;
  /** Optional workspace filter. Default (undefined) returns rows across every
   *  team the user belongs to — see PRD §P2.R10. */
  teamId?: string | null;
  limit?: number;
  cursor?: NotificationCursor | null;
  includeRead?: boolean;
  /** Window in days. Default 30. Older rows are not deleted by this method —
   *  retention is owned by Part 5. */
  windowDays?: number;
}

export interface ListForUserResult {
  rows: WorkspaceNotification[];
  nextCursor: NotificationCursor | null;
}

/**
 * Repository interface for workspace notifications.
 *
 * Read methods rely on RLS to scope rows. Write methods are split:
 *   - `insert` is service-role only (anon RLS denies INSERT).
 *   - `markRead` / `markAllRead` route through the user's anon client and
 *     update read_at; the UPDATE RLS policy enforces visibility, the service
 *     layer enforces column scope.
 */
export interface NotificationRepository {
  /** Service-role: inserts a row. Service layer has already validated the
   *  event type and payload. */
  insert(data: NotificationInsert): Promise<WorkspaceNotification>;

  /** Anon: lists rows visible to the user, most-recent first. RLS scopes the
   *  row set; this method only scopes by recency, read state, and pagination. */
  listForUser(options: ListForUserOptions): Promise<ListForUserResult>;

  /** Anon: count of unread rows visible to the user. */
  unreadCount(options: { userId: string; teamId?: string | null }): Promise<number>;

  /** Anon: set read_at on a single row the user can see. */
  markRead(notificationId: string): Promise<void>;

  /** Anon: set read_at on every unread row the user can see (optionally
   *  scoped to a single team). */
  markAllRead(options: { userId: string; teamId?: string | null }): Promise<void>;

  /** Service-role: delete rows older than `before` OR with expires_at past.
   *  Used by Part 5; included here so the contract is locked from day 1. */
  deleteExpired(options: {
    olderThan: string;
    olderThanRead: string;
  }): Promise<{ deleted: number }>;
}
```

**Why `markRead` does not take `userId`:** RLS already restricts which rows the user can update. Passing `userId` would invite the caller to assume server-side enforcement and silently break under role drift. The anon client carries the caller's identity; RLS is the gate.

**Why `markAllRead` *does* take `userId`:** the bulk update is `UPDATE ... WHERE read_at IS NULL` and RLS scopes it — but for the **service** to log the right userId and to emit the right metrics, the explicit parameter is clearer than reading from the JWT. The repository forwards what the service supplies.

**Why `deleteExpired` is in Part 1's interface even though Part 5 is the consumer:** locking the cleanup contract now means Part 5 is purely an additive (job + scheduling) change, not a repository-shape change. Decision 8.

**Why no `getById`:** no caller in any part needs to fetch a single row by id without context. Adding it would be speculative scaffolding.

#### `lib/repositories/supabase/supabase-notification-repository.ts` (new)

```typescript
import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  NotificationRepository,
  NotificationInsert,
  ListForUserOptions,
  ListForUserResult,
} from "../notification-repository";
import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";
import { isNotificationEventType } from "@/lib/notifications/events";

const LOG_PREFIX = "[supabase-notification-repo]";

const COLUMNS =
  "id, team_id, user_id, event_type, payload, read_at, expires_at, created_at";

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toNotification(row: any): WorkspaceNotification {
  // Defensive parse: a row whose event_type is not in the registry should
  // not crash the dropdown. We surface it through a fallback path in Part 3
  // (renderers) — but the domain type still narrows here so callers downstream
  // never see an unknown string masquerading as a registered event.
  if (!isNotificationEventType(row.event_type)) {
    console.warn(
      `${LOG_PREFIX} unknown event_type encountered: "${row.event_type}" (id: ${row.id}) — falling through.`
    );
  }
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id ?? null,
    // Cast preserves the registered-type narrowing; callers should still treat
    // payload via the registry schema before reading specific fields.
    eventType: row.event_type,
    payload: row.payload ?? {},
    readAt: row.read_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Creates a Supabase-backed NotificationRepository.
 *
 * @param supabase  - Supabase client. For `insert` and `deleteExpired`,
 *                    pass a service-role client. For `listForUser`,
 *                    `unreadCount`, `markRead`, `markAllRead`, pass the
 *                    user's anon client (RLS-scoped).
 */
export function createNotificationRepository(
  supabase: SupabaseClient
): NotificationRepository {
  return {
    async insert(data: NotificationInsert): Promise<WorkspaceNotification> {
      console.log(
        `${LOG_PREFIX} insert — eventType: ${data.event_type}, teamId: ${data.team_id}, userId: ${data.user_id ?? "(broadcast)"}`
      );

      const { data: row, error } = await supabase
        .from("workspace_notifications")
        .insert({
          team_id: data.team_id,
          user_id: data.user_id,
          event_type: data.event_type,
          payload: data.payload,
          expires_at: data.expires_at ?? null,
        })
        .select(COLUMNS)
        .single();

      if (error) {
        console.error(`${LOG_PREFIX} insert error:`, error);
        throw error;
      }

      console.log(`${LOG_PREFIX} inserted — id: ${row.id}`);
      return toNotification(row);
    },

    async listForUser(options: ListForUserOptions): Promise<ListForUserResult> {
      const limit = options.limit ?? DEFAULT_LIST_LIMIT;
      const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString();

      console.log(
        `${LOG_PREFIX} listForUser — userId: ${options.userId}, teamId: ${options.teamId ?? "(any)"}, limit: ${limit}, includeRead: ${options.includeRead ?? true}`
      );

      let query = supabase
        .from("workspace_notifications")
        .select(COLUMNS)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      if (options.teamId !== undefined && options.teamId !== null) {
        query = query.eq("team_id", options.teamId);
      }
      if (options.includeRead === false) {
        query = query.is("read_at", null);
      }
      if (options.cursor) {
        // Keyset pagination: rows older than the cursor row.
        // Compound order is (created_at desc, id desc) so we use
        // (created_at < cursor.createdAt) OR (created_at = cursor.createdAt AND id < cursor.id)
        query = query.or(
          `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error(`${LOG_PREFIX} listForUser error:`, error);
        throw error;
      }

      const rows = (data ?? []).slice(0, limit).map(toNotification);
      const nextCursor: NotificationCursor | null =
        (data?.length ?? 0) > limit
          ? { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1].id }
          : null;

      console.log(
        `${LOG_PREFIX} listForUser — returned ${rows.length} rows, nextCursor: ${nextCursor ? "yes" : "no"}`
      );

      return { rows, nextCursor };
    },

    async unreadCount(options: { userId: string; teamId?: string | null }): Promise<number> {
      console.log(
        `${LOG_PREFIX} unreadCount — userId: ${options.userId}, teamId: ${options.teamId ?? "(any)"}`
      );

      let query = supabase
        .from("workspace_notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

      if (options.teamId !== undefined && options.teamId !== null) {
        query = query.eq("team_id", options.teamId);
      }

      const { count, error } = await query;
      if (error) {
        console.error(`${LOG_PREFIX} unreadCount error:`, error);
        throw error;
      }

      console.log(`${LOG_PREFIX} unreadCount — count: ${count ?? 0}`);
      return count ?? 0;
    },

    async markRead(notificationId: string): Promise<void> {
      console.log(`${LOG_PREFIX} markRead — id: ${notificationId}`);

      const { error } = await supabase
        .from("workspace_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .is("read_at", null);  // idempotent — already-read rows untouched

      if (error) {
        console.error(`${LOG_PREFIX} markRead error:`, error);
        throw error;
      }
    },

    async markAllRead(options: { userId: string; teamId?: string | null }): Promise<void> {
      console.log(
        `${LOG_PREFIX} markAllRead — userId: ${options.userId}, teamId: ${options.teamId ?? "(all)"}`
      );

      let query = supabase
        .from("workspace_notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);

      if (options.teamId !== undefined && options.teamId !== null) {
        query = query.eq("team_id", options.teamId);
      }

      const { error } = await query;
      if (error) {
        console.error(`${LOG_PREFIX} markAllRead error:`, error);
        throw error;
      }
    },

    async deleteExpired(options: {
      olderThan: string;
      olderThanRead: string;
    }): Promise<{ deleted: number }> {
      console.log(
        `${LOG_PREFIX} deleteExpired — olderThan: ${options.olderThan}, olderThanRead: ${options.olderThanRead}`
      );

      // Two-phase delete so the read vs unread retention difference is honoured.
      const expiredByDate = await supabase
        .from("workspace_notifications")
        .delete({ count: "exact" })
        .or(
          `and(read_at.is.null,created_at.lt.${options.olderThan}),and(read_at.not.is.null,created_at.lt.${options.olderThanRead})`
        );

      const expiredByExplicit = await supabase
        .from("workspace_notifications")
        .delete({ count: "exact" })
        .lt("expires_at", new Date().toISOString());

      if (expiredByDate.error) {
        console.error(`${LOG_PREFIX} deleteExpired (by date) error:`, expiredByDate.error);
        throw expiredByDate.error;
      }
      if (expiredByExplicit.error) {
        console.error(`${LOG_PREFIX} deleteExpired (by expires_at) error:`, expiredByExplicit.error);
        throw expiredByExplicit.error;
      }

      const total = (expiredByDate.count ?? 0) + (expiredByExplicit.count ?? 0);
      console.log(`${LOG_PREFIX} deleteExpired — total: ${total}`);
      return { deleted: total };
    },
  };
}
```

**Why `markRead` adds `.is("read_at", null)`:** idempotency — re-running mark-read on an already-read row is a no-op rather than overwriting the original read timestamp. Bell UI clicks should be safe to retry.

**Why `listForUser` adds an extra row to the limit:** keyset pagination — the (limit + 1)th row is the cursor signal. If it exists, more pages are available; otherwise we are at the end. Pattern reused from `conversation-repository.list`.

**Why `unreadCount` uses `head: true`:** PostgREST returns only the count, no rows. Cheaper than a full select.

**Why `deleteExpired` is two phases:** the date-based deletion respects the read/unread asymmetry (Decision 8 / Part 5); the `expires_at` deletion is a flat past-due cutoff. Combining them in one query would force a single threshold and lose the per-row override.

### Service Changes

#### `lib/services/notification-service.ts` (new)

```typescript
import {
  NOTIFICATION_EVENTS,
  isNotificationEventType,
  payloadSchemaFor,
  type NotificationEventType,
} from "@/lib/notifications/events";
import type {
  NotificationRepository,
  ListForUserResult,
} from "@/lib/repositories/notification-repository";
import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";

const LOG_PREFIX = "[notification-service]";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmitInput {
  teamId: string;
  /** Omit or pass null for a broadcast notification (visible to all team members). */
  userId?: string | null;
  eventType: NotificationEventType;
  /** Validated against the event-type's Zod schema before insert. */
  payload: unknown;
  /** Optional per-row override for retention (Part 5). */
  expiresAt?: string | null;
}

export class UnknownEventTypeError extends Error {
  constructor(eventType: string) {
    super(`Unknown notification event type: "${eventType}". Add it to NOTIFICATION_EVENTS to emit.`);
    this.name = "UnknownEventTypeError";
  }
}

export class InvalidPayloadError extends Error {
  constructor(eventType: string, issues: string) {
    super(`Invalid payload for event type "${eventType}": ${issues}`);
    this.name = "InvalidPayloadError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit a workspace notification.
 *
 * Validates the event type against the closed registry, parses the payload
 * against that event's Zod schema, and writes a row through the supplied
 * repository (which must be backed by a service-role client).
 *
 * Throws:
 *   - UnknownEventTypeError if the event is not registered.
 *   - InvalidPayloadError if the payload fails Zod validation.
 *   - Any error the repository raises (logged and rethrown).
 *
 * Callers should NOT swallow these errors silently — an emit that fails is
 * a missed notification, which is better surfaced loudly.
 */
export async function emit(
  repo: NotificationRepository,
  input: EmitInput
): Promise<WorkspaceNotification> {
  const start = Date.now();
  console.log(
    `${LOG_PREFIX} emit — eventType: ${input.eventType}, teamId: ${input.teamId}, userId: ${input.userId ?? "(broadcast)"}`
  );

  if (!isNotificationEventType(input.eventType)) {
    console.error(`${LOG_PREFIX} emit — unknown event type "${input.eventType}"`);
    throw new UnknownEventTypeError(input.eventType);
  }

  const schema = payloadSchemaFor(input.eventType);
  const result = schema.safeParse(input.payload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    console.error(`${LOG_PREFIX} emit — payload validation failed for ${input.eventType}: ${issues}`);
    throw new InvalidPayloadError(input.eventType, issues);
  }

  try {
    const row = await repo.insert({
      team_id: input.teamId,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      payload: result.data as Record<string, unknown>,
      expires_at: input.expiresAt ?? null,
    });
    console.log(`${LOG_PREFIX} emit — id: ${row.id}, elapsed: ${Date.now() - start}ms`);
    return row;
  } catch (err) {
    console.error(`${LOG_PREFIX} emit — repo insert error after ${Date.now() - start}ms:`, err);
    throw err;
  }
}

export interface ListForUserParams {
  userId: string;
  teamId?: string | null;
  limit?: number;
  cursor?: NotificationCursor | null;
  includeRead?: boolean;
  windowDays?: number;
}

export async function listForUser(
  repo: NotificationRepository,
  params: ListForUserParams
): Promise<ListForUserResult> {
  console.log(
    `${LOG_PREFIX} listForUser — userId: ${params.userId}, teamId: ${params.teamId ?? "(any)"}, limit: ${params.limit ?? "default"}`
  );
  return repo.listForUser(params);
}

export async function unreadCount(
  repo: NotificationRepository,
  params: { userId: string; teamId?: string | null }
): Promise<number> {
  console.log(
    `${LOG_PREFIX} unreadCount — userId: ${params.userId}, teamId: ${params.teamId ?? "(any)"}`
  );
  return repo.unreadCount(params);
}

export async function markRead(
  repo: NotificationRepository,
  params: { userId: string; notificationId: string }
): Promise<void> {
  console.log(
    `${LOG_PREFIX} markRead — userId: ${params.userId}, notificationId: ${params.notificationId}`
  );
  await repo.markRead(params.notificationId);
}

export async function markAllRead(
  repo: NotificationRepository,
  params: { userId: string; teamId?: string | null }
): Promise<void> {
  console.log(
    `${LOG_PREFIX} markAllRead — userId: ${params.userId}, teamId: ${params.teamId ?? "(all)"}`
  );
  await repo.markAllRead(params);
}

/** Re-export the registry for callers that want to introspect known event
 *  types (e.g., admin tooling, tests). The registry itself is the public
 *  contract, not an implementation detail. */
export { NOTIFICATION_EVENTS };
```

**Why typed error classes (`UnknownEventTypeError`, `InvalidPayloadError`):** consumers can `instanceof`-check and decide to log + drop vs propagate. The default behaviour at every emit site should still be "throw and surface" — silent emit failures are exactly the failure mode this PRD exists to prevent.

**Why the service is a flat module of functions, not a class:** consistent with `insight-service.ts`, `theme-service.ts`, `chat-service.ts`. Functions take repository + params explicitly — dependency inversion at the call-site, no hidden state, trivially testable.

**Why `markRead` accepts `userId` even though the repository ignores it:** the service logs the userId for telemetry, and a future feature (notification-preference checks before emit, audit trail) will read it. Cheap forward-compat.

**Why `listForUser` does not Zod-parse payloads on read:** payload validation already ran at emit time; re-parsing every row on every list inflates the read path's CPU cost. Renderers (Part 3) parse only the rows they actually display, lazily. If a row's payload is malformed (which can only happen if the registry shape changes after a row is written), the renderer's fallback path covers it (Part 3).

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/029-workspace-notifications/001-create-workspace-notifications.sql` | **Create** | Migration — table, indexes, RLS policies |
| `lib/types/database.ts` (Supabase generated) | Regenerate | Reflect `workspace_notifications` |
| `lib/types/notification.ts` | **Create** | Domain `WorkspaceNotification`, `NotificationCursor` |
| `lib/notifications/events.ts` | **Create** | Closed event-type registry, payload Zod schemas, `isNotificationEventType`, `payloadSchemaFor` |
| `lib/repositories/notification-repository.ts` | **Create** | Repository interface |
| `lib/repositories/supabase/supabase-notification-repository.ts` | **Create** | Supabase adapter |
| `lib/services/notification-service.ts` | **Create** | Public emit/list/markRead/markAllRead/unreadCount + typed errors |
| `ARCHITECTURE.md` | Modify | `workspace_notifications` schema entry; file map adds `lib/notifications/`, `notification-repository.ts`, `notification-service.ts`; status line gains PRD-029 Part 1 |
| `CHANGELOG.md` | Modify | PRD-029 Part 1 entry |

No new env vars, no new external dependencies.

### Implementation

#### Increment 1.1 — Migration: schema + indexes + RLS

**What:** Land migration `001-create-workspace-notifications.sql` against Supabase. Regenerate types. The table exists, indexes exist, RLS is enabled, but no application code reads or writes it yet.

**Steps:**

1. Create `docs/029-workspace-notifications/001-create-workspace-notifications.sql` with the SQL from the migration section above.
2. Apply on dev project (Supabase SQL editor), then prod after dev verification.
3. Regenerate types: `npx supabase gen types typescript --project-id <id> > lib/types/database.ts` and commit.
4. No application file changes in this increment — the regenerated `database.ts` is the only diff.

**Verification:**

1. `\d workspace_notifications` in psql (or PostgREST introspection) shows all 8 columns with correct types and the four indexes.
2. `SELECT polname, polcmd FROM pg_policies WHERE tablename = 'workspace_notifications';` shows the SELECT and UPDATE policies.
3. RLS smoke: as a non-team-member user, `SELECT count(*) FROM workspace_notifications;` returns 0 even after a service-role insert into another team. As a team member, the same query returns the broadcast row.
4. `npx tsc --noEmit` passes (the regenerated `database.ts` is the only addition; no callers yet).

**Post-increment:** none — ARCHITECTURE update batched into the audit increment.

---

#### Increment 1.2 — Domain type + event registry

**What:** Add `lib/types/notification.ts` and `lib/notifications/events.ts`. No DB calls, no service yet — just the contract that the repository (1.3) and service (1.4) depend on.

**Steps:**

1. Create `lib/types/notification.ts` per the §Type and Schema Changes section.
2. Create `lib/notifications/` directory and `lib/notifications/events.ts` per the same section. Includes:
   - Three payload Zod schemas (`themeMergedPayloadSchema`, `supersessionProposedPayloadSchema`, `bulkReExtractCompletedPayloadSchema`).
   - `NOTIFICATION_EVENTS` registry (`as const satisfies ...`).
   - `NotificationEventType` (derived).
   - `isNotificationEventType` type guard.
   - `payloadSchemaFor` helper.
3. No imports added anywhere else yet.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Quick repl/smoke (or a throwaway test script):
   ```typescript
   import { isNotificationEventType, payloadSchemaFor } from "@/lib/notifications/events";
   isNotificationEventType("theme.merged"); // true
   isNotificationEventType("nope.bogus");   // false
   payloadSchemaFor("theme.merged").safeParse({}).success; // false (missing fields)
   ```
3. Adding a stub fourth event type (e.g., `"test.stub"`) requires editing only `events.ts` — proven by manually adding the type, verifying `isNotificationEventType("test.stub")` returns true, then reverting.

**Post-increment:** none.

---

#### Increment 1.3 — Repository interface + Supabase adapter

**What:** Create `lib/repositories/notification-repository.ts` and `lib/repositories/supabase/supabase-notification-repository.ts`. Methods: `insert`, `listForUser`, `unreadCount`, `markRead`, `markAllRead`, `deleteExpired`. No service consumption yet.

**Steps:**

1. Create `lib/repositories/notification-repository.ts` per §Type and Schema Changes — interface only, plus `NotificationInsert`, `ListForUserOptions`, `ListForUserResult`.
2. Create `lib/repositories/supabase/supabase-notification-repository.ts` per the same section — `createNotificationRepository(supabase)` factory returning the interface implementation.
3. `mapRow` (`toNotification`) handles the camelCase normalisation and emits a console.warn if the event_type is not in the registry (defence in depth).
4. Logging uses `[supabase-notification-repo]` prefix. Every method logs entry; `insert` and `markRead`/`markAllRead`/`deleteExpired` log success/error; `listForUser` and `unreadCount` log returned counts.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Repository smoke (REPL or throwaway script with a service-role client):
   - Insert a `theme.merged` row with a fabricated payload → returns the new id.
   - `listForUser({ userId })` with the inserter's id returns the row when `user_id` matches; returns the row from broadcast when `user_id` is null and the inserter is a team member.
   - `unreadCount({ userId })` returns 1 immediately, 0 after `markRead`.
   - `markAllRead({ userId })` is idempotent — re-running on the same set yields no errors.
   - `deleteExpired({ olderThan: <future>, olderThanRead: <future> })` removes the test rows and returns `deleted >= 1`.
3. RLS verification: with the **anon** client of a non-team-member, `listForUser({ userId: nonMember.id })` returns 0 rows for both targeted-to-someone-else and broadcast-of-other-team rows.

**Post-increment:** none.

---

#### Increment 1.4 — Service: emit + read + mark + typed errors

**What:** Create `lib/services/notification-service.ts` with the public API per §Service Changes. Wires the event registry, the Zod payload validation, and the repository together.

**Steps:**

1. Create `lib/services/notification-service.ts` with:
   - `emit(repo, input)` — registry check → Zod parse → `repo.insert` with elapsed-ms log.
   - `listForUser`, `unreadCount`, `markRead`, `markAllRead` — thin wrappers that log and delegate.
   - `UnknownEventTypeError`, `InvalidPayloadError` exported.
   - Re-export `NOTIFICATION_EVENTS`.
2. Logging prefix `[notification-service]`. Every public function logs entry context (the params relevant to debugging) and exit (id / row count / elapsed).
3. **Internal use only — no API routes ship in Part 1.** Consumer PRDs (PRD-026 P4, PRD-028 P5.R9, future PRD-025 / PRD-017) import the service directly from server-side code (route handlers, services, post-response chains). Part 2 adds the API routes for the bell UI.

**Verification:**

1. `npx tsc --noEmit` passes.
2. End-to-end smoke (server-side script or a throwaway dev API route):
   - `emit(repo, { teamId, eventType: "theme.merged", payload: {...} })` with a valid payload → returns `WorkspaceNotification`; row visible via SQL.
   - Same call with an unknown event type (`eventType: "nope" as any`) → throws `UnknownEventTypeError`; no row inserted.
   - Same call with a malformed payload (e.g., missing `archivedThemeId`) → throws `InvalidPayloadError`; no row inserted.
   - `listForUser` round-trips inserted rows through the service and the result has the right shape (camelCase, `payload` is the parsed shape).
   - `markRead` flips `read_at`; subsequent `unreadCount` reflects it.
3. **Critical contract test:** call `emit` with `eventType: "supersession.proposed"` and a payload that includes an unexpected extra key. `z.object` **strips** unknown keys by default — confirm the inserted row's `payload` has only the schema-defined keys. (If you need strict rejection of extras, append `.strict()` to the schema; if you need to retain unknown keys for forward-compat, append `.passthrough()`. Default "strip" is the right behaviour here — payloads stay tight, and a renaming on the emitter side surfaces as missing fields rather than silent drift.)

**Post-increment:** none.

---

#### Increment 1.5 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** confirm each file does one thing — `notification.ts` (types), `events.ts` (registry + schemas), `notification-repository.ts` (interface), `supabase-notification-repository.ts` (Supabase adapter), `notification-service.ts` (orchestration + validation). If `events.ts` has grown beyond registry + schemas (e.g., ad-hoc helpers creeping in), split.
2. **DRY:** the `(user_id = auth.uid()) OR (user_id IS NULL AND team-member)` predicate appears in two RLS policies. Acceptable — RLS does not let us factor it. The `windowDays * 24 * 60 * 60 * 1000` calculation appears once; if a second use emerges, promote to `lib/utils/time.ts`. Don't pre-extract.
3. **Design tokens / styling:** N/A — no UI in Part 1.
4. **Logging:** every method emits entry/exit. Errors include context (event type, ids). No silent catches. The `[supabase-notification-repo]` and `[notification-service]` prefixes are distinct so dashboards can filter.
5. **Dead code:** no leftover scaffolding from incremental builds. No unused imports. No commented-out code.
6. **Convention compliance:**
   - Named exports only (✓ — `notification-service.ts` and the repository factory).
   - Kebab-case file names (✓).
   - PascalCase types (`WorkspaceNotification`, `NotificationRepository`, `EmitInput`).
   - Zod schemas camelCase + `Schema` suffix (`themeMergedPayloadSchema`).
   - Snake_case DB columns (✓ — `workspace_notifications`, `event_type`, `read_at`).
   - Import order: React/Next → third-party → internal utilities → internal components → services/hooks → types.
7. **Type tightening:** confirm no `any` leaks into public types. The repository's `mapRow` uses one ESLint-suppressed `any` for the raw Supabase row — same as existing repositories.
8. **ARCHITECTURE.md updates:**
   - Database tables list: add `workspace_notifications` to the headline list.
   - Add a `### \`workspace_notifications\`` schema subsection with columns, indexes, RLS summary.
   - File map: add under `lib/`:
     - `lib/notifications/events.ts`
     - `lib/repositories/notification-repository.ts`
     - `lib/repositories/supabase/supabase-notification-repository.ts`
     - `lib/services/notification-service.ts`
     - `lib/types/notification.ts`
   - Implementation status line: append "PRD-029 Part 1 (Notification Data Model & Service) implemented".
9. **CHANGELOG.md:** add a PRD-029 Part 1 entry — "Workspace notifications primitive: `workspace_notifications` table with RLS, closed event registry, repository, and service. Internal-only — no UI yet (Part 2)."
10. **Verify file references:** `grep -F "lib/services/notification-service.ts" ARCHITECTURE.md` returns the new entry; same for the other four new files.
11. **Re-run flows touched by Part 1:** none — Part 1 has no consumer yet. Confirm existing extraction, theme assignment, and chat flows are unaffected (no shared file edited).
12. **Final:** `npx tsc --noEmit`.

This audit closes Part 1.

---

## Part 2: Header Bell UI & Dropdown

> Implements **P2.R1–P2.R10** from PRD-029.

### Overview

Make Part 1's primitive visible. The bell is a single icon-with-badge in the sidebar chrome that opens a popover listing recent notifications. Each row carries a workspace label (cross-workspace bell per PRD §P2.R10), an event-specific icon and title (via the renderer scaffolding introduced here, which Part 3 fills with per-event content), a relative timestamp, and — when applicable — a deep-link target. Clicking a row marks it read and navigates to the deep-link, switching active workspace first if the row belongs to a different team.

The work splits into four moving pieces:

1. **API surface** — four route handlers wrap the Part 1 service. They authenticate the user, instantiate the repository against the user's anon client (RLS-scoped), call the service, and return JSON.
2. **Renderer scaffold** — `lib/notifications/renderers.ts` ships the renderer *interface*, a *fallback* renderer for unknown event types, and a `renderNotification(notification)` helper that the bell row consumes. Part 3 populates the per-event entries; Part 2 ensures the consumer is ready.
3. **Hooks** — `lib/hooks/use-notifications.ts`, `use-unread-count.ts`, `use-mark-notification-read.ts`. Visibility-aware polling for the unread badge (Part 4 may upgrade to realtime — same hook surface).
4. **Components & integration** — `components/notifications/{notification-bell, notification-dropdown, notification-row, notification-empty-state}.tsx`, plus the sidebar wire-up in `components/layout/app-sidebar.tsx`.

The `Part 1 → Part 2` seam is exactly the `notification-service` public API. No service changes; the only repository addition is a bell-shaped listing method (`listForBell`) that joins `team_id → teams.name` server-side so the row can render its workspace label without a second client-side fetch.

### Forward Compatibility Notes

- **Part 3 (Renderer catalogue).** Part 2 lands `lib/notifications/renderers.ts` with the registry *type* (`RendererRegistry`), an empty (or skeleton) `NOTIFICATION_RENDERERS` map, and the `renderNotification` lookup that falls back to a generic icon + title for unregistered types. Part 3 adds entries to the map — that is its entire footprint. The bell, the row, the API routes, the hooks: nothing changes.
- **Part 4 (Delivery mechanism).** The polling implementation in `use-unread-count.ts` is page-visibility-aware (pauses when hidden, refetches on focus). When Part 4 lands, the polling loop is replaced by — or augmented with — a Supabase Realtime subscription, but the public hook return shape (`{ count, refetch }`) is unchanged. Part 2's components never know which mechanism is in use.
- **Part 5 (Retention & cleanup).** No bell-level concern. The cleanup job calls `repo.deleteExpired` (interface from Part 1); the bell's read paths transparently see the smaller table.
- **Future event consumers.** Adding a new event type lights up in the bell automatically the moment Part 3's renderer entry ships — Part 2's bell renders any registered event without code changes.
- **Backlog (per-user notification preferences).** When mute-by-event-type lands, the read hooks gain a `mutedTypes` filter (likely server-side via the API route). The bell continues consuming the hook's return shape; no component change.
- **Backlog (notification grouping).** Group-by-event-type rendering would slot into `notification-dropdown.tsx` between the row map and the rendered list. The renderer interface stays single-row.

### API Routes

Four Next.js Route Handlers under `app/api/notifications/`. Each uses the `requireAuth` helper from `lib/api/route-auth.ts` to extract the authenticated user's Supabase client and user id. RLS scopes the row set; the service-layer error types (`UnknownEventTypeError`, `InvalidPayloadError`) cannot fire from any of these (the routes never emit) so the only error mapping is auth + repository errors.

#### `GET /api/notifications` — paginated listing

| Query param | Type | Default | Purpose |
|---|---|---|---|
| `cursor` | string (URL-encoded `<createdAt>:<id>`) | none | Keyset pagination cursor from the previous page's `nextCursor`. |
| `limit` | int | 50 | Page size; max 100 (clamped by the route, not the service). |
| `includeRead` | "true" \| "false" | "true" | When false, returns only unread rows. |
| `windowDays` | int | 30 | Recency window. Capped at 365. |

Response: `{ rows: BellNotificationRow[], nextCursor: { createdAt: string, id: string } | null }`.

`BellNotificationRow` is `WorkspaceNotification & { teamName: string }` — the `teamName` field is what makes the bell's per-row workspace label work without a second fetch (PRD §P2.R10). The route delegates to a new `repo.listForBell` method (see §Repository Changes) which joins `teams.name` server-side.

Validation: a Zod schema parses the query string. Bad params return HTTP 400 with `{ message }`.

#### `GET /api/notifications/unread-count` — badge count

Response: `{ count: number }`. No params. Fast — backed by the `(user_id) WHERE user_id IS NOT NULL AND read_at IS NULL` partial index from Part 1.

#### `POST /api/notifications/[id]/read` — mark one read

Empty body. Response: `{ ok: true }`. RLS enforces ownership; passing an `id` for a row the user cannot see is a no-op (the underlying `UPDATE` matches zero rows). The route does *not* return 404 in that case — distinguishing "doesn't exist" from "RLS-denied" leaks information about other users' notifications. The bell is fire-and-forget on this endpoint anyway; clients optimistically toggle the row's read state and refetch the unread count on next poll.

#### `POST /api/notifications/mark-all-read` — bulk mark

Optional body: `{ teamId?: string }` to scope the bulk action to one workspace. Default (no body) marks every unread row visible to the user across every team — the cross-workspace bell case from PRD §P2.R10 / §P2.R6.

Response: `{ ok: true }`. Same RLS semantics as `markRead`.

### Repository Changes

#### `lib/repositories/notification-repository.ts` (extend)

Add one new method to the interface:

```typescript
export interface BellNotificationRow extends WorkspaceNotification {
  /** Joined from `teams.name` at read time. The bell uses this directly so
   *  it can render the workspace label without a second round trip. */
  teamName: string;
}

export interface ListForBellResult {
  rows: BellNotificationRow[];
  nextCursor: NotificationCursor | null;
}

export interface NotificationRepository {
  // ... existing methods ...

  /** Anon: same shape as `listForUser` but with each row's workspace label
   *  joined in. Used exclusively by the bell UI's API route. */
  listForBell(options: ListForUserOptions): Promise<ListForBellResult>;
}
```

**Why a separate method instead of an option flag on `listForUser`:** keeping `listForUser` table-shaped (its result type maps 1:1 to `WorkspaceNotification`) preserves the Part 1 invariant that consumers can rely on the basic shape. `listForBell` is explicit about the augmentation; the type signature makes the join visible at the call site rather than hiding it behind an `includeTeamName: true` boolean.

**Why on the repository, not as a join in the API route:** the bell pages of 50 rows could touch up to 50 distinct team_ids in pathological cross-workspace cases; a server-side `select(teams!inner(name))` join in one query is much cheaper than the route firing N team-name lookups or a second batched query. Repository is also the natural home for SQL composition.

#### `lib/repositories/supabase/supabase-notification-repository.ts` (extend)

Add the `listForBell` implementation. It mirrors `listForUser` but extends the `select` to include the joined team name, and the row mapper produces `BellNotificationRow`:

```typescript
const BELL_COLUMNS = `${COLUMNS}, teams!inner(name)`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toBellNotification(row: any): BellNotificationRow {
  const base = toNotification(row);
  // PostgREST returns the joined relation as an object (or array, depending on
  // FK cardinality). teams is single-FK so we expect a single object.
  const teamName = row.teams?.name ?? "(unknown workspace)";
  return { ...base, teamName };
}

// Inside createNotificationRepository(...)
async listForBell(options: ListForUserOptions): Promise<ListForBellResult> {
  // ...same body as listForUser but selects BELL_COLUMNS and maps via
  // toBellNotification; the cursor logic, window, includeRead, and team-filter
  // helper are unchanged.
}
```

**Why `teams!inner(name)`:** `inner` enforces that every notification row has a parent team (the schema's `team_id NOT NULL` makes this true; if any row lost its parent for some reason the inner join would drop it, which is the right behaviour — orphaned rows shouldn't render). PostgREST's relation-name syntax automatically routes through the FK.

**Why `toBellNotification` reuses `toNotification`:** keeps the camelCase mapping in one place (DRY). The augmentation is a single field; reimplementing the mapping would invite drift.

### Renderer Scaffolding

#### `lib/notifications/renderers.ts` (new)

Part 2 ships the *interface* and the *consumer* (`renderNotification`); Part 3 fills the registry. The fallback path renders any registered-but-unrendered event type AND any unregistered event type (defence in depth — RLS or row corruption could in principle deliver a row whose event_type the client doesn't recognise).

```typescript
import { Bell } from "lucide-react";
import type { ComponentType } from "react";
import type { z } from "zod";

import {
  NOTIFICATION_EVENTS,
  payloadSchemaFor,
  type NotificationEventType,
} from "@/lib/notifications/events";
import type { WorkspaceNotification } from "@/lib/types/notification";

/**
 * Per-event renderer contract. Each entry is parameterised by the event's
 * payload type so Part 3 authors get type-safe access to payload fields
 * inside `title` and `deepLink`.
 */
export type RendererFor<E extends NotificationEventType> = {
  icon: ComponentType<{ className?: string }>;
  title: (
    payload: z.infer<(typeof NOTIFICATION_EVENTS)[E]["payloadSchema"]>
  ) => string;
  deepLink: (
    payload: z.infer<(typeof NOTIFICATION_EVENTS)[E]["payloadSchema"]>
  ) => string | null;
};

/** Total registry over every registered event type. Part 3 makes this total;
 *  in Part 2 we type it as `Partial<...>` so the bell ships before renderers do. */
export type RendererRegistry = {
  [E in NotificationEventType]: RendererFor<E>;
};

/**
 * Part 2 ships an empty registry. Part 3 populates each event type. The
 * `Partial<...>` cast is intentional — it means a deploy that lands a new
 * event type before its renderer still produces a working (fallback) UI.
 */
export const NOTIFICATION_RENDERERS: Partial<RendererRegistry> = {};

/**
 * The shape every bell row consumes. Independent of the event type so the
 * row component does not need to special-case events.
 */
export interface RenderedNotification {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Null when the event has no meaningful destination (the row is informational). */
  deepLink: string | null;
}

const FALLBACK: RenderedNotification = {
  icon: Bell,
  title: "Workspace activity",
  deepLink: null,
};

/**
 * Look up and run the renderer for a notification. Validates the payload
 * against the event's Zod schema before passing it to the renderer; a
 * malformed payload also falls through to FALLBACK so a single bad row
 * cannot crash the dropdown.
 */
export function renderNotification(
  notification: WorkspaceNotification
): RenderedNotification {
  const renderer = NOTIFICATION_RENDERERS[notification.eventType];
  if (!renderer) {
    return FALLBACK;
  }
  const schema = payloadSchemaFor(notification.eventType);
  const result = schema.safeParse(notification.payload);
  if (!result.success) {
    console.warn(
      `[notification-renderer] payload mismatch for ${notification.eventType} (id: ${notification.id}); falling through.`
    );
    return FALLBACK;
  }
  // The renderer's payload param is narrowed to the inferred type for the
  // specific event — the indexed access above guarantees match-up.
  return {
    icon: renderer.icon,
    title: (renderer.title as (payload: unknown) => string)(result.data),
    deepLink: (renderer.deepLink as (payload: unknown) => string | null)(result.data),
  };
}
```

**Why the registry is `Partial<RendererRegistry>` and not the total `RendererRegistry`:** during Part 2 it's empty by design; even after Part 3, a deploy that introduces a new event type before its renderer ships still produces a working fallback. Type-level totality would force every event to ship with a renderer in the same PR, coupling concerns the PRD explicitly decouples (P3.R3 — "single-file change to add an event type" — covers the *event-type* file, not necessarily a paired renderer landing simultaneously).

**Why the renderer cast inside `renderNotification`:** TypeScript cannot statically tie the registry's per-event payload narrowing to a generic lookup. The runtime guarantee — that `payloadSchemaFor(eventType)` returns the schema whose `z.infer` type matches the renderer's payload param — is exactly what makes the cast safe. Comment makes the invariant explicit.

**Why `Bell` from lucide-react as the fallback icon:** matches the bell trigger; the user already understands "bell = notification". Using the same icon for the fallback row keeps the visual language tight.

### Hooks

Three hooks under `lib/hooks/`. Each follows the project's `useX` naming and returns an object (per CLAUDE.md "Custom hooks return objects, not arrays").

#### `lib/hooks/use-unread-count.ts` (new)

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 30_000;

export interface UseUnreadCountReturn {
  count: number;
  /** Imperative refetch — used by the bell after marking rows read. */
  refetch: () => Promise<void>;
}

/**
 * Polls the unread-count endpoint while the tab is visible; pauses when
 * hidden; refetches on focus. Forward-compatible with Part 4: when Realtime
 * lands, this hook's body changes but the public return shape does not.
 */
export function useUnreadCount(): UseUnreadCountReturn {
  const [count, setCount] = useState<number>(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      if (!cancelledRef.current) setCount(data.count);
    } catch (err) {
      console.error("[useUnreadCount] fetch failed:", err);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function schedule() {
      clearTimer();
      if (document.visibilityState !== "visible") return;
      void fetchCount();
      timerRef.current = setTimeout(schedule, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") schedule();
      else clearTimer();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchCount]);

  return { count, refetch: fetchCount };
}
```

#### `lib/hooks/use-notifications.ts` (new)

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

import type { BellNotificationRow } from "@/lib/repositories/notification-repository";
import type { NotificationCursor } from "@/lib/types/notification";

const PAGE_LIMIT = 50;

export interface UseNotificationsReturn {
  rows: BellNotificationRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Imperative refetch from the start (drops `rows` and reloads). */
  refresh: () => Promise<void>;
  /** Append the next page using the current cursor. No-op when `hasMore` is false. */
  loadMore: () => Promise<void>;
  /** Optimistic local mutation — toggles `readAt` on a single row.
   *  The bell calls this after firing `markRead` so the UI reflects the change
   *  before the next poll. */
  markRowReadLocally: (id: string) => void;
  /** Optimistic local mutation — clears `readAt: null` on every row. */
  markAllRowsReadLocally: () => void;
}

export function useNotifications(): UseNotificationsReturn {
  const [rows, setRows] = useState<BellNotificationRow[]>([]);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (pageCursor: NotificationCursor | null): Promise<void> => {
      const isFirstPage = pageCursor === null;
      if (isFirstPage) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_LIMIT));
        if (pageCursor) {
          params.set("cursor", `${pageCursor.createdAt}:${pageCursor.id}`);
        }
        const res = await fetch(`/api/notifications?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          rows: BellNotificationRow[];
          nextCursor: NotificationCursor | null;
        };
        setRows((prev) => (isFirstPage ? data.rows : [...prev, ...data.rows]));
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notifications");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    []
  );

  const refresh = useCallback(() => fetchPage(null), [fetchPage]);
  const loadMore = useCallback(
    () => (hasMore && cursor ? fetchPage(cursor) : Promise.resolve()),
    [fetchPage, hasMore, cursor]
  );

  const markRowReadLocally = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id && r.readAt === null
        ? { ...r, readAt: new Date().toISOString() }
        : r))
    );
  }, []);

  const markAllRowsReadLocally = useCallback(() => {
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => (r.readAt === null ? { ...r, readAt: now } : r)));
  }, []);

  // Initial load — fires once when the bell mounts (the dropdown lazy-mounts
  // its content, so this only runs when the user actually opens the bell).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, isLoading, isLoadingMore, hasMore, error, refresh, loadMore, markRowReadLocally, markAllRowsReadLocally };
}
```

#### `lib/hooks/use-mark-notification-read.ts` (new)

```typescript
"use client";

import { useCallback } from "react";

export interface UseMarkNotificationReadReturn {
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: (teamId?: string | null) => Promise<void>;
}

/**
 * Fire-and-forget POSTs against the mark-read endpoints. Failures are logged
 * but not surfaced — bell UI stays optimistic, and the next unread-count
 * poll corrects any drift.
 */
export function useMarkNotificationRead(): UseMarkNotificationReadReturn {
  const markRead = useCallback(async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "POST",
      });
      if (!res.ok) console.error(`[useMarkNotificationRead] markRead — HTTP ${res.status}`);
    } catch (err) {
      console.error("[useMarkNotificationRead] markRead failed:", err);
    }
  }, []);

  const markAllRead = useCallback(async (teamId?: string | null) => {
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamId ? { teamId } : {}),
      });
      if (!res.ok) console.error(`[useMarkNotificationRead] markAllRead — HTTP ${res.status}`);
    } catch (err) {
      console.error("[useMarkNotificationRead] markAllRead failed:", err);
    }
  }, []);

  return { markRead, markAllRead };
}
```

### Components

Five components under `components/notifications/`. All client components (need state + event handlers); each is small and single-purpose.

#### `components/notifications/notification-bell.tsx` — trigger + badge

`NotificationBell` is the only public export from this folder. It composes the dropdown internally — consumers (the sidebar) just drop it in. Renders a `<Popover>` whose trigger is the bell icon with a badge overlay. Clicking the trigger opens the dropdown; the dropdown lazy-mounts its inner list (so the `useNotifications` fetch only fires when the user actually opens the bell).

Inputs: none (auth + active workspace come from `useAuth`).

Composition: `<Popover>` (shadcn) → `<PopoverTrigger>` (bell + badge) → `<PopoverContent>` (`<NotificationDropdown />`).

Accessibility: `aria-label` on the trigger reads `"Notifications, N unread"` when `count > 0`, `"Notifications"` otherwise (cohesive-decoration pattern from PRD-024 P4 / P5). `aria-live="polite"` on the badge so screen readers announce changes without stealing focus.

#### `components/notifications/notification-dropdown.tsx` — popover content

Composes header + list + footer:

- Header: title `"Notifications"` + `"Mark all as read"` action (visible only when at least one row is unread).
- List: `useNotifications().rows`. Maps each row through `<NotificationRow>`. Empty / loading / error states are sibling `<div>`s, not separate components.
- Footer (when `hasMore`): `<button>` calling `loadMore()`. Hidden when no further pages.

Empty state: `<NotificationEmptyState>` (separate file because it has copy that may need design iteration; pulling it out keeps the dropdown shell minimal).

Layout: max-height bound + internal scroll so a long list doesn't push the popover off-screen. Uses existing tokens (`var(--surface-elevated)`, etc.) — no new tokens introduced (P2.R9).

#### `components/notifications/notification-row.tsx` — single row

Inputs: `{ notification: BellNotificationRow }`.

Renders icon (from `renderNotification`), title, workspace label (from `notification.teamName` — only rendered when the user belongs to more than one workspace, gated by a prop the dropdown computes), relative timestamp ("2 hours ago"), and read/unread visual state.

Click handler:

```typescript
const onClick = useCallback(async () => {
  const rendered = renderNotification(notification);

  // 1. Optimistic local read mark + fire-and-forget POST.
  if (notification.readAt === null) {
    markRowReadLocally(notification.id);
    void markRead(notification.id);
    void refetchUnreadCount();
  }

  // 2. Cross-workspace switch if needed (PRD §P2.R10).
  if (notification.teamId !== activeTeamId) {
    setActiveTeam(notification.teamId);
  }

  // 3. Navigate (or close popover if no deep link).
  if (rendered.deepLink) {
    router.push(rendered.deepLink);
  }
  closePopover();
}, [notification, activeTeamId, ...]);
```

The order matters: mark read → switch workspace → navigate. Switching workspace before navigation ensures the destination renders in the correct workspace context (prevents a flash of "no data" on the destination page when the active workspace is mid-transition).

Read vs unread visual: a small leading dot (`bg-[var(--brand-primary)]`) when `readAt === null`, dimmed text (`text-muted-foreground`) when read. Reuses the same dot pattern PRD-024 introduced for streaming indicators — the visual vocabulary already exists.

Relative timestamp: existing project pattern uses `formatDistanceToNow` from `date-fns` (already a dep). Wrapped in a small helper so the row file stays focused.

#### `components/notifications/notification-empty-state.tsx` — "you're all caught up"

Tiny presentational component. Static copy + a muted icon.

#### `components/notifications/notification-skeleton.tsx` — loading state

Three skeleton rows during the initial fetch. Reuses shadcn's `<Skeleton>` primitive. Same tokens as the rest of the app.

### Layout Integration

#### `components/layout/app-sidebar.tsx` (modify)

The bell sits in the bottom region of the sidebar, next to the user menu and theme toggle — that block already hosts user-scoped chrome (settings dropdown, theme toggle, user menu, workspace switcher). Adding the bell there keeps the visual grouping coherent. The bell does not appear as a top-level `NAV_ITEM` because it is not a route — it is an action.

Exact placement: between the theme toggle and the user menu. The mobile sheet variant of the sidebar (already present) gets the bell in the same region.

The integration is a single-line addition:

```tsx
<div className="...sidebar-footer-region...">
  <ThemeToggle />
  <NotificationBell />
  <UserMenu />
</div>
```

No prop wiring — the bell self-fetches. No effect on the existing Chat icon's streaming indicator dot (different concern, different surface).

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/api/notifications/route.ts` | **Create** | `GET` — paginated bell listing |
| `app/api/notifications/unread-count/route.ts` | **Create** | `GET` — badge count |
| `app/api/notifications/[id]/read/route.ts` | **Create** | `POST` — mark one read |
| `app/api/notifications/mark-all-read/route.ts` | **Create** | `POST` — bulk mark |
| `lib/repositories/notification-repository.ts` | Modify | Add `BellNotificationRow`, `ListForBellResult`, `listForBell` to the interface |
| `lib/repositories/supabase/supabase-notification-repository.ts` | Modify | Implement `listForBell` with `teams!inner(name)` join + `toBellNotification` mapper |
| `lib/notifications/renderers.ts` | **Create** | Renderer types, empty `NOTIFICATION_RENDERERS` map, `renderNotification` lookup, fallback |
| `lib/hooks/use-unread-count.ts` | **Create** | Visibility-aware polling for the badge |
| `lib/hooks/use-notifications.ts` | **Create** | Paginated bell list, optimistic local mutations |
| `lib/hooks/use-mark-notification-read.ts` | **Create** | Fire-and-forget mark-read / mark-all-read |
| `components/notifications/notification-bell.tsx` | **Create** | Public component — trigger + popover composition |
| `components/notifications/notification-dropdown.tsx` | **Create** | Popover content — header, list, footer |
| `components/notifications/notification-row.tsx` | **Create** | Single row — renderer + cross-workspace click handler |
| `components/notifications/notification-empty-state.tsx` | **Create** | Empty surface |
| `components/notifications/notification-skeleton.tsx` | **Create** | Loading state |
| `components/layout/app-sidebar.tsx` | Modify | Mount `NotificationBell` in the bottom region (desktop + mobile sheet) |
| `ARCHITECTURE.md` | Modify | API routes section (4 new routes); file map adds `components/notifications/`, the 3 hooks, the 4 route files, and `lib/notifications/renderers.ts` |
| `CHANGELOG.md` | Modify | PRD-029 Part 2 entry |

No new env vars, no new external dependencies (`date-fns` already in tree; lucide-react icons already in use; shadcn `Popover` already present).

### Implementation

#### Increment 2.1 — Repository extension + API routes

**What:** Land the four route handlers and the supporting `listForBell` repo method. After this increment, `curl -H "Cookie: ..." /api/notifications` returns rows; nothing else changes UI-side.

**Steps:**

1. Edit `lib/repositories/notification-repository.ts`:
   - Add `BellNotificationRow extends WorkspaceNotification`.
   - Add `ListForBellResult { rows; nextCursor }`.
   - Add `listForBell(options: ListForUserOptions): Promise<ListForBellResult>` to `NotificationRepository`.
   - Export the new types.
2. Edit `lib/repositories/supabase/supabase-notification-repository.ts`:
   - Add `BELL_COLUMNS` constant (same as `COLUMNS` plus `, teams!inner(name)`).
   - Add `toBellNotification(row)` — composes `toNotification(row)` with `teamName: row.teams?.name ?? "(unknown workspace)"`.
   - Implement `listForBell` — copy the `listForUser` body verbatim, swap `COLUMNS → BELL_COLUMNS` and `toNotification → toBellNotification`. Reuse `applyOptionalTeamFilter`.
3. Edit `lib/repositories/index.ts` to re-export `BellNotificationRow`, `ListForBellResult`.
4. Create `app/api/notifications/route.ts`:
   - `GET` handler.
   - Use `requireAuth` from `lib/api/route-auth.ts`.
   - Zod-validate query params (`cursor`, `limit`, `includeRead`, `windowDays`); decode the `cursor` `"createdAt:id"` form into `NotificationCursor | null`.
   - Instantiate `createNotificationRepository(supabase)` with the user's anon client.
   - Call `repo.listForBell({ userId, limit, cursor, includeRead, windowDays })`.
   - Return `{ rows, nextCursor }`.
5. Create `app/api/notifications/unread-count/route.ts`:
   - `GET` handler.
   - `requireAuth` → repo → `repo.unreadCount({ userId })`.
   - Return `{ count }`.
6. Create `app/api/notifications/[id]/read/route.ts`:
   - `POST` handler.
   - `requireAuth` + extract `id` from route params (validate UUID format with Zod).
   - `repo.markRead(id)` (the route does not pass `userId` — the repo doesn't need it; RLS scopes the `UPDATE`).
   - Return `{ ok: true }`.
7. Create `app/api/notifications/mark-all-read/route.ts`:
   - `POST` handler.
   - `requireAuth`. Optional body `{ teamId?: string }` — Zod-validate with both branches accepted.
   - `repo.markAllRead({ userId, teamId })`.
   - Return `{ ok: true }`.
8. All four routes log entry + outcome under `[api/notifications/...]` prefixes consistent with the existing project pattern.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Repository smoke (REPL or throwaway script with a service-role client): emit a `theme.merged` row → `listForBell({ userId })` returns it with `teamName` populated.
3. cURL the four routes against a running dev server with a real auth cookie:
   - `GET /api/notifications` → returns rows with teamName, paginated.
   - `GET /api/notifications/unread-count` → returns the right count.
   - `POST /api/notifications/<id>/read` against an unread row → `{ ok: true }`; subsequent `unread-count` decrements.
   - `POST /api/notifications/mark-all-read` (no body) → zeroes the unread count across all workspaces.
4. Auth smoke: an unauthenticated request to any of the four routes returns 401.

**Post-increment:** ARCHITECTURE update batched in audit. No CHANGELOG entry yet (single-Part entry written at audit time).

---

#### Increment 2.2 — Renderer scaffold

**What:** `lib/notifications/renderers.ts` lands with the registry type, an empty map, and the `renderNotification` lookup + fallback. No callers yet.

**Steps:**

1. Create `lib/notifications/renderers.ts` per §Renderer Scaffolding:
   - `RendererFor<E>` and `RendererRegistry` types.
   - `NOTIFICATION_RENDERERS: Partial<RendererRegistry> = {}`.
   - `RenderedNotification` interface.
   - `FALLBACK` constant.
   - `renderNotification(notification)` function.
2. No imports from this file added anywhere yet.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Quick REPL smoke:
   ```typescript
   import { renderNotification } from "@/lib/notifications/renderers";
   renderNotification({
     id: "x", teamId: "t", userId: null, eventType: "theme.merged",
     payload: { /* malformed */ }, readAt: null, expiresAt: null, createdAt: "2026-04-30T00:00:00Z",
   });
   // Returns FALLBACK — registry empty, payload also doesn't matter at this point.
   ```
3. Adding a stub renderer entry (e.g., `"theme.merged": { icon: Bell, title: () => "Test", deepLink: () => null }`) and re-running the smoke produces the registered render — proving the lookup wires through.

**Post-increment:** none.

---

#### Increment 2.3 — Hooks

**What:** Three custom hooks under `lib/hooks/`. They consume the routes from 2.1 and return the shapes the components in 2.4 will read.

**Steps:**

1. Create `lib/hooks/use-unread-count.ts` per §Hooks. Visibility-aware polling at `POLL_INTERVAL_MS = 30_000`.
2. Create `lib/hooks/use-notifications.ts` per §Hooks. Paginated bell list with optimistic local mutations.
3. Create `lib/hooks/use-mark-notification-read.ts` per §Hooks. Fire-and-forget POSTs to the two mark-read routes.
4. Each hook follows the project's `useX` naming, returns an object, includes cleanup in `useEffect`, logs failures under a per-hook prefix.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Throwaway smoke page (a temporary `/dev/notif-test` route, deleted at audit time):
   - Mount `useUnreadCount` → badge value updates after a fresh emit (within ~30s by default).
   - Mount `useNotifications` → `rows` populates from the API.
   - Call `useMarkNotificationRead().markRead(id)` → server-side row's `readAt` flips.
3. Visibility check: open the smoke page, switch tab away for two minutes, return — the network panel should show no fetches during the hidden window and a fresh fetch on focus.

**Post-increment:** delete the smoke page.

---

#### Increment 2.4 — Components

**What:** All five UI components under `components/notifications/`. Composes the hooks from 2.3 and the renderer from 2.2. Not yet mounted in the layout.

**Steps:**

1. Create `components/notifications/notification-row.tsx`:
   - `<button>` (or `<Link>` when `deepLink` is set) wrapping icon + title + workspace label + timestamp.
   - Click handler: optimistic local mark-read, `setActiveTeam` if cross-workspace, `router.push(deepLink)` (or `closePopover()` when no deep link).
   - Read/unread dot, dimmed-when-read text — using existing `var(--brand-primary)` and `text-muted-foreground` tokens.
2. Create `components/notifications/notification-empty-state.tsx`:
   - Centered icon (muted bell) + line of copy ("You're all caught up").
3. Create `components/notifications/notification-skeleton.tsx`:
   - Three rows of `<Skeleton>` placeholders.
4. Create `components/notifications/notification-dropdown.tsx`:
   - Header ("Notifications" + "Mark all as read" when unread > 0).
   - List: maps `useNotifications().rows` through `<NotificationRow>`.
   - Empty / skeleton / error branches.
   - Footer: "Load more" when `hasMore`.
   - Workspace label rendering gated on a multi-workspace prop computed once at mount time (single-workspace users do not see labels — PRD §P2.R10 noise reduction).
5. Create `components/notifications/notification-bell.tsx`:
   - Imports `Popover`, `PopoverTrigger`, `PopoverContent` from shadcn.
   - Trigger: `<button>` with `<Bell>` icon and the unread badge overlay.
   - Content: `<NotificationDropdown />`.
   - Lazy-mount: dropdown content only renders when the popover is open (so `useNotifications` does not fetch until user opens).
   - Aria labels per §Components.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Mount the bell on the temporary smoke page:
   - Badge displays for unread rows; hides at 0; shows "9+" past the threshold.
   - Opening the bell triggers the list fetch; rows render with the fallback renderer (Part 3 fills in event-specific content).
   - Clicking a row marks it locally (dot disappears, text dims) and fires the POST.
   - "Mark all as read" zeroes the badge across all workspaces.
   - Empty state renders when no rows are visible.
3. Visual review: confirm no new design tokens. Run a grep on the five new files for any hex code or arbitrary `[...]` Tailwind value not already in `globals.css`. Should return zero hits.

**Post-increment:** none — the smoke page stays for 2.5.

---

#### Increment 2.5 — Sidebar integration

**What:** Mount `NotificationBell` in `app-sidebar.tsx`. Visible on every authenticated route. Delete the smoke page from 2.3 / 2.4.

**Steps:**

1. Edit `components/layout/app-sidebar.tsx`:
   - Import `NotificationBell`.
   - Mount it in the bottom region between `<ThemeToggle>` and `<UserMenu>` (both desktop and mobile-sheet variants of the sidebar).
2. Delete `app/dev/notif-test/` (or whatever path the smoke page used).

**Verification:**

1. `npx tsc --noEmit` passes.
2. End-to-end on dev:
   - Sign in → bell visible in sidebar on every authenticated route (`/dashboard`, `/capture`, `/chat`, `/settings/*`).
   - Sign out → bell disappears (sidebar unmounts).
   - With at least one team membership in addition to the active workspace: emit a notification scoped to the *non-active* team via SQL, observe the badge increments, open the bell, see the row with the *other* team's label, click it — active workspace switches, page navigates to the deep-link (if any) in the new context.
   - With a single team: workspace label is suppressed per PRD §P2.R10's noise-reduction note.

**Post-increment:** none — ARCHITECTURE / CHANGELOG batched in audit.

---

#### Increment 2.6 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** each component does one thing. `NotificationBell` is composition only; `NotificationDropdown` is layout only; `NotificationRow` owns the click flow; empty / skeleton are pure presentational. Each hook owns one concern. If any component grew an inline branch larger than ~20 LOC, extract.
2. **DRY:** the `formatDistanceToNow` call wraps in a single helper at the top of `notification-row.tsx`; the read/unread dot + dimming pattern reused from PRD-024 lives at module-scope (no per-render allocation).
3. **Design tokens:** zero hardcoded colours, sizes, or spacings in the five new components. Grep verifies (no `#` followed by hex digits, no arbitrary `bg-[#...]`).
4. **Logging:** all four API routes emit entry + outcome lines under `[api/notifications/...]`. Hooks log failures under their respective `[useX]` prefixes. Repository's new `listForBell` uses `[supabase-notification-repo]`.
5. **Dead code:** the dev smoke page is deleted. No commented-out scaffolding. No unused imports across the new files.
6. **Convention compliance:**
   - File names kebab-case (✓).
   - Component names PascalCase (✓).
   - Hook names `useX`, return objects (✓).
   - Default to Server Components — but every file in this part legitimately needs `"use client"` (state, event handlers, browser APIs). Verify no over-eager client boundary on a parent that doesn't need it.
   - Import order: React → third-party → utils → components → hooks → types.
7. **API route hygiene:**
   - All four routes Zod-validate input (route params, query, body).
   - All four routes call `requireAuth`.
   - Status codes per project convention: 400 bad input, 401 unauthenticated, 500 server error.
   - JSON bodies always include a `message` field on errors.
8. **Type tightening:** `any` permitted only in the two existing ESLint-suppressed spots (`mapRow` raw row, `applyOptionalTeamFilter` generic builder) and the new `toBellNotification` raw row (same suppression, same comment). Anywhere else is a fix.
9. **ARCHITECTURE.md updates:**
   - **Database tables:** unchanged (Part 1 already added `workspace_notifications`).
   - **API Routes section:** add a new "Notifications" subsection with the four routes (or extend an existing miscellany section if one exists; check the file's structure).
   - **File map** — add:
     - `app/api/notifications/route.ts`
     - `app/api/notifications/unread-count/route.ts`
     - `app/api/notifications/[id]/read/route.ts`
     - `app/api/notifications/mark-all-read/route.ts`
     - `lib/notifications/renderers.ts`
     - `lib/hooks/use-unread-count.ts`
     - `lib/hooks/use-notifications.ts`
     - `lib/hooks/use-mark-notification-read.ts`
     - `components/notifications/notification-bell.tsx` (and the four siblings)
     - `components/layout/app-sidebar.tsx` — annotate with the bell mount.
   - **Status line:** append "PRD-029 Part 2 (Header Bell UI & Dropdown) implemented".
10. **CHANGELOG.md:** PRD-029 Part 2 entry covering all P2.R1–P2.R10 requirements, the architectural choices (sidebar placement, separate `listForBell` method, polling at 30s with visibility awareness, lazy-mount dropdown content, optimistic local mark-read), the increment-by-increment narrative, and the audit's actual fixes.
11. **Verify file references:** grep for each new file path in ARCHITECTURE.md after editing. Each should return at least one hit.
12. **Re-run flows touched by Part 2:**
    - Existing extraction / chat / dashboard flows render the bell in the sidebar without changing their own behaviour.
    - Sidebar's existing Chat icon streaming dot still works (no regression — different DOM region, different hooks).
    - Workspace switcher still works; switching workspaces does not break the bell (the bell aggregates across workspaces, so it should be unaffected, but verify).
    - Sign-out clears the bell state when the sidebar unmounts (no leaked rows in the next session — same defence as PRD-024 P5 hardened for streams).
13. **Final:** `npx tsc --noEmit`.

This audit closes Part 2.

---

## Part 3: Event-Type Catalogue & Renderers

> Implements **P3.R1–P3.R5** from PRD-029.

### Overview

Fill the empty `NOTIFICATION_RENDERERS` map from Part 2. One entry per registered event type — `theme.merged`, `supersession.proposed`, `bulk_re_extract.completed` — each supplying an icon component, a title-template function (typed payload → string), and a deep-link function (typed payload → string | null). After Part 3 lands, the bell stops showing "Workspace activity" placeholders and starts rendering specific, actionable rows for every event type the platform can emit.

The footprint is one file: `lib/notifications/renderers.ts` gains three entries in the registry, three lucide-react icon imports, and a tiny pluralisation helper. Nothing else changes — bell, dropdown, row, hooks, routes, repository, service, schema all stay as Part 2 left them. This is the cleanest part of the PRD precisely because Part 2's scaffolding made it so.

### Forward Compatibility Notes

- **Future event types.** Adding a new event type after Part 3 ships is a sequence of three single-file edits — one in `lib/notifications/events.ts` (registry + Zod schema), one in `lib/notifications/renderers.ts` (renderer entry), and the consumer site that calls `notificationService.emit`. No bell, dropdown, route, or repository change ever needed.
- **Title-template evolution.** If any title template grows beyond a one-liner (e.g., needs i18n catalogs, complex pluralisation, or actor formatting), extract it into a sibling helper next to the registry. The renderer entry stays a one-line `title: t.themeMerged` reference. Defer until any consumer asks.
- **Icon library swap.** All three icons are imported from `lucide-react`, the project's existing icon library. If a future design iteration moves to a different library, the swap is N import changes (one per entry) inside this single file. The bell row consumes only `RenderedNotification.icon`, agnostic of source.
- **Part 4 (Delivery).** Renderers run synchronously inside the row's render path; they do not care whether the underlying notification arrived via polling or Realtime. No Part 4 dependency.
- **Part 5 (Retention).** Cleanup deletes rows; renderers don't see the deletion. No Part 5 dependency.

### Renderer Entries

The whole change is additive content inside the existing `NOTIFICATION_RENDERERS` map. Below is the full file shape after Part 3, with the new content called out.

#### `lib/notifications/renderers.ts` (extend)

Add three lucide-react icon imports next to the existing `Bell`:

```typescript
import { Bell, CheckCircle, GitMerge, Inbox } from "lucide-react";
```

Add a single private pluralisation helper above the registry. Inline because no other call site has the same need; promote to `lib/utils/` only if a second consumer emerges:

```typescript
/** Tiny pluralisation helper — returns `"1 thing"` or `"N things"`. */
function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
```

Add a `SUPERSESSION_SOURCE_LABEL` constant (one-line per source) so the title-template stays readable:

```typescript
const SUPERSESSION_SOURCE_LABEL: Record<
  SupersessionProposedPayload["source"],
  string
> = {
  bulk_re_extract: "a bulk re-extract",
  single_session_re_extract: "a re-extract",
  inline_dialog_timeout: "a deferred review",
};
```

(The `SupersessionProposedPayload` import comes from `lib/notifications/events.ts` — already exported alongside its schema.)

Replace the empty `NOTIFICATION_RENDERERS` map with the three entries:

```typescript
export const NOTIFICATION_RENDERERS: Partial<RendererRegistry> = {
  "theme.merged": {
    icon: GitMerge,
    title: (payload) =>
      `Theme "${payload.archivedThemeName}" merged into "${payload.canonicalThemeName}"`,
    // /settings/themes is the admin-gated home for the merge surface
    // (PRD-026 §P2.R7); members reaching it via deep-link see the
    // recent-merges audit log even when they cannot merge themselves.
    deepLink: () => "/settings/themes",
  },
  "supersession.proposed": {
    icon: Inbox,
    title: (payload) =>
      `${pluralize(payload.proposalCount, "supersession proposal")} from ${SUPERSESSION_SOURCE_LABEL[payload.source]}`,
    deepLink: () => "/improvements/inbox",
  },
  "bulk_re_extract.completed": {
    icon: CheckCircle,
    title: (payload) =>
      payload.errorCount > 0
        ? `Bulk re-extraction finished: ${pluralize(payload.sessionsProcessed, "session")}, ${pluralize(payload.errorCount, "error")}`
        : `Bulk re-extraction finished: ${pluralize(payload.sessionsProcessed, "session")} processed`,
    // No first-class bulk-run status page yet; the row is informational
    // and clicking simply marks it read + closes the dropdown. Wire to a
    // status surface if/when one ships.
    deepLink: () => null,
  },
};
```

The `Partial<RendererRegistry>` annotation from Part 2 stays — even with all three entries populated, leaving it `Partial<...>` (rather than tightening to `RendererRegistry`) preserves the deploy-decoupling property: a future event type can be added to `NOTIFICATION_EVENTS` before its renderer ships and the bell still produces the FALLBACK rather than blowing typecheck.

### Title Lengths and Truncation

PRD §P3.R5 sets a soft ceiling of ~80 characters. Worst-case lengths against the registered payloads:

| Event | Template | Worst-case length |
|---|---|---|
| `theme.merged` | `Theme "X" merged into "Y"` | 23 + len(X) + len(Y) chars. Theme names up to ~28 chars each → ~80. Beyond that, the row's `flex-1 min-w-0` + `truncate` already on the title span clips the overflow with an ellipsis. |
| `supersession.proposed` | `N supersession proposals from a bulk re-extract` | ~50 chars. Always within budget. |
| `bulk_re_extract.completed` | `Bulk re-extraction finished: N sessions, M errors` | ~50 chars. Always within budget. |

No active truncation logic in the renderer — the row's CSS handles overflow. If a workspace genuinely produces theme names long enough to break this assumption, the cleanest fix is in the bell row's class list (`truncate` already there), not the renderer.

### Deep-Link Choices

| Event | Deep-link | Rationale |
|---|---|---|
| `theme.merged` | `/settings/themes` | Admin-gated surface (PRD-026 §P2.R7). Non-admin members reaching it via deep-link see the recent-merges audit log; the API enforces the action restriction (admins only confirm new merges). |
| `supersession.proposed` | `/improvements/inbox` | The pending-review inbox (PRD-028 §P5.R1). Both the actor (bulk-run / re-extract initiator) and other workspace members benefit from landing in the queue. |
| `bulk_re_extract.completed` | `null` | No first-class bulk-run status page exists today. Clicking the row marks it read and closes the dropdown — purely informational. Wire to a status surface when/if one ships. |

`null` deep-links are handled by the row component's existing branch — if `rendered.deepLink` is null, the row still calls `onClose()` after the optimistic mark-read, but skips `router.push`.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/notifications/renderers.ts` | Modify | Three renderer entries, three lucide-react icon imports, one `pluralize` helper, one `SUPERSESSION_SOURCE_LABEL` constant |
| `ARCHITECTURE.md` | Modify | Update the file-map note for `lib/notifications/renderers.ts` (was "empty in Part 2"; now "three entries"); status line gains "PRD-029 Part 3 (Event-Type Catalogue & Renderers) implemented" |
| `CHANGELOG.md` | Modify | PRD-029 Part 3 entry |

No new files. No new dependencies. No schema, route, hook, or component change.

### Implementation

#### Increment 3.1 — Populate the registry

**What:** Edit `lib/notifications/renderers.ts` to add three entries plus the supporting helper and constant. Single file, additive content only.

**Steps:**

1. Edit `lib/notifications/renderers.ts`:
   - Extend the lucide-react import: `Bell, CheckCircle, GitMerge, Inbox`.
   - Import `SupersessionProposedPayload` from `@/lib/notifications/events` (alongside the existing `payloadSchemaFor` etc.).
   - Add the `pluralize` helper above the registry.
   - Add the `SUPERSESSION_SOURCE_LABEL` constant.
   - Replace the empty `NOTIFICATION_RENDERERS = {}` body with the three entries per §Renderer Entries.

**Verification:**

1. `npx tsc --noEmit` passes. Each renderer's `title` and `deepLink` parameters are statically typed against `z.infer<...payloadSchema>` for the matching event — TS would flag any `payload.archivedTheemId` typo at the call site.
2. **End-to-end with a seeded row** (against a running dev server):
   - SQL-insert a `theme.merged` row via the Supabase SQL editor with valid payload (per the §Renderer Entries example):
     ```sql
     INSERT INTO workspace_notifications (team_id, user_id, event_type, payload)
     VALUES (
       '<your-team-id>',
       '<your-user-id>',
       'theme.merged',
       '{"archivedThemeId":"00000000-0000-0000-0000-000000000001",
         "archivedThemeName":"API Speed",
         "canonicalThemeId":"00000000-0000-0000-0000-000000000002",
         "canonicalThemeName":"API Performance",
         "actorId":"00000000-0000-0000-0000-000000000003",
         "actorName":"Test Actor",
         "signalAssignmentsRepointed":3}'::jsonb
     );
     ```
   - Open the bell. The row renders with the `GitMerge` icon and title `Theme "API Speed" merged into "API Performance"`. Clicking navigates to `/settings/themes`.
   - Repeat for `supersession.proposed` (any of the three `source` values) — row renders with `Inbox` icon and title like `5 supersession proposals from a bulk re-extract`. Clicking navigates to `/improvements/inbox`.
   - Repeat for `bulk_re_extract.completed` — row renders with `CheckCircle` icon and a sessions-processed title. Clicking marks read + closes the dropdown without navigating (deepLink is null).
3. **Malformed-payload smoke** (defence in depth from Part 2 stays intact): SQL-insert a `theme.merged` row whose payload is `'{}'::jsonb` (missing every required field). Open the bell — the row renders the FALLBACK (`Bell` icon + "Workspace activity") and `console.warn` logs `[notification-renderer] payload mismatch for theme.merged ...`. The bell does not crash.
4. **Pluralisation spot-check:** seed a `supersession.proposed` with `proposalCount: 1`. Title reads `1 supersession proposal from a bulk re-extract` (singular). Seed another with `proposalCount: 2` — title reads `2 supersession proposals` (plural).
5. Existing `theme.merged` / `supersession.proposed` / `bulk_re_extract.completed` consumer paths (PRD-026 P4, PRD-028 P5.R9, PRD-017 follow-up) — none currently emit, so there is no consumer regression to verify. The renderers will start exercising the moment any consumer wires up.

**Post-increment:** ARCHITECTURE update batched in audit.

---

#### Increment 3.2 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** `renderers.ts` does one thing — render notifications. The pluralisation helper and source-label constant are local concerns, kept private (not exported) to keep the public surface tight.
2. **DRY:** confirm the `payloadSchemaFor(eventType).safeParse` re-validation in `renderNotification` (Part 2) still wraps every renderer call — no duplicate parsing inside individual title functions. The `SUPERSESSION_SOURCE_LABEL` constant prevents source-string duplication across the title template.
3. **Design tokens:** N/A — Part 3 introduces no styling.
4. **Logging:** payload mismatches still log under `[notification-renderer]` (Part 2 path); renderer entries themselves are pure functions with no logging needs.
5. **Dead code:** confirm the `pluralize` helper has at least two call sites (otherwise inline it). At Part 3 ship: `theme.merged` doesn't use it; `supersession.proposed` uses it once; `bulk_re_extract.completed` uses it twice (in the if branch) or once (in the else branch). Three call sites total — extraction justified.
6. **Convention compliance:** named exports only; kebab-case file names; PascalCase types; const helpers in camelCase (`pluralize`); UPPER_SNAKE_CASE for the `SUPERSESSION_SOURCE_LABEL` constant.
7. **Type tightening:** zero `any` leaks. Each renderer's `payload` parameter is automatically narrowed by `RendererFor<E>` to the corresponding `z.infer<...payloadSchema>` — TS errors at the call site if a renderer reaches for a non-existent field.
8. **Title length spot-check:** for each event, sample worst-case payload lengths and confirm titles are at most ~80 chars in typical cases (per PRD §P3.R5). Document any genuinely-overflowing template; the row's CSS truncation absorbs the overflow but the renderer should still aim for the budget.
9. **ARCHITECTURE.md update:** the file-map line for `lib/notifications/renderers.ts` currently reads "empty in Part 2; Part 3 fills entries" — update to "three registered entries — `theme.merged` (GitMerge → /settings/themes), `supersession.proposed` (Inbox → /improvements/inbox), `bulk_re_extract.completed` (CheckCircle → null)". Status line gains "PRD-029 Part 3 (Event-Type Catalogue & Renderers) implemented".
10. **CHANGELOG.md:** PRD-029 Part 3 entry covering all P3.R1–P3.R5 requirements, the three registered events with their icons + deep-links + title templates, the architectural choices (kept registry as `Partial<RendererRegistry>`, inlined `pluralize`, `null` deep-link for `bulk_re_extract.completed`), and the audit's actual findings.
11. **Verify:** `npx tsc --noEmit` passes; the three end-to-end smoke tests from Increment 3.1 still pass; the malformed-payload fallback path still falls through to FALLBACK.

This audit closes Part 3.

---

## Part 4: Delivery Mechanism

> Implements **P4.R1–P4.R5** from PRD-029.

### Overview

Move the badge and list from "polling within 30 seconds" to "Realtime within seconds, polling as a 5-minute safety net." Supabase Realtime delivers changes on `workspace_notifications` straight to the user's browser via WebSocket; RLS filters the event stream so each user only sees their own visible rows. The polling fallback survives silent WebSocket drops — when Realtime is healthy it never fires (the hook bumps its own deadline on every event); when Realtime breaks, the badge stays correct within ~5 minutes instead of indefinitely.

This is the project's first use of Supabase Realtime. The `@supabase/supabase-js` client already supports it (the dependency is in tree, just unused). One SQL migration enables Realtime publication on the table; one new shared hook wraps the subscription lifecycle; the two existing fetch hooks (`use-unread-count`, `use-notifications`) call the shared hook and refetch on every emit. Their public return shapes do not change — `NotificationBell` and `NotificationDropdown` consume them unmodified.

### Forward Compatibility Notes

- **Future event types.** Realtime subscribes to the table, not specific event types — every new event registered in Parts 1/3 is delivered automatically. No subscription edit ever needed.
- **Future delivery channels (email digest, push, etc.) — backlog.** Email/push delivery would land alongside Realtime, not replace it. They consume the same `workspace_notifications` rows; their delivery is server-side cron, not browser-side. No conflict.
- **Per-user notification preferences (mute event types) — backlog.** The hook stays unchanged; muting becomes a server-side filter in the API routes. The Realtime subscription still receives events for muted types but the API filters them out of `listForBell`/`unreadCount` responses; the bell auto-corrects on next refetch.
- **Multi-tab consistency.** A user reading a notification in tab A sends a Realtime UPDATE event that tab B receives, triggering tab B's badge to refetch and decrement. No bespoke cross-tab coordination needed (no `BroadcastChannel`, no localStorage events) — the DB is the source of truth and Realtime makes both tabs observe it.
- **Sign-out handling.** Both hooks unmount when the auth-aware layout swaps to a public route; `useEffect` cleanup tears down the channel. No bespoke sign-out hook needed — same pattern PRD-024 established for streaming subscriptions.

### Why Hybrid (Not Pure Realtime, Not Pure Polling)

Three options were on the table per PRD §P4.R2. Decision is **Realtime + polling fallback at 5-minute cadence**.

- **Pure polling** (current Part 2 state). Pros: simple, no new infra, no WebSocket lifecycle. Cons: 30-second floor on badge latency violates PRD §P4.R1's "within seconds in real-time mode" target. A user receives a theme-merge notification 30 seconds after the actor confirms — long enough that "Alice just told me she merged it" beats the badge.
- **Pure Realtime.** Pros: sub-second latency, single source of "did something change." Cons: a silent WebSocket drop (network blip the client misses, server restart, auth token expiry the reconnect logic muffs) leaves the badge indefinitely stale. Notifications are user-trust load-bearing; "stale forever" is a worse failure mode than "stale for 5 minutes."
- **Hybrid** (chosen). Realtime delivers within seconds in the happy path. Polling at 5-minute intervals is the floor — if Realtime broke 30 seconds ago, the badge still corrects within 5 minutes. Polling pauses entirely when the tab is hidden (Page Visibility API, already wired in Part 2) and refetches on focus. Net cost: one extra fetch every 5 minutes per active tab, dwarfed by any single dashboard load.

The chosen interval (5 minutes, vs Part 2's 30 seconds) reflects the Realtime-primary design — polling becomes a backstop, not the main delivery channel. The Realtime subscription is what meets the latency bar; polling exists only because Realtime can fail silently and we want a known-bounded staleness window.

### Why Subscribe Without an Explicit Filter

Supabase Realtime supports a `filter` parameter on `postgres_changes` subscriptions, but only single-equality predicates (`column=eq.value`). Our visibility rule is a disjunction:

```
user_id = auth.uid()
OR (user_id IS NULL AND team_id IN <user's teams>)
```

This cannot be expressed as a Realtime filter. Three alternatives were considered:

- **Subscribe with `user_id=eq.${userId}`** (targeted only). Misses broadcasts. Rejected — broadcasts are half the point.
- **Subscribe twice** (once for targeted, once unfiltered for broadcasts). Requires de-duplication client-side. Rejected — added complexity without latency benefit.
- **Subscribe without a filter, rely on RLS.** Supabase Realtime's authorization layer applies the table's RLS policies to filter the event stream per subscriber. The user only receives events for rows their RLS policy lets them SELECT — exactly the visibility rule we want. Chosen.

The trade-off is server-side fanout: Realtime evaluates RLS for every change against every subscribed user. At our notification volume (low, sparse, per-user) this is negligible. If volumes ever climb to the point where this matters, the fix is per-user channels with targeted filters at that point — not premature optimisation now.

### Database Changes

#### Migration: `002-enable-realtime-on-workspace-notifications.sql`

```sql
-- ============================================================
-- PRD-029 Part 4: Enable Supabase Realtime on workspace_notifications
-- ============================================================
-- Realtime publishes table changes (INSERT/UPDATE/DELETE) over WebSocket
-- to subscribed clients. RLS policies on the table apply to the event
-- stream — each subscriber only receives changes for rows they can
-- SELECT. Part 1's existing SELECT policy gives us per-user filtering
-- "for free": targeted notifications stream to their `user_id` only;
-- broadcasts stream to every member of `team_id`.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE workspace_notifications;
```

**Why no `REPLICA IDENTITY` change:** Postgres' default replica identity (PRIMARY KEY) is sufficient for our use case — we use Realtime events as a "something changed, refetch" trigger, not to reconstruct row state from the event payload. The payload has the primary key plus changed columns; we never read the payload's column values directly.

**Why a separate migration file from Part 1's `001-create-workspace-notifications.sql`:** the publication change is a runtime-affecting operational step; bundling it into the table-creation migration would couple "table exists" with "Realtime publishes." Keeping them split lets ops disable Realtime (drop the publication add) without touching the table — and keeps the audit trail honest about when each capability shipped.

### New Hook

#### `lib/hooks/use-notification-realtime.ts` (new)

A single shared hook that subscribes to `workspace_notifications` change events and invokes a caller-supplied callback on every event. Used by both `use-unread-count` and `use-notifications`.

```typescript
"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

const LOG_PREFIX = "[useNotificationRealtime]";
const CHANNEL_NAME = "workspace-notifications";

/**
 * Subscribes to `workspace_notifications` row changes via Supabase Realtime
 * and invokes `onChange` for every INSERT / UPDATE / DELETE the user has
 * RLS-visibility to. The callback is held in a ref so changing its identity
 * across renders does not tear down the subscription.
 *
 * The channel name is shared across consumers — Supabase JS deduplicates
 * channels by name, so multiple hook callers fan out from one underlying
 * channel rather than each opening a separate WebSocket subscription.
 *
 * Subscription lifecycle is `useEffect` mount/unmount: the channel is torn
 * down when the consumer unmounts. Sign-out flows (`AuthProvider`'s session-
 * null branch) unmount the bell tree, which cascades the cleanup.
 */
export function useNotificationRealtime(onChange: () => void): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_notifications",
        },
        () => {
          onChangeRef.current();
        }
      )
      .subscribe((status) => {
        // Statuses: 'SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'.
        // Worth observing transitions so silent drops surface in logs.
        console.log(`${LOG_PREFIX} subscription status: ${status}`);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
```

**Why a `useRef` for the callback:** without it, every parent re-render that produces a new `onChange` identity would tear down and re-mount the subscription — a real cost (WebSocket round trip) for what should be a stable lifecycle. The ref pattern is the standard React idiom for "subscription on mount, latest callback on event."

**Why one shared channel name:** Supabase JS deduplicates channels by name. Two hooks calling `supabase.channel("workspace-notifications")` get the same underlying channel; both `.on(...)` listeners fire on every event. One WebSocket per browser tab regardless of how many bell-related hooks subscribe.

**Why log every status transition:** silent drops are exactly the failure mode the polling fallback exists to compensate for, but observability lets us notice when it's happening so we can investigate. `[useNotificationRealtime] subscription status: CHANNEL_ERROR` in production logs is a clear signal.

### Modifications to Existing Hooks

#### `lib/hooks/use-unread-count.ts` (modify)

Change one constant + add a one-line subscription. The structure of the polling effect stays identical; only the cadence changes.

```typescript
// before
const POLL_INTERVAL_MS = 30_000;

// after — Realtime is the primary signal; polling is the fallback safety net
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
```

Add the subscription inside the function body, immediately after the `fetchCount` declaration:

```typescript
useNotificationRealtime(fetchCount);
```

That single line wires Realtime → unread-count refetch. The hook ref-stabilises `fetchCount` internally, so passing it directly is safe even though `useCallback`'s identity is technically stable already.

No other change. The visibility-aware polling loop, the `cancelledRef` guard, the imperative `refetch` return, the `useUnreadCountReturn` shape — all unchanged. Caller (`NotificationBell`) sees identical behaviour, just with sub-second latency in the happy path.

#### `lib/hooks/use-notifications.ts` (modify)

Add the same one-line subscription, calling `refresh()` (which fetches page 1):

```typescript
useNotificationRealtime(refresh);
```

The dropdown's `useNotifications` only mounts when the bell opens (Part 2's lazy-mount via Radix Portal), so this subscription is bell-open-scoped — closed bell pays no Realtime cost on the dropdown side. The badge's subscription (in `use-unread-count`) is always active because the bell trigger is always rendered.

No polling fallback added to `use-notifications` — the list refetches on bell open (Part 2 behaviour) and on every Realtime event (Part 4). Tab-hidden + bell-closed = no fetches at all, which is correct.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/029-workspace-notifications/002-enable-realtime-on-workspace-notifications.sql` | **Create** | Migration — `ALTER PUBLICATION supabase_realtime ADD TABLE workspace_notifications` |
| `lib/hooks/use-notification-realtime.ts` | **Create** | Shared subscription hook — `useNotificationRealtime(onChange)`, ref-stabilised callback, status logging |
| `lib/hooks/use-unread-count.ts` | Modify | Bump `POLL_INTERVAL_MS` from 30s to 5min; add `useNotificationRealtime(fetchCount)` line |
| `lib/hooks/use-notifications.ts` | Modify | Add `useNotificationRealtime(refresh)` line |
| `ARCHITECTURE.md` | Modify | File-map entry for the new hook; status line gains "PRD-029 Part 4 (Delivery Mechanism — Realtime + 5-min polling fallback) implemented"; Authentication Flow section may need a one-line note about Realtime authorization riding on the same auth context |
| `CHANGELOG.md` | Modify | PRD-029 Part 4 entry |

No new env vars (Realtime uses the existing `NEXT_PUBLIC_SUPABASE_URL` + publishable key). No new dependencies (`@supabase/supabase-js` is already in tree).

### Implementation

#### Increment 4.1 — Migration + shared subscription hook

**What:** Land migration `002` and create `use-notification-realtime.ts`. Apply Realtime publication on the dev project. The hook exists but no consumer wires it yet.

**Steps:**

1. Create `docs/029-workspace-notifications/002-enable-realtime-on-workspace-notifications.sql` with the `ALTER PUBLICATION` statement.
2. Apply on dev project (Supabase SQL editor), then prod after dev verification.
3. Create `lib/hooks/use-notification-realtime.ts` per §New Hook.

**Verification:**

1. `npx tsc --noEmit` passes.
2. **Migration smoke (dev project):** in the Supabase Studio Realtime section, confirm `workspace_notifications` appears in the publication list. Or run `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'workspace_notifications';` — should return one row.
3. **Subscription smoke** (against a running dev server with auth cookies, before any consumer wiring):
   - Mount the hook in a temporary `app/dev/realtime-test/page.tsx` with `useNotificationRealtime(() => console.log("event"))`.
   - Visit the page; browser console should show `[useNotificationRealtime] subscription status: SUBSCRIBED`.
   - In Supabase SQL editor, insert a test notification row scoped to the logged-in user.
   - Browser console should log `event` within 1-2 seconds. If it does not appear, RLS is gating the event correctly (the user must be a member of `team_id` for broadcasts, or `user_id` must match for targeted).
   - Delete the temporary page.

**Post-increment:** none.

---

#### Increment 4.2 — Wire badge + list hooks

**What:** Modify `use-unread-count.ts` and `use-notifications.ts` to subscribe via the shared hook. Bump the badge's polling cadence to 5 minutes.

**Steps:**

1. Edit `lib/hooks/use-unread-count.ts`:
   - Change `POLL_INTERVAL_MS = 30_000` to `POLL_INTERVAL_MS = 5 * 60 * 1000`.
   - Import `useNotificationRealtime` from the new hook.
   - Add `useNotificationRealtime(fetchCount);` inside the function body, after the `fetchCount` declaration.
2. Edit `lib/hooks/use-notifications.ts`:
   - Import `useNotificationRealtime`.
   - Add `useNotificationRealtime(refresh);` inside the function body, after the `refresh` declaration.

**Verification:**

1. `npx tsc --noEmit` passes.
2. **End-to-end with two browser windows** (both authenticated as the same user, dev server running):
   - Window A: `/dashboard` (sidebar visible, badge mounted).
   - Window B: `/capture` (also has the bell mounted).
   - SQL editor: insert a `theme.merged` row scoped to the logged-in user.
   - Both windows: badge increments to 1 within 1-2 seconds (no manual refresh).
3. **Mark-read cross-tab:**
   - Window A: open the bell, click the row to mark read.
   - Window B: badge decrements to 0 within 1-2 seconds.
4. **Polling fallback exercised:**
   - Block Realtime in dev (e.g., browser devtools network throttling → offline, then re-enable). The badge should reach correct state within 5 minutes via polling. (Optional verification — can be checked manually if Realtime ever drops in production.)
5. **Tab-visibility:**
   - Hide the tab (Cmd+Tab away). Insert a notification via SQL editor. Wait 30 seconds. Foreground the tab.
   - Badge should refetch on focus (Part 2 behaviour) and reflect the new count immediately.
6. **Existing flows unaffected:**
   - Sidebar's PRD-024 Chat-icon streaming dot still works (different DOM region, different subscription).
   - Other routes (`/dashboard`, `/capture`, `/chat`) render normally with no Realtime regression.

**Post-increment:** none.

---

#### Increment 4.3 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** `use-notification-realtime.ts` does one thing — manage the Realtime subscription lifecycle. The two consumer hooks delegate to it; they don't duplicate subscription setup.
2. **DRY:** subscription setup lives in exactly one place. Both consumers (`use-unread-count`, `use-notifications`) call `useNotificationRealtime(callback)` — the shared channel name + the ref-stabilised callback pattern + the cleanup are not duplicated.
3. **Design tokens:** N/A — Part 4 is hooks-only, no UI.
4. **Logging:** `[useNotificationRealtime] subscription status: <STATUS>` covers every state transition. Consumers' existing `[useUnreadCount]` / `[useNotifications]` logs continue unchanged.
5. **Dead code:** the temporary `app/dev/realtime-test/page.tsx` from Increment 4.1 is deleted. No commented-out 30-second polling constant in `use-unread-count.ts` (the value is just changed in place).
6. **Convention:** `useX` naming, `LOG_PREFIX`, return shapes unchanged for consumers.
7. **Type tightening:** zero `any`. The `onChange` callback is typed `() => void` — the hook never inspects the change payload (it's a "something happened, refetch" trigger).
8. **Connection lifecycle verification:**
   - Open the bell tree, then sign out. Console should show `[useNotificationRealtime] subscription status: CLOSED` as the cleanup fires. No leftover channel after sign-out.
   - Sign in again → new `SUBSCRIBED` log. Subsequent events deliver normally.
   - Auth token refresh (waited out the access-token expiry, ~1 hour): Supabase JS auto-refreshes; verify a notification inserted post-refresh still delivers via Realtime. (Long-running test — operationally verifiable but not blocking for the audit.)
9. **No regressions:**
   - Part 2's badge / dropdown / row / mark-read flows behave identically.
   - PRD-024's streaming subscriptions (separate `lib/streaming/` module) untouched.
   - Sidebar chrome unchanged.
10. **ARCHITECTURE.md update:**
    - File map: add `lib/hooks/use-notification-realtime.ts` to the hooks block. Update `use-unread-count.ts` description to note "Realtime-driven refetch with 5-min polling fallback (PRD-029 Part 4)" and similarly extend `use-notifications.ts`.
    - Status line: append "PRD-029 Part 4 (Delivery Mechanism — Realtime + 5-min polling fallback) implemented".
    - One-line note in the Authentication Flow section (or wherever Supabase setup is documented): "Realtime subscriptions on `workspace_notifications` ride on the same auth context — RLS filters the event stream per user."
11. **CHANGELOG.md:** PRD-029 Part 4 entry covering all P4.R1–P4.R5 requirements, the hybrid-architecture decision, the subscribe-without-filter rationale, the increment narrative, and the audit's actual findings.
12. **Final:** `npx tsc --noEmit`.

This audit closes Part 4.

---

## Part 5

> Specified after Part 4 lands and Realtime delivery has run in production for at least one observable cycle (latency log review, no silent-drop incidents). Part 5's section will append here, mirroring the structure above, and must respect the data shapes locked in by Parts 1–4 (`workspace_notifications` schema, `NOTIFICATION_EVENTS` registry, `NotificationRepository` interface — including `deleteExpired` from Part 1, `notification-service` public API, the four `/api/notifications/*` routes, the renderer registry, the Realtime subscription).

- **Part 5 — Retention & cleanup.** Schedules a job (Vercel cron / Supabase pg_cron / GitHub Actions) calling `repo.deleteExpired` on a cadence. Configurable retention windows (read shorter than unread); per-row `expires_at` already supported by Part 1's schema and repository contract. The bell's read paths transparently see the smaller table. No subscription change — Realtime publishes DELETE events too, but the bell already refetches on every event so deletions appear without bespoke handling.
