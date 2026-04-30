import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuth,
  requireWorkspaceAdmin,
} from "@/lib/api/route-auth";
import { createThemeCandidateRepository } from "@/lib/repositories/supabase/supabase-theme-candidate-repository";
import { createThemeMergeRepository } from "@/lib/repositories/supabase/supabase-theme-merge-repository";
import {
  MergeNotFoundError,
  MergeValidationError,
} from "@/lib/repositories/theme-merge-repository";
import {
  CandidateNotFoundForMergeError,
  InvalidCanonicalChoiceError,
  mergeCandidatePair,
} from "@/lib/services/theme-merge-service";

const LOG_PREFIX = "[api/themes/candidates/[id]/merge]";

const FORBIDDEN_MESSAGE = "Only workspace admins can merge themes";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid candidate id"),
});

const bodySchema = z.object({
  canonicalThemeId: z.string().uuid("Invalid canonicalThemeId"),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// POST /api/themes/candidates/[id]/merge — Admin-gated merge confirmation
// (PRD-026 P3.R1, P3.R2, P3.R3, P3.R5, P3.R8)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, context: RouteContext) {
  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    const message = parsedParams.error.issues.map((i) => i.message).join(", ");
    console.warn(`${LOG_PREFIX} POST — invalid params: ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }
  const { id } = parsedParams.data;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    const message = parsedBody.error.issues.map((i) => i.message).join(", ");
    console.warn(`${LOG_PREFIX} POST — invalid body: ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }
  const { canonicalThemeId } = parsedBody.data;

  console.log(
    `${LOG_PREFIX} POST — start | id: ${id} | canonical: ${canonicalThemeId}`
  );

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const wsAdmin = await requireWorkspaceAdmin(auth.user, FORBIDDEN_MESSAGE);
  if (wsAdmin instanceof NextResponse) return wsAdmin;

  const candidateRepo = createThemeCandidateRepository(wsAdmin.serviceClient);
  const mergeRepo = createThemeMergeRepository(wsAdmin.serviceClient);

  try {
    const result = await mergeCandidatePair({
      candidateId: id,
      canonicalThemeId,
      workspace: wsAdmin.workspace,
      actorId: auth.user.id,
      candidateRepo,
      mergeRepo,
    });

    console.log(
      `${LOG_PREFIX} POST — done | audit: ${result.auditId} | reassigned: ${result.signalAssignmentsRepointed}`
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CandidateNotFoundForMergeError) {
      console.warn(`${LOG_PREFIX} POST — candidate not found | id: ${id}`);
      return NextResponse.json({ message: err.message }, { status: 404 });
    }
    if (err instanceof InvalidCanonicalChoiceError) {
      console.warn(`${LOG_PREFIX} POST — invalid canonical choice | id: ${id}`);
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    if (err instanceof MergeNotFoundError) {
      // Theme vanished between candidate refresh and merge — surface as 404
      // so the client refetches and sees the candidate row already gone.
      console.warn(`${LOG_PREFIX} POST — theme not found | id: ${id}`);
      return NextResponse.json({ message: err.message }, { status: 404 });
    }
    if (err instanceof MergeValidationError) {
      // 409 Conflict — the request was well-formed but the underlying state
      // disallows the merge (already archived, cross-workspace, same theme).
      console.warn(`${LOG_PREFIX} POST — validation conflict | id: ${id}: ${err.message}`);
      return NextResponse.json({ message: err.message }, { status: 409 });
    }
    console.error(
      `${LOG_PREFIX} POST — error | id: ${id}:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "Failed to merge themes" },
      { status: 500 }
    );
  }
}
