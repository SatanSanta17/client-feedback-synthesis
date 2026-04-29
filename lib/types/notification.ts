import type { NotificationEventType } from "@/lib/notifications/events";

/** Workspace notification row (PRD-029 Part 1).
 *
 *  `payload` is `unknown`: read it via `payloadSchemaFor(eventType).parse(...)`
 *  from `lib/notifications/events`. Direct field access bypasses the closed
 *  event-type contract and will silently break when payload shapes evolve. */
export interface WorkspaceNotification {
  id: string;
  teamId: string;
  /** Targeted notification when set; broadcast to the team when null. */
  userId: string | null;
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
