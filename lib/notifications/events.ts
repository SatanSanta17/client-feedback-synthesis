import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-event payload schemas (PRD-029 Part 1)
// ---------------------------------------------------------------------------

/** Schema for a `theme.merged` notification (PRD-026 Part 4). */
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

/** Schema for a `supersession.proposed` notification (PRD-028 Part 5 P5.R9). */
export const supersessionProposedPayloadSchema = z.object({
  proposalCount: z.number().int().positive(),
  source: z.enum([
    "bulk_re_extract",
    "single_session_re_extract",
    "inline_dialog_timeout",
  ]),
  sourceOperationId: z.string().uuid().nullable(),
});
export type SupersessionProposedPayload = z.infer<
  typeof supersessionProposedPayloadSchema
>;

/** Schema for a `bulk_re_extract.completed` notification (PRD-017 follow-up). */
export const bulkReExtractCompletedPayloadSchema = z.object({
  sessionsProcessed: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type BulkReExtractCompletedPayload = z.infer<
  typeof bulkReExtractCompletedPayloadSchema
>;

// ---------------------------------------------------------------------------
// Closed event-type registry
// To add a new event type: define a payload schema above, then add a registry
// entry below. Renderers (Part 3) and consumers see the new type the moment
// this file ships — no DB migration required.
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
} as const satisfies Record<string, { payloadSchema: z.ZodTypeAny }>;

export type NotificationEventType = keyof typeof NOTIFICATION_EVENTS;

/** Type guard — true if `value` is a registered event type. */
export function isNotificationEventType(
  value: string
): value is NotificationEventType {
  return value in NOTIFICATION_EVENTS;
}

/** Look up the Zod schema for an event's payload. */
export function payloadSchemaFor(eventType: NotificationEventType) {
  return NOTIFICATION_EVENTS[eventType].payloadSchema;
}
