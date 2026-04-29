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

## Parts 2–5

> Specified after Part 1 lands and at least one consumer (PRD-026 P4 or PRD-028 P5.R9) has emitted in production. Each subsequent part will append a "Part N" section here, mirroring the structure above, and must respect the data shapes locked in by Part 1 (`workspace_notifications` schema, `NOTIFICATION_EVENTS` registry, `NotificationRepository` interface, `notification-service` public API).

- **Part 2 — Header bell UI & dropdown.** Adds API routes (`/api/notifications`, `/api/notifications/[id]/read`, `/api/notifications/mark-all-read`, `/api/notifications/unread-count`) and the bell component. Cross-workspace by default per PRD §P2.R10. UI consumes the service via the routes; no new repository methods.
- **Part 3 — Renderer registry.** Adds `lib/notifications/renderers.ts` keyed on `NotificationEventType` — icon component, title-template function, deep-link function. Bell rows (Part 2) render through this. Unknown event types fall through to a generic "Workspace activity" row.
- **Part 4 — Delivery mechanism.** Picks Supabase Realtime / polling / hybrid. The choice is documented; the latency bar from PRD §P4.R1 is the measurable acceptance.
- **Part 5 — Retention & cleanup.** Schedules `notificationService` (or a thin wrapper) calling `repo.deleteExpired` on a cadence. Configurable retention windows; per-row `expires_at` already supported by Part 1's schema and repository contract.
