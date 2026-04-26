// ---------------------------------------------------------------------------
// Database Query — Session Detail Domain
// ---------------------------------------------------------------------------
// Single-session lookup used by the chat citation dialog (SessionPreviewDialog)
// and the dashboard "View Session" link. Reaches into a single row and
// applies team scoping directly via scopeByTeam — the wrapper helpers in
// shared/base-query-builder don't fit a maybeSingle() pattern.
// ---------------------------------------------------------------------------

import { type SupabaseClient } from "@supabase/supabase-js";

import { scopeByTeam } from "@/lib/repositories/supabase/scope-by-team";

import { LOG_PREFIX } from "../action-metadata";
import type { QueryFilters } from "../types";

/**
 * Fetches a single session by ID with team scoping. Returns structured_json,
 * client_name, and session_date for the session preview dialog.
 */
export async function handleSessionDetail(
  supabase: SupabaseClient,
  filters: QueryFilters
): Promise<Record<string, unknown>> {
  if (!filters.sessionId) {
    throw new Error("session_detail action requires a sessionId filter");
  }

  console.log(
    `${LOG_PREFIX} handleSessionDetail — sessionId: ${filters.sessionId}`
  );

  let query = supabase
    .from("sessions")
    .select("id, session_date, structured_json, clients(name)")
    .eq("id", filters.sessionId)
    .is("deleted_at", null);

  query = scopeByTeam(query, filters.teamId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(`${LOG_PREFIX} session_detail error:`, error);
    throw new Error("Failed to fetch session detail");
  }

  if (!data) {
    throw new Error("Session not found");
  }

  const row = data as unknown as {
    id: string;
    session_date: string;
    structured_json: Record<string, unknown> | null;
    clients: { name: string } | null;
  };

  return {
    sessionId: row.id,
    sessionDate: row.session_date,
    clientName: row.clients?.name ?? "Unknown",
    structuredJson: row.structured_json,
  };
}
