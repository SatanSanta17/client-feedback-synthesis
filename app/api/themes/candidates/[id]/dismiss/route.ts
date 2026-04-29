import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuth,
  requireWorkspaceAdmin,
} from "@/lib/api/route-auth";
import { createThemeCandidateRepository } from "@/lib/repositories/supabase/supabase-theme-candidate-repository";
import { createThemeDismissalRepository } from "@/lib/repositories/supabase/supabase-theme-dismissal-repository";
import {
  CandidateAccessError,
  CandidateNotFoundError,
  dismissCandidate,
} from "@/lib/services/theme-candidate-service";

const LOG_PREFIX = "[api/themes/candidates/[id]/dismiss]";

const FORBIDDEN_MESSAGE = "Only workspace admins can dismiss merge candidates";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid candidate id"),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// POST /api/themes/candidates/[id]/dismiss — Admin-gated dismiss (P2.R5)
// ---------------------------------------------------------------------------

export async function POST(_request: Request, context: RouteContext) {
  const rawParams = await context.params;

  const parsed = paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    console.warn(`${LOG_PREFIX} POST — invalid params: ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }

  const { id } = parsed.data;
  console.log(`${LOG_PREFIX} POST — start | id: ${id}`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const wsAdmin = await requireWorkspaceAdmin(auth.user, FORBIDDEN_MESSAGE);
  if (wsAdmin instanceof NextResponse) return wsAdmin;

  const candidateRepo = createThemeCandidateRepository(wsAdmin.serviceClient);
  const dismissalRepo = createThemeDismissalRepository(wsAdmin.serviceClient);

  try {
    await dismissCandidate({
      candidateId: id,
      workspace: wsAdmin.workspace,
      actingUserId: auth.user.id,
      candidateRepo,
      dismissalRepo,
    });

    console.log(`${LOG_PREFIX} POST — done | id: ${id}`);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof CandidateNotFoundError) {
      console.warn(`${LOG_PREFIX} POST — not found | id: ${id}`);
      return NextResponse.json({ message: err.message }, { status: 404 });
    }
    if (err instanceof CandidateAccessError) {
      console.warn(`${LOG_PREFIX} POST — access denied | id: ${id}`);
      return NextResponse.json({ message: err.message }, { status: 403 });
    }
    console.error(
      `${LOG_PREFIX} POST — error | id: ${id}:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "Failed to dismiss merge candidate" },
      { status: 500 }
    );
  }
}
