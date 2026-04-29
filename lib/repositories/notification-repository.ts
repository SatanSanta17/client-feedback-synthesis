// ---------------------------------------------------------------------------
// Notification Repository Interface (PRD-029 Part 1)
// ---------------------------------------------------------------------------

import type {
  WorkspaceNotification,
  NotificationCursor,
} from "@/lib/types/notification";
import type { NotificationEventType } from "@/lib/notifications/events";

/** Insert payload — the service has already validated `event_type` and `payload`
 *  shape against the closed event registry. */
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
   *  team the user belongs to — see PRD §P2.R10 (cross-workspace bell). */
  teamId?: string | null;
  limit?: number;
  cursor?: NotificationCursor | null;
  includeRead?: boolean;
  /** Window in days. Default 30. Older rows are not deleted by this method —
   *  retention is owned by Part 5's `deleteExpired`. */
  windowDays?: number;
}

export interface ListForUserResult {
  rows: WorkspaceNotification[];
  nextCursor: NotificationCursor | null;
}

export interface DeleteExpiredOptions {
  /** Cutoff for unread rows: rows with `read_at IS NULL AND created_at < olderThan` are deleted. */
  olderThan: string;
  /** Cutoff for read rows: rows with `read_at IS NOT NULL AND created_at < olderThanRead` are deleted.
   *  Typically a shorter window than `olderThan` (read rows expire sooner). */
  olderThanRead: string;
}

/**
 * Repository interface for workspace notifications.
 *
 * Read methods rely on RLS to scope rows visible to the caller. Write methods
 * are split:
 *   - `insert` / `deleteExpired` are service-role only (anon RLS denies INSERT/DELETE).
 *   - `markRead` / `markAllRead` route through the user's anon client and update
 *     `read_at`; the UPDATE RLS policy enforces row visibility, the service layer
 *     enforces column scope (only `read_at` is mutated).
 */
export interface NotificationRepository {
  /** Service-role: insert one row. The service layer has already validated the
   *  event type and payload — this method writes verbatim. */
  insert(data: NotificationInsert): Promise<WorkspaceNotification>;

  /** Anon: list rows visible to the user, most-recent first.
   *  RLS scopes the row set; this method scopes by recency, read state, and pagination. */
  listForUser(options: ListForUserOptions): Promise<ListForUserResult>;

  /** Anon: count of unread rows visible to the user. */
  unreadCount(options: { userId: string; teamId?: string | null }): Promise<number>;

  /** Anon: set `read_at` on a single row the user can see. Idempotent —
   *  already-read rows are not overwritten. */
  markRead(notificationId: string): Promise<void>;

  /** Anon: set `read_at` on every unread row the user can see, optionally
   *  scoped to one team. */
  markAllRead(options: { userId: string; teamId?: string | null }): Promise<void>;

  /** Service-role: delete rows past their retention cutoff OR with `expires_at`
   *  in the past. Used by Part 5's scheduled cleanup; included here so the
   *  contract is locked from day 1. */
  deleteExpired(options: DeleteExpiredOptions): Promise<{ deleted: number }>;
}
