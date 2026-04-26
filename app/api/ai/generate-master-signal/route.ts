import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/route-auth";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { mapAIErrorToResponse } from "@/lib/utils/map-ai-error";
import { generateOrUpdateMasterSignal } from "@/lib/services/master-signal-service";
import { getTeamMember } from "@/lib/services/team-service";
import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { createMasterSignalRepository } from "@/lib/repositories/supabase/supabase-master-signal-repository";

/**
 * POST /api/ai/generate-master-signal
 *
 * Triggers master signal generation. Determines cold start vs. incremental
 * based on whether a previous master signal exists.
 *
 * In team context, only admins can generate the master signal.
 */
export async function POST() {
  console.log("[api/ai/generate-master-signal] POST — starting generation");

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase, serviceClient } = auth;

  const teamId = await getActiveTeamId();

  if (teamId) {
    const teamRepo = createTeamRepository(supabase, serviceClient);
    const member = await getTeamMember(teamRepo, teamId, user.id);
    if (member?.role !== "admin") {
      console.warn("[api/ai/generate-master-signal] POST — non-admin in team context");
      return NextResponse.json(
        { message: "Only team admins can generate the master signal" },
        { status: 403 }
      );
    }
  }

  const promptRepo = createPromptRepository(supabase, teamId);
  const masterSignalRepo = createMasterSignalRepository(supabase, serviceClient, teamId);

  try {
    const result = await generateOrUpdateMasterSignal(masterSignalRepo, promptRepo);

    if (result.outcome === "no-sessions") {
      return NextResponse.json({ message: result.message }, { status: 422 });
    }

    if (result.outcome === "unchanged") {
      return NextResponse.json({
        masterSignal: result.masterSignal,
        unchanged: true,
      });
    }

    return NextResponse.json({ masterSignal: result.masterSignal });
  } catch (err) {
    return mapAIErrorToResponse(err, "api/ai/generate-master-signal", {
      request:
        "Could not generate master signal. The input may be too large — try extracting signals from fewer sessions.",
      empty:
        "AI could not produce a master signal from the available data. Please ensure sessions have extracted signals and try again.",
      unexpected:
        "An unexpected error occurred during master signal generation.",
    });
  }
}
