import type { NotificationEventType } from "@/lib/notifications/events";

/** Workspace notification row (PRD-029 Part 1, restructured in Part 7).
 *
 *  As of Part 7, every row has exactly one recipient (`userId` is NOT NULL),
 *  and `teamId` is nullable to support personal-workspace notifications.
 *  Broadcasts are fanned out at emit time into per-recipient rows.
 *
 *  `payload` is `unknown`: read it via `payloadSchemaFor(eventType).parse(...)`
 *  from `lib/notifications/events`. Direct field access bypasses the closed
 *  event-type contract and will silently break when payload shapes evolve. */
export interface WorkspaceNotification {
  id: string;
  /** Workspace anchor. Null on personal-workspace notifications. */
  teamId: string | null;
  /** Recipient. Always set as of Part 7's per-user fan-out. */
  userId: string;
  eventType: NotificationEventType;
  payload: unknown;
  readAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Keyset pagination cursor — stable across inserts (no OFFSET drift). */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}
