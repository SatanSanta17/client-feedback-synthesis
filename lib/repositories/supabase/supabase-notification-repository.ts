import { type SupabaseClient } from "@supabase/supabase-js";

import { isNotificationEventType } from "@/lib/notifications/events";
import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";

import type {
  DeleteExpiredOptions,
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

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Maps a raw Supabase row (snake_case) to a domain `WorkspaceNotification`
 * (camelCase). Warns — but does not throw — when the row's `event_type` is
 * not in the registered registry; renderers (Part 3) handle the fallback path.
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
    teamId: row.team_id,
    userId: row.user_id ?? null,
    eventType: row.event_type,
    payload: row.payload ?? {},
    readAt: row.read_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase-backed `NotificationRepository`.
 *
 * Pass a service-role client for `insert` and `deleteExpired` (anon RLS denies
 * INSERT/DELETE). Pass the user's anon client for `listForUser`, `unreadCount`,
 * `markRead`, `markAllRead` — RLS scopes the row set to the user's visible
 * notifications.
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
      const since = new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000
      ).toISOString();

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
        // Compound cursor — order is (created_at desc, id desc), so older rows are
        // those with created_at < cursor, OR created_at == cursor AND id < cursor.id.
        query = query.or(
          `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error(`${LOG_PREFIX} listForUser error:`, error);
        throw error;
      }

      const all = data ?? [];
      const rows = all.slice(0, limit).map(toNotification);
      const hasMore = all.length > limit;
      const nextCursor: NotificationCursor | null = hasMore
        ? {
            createdAt: rows[rows.length - 1].createdAt,
            id: rows[rows.length - 1].id,
          }
        : null;

      console.log(
        `${LOG_PREFIX} listForUser — returned ${rows.length} rows, hasMore: ${hasMore}`
      );

      return { rows, nextCursor };
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

      if (options.teamId !== undefined && options.teamId !== null) {
        query = query.eq("team_id", options.teamId);
      }

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
