import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuth,
  requireWorkspaceAdmin,
} from "@/lib/api/route-auth";
import { createThemeMergeRepository } from "@/lib/repositories/supabase/supabase-theme-merge-repository";
import { listRecentMerges } from "@/lib/services/theme-merge-service";

const LOG_PREFIX = "[api/themes/merges]";

const FORBIDDEN_MESSAGE = "Only workspace admins can view theme merges";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/themes/merges — Admin-gated recent-merges audit list (P3.R7, P3.R8)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  console.log(`${LOG_PREFIX} GET — start`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const wsAdmin = await requireWorkspaceAdmin(auth.user, FORBIDDEN_MESSAGE);
  if (wsAdmin instanceof NextResponse) return wsAdmin;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    console.warn(`${LOG_PREFIX} GET — invalid query: ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }

  const mergeRepo = createThemeMergeRepository(wsAdmin.serviceClient);

  try {
    const { items, hasMore } = await listRecentMerges({
      workspace: wsAdmin.workspace,
      mergeRepo,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    console.log(
      `${LOG_PREFIX} GET — returning ${items.length} merge(s), hasMore: ${hasMore}`
    );

    return NextResponse.json({ items, hasMore });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} GET — error:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "Failed to load theme merges" },
      { status: 500 }
    );
  }
}
