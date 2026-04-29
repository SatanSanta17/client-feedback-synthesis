import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/api/route-auth";
import { createNotificationRepository } from "@/lib/repositories/supabase/supabase-notification-repository";
import { unreadCount } from "@/lib/services/notification-service";

const LOG_PREFIX = "[api/notifications/unread-count]";

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count — badge count (cross-workspace by default)
// ---------------------------------------------------------------------------

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  console.log(`${LOG_PREFIX} GET — userId: ${user.id}`);

  try {
    const repo = createNotificationRepository(supabase);
    // No `teamId` — bell badge aggregates across every workspace the user
    // belongs to (PRD §P2.R10). RLS does the visibility filtering.
    const count = await unreadCount(repo, { userId: user.id });

    console.log(`${LOG_PREFIX} GET — count: ${count}`);
    return NextResponse.json({ count });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} GET error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch unread count" },
      { status: 500 }
    );
  }
}
