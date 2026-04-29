import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/api/route-auth";
import { createNotificationRepository } from "@/lib/repositories/supabase/supabase-notification-repository";
import { markAllRead } from "@/lib/services/notification-service";

const LOG_PREFIX = "[api/notifications/mark-all-read]";

// Optional body — when omitted, the bulk action applies cross-workspace
// (PRD §P2.R6 / §P2.R10). When `teamId` is supplied, the action is scoped
// to that workspace.
const bodySchema = z
  .object({
    teamId: z.string().uuid().optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-all-read — mark every visible unread row as read
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema> = undefined;
  try {
    // Empty body is allowed — `request.json()` throws on empty body, so we
    // guard with a content-length check.
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > 0) {
      const raw = await request.json();
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) {
        const message = parsed.error.issues.map((i) => i.message).join(", ");
        console.warn(`${LOG_PREFIX} POST — validation failed:`, message);
        return NextResponse.json({ message }, { status: 400 });
      }
      body = parsed.data;
    }
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} POST — body parse failed:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400 }
    );
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  console.log(
    `${LOG_PREFIX} POST — userId: ${user.id}, teamId: ${body?.teamId ?? "(all)"}`
  );

  try {
    const repo = createNotificationRepository(supabase);
    await markAllRead(repo, {
      userId: user.id,
      teamId: body?.teamId ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} POST error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to mark notifications read" },
      { status: 500 }
    );
  }
}
