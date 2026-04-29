import { Bell } from "lucide-react";
import type { ComponentType } from "react";
import type { z } from "zod";

import {
  NOTIFICATION_EVENTS,
  payloadSchemaFor,
  type NotificationEventType,
} from "@/lib/notifications/events";
import type { WorkspaceNotification } from "@/lib/types/notification";

// ---------------------------------------------------------------------------
// Renderer contract (PRD-029 Part 2)
// ---------------------------------------------------------------------------

/** Per-event renderer. Each entry is parameterised by the event's payload
 *  type so authors get type-safe access to payload fields inside `title`
 *  and `deepLink`. */
export type RendererFor<E extends NotificationEventType> = {
  icon: ComponentType<{ className?: string }>;
  title: (
    payload: z.infer<(typeof NOTIFICATION_EVENTS)[E]["payloadSchema"]>
  ) => string;
  deepLink: (
    payload: z.infer<(typeof NOTIFICATION_EVENTS)[E]["payloadSchema"]>
  ) => string | null;
};

/** Total registry over every registered event type. Part 3 makes this total
 *  by populating an entry for each event. */
export type RendererRegistry = {
  [E in NotificationEventType]: RendererFor<E>;
};

/**
 * Part 2 ships an empty registry. Part 3 populates each event type. The
 * `Partial<...>` cast is intentional: a deploy that lands a new event type
 * before its renderer ships still produces a working (fallback) UI rather
 * than a typecheck failure that blocks the event-type change.
 */
export const NOTIFICATION_RENDERERS: Partial<RendererRegistry> = {};

// ---------------------------------------------------------------------------
// Public consumption surface
// ---------------------------------------------------------------------------

/** Shape every bell row consumes — independent of the originating event type
 *  so the row component does not need to special-case events. */
export interface RenderedNotification {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Null when the event has no meaningful destination (informational rows). */
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
 *
 * The `as (payload: unknown) => ...` casts inside the success branch bridge
 * the runtime guarantee (`payloadSchemaFor(eventType)` returns the schema
 * whose `z.infer` matches `RendererFor<E>['title' | 'deepLink']`'s payload
 * type) to a generic lookup TypeScript cannot statically verify.
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
  return {
    icon: renderer.icon,
    title: (renderer.title as (payload: unknown) => string)(result.data),
    deepLink: (renderer.deepLink as (payload: unknown) => string | null)(
      result.data
    ),
  };
}
