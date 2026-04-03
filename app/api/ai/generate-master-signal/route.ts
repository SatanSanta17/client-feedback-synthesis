import { NextResponse } from "next/server";
import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import {
  synthesiseMasterSignal,
  AIServiceError,
  AIEmptyResponseError,
  AIRequestError,
  AIConfigError,
  AIQuotaError,
} from "@/lib/services/ai-service";
import {
  getLatestMasterSignal,
  getAllSignalSessions,
  getSignalSessionsSince,
  saveMasterSignal,
} from "@/lib/services/master-signal-service";
import { getTeamMember } from "@/lib/services/team-service";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn(
      "[api/ai/generate-master-signal] POST — unauthenticated request"
    );
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();
  if (teamId) {
    const member = await getTeamMember(teamId, user.id);
    if (member?.role !== "admin") {
      console.warn("[api/ai/generate-master-signal] POST — non-admin in team context");
      return NextResponse.json(
        { message: "Only team admins can generate the master signal" },
        { status: 403 }
      );
    }
  }

  try {
    // 1. Fetch the latest master signal
    const latestMasterSignal = await getLatestMasterSignal();

    if (!latestMasterSignal) {
      // --- Cold start: no previous master signal ---
      console.log(
        "[api/ai/generate-master-signal] cold start — no previous master signal"
      );

      const sessions = await getAllSignalSessions();

      if (sessions.length === 0) {
        console.warn(
          "[api/ai/generate-master-signal] no sessions with structured notes"
        );
        return NextResponse.json(
          {
            message:
              "No extracted signals found. Extract signals from individual sessions on the Capture page first.",
          },
          { status: 422 }
        );
      }

      console.log(
        `[api/ai/generate-master-signal] cold start — synthesising from ${sessions.length} sessions`
      );

      const content = await synthesiseMasterSignal({ sessions });
      const saved = await saveMasterSignal(content, sessions.length);

      console.log(
        `[api/ai/generate-master-signal] cold start — saved master signal: ${saved.id}`
      );

      return NextResponse.json({ masterSignal: saved });
    }

    // --- Tainted: force cold start to purge deleted session signals ---
    if (latestMasterSignal.isTainted) {
      console.log(
        "[api/ai/generate-master-signal] tainted — forcing cold start"
      );

      const sessions = await getAllSignalSessions();

      if (sessions.length === 0) {
        console.warn(
          "[api/ai/generate-master-signal] tainted cold start — no sessions remaining"
        );
        return NextResponse.json(
          {
            message:
              "No extracted signals found. All sessions with signals have been deleted.",
          },
          { status: 422 }
        );
      }

      console.log(
        `[api/ai/generate-master-signal] tainted cold start — synthesising from ${sessions.length} sessions`
      );

      const content = await synthesiseMasterSignal({ sessions });
      const saved = await saveMasterSignal(content, sessions.length);

      console.log(
        `[api/ai/generate-master-signal] tainted cold start — saved: ${saved.id}`
      );

      return NextResponse.json({ masterSignal: saved });
    }

    // --- Incremental: previous master signal exists and is not tainted ---
    console.log(
      `[api/ai/generate-master-signal] incremental — last generated: ${latestMasterSignal.generatedAt}`
    );

    const newSessions = await getSignalSessionsSince(
      latestMasterSignal.generatedAt
    );

    if (newSessions.length === 0) {
      console.log(
        "[api/ai/generate-master-signal] incremental — no new sessions, returning existing"
      );
      return NextResponse.json({
        masterSignal: latestMasterSignal,
        unchanged: true,
      });
    }

    console.log(
      `[api/ai/generate-master-signal] incremental — merging ${newSessions.length} new session(s)`
    );

    const content = await synthesiseMasterSignal({
      previousMasterSignal: latestMasterSignal.content,
      sessions: newSessions,
    });

    const totalSessions =
      latestMasterSignal.sessionsIncluded + newSessions.length;
    const saved = await saveMasterSignal(content, totalSessions);

    console.log(
      `[api/ai/generate-master-signal] incremental — saved master signal: ${saved.id}`
    );

    return NextResponse.json({ masterSignal: saved });
  } catch (err) {
    // Map AI error types to HTTP status codes
    if (err instanceof AIConfigError) {
      console.error(
        "[api/ai/generate-master-signal] config error:",
        err.message
      );
      return NextResponse.json(
        {
          message:
            "AI service is not configured correctly. Please contact support.",
        },
        { status: 500 }
      );
    }

    if (err instanceof AIQuotaError) {
      console.error(
        "[api/ai/generate-master-signal] quota error:",
        err.message
      );
      return NextResponse.json(
        {
          message:
            "We've hit our AI usage limit — looks like a lot of people are finding this useful! Please try again later or reach out so we can get things running again.",
        },
        { status: 402 }
      );
    }

    if (err instanceof AIRequestError) {
      console.error(
        "[api/ai/generate-master-signal] request error:",
        err.message
      );
      return NextResponse.json(
        {
          message:
            "Could not generate master signal. The input may be too large — try extracting signals from fewer sessions.",
        },
        { status: 400 }
      );
    }

    if (err instanceof AIEmptyResponseError) {
      console.error(
        "[api/ai/generate-master-signal] empty response:",
        err.message
      );
      return NextResponse.json(
        {
          message:
            "AI could not produce a master signal from the available data. Please ensure sessions have extracted signals and try again.",
        },
        { status: 422 }
      );
    }

    if (err instanceof AIServiceError) {
      console.error(
        "[api/ai/generate-master-signal] service error:",
        err.message
      );
      return NextResponse.json(
        {
          message:
            "Master signal generation is temporarily unavailable. Please try again in a few moments.",
        },
        { status: 503 }
      );
    }

    // Unexpected error
    console.error(
      "[api/ai/generate-master-signal] unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        message:
          "An unexpected error occurred during master signal generation.",
      },
      { status: 500 }
    );
  }
}
