import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/api/route-auth";
import { createNotificationRepository } from "@/lib/repositories/supabase/supabase-notification-repository";
import { markRead } from "@/lib/services/notification-service";

const LOG_PREFIX = "[api/notifications/[id]/read]";

const idSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// POST /api/notifications/[id]/read — mark a single notification read
//
// Idempotent. Passing an id for a row the user cannot see is a silent no-op
// (RLS denies the UPDATE) — distinguishing "doesn't exist" from "RLS-denied"
// would leak information about other users' notifications.
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) {
    console.warn(`${LOG_PREFIX} POST — invalid id: ${id}`);
    return NextResponse.json(
      { message: "Invalid notification id" },
      { status: 400 }
    );
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  console.log(`${LOG_PREFIX} POST — userId: ${user.id}, id: ${id}`);

  try {
    const repo = createNotificationRepository(supabase);
    await markRead(repo, { userId: user.id, notificationId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} POST error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to mark notification read" },
      { status: 500 }
    );
  }
}
