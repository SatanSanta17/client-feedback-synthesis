import { NextResponse } from "next/server";

import {
  requireAuth,
  requireWorkspaceAdmin,
} from "@/lib/api/route-auth";
import {
  createThemeCandidatePairsRepository,
  createThemeCandidateRepository,
} from "@/lib/repositories/supabase/supabase-theme-candidate-repository";
import { createThemeDismissalRepository } from "@/lib/repositories/supabase/supabase-theme-dismissal-repository";
import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";
import { refreshCandidates } from "@/lib/services/theme-candidate-service";

const LOG_PREFIX = "[api/themes/candidates/refresh]";

const FORBIDDEN_MESSAGE = "Only workspace admins can refresh merge candidates";

// ---------------------------------------------------------------------------
// POST /api/themes/candidates/refresh — On-demand rebuild (PRD-026 P2.R6)
// ---------------------------------------------------------------------------

export async function POST() {
  console.log(`${LOG_PREFIX} POST — start`);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const wsAdmin = await requireWorkspaceAdmin(auth.user, FORBIDDEN_MESSAGE);
  if (wsAdmin instanceof NextResponse) return wsAdmin;

  const candidateRepo = createThemeCandidateRepository(wsAdmin.serviceClient);
  const pairsRepo = createThemeCandidatePairsRepository(wsAdmin.serviceClient);
  const dismissalRepo = createThemeDismissalRepository(wsAdmin.serviceClient);
  const themeRepo = createThemeRepository(
    wsAdmin.serviceClient,
    wsAdmin.workspace.teamId
  );

  try {
    const result = await refreshCandidates({
      workspace: wsAdmin.workspace,
      serviceClient: wsAdmin.serviceClient,
      candidateRepo,
      pairsRepo,
      dismissalRepo,
      themeRepo,
    });

    console.log(
      `${LOG_PREFIX} POST — done | candidates: ${result.candidatesGenerated} | elapsedMs: ${result.elapsedMs}`
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} POST — refresh failed:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "Failed to refresh merge candidates" },
      { status: 500 }
    );
  }
}
