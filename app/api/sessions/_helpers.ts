import { NextResponse } from "next/server";

import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import { getTeamMember } from "@/lib/services/team-service";

/**
 * Checks whether the current user has write access to a session.
 * Returns null if access is granted, or a NextResponse error if denied.
 *
 * - 401 if not authenticated
 * - 404 if session not found or deleted
 * - 403 if in a team context and the user is not the session owner or a team admin
 */
export async function checkSessionWriteAccess(
  sessionId: string
): Promise<{ error: NextResponse } | { error: null; userId: string; teamId: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { message: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  const teamId = await getActiveTeamId();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, created_by")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single();

  if (!session) {
    return {
      error: NextResponse.json(
        { message: "Session not found" },
        { status: 404 }
      ),
    };
  }

  if (teamId && session.created_by !== user.id) {
    const member = await getTeamMember(teamId, user.id);
    if (member?.role !== "admin") {
      return {
        error: NextResponse.json(
          { message: "You can only modify your own sessions" },
          { status: 403 }
        ),
      };
    }
  }

  return { error: null, userId: user.id, teamId };
}
