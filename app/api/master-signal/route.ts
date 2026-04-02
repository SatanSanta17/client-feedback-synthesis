import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getLatestMasterSignal,
  getStaleSessionCount,
} from "@/lib/services/master-signal-service";

/**
 * GET /api/master-signal
 *
 * Fetch the current (latest) master signal and staleness info.
 *
 * Returns:
 * - masterSignal: the latest generated master signal, or null if none exists.
 * - staleCount: number of sessions with structured_notes that were updated
 *   after the master signal was generated. If no master signal exists, this is
 *   the total count of sessions with structured_notes (i.e., how many are
 *   ready to be synthesised).
 */
export async function GET() {
  console.log("[api/master-signal] GET — fetching current master signal");

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/master-signal] GET — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const masterSignal = await getLatestMasterSignal();

    // Count stale sessions: updated since last generation, or all if no generation yet
    const staleCount = await getStaleSessionCount(
      masterSignal?.generatedAt ?? null
    );

    console.log(
      `[api/master-signal] GET — masterSignal: ${masterSignal ? masterSignal.id : "none"}, staleCount: ${staleCount}`
    );

    return NextResponse.json({
      masterSignal,
      staleCount,
      isTainted: masterSignal?.isTainted ?? false,
    });
  } catch (err) {
    console.error(
      "[api/master-signal] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch master signal" },
      { status: 500 }
    );
  }
}
