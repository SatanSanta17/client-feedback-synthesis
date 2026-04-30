import { Bell, CheckCircle, GitMerge, Inbox } from "lucide-react";
import type { ComponentType } from "react";
import type { z } from "zod";

import {
  NOTIFICATION_EVENTS,
  payloadSchemaFor,
  type NotificationEventType,
  type SupersessionProposedPayload,
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

/** Tiny pluralisation helper — returns `"1 thing"` or `"N things"`. Adds
 *  `s` for the plural form; if a future event needs irregular plurals
 *  (e.g., "person" / "people") add a third arg then. */
function pluralize(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

const SUPERSESSION_SOURCE_LABEL: Record<
  SupersessionProposedPayload["source"],
  string
> = {
  bulk_re_extract: "a bulk re-extract",
  single_session_re_extract: "a re-extract",
  inline_dialog_timeout: "a deferred review",
};

/**
 * Per-event renderer registry (PRD-029 Part 3).
 *
 * Typed `Partial<RendererRegistry>` rather than the total `RendererRegistry`
 * so a future event type can be registered in `NOTIFICATION_EVENTS` *before*
 * its renderer ships here without breaking the typecheck — the bell falls
 * through to FALLBACK in that window.
 *
 * Adding a new event type = add an entry below, ship.
 */
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
    // No first-class bulk-run status page yet; the row is informational and
    // clicking simply marks it read + closes the dropdown. Wire to a status
    // surface if/when one ships.
    deepLink: () => null,
  },
};

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
    // After Part 3, every registered event has a renderer. A miss here is
    // either a registered-but-unrendered event (deploy window where the
    // event registration shipped without its renderer entry) or a
    // deprecated event_type lingering in the DB. Both are worth observing.
    console.warn(
      `[notification-renderer] no renderer for event type "${notification.eventType}" (id: ${notification.id}); using fallback.`
    );
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
