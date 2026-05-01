import { type SupabaseClient } from "@supabase/supabase-js";

import { isNotificationEventType } from "@/lib/notifications/events";
import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";

import type {
  BellNotificationRow,
  DeleteExpiredOptions,
  ListForBellResult,
  ListForUserOptions,
  ListForUserResult,
  NotificationInsert,
  NotificationRepository,
} from "../notification-repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[supabase-notification-repo]";

const COLUMNS =
  "id, team_id, user_id, event_type, payload, read_at, expires_at, created_at";

/** `COLUMNS` plus the joined workspace name for bell rendering. PostgREST
 *  resolves `teams(name)` through the `team_id` FK. As of PRD-029 Part 7
 *  `team_id` is nullable (personal-workspace rows), so the join is a plain
 *  outer join — personal rows return `teams: null` and the mapper falls back
 *  to an empty `teamName`. */
const BELL_COLUMNS = `${COLUMNS}, teams(name)`;

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Conditionally narrows a query to one workspace. `undefined` and `null` are
 * both treated as "no filter" — consumers pass either when they want the
 * cross-workspace default (PRD-029 §P2.R10).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- query builders are heavily generic
function applyOptionalTeamFilter<Q extends { eq: (col: string, val: any) => Q }>(
  query: Q,
  teamId: string | null | undefined
): Q {
  if (teamId === undefined || teamId === null) {
    return query;
  }
  return query.eq("team_id", teamId);
}

/**
 * PRD-029 §P6.R2 — exclude rows whose explicit `expires_at` is in the past.
 * Applied to every read path the bell consumes (listing + unread count) so
 * emitter-driven expiry takes effect without waiting for the deferred Part 5
 * cleanup job.
 */
function applyNotExpiredFilter<Q extends { or: (filters: string) => Q }>(
  query: Q
): Q {
  return query.or(
    `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
  );
}

/**
 * Maps a raw Supabase row (snake_case) to a domain `WorkspaceNotification`
 * (camelCase). Warns — but does not throw — when the row's `event_type` is
 * not in the registered registry; renderers (Part 3) handle the fallback path.
 *
 * Per PRD-029 Part 7: every row has a recipient (`user_id` is NOT NULL) and
 * `team_id` is nullable (personal-workspace rows).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toNotification(row: any): WorkspaceNotification {
  if (!isNotificationEventType(row.event_type)) {
    console.warn(
      `${LOG_PREFIX} unknown event_type encountered: "${row.event_type}" (id: ${row.id}) — falling through.`
    );
  }
  return {
    id: row.id,
    teamId: row.team_id ?? null,
    userId: row.user_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    readAt: row.read_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
  };
}

/** Bell variant — composes `toNotification` with the joined `teams.name`.
 *  Personal-workspace rows (`team_id IS NULL`) yield `"Personal"` as the
 *  label so the dropdown's cross-workspace mode (PRD §P2.R10) renders a
 *  meaningful workspace label rather than an empty string. The dropdown
 *  still suppresses the label entirely when every visible row shares the
 *  same workspace, so personal-only bells stay label-free. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toBellNotification(row: any): BellNotificationRow {
  return {
    ...toNotification(row),
    teamName: row.teams?.name ?? "Personal",
  };
}

/**
 * Shared keyset-paginated read used by both `listForUser` and `listForBell`.
 * Differs only in the projected columns and the row mapper; the cursor
 * predicate, recency window, ordering, and includeRead/teamId filters are
 * identical between the two callers — extracting prevents drift.
 */
async function executeKeysetListQuery<T extends { createdAt: string; id: string }>(
  supabase: SupabaseClient,
  options: ListForUserOptions,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw rows are loosely typed
  mapRow: (row: any) => T,
  logLabel: string
): Promise<{ rows: T[]; nextCursor: NotificationCursor | null }> {
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  console.log(
    `${LOG_PREFIX} ${logLabel} — userId: ${options.userId}, teamId: ${options.teamId ?? "(any)"}, limit: ${limit}, includeRead: ${options.includeRead ?? true}`
  );

  let query = supabase
    .from("workspace_notifications")
    .select(columns)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  query = applyOptionalTeamFilter(query, options.teamId);
  query = applyNotExpiredFilter(query);

  if (options.includeRead === false) {
    query = query.is("read_at", null);
  }

  if (options.cursor) {
    // Compound cursor — order is (created_at desc, id desc), so older rows are
    // those with created_at < cursor, OR created_at == cursor AND id < cursor.id.
    query = query.or(
      `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${LOG_PREFIX} ${logLabel} error:`, error);
    throw error;
  }

  const all = data ?? [];
  const rows = all.slice(0, limit).map(mapRow);
  const hasMore = all.length > limit;
  const nextCursor: NotificationCursor | null = hasMore
    ? {
        createdAt: rows[rows.length - 1].createdAt,
        id: rows[rows.length - 1].id,
      }
    : null;

  console.log(
    `${LOG_PREFIX} ${logLabel} — returned ${rows.length} rows, hasMore: ${hasMore}`
  );

  return { rows, nextCursor };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase-backed `NotificationRepository`.
 *
 * Pass a service-role client for `bulkInsert` and `deleteExpired` (anon RLS
 * denies INSERT/DELETE). Pass the user's anon client for `listForUser`,
 * `unreadCount`, `markRead`, `markAllRead` — RLS scopes the row set to the
 * user's visible notifications.
 */
export function createNotificationRepository(
  supabase: SupabaseClient
): NotificationRepository {
  return {
    async bulkInsert(
      rows: NotificationInsert[]
    ): Promise<WorkspaceNotification[]> {
      if (rows.length === 0) return [];

      console.log(
        `${LOG_PREFIX} bulkInsert — count: ${rows.length}, eventType: ${rows[0].event_type}`
      );

      const { data, error } = await supabase
        .from("workspace_notifications")
        .insert(
          rows.map((r) => ({
            team_id: r.team_id,
            user_id: r.user_id,
            event_type: r.event_type,
            payload: r.payload,
            expires_at: r.expires_at ?? null,
          }))
        )
        .select(COLUMNS);

      if (error) {
        console.error(`${LOG_PREFIX} bulkInsert error:`, error);
        throw error;
      }

      console.log(`${LOG_PREFIX} bulkInsert — inserted ${data?.length ?? 0} rows`);
      return (data ?? []).map(toNotification);
    },

    async listActiveTeamMemberIds(teamId: string): Promise<string[]> {
      console.log(`${LOG_PREFIX} listActiveTeamMemberIds — teamId: ${teamId}`);

      const { data, error } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", teamId)
        .is("removed_at", null);

      if (error) {
        console.error(`${LOG_PREFIX} listActiveTeamMemberIds error:`, error);
        throw error;
      }

      const ids = (data ?? []).map((row) => row.user_id as string);
      console.log(
        `${LOG_PREFIX} listActiveTeamMemberIds — ${ids.length} member(s)`
      );
      return ids;
    },

    listForUser(options: ListForUserOptions): Promise<ListForUserResult> {
      return executeKeysetListQuery(
        supabase,
        options,
        COLUMNS,
        toNotification,
        "listForUser"
      );
    },

    listForBell(options: ListForUserOptions): Promise<ListForBellResult> {
      return executeKeysetListQuery(
        supabase,
        options,
        BELL_COLUMNS,
        toBellNotification,
        "listForBell"
      );
    },

    async unreadCount(options: {
      userId: string;
      teamId?: string | null;
    }): Promise<number> {
      console.log(
        `${LOG_PREFIX} unreadCount — userId: ${options.userId}, teamId: ${options.teamId ?? "(any)"}`
      );

      let query = supabase
        .from("workspace_notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

      query = applyOptionalTeamFilter(query, options.teamId);
      query = applyNotExpiredFilter(query);

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
        .is("read_at", null);

      if (error) {
        console.error(`${LOG_PREFIX} markRead error:`, error);
        throw error;
      }
    },

    async markAllRead(options: {
      userId: string;
      teamId?: string | null;
    }): Promise<void> {
      console.log(
        `${LOG_PREFIX} markAllRead — userId: ${options.userId}, teamId: ${options.teamId ?? "(all)"}`
      );

      let query = supabase
        .from("workspace_notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);

      query = applyOptionalTeamFilter(query, options.teamId);

      const { error } = await query;
      if (error) {
        console.error(`${LOG_PREFIX} markAllRead error:`, error);
        throw error;
      }
    },

    async deleteExpired(
      options: DeleteExpiredOptions
    ): Promise<{ deleted: number }> {
      console.log(
        `${LOG_PREFIX} deleteExpired — olderThan: ${options.olderThan}, olderThanRead: ${options.olderThanRead}`
      );

      // Two-phase delete so the read vs unread retention asymmetry is honoured,
      // and per-row `expires_at` overrides take effect regardless of age.
      const expiredByDate = await supabase
        .from("workspace_notifications")
        .delete({ count: "exact" })
        .or(
          `and(read_at.is.null,created_at.lt.${options.olderThan}),and(read_at.not.is.null,created_at.lt.${options.olderThanRead})`
        );

      if (expiredByDate.error) {
        console.error(
          `${LOG_PREFIX} deleteExpired (by date) error:`,
          expiredByDate.error
        );
        throw expiredByDate.error;
      }

      const expiredByExplicit = await supabase
        .from("workspace_notifications")
        .delete({ count: "exact" })
        .lt("expires_at", new Date().toISOString());

      if (expiredByExplicit.error) {
        console.error(
          `${LOG_PREFIX} deleteExpired (by expires_at) error:`,
          expiredByExplicit.error
        );
        throw expiredByExplicit.error;
      }

      const total = (expiredByDate.count ?? 0) + (expiredByExplicit.count ?? 0);
      console.log(`${LOG_PREFIX} deleteExpired — total: ${total}`);
      return { deleted: total };
    },
  };
}
