import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuth,
  requireWorkspaceAdmin,
} from "@/lib/api/route-auth";
import { createThemeCandidateRepository } from "@/lib/repositories/supabase/supabase-theme-candidate-repository";
import { listCandidates } from "@/lib/services/theme-candidate-service";

const LOG_PREFIX = "[api/themes/candidates]";

const FORBIDDEN_MESSAGE = "Only workspace admins can view merge candidates";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/themes/candidates — Admin-gated candidate list (PRD-026 P2.R7)
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

  const candidateRepo = createThemeCandidateRepository(wsAdmin.serviceClient);

  try {
    const { items, hasMore } = await listCandidates({
      workspace: wsAdmin.workspace,
      candidateRepo,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    // All candidates from one refresh share generated_at; the first row's
    // timestamp is the freshness signal. null when the workspace has never
    // been refreshed (or every pair has been dismissed).
    const lastRefreshedAt = items[0]?.generatedAt ?? null;

    console.log(
      `${LOG_PREFIX} GET — returning ${items.length} candidate(s), hasMore: ${hasMore}`
    );

    return NextResponse.json({
      candidates: items,
      hasMore,
      lastRefreshedAt,
    });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} GET — error:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "Failed to load merge candidates" },
      { status: 500 }
    );
  }
}
