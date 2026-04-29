import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/api/route-auth";
import { createNotificationRepository } from "@/lib/repositories/supabase/supabase-notification-repository";
import { listForBell } from "@/lib/services/notification-service";

const LOG_PREFIX = "[api/notifications]";

// ---------------------------------------------------------------------------
// GET /api/notifications — paginated bell listing (cross-workspace by default)
// ---------------------------------------------------------------------------

const listParamsSchema = z.object({
  cursor: z.string().datetime().optional(),
  cursorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeRead: z.coerce.boolean().default(true),
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());

  const parsed = listParamsSchema.safeParse(params);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    console.warn(`${LOG_PREFIX} GET — validation failed:`, message);
    return NextResponse.json({ message }, { status: 400 });
  }

  // Cursor must be supplied as a complete pair or not at all.
  if (
    (parsed.data.cursor && !parsed.data.cursorId) ||
    (!parsed.data.cursor && parsed.data.cursorId)
  ) {
    return NextResponse.json(
      { message: "cursor and cursorId must be supplied together" },
      { status: 400 }
    );
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  console.log(
    `${LOG_PREFIX} GET — userId: ${user.id}, limit: ${parsed.data.limit}, includeRead: ${parsed.data.includeRead}, cursor: ${parsed.data.cursor ?? "(none)"}`
  );

  try {
    const repo = createNotificationRepository(supabase);
    // Cross-workspace by default (no `teamId` passed) per PRD §P2.R10. RLS
    // scopes the row set to what the user can see across every team they
    // belong to.
    const result = await listForBell(repo, {
      userId: user.id,
      limit: parsed.data.limit,
      cursor:
        parsed.data.cursor && parsed.data.cursorId
          ? { createdAt: parsed.data.cursor, id: parsed.data.cursorId }
          : null,
      includeRead: parsed.data.includeRead,
      windowDays: parsed.data.windowDays,
    });

    console.log(
      `${LOG_PREFIX} GET — returning ${result.rows.length} rows, nextCursor: ${result.nextCursor ? "yes" : "no"}`
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} GET error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
