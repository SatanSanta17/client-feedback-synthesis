/**
 * Notification Service (PRD-029 Part 1)
 *
 * Public entry point for emitting and reading workspace notifications.
 * Validates event types and payloads against the closed registry in
 * `lib/notifications/events.ts`, then delegates to the repository.
 *
 * Consumers (theme merge, supersession deposits, bulk re-extract completion,
 * etc.) call `emit` directly from server-side code. Bell UI surfaces (Part 2)
 * call `listForUser` / `unreadCount` / `markRead` / `markAllRead` via the API
 * routes that wrap them.
 *
 * Direct repository access bypasses validation and logging — always go through
 * this service.
 */

import type { z } from "zod";

import {
  NOTIFICATION_EVENTS,
  isNotificationEventType,
  payloadSchemaFor,
  type NotificationEventType,
} from "@/lib/notifications/events";
import type {
  ListForBellResult,
  ListForUserResult,
  NotificationRepository,
} from "@/lib/repositories/notification-repository";
import type {
  NotificationCursor,
  WorkspaceNotification,
} from "@/lib/types/notification";

const LOG_PREFIX = "[notification-service]";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when `emit` receives an event type not in `NOTIFICATION_EVENTS`. */
export class UnknownEventTypeError extends Error {
  constructor(eventType: string) {
    super(
      `Unknown notification event type: "${eventType}". Add it to NOTIFICATION_EVENTS to emit.`
    );
    this.name = "UnknownEventTypeError";
  }
}

/** Thrown when `emit` receives a payload that fails Zod validation for the
 *  given event type. */
export class InvalidPayloadError extends Error {
  constructor(eventType: string, issues: string) {
    super(`Invalid payload for event type "${eventType}": ${issues}`);
    this.name = "InvalidPayloadError";
  }
}

/** Thrown when `emit` receives neither a `userId` (targeted) nor a `teamId`
 *  (broadcast). PRD-029 §P7 — every emit must resolve to at least one
 *  candidate recipient; an emit with neither shape is a programmer error. */
export class InvalidEmitTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmitTargetError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Common emit fields shared by every event variant.
 *
 *  PRD-029 §P7 reshape:
 *  - Targeted emit: pass `userId` (the recipient). `teamId` is optional —
 *    null for personal-workspace targets.
 *  - Broadcast emit: pass `teamId` and omit `userId`. The service fans out
 *    to active members of the team. Pass `actorId` to suppress that user
 *    from the recipient set (P7.R3).
 *
 *  Either `userId` or `teamId` MUST be provided; an emit with neither raises
 *  `InvalidEmitTargetError`. */
interface EmitInputBase {
  /** Workspace anchor. Null/omitted = personal workspace (no team). */
  teamId?: string | null;
  /** Targeted recipient. When omitted on a team emit, the service fans out
   *  to active team members. */
  userId?: string | null;
  /** Optional per-row override for retention (Part 5). */
  expiresAt?: string | null;
  /** PRD-029 §P7.R3 — suppresses this user from a broadcast emit's recipient
   *  set. Ignored on targeted emits (the named user is the audience by
   *  design). Some emitters (system actions, scheduled jobs) have no actor
   *  and should leave this null/omitted. */
  actorId?: string | null;
}

/**
 * Discriminated union over `NotificationEventType` — each variant ties an
 * `eventType` to its inferred payload shape so the call site is checked at
 * compile time. Catching `archivedTheemId` typos in the editor is what this
 * shape exists for; the runtime Zod parse remains as defence in depth.
 */
export type EmitInput = {
  [E in NotificationEventType]: EmitInputBase & {
    eventType: E;
    payload: z.infer<(typeof NOTIFICATION_EVENTS)[E]["payloadSchema"]>;
  };
}[NotificationEventType];

/**
 * Resolve the recipient set for an emit.
 *
 *  - Targeted emit (`userId` set): single recipient, no actor suppression.
 *    Targeted emits are explicitly addressed; the actor IS the audience by
 *    design (e.g., "your bulk re-extract finished").
 *  - Broadcast emit (`teamId` set, no `userId`): active team members,
 *    optionally minus the actor.
 *  - Neither: programmer error → `InvalidEmitTargetError`.
 */
async function resolveRecipients(
  repo: NotificationRepository,
  input: EmitInput
): Promise<string[]> {
  if (input.userId) {
    return [input.userId];
  }
  if (input.teamId) {
    const members = await repo.listActiveTeamMemberIds(input.teamId);
    return input.actorId
      ? members.filter((id) => id !== input.actorId)
      : members;
  }
  throw new InvalidEmitTargetError(
    `emit() requires either userId or teamId; received neither for event "${input.eventType}"`
  );
}

/**
 * Emit a workspace notification.
 *
 * Validates the event type against the closed registry, parses the payload
 * against that event's Zod schema, resolves the recipient set, and writes
 * one row per recipient via bulk insert (PRD-029 §P7 fan-out).
 *
 * Throws:
 *   - `UnknownEventTypeError` if the event is not registered.
 *   - `InvalidPayloadError` if the payload fails Zod validation.
 *   - `InvalidEmitTargetError` if neither `userId` nor `teamId` is set.
 *   - Any error the repository raises (logged and rethrown).
 *
 * Returns the inserted rows. An empty array is returned (and no insert is
 * issued) when the resolved recipient set is empty — for example, a personal-
 * workspace emit where the only candidate is the actor and `actorId` matches.
 *
 * Callers should not swallow these errors silently — an emit that fails is
 * a missed notification, which is exactly the failure mode this PRD exists
 * to prevent.
 */
export async function emit(
  repo: NotificationRepository,
  input: EmitInput
): Promise<WorkspaceNotification[]> {
  const start = Date.now();
  console.log(
    `${LOG_PREFIX} emit — eventType: ${input.eventType}, teamId: ${input.teamId ?? "(personal)"}, userId: ${input.userId ?? "(broadcast)"}, actorId: ${input.actorId ?? "(none)"}`
  );

  if (!isNotificationEventType(input.eventType)) {
    console.error(
      `${LOG_PREFIX} emit — unknown event type "${input.eventType}"`
    );
    throw new UnknownEventTypeError(input.eventType);
  }

  const schema = payloadSchemaFor(input.eventType);
  const result = schema.safeParse(input.payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    console.error(
      `${LOG_PREFIX} emit — payload validation failed for ${input.eventType}: ${issues}`
    );
    throw new InvalidPayloadError(input.eventType, issues);
  }

  try {
    const recipients = await resolveRecipients(repo, input);
    if (recipients.length === 0) {
      console.log(
        `${LOG_PREFIX} emit — recipient set is empty (actor-only personal workspace, empty team, or every member matches actorId); skipping insert (elapsed: ${Date.now() - start}ms)`
      );
      return [];
    }

    const rows = await repo.bulkInsert(
      recipients.map((userId) => ({
        team_id: input.teamId ?? null,
        user_id: userId,
        event_type: input.eventType,
        payload: result.data as Record<string, unknown>,
        expires_at: input.expiresAt ?? null,
      }))
    );
    console.log(
      `${LOG_PREFIX} emit — wrote ${rows.length} row(s), elapsed: ${Date.now() - start}ms`
    );
    return rows;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} emit — failure after ${Date.now() - start}ms:`,
      err
    );
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

/** Bell-shaped read — same params as `listForUser` but with `teamName`
 *  joined into each row for the workspace-label rendering (PRD §P2.R10). */
export async function listForBell(
  repo: NotificationRepository,
  params: ListForUserParams
): Promise<ListForBellResult> {
  console.log(
    `${LOG_PREFIX} listForBell — userId: ${params.userId}, teamId: ${params.teamId ?? "(any)"}, limit: ${params.limit ?? "default"}`
  );
  return repo.listForBell(params);
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

/** Re-export the closed event registry so admin tooling and tests can
 *  introspect known event types without importing the lower-level module
 *  directly. The registry itself is the public contract. */
export { NOTIFICATION_EVENTS } from "@/lib/notifications/events";
