import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import {
  executeQuery,
  type QueryAction,
  type QueryFilters,
} from "@/lib/services/database-query-service";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/dashboard]";

const dashboardParamsSchema = z.object({
  action: z.enum([
    "sentiment_distribution",
    "urgency_distribution",
    "sessions_over_time",
    "client_health_grid",
    "competitive_mention_frequency",
    "client_list",
    // Theme widget actions (PRD-021 Part 3)
    "top_themes",
    "theme_trends",
    "theme_client_matrix",
    // Drill-down actions (PRD-021 Part 4)
    "drill_down",
    "session_detail",
  ]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  clients: z.string().optional(),
  severity: z.string().optional(),
  urgency: z.string().optional(),
  granularity: z.enum(["week", "month"]).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  drillDown: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/dashboard?action=...&dateFrom=...&dateTo=...&clients=uuid1,uuid2
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = dashboardParamsSchema.safeParse(raw);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn(`${LOG_PREFIX} GET — validation failed:`, message);
    return NextResponse.json({ message }, { status: 400 });
  }

  const {
    action,
    dateFrom,
    dateTo,
    clients,
    severity,
    urgency,
    granularity,
    confidenceMin,
    drillDown,
    sessionId,
  } = parsed.data;

  console.log(`${LOG_PREFIX} GET — action: ${action}`);

  const supabase = await createClient();
  const teamId = await getActiveTeamId();

  // Split comma-separated client UUIDs into an array
  const clientIds = clients
    ? clients.split(",").filter((id) => id.trim().length > 0)
    : undefined;

  const filters: QueryFilters = {
    teamId,
    dateFrom,
    dateTo,
    clientIds,
    severity,
    urgency,
    granularity: granularity as QueryFilters["granularity"],
    confidenceMin,
    drillDown,
    sessionId,
  };

  try {
    const result = await executeQuery(
      supabase,
      action as QueryAction,
      filters
    );

    console.log(`${LOG_PREFIX} GET — action: ${action} completed`);
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} GET error:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to execute dashboard query" },
      { status: 500 }
    );
  }
}
